import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('pdfjs-dist', () => {
  const getDocument = vi.fn(({ data }) => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: async (n) => ({
        getTextContent: async () => ({
          items: n === 1
            ? [{ str: 'Jane' }, { str: 'Doe' }, { str: '  Backend' }]
            : [{ str: 'Engineer' }, { str: 'with' }, { str: 'Node' }],
        }),
      }),
    }),
  }))
  return {
    getDocument,
    GlobalWorkerOptions: { workerSrc: '' },
  }
})

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: 'mock-worker.js',
}))

import { extractPdfText, reconstructPageText } from './pdf.js'
import * as pdfjs from 'pdfjs-dist'

describe('extractPdfText', () => {
  beforeEach(() => {
    pdfjs.GlobalWorkerOptions.workerSrc = ''
  })

  it('joins page text and collapses whitespace', async () => {
    const file = {
      arrayBuffer: async () => new ArrayBuffer(8),
    }
    const text = await extractPdfText(file)
    expect(text).toBe('Jane Doe Backend\nEngineer with Node')
    expect(pdfjs.getDocument).toHaveBeenCalled()
  })

  it('returns empty string when pages have no text items', async () => {
    vi.mocked(pdfjs.getDocument).mockReturnValueOnce({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({ getTextContent: async () => ({ items: [] }) }),
      }),
    })
    const text = await extractPdfText({ arrayBuffer: async () => new ArrayBuffer(4) })
    expect(text).toBe('')
  })
})

describe('reconstructPageText (Artemis-style layout-aware PDF extraction)', () => {
  it('preserves visual lines, section headers, and bullet hierarchy by Y-coordinate', () => {
    const items = [
      { str: 'EXPERIENCE', transform: [1, 0, 0, 1, 50, 720], width: 80 },
      { str: 'Senior Backend Engineer — SysCloud', transform: [1, 0, 0, 1, 50, 695], width: 220 },
      { str: '• Built distributed backup worker in Go', transform: [1, 0, 0, 1, 60, 678], width: 210 },
      { str: '• Reduced p95 latency by 42% using Redis streams', transform: [1, 0, 0, 1, 60, 662], width: 260 },
    ]
    const out = reconstructPageText(items, { pageNumber: 1, totalPages: 1 })
    const lines = out.split('\n').filter(Boolean)
    expect(lines[0]).toBe('EXPERIENCE')
    expect(lines[1]).toBe('Senior Backend Engineer — SysCloud')
    expect(lines[2]).toBe('• Built distributed backup worker in Go')
    expect(lines[3]).toBe('• Reduced p95 latency by 42% using Redis streams')
  })

  it('separates two-column PDF resume layouts instead of interleaving left and right columns on the same Y row', () => {
    // Left column (X ~ 40..180): SKILLS, Right column (X ~ 260..520): EXPERIENCE at identical Y coordinates
    const items = [
      // Left column
      { str: 'SKILLS', transform: [1, 0, 0, 1, 40, 700], width: 50 },
      { str: 'Go, Python, SQL', transform: [1, 0, 0, 1, 40, 680], width: 90 },
      { str: 'Kafka, Redis, AWS', transform: [1, 0, 0, 1, 40, 660], width: 100 },
      { str: 'Kubernetes, Docker', transform: [1, 0, 0, 1, 40, 640], width: 110 },
      // Right column at the exact same Y coordinates!
      { str: 'EXPERIENCE', transform: [1, 0, 0, 1, 260, 700], width: 80 },
      { str: 'Lead Engineer @ Acme Corp', transform: [1, 0, 0, 1, 260, 680], width: 180 },
      { str: 'Designed multi-region event bus', transform: [1, 0, 0, 1, 260, 660], width: 200 },
      { str: 'Scaled throughput to 50k msgs/sec', transform: [1, 0, 0, 1, 260, 640], width: 210 },
    ]
    const out = reconstructPageText(items, { pageNumber: 1, totalPages: 1 })
    expect(out).not.toMatch(/SKILLS\s+EXPERIENCE/)
    expect(out).not.toMatch(/Go, Python, SQL\s+Lead Engineer/)
    expect(out.indexOf('Kubernetes, Docker')).toBeLessThan(out.indexOf('Lead Engineer @ Acme Corp'))
  })

  it('adds [Page N] markers for multi-page documents', () => {
    const items = [{ str: 'System Design Notes', transform: [1, 0, 0, 1, 50, 700], width: 120 }]
    expect(reconstructPageText(items, { pageNumber: 2, totalPages: 5 })).toBe('[Page 2]\nSystem Design Notes')
  })
})
