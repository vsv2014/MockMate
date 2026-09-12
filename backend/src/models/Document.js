import mongoose from 'mongoose'

const documentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 180 },
  type: { type: String, enum: ['resume', 'jd', 'knowledge', 'supporting', 'training', 'document'], default: 'document' },
  text: { type: String, required: true, maxlength: 300000 },
  chars: { type: Number, required: true, min: 1, max: 300000 },
}, { timestamps: true })

documentSchema.index({ user: 1, createdAt: -1 })

export const Document = mongoose.model('Document', documentSchema)
