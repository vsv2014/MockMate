import { describe, it, expect } from 'vitest'
import {
  extractYearsTotal, maxDateSpan, maxExplicitYears, bandForYears, titleBand,
  extractEducation, extractCerts, resumeFacts, parseYearsExpInput,
} from './resumeFacts.js'

describe('experience extraction', () => {
  it('takes the max of explicit years and closed date spans', () => {
    expect(maxExplicitYears('6+ years building platforms')).toBe(6)
    expect(maxDateSpan('Acme Corp 2014 – 2021')).toBe(7)
    expect(extractYearsTotal('6+ years building platforms. Acme Corp 2014 – 2021.')).toBe(7)
  })
  it('understands present/current spans', () => {
    expect(maxDateSpan('2020 – Present')).toBeGreaterThanOrEqual(5)
  })
  it('null when nothing extractable', () => {
    expect(extractYearsTotal('Enthusiastic team player')).toBeNull()
  })
  it('caps absurd spans and discards nonsense year claims', () => {
    expect(extractYearsTotal('Career 1979 – 2026')).toBe(45)
    expect(extractYearsTotal('99 years of experience')).toBeNull()
  })
})

describe('seniority bands', () => {
  it('maps years to bands', () => {
    expect(bandForYears(1)).toBe(0)
    expect(bandForYears(3)).toBe(1)
    expect(bandForYears(7)).toBe(2)
    expect(bandForYears(12)).toBe(3)
    expect(bandForYears(null)).toBeNull()
  })
  it('maps titles to bands', () => {
    expect(titleBand('QA Intern')).toBe(0)
    expect(titleBand('Junior Developer')).toBe(0)
    expect(titleBand('Engineer')).toBe(1)
    expect(titleBand('Senior QA Engineer')).toBe(2)
    expect(titleBand('Staff Engineer')).toBe(3)
    expect(titleBand('Lead Architect')).toBe(3)
  })
})

describe('education & certs', () => {
  it('extracts education levels', () => {
    expect(extractEducation('B.Tech, CSE')).toEqual(['bachelors'])
    expect(extractEducation('B.Tech ... later MBA')).toEqual(['masters', 'bachelors'])
  })
  it('extracts known certifications', () => {
    expect(extractCerts('AWS Certified Solutions Architect; CKA holder')).toEqual(expect.arrayContaining(['aws', 'cka']))
    expect(extractCerts('no certs here')).toEqual([])
  })
})

describe('resumeFacts + input parsing', () => {
  it('returns one structured honest read', () => {
    const f = resumeFacts('7 years experience. 2018 – 2025. B.Tech. CKA certified.')
    expect(f.years).toBe(7)
    expect(f.band).toBe(2)
    expect(f.education).toContain('bachelors')
    expect(f.certs).toContain('cka')
  })
  it('parses typed experience ranges', () => {
    expect(parseYearsExpInput('5-8 years')).toBe(5)
    expect(parseYearsExpInput('')).toBeNull()
  })
})
