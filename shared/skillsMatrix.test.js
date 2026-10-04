import { describe, expect, it } from 'vitest'
import { analyzeSkillsGap, extractSkillsFromText } from './skillsMatrix.js'

describe('shared/skillsMatrix', () => {
  it('extracts canonical skills across all 5 categories', () => {
    const skills = extractSkillsFromText('Built React + TypeScript UI, Node.js and PostgreSQL APIs on AWS with Docker, Kubernetes, and RAG.')
    expect([...skills]).toEqual(expect.arrayContaining([
      'React',
      'TypeScript',
      'Node.js',
      'PostgreSQL',
      'AWS',
      'Docker',
      'Kubernetes',
      'RAG & Vector Search',
    ]))
  })

  it('computes matched, missing, bonus skills and gap bridges between resume and JD', () => {
    const resume = 'Senior Frontend Engineer with 6 years in JavaScript, TypeScript, React, Next.js, GraphQL, and Vitest.'
    const jd = 'Looking for a Full-Stack Engineer experienced in TypeScript, React, Node.js, PostgreSQL, Docker, and AWS.'
    const report = analyzeSkillsGap(resume, jd, 'Full-Stack Engineer')

    expect(report.matched).toEqual(expect.arrayContaining(['TypeScript', 'React']))
    expect(report.missing).toEqual(expect.arrayContaining(['Node.js', 'PostgreSQL', 'Docker', 'AWS']))
    expect(report.bonus).toEqual(expect.arrayContaining(['JavaScript', 'Next.js', 'GraphQL']))
    expect(report.readinessScore).toBeGreaterThan(25)
    expect(report.gapBridges.length).toBeGreaterThanOrEqual(4)
    expect(report.playbookPatch).toContain('[Skills Focus & Gap Strategy]')
  })

  it('falls back to role-inferred skills when JD text is empty', () => {
    const resume = 'Built Python, SQL, and PyTorch pipelines.'
    const report = analyzeSkillsGap(resume, '', 'Machine Learning Engineer')
    expect(report.matched).toEqual(expect.arrayContaining(['Python', 'SQL', 'PyTorch / ML']))
    expect(report.missing.length).toBeGreaterThan(0)
  })
})
