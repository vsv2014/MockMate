import { describe, it, expect } from 'vitest'
import { categoryFor, countryFor, userRegionTokens, locationOk } from './jobs.js'

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
