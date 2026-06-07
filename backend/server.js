import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { connectDB } from './src/db.js'
import authRoutes from './src/routes/auth.js'
import meRoutes from './src/routes/me.js'
import sessionRoutes from './src/routes/sessions.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

app.get('/health', (req, res) => res.json({ ok: true }))
app.use('/auth', authRoutes)
app.use('/me', meRoutes)
app.use('/sessions', sessionRoutes)

const PORT = process.env.PORT || 4000
connectDB(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mockmate')
  .then(() => app.listen(PORT, () => console.log(`[backend] auth API on :${PORT}`)))
  .catch(e => { console.error('[backend] DB connection failed:', e.message); process.exit(1) })
