import fs from 'node:fs'

function read(file) { return fs.readFileSync(file, 'utf8') }
function write(file, text) { fs.writeFileSync(file, text) }
function once(file, before, after) {
  const text = read(file)
  const count = text.split(before).length - 1
  if (count !== 1) throw new Error(`${file}: expected one match, found ${count}: ${before.slice(0, 100)}`)
  write(file, text.replace(before, after))
}

// ── core.js: keep known-good model discovery until a replacement succeeds; a caller-specific
// 400 may fail over for that request but must not globally bench an otherwise healthy provider.
const core = 'api/_lib/core.js'
once(core,
`export async function listModels() {
  const out = []
  // A key may have been replaced in Settings. Never retain availability learned from the old
  // credential; a failed refresh simply falls back to conservative catalog defaults.
  for (const provider of ['openai', 'claude_sonnet', 'gemini', 'groq', 'cerebras']) discoveredModels.delete(provider)
  const push = (provider, model, label) => {
    if (!model) return
    rememberDiscovered(provider, model)
    out.push({ id: \`${'${provider}'}::${'${model}'}\`, provider, model, label })
  }
  const settle = async (fn) => { try { await fn() } catch {} }
`,
`export async function listModels() {
  const out = []
  const staged = new Map()
  const push = (provider, model, label) => {
    if (!model) return
    if (!staged.has(provider)) staged.set(provider, new Set())
    staged.get(provider).add(model)
    out.push({ id: \`${'${provider}'}::${'${model}'}\`, provider, model, label })
  }
  // Replace a provider's known-good set only after that provider was queried successfully.
  // A transient discovery outage must not erase models already proven usable mid-interview.
  const settle = async (provider, fn) => {
    try {
      await fn()
      discoveredModels.set(provider, new Set(staged.get(provider) || []))
    } catch {}
  }
`)
once(core, "process.env.OPENAI_API_KEY && settle(async () => {", "process.env.OPENAI_API_KEY && settle('openai', async () => {")
once(core, "process.env.ANTHROPIC_API_KEY && settle(async () => {", "process.env.ANTHROPIC_API_KEY && settle('claude_sonnet', async () => {")
once(core, "process.env.GEMINI_API_KEY && settle(async () => {", "process.env.GEMINI_API_KEY && settle('gemini', async () => {")
once(core, "process.env.GROQ_API_KEY && settle(async () => {", "process.env.GROQ_API_KEY && settle('groq', async () => {")
once(core, "process.env.CEREBRAS_API_KEY && settle(async () => {", "process.env.CEREBRAS_API_KEY && settle('cerebras', async () => {")
once(core,
`export function isProviderHardFail(e) {
  const s = e?.status ?? e?.statusCode
  return s === 400 || s === 401 || s === 403 || s === 404
}`,
`export function isProviderHardFail(e) {
  const s = e?.status ?? e?.statusCode
  // 401/403/404 describe credential/model availability and can cool the provider family.
  // A generic 400 is commonly request/model-parameter specific: fail over THIS request without
  // poisoning the provider for every other user/turn.
  return s === 401 || s === 403 || s === 404
}`)
once(core,
`  if (isQuotaExhausted(e) || isRateLimit(e) || isTransient(e) || isProviderHardFail(e)) return true`,
`  const status = e?.status ?? e?.statusCode
  if (status === 400 || isQuotaExhausted(e) || isRateLimit(e) || isTransient(e) || isProviderHardFail(e)) return true`)
once(core,
`process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001'`,
`process.env.GEMINI_EMBED_MODEL || process.env.EMBED_MODEL || 'gemini-embedding-001'`)

// ── system audio STT: fix lock-boundary role calculation, preserve diarization on Nova-2,
// bound reconnect replay, and reacquire dead devices instead of reconnecting a dead MediaStream.
const systemAudio = 'src/useSystemAudio.js'
once(systemAudio, 'const MAX_QUEUE_BYTES = 30 * BYTES_PER_SEC  // ~30 s of audio (~960 KB)', 'const MAX_QUEUE_BYTES = 5 * BYTES_PER_SEC   // recent speech only; never replay a stale 30s backlog')
once(systemAudio, "  if (degraded) return base   // plain proven baseline — drop diarize + keyterms if the enhanced config won't connect", "  if (degraded) return base + '&diarize=true'   // drop keyterms/model complexity, preserve speaker separation")
once(systemAudio,
`  const keytermsRef = useRef([])
  const langRef = useRef('en-US')   // Deepgram transcription language (from the interview language)`,
`  const keytermsRef = useRef([])
  const langRef = useRef('en-US')   // Deepgram transcription language (from the interview language)
  const sourceIdRef = useRef('microphone')
  const startOptsRef = useRef({})`)
