// Extract text from an uploaded PDF resume/document entirely client-side.
// Bounds protect the Electron renderer from accidentally loading pathological files.
export const MAX_LOCAL_PDF_BYTES = 10 * 1024 * 1024
export const MAX_LOCAL_PDF_PAGES = 150

export async function extractPdfText(file, { signal, maxBytes = MAX_LOCAL_PDF_BYTES, maxPages = MAX_LOCAL_PDF_PAGES } = {}) {
  if (Number(file?.size || 0) > maxBytes) throw new Error(`PDF is too large. Choose a file under ${Math.round(maxBytes / 1024 / 1024)} MB.`)
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError')
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  }
  const data = await file.arrayBuffer()
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError')
  const loadingTask = pdfjs.getDocument({ data })
  let pdf
  try {
    pdf = await loadingTask.promise
    if (pdf.numPages > maxPages) throw new Error(`PDF has ${pdf.numPages} pages. The desktop limit is ${maxPages} pages per file.`)
    let text = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError')
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      text += content.items.map(it => it.str).join(' ') + '\n'
      page.cleanup?.()
    }
    return text.replace(/[ \t]+/g, ' ').trim()
  } finally {
    try { await pdf?.destroy?.() } catch {}
    try { await loadingTask?.destroy?.() } catch {}
  }
}
