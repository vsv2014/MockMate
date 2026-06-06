// Local dev only. On Vercel the api/ folder is served as serverless functions;
// this Express shim exposes the SAME /api/* routes (via the same core module) so
// `npm run dev` works without the Vercel CLI. It is NOT used in production.
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { makeReport, availableProviders, deepgramConfigured, deepgramToken, searchConfigured } from './api/_lib/core.js'
import { interviewerTurn, evaluateSolo, generateHint, analyzeScreen } from './api/_lib/interview.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

app.get('/api/providers', (req, res) => res.json({ providers: availableProviders(), deepgram: deepgramConfigured(), search: searchConfigured() }))

app.post('/api/deepgram-token', async (req, res) => {
  const host = req.headers.host || ''
  const local = host.startsWith('localhost') || host.startsWith('127.')
  try { res.json(await deepgramToken({ allowRawKey: local })) }
  catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})


app.post('/api/report', async (req, res) => {
  try { res.json({ report: await makeReport(req.body || {}) }) }
  catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})

app.post('/api/interview', async (req, res) => {
  try { res.json({ turn: await interviewerTurn(req.body || {}) }) }
  catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})

app.post('/api/evaluate', async (req, res) => {
  try { res.json({ report: await evaluateSolo(req.body || {}) }) }
  catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})

app.post('/api/hint', async (req, res) => {
  try { res.json({ hint: await generateHint(req.body || {}) }) }
  catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})

app.post('/api/analyze-screen', async (req, res) => {
  try { res.json({ analysis: await analyzeScreen(req.body || {}) }) }
  catch (e) { res.status(e.status || 500).json({ error: e.message }) }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`interview-coach dev API on :${PORT} (mirrors Vercel /api/*)`))
