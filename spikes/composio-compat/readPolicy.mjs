// Offline permission contract for a future authenticated connector gateway.
// No OAuth, Composio SDK, external tool requests or side effects.
const ACTIONS = Object.freeze({
  googlecalendar: new Set(['list_events']),
  googledrive: new Set(['get_selected_document']),
  github: new Set(['get_selected_markdown']),
});

export function authorizeSelectedRead({
  authenticatedUserId, connectionOwnerId, toolkit, action, sourceId,
  selectedByUser,
} = {}) {
  // authenticatedUserId MUST be injected from verified backend auth. The caller
  // must not trust a renderer-supplied identity or connected-account ID.
  if (!authenticatedUserId || authenticatedUserId !== connectionOwnerId)
    throw Object.assign(new Error('Connected account access denied'), { status: 403 });
  if (selectedByUser !== true)
    throw Object.assign(new Error('Explicit source selection required'), { status: 403 });
  if (!ACTIONS[toolkit]?.has(action))
    throw Object.assign(new Error('Tool action not allowlisted'), { status: 403 });
  if (!String(sourceId || '').trim())
    throw new Error('A selected source ID is required');
  return Object.freeze({ toolkit, action, sourceId: String(sourceId), ownerId: authenticatedUserId });
}