once(systemAudio, '      const isCandidate = candidateSpeaker.current != null && sp === candidateSpeaker.current', '      let isCandidate = candidateSpeaker.current != null && sp === candidateSpeaker.current')
once(systemAudio,
`            setDiarizationLocked(true)
          }
        }
        lastEarlyTrigger.current = ''`,
`            setDiarizationLocked(true)
          }
          // Recompute AFTER the lock update. The utterance that establishes the lock must be
          // classified using the new speaker mapping, not the previous render's mapping.
          isCandidate = candidateSpeaker.current != null && sp === candidateSpeaker.current
        }
        lastEarlyTrigger.current = ''`)
once(systemAudio,
`          diarizationLocked: !!interviewerSpeaker.current,
          degraded: !!degradedAudio.current,`,
`          diarizationLocked: !!interviewerSpeaker.current,
          interviewerSpeaker: interviewerSpeaker.current,
          speakerRole: interviewerSpeaker.current != null && sp != null
            ? (sp === interviewerSpeaker.current ? 'interviewer' : (candidateSpeaker.current != null && sp === candidateSpeaker.current ? 'candidate' : 'unknown'))
            : 'unknown',
          degraded: !!degradedAudio.current,`)
once(systemAudio,
`        if (!isCandidate && confidence > 0.82 && looksLikeQuestion(text) && text !== lastEarlyTrigger.current) {`,
`        const earlyIsInterviewer = sourceIdRef.current !== 'microphone'
          || (interviewerSpeaker.current != null && sp === interviewerSpeaker.current)
        if (earlyIsInterviewer && !isCandidate && confidence > 0.82 && looksLikeQuestion(text) && text !== lastEarlyTrigger.current) {`)
once(systemAudio,
`  // If the ENHANCED transcription socket fails before EVER connecting, the diarize/
  // keyterms config is the likely culprit — drop to the plain proven config and retry
  // once. A drop AFTER a successful connect is just network, so it does NOT degrade.
  function failOrDegrade(reason) {
    if (!degradedAudio.current && !everConnected.current) {`,
`  // Drop enhanced model/keyterms once when needed, but preserve diarization so microphone Live
  // never turns into an unlabeled transcript after a mid-session provider/config failure.
  function failOrDegrade(reason) {
    if (!degradedAudio.current) {`)
once(systemAudio,
`    keytermsRef.current = sanitizeKeyterms(opts.keyterms)
    if (opts.language) langRef.current = opts.language`,
`    keytermsRef.current = sanitizeKeyterms(opts.keyterms)
    sourceIdRef.current = sourceId || 'microphone'
    startOptsRef.current = { ...opts }
    if (opts.language) langRef.current = opts.language`)
once(systemAudio,
`    navigator.mediaDevices?.addEventListener?.('devicechange', afterWake)`,
`    const onDeviceChange = async () => {
      if (userStop.current) return
      const liveTrack = stream.current?.getAudioTracks?.().some(t => t.readyState === 'live')
      if (liveTrack) return afterWake()
      diagnostic('stt', 'audio_device_reacquire', { source: sourceIdRef.current }, 'warn')
      try { await restart(sourceIdRef.current, startOptsRef.current) }
      catch (e) { onFailRef.current?.(e?.message || 'Audio device recovery failed') }
    }
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange)`)
once(systemAudio, "navigator.mediaDevices?.removeEventListener?.('devicechange', afterWake)", "navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange)")
once(systemAudio, '  }, [connectSocket])', '  }, [connectSocket, restart])')

// ── Solo: durable crash checkpoint + recovery, and never reopen capture while speechSynthesis
// still owns TTS after a watchdog timeout.
const solo = 'src/Solo.jsx'
once(solo, "import { saveSession } from './history'", "import { saveSession, saveSoloDraft, loadSoloDraft, clearSoloDraft } from './history'")
once(solo,
`  const [setupError, setSetupError] = useState('')`,
`  const [setupError, setSetupError] = useState('')
  const [resumeDraft, setResumeDraft] = useState(() => loadSoloDraft())`)
once(solo,
`  useEffect(() => { ttsEnabledRef.current = tts }, [tts])`,
`  useEffect(() => { ttsEnabledRef.current = tts }, [tts])

  // Checkpoint active practice locally. This is intentionally separate from completed history:
  // a renderer reload/crash can resume without pretending an interrupted interview was scored.
  useEffect(() => {
    if (phase !== 'live' || !sessionActiveRef.current) return
    const timer = setTimeout(() => saveSoloDraft({
      sessionId: sessionIdRef.current,
      transcript, answer, practiceQ, currentQuestion,
      elapsedMs: Math.max(0, Date.now() - startedAt.current),
      profile, interviewConfig: interviewConfigRef.current,
      interviewType, voiceStyle, followupDepth, relentless, tts,
    }), 250)
    return () => clearTimeout(timer)
  }, [phase, transcript, answer, practiceQ, currentQuestion, profile, interviewType, voiceStyle, followupDepth, relentless, tts])`)
