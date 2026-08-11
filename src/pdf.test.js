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

import { extractPdfText } from './pdf.js'
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
