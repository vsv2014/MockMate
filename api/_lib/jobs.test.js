import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('./http.js', () => ({
  fetchWithTimeout: vi.fn(),
}))
vi.mock('./core.js', () => ({
  completeJSON: vi.fn(),
  availableProviders: vi.fn(() => []),
}))

import { fetchWithTimeout } from './http.js'
import { availableProviders, completeJSON } from './core.js'
import { categoryFor, countryFor, userRegionTokens, locationOk, findJobs, adzunaConfigured } from './jobs.js'

describe('categoryFor', () => {
  it('maps roles to Remotive categories', () => {
    expect(categoryFor('Senior Test Engineer')).toBe('qa')
    expect(categoryFor('Data Scientist')).toBe('data')
    expect(categoryFor('DevOps / SRE')).toBe('devops-sysadmin')
    expect(categoryFor('Backend Engineer')).toBe('software-dev')   // default
  })
})

describe('countryFor (Adzuna code)', () => {
  it('infers country from location', () => {
    expect(countryFor('Hyderabad, India')).toBe('in')
    expect(countryFor('Bengaluru')).toBe('in')
    expect(countryFor('London, UK')).toBe('gb')
    expect(countryFor('New York, USA')).toBe('us')
  })
  it('returns null for unmappable locations', () => expect(countryFor('Mars')).toBeNull())
})

describe('locationOk (region filter)', () => {
  const tok = userRegionTokens('Hyderabad, India')
  it('always allows worldwide/anywhere/remote', () => {
    for (const l of ['Worldwide', 'Anywhere', '100% Remote']) expect(locationOk(l, tok)).toBe(true)
  })
  it('allows the candidate region, rejects mismatched regions', () => {
    expect(locationOk('India', tok)).toBe(true)
    expect(locationOk('Asia', tok)).toBe(true)
    expect(locationOk('Europe', tok)).toBe(false)
    expect(locationOk('Israel', tok)).toBe(false)
  })
  it('does NOT over-match "us" inside Australia/Belarus (whole-word padding)', () => {
    const usTok = userRegionTokens('New York, USA')
    expect(locationOk('Australia', usTok)).toBe(false)
    expect(locationOk('USA Only', usTok)).toBe(true)
  })
})

describe('findJobs provider/contract', () => {
  const prevAdzuna = {
    id: process.env.ADZUNA_APP_ID,
    key: process.env.ADZUNA_APP_KEY,
  }

  beforeEach(() => {
    vi.mocked(fetchWithTimeout).mockReset()
    vi.mocked(availableProviders).mockReturnValue([])
    vi.mocked(completeJSON).mockReset()
    delete process.env.ADZUNA_APP_ID
    delete process.env.ADZUNA_APP_KEY
  })

  afterEach(() => {
    if (prevAdzuna.id === undefined) delete process.env.ADZUNA_APP_ID
    else process.env.ADZUNA_APP_ID = prevAdzuna.id
    if (prevAdzuna.key === undefined) delete process.env.ADZUNA_APP_KEY
    else process.env.ADZUNA_APP_KEY = prevAdzuna.key
  })

  it('rejects empty resume+role+query', async () => {
    await expect(findJobs({})).rejects.toMatchObject({ status: 400 })
    expect(fetchWithTimeout).not.toHaveBeenCalled()
  })

  it('fetches Remotive and ranks with keyword when no LLM providers', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      json: async () => ({
        jobs: [
          {
            id: 11,
            title: 'Backend Engineer',
            company_name: 'Acme',
            candidate_required_location: 'Worldwide',
            description: '<p>Node.js APIs and Postgres</p>',
            tags: ['node', 'postgres'],
            publication_date: '2026-01-01',
            job_type: 'full_time',
            category: 'Software Development',
            url: 'https://example.com/job/11',
          },
          {
            id: 12,
            title: 'Marketing Manager',
            company_name: 'OtherCo',
            candidate_required_location: 'Europe',
            description: 'SEO and content',
            tags: ['seo'],
            publication_date: '2026-01-02',
            url: 'https://example.com/job/12',
          },
        ],
      }),
    })

    const out = await findJobs({
      resume: 'Backend engineer specializing in Node.js and Postgres APIs.',
      targetRole: 'Backend Engineer',
      max: 10,
    })

    expect(out.ranker).toBe('keyword')
    expect(out.jobs.length).toBeGreaterThan(0)
    expect(out.jobs[0].title).toMatch(/Backend/i)
    expect(out.jobs[0].source).toBe('remote')
    expect(String(fetchWithTimeout.mock.calls[0][0])).toContain('remotive.com')
    expect(completeJSON).not.toHaveBeenCalled()
  })

  it('uses AI ranker when providers exist and completeJSON returns ranked', async () => {
    vi.mocked(availableProviders).mockReturnValue([{ id: 'gemini', label: 'Gemini' }])
    vi.mocked(completeJSON).mockResolvedValue({
      ranked: [{ index: 0, score: 88, reason: 'Strong Node match', gaps: '' }],
    })
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      json: async () => ({
        jobs: [{
          id: 21,
          title: 'Node Engineer',
          company_name: 'Co',
          candidate_required_location: 'Worldwide',
          description: 'Node services',
          tags: ['node'],
          publication_date: '2026-02-01',
          url: 'https://example.com/21',
        }],
      }),
    })

    const out = await findJobs({
      resume: 'Node.js engineer with microservices experience across many projects.',
      targetRole: 'Backend Engineer',
    })
    expect(out.ranker).toBe('ai')
    expect(out.jobs[0].score).toBe(88)
    expect(out.jobs[0].reason).toContain('Node')
    expect(completeJSON).toHaveBeenCalledOnce()
  })

  it('falls back to keyword when AI ranker throws', async () => {
    vi.mocked(availableProviders).mockReturnValue([{ id: 'gemini', label: 'Gemini' }])
    vi.mocked(completeJSON).mockRejectedValue(new Error('LLM down'))
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      json: async () => ({
        jobs: [{
          id: 31,
          title: 'Backend Engineer',
          company_name: 'Zed',
          candidate_required_location: 'Worldwide',
          description: 'Backend Node APIs',
          tags: ['backend', 'node'],
          publication_date: '2026-03-01',
          url: 'https://example.com/31',
        }],
      }),
    })
    const out = await findJobs({ resume: 'Backend Node engineer resume text here.', targetRole: 'Backend' })
    expect(out.ranker).toBe('keyword')
    expect(out.jobs.length).toBeGreaterThan(0)
  })

  it('reports localEnabled from Adzuna env without requiring a call when country unknown', async () => {
    expect(adzunaConfigured()).toBe(false)
    process.env.ADZUNA_APP_ID = 'id'
    process.env.ADZUNA_APP_KEY = 'key'
    expect(adzunaConfigured()).toBe(true)
  })
})
