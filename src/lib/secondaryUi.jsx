import { readableTextSize } from './typography.js'
import React, { useRef, useState } from 'react'
import { T } from '../auth/tokens'
import { extractPdfText, MAX_LOCAL_PDF_BYTES } from '../pdf'
import { copyText } from './clipboard'

// Shared visual language for Jobs + Resume Studio (secondary product surfaces).
// Matches Solo/Home tokens — no new capabilities, styling + materials only.

export const YEARS = ['Student / New grad', '1–3 years', '4–6 years', '7+ years']

export const S = {
  font: T.font,
  lbl: { display: 'block', fontSize: readableTextSize(11.5), color: T.text2, fontWeight: 500, marginBottom: 6, fontFamily: T.font },
  input: {
    width: '100%', background: T.surface2, border: `1px solid ${T.border}`, borderRadius: T.rCtrl,
    padding: '10px 12px', color: T.text1, fontSize: readableTextSize(13), marginBottom: 12, boxSizing: 'border-box',
    fontFamily: T.font,
  },
  btnPrimary: {
    width: '100%', height: 44, background: T.accent, color: '#fff', border: 'none', borderRadius: T.rCtrl,
    fontSize: readableTextSize(14), fontWeight: 600, cursor: 'pointer', fontFamily: T.font,
  },
  btnGhost: {
    background: 'transparent', color: T.text2, border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl,
    padding: '6px 12px', fontSize: readableTextSize(12.5), cursor: 'pointer', fontFamily: T.font,
  },
  btnSecondary: {
    background: T.surface2, color: T.text1, border: `1px solid ${T.border}`, borderRadius: T.rCtrl,
    padding: '8px 12px', fontSize: readableTextSize(12.5), fontWeight: 600, cursor: 'pointer', fontFamily: T.font,
  },
  note: {
    fontSize: readableTextSize(12.5), color: T.text2, background: T.surface1, border: `1px solid ${T.border}`,
    borderRadius: T.rCtrl, padding: '10px 12px', margin: '0 0 12px', lineHeight: 1.5, fontFamily: T.font,
  },
  card: {
    background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard,
    boxShadow: T.cardShadow, padding: '14px 16px', marginBottom: 10, fontFamily: T.font,
  },
  sectionLbl: {
    fontSize: readableTextSize(11), color: T.text3, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
    marginBottom: 8, fontFamily: T.font,
  },
  chip: {
    fontSize: readableTextSize(11), color: T.accentFrom, background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.25)',
    padding: '3px 9px', borderRadius: 999, display: 'inline-block', fontFamily: T.font,
  },
  panel: {
    background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard,
    boxShadow: T.cardShadow, padding: '14px 16px', marginBottom: 14, fontFamily: T.font,
  },
}

export function tabStyle(on) {
  return {
    flex: 1, fontSize: readableTextSize(12.5), fontWeight: on ? 600 : 500, padding: '9px 8px', borderRadius: T.rCtrl,
    cursor: 'pointer', border: `1px solid ${on ? 'rgba(20,184,166,0.45)' : T.border}`,
    background: on ? 'rgba(20,184,166,0.16)' : 'transparent',
    color: on ? T.text1 : T.text2, fontFamily: T.font,
  }
}

export function NoKeysBanner({ onSettings, what, allowContinue }) {
  return (
    <div role="status" style={{ ...S.note, borderColor: 'rgba(20,184,166,0.35)', background: 'rgba(20,184,166,0.1)', color: '#5eead4' }}>
      <div style={{ marginBottom: 8 }}>
        <strong>No AI key yet.</strong>{' '}
        {what}
        {allowContinue ? ' Matching still works with basic keyword ranking.' : ''}
      </div>
      {onSettings && (
        <button type="button" onClick={onSettings}
          style={{ ...S.btnPrimary, width: 'auto', height: 34, padding: '0 14px', fontSize: readableTextSize(12.5) }}>
          Open Settings
        </button>
      )}
    </div>
  )
}

