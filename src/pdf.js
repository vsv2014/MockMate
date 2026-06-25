// Extract text from an uploaded PDF resume — entirely client-side (the file never leaves
// the device). pdfjs is lazy-loaded so it doesn't bloat startup. Throws on failure so the
// caller can fall back to paste. Returns '' for scanned/image PDFs (no extractable text).
export async function extractPdfText(file) {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  }
  const data = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data }).promise
  let text = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent()
    text += content.items.map(it => it.str).join(' ') + '\n'
  }
  return text.replace(/[ \t]+/g, ' ').trim()
}
