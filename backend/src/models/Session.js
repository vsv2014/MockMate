import mongoose from 'mongoose'

const transcriptTurnSchema = new mongoose.Schema({
  role: { type: String, enum: ['interviewer', 'candidate', 'assistant'], required: true },
  text: { type: String, default: '', maxlength: 8000 },
  answer: { type: String, default: '', maxlength: 12000 },
  isQuestion: { type: Boolean },
  kind: { type: String, enum: ['question', 'followup', 'answer'] },
  ts: { type: Number },
}, { _id: false })

const sessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  mode: { type: String, enum: ['live', 'solo', 'mock', 'coding'], default: 'live' },
  title: { type: String, default: '', trim: true, maxlength: 160 },
  company: { type: String, default: '', trim: true, maxlength: 160 },
  role: { type: String, default: '', trim: true, maxlength: 160 },
  objective: { type: String, default: '', trim: true, maxlength: 1000 },
  customInstructions: { type: String, default: '', trim: true, maxlength: 8000 },
  responseStyle: { type: String, enum: ['concise', 'balanced', 'detailed'], default: 'concise' },
  selectedDocumentIds: { type: [String], default: [], validate: v => Array.isArray(v) && v.length <= 50 },
  source: { type: String, enum: ['desktop', 'mobile', 'web'], default: 'desktop' },
  transcript: { type: [transcriptTurnSchema], default: [], validate: v => Array.isArray(v) && v.length <= 200 },
  notes: { type: String, default: '', maxlength: 8000 },
  score: { type: mongoose.Schema.Types.Mixed, default: null },
  revision: { type: Number, default: 0, min: 0 },
}, { timestamps: true })

sessionSchema.index({ user: 1, createdAt: -1 })

export const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema)
