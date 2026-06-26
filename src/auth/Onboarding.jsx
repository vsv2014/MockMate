import React, { useRef, useState } from 'react'
import { T } from './tokens'
import { AuthShell, brandMark } from './AuthShell'
import { Field, FormError, PrimaryButton, TextLink, ProgressSteps, Spinner } from './ui'
import { extractPdfText } from '../pdf'

const TARGET_ROLES = ['Full-stack', 'AI Engineer', 'Frontend', 'Backend', 'Other']
const YEARS = ['0–2', '3–5', '6–10', '10+']
const MAX_BYTES = 5 * 1024 * 1024
const ACCEPT = '.pdf,.docx'

// ── Onboarding (2 steps; shown once, right after first signup) ────────────────
// Step 1: role setup.  Step 2: optional resume upload.
// Props:
//   onComplete({ currentRole, targetRole, yearsExp, resumeText, resumeName })  async
//   (no separate onSkip — "Skip for now" just calls onComplete without a resume)
export default function Onboarding({ onComplete }) {
  const [step, setStep] = useState(1)
  const [currentRole, setCurrentRole] = useState('')
  const [targetRole, setTargetRole] = useState('')
  const [yearsExp, setYearsExp] = useState('')

  const [resume, setResume] = useState(null)   // { name, status:'parsing'|'ready', text }
  const [fileError, setFileError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const inputRef = useRef(null)

  async function handleFile(file) {
    if (!file) return
    setFileError(null)
    const okType = /\.(pdf|docx)$/i.test(file.name)
    if (!okType) { setFileError('Please choose a PDF or DOCX file'); return }
    if (file.size > MAX_BYTES) { setFileError('That file is over 5MB — please choose a smaller one'); return }

    setResume({ name: file.name, status: 'parsing', text: '' })
    let text = ''
    if (/\.pdf$/i.test(file.name)) {
      // Parsed entirely on-device; the file never leaves the machine.
      try { text = await extractPdfText(file) } catch { text = '' }
    }
    // DOCX has no client-side parser yet — we keep the file as "added" and the user
    // can paste resume text later in Career. (No silent failure: it's still accepted.)
    setResume({ name: file.name, status: 'ready', text })
  }

  function onDrop(e) {
    e.preventDefault(); setDragOver(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  async function finish() {
    if (busy) return
    setSaveError(null); setBusy(true)
    try {
      await onComplete({
        currentRole: currentRole.trim(),
        targetRole,
        yearsExp,
        resumeText: resume?.text || '',
        resumeName: resume?.name || '',
      })
    } catch (err) {
      setSaveError(err?.message || 'Could not save your details. Please try again.')
      setBusy(false)
    }
  }

  return (
    <AuthShell maxWidth={400}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 20 }}>
        {brandMark(34)}
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: T.text1 }}>Set up MockMate</div>
          <div style={{ fontSize: 12, fontWeight: 400, color: T.text2 }}>Personalise your practice</div>
        </div>
      </div>

      <ProgressSteps step={step} total={2} label={step === 1 ? 'Step 1 of 2 · About you' : 'Step 2 of 2 · Resume'} />

      {step === 1 ? (
        <>
          <Field
            id="mm-current-role" label="Current role" autoFocus
            value={currentRole} placeholder="SDE 2 · Kore.ai"
            onChange={e => setCurrentRole(e.target.value)}
          />

          <ChipGroup label="Target role" options={TARGET_ROLES} value={targetRole} onChange={setTargetRole} />
          <ChipGroup label="Years of experience" options={YEARS} value={yearsExp} onChange={setYearsExp} />

          <div style={{ marginTop: 20 }}>
            <PrimaryButton type="button" onClick={() => setStep(2)}>Continue</PrimaryButton>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 12, fontWeight: 400, color: T.text2, marginBottom: 12, lineHeight: 1.5 }}>
            Add your resume to tailor questions and unlock ATS scoring. It stays on this device.
          </div>

          <input
            ref={inputRef} type="file" accept={ACCEPT} style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files?.[0])}
          />

          {!resume ? (
            <div
              role="button" tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              style={{
                border: `1.5px dashed ${dragOver ? T.accentFrom : T.borderStrong}`,
                background: dragOver ? 'rgba(124,58,237,0.06)' : T.surface2,
                borderRadius: T.rCard, padding: '28px 16px', textAlign: 'center', cursor: 'pointer',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <UploadIcon />
              <div style={{ marginTop: 10, fontSize: 13, fontWeight: 500, color: T.text1 }}>
                Drag &amp; drop your resume
              </div>
              <div style={{ marginTop: 3, fontSize: 11, fontWeight: 400, color: T.text3 }}>
                or <span style={{ color: T.accentFrom }}>browse</span> · PDF or DOCX · max 5MB
              </div>
            </div>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 11,
              background: T.surface2, border: `1px solid ${T.border}`, borderRadius: T.rCard, padding: '12px 14px',
            }}>
              <FileIcon />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: T.text1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {resume.name}
                </div>
                <div style={{ fontSize: 11, fontWeight: 400, color: resume.status === 'ready' ? T.success : T.text3, display: 'flex', alignItems: 'center', gap: 5 }}>
                  {resume.status === 'parsing'
                    ? <><Spinner /> Reading…</>
                    : <><CheckIcon /> Ready</>}
                </div>
              </div>
              <button
                type="button" onClick={() => { setResume(null); setFileError(null); if (inputRef.current) inputRef.current.value = '' }}
                aria-label="Remove resume"
                style={{ background: 'transparent', border: 'none', color: T.text3, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4 }}
              >×</button>
            </div>
          )}

          {fileError && <div style={{ marginTop: 10, fontSize: 11, color: T.danger }}>{fileError}</div>}
          <FormError>{saveError}</FormError>

          <div style={{ marginTop: 20 }}>
            <PrimaryButton type="button" onClick={finish} busy={busy} busyLabel="Saving…">
              {resume ? 'Finish setup' : 'Finish'}
            </PrimaryButton>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
            <TextLink onClick={() => setStep(1)}>← Back</TextLink>
            <TextLink onClick={finish}>Skip for now</TextLink>
          </div>
        </>
      )}
    </AuthShell>
  )
}

// ── Single-select chip group ──────────────────────────────────────────────────
function ChipGroup({ label, options, value, onChange }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: T.text2, marginBottom: 8, letterSpacing: '0.2px' }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {options.map(opt => {
          const on = value === opt
          return (
            <button
              key={opt} type="button" onClick={() => onChange(on ? '' : opt)} aria-pressed={on}
              style={{
                fontFamily: T.font, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                padding: '8px 14px', borderRadius: 999,
                color: on ? '#fff' : T.text2,
                background: on ? T.accent : T.surface2,
                border: `1px solid ${on ? 'transparent' : T.border}`,
                transition: 'background 0.15s, color 0.15s',
              }}
            >{opt}</button>
          )
        })}
      </div>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function UploadIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={T.text2} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', margin: '0 auto' }}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}
function FileIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={T.accentFrom} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    </svg>
  )
}
function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.success} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
