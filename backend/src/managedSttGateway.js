// Trusted streaming STT gateway (Node 24 / Express backend).
//
// The browser is NEVER handed the managed Deepgram project key or grant. Each
// WebSocket uses a one-time HTTP-issued ticket, an atomic server-side quota
// reservation, and a bounded 300s/9.6MB capture window. The backend proxies
// only Deepgram transcription messages, not arbitrary URLs.
//
// No npm WebSocket server dependency: Node 24 supplies the upstream WebSocket
// client; this file implements the narrowly scoped RFC 6455 server framing,
// including masking, fragmentation, ping/close, frame caps and backpressure.
import crypto from 'node:crypto'
import { store, currentPeriod } from './store.js'
import { effectivePlan, limitFor } from './plans.js'

export const STT_LEASE_SECONDS = 300
export const STT_PCM_BYTES_PER_SECOND = 32_000
const MAX_PCM_BYTES = STT_LEASE_SECONDS * STT_PCM_BYTES_PER_SECOND
const MAX_FRAME = 1024 * 1024
const MAX_PENDING_AUDIO = 512 * 1024
const MAX_BACKPRESSURE = 1024 * 1024
const TICKET_TTL_MS = 30_000
const MAX_TICKETS = 2048
const MAX_OPEN_STREAMS_PER_USER = 2
const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const PROTOCOL = 'mockmate-stt'

export function makeServerFrame(opcode, payload = Buffer.alloc(0)) {
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  const len = bytes.length
  const headerSize = len < 126 ? 2 : len < 65536 ? 4 : 10
  const frame = Buffer.allocUnsafe(headerSize + len)
  frame[0] = 0x80 | opcode
  if (len < 126) frame[1] = len
  else if (len < 65536) { frame[1] = 126; frame.writeUInt16BE(len, 2) }
  else { frame[1] = 127; frame.writeBigUInt64BE(BigInt(len), 2) }
  bytes.copy(frame, headerSize)
  return frame
}

export class ClientFrameReader {
  constructor(onMessage) {
    this.onMessage = onMessage
    this.buffer = Buffer.alloc(0)
    this.parts = []
    this.partsSize = 0
    this.partialOpcode = null
  }

  push(chunk) {
    if (chunk.length + this.buffer.length > MAX_FRAME + 32) throw new Error('websocket frame too large')
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0], b1 = this.buffer[1]
      if (b0 & 0x70) throw new Error('unsupported websocket extension')
      const fin = Boolean(b0 & 0x80)
      const opcode = b0 & 0x0f
      const masked = Boolean(b1 & 0x80)
      if (!masked) throw new Error('client websocket frames must be masked')
      if (![0, 1, 2, 8, 9, 10].includes(opcode)) throw new Error('invalid websocket opcode')
      let len = b1 & 0x7f, pos = 2
      if (len === 126) {
        if (this.buffer.length < 4) break
        len = this.buffer.readUInt16BE(2); pos = 4
      } else if (len === 127) {
        if (this.buffer.length < 10) break
        const big = this.buffer.readBigUInt64BE(2)
        if (big > BigInt(MAX_FRAME)) throw new Error('websocket frame too large')
        len = Number(big); pos = 10
      }
      if (len > MAX_FRAME) throw new Error('websocket frame too large')
      if (opcode >= 8 && (!fin || len > 125)) throw new Error('invalid websocket control frame')
      if (this.buffer.length < pos + 4 + len) break
      const mask = this.buffer.subarray(pos, pos + 4)
      pos += 4
      const payload = Buffer.from(this.buffer.subarray(pos, pos + len))
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]
      this.buffer = this.buffer.subarray(pos + len)

      if (opcode >= 8) {
        this.onMessage(opcode, payload)
        continue
      }
      if (opcode === 0) {
        if (this.partialOpcode === null) throw new Error('unexpected websocket continuation')
      } else {
        if (this.partialOpcode !== null) throw new Error('interleaved websocket messages')
        this.partialOpcode = opcode
      }
      this.parts.push(payload)
      this.partsSize += payload.length
      if (this.partsSize > MAX_FRAME) throw new Error('websocket fragmented message too large')
      if (fin) {
        const result = Buffer.concat(this.parts, this.partsSize)
        const messageOpcode = this.partialOpcode
        this.parts = []
        this.partsSize = 0
        this.partialOpcode = null
        this.onMessage(messageOpcode, result)
      }
    }
  }
}

