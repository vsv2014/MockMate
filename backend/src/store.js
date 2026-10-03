// Storage layer — one small data API, two interchangeable backends.
// mongoose is imported dynamically so file-mode boot stays zero-infra.
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const useMongo = () => Boolean(String(process.env.MONGO_URI || '').trim())

export function currentPeriod() {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function toSafeUser(u) {
  if (!u) return null
  return {
    id: String(u.id || u._id), email: u.email, name: u.name || '', plan: u.plan || 'free',
    emailVerified: Boolean(u.emailVerified ?? Boolean(u.googleId)),
    targetRole: u.targetRole || '', yearsExp: u.yearsExp || '', currentRole: u.currentRole || '',
    language: u.language || 'English', hasResume: !!u.resume,
    preferences: u.preferences && typeof u.preferences === 'object' ? u.preferences : {}, createdAt: u.createdAt,
  }
}

function duplicateUserError() {
  const error = new Error('An account with this email already exists')
  error.code = 'USER_EXISTS'; error.status = 409
  return error
}

function makeFileBackend() {
  const dir = process.env.MOCKMATE_DATA_DIR || path.join(process.cwd(), '.data')
  const file = path.join(dir, 'auth-db.json')
  let db = { users: [], usage: [] }
  let writeChain = Promise.resolve()

  function load() {
    fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(file)) return
    try { db = JSON.parse(fs.readFileSync(file, 'utf8')) }
    catch (error) {
      const backup = path.join(dir, `auth-db.corrupt.${Date.now()}.json`)
      try { fs.copyFileSync(file, backup) } catch {}
      console.error(`[store] load failed; preserved corrupt DB at ${backup}:`, error.message)
      db = { users: [], usage: [] }
    }
    if (!db.users) db.users = []
    if (!db.usage) db.usage = []
  }

  function persist() {
    writeChain = writeChain.catch(() => {}).then(() => {
      const tmp = file + '.tmp'
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2))
      fs.renameSync(tmp, file)
    })
    return writeChain.catch(error => { console.error('[store] persist failed:', error.message); throw error })
  }

  load()

  return {
    async init() {},
    isReady() { return true },
    async close() { try { await writeChain } catch {} },
    async findUserByEmail(email) { const e = (email || '').toLowerCase(); return db.users.find(u => u.email === e) || null },
    async findUserById(id) { return db.users.find(u => String(u.id) === String(id)) || null },
    async findUserByGoogleId(googleId) { return db.users.find(u => u.googleId === googleId) || null },
    async findUserByResetToken(hash) { return db.users.find(u => u.resetTokenHash && u.resetTokenHash === hash) || null },
    async findUserByVerifyToken(hash) { return db.users.find(u => u.verifyTokenHash && u.verifyTokenHash === hash) || null },
    async findUserByStripeCustomerId(cid) { return db.users.find(u => u.stripeCustomerId && u.stripeCustomerId === cid) || null },
    async createUser(doc) {
      const email = (doc.email || '').toLowerCase()
      // File mode has no DB unique index, so serialize the uniqueness check with writes.
      await writeChain.catch(() => {})
      if (db.users.some(u => u.email === email)) throw duplicateUserError()
      const now = new Date().toISOString()
      const user = {
        id: crypto.randomUUID(), email, passwordHash: doc.passwordHash || null,
        googleId: doc.googleId || null, name: doc.name || '', plan: 'free', currentRole: doc.currentRole || '',
        targetRole: doc.targetRole || '', yearsExp: doc.yearsExp || '', language: doc.language || 'English',
        resume: doc.resume || '', preferences: doc.preferences || {}, stripeCustomerId: null, planExpiry: null,
        emailVerified: Boolean(doc.emailVerified ?? Boolean(doc.googleId)),
        verifyTokenHash: doc.verifyTokenHash || null, verifyTokenExp: doc.verifyTokenExp || null,
        resetTokenHash: null, resetTokenExp: null, tokenVersion: 0, createdAt: now, lastLogin: doc.lastLogin || null,
      }
      db.users.push(user)
      try { await persist() } catch (error) { db.users = db.users.filter(u => u.id !== user.id); throw error }
      return user
    },
    async updateUser(id, patch) {
      const u = db.users.find(x => String(x.id) === String(id)); if (!u) return null
      const before = { ...u }; Object.assign(u, patch)
      try { await persist(); return u } catch (error) { Object.assign(u, before); throw error }
    },
    async deleteUser(id) {
      const usersBefore = db.users; const usageBefore = db.usage
      const nextUsers = db.users.filter(u => String(u.id) !== String(id))
      if (nextUsers.length === db.users.length) return false
      db.users = nextUsers; db.usage = db.usage.filter(r => String(r.userId) !== String(id))
      try { await persist(); return true } catch (error) { db.users = usersBefore; db.usage = usageBefore; throw error }
    },
    async getUsage(userId, period) { return db.usage.find(r => String(r.userId) === String(userId) && r.period === period) || { userId: String(userId), period, llmCalls: 0, sttSeconds: 0 } },
    async addUsage(userId, period, { llmCalls = 0, sttSeconds = 0 }) {
      let r = db.usage.find(x => String(x.userId) === String(userId) && x.period === period)
      if (!r) { r = { userId: String(userId), period, llmCalls: 0, sttSeconds: 0 }; db.usage.push(r) }
      const before = { llmCalls: r.llmCalls, sttSeconds: r.sttSeconds }
      r.llmCalls += llmCalls; r.sttSeconds += sttSeconds
      try { await persist(); return r } catch (error) { r.llmCalls = before.llmCalls; r.sttSeconds = before.sttSeconds; throw error }
    },
    async reserveLlmUsage(userId, period, limit, units = 1) {
      const delta = Math.max(1, Number(units) || 1)
      let r = db.usage.find(x => String(x.userId) === String(userId) && x.period === period)
      if (!r) { r = { userId: String(userId), period, llmCalls: 0, sttSeconds: 0 }; db.usage.push(r) }
      if (Number.isFinite(limit) && r.llmCalls + delta > limit) return false
      r.llmCalls += delta
      try { await persist(); return true } catch { r.llmCalls = Math.max(0, r.llmCalls - delta); return false }
    },
    async releaseLlmUsage(userId, period, units = 1) {
      const delta = Math.max(1, Number(units) || 1)
      const r = db.usage.find(x => String(x.userId) === String(userId) && x.period === period)
      if (!r) return true
      r.llmCalls = Math.max(0, r.llmCalls - delta)
      try { await persist() } catch {}
      return true
    },
  }
}

