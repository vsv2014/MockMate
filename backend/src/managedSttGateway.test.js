import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import {
  ClientFrameReader, makeManagedSttGateway, makeServerFrame,
  validatedListenUrl, STT_LEASE_SECONDS,
} from './managedSttGateway.js'

const listen = 'model=nova-3&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&punctuate=true&utterance_end_ms=1200&vad_events=true&endpointing=300&language=en-US'
const url = '/api/stt-stream?' + listen
const sleep = ms => new Promise(r => setTimeout(r, ms))

function maskedFrame(opcode, payload, { fin = true } = {}) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  const head = data.length < 126 ? 2 : 4
  const out = Buffer.alloc(head + 4 + data.length)
  out[0] = (fin ? 0x80 : 0) | opcode
  if (head === 2) out[1] = 0x80 | data.length
  else { out[1] = 0x80 | 126; out.writeUInt16BE(data.length, 2) }
  const mask = Buffer.from([1, 2, 3, 4])
  mask.copy(out, head)
  for (let i = 0; i < data.length; i++) out[head + 4 + i] = data[i] ^ mask[i & 3]
  return out
}

class StubProvider extends EventTarget {
  bufferedAmount = 0
  sent = []
  closed = false
  send(frame) { this.sent.push(frame) }
  close() {
    if (this.closed) return
    this.closed = true
    const e = new Event('close')
    Object.defineProperty(e, 'code', { value: 1000 })
    this.dispatchEvent(e)
  }
  open() { this.dispatchEvent(new Event('open')) }
  emitText(text) { this.dispatchEvent(new MessageEvent('message', { data: text })) }
}

async function testRig({ maxSeconds = STT_LEASE_SECONDS, originAllowed = () => true, limit = 5000, reserveSucceeds = true, reserveDelayMs = 0, providerOpenDelayMs = 0, initialUsage = 0, refundDelayMs = 0, refundFails = false } = {}) {
  const calls = { reserves: [], refunds: [], provider: [], sends: [] }
  let balance = initialUsage
  const fakeStore = {
    async getUsage(userId, period) { return { userId, period, sttSeconds: balance } },
    async findUserById(id) { return id === 'u1' ? { plan: 'free' } : null },
    async reserveSttUsage(userId, period, cap, seconds) {
      if (reserveDelayMs) await sleep(reserveDelayMs)
      calls.reserves.push({ userId, period, cap, seconds })
      if (!reserveSucceeds || balance + seconds > cap) return false
      balance += seconds
      return true
    },
    async releaseSttUsage(userId, period, seconds) {
      if (refundDelayMs) await sleep(refundDelayMs)
      if (refundFails) throw new Error('Mongo settlement unavailable')
      calls.refunds.push({ userId, period, seconds })
      balance = Math.max(0, balance - seconds)
    },
  }
  let provider = null
  const gateway = makeManagedSttGateway({
    getStore: () => fakeStore,
    getProviderKey: () => 'server-only-key',
    getPeriod: () => '2026-10',
    getPlan: u => u.plan,
    getLimit: () => ({ sttSeconds: limit }),
    originAllowed,
    maxSeconds,
    connectProvider: (addr, key) => {
      calls.provider.push({ addr, key })
      provider = new StubProvider()
      if (providerOpenDelayMs) setTimeout(() => provider.open(), providerOpenDelayMs)
      else queueMicrotask(() => provider.open())
      return provider
    },
  })
  const server = createServer((_req, res) => res.end('ok'))
  server.on('upgrade', (req, socket, head) => gateway.handleUpgrade(req, socket, head))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  const open = async ({ ticket, path = url } = {}) => {
    const t = ticket || gateway.issueTicket({ userId: 'u1' }).gateway_ticket
    const ws = new WebSocket('ws://127.0.0.1:' + addr.port + path, ['mockmate-stt', t]);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    return ws
  }
  return {
    calls, gateway, open, port: addr.port, get provider() { return provider }, get balance() { return balance },
    close: async () => {
      await gateway.closeAll()
      await new Promise(resolve => server.close(resolve))
    },
  }
}