export function validatedListenUrl(rawUrl) {
  const url = new URL(rawUrl, 'https://mockmate.invalid')
  // The renderer may choose transcription parameters but never an upstream
  // hostname or a paid model outside the known configured compatibility set.
  const allowed = new Set([
    'model', 'encoding', 'sample_rate', 'channels', 'interim_results',
    'smart_format', 'punctuate', 'utterance_end_ms', 'vad_events',
    'endpointing', 'language', 'diarize', 'keyterm',
  ])
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw new Error('Unsupported STT parameter')
    // Only Nova-3 keyterms may repeat. A second model/encoding/language value
    // would make our validated choice differ from Deepgram's interpretation.
    if (key !== 'keyterm' && url.searchParams.getAll(key).length !== 1) {
      throw new Error('Duplicate STT parameter')
    }
  }
  const model = url.searchParams.get('model')
  if (!['nova-3', 'nova-2'].includes(model)) throw new Error('Invalid STT model')
  if (url.searchParams.get('encoding') !== 'linear16'
      || url.searchParams.get('sample_rate') !== '16000'
      || url.searchParams.get('channels') !== '1') throw new Error('Invalid PCM format')
  const bools = ['interim_results', 'smart_format', 'punctuate', 'vad_events', 'diarize']
  for (const key of bools) {
    const value = url.searchParams.get(key)
    if (value != null && !['true', 'false'].includes(value)) throw new Error('Invalid STT boolean')
  }
  for (const key of ['endpointing', 'utterance_end_ms']) {
    const n = Number(url.searchParams.get(key))
    if (url.searchParams.has(key) && (!Number.isInteger(n) || n < 100 || n > 5000)) {
      throw new Error('Invalid STT timing')
    }
  }
  const language = url.searchParams.get('language') || 'en-US'
  if (!/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{2,8})?$/.test(language)) throw new Error('Invalid STT language')
  const terms = url.searchParams.getAll('keyterm')
  if (terms.length > 40 || terms.some(t => t.length > 120)) throw new Error('Too many STT keyterms')
  if (rawUrl.length > 8000) throw new Error('STT URL too large')
  return 'wss://api.deepgram.com/v1/listen?' + url.searchParams.toString()
}

function rejectUpgrade(socket, code = 403) {
  if (!socket.destroyed) socket.end(
    'HTTP/1.1 ' + code + ' Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
  )
}

