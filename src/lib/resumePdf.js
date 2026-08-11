/**
 * Client-side tailored resume PDF — single-column, ATS-ish layout (1–2 pages).
 * Uses the same applyTailorToResume text the user already sees (no invented content).
 */
import { jsPDF } from 'jspdf'
import { applyTailorToResume } from './profile.js'

const MARGIN = 14 // mm
const PAGE_W = 210
const PAGE_H = 297
const MAX_W = PAGE_W - MARGIN * 2

function wrapLines(doc, text, fontSize, maxWidth) {
  doc.setFontSize(fontSize)
  const raw = String(text || '').replace(/\r\n/g, '\n').split('\n')
  const out = []
  for (const line of raw) {
    const t = line.trimEnd()
    if (!t.trim()) { out.push(''); continue }
    const parts = doc.splitTextToSize(t, maxWidth)
    out.push(...parts)
  }
  return out
}

function looksLikeHeading(line) {
  const t = String(line || '').trim()
  if (!t || t.length > 48) return false
  if (/^[-•*]/.test(t) || /^\d+\./.test(t)) return false
  // ALL CAPS short line, or known section labels
  if (/^[A-Z][A-Z0-9 /&-]{2,}$/.test(t)) return true
  return /^(summary|experience|education|skills|projects|work experience|professional summary|technical skills)\b/i.test(t)
}

/**
 * @returns {{ blob: Blob, filename: string, pages: number }}
 */
export function buildTailoredResumePdf({ resume = '', tailor = null, targetRole = '' } = {}) {
  const body = applyTailorToResume(resume, tailor || {})
  if (!String(body).trim()) {
    const e = new Error('Nothing to export — add a resume first.')
    e.code = 'EMPTY_RESUME'
    throw e
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  doc.setProperties({
    title: targetRole ? `Resume — ${targetRole}` : 'Resume',
    creator: 'MockMate',
  })

  let y = MARGIN
  const lineH = 4.6
  const lines = wrapLines(doc, body, 10, MAX_W)

  for (const line of lines) {
    if (y > PAGE_H - MARGIN) {
      doc.addPage()
      y = MARGIN
    }
    if (!line.trim()) {
      y += lineH * 0.55
      continue
    }
    if (looksLikeHeading(line)) {
      y += 1.5
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(20, 20, 20)
      doc.text(line.trim().toUpperCase(), MARGIN, y)
      y += 1.2
      doc.setDrawColor(30, 30, 30)
      doc.setLineWidth(0.25)
      doc.line(MARGIN, y, PAGE_W - MARGIN, y)
      y += lineH
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      continue
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(25, 25, 25)
    // Bullets: keep readable indent
    const bullet = /^[-•*]\s+/.test(line.trim())
    const x = bullet ? MARGIN + 2 : MARGIN
    const text = bullet ? `• ${line.trim().replace(/^[-•*]\s+/, '')}` : line
    doc.text(text, x, y)
    y += lineH
  }

  const pages = doc.getNumberOfPages()
  // Soft cap note if very long — still export (user's content)
  const role = String(targetRole || 'resume').replace(/[^\w\-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'resume'
  const filename = `mockmate-${role}.pdf`
  const blob = doc.output('blob')
  return { blob, filename, pages }
}

export function downloadTailoredResumePdf(opts) {
  const { blob, filename, pages } = buildTailoredResumePdf(opts)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return { filename, pages }
}
