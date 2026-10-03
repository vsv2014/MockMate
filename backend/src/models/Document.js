import mongoose from 'mongoose'

export const MAX_HOSTED_DOCUMENTS = 20

const documentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 180 },
  type: { type: String, enum: ['resume', 'jd', 'knowledge', 'supporting', 'training', 'document'], default: 'document' },
  text: { type: String, required: true, maxlength: 300000 },
  chars: { type: Number, required: true, min: 1, max: 300000 },
  // New documents occupy one of 20 atomic slots. The unique index makes the cap
  // concurrency-safe even when multiple uploads race the same count check.
  slot: { type: Number, min: 0, max: MAX_HOSTED_DOCUMENTS - 1 },
}, { timestamps: true })

documentSchema.index({ user: 1, createdAt: -1 })
documentSchema.index({ user: 1, slot: 1 }, { unique: true, sparse: true })

export const Document = mongoose.models.Document || mongoose.model('Document', documentSchema)

function capError() {
  const error = new Error(`You can keep up to ${MAX_HOSTED_DOCUMENTS} hosted documents. Remove one before adding another.`)
  error.status = 409
  error.code = 'document_limit'
  return error
}

export async function createDocumentWithCap(doc) {
  const user = doc.user
  const legacyCount = await Document.countDocuments({ user, slot: { $exists: false } })
  if (legacyCount >= MAX_HOSTED_DOCUMENTS) throw capError()

  // A duplicate-key race only means another request claimed the same slot first.
  // Refresh and retry until a different free slot is claimed or all 20 are occupied.
  for (let round = 0; round < MAX_HOSTED_DOCUMENTS + 2; round += 1) {
    const used = new Set((await Document.find({ user, slot: { $exists: true } }).select('slot').lean()).map(row => row.slot))
    if (legacyCount + used.size >= MAX_HOSTED_DOCUMENTS) throw capError()
    const slot = Array.from({ length: MAX_HOSTED_DOCUMENTS }, (_, i) => i).find(i => !used.has(i))
    if (slot == null) throw capError()
    try { return await Document.create({ ...doc, slot }) }
    catch (error) {
      if (error?.code === 11000) continue
      throw error
    }
  }
  throw capError()
}
