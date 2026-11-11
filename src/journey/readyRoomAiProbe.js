// Ready Room must check the SAME completed streaming path used by Live.
// A successful blocking JSON hint does not prove Live streaming works.
import { stripHintMeta } from '../../shared/hintLayers.js'
import { streamLiveHint } from '../live/hintTransport.js'

function probeError(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

const DIAGNOSTIC_CODES = new Set([
  'stream_unavailable', 'stream_failed', 'unexpected_skip', 'stream_incomplete', 'empty_output',
  'no_provider', 'provider_auth', 'model_access', 'model_unavailable', 'request_invalid',
  'insufficient_quota', 'rate_limit', 'transient', 'provider_cooling', 'provider_limits',
  'provider_error', 'output_truncated', 'code_missing',
])

export function readyRoomFailureFields(error) {
  return {
    code: error?.name === 'AbortError' ? 'stream_aborted'
      : DIAGNOSTIC_CODES.has(error?.code) ? error.code : 'unknown',
    status: Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
      ? error.status : undefined,
  }
}

export async function verifyReadyRoomLiveStream({ body, signal, runStream = streamLiveHint } = {}) {
  let rawAnswer = ''
  let sawDone = false
  let sawSkip = false
  let streamFailure = null

  const result = await runStream({
    body, signal,
    isCurrent: () => !signal?.aborted,
    // A missing SSE endpoint is not a passing Live stream, even if the
    // compatibility JSON route could answer. Do not issue a second paid call.
    onFallback: () => {
      throw probeError('The Live streaming endpoint is unavailable. Check the local service and retry.', 'stream_unavailable')
    },
    onEvent: ({ event, data }) => {
      if (event === 'token' && typeof data === 'string') rawAnswer += data
      if (event === 'done') sawDone = true
      if (event === 'skip') sawSkip = true
      if (event === 'error') {
        streamFailure = probeError(
          String(data?.error || 'The Live answer stream failed.').slice(0, 300),
          data?.code || 'stream_failed',
        )
      }
    },
  })

  if (signal?.aborted || result?.mode === 'aborted') {
    const error = probeError('The Live AI test was cancelled or timed out.', 'stream_aborted')
    error.name = 'AbortError'
    throw error
  }
  if (streamFailure) throw streamFailure
  if (sawSkip) throw probeError('The Live AI service skipped a question that required an answer.', 'unexpected_skip')
  if (!sawDone || result?.mode !== 'stream') {
    throw probeError('The Live answer stream did not finish. An HTTP 200 or partial answer is not a pass.', 'stream_incomplete')
  }
  const clean = stripHintMeta(rawAnswer)
  if (clean.pending || !String(clean.prose || '').trim()) {
    throw probeError('The Live stream completed without a visible answer. Please retry with another model.', 'empty_output')
  }
  return { ok: true, completed: true }
}
