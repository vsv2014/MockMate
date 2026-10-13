// SQLite is owned by a worker in Electron main. Payloads are encrypted before disk.
const { DatabaseSync } = require('node:sqlite')
const crypto = require('crypto')
const fail = code => Object.assign(new Error(code), { code })
const bytes = value => Buffer.byteLength(JSON.stringify(value))
const DEFAULT_LIMITS = { maxSessions: 10_000, maxSessionBytes: 16 * 1024 * 1024, maxOwnerBytes: 512 * 1024 * 1024 }
class SessionStore {
  constructor(filename, key, limits = {}) {
    if (!Buffer.isBuffer(key) || key.length !== 32) throw fail('encryption_key_invalid')
    this.key = key; this.limits = { ...DEFAULT_LIMITS, ...limits }
    this.db = new DatabaseSync(filename)
    const version = this.db.prepare('PRAGMA user_version').get().user_version
    if (version > 1) { this.db.close(); throw fail('schema_too_new') }
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;')
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS sessions (scope TEXT NOT NULL, run_id TEXT NOT NULL, ts INTEGER NOT NULL, payload BLOB NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY(scope,run_id));
      CREATE TABLE IF NOT EXISTS turns (scope TEXT NOT NULL, run_id TEXT NOT NULL, turn_id TEXT NOT NULL, seq INTEGER NOT NULL, payload BLOB NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY(scope,run_id,turn_id), UNIQUE(scope,run_id,seq), FOREIGN KEY(scope,run_id) REFERENCES sessions(scope,run_id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS imports (scope TEXT NOT NULL, source_key TEXT NOT NULL, hash TEXT NOT NULL, payload BLOB NOT NULL, PRIMARY KEY(scope,source_key));
      CREATE INDEX IF NOT EXISTS sessions_recent ON sessions(scope,ts DESC,run_id);
      PRAGMA user_version=1; COMMIT;`)
  }
  encrypt(value) {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
  }
  decrypt(value) {
    const b = Buffer.from(value), cipher = crypto.createDecipheriv('aes-256-gcm', this.key, b.subarray(0,12))
    cipher.setAuthTag(b.subarray(12,28))
    return JSON.parse(Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString('utf8'))
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); this.db.exec('COMMIT'); return result }
    catch (error) { try { this.db.exec('ROLLBACK') } catch {} throw error }
  }
  scope(scope) { if (!/^[a-zA-Z0-9._-]{1,160}$/.test(scope || '')) throw fail('invalid_scope') }
  write(scope, entry) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || entry.id.length > 180 || !Number.isFinite(entry.ts) || !Array.isArray(entry.transcript)) throw fail('invalid_session')
    const size = bytes(entry)
    const ownTurns = this.db.prepare('SELECT coalesce(sum(bytes),0) bytes FROM turns WHERE scope=? AND run_id=?').get(scope,entry.id).bytes
    if (size + ownTurns > this.limits.maxSessionBytes) throw fail('session_size_limit')
    const previous = this.db.prepare('SELECT bytes FROM sessions WHERE scope=? AND run_id=?').get(scope,entry.id)
    const count = this.db.prepare('SELECT count(*) n, coalesce(sum(bytes),0) bytes FROM sessions WHERE scope=?').get(scope)
    const turnBytes = this.db.prepare('SELECT coalesce(sum(bytes),0) bytes FROM turns WHERE scope=?').get(scope).bytes
    if (!previous && count.n >= this.limits.maxSessions) throw fail('session_count_limit')
    if (count.bytes - (previous?.bytes || 0) + size + turnBytes > this.limits.maxOwnerBytes) throw fail('storage_budget_exceeded')
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?) ON CONFLICT(scope,run_id) DO UPDATE SET payload=excluded.payload,bytes=excluded.bytes').run(scope, entry.id, entry.ts, this.encrypt(entry), size)
    return { ...entry, storage: 'sqlite' }
  }
  save(scope, entry) { this.scope(scope); return this.transaction(() => this.write(scope,entry)) }
  get(scope, runId) {
    this.scope(scope)
    const row = this.db.prepare('SELECT * FROM sessions WHERE scope=? AND run_id=?').get(scope,runId)
    if (!row) return null
    const entry = this.decrypt(row.payload)
    if (entry.captureStatus === 'capturing' || entry.captureStatus === 'provisional') {
      const captured = this.db.prepare('SELECT payload FROM turns WHERE scope=? AND run_id=? ORDER BY seq,turn_id').all(scope,runId).map(t => this.decrypt(t.payload))
      if (captured.length) { entry.captureStatus = 'interrupted'; entry.transcript = captured; entry.report = { overallScore: null, summary: 'Interrupted session recovered from committed capture.', dimensions: [], strengths: [], improvements: [] } }
    }
    return entry
  }
  list(scope, offset = 0) {
    this.scope(scope)
    if (!Number.isInteger(offset) || offset < 0) throw fail('invalid_offset')
    const rows = this.db.prepare('SELECT payload FROM sessions WHERE scope=? ORDER BY ts DESC,run_id LIMIT 100 OFFSET ?').all(scope,offset)
    return { sessions: rows.map(row => {
      const entry = this.decrypt(row.payload)
      return { id: entry.id, ts: entry.ts, label: entry.label, mode: entry.mode, company: entry.company, role: entry.role,
        score: entry.score, verdict: entry.verdict, captureStatus: entry.captureStatus === 'capturing' ? 'interrupted' : entry.captureStatus, evaluationStatus: entry.evaluationStatus,
        transcriptCount: entry.transcript?.length || this.db.prepare('SELECT count(*) n FROM turns WHERE scope=? AND run_id=?').get(scope,entry.id).n }
    }), total: this.db.prepare('SELECT count(*) n FROM sessions WHERE scope=?').get(scope).n }
  }
  append(scope, runId, turns) {
    this.scope(scope)
    if (!Array.isArray(turns) || turns.length > 100) throw fail('invalid_turn_batch')
    return this.transaction(() => {
      const session = this.db.prepare('SELECT * FROM sessions WHERE scope=? AND run_id=?').get(scope,runId)
      if (!session) throw fail('session_not_found')
      const entry = this.decrypt(session.payload)
      if (entry.captureStatus === 'captured') throw fail('capture_already_finalized')
      const insert = this.db.prepare('INSERT INTO turns VALUES(?,?,?,?,?,?) ON CONFLICT(scope,run_id,turn_id) DO UPDATE SET payload=excluded.payload,bytes=excluded.bytes')
      for (const turn of turns) {
        if (!turn || typeof turn.id !== 'string' || turn.id.length > 180 || !Number.isInteger(turn.seq) || turn.seq < 0 || !['interviewer','candidate'].includes(turn.role) || typeof turn.text !== 'string' || Buffer.byteLength(turn.text) > 64*1024) throw fail('invalid_turn')
        insert.run(scope,runId,turn.id,turn.seq,this.encrypt(turn),bytes(turn))
      }
      const size = this.db.prepare('SELECT coalesce(sum(bytes),0) bytes FROM turns WHERE scope=? AND run_id=?').get(scope,runId).bytes
      const all = this.db.prepare('SELECT (SELECT coalesce(sum(bytes),0) FROM sessions WHERE scope=?) + (SELECT coalesce(sum(bytes),0) FROM turns WHERE scope=?) bytes').get(scope,scope).bytes
      if (session.bytes + size > this.limits.maxSessionBytes || all > this.limits.maxOwnerBytes) throw fail('storage_budget_exceeded')
      entry.captureStatus = 'capturing'
      this.db.prepare('UPDATE sessions SET payload=? WHERE scope=? AND run_id=?').run(this.encrypt(entry),scope,runId)
      return { committed: turns.length, runId }
    })
  }
  import(scope, sourceKey, raw) {
    this.scope(scope)
    if (typeof sourceKey !== 'string' || sourceKey !== `mm-sessions::${scope}` || typeof raw !== 'string' || Buffer.byteLength(raw) > Math.min(this.limits.maxOwnerBytes,32*1024*1024)) throw fail('invalid_import')
    const hash = crypto.createHash('sha256').update(raw).digest('hex')
    const prior = this.db.prepare('SELECT hash FROM imports WHERE scope=? AND source_key=?').get(scope,sourceKey)
    if (prior) { if (prior.hash !== hash) throw fail('legacy_source_changed'); return { verified: true, repeated: true } }
    let rows
    try { rows = JSON.parse(raw) } catch { throw fail('legacy_json_invalid') }
    if (!Array.isArray(rows)) throw fail('legacy_json_invalid')
    return this.transaction(() => {
      const ids = new Set()
      for (const row of rows) {
        if (!row?.id || ids.has(row.id)) throw fail('legacy_id_invalid_or_duplicate')
        ids.add(row.id)
        const existing = this.db.prepare('SELECT payload FROM sessions WHERE scope=? AND run_id=?').get(scope,row.id)
        if (existing && JSON.stringify(this.decrypt(existing.payload)) !== JSON.stringify(row)) throw fail('legacy_row_conflict')
        this.write(scope,row)
        const saved = this.db.prepare('SELECT payload FROM sessions WHERE scope=? AND run_id=?').get(scope,row.id)
        if (JSON.stringify(this.decrypt(saved.payload)) !== JSON.stringify(row)) throw fail('import_verification_failed')
      }
      this.db.prepare('INSERT INTO imports VALUES(?,?,?,?)').run(scope,sourceKey,hash,this.encrypt(raw))
      return { verified: true, count: rows.length, hash }
    })
  }
  purge(scope) { this.scope(scope); return this.transaction(() => { this.db.prepare('DELETE FROM sessions WHERE scope=?').run(scope); this.db.prepare('DELETE FROM imports WHERE scope=?').run(scope); return { ok: true } }) }
  delete(scope, runId) { this.scope(scope); return this.transaction(() => { this.db.prepare('DELETE FROM sessions WHERE scope=? AND run_id=?').run(scope,runId); return { ok: true } }) }
  close() { this.db.close() }
}
module.exports = { SessionStore, DEFAULT_LIMITS }
