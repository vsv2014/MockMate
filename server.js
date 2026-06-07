// Serves BOTH the /api/* routes AND the built React UI (dist/) so the packaged
// Electron app loads the renderer over http://localhost:PORT — making /assets
// and /api same-origin. (Loading the renderer via file:// breaks both: absolute
// /assets paths 404 and /api calls resolve to file:///api.) Also the dev API shim.
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { makeReport, availableProviders, deepgramConfigured, deepgramToken, searchConfigured } from './api/_lib/core.js'
import { interviewerTurn, evaluateSolo, generateHint, analyzeScreen } from './api/_lib/interview.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, 'dist')

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

// Serve the built React app (production) + SPA fallback for non-API routes
app.use(express.static(distDir))
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(distDir, 'index.html'))
})

const PORT = process.env.PORT || 3002
app.listen(PORT, () => {
  if (process.send) process.send({ type: 'ready' })   // tell Electron main the server is up
  console.log(`MockMate server on :${PORT} (UI + /api/*)`)
})
