// Shared design tokens — Dark Obsidian & Teal-Emerald Glass system.
// Pairs geometric display headings (Kanit) with high-legibility UI/teleprompter sans
// (Inter / Segoe UI Variable Text) and developer monospace (Cascadia Code / JetBrains Mono).
export const T = {
  bg:           '#0B0D12',
  surface1:     '#12151B',
  surface2:     '#181B22',
  border:       'rgba(255,255,255,0.07)',
  borderStrong: 'rgba(255,255,255,0.13)',
  text1:        '#F3F5F8',
  text2:        '#A6B0C0',
  text3:        '#8690A2', // WCAG AA lifted (~4.85:1 on surface1) for 10-12px hints
  accent:       'linear-gradient(135deg, #14B8A6 0%, #10B981 100%)',
  accentFrom:   '#14B8A6',
  accentTo:     '#10B981',
  accentSoft:   'rgba(20,184,166,0.14)',
  accentBorder: 'rgba(20,184,166,0.38)',
  answerBg:           'rgba(13, 22, 29, 0.96)',
  answerBorder:       'rgba(20, 184, 166, 0.34)',
  resumeAnswerBg:     'rgba(7, 29, 20, 0.96)',
  resumeAnswerBorder: 'rgba(34, 197, 94, 0.34)',
  danger:       '#F43F5E',
  warn:         '#F59E0B',
  warning:      '#F59E0B',
  success:      '#10B981',
  rCard:        14,
  rCtrl:        10,
  cardShadow:    'inset 0 1px 0 0 rgba(255,255,255,0.07), 0 8px 24px -6px rgba(0,0,0,0.42)',
  overlayShadow: '0 20px 50px rgba(0,0,0,0.75), 0 0 0 1px rgba(0,0,0,0.85), inset 0 1px 0 0 rgba(255,255,255,0.14)',
  font:         "'Inter', 'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
  fontDisplay:  "'Kanit', 'Segoe UI Variable Display', system-ui, -apple-system, sans-serif",
  fontMono:     "'Cascadia Code', 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace",
}
