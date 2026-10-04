// Extract text from an uploaded PDF resume/document entirely client-side.
// Bounds protect the Electron renderer from accidentally loading pathological files.
// Uses layout-aware line & column reconstruction (inspired by Kore.ai Artemis Stage 2
// Extract) so PDF resumes, bullet lists, and two-column layouts keep their structure.
export const MAX_LOCAL_PDF_BYTES = 10 * 1024 * 1024
export const MAX_LOCAL_PDF_PAGES = 150

const LINE_Y_TOLERANCE = 3.5

/**
 * Reconstruct structured text from pdf.js `getTextContent().items` for a single page.
 * Preserves visual line breaks, bullet hierarchies, and two-column reading order.
 */
export function reconstructPageText(items = [], { pageNumber = null, totalPages = 1 } = {}) {
  if (!Array.isArray(items) || !items.length) return ''

  // Fast fallback if items lack pdf.js transform matrices (e.g. minimal unit-test mocks).
  const hasCoordinates = items.some(it => Array.isArray(it?.transform) && it.transform.length >= 6)
  if (!hasCoordinates) {
    return items
      .map(it => {
        const s = String(it?.str ?? '')
        return it?.hasEOL ? `${s}\n` : s
      })
      .join(' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .trim()
  }

  const glyphs = []
  let minX = Infinity
  let maxX = -Infinity

  for (const it of items) {
    const str = String(it?.str ?? '')
    if (!str.trim() && !it?.hasEOL) continue
    const tr = Array.isArray(it.transform) ? it.transform : [1, 0, 0, 1, 0, 0]
    const x = Number(tr[4]) || 0
    const y = Number(tr[5]) || 0
    const width = Number(it.width) || Math.max(str.length * 4.5, 4)
    if (str.trim()) {
      if (x < minX) minX = x
      if (x + width > maxX) maxX = x + width
    }
    glyphs.push({ str, x, y, endX: x + width, hasEOL: Boolean(it.hasEOL) })
  }

  if (!glyphs.length) return ''

  // Detect clear two-column layout:
  // If the page is wide enough and has multiple items on both left and right sides with
  // very few items crossing the central gutter, read Left Column top-to-bottom then Right Column.
  const pageSpan = maxX - minX
  let columns = [glyphs]
  if (pageSpan >= 260 && glyphs.length >= 8) {
    const midStart = minX + pageSpan * 0.42
    const midEnd = minX + pageSpan * 0.58
    let gutterX = null
    // Find a split candidate in [42%, 58%] of page width where very few spans cross
    for (let ratio = 0.44; ratio <= 0.56; ratio += 0.03) {
      const candidateX = minX + pageSpan * ratio
      const crossing = glyphs.filter(g => g.x < candidateX - 6 && g.endX > candidateX + 6)
      const leftSide = glyphs.filter(g => g.endX <= candidateX + 6)
      const rightSide = glyphs.filter(g => g.x >= candidateX - 6)
      if (
        crossing.length <= Math.floor(glyphs.length * 0.08) &&
        leftSide.length >= 3 &&
        rightSide.length >= 3
      ) {
        gutterX = candidateX
        break
      }
    }

    if (gutterX !== null) {
      const spanningHeader = []
      const leftCol = []
      const rightCol = []
      for (const g of glyphs) {
        if (g.x < gutterX - 6 && g.endX > gutterX + 6) spanningHeader.push(g)
        else if (g.x < gutterX) leftCol.push(g)
        else rightCol.push(g)
      }
      columns = [spanningHeader, leftCol, rightCol].filter(col => col.length > 0)
    }
  }

  const renderedBlocks = columns.map(col => renderColumnLines(col)).filter(Boolean)
  const pageBody = renderedBlocks.join('\n\n').trim()
  if (!pageBody) return ''
  return totalPages > 1 && pageNumber ? `[Page ${pageNumber}]\n${pageBody}` : pageBody
}

function renderColumnLines(glyphs) {
  if (!glyphs.length) return ''
  // Sort top-to-bottom (descending Y in PDF coordinate space), then left-to-right (ascending X)
  const sorted = [...glyphs].sort((a, b) => {
    if (Math.abs(b.y - a.y) > LINE_Y_TOLERANCE) return b.y - a.y
    return a.x - b.x
  })

  const lines = []
  let currentLine = []
  let currentY = null

  for (const g of sorted) {
    if (currentY === null || Math.abs(g.y - currentY) <= LINE_Y_TOLERANCE) {
      currentLine.push(g)
      currentY = currentY === null ? g.y : (currentY + g.y) / 2
    } else {
      lines.push({ y: currentY, items: currentLine })
      currentLine = [g]
      currentY = g.y
    }
  }
  if (currentLine.length) lines.push({ y: currentY, items: currentLine })

  const outLines = []
  let prevY = null
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x)
    let text = ''
    let prevEndX = null
    for (const item of line.items) {
      const piece = item.str
      if (!piece) continue
      if (!text) {
        text = piece
      } else {
        const gap = prevEndX !== null ? item.x - prevEndX : 4
        const needsSpace = gap > 1.5 && !text.endsWith(' ') && !piece.startsWith(' ') && !/^[,.;:!?)]/.test(piece)
        text += (needsSpace ? ' ' : '') + piece
      }
      prevEndX = item.endX
    }
    const cleanLine = text.replace(/[ \t]+/g, ' ').trim()
    if (!cleanLine) continue

    // Insert paragraph break when vertical gap between lines is significantly larger than normal line height
    if (prevY !== null && prevY - line.y > 18 && outLines.length > 0) {
      outLines.push('')
    }
    outLines.push(cleanLine)
    prevY = line.y
  }

  return outLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

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
    const pages = []
    let sawCoordinateLayout = false
    for (let i = 1; i <= pdf.numPages; i++) {
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError')
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      if (content.items?.some(it => Array.isArray(it?.transform) && it.transform.length >= 6)) {
        sawCoordinateLayout = true
      }
      const pageText = reconstructPageText(content.items, { pageNumber: i, totalPages: pdf.numPages })
      if (pageText) pages.push(pageText)
      page.cleanup?.()
    }
    return pages.join(sawCoordinateLayout ? '\n\n' : '\n').trim()
  } finally {
    try { await pdf?.destroy?.() } catch {}
    try { await loadingTask?.destroy?.() } catch {}
  }
}
