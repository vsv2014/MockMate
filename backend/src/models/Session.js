import mongoose from 'mongoose'

const sessionSchema = new mongoose.Schema({
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  mode:       { type: String, enum: ['live', 'solo'], default: 'live' },
  transcript: { type: Array, default: [] },   // [{ text, ts, isQuestion, answer }]
  notes:      { type: String, default: '' },
  score:      { type: Object, default: null } // solo-mode scorecard
}, { timestamps: true })

export const Session = mongoose.model('Session', sessionSchema)
