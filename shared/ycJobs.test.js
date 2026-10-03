import { describe, it, expect } from 'vitest'
import { findHiringStoryId, parseHiringComment, fetchYcJobs } from './ycJobs.js'

describe('findHiringStoryId', () => {
  it('resolves the current month thread id', async () => {
    const when = new Date(2026, 8, 15) // September 2026
    const fetchImpl = async url => {
      expect(url).toContain(encodeURIComponent('"Ask HN: Who is hiring? (September 2026)"'))
      return { ok: true, json: async () => ({ hits: [{ objectID: '45100000' }] }) }
    }
    expect(await findHiringStoryId(fetchImpl, when)).toBe('45100000')
  })
  it('falls back to the previous month when current is missing', async () => {
    const when = new Date(2026, 9, 2) // October 2026
    let calls = 0
    const fetchImpl = async url => {
      calls++
      if (calls === 1) {
        expect(url).toContain('October%202026')
        return { ok: true, json: async () => ({ hits: [] }) }
      }
      expect(url).toContain('September%202026')
      return { ok: true, json: async () => ({ hits: [{ objectID: '45099999' }] }) }
    }
    expect(await findHiringStoryId(fetchImpl, when)).toBe('45099999')
  })
})

describe('parseHiringComment', () => {
  it('parses a structured YC remote posting', () => {
    const j = parseHiringComment(
      '<p>Vetly (YC W24) | Senior Backend Engineer | Remote (EU / India) | Full-time</p><p>Apply: https://vetly.example/careers</p>',
      { id: 45100123, created_at_i: 1756684800 },
    )
    expect(j).toMatchObject({
      company: 'Vetly', title: 'Senior Backend Engineer', location: 'Remote (EU / India)',
      jobType: 'Full-time', source: 'remote', sourceName: 'YC startups (HN)',
      url: 'https://vetly.example/careers',
    })
    expect(j.id).toBe('hn_45100123')
    expect(j.postedTs).toBe(1756684800000)
  })
  it('parses an on-site YC posting with a city', () => {
    const j = parseHiringComment('<p>Gridware (YC S21) | Frontend Engineer | Bengaluru | full-time</p>', { id: 1 })
    expect(j).toMatchObject({ company: 'Gridware', title: 'Frontend Engineer', location: 'Bengaluru', source: 'local' })
  })
  it('ignores non-YC postings', () => {
    expect(parseHiringComment('<p>BigCorp | Engineer | Remote</p>', { id: 2 })).toBeNull()
  })
})

describe('fetchYcJobs', () => {
  it('maps thread children to jobs and caps at 40', async () => {
    const fetchImpl = async url => {
      if (url.includes('/search?')) return { ok: true, json: async () => ({ hits: [{ objectID: 'S1' }] }) }
      expect(url).toContain('/items/S1')
      return {
        ok: true,
        json: async () => ({
          children: [
            { id: 1, text: '<p>Aily (YC W23) | Data Engineer | Remote</p>', created_at_i: 1756684800 },
            { id: 2, text: '<p>Not YC | Engineer | Remote</p>', created_at_i: 1756684800 },
            { id: 3, text: '<p>Bolt (YC S20) | Product Designer | London</p>', created_at_i: 1756684800 },
          ],
        }),
      }
    }
    const jobs = await fetchYcJobs(fetchImpl, new Date(2026, 8, 10))
    expect(jobs.map(j => j.company)).toEqual(['Aily', 'Bolt'])
  })
  it('returns [] when no story is found', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ hits: [] }) })
    expect(await fetchYcJobs(fetchImpl, new Date(2026, 8, 10))).toEqual([])
  })
})
