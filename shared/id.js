/**
 * Shared compact ID generator for interview sessions, questions, generations, and transcript fragments.
 */
export function nid(prefix = 'id', randLen = 6) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 2 + randLen)}`
}

export function createSessionId(prefix = 's') {
  return nid(prefix, 6)
}
