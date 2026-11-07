import { createHash } from 'node:crypto';

// Offline, deterministic import-preview policy. NO Composio SDK, OAuth, or LLM calls.
// This is a compatibility-spike helper, not an authenticated production endpoint.
export const MAX_IMPORT_BYTES = 250 * 1024;
export const MAX_PREVIEW_CHARS = 500;
export const SUPPORTED = Object.freeze({
  googlecalendar: new Set(['text/calendar-event']),
  googledrive: new Set(['text/plain', 'application/vnd.google-apps.document']),
  github: new Set(['text/markdown']),
});
const ENCODE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const textEscape = value => String(value).replace(/[&<>"']/g, char => ENCODE[char]);

export function normalizeImportedText(value) {
  if (typeof value !== 'string') throw new TypeError('Import text must be a string');
  // Normalize platform line endings and Unicode without collapsing meaningful whitespace.
  const normalized = value.replace(/\r\n?/g, '\n').normalize('NFC');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized))
    throw new Error('Unsupported control characters in import');
  if (Buffer.byteLength(normalized, 'utf8') > MAX_IMPORT_BYTES)
    throw new Error('Import exceeds the 250 KiB compatibility-spike limit');
  if (!normalized.trim()) throw new Error('Empty import is not supported');
  return normalized;
}

function canonicalString(x, label, max = 256) {
  const value = String(x ?? '').trim();
  if (!value || value.length > max) throw new Error('Invalid ' + label);
  return value;
}

/**
 * Creates an inert preview for an already authenticated, explicitly selected source.
 * Caller MUST verify tool/action authorization and account ownership server-side.
 * Escaped strings MUST be rendered as text only (not dangerouslySetInnerHTML).
 */
export function buildImportPreview(source) {
  if (source?.selectedByUser !== true)
    throw new Error('User selection is required before import preview');
  const toolkit = canonicalString(source.toolkit, 'toolkit', 40);
  const mimeType = canonicalString(source.mimeType, 'MIME type', 110);
  if (!SUPPORTED[toolkit]?.has(mimeType))
    throw new Error('Unsupported toolkit or source type');
  const mockMateAccountId = canonicalString(source.mockMateAccountId, 'MockMate account');
  const connectedAccountId = canonicalString(source.connectedAccountId, 'connected account');
  const sourceId = canonicalString(source.sourceId, 'source ID', 512);
  const title = canonicalString(source.title, 'title', 512);
  const normalized = normalizeImportedText(source.text);
  const excerpt = Array.from(normalized).slice(0, MAX_PREVIEW_CHARS).join('');
  return {
    toolkit, mockMateAccountId, connectedAccountId, sourceId, mimeType,
    sourceAccountLabel: textEscape(String(source.sourceAccountLabel || '').slice(0, 160)),
    title: textEscape(title), lastModifiedAt: source.lastModifiedAt || null,
    revision: source.revision == null ? null : String(source.revision),
    normalizedSha256: createHash('sha256').update(normalized).digest('hex'),
    sizeBytes: Buffer.byteLength(normalized, 'utf8'),
    previewExcerpt: textEscape(excerpt),
    truncated: Array.from(normalized).length > MAX_PREVIEW_CHARS,
    selectedByUser: true,
  };
}

/** Re-fetch, compare and reject races before an approved Kit-document write. */
export function verifyApprovedImport(preview, latest, authenticatedAccountId) {
  if (!preview || preview.selectedByUser !== true)
    throw new Error('An approved preview is required');
  if (!authenticatedAccountId || authenticatedAccountId !== preview.mockMateAccountId)
    throw new Error('Authenticated account mismatch');
  const current = buildImportPreview(latest);
  for (const key of [
    'mockMateAccountId', 'connectedAccountId', 'toolkit',
    'sourceId', 'mimeType', 'revision', 'normalizedSha256',
  ]) {
    if (current[key] !== preview[key]) throw new Error('Source changed since preview: ' + key);
  }
  // No implicit side effects. The caller handles versioned storage and RAG invalidation.
  return { ...current, normalizedText: normalizeImportedText(latest.text) };
}
