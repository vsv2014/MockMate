import { describe, it, expect } from 'vitest'
import { buildTailoredResumePdf } from './resumePdf.js'

describe('buildTailoredResumePdf', () => {
  it('builds a non-empty PDF blob from tailored resume text', () => {
    const { blob, filename, pages } = buildTailoredResumePdf({
      resume: 'SUMMARY\nBackend engineer.\n\nEXPERIENCE\n- Built APIs\n- Led team',
      tailor: {
        summary: 'Full-stack engineer with 4 years building distributed systems.',
        rewrittenBullets: [{ before: 'Built APIs', after: 'Built REST APIs serving 1M req/day' }],
      },
      targetRole: 'Full Stack',
    })
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(500)
    expect(blob.type).toMatch(/pdf/i)
    expect(filename).toMatch(/\.pdf$/i)
    expect(pages).toBeGreaterThanOrEqual(1)
  })

  it('rejects empty resume', () => {
    expect(() => buildTailoredResumePdf({ resume: '   ' })).toThrow(/resume/i)
  })
})
