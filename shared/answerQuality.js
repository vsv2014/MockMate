// Structural output checks only: these do not prove algorithmic correctness.
export function requiresImplementation(question = '', classification = {}, mode = 'answer') {
  if (mode === 'coach') return false
  const q = String(question).trim()
  if (/\b(?:no code|without code|explain only|approach only|pseudocode only|only pseudocode)\b/i.test(q)) return false
  const type = classification.isFollowUp ? classification.parentType : classification.questionType
  const coding = ['dsa','coding','screen_code'].includes(type)
  const explicit = /\b(?:write|show|give|provide|paste|implement|run|execute|test)\b.{0,100}\b(?:code|function|snippet|implementation|solution|console|print)\b/i.test(q)
    || /^(?:code(?: it)?|implement(?: it)?|solve it|show the snippet|write console(?:\.log)?)[.!?\s]*$/i.test(q)
  if (explicit) return true
  return coding && !classification.isFollowUp && !/^(?:what|why|explain|define|compare)\b/i.test(q)
}
export function implementationIssue(text = '', required = false) {
  if (!required) return null
  const value = String(text)
  const fences = value.match(/^\s*```/gm) || []
  if (!fences.length) return 'code_missing'
  if (fences.length % 2) return 'code_unfinished'
  const blocks = [...value.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
  if (!blocks.some(match => match[1].trim())) return 'code_missing'
  return null
}
export function showFullCodeDuringStream(text = '') { return /^\s*```/m.test(String(text)) }