once(solo,
`    ttsWatchdogRef.current = setTimeout(() => {
      if (!ttsGen.current.isCurrent(g)) return
      ttsBusy.current = false
      setTtsPlaying(false)
      resumeMicFor(g)
    }, 45000)`,
`    ttsWatchdogRef.current = setTimeout(() => {
      if (!ttsGen.current.isCurrent(g)) return
      // A watchdog is a failure boundary, not proof that TTS ended. Cancel the utterance before
      // reopening candidate capture so MockMate can never transcribe its own stuck voice.
      try { window.speechSynthesis?.cancel() } catch {}
      ttsBusy.current = false
      setTtsPlaying(false)
      resumeMicFor(g)
    }, 45000)`)
once(solo,
`  async function start() {`,
`  function resumeInterrupted() {
    const draft = resumeDraft
    if (!draft?.transcript?.length) { clearSoloDraft(); setResumeDraft(null); return }
    const restoredProfile = { ...profile, ...(draft.profile || {}) }
    setProfile(restoredProfile); persistProfile(restoredProfile)
    setInterviewType(draft.interviewType || restoredProfile.interviewType || 'Technical')
    setVoiceStyle(draft.voiceStyle || restoredProfile.voiceStyle || 'Professional')
    setFollowupDepth(draft.followupDepth || 'normal')
    setRelentless(!!draft.relentless); setTts(draft.tts !== false)
    sessionIdRef.current = draft.sessionId || createSessionId()
    interviewConfigRef.current = draft.interviewConfig || buildInterviewConfig({ profile: restoredProfile, selectedDocumentIds: getSelectedDocIds(), source: 'solo' })
    sessionActiveRef.current = true
    startLockRef.current = false; submitLockRef.current = false
    const restored = draft.transcript.slice(-300)
    setTranscript(restored); transcriptRef.current = restored
    setAnswer(draft.answer || ''); answerRef.current = draft.answer || ''
    setPracticeQ(draft.practiceQ || '')
    setCurrentQuestion(Math.max(0, Number(draft.currentQuestion) || 0))
    startedAt.current = Date.now() - Math.max(0, Number(draft.elapsedMs) || 0)
    setClock(Math.max(0, Number(draft.elapsedMs) || 0))
    setError('Recovered your interrupted practice session. Voice is paused until you choose Resume.')
    voiceRef.current = false
    setPhase('live'); phaseRef.current = 'live'
    setResumeDraft(null)
  }

  async function start() {`)
once(solo,
`    startLockRef.current = true
    sessionIdRef.current = createSessionId()`,
`    startLockRef.current = true
    clearSoloDraft(); setResumeDraft(null)
    sessionIdRef.current = createSessionId()`)
once(solo,
`      sessionActiveRef.current = false
      onHome()`,
`      sessionActiveRef.current = false
      clearSoloDraft()
      onHome()`)
once(solo,
`    sessionActiveRef.current = false
    setEvaluating(false)`,
`    sessionActiveRef.current = false
    clearSoloDraft()
    setResumeDraft(null)
    setEvaluating(false)`)
once(solo,
`    sessionActiveRef.current = false
    sessionIdRef.current = null`,
`    sessionActiveRef.current = false
    clearSoloDraft(); setResumeDraft(null)
    sessionIdRef.current = null`)
once(solo,
`      {setupError && <div role="alert" style={{ fontSize: 12, color: '#fca5a5' }}>⚠ {setupError}</div>}`,
`      {setupError && <div role="alert" style={{ fontSize: 12, color: '#fca5a5' }}>⚠ {setupError}</div>}
      {resumeDraft?.transcript?.length > 0 && (
        <div style={{ background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.35)', borderRadius: T.rCtrl, padding: '10px 12px', fontSize: 12, color: T.text2 }}>
          <strong style={{ color: '#5eead4' }}>Interrupted practice found.</strong> {resumeDraft.transcript.length} saved turn{resumeDraft.transcript.length === 1 ? '' : 's'} can be recovered.
          <span style={{ float: 'right', display: 'inline-flex', gap: 6 }}>
            <button onClick={resumeInterrupted} style={{ ...textInput, width: 'auto', padding: '5px 10px', cursor: 'pointer' }}>Resume</button>
            <button onClick={() => { clearSoloDraft(); setResumeDraft(null) }} style={{ ...textInput, width: 'auto', padding: '5px 10px', cursor: 'pointer' }}>Discard</button>
          </span>
        </div>
      )}`)

console.log('audit-autopatch complete')