export function makeManagedSttGateway({
  getStore = store,
  getPeriod = currentPeriod,
  getPlan = effectivePlan,
  getLimit = limitFor,
  getProviderKey = () => process.env.DEEPGRAM_API_KEY,
  connectProvider = (url, key) => new WebSocket(url, ['token', key]),
  now = Date.now,
  originAllowed = () => true,
  maxSeconds = STT_LEASE_SECONDS,
} = {}) {
  const pendingTickets = new Map()
  const activePerUser = new Map()
  const sockets = new Set()

  function issueTicket(req) {
    if (!req.userId) throw new Error('Authenticated identity required')
    if (!getProviderKey()) {
      const e = new Error('Managed transcription provider is unavailable')
      e.status = 503
      throw e
    }
    for (const [ticket, record] of pendingTickets) {
      if (record.expiresAt <= now()) pendingTickets.delete(ticket)
    }
    if (pendingTickets.size >= MAX_TICKETS) {
      const e = new Error('Too many pending audio sessions')
      e.status = 429
      throw e
    }
    const ticket = crypto.randomBytes(32).toString('base64url')
    pendingTickets.set(ticket, { userId: String(req.userId), expiresAt: now() + TICKET_TTL_MS })
    return { gateway: true, gateway_ticket: ticket, expires_in: TICKET_TTL_MS / 1000 }
  }

  function handleUpgrade(req, socket, head) {
    const pathname = (() => { try { return new URL(req.url, 'http://localhost').pathname } catch { return '' } })()
    if (pathname !== '/api/stt-stream') return rejectUpgrade(socket, 404)
    if (!originAllowed(req.headers.origin || '')) return rejectUpgrade(socket, 403)

    const parts = String(req.headers['sec-websocket-protocol'] || '').split(',').map(v => v.trim())
    const ticket = parts.length === 2 && parts[0] === PROTOCOL ? parts[1] : ''
    const record = pendingTickets.get(ticket)
    pendingTickets.delete(ticket) // Always single use, including expired tokens.
    if (!record || record.expiresAt <= now()) return rejectUpgrade(socket, 401)
    const key = String(req.headers['sec-websocket-key'] || '')
    if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket'
        || !String(req.headers.connection || '').toLowerCase().split(',').some(v => v.trim() === 'upgrade')
        || req.headers['sec-websocket-version'] !== '13'
        || !/^[A-Za-z0-9+/]{22}==$/.test(key)
        || Buffer.from(key, 'base64').length !== 16) return rejectUpgrade(socket, 400)
    let upstreamUrl
    try { upstreamUrl = validatedListenUrl(req.url) } catch { return rejectUpgrade(socket, 400) }

    const userId = record.userId
    const nActive = activePerUser.get(userId) || 0
    if (nActive >= MAX_OPEN_STREAMS_PER_USER || sockets.size >= 256) return rejectUpgrade(socket, 429)
    if (!getProviderKey()) return rejectUpgrade(socket, 503)
    activePerUser.set(userId, nActive + 1)
    sockets.add(socket)
    const accept = crypto.createHash('sha1').update(key + MAGIC).digest('base64')
    socket.write('HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\nConnection: Upgrade\r\n'
      + 'Sec-WebSocket-Accept: ' + accept + '\r\n'
      + 'Sec-WebSocket-Protocol: ' + PROTOCOL + '\r\n\r\n')

    let closed = false
    let reserved = false
    let settled = false
    let period = null
    let reservedSeconds = maxSeconds
    let provider = null
    let providerReady = false
    let connectedAt = null
    let audioBytes = 0
    let audioSent = 0
    let pendingBytes = 0
    let pending = []
    let pendingFinalize = false
    let leaseTimer = null
    let connectTimer = null

    function write(opcode, payload) {
      if (closed || socket.destroyed || socket.writableLength > MAX_BACKPRESSURE) return false
      try { socket.write(makeServerFrame(opcode, payload)); return true } catch { return false }
    }

    function close(code = 1000, reason = '') {
      if (closed) return
      const bytes = Buffer.from(String(reason).slice(0, 90))
      const payload = Buffer.allocUnsafe(2 + bytes.length)
      payload.writeUInt16BE(code, 0)
      bytes.copy(payload, 2)
      write(8, payload)
      try { socket.end() } catch {}
      cleanup()
    }

    function cleanup() {
      if (closed) return
      closed = true
      clearTimeout(leaseTimer)
      clearTimeout(connectTimer)
      sockets.delete(socket)
      const count = activePerUser.get(userId) || 1
      if (count <= 1) activePerUser.delete(userId)
      else activePerUser.set(userId, count - 1)
      pending = []
      pendingFinalize = false
      pendingBytes = 0
      try { provider?.close() } catch {}
      if (reserved && !settled) {
        settled = true
        const elapsed = connectedAt == null ? 0 : Math.max(0, (now() - connectedAt) / 1000)
        const seconds = Math.min(reservedSeconds, Math.ceil(Math.max(elapsed, audioSent / STT_PCM_BYTES_PER_SECOND)))
        const refund = reservedSeconds - seconds
        if (refund > 0) {
          Promise.resolve().then(() => getStore().releaseSttUsage(userId, period, refund))
            .catch(err => console.error('[stt-gateway] usage settlement failed:', err?.message))
        }
      }
    }

    function sendAudio(bytes) {
      // The WebSocket handshake can finish before the DB reservation and
      // upstream Deepgram handshake. Queue this first audio instead of silently
      // discarding the interviewer's first words.
      if (closed) return
      audioBytes += bytes.length
      if (audioBytes > reservedSeconds * STT_PCM_BYTES_PER_SECOND) {
        return close(4009, 'STT segment elapsed: reconnect to continue')
      }
      if (!reserved || !providerReady) {
        pending.push(bytes)
        pendingBytes += bytes.length
        if (pendingBytes > MAX_PENDING_AUDIO) return close(1013, 'Audio provider starting too slowly')
        return
      }
      if (provider.bufferedAmount > MAX_BACKPRESSURE) return close(1013, 'Audio provider congested')
      try {
        provider.send(bytes)
        audioSent += bytes.length
      } catch { close(1011, 'Audio provider disconnected') }
    }

    function message(opcode, bytes) {
      if (closed) return
      if (opcode === 8) return close(1000)
      if (opcode === 9) return void write(10, bytes)
      if (opcode === 10) return
      if (opcode === 2) return sendAudio(bytes)
      if (opcode !== 1) return close(1008, 'Unsupported audio message')
      let parsed
      try { parsed = JSON.parse(bytes.toString('utf8')) } catch { return close(1008, 'Invalid audio control') }
      if (!['KeepAlive', 'Finalize', 'CloseStream'].includes(parsed?.type)) {
        return close(1008, 'Unsupported audio control')
      }
      if (parsed.type === 'CloseStream') return close(1000)
      if (!providerReady) {
        // A first-turn Finalize can arrive before Deepgram's upstream socket
        // connects. Replay it after buffered PCM instead of losing the turn.
        if (parsed.type === 'Finalize') pendingFinalize = true
        return
      }
      if (providerReady && provider.bufferedAmount < MAX_BACKPRESSURE) {
        try { provider.send(JSON.stringify({ type: parsed.type })) } catch { close(1011) }
      }
    }

    const reader = new ClientFrameReader(message)
    socket.on('data', data => {
      try { reader.push(data) }
      catch { close(1002, 'Invalid websocket frame') }
    })
    socket.once('error', cleanup)
    socket.once('close', cleanup)
    if (head?.length) {
      try { reader.push(head) } catch { close(1002, 'Invalid websocket frame') }
    }

    ;(async () => {
      try {
        const identity = await getStore().findUserById(userId)
        if (!identity) return close(4001, 'Account expired')
        const limit = getLimit(getPlan(identity)).sttSeconds
        period = getPeriod()
        reserved = Boolean(await getStore().reserveSttUsage(userId, period, limit, maxSeconds))
        if (!reserved) {
          // Preserve remaining monthly quota even when below a full segment.
          // The smaller retry is still an atomic, capped reservation.
          const usage = await getStore().getUsage(userId, period)
          const remaining = Math.max(0, Math.floor(limit - Number(usage?.sttSeconds || 0)))
          if (remaining > 0 && remaining < maxSeconds) {
            reserved = Boolean(await getStore().reserveSttUsage(userId, period, limit, remaining))
            if (reserved) reservedSeconds = remaining
          }
        }
        if (!reserved) return close(4008, 'STT allowance exhausted')
        if (closed) {
          // A disconnect may race with the database reservation. A completed
          // reservation must be refunded even when cleanup ran earlier.
          settled = true
          await getStore().releaseSttUsage(userId, period, reservedSeconds)
          return
        }
        connectedAt = now()
        leaseTimer = setTimeout(() => close(4009, 'STT segment elapsed: reconnect to continue'), reservedSeconds * 1000)
        const upstream = connectProvider(upstreamUrl, getProviderKey())
        provider = upstream
        connectTimer = setTimeout(() => close(1013, 'STT provider connection timeout'), 15_000)
        upstream.addEventListener('open', () => {
          if (closed) return
          clearTimeout(connectTimer)
          providerReady = true
          for (const bytes of pending) {
            if (upstream.bufferedAmount > MAX_BACKPRESSURE) return close(1013, 'STT provider congested')
            try { upstream.send(bytes); audioSent += bytes.length }
            catch { return close(1011, 'STT provider disconnected') }
          }
          pending = []
          pendingBytes = 0
          if (pendingFinalize) {
            pendingFinalize = false
            try { upstream.send(JSON.stringify({ type: 'Finalize' })) }
            catch { close(1011, 'STT provider disconnected') }
          }
        })
        upstream.addEventListener('message', ev => {
          if (closed) return
          const bytes = typeof ev.data === 'string' ? Buffer.from(ev.data) : Buffer.from(ev.data)
          if (bytes.length > MAX_FRAME || !write(typeof ev.data === 'string' ? 1 : 2, bytes)) {
            close(1013, 'STT client is too slow')
          }
        })
        upstream.addEventListener('error', () => close(1011, 'STT provider error'))
        upstream.addEventListener('close', ev => {
          if (closed) return
          // Provider auth/policy denials are fatal: retrying them repeatedly
          // burns quota and can leave the interviewer without transcription.
          // Preserve only application-level codes that the renderer knows to
          // handle; transient failures still use 1012 for bounded reconnect.
          const code = [1008, 4001, 4003, 4008].includes(ev.code) ? ev.code : 1012
          close(code, code === 1012 ? 'STT provider connection closed' : 'STT provider rejected the stream')
        })
      } catch (err) {
        console.error('[stt-gateway] session establishment failed:', err?.message)
        close(1011, 'STT provider temporarily unavailable')
      }
    })()
  }

  function closeAll() {
    for (const s of sockets) {
      try { s.destroy() } catch {}
    }
    pendingTickets.clear()
  }

  return { issueTicket, handleUpgrade, closeAll }
}
