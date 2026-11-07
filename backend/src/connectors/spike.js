// Fail-closed, provider-neutral primitives for a read-only connector compatibility spike.
// No Composio dependency, OAuth keys, external network calls, routes or UI are installed.
import crypto from 'node:crypto';

const READ_ACTIONS = Object.freeze({
  calendar: new Set(['list_events']),
  drive: new Set(['read_selected_text']),
  github: new Set(['read_selected_file']),
});
const MAX_TITLE = 160;
const MAX_EXCERPT = 500;

export function authorizeRead({ userId, connectionOwnerId, toolkit, action, sourceId } = {}) {
  const actor = String(userId || '').trim();
  if (!actor || actor !== String(connectionOwnerId || '').trim()) throw Object.assign(new Error('Connection access denied'), { status: 403 });
  const permitted = READ_ACTIONS[String(toolkit || '')];
  if (!permitted || !permitted.has(String(action || ''))) throw Object.assign(new Error('Connector action not allowlisted'), { status: 403 });
  if (toolkit !== 'calendar' && !String(sourceId || '').trim()) throw new Error('Explicit selected source ID required');
  return Object.freeze({ userId: actor, toolkit, action, sourceId: String(sourceId || '') });
}

function escapedText(value, maxLength) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .slice(0, maxLength)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function normalizedRawText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').normalize('NFC');
}

// A preview is ONLY deterministic metadata and a bounded escaped source excerpt.
// Never present a generated summary as a substitute for checking the raw source.
export function buildSourcePreview({ userId, connectionOwnerId, toolkit, sourceId, revision, title, text, kind } = {}) {
  authorizeRead({
    userId, connectionOwnerId, toolkit,
    action: toolkit === 'calendar' ? 'list_events' : toolkit === 'drive' ? 'read_selected_text' : 'read_selected_file',
    sourceId,
  });
  if (!String(sourceId || '').trim()) throw new Error('A selected source is required for preview');
  if (!String(revision || '').trim()) throw new Error('A stable source revision is required');
  const raw = normalizedRawText(text);
  const contentHash = crypto.createHash('sha256').update(raw).digest('hex');
  return Object.freeze({
    ownerUserId: String(userId),
    toolkit, kind: String(kind || 'text'),
    sourceId: String(sourceId),
    revision: String(revision),
    contentHash,
    contentChars: raw.length,
    title: escapedText(title, MAX_TITLE),
    excerptEscaped: escapedText(raw, MAX_EXCERPT),
    excerptTruncated: raw.length > MAX_EXCERPT,
    generatedByAI: false,
  });
}

export function authorizeImportApproval({ userId, preview, sourceRevision, currentContentHash } = {}) {
  if (!userId || !preview || String(userId) !== String(preview.ownerUserId)) throw Object.assign(new Error('Approval owner mismatch'), { status: 403 });
  if (String(preview.revision) !== String(sourceRevision)) throw Object.assign(new Error('Source changed since preview'), { status: 409 });
  if (String(preview.contentHash) !== String(currentContentHash)) throw Object.assign(new Error('Source content changed since preview'), { status: 409 });
  return Object.freeze({ approved: true, toolkit: preview.toolkit, sourceId: preview.sourceId, revision: preview.revision, contentHash: preview.contentHash });
}