export function YearsChips({ value, onChange }) {
  return (
    <div role="group" aria-label="Experience level" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
      {YEARS.map(y => {
        const on = value === y
        return (
          <button key={y} type="button" aria-pressed={on} onClick={() => onChange(on ? '' : y)}
            style={{
              padding: '7px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: T.font, fontSize: readableTextSize(12.5),
              fontWeight: on ? 600 : 400, color: on ? '#fff' : T.text2,
              background: on ? T.accent : T.surface2, border: `1px solid ${on ? 'transparent' : T.border}`,
            }}>
            {y}
          </button>
        )
      })}
    </div>
  )
}

/** Resume paste + PDF — writes into shared profile via onPatch({ resume }). */
export function ResumeMaterials({ resume, onPatch }) {
  const [pdfMsg, setPdfMsg] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const fileRef = useRef(null)
  const pdfError = /No text|Could not|too large/i.test(pdfMsg)
  return (
    <div>
      <label htmlFor="resume-materials-text" style={S.lbl}>Resume</label>
      <textarea
        id="resume-materials-text" rows={5}
        style={{ ...S.input, resize: 'vertical', marginBottom: 8 }}
        value={resume || ''}
        placeholder="Paste your resume text…"
        onChange={e => onPatch({ resume: e.target.value })}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={pdfBusy}
          aria-label="Upload a PDF resume" style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: readableTextSize(11.5), color: T.accentFrom,
            cursor: pdfBusy ? 'default' : 'pointer', background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.3)',
            borderRadius: 8, padding: '5px 10px', fontFamily: T.font, fontWeight: 500, opacity: pdfBusy ? 0.6 : 1,
          }}>
          {pdfBusy ? 'Reading PDF…' : 'Upload PDF'}
        </button>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} aria-label="Choose a PDF resume"
          onChange={async e => {
            const file = e.target.files?.[0]; e.target.value = ''
            if (!file) return
            if (Number(file.size || 0) > MAX_LOCAL_PDF_BYTES) {
              setPdfMsg(`PDF is too large. Choose a file under ${Math.round(MAX_LOCAL_PDF_BYTES / 1024 / 1024)} MB.`)
              return
            }
            setPdfBusy(true); setPdfMsg('Reading PDF…')
            try {
              const text = await extractPdfText(file, { maxBytes: MAX_LOCAL_PDF_BYTES })
              if (text && text.length > 20) {
                onPatch({ resume: text })
                setPdfMsg(`Loaded ${text.length.toLocaleString()} characters`)
              } else setPdfMsg('No text found (scanned image?) — paste instead')
            } catch { setPdfMsg('Could not read that PDF — paste the text instead') }
            finally { setPdfBusy(false) }
          }} />
        {pdfMsg && (
          <span role={pdfError ? 'alert' : 'status'} aria-live={pdfError ? 'assertive' : 'polite'} style={{ fontSize: readableTextSize(11.5), color: pdfError ? '#fca5a5' : T.success }}>
            {pdfMsg}
          </span>
        )}
      </div>
    </div>
  )
}

export function CopyBtn({ text, label = 'Copy', variant = 'chip' }) {
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!text) return null
  const handleClick = async () => {
    const ok = await copyText(text)
    if (ok) { setDone(true); setFailed(false); setTimeout(() => setDone(false), 1500) }
    else { setFailed(true); setTimeout(() => setFailed(false), 2000) }
  }
  if (variant === 'button') {
    return (
      <button type="button" onClick={handleClick}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 13px', background: done ? 'rgba(34,197,94,0.16)' : T.surface2, color: failed ? '#fca5a5' : (done ? T.success : T.text2), border: `1px solid ${T.border}`, borderRadius: T.rCtrl, fontSize: readableTextSize(12), fontWeight: 500, cursor: 'pointer', fontFamily: T.font }}>
        {failed ? 'Copy failed' : done ? '✓ Copied' : `📋 ${label}`}
      </button>
    )
  }
  return (
    <button type="button" onClick={handleClick}
      style={{ ...S.chip, cursor: 'pointer', border: 'none', color: failed ? '#fca5a5' : (done ? T.success : T.accentFrom), fontFamily: T.font }}>
      {failed ? 'Copy failed' : done ? 'Copied' : label}
    </button>
  )
}

