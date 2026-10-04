import { describe, it, expect } from 'vitest'
import { detectBoard, fetchCompanyBoard } from './companyBoards.js'

describe('detectBoard', () => {
  it('detects Greenhouse boards from career URLs', () => {
    expect(detectBoard('https://boards.greenhouse.io/zoom')).toEqual({ kind: 'greenhouse', org: 'zoom' })
    expect(detectBoard('https://job-boards.greenhouse.io/airtable/jobs/4711')).toEqual({ kind: 'greenhouse', org: 'airtable' })
  })
  it('detects Lever boards from career URLs', () => {
    expect(detectBoard('https://jobs.lever.co/notion')).toEqual({ kind: 'lever', org: 'notion' })
    expect(detectBoard('https://www.lever.co/ramp')).toEqual({ kind: 'lever', org: 'ramp' })
  })
  it('returns null for unsupported or empty URLs', () => {
    expect(detectBoard('')).toBeNull()
    expect(detectBoard('https://careers.workday.example.com/foo')).toBeNull()
    expect(detectBoard('https://boards.greenhouse.io/v1')).toBeNull()
  })
})

describe('fetchCompanyBoard', () => {
  it('normalizes Greenhouse postings', async () => {
    const fetchImpl = async url => {
      expect(url).toContain('boards-api.greenhouse.io/v1/boards/zoom/jobs')
      return {
        ok: true,
        json: async () => ({
          name: 'Zoom',
          jobs: [{
            id: 4711, title: 'Senior QA Engineer', updated_at: '2026-09-01T00:00:00Z',
            location: { name: 'Hyderabad, India' },
            absolute_url: 'https://boards.greenhouse.io/zoom/jobs/4711',
            content: '<p>Own <b>quality</b> for video pipelines.</p>',
          }],
        }),
      }
    }
    const jobs = await fetchCompanyBoard('https://boards.greenhouse.io/zoom', fetchImpl)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      id: 'gh_4711', title: 'Senior QA Engineer', company: 'Zoom',
      location: 'Hyderabad, India', source: 'company', sourceName: 'Company board',
    })
    expect(jobs[0].snippet).toContain('quality')
    expect(jobs[0].postedTs).toBeGreaterThan(0)
  })

  it('normalizes Lever postings', async () => {
    const fetchImpl = async url => {
      expect(url).toContain('api.lever.co/v0/postings/notion')
      return {
        ok: true,
        json: async () => ([{
          id: 'x1', text: 'Product Engineer', createdAt: 1756684800000,
          hostedUrl: 'https://jobs.lever.co/notion/x1',
          categories: { location: 'Bengaluru', workplace: 'Hybrid', employment: 'Full-time', team: 'Product' },
          description: '<p>Ship <i>collaborative</i> editors.</p>',
        }]),
      }
    }
    const jobs = await fetchCompanyBoard('https://jobs.lever.co/notion', fetchImpl)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      id: 'lv_x1', title: 'Product Engineer', location: 'Bengaluru · Hybrid',
      jobType: 'Full-time', source: 'company',
    })
  })

  it('returns [] for unsupported ATS without throwing', async () => {
    const jobs = await fetchCompanyBoard('https://careers.workday.example.com', async () => { throw new Error('should not fetch') })
    expect(jobs).toEqual([])
  })

  it('surfaces provider errors as 502 for the caller to handle', async () => {
    await expect(fetchCompanyBoard('https://boards.greenhouse.io/zoom', async () => ({ ok: false, status: 429 })))
      .rejects.toMatchObject({ status: 502 })
  })
})
