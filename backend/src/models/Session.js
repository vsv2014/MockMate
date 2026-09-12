import mongoose from 'mongoose'

const sessionSchema = new mongoose.Schema({
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  mode:       { type: String, enum: ['live', 'solo', 'mock', 'coding'], default: 'live' },
  title:      { type: String, default: '', trim: true, maxlength: 160 },
  company:    { type: String, default: '', trim: true, maxlength: 160 },
  role:       { type: String, default: '', trim: true, maxlength: 160 },
  objective:  { type: String, default: '', trim: true, maxlength: 1000 },
  customInstructions: { type: String, default: '', trim: true, maxlength: 8000 },
  responseStyle: { type: String, enum: ['concise', 'balanced', 'detailed'], default: 'concise' },
  selectedDocumentIds: { type: [String], default: [] },
  source:     { type: String, enum: ['desktop', 'mobile', 'web'], default: 'desktop' },
  transcript: { type: Array, default: [] },   // [{ text, ts, isQuestion, answer }]
  notes:      { type: String, default: '' },
  score:      { type: Object, default: null } // solo-mode scorecard
}, { timestamps: true })

export const Session = mongoose.model('Session', sessionSchema)
