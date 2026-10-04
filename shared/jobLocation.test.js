import { describe, it, expect } from 'vitest'
import { inferLocationFromTimezone, resolveJobLocation, locationSourceLabel } from './jobLocation.js'

describe('inferLocationFromTimezone', () => {
  it('maps Asia/Kolkata to India', () => {
    expect(inferLocationFromTimezone('Asia/Kolkata')).toBe('India')
  })
  it('maps common zones to their countries', () => {
    expect(inferLocationFromTimezone('Asia/Tokyo')).toBe('Japan')
    expect(inferLocationFromTimezone('Europe/London')).toBe('United Kingdom')
    expect(inferLocationFromTimezone('America/New_York')).toBe('United States')
    expect(inferLocationFromTimezone('America/Los_Angeles')).toBe('United States')
    expect(inferLocationFromTimezone('Australia/Sydney')).toBe('Australia')
    expect(inferLocationFromTimezone('America/Toronto')).toBe('Canada')
  })
  it('returns empty string for unknown or missing zones', () => {
    expect(inferLocationFromTimezone('')).toBe('')
    expect(inferLocationFromTimezone('Mars/Olympus')).toBe('')
  })
})

describe('resolveJobLocation', () => {
  it('manual override wins over profile and auto', () => {
    const r = resolveJobLocation({ override: 'Pune, India', profileLocation: 'Berlin', timezone: 'Asia/Kolkata' })
    expect(r).toEqual({ location: 'Pune, India', source: 'manual' })
  })
  it('profile wins over auto when no override', () => {
    const r = resolveJobLocation({ profileLocation: 'Hyderabad, India', timezone: 'America/New_York' })
    expect(r).toEqual({ location: 'Hyderabad, India', source: 'profile' })
  })
  it('falls back to timezone auto-detection', () => {
    const r = resolveJobLocation({ timezone: 'Asia/Kolkata' })
    expect(r).toEqual({ location: 'India', source: 'auto' })
  })
  it('empty when nothing available', () => {
    expect(resolveJobLocation({})).toEqual({ location: '', source: '' })
  })
})

describe('locationSourceLabel', () => {
  it('labels each source for transparent UI', () => {
    expect(locationSourceLabel('manual')).toContain('override')
    expect(locationSourceLabel('profile')).toContain('profile')
    expect(locationSourceLabel('auto')).toContain('timezone')
    expect(locationSourceLabel('')).toContain('not set')
  })
})
