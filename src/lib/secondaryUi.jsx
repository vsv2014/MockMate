import React, { useState } from 'react'
import { T } from '../auth/tokens'
import { extractPdfText } from '../pdf'

// Shared visual language for Jobs + Resume Studio (secondary product surfaces).
// Matches Solo/Home tokens — no new capabilities, styling + materials only.

export const YEARS = ['Student / New grad', '1–3 years', '4–6 years', '7+ years']

export const S = {
  font: T.font,
  lbl: { display: 'block', fontSize: 11.5, color: T.text2, fontWeight: 500, marginBottom: 6, fontFamily: T.font },
  input: {
    width: '100%', background: T.surface2, border: `1px solid ${T.border}`, borderRadius: T.rCtrl,
    padding: '10px 12px', color: T.text1, fontSize: 13, marginBottom: 12, boxSizing: 'border-box',
    outline: 'none', fontFamily: T.font,
  },
  btnPrimary: {
    width: '100%', height: 44, background: T.accent, color: '#fff', border: 'none', borderRadius: T.rCtrl,
    fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: T.font,
  },
  btnGhost: {
    background: 'transparent', color: T.text2, border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl,
    padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', fontFamily: T.font,
  },
  btnSecondary: {
    background: T.surface2, color: T.text1, border: `1px solid ${T.border}`, borderRadius: T.rCtrl,
    padding: '8px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: T.font,
  },
  note: {
    fontSize: 12.5, color: T.text2, background: T.surface1, border: `1px solid ${T.border}`,
    borderRadius: T.rCtrl, padding: '10px 12px', margin: '0 0 12px', lineHeight: 1.5, fontFamily: T.font,
  },
  card: {
    background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard,
    padding: '14px 16px', marginBottom: 10, fontFamily: T.font,
  },
  sectionLbl: {
    fontSize: 11, color: T.text3, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
    marginBottom: 8, fontFamily: T.font,
  },
  chip: {
    fontSize: 11, color: T.accentFrom, background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.25)',
    padding: '3px 9px', borderRadius: 999, display: 'inline-block', fontFamily: T.font,
  },
  panel: {
    background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard,
    padding: '14px 16px', marginBottom: 14, fontFamily: T.font,
  },
}

export function tabStyle(on) {
  return {
    flex: 1, fontSize: 12.5, fontWeight: on ? 600 : 500, padding: '9px 8px', borderRadius: T.rCtrl,
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
          style={{ ...S.btnPrimary, width: 'auto', height: 34, padding: '0 14px', fontSize: 12.5 }}>
          Open Settings
        </button>
      )}
    </div>
  )
}

export function YearsChips({ value, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
      {YEARS.map(y => {
        const on = value === y
        return (
          <button key={y} type="button" aria-pressed={on} onClick={() => onChange(on ? '' : y)}
            style={{
              padding: '7px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: T.font, fontSize: 12.5,
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
  return (
    <div>
      <label style={S.lbl}>Resume</label>
      <textarea
        rows={5}
        style={{ ...S.input, resize: 'vertical', marginBottom: 8 }}
        value={resume || ''}
        placeholder="Paste your resume text…"
        onChange={e => onPatch({ resume: e.target.value })}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: T.accentFrom,
          cursor: 'pointer', background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.3)',
          borderRadius: 8, padding: '5px 10px', fontFamily: T.font, fontWeight: 500,
        }}>
          Upload PDF
          <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }}
            onChange={async e => {
              const file = e.target.files?.[0]; e.target.value = ''
              if (!file) return
              setPdfMsg('Reading PDF…')
              try {
                const text = await extractPdfText(file)
                if (text && text.length > 20) {
                  onPatch({ resume: text })
                  setPdfMsg(`Loaded ${text.length.toLocaleString()} characters`)
                } else setPdfMsg('No text found (scanned image?) — paste instead')
              } catch { setPdfMsg('Could not read that PDF — paste the text instead') }
            }} />
        </label>
        {pdfMsg && (
          <span role="status" style={{ fontSize: 11.5, color: /No text|Could not|scanned/i.test(pdfMsg) ? '#fca5a5' : T.success }}>
            {pdfMsg}
          </span>
        )}
      </div>
    </div>
  )
}