async function makeMongoBackend() {
  const mongoose = (await import('mongoose')).default
  const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true }, passwordHash: { type: String },
    googleId: { type: String, index: true }, name: { type: String, default: '' }, plan: { type: String, default: 'free' },
    currentRole: { type: String, default: '' }, targetRole: { type: String, default: '' }, yearsExp: { type: String, default: '' },
    language: { type: String, default: 'English' }, resume: { type: String, default: '' }, preferences: { type: Object, default: {} },
    stripeCustomerId: { type: String, default: null }, planExpiry: { type: Date, default: null },
    emailVerified: { type: Boolean, default: false },
    verifyTokenHash: { type: String, default: null, index: true }, verifyTokenExp: { type: Number, default: null },
    resetTokenHash: { type: String, default: null, index: true }, resetTokenExp: { type: Number, default: null },
    tokenVersion: { type: Number, default: 0 }, lastLogin: { type: Date },
  }, { timestamps: true })
  const usageSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, period: { type: String, required: true },
    llmCalls: { type: Number, default: 0 }, sttSeconds: { type: Number, default: 0 },
  }, { timestamps: true })
  usageSchema.index({ userId: 1, period: 1 }, { unique: true })
  const User = mongoose.models.User || mongoose.model('User', userSchema)
  const Usage = mongoose.models.Usage || mongoose.model('Usage', usageSchema)
  const lean = u => (u ? { ...u.toObject(), id: String(u._id) } : null)
  return {
    async init() { mongoose.set('strictQuery', true); await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 }); console.log('[store] mongo connected:', mongoose.connection.name) },
    isReady() { return mongoose.connection.readyState === 1 },
    async close() { if (mongoose.connection.readyState !== 0) await mongoose.disconnect() },
    async findUserByEmail(email) { return lean(await User.findOne({ email: (email || '').toLowerCase() })) },
    async findUserById(id) { try { return lean(await User.findById(id)) } catch { return null } },
    async findUserByGoogleId(googleId) { return lean(await User.findOne({ googleId })) },
    async findUserByResetToken(hash) { return lean(await User.findOne({ resetTokenHash: hash })) },
    async findUserByVerifyToken(hash) { return lean(await User.findOne({ verifyTokenHash: hash })) },
    async findUserByStripeCustomerId(cid) { return lean(await User.findOne({ stripeCustomerId: cid })) },
    async createUser(doc) {
      try { return lean(await User.create({ ...doc, email: (doc.email || '').toLowerCase() })) }
      catch (error) { if (error?.code === 11000) throw duplicateUserError(); throw error }
    },
    async updateUser(id, patch, { session } = {}) { return lean(await User.findByIdAndUpdate(id, patch, { new: true, session })) },
    async deleteUser(id, { session } = {}) {
      const [result] = await Promise.all([
        User.deleteOne({ _id: id }, { session }),
        Usage.deleteMany({ userId: id }, { session }),
      ])
      return result.deletedCount === 1
    },
    async getUsage(userId, period) { return (await Usage.findOne({ userId, period })) || { userId: String(userId), period, llmCalls: 0, sttSeconds: 0 } },
    async addUsage(userId, period, { llmCalls = 0, sttSeconds = 0 }) { return await Usage.findOneAndUpdate({ userId, period }, { $inc: { llmCalls, sttSeconds } }, { new: true, upsert: true }) },
    async reserveLlmUsage(userId, period, limit, units = 1) {
      const delta = Math.max(1, Number(units) || 1)
      try { await Usage.updateOne({ userId, period }, { $setOnInsert: { llmCalls: 0, sttSeconds: 0 } }, { upsert: true }) }
      catch (e) { if (e?.code !== 11000) throw e }
      const reserved = await Usage.findOneAndUpdate({ userId, period, llmCalls: { $lte: limit - delta } }, { $inc: { llmCalls: delta } }, { new: true })
      return !!reserved
    },
    async releaseLlmUsage(userId, period, units = 1) {
      const delta = Math.max(1, Number(units) || 1)
      await Usage.updateOne({ userId, period, llmCalls: { $gt: 0 } }, { $inc: { llmCalls: -delta } })
      return true
    },
  }
}

let backend = null
let backendMode = null
export async function initStore() {
  const mongo = useMongo()
  backend = mongo ? await makeMongoBackend() : makeFileBackend()
  backendMode = mongo ? 'mongo' : 'file'
  await backend.init()
  console.log(`[store] mode: ${backendMode}`)
  return backend
}
export function storeMode() { return backendMode }
export function storeReady() { return Boolean(backend?.isReady?.()) }
export async function closeStore() { if (backend?.close) await backend.close() }
export function store() {
  if (!backend) throw new Error('store not initialized — call initStore() first')
  return backend
}
