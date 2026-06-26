// MockMate design-system tokens — the single source of truth for the new
// SaaS surfaces (auth, onboarding, account). Match the spec exactly; do not
// add colors, fonts, or shadows outside this file.
//
// These power the auth/onboarding screens. The legacy overlay (App.jsx, Solo,
// LiveCompanion, …) keeps its existing teal/slate inline styles untouched —
// this is additive, not a rewrite.

export const T = {
  // Surfaces
  bg: '#0c0c0c',
  surface1: '#161616',
  surface2: '#1d1d1f',

  // Borders
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.14)',

  // Text
  text1: 'rgba(255,255,255,0.92)',
  text2: 'rgba(255,255,255,0.55)',
  text3: 'rgba(255,255,255,0.30)',

  // Accent
  accent: 'linear-gradient(135deg, #7c3aed, #f97316)',
  accentFrom: '#7c3aed',
  accentTo: '#f97316',
  accentGlow: 'rgba(124,58,237,0.45)',

  // Brand wordmark / metallic text
  chrome: 'linear-gradient(180deg, #e8edf2 0%, #9aa3ad 100%)',

  // Status
  success: '#22c55e',
  danger: '#f87171',

  // Radii
  rCard: 12,
  rCtrl: 8,

  // Font
  font: "'Kanit', system-ui, -apple-system, sans-serif",
}
