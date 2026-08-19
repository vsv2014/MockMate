// Production-safe local diagnostics. JSONL, buffered, rotated, and aggressively redacted.
// This module must never throw into an interview/audio path.
const fs = require('fs')
const path = require('path')

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_FILES = 4
const MAX_QUEUE = 2000
const SECRET_KEY = /api.?key|authorization|password|secret|token|cookie|credential/i
const CONTENT_KEY = /resume|transcript|prompt|full.?answer|screenshot|image.?base64|audio.?data/i
const SECRET_VALUE = /(sk-[a-z0-9_-]{12,}|Bearer\s+\S+|Token\s+\S+|eyJ[a-zA-Z0-9_-]{10,}\.)/gi

function clean(value, key = '', depth = 0) {
  if (/tokens?$/i.test(key) && typeof value === 'number') return value
  if (SECRET_KEY.test(key) || CONTENT_KEY.test(key)) return '[redacted]'
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.replace(SECRET_VALUE, '[redacted]').slice(0, 500)
  if (depth >= 4) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, 30).map(v => clean(v, '', depth + 1))
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value).slice(0, 80)) out[k] = clean(v, k, depth + 1)
    return out
  }
  return String(value).slice(0, 200)
}

class DiagnosticStore {
  constructor({ userData, appVersion, platform, arch }) {
    this.dir = path.join(userData, 'logs')
    this.file = path.join(this.dir, 'diagnostics.jsonl')
    this.queue = []
    this.flushing = false
    this.base = { appVersion, platform, arch, pid: process.pid }
    try { fs.mkdirSync(this.dir, { recursive: true }) } catch {}
    this.timer = setInterval(() => this.flush(), 500)
    this.timer.unref?.()
  }

  event(component, event, fields = {}, level = 'info') {
    try {
      const row = clean({ ts: new Date().toISOString(), level, component, event, ...this.base, ...fields })
      const line = JSON.stringify(row)
      if (line.length > 16_000) return false
      if (this.queue.length >= MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE + 1)
      this.queue.push(line)
      if (this.queue.length >= 100) this.flush()
      return true
    } catch { return false }
  }

  ingest(rows) {
    for (const row of (Array.isArray(rows) ? rows : [rows]).slice(0, 200)) {
      if (!row || typeof row !== 'object') continue
      this.event(row.component || 'renderer', row.event || 'event', row, row.level || 'info')
    }
  }

  async rotate(incomingBytes = 0) {
    try {
      const size = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0
      if (size + incomingBytes < MAX_FILE_BYTES) return
      for (let i = MAX_FILES - 1; i >= 1; i--) {
        const from = i === 1 ? this.file : `${this.file}.${i - 1}`
        const to = `${this.file}.${i}`
        if (fs.existsSync(from)) {
          try { if (fs.existsSync(to)) fs.unlinkSync(to) } catch {}
          try { fs.renameSync(from, to) } catch {}
        }
      }
    } catch {}
  }

  async flush() {
    if (this.flushing || !this.queue.length) return
    this.flushing = true
    const lines = this.queue.splice(0, 300)
    const chunk = lines.join('\n') + '\n'
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      await this.rotate(Buffer.byteLength(chunk))
      await fs.promises.appendFile(this.file, chunk, { mode: 0o600 })
    } catch {} finally {
      this.flushing = false
      if (this.queue.length) setImmediate(() => this.flush())
    }
  }

  async clear() {
    this.queue = []
    for (let i = 0; i < MAX_FILES; i++) {
      const f = i === 0 ? this.file : `${this.file}.${i}`
      try { await fs.promises.unlink(f) } catch {}
    }
  }

  async exportTo(destination) {
    while (this.queue.length || this.flushing) {
      await this.flush()
      if (this.flushing) await new Promise(resolve => setTimeout(resolve, 10))
    }
    const files = []
    for (let i = MAX_FILES - 1; i >= 0; i--) {
      const f = i === 0 ? this.file : `${this.file}.${i}`
      if (fs.existsSync(f)) files.push(f)
    }
    const header = {
      format: 'mockmate-diagnostics-v1', exportedAt: new Date().toISOString(),
      appVersion: this.base.appVersion, platform: this.base.platform, arch: this.base.arch,
      privacy: 'No API keys, tokens, passwords, resumes, transcripts, prompts, screenshots or audio are intentionally included.',
    }
    const out = fs.createWriteStream(destination, { mode: 0o600 })
    out.write(JSON.stringify({ type: 'bundle_header', ...header }) + '\n')
    for (const f of files) out.write(await fs.promises.readFile(f, 'utf8'))
    await new Promise((resolve, reject) => { out.on('error', reject); out.end(resolve) })
    return { path: destination, files: files.length }
  }

  async close() { clearInterval(this.timer); await this.flush() }
}

module.exports = { DiagnosticStore, clean }
