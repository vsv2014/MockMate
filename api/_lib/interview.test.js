import { describe, it, expect } from 'vitest'
import { pickPlaybook } from './interview.js'

describe('pickPlaybook (question classification)', () => {
  const cases = [
    ['explain temporal dead zone in JavaScript', 'technical'],
    ['what is the difference between let and const', 'technical'],
    ['reverse a linked list', 'dsa'],
    ['find the longest substring without repeating characters', 'dsa'],
    ['design a URL shortener', 'system_design'],
    ['tell me about a time you had a conflict', 'behavioral'],
    ['walk me through your most challenging project', 'project_walkthrough'],
    ['why do you want to work here', 'company'],
  ]
  for (const [q, key] of cases) {
    it(`"${q}" → ${key}`, () => expect(pickPlaybook(q).key).toBe(key))
  }
  it('falls back to general for unclassifiable input', () => {
    expect(pickPlaybook('so anyway').key).toBe('general')
  })
})
