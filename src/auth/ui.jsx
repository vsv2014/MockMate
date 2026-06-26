import React from 'react'
import { T } from './tokens'

// Shared form primitives for the auth/onboarding surfaces. Inline styles + the
// scoped CSS in AuthShell (#mm-auth) handle hover/focus/placeholder states.

export const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 500, color: T.text2,
  marginBottom: 6, letterSpacing: '0.2px',
}
const inputStyle = {
  width: '100%', height: 42, padding: '0 12px', boxSizing: 'border-box',
  background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCtrl,
  color: T.text1, fontFamily: T.font, fontSize: 14, fontWeight: 400,
  outline: 'none', transition: 'border-color 0.15s',
}
export const linkStyle = {
  background: 'transparent', border: 'none', padding: 0,
  color: T.accentFrom, fontFamily: T.font, fontSize: 13, cursor: 'pointer',
}

// ── Field: label + input (+ optional password reveal) + inline error ──────────
export function Field({
  id, label, type = 'text', value, onChange, placeholder, autoFocus, autoComplete,
  inputMode, error, reveal, revealed, onToggleReveal, style,
}) {
  const invalid = !!error
  return (
    <div style={{ marginBottom: 14, ...style }}>
      <label style={labelStyle} htmlFor={id}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          id={id} type={type} value={value} onChange={onChange} placeholder={placeholder}
          autoFocus={autoFocus} autoComplete={autoComplete} inputMode={inputMode}
          aria-invalid={invalid || undefined}
          className="mm-input"
          style={{
            ...inputStyle,
            paddingRight: reveal ? 42 : 12,
            borderColor: invalid ? 'rgba(248,113,113,0.5)' : T.border,
          }}
        />
        {reveal && (
          <button
            type="button" onClick={onToggleReveal} className="mm-reveal"
            aria-label={revealed ? 'Hide password' : 'Show password'} aria-pressed={revealed}
            style={{
              position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
              width: 30, height: 30, display: 'grid', placeItems: 'center',
              background: 'transparent', border: 'none', color: T.text3, cursor: 'pointer', borderRadius: 6,
            }}
          ><EyeIcon off={!revealed} /></button>
        )}
      </div>
      {invalid && <div style={{ marginTop: 6, fontSize: 11, fontWeight: 400, color: T.danger }}>{error}</div>}
    </div>
  )
}

// ── Top-of-form error banner (e.g. failed login, server error) ────────────────
export function FormError({ children }) {
  if (!children) return null
  return (
    <div role="alert" style={{
      marginTop: 14, padding: '9px 11px', borderRadius: T.rCtrl, fontSize: 12, fontWeight: 400,
      lineHeight: 1.4, color: T.danger,
      background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)',
    }}>{children}</div>
  )
}

// ── Primary (accent-gradient) button with built-in busy state ─────────────────
export function PrimaryButton({ children, busy, busyLabel = 'Working…', disabled, type = 'submit', onClick, style }) {
  const off = disabled || busy
  return (
    <button
      type={type} onClick={onClick} disabled={off} className="mm-primary"
      style={{
        width: '100%', height: 44, border: 'none', borderRadius: T.rCtrl,
        background: T.accent, color: '#fff', fontFamily: T.font, fontSize: 14, fontWeight: 600,
        letterSpacing: '0.3px', cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.5 : 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        transition: 'transform 0.15s, box-shadow 0.15s, opacity 0.15s', ...style,
      }}
    >{busy ? <><Spinner /> {busyLabel}</> : children}</button>
  )
}

export function TextLink({ onClick, children, strong }) {
  return (
    <button type="button" onClick={onClick} className="mm-link"
      style={{ ...linkStyle, fontWeight: strong ? 500 : 400 }}>{children}</button>
  )
}

// ── Progress (e.g. "Step 1 of 2") ─────────────────────────────────────────────
export function ProgressSteps({ step, total, label }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {Array.from({ length: total }, (_, i) => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i < step ? T.accent : T.surface2,
          }} />
        ))}
      </div>
      <div style={{ fontSize: 11, fontWeight: 400, color: T.text3 }}>
        {label || `Step ${step} of ${total}`}
      </div>
    </div>
  )
}

// ── Icons (inline SVG — emoji glyphs render as empty boxes on Linux) ───────────
export function EyeIcon({ off }) {
  const p = { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
  return off
    ? <svg {...p}><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.5 18.5 0 0 0 1 12s4 8 11 8a9.12 9.12 0 0 0 5.39-1.61" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
    : <svg {...p}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>
}

export function Spinner() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ animation: 'mm-spin 0.7s linear infinite' }}>
      <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.3)" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
