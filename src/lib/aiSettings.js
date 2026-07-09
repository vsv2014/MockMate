// Global AI answer preferences (localStorage-backed, no server round-trip). Shared by the Settings
// panel, Live hints, and screenshot analysis — one source of truth for the LockedIn-style controls.
const get = (k, d) => { try { return localStorage.getItem(k) || d } catch { return d } }
const set = (k, v) => { try { localStorage.setItem(k, v) } catch {} }

// Response length → maps to the engine `style` param (balanced | concise | detailed).
// NOTE: the Live overlay's inline pill uses this same key, so the two stay in sync.
export const ANSWER_STYLE_KEY = 'mm-answer-style'
export const getAnswerStyle = () => get(ANSWER_STYLE_KEY, 'balanced')
export const setAnswerStyle = v => set(ANSWER_STYLE_KEY, v)

// Screenshot replies: 'quality' (full depth) or 'fast' (concise, answer-first). Maps to analyzeScreen `style`.
export const getScreenshotSpeed = () => get('mm-screenshot-speed', 'quality')
export const setScreenshotSpeed = v => set('mm-screenshot-speed', v)
// Convenience: the `style` value to send with a screenshot analysis request.
export const screenshotStyle = () => (getScreenshotSpeed() === 'fast' ? 'concise' : 'balanced')

// Auto-skip noise: when ON (default), the engine stays silent on background chatter / non-questions
// ([SKIP]); when OFF, it answers every input. Sent to the hint engine as `autoSkip`.
export const getAutoSkip = () => get('mm-auto-skip', 'on') !== 'off'
export const setAutoSkip = on => set('mm-auto-skip', on ? 'on' : 'off')

// Document relevance threshold (RAG) — min cosine score for a chunk to be injected. Higher = stricter
// (fewer, more-relevant chunks). Matches the competitor's "filter document" knob. Default 0.20.
export const getDocThreshold = () => { const n = parseFloat(get('mm-doc-threshold', '0.2')); return isNaN(n) ? 0.2 : Math.min(0.6, Math.max(0, n)) }
export const setDocThreshold = v => set('mm-doc-threshold', String(v))
