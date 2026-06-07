import mongoose from 'mongoose'

const userSchema = new mongoose.Schema({
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String },              // absent for Google-only accounts
  googleId:     { type: String, index: true }, // set for Google sign-in
  name:         { type: String, default: '' },
  targetRole:   { type: String, default: '' },
  language:     { type: String, default: 'English' },
  resume:       { type: String, default: '' },  // stored per user's choice
  preferences:  { type: Object, default: {} },
  lastLogin:    { type: Date }
}, { timestamps: true })

// Never leak the hash to clients
userSchema.methods.toSafeJSON = function () {
  const { passwordHash, __v, ...rest } = this.toObject()
  return { ...rest, id: rest._id }
}

export const User = mongoose.model('User', userSchema)
