// Shared UI helpers — were duplicated (and inconsistent) across Report / Jobs / App.

// One score→color scale so a given score looks the same everywhere (previously three
// different thresholds: 75/50, 80/60/45, 75/50). Hex so it works in the dark overlay.
export function scoreColor(p) {
  if (p == null) return '#64748b'
  if (p >= 75) return '#22c55e'   // strong
  if (p >= 50) return '#fbbf24'   // mixed
  return '#f87171'                // weak
}

// Question/content type → label. Single source for the badges in LiveCompanion + the
// screen-analysis panel in App (they previously kept two drifted copies; the PiP window
// has its own inlined copy since it runs in a separate document).
export const TYPE_LABEL = {
  behavioral: '🧩 Behavioral', technical: '⚙️ Technical', system_design: '🏗️ System Design',
  resume: '📄 Resume', culture: '🤝 Culture', dsa: '⚡ DSA', coding: '💻 Coding',
  slide: '📊 Slide', other: '💬 General'
}

// m:ss timer (was duplicated in Solo + LiveCompanion).
export function fmtClock(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
