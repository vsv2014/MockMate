// Single source of truth for the candidate profile stored in localStorage. Was
// copy-pasted (and had drifted) across Solo / Jobs / LiveCompanion. Shape (all optional):
// { name, targetRole, targetCompany, resume, jobDescription, language, codingLanguage,
//   location, customPrompt }
export const PROFILE_KEY = 'peerMockProfile'

export function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {} } catch { return {} }
}

export function saveProfile(p) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)) } catch {}
}
