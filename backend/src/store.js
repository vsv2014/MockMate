// Storage layer — one small data API, two interchangeable backends.
//
//   • file  (DEFAULT): a JSON file under MOCKMATE_DATA_DIR. Zero infra, offline-safe.
//             This is what the forked desktop backend uses so MockMate works on
//             first launch with no MongoDB installed.
//   • mongo (opt-in):  set MONGO_URI and it switches to Mongoose — same API, no
//             route changes. Point it at hosted Mongo later with only an env var.
//
// mongoose is imported DYNAMICALLY (mongo mode only) so the file-mode boot never
// requires it — the desktop bundle doesn't ship mongoose at all.

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const useMongo = () => Boolean(String(process.env.MONGO_URI || '').trim())

export function currentPeriod() {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// Public, transport-safe view of a user. Never includes passwordHash.
export function toSafeUser(u) {
  if (!u) return null
  return {
    id: String(u.id || u._id),
    email: u.email,
    name: u.name || '',
    plan: u.plan || 'free',
    targetRole: u.targetRole || '',
    yearsExp: u.yearsExp || '',
    currentRole: u.currentRole || '',
    language: u.language || 'English',
    hasResume: !!u.resume,
    preferences: u.preferences && typeof u.preferences === 'object' ? u.preferences : {},
    createdAt: u.createdAt,
  }
}

function makeFileBackend() {
  const dir = process.env.MOCKMATE_DATA_DIR || path.join(process.cwd(), '.data')
  const file = path.join(dir, 'auth-db.json')
  let db = { users: [], usage: [] }
  let writeChain = Promise.resolve()

  function load() {
    try {
      fs.mkdirSync(dir, { recursive: true })
      if (fs.existsSync(file)) db = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (e) { console.error('[store] load failed, starting empty:', e.message) }
    if (!db.users) db.users = []
    if (!db.usage) db.usage = []
  }
  function persist() {
    writeChain = writeChain.then(() => new Promise((resolve, reject) => {
      const tmp = file + '.tmp'
      try {
        fs.writeFileSync(tmp, JSON.stringify(db, null, 2))
        fs.renameSync(tmp, file)
        resolve()
      } catch (e) {
        console.error('[store] persist failed:', e.message)
        reject(e)
      }
    }))
    return writeChain
  }

  load()

  return {
    async init() {},
    async findUserByEmail(email) {
      const e = (email || '').toLowerCase()
      return db.users.find(u => u.email === e) || null
    },
    async findUserById(id) { return db.users.find(u => String(u.id) === String(id)) || null },
    async findUserByGoogleId(googleId) { return db.users.find(u => u.googleId === googleId) || null },
    async findUserByResetToken(hash) { return db.users.find(u => u.resetTokenHash && u.resetTokenHash === hash) || null },
    async findUserByStripeCustomerId(cid) { return db.users.find(u => u.stripeCustomerId && u.stripeCustomerId === cid) || null },
    async createUser(doc) {
      const now = new Date().toISOString()
      const user = {
        id: crypto.randomUUID(), email: (doc.email || '').toLowerCase(), passwordHash: doc.passwordHash || null,
        googleId: doc.googleId || null, name: doc.name || '', plan: 'free', currentRole: doc.currentRole || '',
        targetRole: doc.targetRole || '', yearsExp: doc.yearsExp || '', language: doc.language || 'English',
        resume: doc.resume || '', preferences: doc.preferences || {}, stripeCustomerId: null, planExpiry: null,
        resetTokenHash: null, resetTokenExp: null, tokenVersion: 0, createdAt: now, lastLogin: doc.lastLogin || null,
      }
      db.users.push(user)
      await persist()
      return user
    },
    async updateUser(id, patch) {
      const u = db.users.find(x => String(x.id) === String(id))
      if (!u) return null
      const previous = structuredClone(u)
      Object.assign(u, patch)
      try { await persist(); return u }
      catch (error) { Object.assign(u, previous); throw error }
    },
    async deleteUser(id) {
      const prevUsers = db.users
      const prevUsage = db.usage
      const before = db.users.length
      db.users = db.users.filter(u => String(u.id) !== String(id))
      db.usage = db.usage.filter(r => String(r.userId) !== String(id))
      if (db.users.length === before) return false
      try { await persist(); return true }
      catch (error) { db.users = prevUsers; db.usage = prevUsage; throw error }
    },
    async getUsage(userId, period) {
      return db.usage.find(r => String(r.userId) === String(userId) && r.period === period)
        || { userId: String(userId), period, llmCalls: 0, sttSeconds: 0 }
    },
    async addUsage(userId, period, { llmCalls = 0, sttSeconds = 0 }) {
      let r = db.usage.find(x => String(x.userId) === String(userId) && x.period === period)
      if (!r) { r = { userId: String(userId), period, llmCalls: 0, sttSeconds: 0 }; db.usage.push(r) }
      const before = { llmCalls: r.llmCalls, sttSeconds: r.sttSeconds }
      r.llmCalls += llmCalls; r.sttSeconds += sttSeconds
      try { await persist(); return r }
      catch (error) { r.llmCalls = before.llmCalls; r.sttSeconds = before.sttSeconds; throw error }
    },
    async reserveLlmUsage() { return true },
    async releaseLlmUsage() { return true },
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
    async findUserByEmail(email) { return lean(await User.findOne({ email: (email || '').toLowerCase() })) },
    async findUserById(id) { try { return lean(await User.findById(id)) } catch { return null } },
    async findUserByGoogleId(googleId) { return lean(await User.findOne({ googleId })) },
    async findUserByResetToken(hash) { return lean(await User.findOne({ resetTokenHash: hash })) },
    async findUserByStripeCustomerId(cid) { return lean(await User.findOne({ stripeCustomerId: cid })) },
    async createUser(doc) { return lean(await User.create({ ...doc, email: (doc.email || '').toLowerCase() })) },
    async updateUser(id, patch) { return lean(await User.findByIdAndUpdate(id, patch, { new: true })) },
    async deleteUser(id) { const [result] = await Promise.all([User.deleteOne({ _id: id }), Usage.deleteMany({ userId: id })]); return result.deletedCount === 1 },
    async getUsage(userId, period) { return (await Usage.findOne({ userId, period })) || { userId: String(userId), period, llmCalls: 0, sttSeconds: 0 } },
    async addUsage(userId, period, { llmCalls = 0, sttSeconds = 0 }) { return await Usage.findOneAndUpdate({ userId, period }, { $inc: { llmCalls, sttSeconds } }, { new: true, upsert: true }) },
    async reserveLlmUsage(userId, period, limit) {
      try { await Usage.updateOne({ userId, period }, { $setOnInsert: { llmCalls: 0, sttSeconds: 0 } }, { upsert: true }) }
      catch (e) { if (e?.code !== 11000) throw e }
      const reserved = await Usage.findOneAndUpdate({ userId, period, llmCalls: { $lt: limit } }, { $inc: { llmCalls: 1 } }, { new: true })
      return !!reserved
    },
    async releaseLlmUsage(userId, period) { await Usage.updateOne({ userId, period, llmCalls: { $gt: 0 } }, { $inc: { llmCalls: -1 } }); return true },
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
export function store() {
  if (!backend) throw new Error('store not initialized — call initStore() first')
  return backend
}