describe('managed streaming WebSocket policy', () => {
  it('accepts only fixed Deepgram host, PCM format and permitted parameters', () => {
    expect(validatedListenUrl(url)).toContain('wss://api.deepgram.com/v1/listen?')
    expect(() => validatedListenUrl(url.replace('nova-3', 'whisper'))).toThrow('Invalid STT model')
    expect(() => validatedListenUrl(url + '&model=nova-expensive')).toThrow('Duplicate STT parameter')
    expect(() => validatedListenUrl(url + '&sample_rate=48000')).toThrow('Duplicate STT parameter')
    expect(() => validatedListenUrl(url + '&callback=https://attacker.invalid')).toThrow('Unsupported STT parameter')
    expect(() => validatedListenUrl(url.replace('16000', '48000'))).toThrow('Invalid PCM format')
    expect(() => validatedListenUrl(url + '&keyterm=' + 'x'.repeat(121))).toThrow('Too many STT keyterms')
  })

  it('parses masked fragmented audio and ping control frames', () => {
    const output = []
    const reader = new ClientFrameReader((op, data) => output.push([op, data.toString('utf8')]))
    const first = maskedFrame(1, 'hel', { fin: false })
    const ping = maskedFrame(9, 'p')
    const second = maskedFrame(0, 'lo')
    reader.push(first.subarray(0, 3))
    reader.push(first.subarray(3))
    reader.push(ping)
    reader.push(second)
    expect(output).toEqual([[9, 'p'], [1, 'hello']])
    expect(() => reader.push(Buffer.from([0x82, 0x01, 0xff]))).toThrow('masked')
  })

  it('creates unmasked server frames for text and close messages', () => {
    const text = makeServerFrame(1, Buffer.from('hello'))
    expect(text[0]).toBe(0x81)
    expect(text[1]).toBe(5)
    expect(text.subarray(2).toString()).toBe('hello')
    const huge = makeServerFrame(2, Buffer.alloc(70_000))
    expect(huge[1]).toBe(127)
  })

  it('enforces one authenticated, one-use ticket and proxies only approved audio', async () => {
    const rig = await testRig()
    try {
      const ticket = rig.gateway.issueTicket({ userId: 'u1' })
      expect(ticket.gateway).toBe(true)
      expect(ticket).not.toHaveProperty('access_token')
      const ws = await rig.open({ ticket: ticket.gateway_ticket })
      await sleep(50)
      expect(rig.calls.reserves).toHaveLength(1)
      expect(rig.calls.reserves[0].seconds).toBe(300)
      expect(rig.calls.provider[0].key).toBe('server-only-key')
      ws.send(new Uint8Array([0, 1, 2, 3]))
      const text = await new Promise(resolve => {
        ws.addEventListener('message', e => resolve(e.data), { once: true })
        rig.provider.emitText('{"channel":{"alternatives":[]}}')
      })
      expect(String(text)).toContain('channel')
      await sleep(20)
      expect(rig.provider.sent.some(x => x.byteLength === 4)).toBe(true)
      ws.close()
      await sleep(40)
      expect(rig.balance).toBeLessThan(300)
      expect(rig.calls.refunds.length).toBe(1)
      // A previously consumed ticket cannot authorize a second connection.
      const second = new WebSocket('ws://127.0.0.1:' + rig.port + url, ['mockmate-stt', ticket.gateway_ticket])
      const replay = await new Promise(resolve => {
        second.addEventListener('error', () => resolve('rejected'), { once: true })
        second.addEventListener('open', () => resolve('opened'), { once: true })
      })
      expect(replay).toBe('rejected')
    } finally { await rig.close() }
  })

  it('buffers initial speech before the database reservation finishes', async () => {
    const rig = await testRig({ reserveDelayMs: 70 })
    try {
      const ws = await rig.open()
      ws.send(new Uint8Array([4, 5, 6, 7])) // React emits immediately on socket open
      expect(rig.calls.reserves).toHaveLength(0)
      await sleep(110)
      expect(rig.calls.reserves).toHaveLength(1)
      expect(rig.provider.sent.some(data => data.byteLength === 4)).toBe(true)
      ws.close()
    } finally { await rig.close() }
  })

  it('replays Finalize after buffered first-turn speech in correct order', async () => {
    const rig = await testRig({ providerOpenDelayMs: 90 })
    try {
      const ws = await rig.open()
      ws.send(new Uint8Array([11, 12, 13]))
      ws.send(JSON.stringify({ type: 'Finalize' }))
      await sleep(140)
      expect(rig.provider.sent).toHaveLength(2)
      expect([...rig.provider.sent[0]]).toEqual([11, 12, 13])
      expect(JSON.parse(rig.provider.sent[1])).toEqual({ type: 'Finalize' })
      ws.close()
    } finally { await rig.close() }
  })

  it('refunds a reservation completed after the interviewer has stopped', async () => {
    const rig = await testRig({ reserveDelayMs: 75 })
    try {
      const ws = await rig.open()
      ws.close()
      await sleep(140)
      expect(rig.calls.reserves).toHaveLength(1)
      expect(rig.calls.refunds).toEqual([
        { userId: 'u1', period: '2026-10', seconds: STT_LEASE_SECONDS },
      ])
      expect(rig.balance).toBe(0)
      expect(rig.calls.provider).toHaveLength(0)
    } finally { await rig.close() }
  })

  it('rejects depleted quotas with fatal 4008 and never starts Deepgram', async () => {
    const rig = await testRig({ reserveSucceeds: false })
    try {
      const ws = await rig.open()
      const code = await new Promise(resolve => ws.addEventListener('close', e => resolve(e.code), { once: true }))
      expect(code).toBe(4008)
      expect(rig.calls.provider).toHaveLength(0)
      expect(rig.calls.reserves).toHaveLength(1)
    } finally { await rig.close() }
  })

  it('uses and settles the last partial monthly quota instead of denying it', async () => {
    const rig = await testRig({ maxSeconds: 300, limit: 500, initialUsage: 425 })
    try {
      const ws = await rig.open()
      await sleep(25)
      expect(rig.calls.reserves.map(row => row.seconds)).toEqual([300, 75])
      expect(rig.calls.provider).toHaveLength(1)
      const closed = new Promise(resolve => ws.addEventListener('close', ev => resolve(ev.code), { once: true }))
      // Send 76 seconds in 32 KB PCM chunks to cross the smaller lease.
      for (let i = 0; i < 76; i++) {
        try { ws.send(new Uint8Array(32_000)) } catch { break }
      }
      expect(await closed).toBe(4009)
      expect(rig.balance).toBeLessThanOrEqual(500)
    } finally { await rig.close() }
  })

  it('stops after a bounded capture duration, and prevents unbounded provider spend', async () => {
    const rig = await testRig({ maxSeconds: 1 })
    try {
      const ws = await rig.open()
      await sleep(25)
      const closed = new Promise(resolve => ws.addEventListener('close', e => resolve(e.code), { once: true }))
      ws.send(new Uint8Array(32000))
      ws.send(new Uint8Array(1)) // exceeds the reserved 1 second
      expect(await closed).toBe(4009)
      expect(rig.calls.reserves[0].seconds).toBe(1)
      expect(rig.calls.provider).toHaveLength(1)
    } finally { await rig.close() }
  })

  it('propagates fatal upstream auth rejection instead of endlessly retrying', async () => {
    const rig = await testRig()
    try {
      const ws = await rig.open()
      await sleep(25)
      const closed = new Promise(resolve => ws.addEventListener('close', ev => resolve(ev.code), { once: true }))
      const event = new Event('close')
      Object.defineProperty(event, 'code', { value: 4003 })
      rig.provider.dispatchEvent(event)
      expect(await closed).toBe(4003)
      expect(rig.calls.reserves).toHaveLength(1)
      await sleep(10)
      expect(rig.calls.refunds).toHaveLength(1)
    } finally { await rig.close() }
  })

  it('drains sockets and waits for committed usage refunds before returning from shutdown', async () => {
    const rig = await testRig({ refundDelayMs: 90 })
    try {
      const ws = await rig.open()
      await sleep(30)
      expect(rig.calls.reserves).toHaveLength(1)
      let drained = false
      const pending = rig.gateway.closeAll().then(() => { drained = true })
      await sleep(20)
      expect(drained).toBe(false) // the Mongo refund is deliberately still pending
      await pending
      expect(drained).toBe(true)
      expect(rig.calls.refunds).toHaveLength(1)
      expect(rig.balance).toBeLessThan(300)
      expect(() => rig.gateway.issueTicket({ userId: 'u1' })).toThrow('shutting down')
      expect(ws.readyState).not.toBe(WebSocket.OPEN)
    } finally { await rig.close() }
  })

  it('waits for a late quota reservation and fully refunds if shutdown won the race', async () => {
    const rig = await testRig({ reserveDelayMs: 85, refundDelayMs: 15 })
    try {
      await rig.open()
      await rig.gateway.closeAll()
      expect(rig.calls.reserves).toHaveLength(1)
      expect(rig.calls.refunds).toEqual([
        { userId: 'u1', period: '2026-10', seconds: STT_LEASE_SECONDS },
      ])
      expect(rig.balance).toBe(0)
      expect(rig.calls.provider).toHaveLength(0)
    } finally { await rig.close() }
  })

  it('fails shutdown rather than reporting success when quota reconciliation fails', async () => {
    const rig = await testRig({ refundFails: true })
    try {
      await rig.open()
      await sleep(25)
      await expect(rig.gateway.closeAll()).rejects.toThrow('usage settlement failed')
    } finally {
      try { await rig.close() } catch {} // expected fake Mongo failure
    }
  })

  it('caps simultaneous streams to protect provider spend', async () => {
    const rig = await testRig()
    try {
      const a = await rig.open()
      const b = await rig.open()
      const ticket = rig.gateway.issueTicket({ userId: 'u1' }).gateway_ticket
      const c = new WebSocket('ws://127.0.0.1:' + rig.port + url, ['mockmate-stt', ticket])
      const outcome = await new Promise(resolve => {
        c.addEventListener('error', () => resolve('rejected'), { once: true })
        c.addEventListener('open', () => resolve('opened'), { once: true })
      })
      expect(outcome).toBe('rejected')
      expect(rig.calls.reserves).toHaveLength(2)
      a.close()
      b.close()
    } finally { await rig.close() }
  })
})
