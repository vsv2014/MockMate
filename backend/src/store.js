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

const USE_MONGO = !!process.env.MONGO_URI

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
    createdAt: u.createdAt,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE BACKEND
// ─────────────────────────────────────────────────────────────────────────────
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
  // Serialize writes; write to a temp file then rename (atomic, crash-safe).
  function persist() {
    writeChain = writeChain.then(() => new Promise(resolve => {
      const tmp = file + '.tmp'
      try {
        fs.writeFileSync(tmp, JSON.stringify(db, null, 2))
        fs.renameSync(tmp, file)
      } catch (e) { console.error('[store] persist failed:', e.message) }
      resolve()
    }))
    return writeChain
  }

  load()

  return {
    async init() { /* already loaded */ },

    async findUserByEmail(email) {
      const e = (email || '').toLowerCase()
      return db.users.find(u => u.email === e) || null
    },
    async findUserById(id) {
      return db.users.find(u => String(u.id) === String(id)) || null
    },
    async findUserByGoogleId(googleId) {
      return db.users.find(u => u.googleId === googleId) || null
    },
    async findUserByResetToken(hash) {
      return db.users.find(u => u.resetTokenHash && u.resetTokenHash === hash) || null
    },
    async createUser(doc) {
      const now = new Date().toISOString()
      const user = {
        id: crypto.randomUUID(),
        email: (doc.email || '').toLowerCase(),
        passwordHash: doc.passwordHash || null,
        googleId: doc.googleId || null,
        name: doc.name || '',
        plan: 'free',
        currentRole: doc.currentRole || '',
        targetRole: doc.targetRole || '',
        yearsExp: doc.yearsExp || '',
        language: doc.language || 'English',
        resume: doc.resume || '',
        preferences: doc.preferences || {},
        stripeCustomerId: null,
        planExpiry: null,
        resetTokenHash: null,
        resetTokenExp: null,
        tokenVersion: 0,
        createdAt: now,
        lastLogin: doc.lastLogin || null,
      }
      db.users.push(user)
      await persist()
      return user
    },
    async updateUser(id, patch) {
      const u = db.users.find(x => String(x.id) === String(id))
      if (!u) return null
      Object.assign(u, patch)
      await persist()
      return u
    },

    async getUsage(userId, period) {
      return db.usage.find(r => String(r.userId) === String(userId) && r.period === period)
        || { userId: String(userId), period, llmCalls: 0, sttSeconds: 0 }
    },
    async addUsage(userId, period, { llmCalls = 0, sttSeconds = 0 }) {
      let r = db.usage.find(x => String(x.userId) === String(userId) && x.period === period)
      if (!r) { r = { userId: String(userId), period, llmCalls: 0, sttSeconds: 0 }; db.usage.push(r) }
      r.llmCalls += llmCalls
      r.sttSeconds += sttSeconds
      await persist()
      return r
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MONGO BACKEND (lazy — only loaded when MONGO_URI is set)
// ─────────────────────────────────────────────────────────────────────────────
async function makeMongoBackend() {
  const mongoose = (await import('mongoose')).default

  const userSchema = new mongoose.Schema({
    email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String },
    googleId:     { type: String, index: true },
    name:         { type: String, default: '' },
    plan:         { type: String, default: 'free' },
    currentRole:  { type: String, default: '' },
    targetRole:   { type: String, default: '' },
    yearsExp:     { type: String, default: '' },
    language:     { type: String, default: 'English' },
    resume:       { type: String, default: '' },
    preferences:  { type: Object, default: {} },
    stripeCustomerId: { type: String, default: null },
    planExpiry:   { type: Date, default: null },
    resetTokenHash: { type: String, default: null, index: true },
    resetTokenExp:  { type: Number, default: null },
    tokenVersion: { type: Number, default: 0 },
    lastLogin:    { type: Date },
  }, { timestamps: true })

  const usageSchema = new mongoose.Schema({
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    period:     { type: String, required: true },   // 'YYYY-MM'
    llmCalls:   { type: Number, default: 0 },
    sttSeconds: { type: Number, default: 0 },
  }, { timestamps: true })
  usageSchema.index({ userId: 1, period: 1 }, { unique: true })

  const User = mongoose.models.User || mongoose.model('User', userSchema)
  const Usage = mongoose.models.Usage || mongoose.model('Usage', usageSchema)
  const lean = u => (u ? { ...u.toObject(), id: String(u._id) } : null)

  return {
    async init() {
      mongoose.set('strictQuery', true)
      await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 })
      console.log('[store] mongo connected:', mongoose.connection.name)
    },
    async findUserByEmail(email) { return lean(await User.findOne({ email: (email || '').toLowerCase() })) },
    async findUserById(id) { try { return lean(await User.findById(id)) } catch { return null } },
    async findUserByGoogleId(googleId) { return lean(await User.findOne({ googleId })) },
    async findUserByResetToken(hash) { return lean(await User.findOne({ resetTokenHash: hash })) },
    async createUser(doc) { return lean(await User.create({ ...doc, email: (doc.email || '').toLowerCase() })) },
    async updateUser(id, patch) { return lean(await User.findByIdAndUpdate(id, patch, { new: true })) },
    async getUsage(userId, period) {
      return (await Usage.findOne({ userId, period }))
        || { userId: String(userId), period, llmCalls: 0, sttSeconds: 0 }
    },
    async addUsage(userId, period, { llmCalls = 0, sttSeconds = 0 }) {
      return await Usage.findOneAndUpdate(
        { userId, period },
        { $inc: { llmCalls, sttSeconds } },
        { new: true, upsert: true }
      )
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
let backend = null
export async function initStore() {
  backend = USE_MONGO ? await makeMongoBackend() : makeFileBackend()
  await backend.init()
  console.log(`[store] mode: ${USE_MONGO ? 'mongo' : 'file'}`)
  return backend
}
export function store() {
  if (!backend) throw new Error('store not initialized — call initStore() first')
  return backend
}
