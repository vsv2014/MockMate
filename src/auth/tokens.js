// MockMate design-system tokens — the single source of truth for every surface.
// Desktop v1.5 visual pass: keep the dark, focused character without collapsing
// large empty areas into pure black. Surfaces are intentionally close in value so
// the UI reads as one calm workspace instead of stacked boxes.

export const T = {
  // Surfaces
  bg: '#0B0D12',
  surface1: '#12151B',
  surface2: '#181B22',

  // Borders
  border: 'rgba(255,255,255,0.075)',
  borderStrong: 'rgba(255,255,255,0.13)',

  // Text
  text1: '#EEF0F3',
  text2: '#9A9FA9',
  text3: '#737985',

  // Accent — teal primary + emerald (MockMate's original feel)
  accent: 'linear-gradient(135deg, #14B8A6, #10B981)',
  accentFrom: '#14B8A6',
  accentTo: '#10B981',
  accentGlow: 'rgba(20,184,166,0.36)',

  // Brand wordmark / metallic text
  chrome: 'linear-gradient(180deg, #F1F4F7 0%, #A7AFB9 100%)',

  // Status
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#F43F5E',

  // Radii
  rCard: 16,
  rCtrl: 12,

  // Font
  font: "'Kanit', system-ui, -apple-system, sans-serif",
}
