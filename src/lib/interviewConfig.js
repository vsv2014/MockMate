/**
 * Thin interview-session snapshot (Live / Solo). Domains stay separate — Jobs/Career only seed
 * into profile; this object freezes what THIS run may use for RAG + packing inputs.
 */
import { CUSTOM_INSTRUCTIONS_PACK_MAX, CUSTOM_INSTRUCTIONS_STORE_MAX } from '../../shared/interviewConfig.js'

export { CUSTOM_INSTRUCTIONS_PACK_MAX, CUSTOM_INSTRUCTIONS_STORE_MAX }

export function buildInterviewConfig({
  profile = {},
  selectedDocumentIds = [],
  source = 'live',
} = {}) {
  const ids = Array.isArray(selectedDocumentIds)
    ? [...new Set(selectedDocumentIds.map(String).filter(Boolean))]
    : []
  return {
    source: source === 'solo' ? 'solo' : 'live',
    candidateName: String(profile.name || '').trim(),
    targetRole: String(profile.targetRole || '').trim(),
    targetCompany: String(profile.targetCompany || '').trim(),
    resumeText: String(profile.resume || ''),
    jobDescriptionText: String(profile.jobDescription || ''),
    selectedDocumentIds: ids,
    customInstructions: String(profile.customPrompt || '').slice(0, CUSTOM_INSTRUCTIONS_STORE_MAX),
    createdAt: new Date().toISOString(),
  }
}
