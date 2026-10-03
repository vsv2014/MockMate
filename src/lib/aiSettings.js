// Account-scoped AI answer preferences shared by Settings, Live and screenshot analysis.
import { getScopedItem, setScopedItem } from './accountScope'

const get = (k, d) => getScopedItem(k, d)
const set = (k, v) => setScopedItem(k, v)

export const ANSWER_STYLE_KEY = 'mm-answer-style'
export const ANSWER_STYLE_DEFAULT = 'concise'
export const getAnswerStyle = () => {
  const v = get(ANSWER_STYLE_KEY, ANSWER_STYLE_DEFAULT)
  return (v === 'balanced' || v === 'concise' || v === 'detailed') ? v : ANSWER_STYLE_DEFAULT
}
export const setAnswerStyle = v => {
  if (v === 'balanced' || v === 'concise' || v === 'detailed') set(ANSWER_STYLE_KEY, v)
}

export const getScreenshotSpeed = () => get('mm-screenshot-speed', 'quality')
export const setScreenshotSpeed = v => set('mm-screenshot-speed', v)
export const screenshotStyle = () => (getScreenshotSpeed() === 'fast' ? 'concise' : 'balanced')

export const getAutoSkip = () => get('mm-auto-skip', 'on') !== 'off'
export const setAutoSkip = on => set('mm-auto-skip', on ? 'on' : 'off')

export const getDocThreshold = () => { const n = parseFloat(get('mm-doc-threshold', '0.2')); return isNaN(n) ? 0.2 : Math.min(0.6, Math.max(0, n)) }
export const setDocThreshold = v => set('mm-doc-threshold', String(v))
