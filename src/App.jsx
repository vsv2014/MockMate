import React, { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from './lib/apiClient'
import Solo from './Solo'
import LiveCompanion from './LiveCompanion'
import Duo from './Duo'
import Jobs from './Jobs'
import Career from './Career'
import Account from './Account'
import AuthGate from './auth/AuthGate'
import { T } from './auth/tokens'
import { AppShell, DashboardHome, SessionsTable } from './Dashboard'
import SoloFeedback from './SoloFeedback'
import WhatsNew from './WhatsNew'
import ApiKeysPanel from './ApiKeys'
import { getAiMode } from './lib/aiMode'
import { getAnswerStyle, setAnswerStyle, getScreenshotSpeed, setScreenshotSpeed, screenshotStyle, getAutoSkip, setAutoSkip, getDocThreshold, setDocThreshold } from './lib/aiSettings'
import { loadSessions, deleteSession } from './history'
import { scoreColor, TYPE_LABEL } from './lib/ui'
import { CODING_LANGUAGES } from './lib/languages'
import { loadProfile, saveProfile } from './lib/profile'
import {
  buildInterviewJobSeed,
  applyInterviewJobSeed,
  interviewSeedConfirmMessage,
} from './lib/interviewJobSeed'
import { copyText } from './lib/clipboard'
import { canRunLanguage, runJavaScriptIsolated } from './lib/codeRunner'
import {
  createScreenContextRecord,
  previousScreenForContinuation,
  screenContinuationCandidate,
  screenFingerprint,
} from '../shared/screenContext.js'

const inElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron
const isLinux = typeof window !== 'undefined' && window.electronAPI?.platform === 'linux'

// Views that render in the full windowed app shell (large window + sidebar). Solo runs
// here too — there's no interviewer watching, so it gets the roomy dashboard, not the
// overlay. ONLY the Live companion drops to the compact always-on-top overlay.
const SHELL_VIEWS = ['home', 'solo', 'duo', 'jobs', 'career', 'settings', 'account', 'history']

function StealthSafetyPrompt({ confirmOff, notice, onCancel, onConfirmOff }) {
  if (!confirmOff && !notice) return null
  return (
    <div data-mm-hit="1" style={{ position: 'fixed', inset: 0, zIndex: 20000, pointerEvents: 'none', display: 'flex', justifyContent: 'center', alignItems: confirmOff ? 'center' : 'flex-start', padding: confirmOff ? 18 : '54px 18px 0', boxSizing: 'border-box', fontFamily: T.font }}>
      {confirmOff && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.62)', pointerEvents: 'all' }} onClick={onCancel} />}
      <div role={confirmOff ? 'alertdialog' : 'status'} aria-live="assertive" style={{ position: 'relative', width: 'min(430px, 94vw)', background: confirmOff ? '#201116' : '#10211f', border: `1px solid ${confirmOff ? 'rgba(248,113,113,0.6)' : 'rgba(45,212,191,0.55)'}`, borderRadius: 12, boxShadow: '0 14px 44px rgba(0,0,0,0.6)', padding: '13px 15px', color: '#f8fafc', pointerEvents: 'all' }}>
        {confirmOff ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 750, color: '#fca5a5', marginBottom: 6 }}>Turn Stealth OFF?</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#e5e7eb' }}>MockMate may become visible in screen sharing and recordings. Turn it off only for a controlled visibility test.</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button type="button" onClick={onCancel} style={{ height: 34, padding: '0 13px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.16)', background: 'transparent', color: '#e5e7eb', cursor: 'pointer' }}>Keep Stealth ON</button>
              <button type="button" onClick={onConfirmOff} style={{ height: 34, padding: '0 13px', borderRadius: 7, border: 'none', background: '#dc2626', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Turn OFF</button>
            </div>
          </>
        ) : <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>{notice}</div>}
      </div>
    </div>
  )
}

// ── Not in Electron — show landing page ──────────────────────────────────────
function BrowserGate() {
  // Redirect to the landing page served from public/
  window.location.replace('/landing.html')
  return null
}

// ── Electron shell — wraps every screen in the floating overlay ───────────────
function ElectronShell({ auth }) {
  const [view, setView] = useState('home')
  const [careerSeed, setCareerSeed] = useState(null)       // one-shot Jobs → Resume Studio handoff
  const [whatsNewSignal, setWhatsNewSignal] = useState(0)   // bump to re-open the What's New modal
  const [report, setReport] = useState(null)
  const [panelSize, setPanelSize] = useState(() => {
    try {
      const raw = localStorage.getItem('mm-overlay-size')
      if (raw) {
        const p = JSON.parse(raw)
        if (p?.w >= 240 && p?.h >= 180) return { w: p.w, h: p.h }
      }
    } catch {}
    // LockedIn-style: start as a compact glance HUD, not a dashboard panel.
    return { w: 300, h: 360 }
  })
  const [opacity, setOpacity] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem('mm-overlay-opacity'))
      if (Number.isFinite(v) && v >= 0.35 && v <= 1) return v
    } catch {}
    return 0.92
  })   // slightly translucent by default (stealth apps expose a transparency slider)
  // Privacy-first default: hidden from supported capture APIs unless the user
  // explicitly turns Stealth off to test/demo the overlay.
  const [stealth, setStealth] = useState(true)
  const [stealthConfirmOff, setStealthConfirmOff] = useState(false)
  const [stealthNotice, setStealthNotice] = useState('')
  const stealthNoticeTimer = useRef(null)
  const [clickThrough, setClickThrough] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [screenAnalysis, setScreenAnalysis] = useState(null)   // vision analysis result
  const [screenAnalyzing, setScreenAnalyzing] = useState(false)
  const [screenFlowStatus, setScreenFlowStatus] = useState('')
  const profileRef = useRef({})
  const resizing = useRef(false)
  const resizeStart = useRef({})

  useEffect(() => {
    // Transparent body — no dark rectangle if panel is hidden
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
  }, [])

  // Stealth is explicit and on by default. Capture protection is independent
  // from transparency, pinning, click-through, and collapse-to-pill.
  useEffect(() => {
    if (!inElectron) return
    window.electronAPI?.setContentProtection?.(stealth).then(result => {
      if (stealth && result && !result.ok) setStealth(false)
    }).catch(() => { if (stealth) setStealth(false) })
  }, [stealth])

  function showStealthNotice(message) {
    clearTimeout(stealthNoticeTimer.current)
    setStealthNotice(message)
    stealthNoticeTimer.current = setTimeout(() => setStealthNotice(''), 4500)
  }

  async function applyStealth(next) {
    if (!inElectron) return
    try {
      const result = await window.electronAPI?.setContentProtection?.(next)
      if (!result?.ok) {
        setStealth(false)
        showStealthNotice(result?.unsupported
          ? 'Stealth is unavailable on this platform. Do not share the MockMate window.'
          : 'Capture protection could not be changed. Verify the meeting share preview.')
        return
      }
      setStealth(next)
      setStealthConfirmOff(false)
      showStealthNotice(next
        ? 'Stealth ON — capture protection enabled. Verify it in the meeting share preview.'
        : '⚠ Stealth OFF — MockMate may now be visible to others and in recordings.')
    } catch {
      showStealthNotice('Capture protection could not be changed. Stealth state was not trusted — verify the share preview.')
    }
  }

  function requestStealthToggle() {
    if (!inElectron || isLinux) return
    if (stealth) setStealthConfirmOff(true)
    else applyStealth(true)
  }

  const [noProviders, setNoProviders] = useState(false)
  const [meetingActive, setMeetingActive] = useState(false)
  const [codingDetected, setCodingDetected] = useState(false)
  const [browserShareWarning, setBrowserShareWarning] = useState(false)
  const recheckProviders = useCallback(() => {
    apiFetch('/api/providers').then(r => r.json()).then(d => {
      setNoProviders(!d.providers?.length)
    }).catch(() => {})
  }, [])
  useEffect(() => { recheckProviders() }, [recheckProviders])

  // First-run welcome: show once, only when no keys exist yet. Dismissed permanently
  // after the user saves a key or taps "Skip", so returning users never see it.
  const [welcomed, setWelcomed] = useState(() => { try { return localStorage.getItem('mm-welcomed') === '1' } catch { return false } })
  const dismissWelcome = useCallback(() => { try { localStorage.setItem('mm-welcomed', '1') } catch {} ; setWelcomed(true) }, [])
  // Managed AI needs no setup, so the first-run "connect a key" gate only applies to BYOK mode.
  const showWelcome = getAiMode() === 'byok' && !welcomed && noProviders

  // Past Solo sessions (stored locally, ~3 months) — for review/copy.
  const [sessions, setSessions] = useState(() => loadSessions())
  const [openSession, setOpenSession] = useState(null)
  const refreshSessions = useCallback(() => setSessions(loadSessions()), [])

  const [companionPhase, setCompanionPhase] = useState('setup')
  const viewRef = useRef(view)
  const companionPhaseRef = useRef(companionPhase)
  const panelSizeRef = useRef(panelSize)
  viewRef.current = view
  companionPhaseRef.current = companionPhase
  panelSizeRef.current = panelSize

  // Auto-detect meeting apps (Zoom, Teams, Meet) + coding platforms (LeetCode, etc.)
  useEffect(() => {
    const cleanups = []
    cleanups.push(window.electronAPI?.onMeetingDetected(context => setMeetingActive(context?.active ?? !!context)))
    cleanups.push(window.electronAPI?.onCodingDetected?.(active => setCodingDetected(active)))
    // Alt+H: collapse/expand on-screen pill everywhere after login — never vanish to tray.
    cleanups.push(window.electronAPI?.onShortcutStealth?.(() => {
      setClickThrough(false)
      setMinimized(m => {
        const next = !m
        if (!next && viewRef.current === 'companion' && companionPhaseRef.current === 'live') {
          const { w, h } = panelSizeRef.current || { w: 300, h: 360 }
          queueMicrotask(() => window.electronAPI?.windowResize?.(w, h))
        }
        return next
      })
    }))
    // Unpinned + switched to another app → collapse to pill (never vanish).
    cleanups.push(window.electronAPI?.onBlurCollapse?.(() => {
      setClickThrough(false)
      setMinimized(true)
    }))
    // Browser mode: warn if screen capture is likely active (getDisplayMedia check)
    if (!window.electronAPI?.isElectron) {
      navigator.mediaDevices?.addEventListener?.('devicechange', () => setBrowserShareWarning(true))
    }
    return () => cleanups.forEach(c => c?.())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Run vision analysis on a screenshot (optionally in a chosen coding language).
  // Single-flight + abort: rapid F7 presses used to stack requests and burn the vision
  // rate limit into "Screen analysis is busy right now".
  const lastShotRef = useRef(null)          // { base64, mime, displayId, displayName }
  const analysisAbortRef = useRef(null)
  const analysisGenRef = useRef(0)
  const analysisCacheRef = useRef(new Map()) // fingerprint → analysis
  const screenChainRef = useRef(null)       // immediately previous successful manual capture
  const captureQueueRef = useRef(Promise.resolve())
  const queuedCaptureCountRef = useRef(0)
  const screenSessionGenRef = useRef(0)
  const nextCaptureModeRef = useRef('auto')
  const screenUndoRef = useRef(null)         // exact state before the latest confirmed merge
  const liveSpokenQRef = useRef('')         // last Live interviewer Q (for vision scope)
  const [captureDisplays, setCaptureDisplays] = useState([])
  const [captureDisplayId, setCaptureDisplayId] = useState(() => {
    try { return localStorage.getItem('mm-capture-display-id') || '' } catch { return '' }
  })

  useEffect(() => {
    const refreshDisplays = () => window.electronAPI?.listScreenDisplays?.().then(r => {
      if (r?.displays?.length) {
        setCaptureDisplays(r.displays)
        setCaptureDisplayId(current => {
          if (!current || r.displays.some(d => String(d.id) === String(current))) return current
          try { localStorage.removeItem('mm-capture-display-id') } catch {}
          return ''
        })
      }
    }).catch(() => {})
    refreshDisplays()
    const off = window.electronAPI?.onDisplayChanged?.(refreshDisplays)
    return () => { try { off?.() } catch {} }
  }, [])

  const runAnalysis = useCallback(async (shot, language, { retry = 0 } = {}) => {
    const base64 = typeof shot === 'string' ? shot : shot?.base64
    const mime = (typeof shot === 'object' && shot?.mime) || 'image/png'
    if (!base64) {
      setScreenAnalysis(createScreenContextRecord({ error: 'No screenshot captured', status: 'not_captured' }))
      return
    }

    try { analysisAbortRef.current?.abort() } catch {}
    const abort = new AbortController()
    analysisAbortRef.current = abort
    const gen = ++analysisGenRef.current
    const style = screenshotStyle()
    const previousRecord = shot?.previousScreenRecord || null
    const previousScreen = previousScreenForContinuation(previousRecord)
    const continuationMode = shot?.continuationMode || 'auto'
    const fp = screenFingerprint(base64, {
      language: language || '', style,
      context: JSON.stringify({ profile: profileRef.current || {}, previousScreen, continuationMode }),
    })
    const requestId = `scr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
    const imageDimensions = (shot?.width && shot?.height)
      ? { width: shot.width, height: shot.height }
      : null

    const cached = analysisCacheRef.current.get(fp)
    if (cached && retry === 0) {
      const record = createScreenContextRecord({
        analysis: cached,
        screenContextId: cached.isContinuation && previousRecord?.screenContextId
          ? previousRecord.screenContextId
          : '',
        displayId: shot?.displayId,
        displayName: shot?.displayName,
        fingerprint: fp,
        mime,
        status: 'analyzed_cached',
      })
      if (!record.error) screenChainRef.current = record
      if (!record.error && cached.isContinuation && previousRecord) {
        screenUndoRef.current = { record: previousRecord, shot: shot?.previousShot || null }
      } else if (!record.error) {
        screenUndoRef.current = null
      }
      setScreenAnalysis(record)
      if (!record.error) {
        setScreenFlowStatus(cached.isContinuation
          ? `Combined ${cached._captureCount || 2} screenshots — one answer updated`
          : 'Captured as a new question')
      }
      setScreenAnalyzing(queuedCaptureCountRef.current > 1)
      return
    }

    setScreenAnalyzing(true)
    setScreenAnalysis(null)
    try {
      const res = await apiFetch('/api/analyze-screen', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          imageBase64: base64, mime, profile: profileRef.current, language,
          style,
          spokenQuestion: liveSpokenQRef.current || '',
          previousScreen,
          continuationMode,
          requestId, fingerprint: fp, imageDimensions,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (gen !== analysisGenRef.current) return
      const err = d.error || (!res.ok ? `Screen analysis failed (${res.status})` : null)
      const code = d.code || ''
      // At most ONE delayed client retry for transient 429 — never on cancel/auth.
      if (err && !abort.signal.aborted && (/busy|rate.?limit|429|VISION_RATE_LIMITED/i.test(err) || code === 'VISION_RATE_LIMITED') && retry < 1) {
        await new Promise(r => setTimeout(r, 1600))
        if (gen !== analysisGenRef.current || abort.signal.aborted) return
        return runAnalysis({
          base64, mime, displayId: shot?.displayId, displayName: shot?.displayName,
          width: shot?.width, height: shot?.height,
          previousScreenRecord, continuationMode,
        }, language, { retry: retry + 1 })
      }
      if (err) {
        setScreenAnalysis(createScreenContextRecord({
          error: err, status: 'failed',
          displayId: shot?.displayId, displayName: shot?.displayName, fingerprint: fp, mime,
        }))
      } else {
        let analysis = d.analysis || { error: 'Empty analysis' }
        if (!analysis.error) {
          const priorCount = Math.max(1, Number(previousRecord?.analysis?._captureCount) || 1)
          analysis = { ...analysis, _captureCount: analysis.isContinuation ? priorCount + 1 : 1 }
        }
        if (!analysis.error) {
          analysisCacheRef.current.set(fp, analysis)
          if (analysisCacheRef.current.size > 12) {
            const first = analysisCacheRef.current.keys().next().value
            analysisCacheRef.current.delete(first)
          }
        }
        const continuationId = analysis.isContinuation && previousRecord?.screenContextId
          ? previousRecord.screenContextId
          : ''
        const record = createScreenContextRecord({
          analysis: analysis.error ? null : analysis,
          screenContextId: continuationId,
          error: analysis.error || null,
          status: analysis.error ? 'failed' : 'analyzed',
          displayId: shot?.displayId, displayName: shot?.displayName, fingerprint: fp, mime,
        })
        if (!record.error) screenChainRef.current = record
        if (!record.error && analysis.isContinuation && previousRecord) {
          screenUndoRef.current = { record: previousRecord, shot: shot?.previousShot || null }
        } else if (!record.error) {
          screenUndoRef.current = null
        }
        setScreenAnalysis(record)
        if (!record.error) {
          setScreenFlowStatus(analysis.isContinuation
            ? `Combined ${analysis._captureCount} screenshots — one answer updated`
            : 'Captured as a new question')
        }
      }
    } catch (e) {
      if (abort.signal.aborted || gen !== analysisGenRef.current) return // cancelled — no retry
      setScreenAnalysis(createScreenContextRecord({
        error: e.message || 'Screen analysis failed', status: 'failed',
        displayId: shot?.displayId, displayName: shot?.displayName, mime,
      }))
    }
    // Keep the loading state stable when another captured screen is already
    // queued; the next analysis begins immediately and should not flash idle.
    if (gen === analysisGenRef.current) setScreenAnalyzing(queuedCaptureCountRef.current > 1)
  }, [])

  // Re-solve the SAME captured screen in a different language (no re-capture).
  const reanalyze = useCallback((language) => { if (lastShotRef.current) runAnalysis(lastShotRef.current, language) }, [runAnalysis])

  const capturePreferredScreen = useCallback(() => {
    const opts = captureDisplayId ? { displayId: captureDisplayId } : {}
    window.electronAPI?.captureScreen?.(opts)
  }, [captureDisplayId])

  const captureAsContinuation = useCallback(() => {
    nextCaptureModeRef.current = 'continue'
    setScreenFlowStatus('Capture the next portion — it will be combined with this question')
    capturePreferredScreen()
  }, [capturePreferredScreen])

  const captureAsNewQuestion = useCallback(() => {
    nextCaptureModeRef.current = 'new'
    setScreenFlowStatus('Capturing a separate new question')
    capturePreferredScreen()
  }, [capturePreferredScreen])

  const undoScreenMerge = useCallback(() => {
    const prior = screenUndoRef.current
    if (!prior?.record) return
    screenChainRef.current = prior.record
    lastShotRef.current = prior.shot || null
    screenUndoRef.current = null
    setScreenAnalyzing(false)
    setScreenAnalysis(prior.record)
    setScreenFlowStatus('Merge undone — restored the previous question and answer')
  }, [])

  // Listen for screen captures (Ctrl+Shift+U or "Solve it" button) from Electron
  useEffect(() => {
    const cleanup = window.electronAPI?.onScreenCaptured((payload) => {
      if (payload?.error) {
        nextCaptureModeRef.current = 'auto'
        const unsupported = payload.error === 'linux_unsupported'
        const message = unsupported
          ? 'Screen capture unavailable on Linux'
          : payload.error === 'no_sources'
            ? 'No screen source was available. Check OS screen-recording permission and try again.'
            : `Screen capture failed: ${payload.error}`
        setScreenFlowStatus('Capture failed — no continuation choice was carried forward')
        setScreenAnalyzing(false)
        setScreenAnalysis(createScreenContextRecord({ error: message, status: unsupported ? 'unsupported' : 'not_captured' }))
        return
      }
      const shot = typeof payload === 'string'
        ? { base64: payload, mime: 'image/png' }
        : {
          base64: payload?.base64,
          mime: payload?.mime || 'image/jpeg',
          displayId: payload?.displayId || null,
          displayName: payload?.displayName || null,
          width: payload?.width || null,
          height: payload?.height || null,
          bytes: payload?.bytes || null,
        }
      if (!shot.base64) {
        nextCaptureModeRef.current = 'auto'
        setScreenFlowStatus('Capture failed — no continuation choice was carried forward')
        setScreenAnalysis(createScreenContextRecord({ error: 'Screen not captured', status: 'not_captured' }))
        return
      }
      shot.continuationMode = nextCaptureModeRef.current
      nextCaptureModeRef.current = 'auto'
      const queuedForSession = screenSessionGenRef.current
      queuedCaptureCountRef.current += 1
      if (queuedCaptureCountRef.current > 1) {
        setScreenFlowStatus(`Screenshot queued (${queuedCaptureCountRef.current}) — earlier capture will not be cancelled`)
      }
      captureQueueRef.current = captureQueueRef.current.catch(() => {}).then(async () => {
        if (queuedForSession !== screenSessionGenRef.current) return
        const previous = screenChainRef.current
        if (shot.continuationMode === 'new') {
          screenChainRef.current = null
          screenUndoRef.current = null
        }
        const forcedContinue = shot.continuationMode === 'continue' && !!previous
        const automaticContinue = shot.continuationMode !== 'new' && screenContinuationCandidate(previous, shot)
        if (forcedContinue || automaticContinue) {
          shot.previousScreenRecord = previous
          setScreenFlowStatus(forcedContinue
            ? 'Combining this capture with the previous question…'
            : 'Checking whether this continues the previous question…')
        } else {
          setScreenFlowStatus('Analyzing as a new question…')
        }
        shot.previousShot = lastShotRef.current
        lastShotRef.current = shot
        await runAnalysis(shot)
      }).finally(() => {
        queuedCaptureCountRef.current = Math.max(0, queuedCaptureCountRef.current - 1)
      })
    })
    return () => cleanup?.()
  }, [runAnalysis])

  const dismissScreenAnalysis = useCallback(() => {
    try { analysisAbortRef.current?.abort() } catch {}
    analysisAbortRef.current = null
    analysisGenRef.current += 1
    screenSessionGenRef.current += 1
    captureQueueRef.current = Promise.resolve()
    queuedCaptureCountRef.current = 0
    nextCaptureModeRef.current = 'auto'
    lastShotRef.current = null
    screenChainRef.current = null
    screenUndoRef.current = null
    setScreenAnalyzing(false)
    setScreenFlowStatus('')
    setScreenAnalysis(null)
  }, [])

  // Live tells App the latest interviewer question for vision scoping.
  const onLiveSpokenQuestion = useCallback((q) => { liveSpokenQRef.current = q || '' }, [])

  // A Live session owns its question/screen context. Never carry the previous
  // session's last STT question or F7 analysis into a new LiveOverlay.
  const resetLiveSessionContext = useCallback(() => {
    try { analysisAbortRef.current?.abort() } catch {}
    analysisAbortRef.current = null
    analysisGenRef.current += 1
    liveSpokenQRef.current = ''
    lastShotRef.current = null
    screenChainRef.current = null
    screenUndoRef.current = null
    screenSessionGenRef.current += 1
    captureQueueRef.current = Promise.resolve()
    queuedCaptureCountRef.current = 0
    nextCaptureModeRef.current = 'auto'
    analysisCacheRef.current.clear()
    setScreenAnalyzing(false)
    setScreenAnalysis(null)
  }, [])

  // Resize + stealth keyboard shortcut
  useEffect(() => {
    const onMove = e => {
      if (!resizing.current) return
      const start = resizeStart.current
      const edge = start.edge || 'se'
      const dw = e.screenX - start.x
      const dh = e.screenY - start.y
      const MIN_W = 240, MIN_H = 180
      let newW = start.w
      let newH = start.h
      if (edge.includes('e')) newW = Math.max(MIN_W, start.w + dw)
      if (edge.includes('w')) newW = Math.max(MIN_W, start.w - dw)
      if (edge.includes('s')) newH = Math.max(MIN_H, start.h + dh)
      if (edge.includes('n')) newH = Math.max(MIN_H, start.h - dh)

      // Frame deltas so N/W resize moves the OS window instead of only growing SE.
      const moveDx = edge.includes('w') ? (start._lastW - newW) : 0
      const moveDy = edge.includes('n') ? (start._lastH - newH) : 0
      start._lastW = newW
      start._lastH = newH

      setPanelSize({ w: newW, h: newH })
      if (inElectron) window.electronAPI?.windowResize?.(newW, newH, { dx: moveDx, dy: moveDy })
    }
    const onUp = () => { resizing.current = false }
    // Alt+H in browser only (Electron handles it via global shortcut in main.cjs)
    const onKey = e => { if (e.altKey && e.key === 'h' && !inElectron) setMinimized(m => !m) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  function expandFromPill() {
    setMinimized(false)
    if (inElectron && viewRef.current === 'companion' && companionPhaseRef.current === 'live') {
      const { w, h } = panelSizeRef.current || { w: 300, h: 360 }
      queueMicrotask(() => window.electronAPI?.windowResize?.(w, h))
    }
  }

  function collapseToPill() {
    setClickThrough(false)
    setMinimized(true)
  }

  function startDrag(e) {
    if (e.button !== 0) return
    if (!inElectron || !window.electronAPI?.windowDrag) return
    e.preventDefault()
    let lastX = e.screenX, lastY = e.screenY
    const onMove = ev => {
      const dx = ev.screenX - lastX, dy = ev.screenY - lastY
      lastX = ev.screenX; lastY = ev.screenY
      window.electronAPI.windowDrag(dx, dy)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function startResize(e, edge = 'se') {
    resizing.current = true
    resizeStart.current = {
      x: e.screenX, y: e.screenY,
      w: panelSize.w, h: panelSize.h,
      edge,
      _lastW: panelSize.w, _lastH: panelSize.h,
    }
    e.stopPropagation(); e.preventDefault()
  }

  function setOverlayOpacity(v) {
    const n = Math.min(1, Math.max(0.35, Number(v) || 0.92))
    setOpacity(n)
    try { localStorage.setItem('mm-overlay-opacity', String(n)) } catch {}
  }

  function goHome() { resetLiveSessionContext(); setReport(null); setOpenSession(null); refreshSessions(); setView('home') }
  function openHistory() { refreshSessions(); setOpenSession(null); setView('history') }

  /** Explicit Jobs/Career → Solo/Live JD handoff (confirm before writing shared profile JD). */
  function useJobForInterview(payload, destination) {
    const seed = payload?.job
      ? buildInterviewJobSeed({ job: payload.job })
      : buildInterviewJobSeed(payload)
    if (!window.confirm(interviewSeedConfirmMessage(seed, destination))) return
    try {
      const next = applyInterviewJobSeed(loadProfile(), seed)
      saveProfile(next)
      setView(destination === 'live' ? 'companion' : 'solo')
    } catch (e) {
      window.alert(e?.message || 'Could not apply that job description.')
    }
  }

  // On Live start: restore last HUD size from localStorage (never wipe a user resize).
  useEffect(() => {
    if (view !== 'companion' || companionPhase !== 'live') return
    let next = panelSizeRef.current || { w: 300, h: 360 }
    try {
      const raw = localStorage.getItem('mm-overlay-size')
      if (raw) {
        const p = JSON.parse(raw)
        if (p?.w >= 240 && p?.h >= 180) next = { w: p.w, h: p.h }
      }
    } catch {}
    setPanelSize(next)
    if (inElectron) window.electronAPI?.windowResize?.(next.w, next.h)
  }, [view, companionPhase])

  // Persist manual edge-resizes so the next Live session opens at the same HUD size.
  useEffect(() => {
    if (view === 'companion' && companionPhase === 'live') {
      try { localStorage.setItem('mm-overlay-size', JSON.stringify(panelSize)) } catch {}
    }
  }, [panelSize, view, companionPhase])

  // Resize the OS window: full dashboard for shell views + Live setup/feedback; compact
  // invisible overlay for the live interview itself; a tiny logo pill when minimized.
  useEffect(() => {
    let mode
    if (minimized) mode = 'pill'                          // collapsed → tiny click-to-expand pill
    else if (view === 'companion') mode = companionPhase === 'live' ? 'overlay' : 'app'
    else mode = (!showWelcome && SHELL_VIEWS.includes(view)) ? 'app' : 'overlay'
    window.electronAPI?.setWindowMode?.(mode)
  }, [view, showWelcome, companionPhase, minimized])

  // The sessions list is a snapshot — refresh it when the Sessions tab opens so a
  // just-finished interview shows up without navigating away and back.
  useEffect(() => { if (view === 'history') refreshSessions() }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

  // Collapsed pill for dashboard/shell — keep shell views mounted (hidden) so Career JD /
  // form state survives minimize. Live overlay keeps its own minimized handling.
  const shellPill = minimized && !(view === 'companion' && companionPhase === 'live') && SHELL_VIEWS.includes(view)
  const stealthSafety = <StealthSafetyPrompt confirmOff={stealthConfirmOff} notice={stealthNotice}
    onCancel={() => setStealthConfirmOff(false)} onConfirmOff={() => applyStealth(false)} />

  // ── First-run welcome — guide a brand-new user straight to adding a key ──
  if (showWelcome) return (
    <OverlayPanel panelSize={panelSize} stealth={stealth} minimized={minimized} opacity={opacity} onOpacity={setOpacity}
      onDrag={startDrag} onResize={startResize}
      onStealth={requestStealthToggle} onMinimize={() => setMinimized(m => !m)} clickThrough={clickThrough} onClickThrough={() => setClickThrough(c => !c)}
      onClose={dismissWelcome} title="Connect your AI" autoHeight>
      {stealthSafety}
      <div style={{ padding: '14px 16px 16px', fontFamily: T.font }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: T.text1, marginBottom: 4 }}>Connect your AI</div>
        <div style={{ fontSize: 12.5, color: T.text2, lineHeight: 1.55, marginBottom: 12 }}>
          One last step — add at least one AI key to power your interviews. Keys stay <strong style={{ color: T.text1 }}>on this machine</strong> and unlock every mode.
        </div>
        <ApiKeysPanel onSaved={() => { recheckProviders(); dismissWelcome() }} />
        <button onClick={dismissWelcome}
          style={{ width: '100%', marginTop: 12, height: 40, background: 'transparent', color: T.text2, border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: T.font }}>
          Skip for now — I'll add keys later
        </button>
        <div style={{ fontSize: 10, color: T.text3, textAlign: 'center', marginTop: 8 }}>You can always manage keys from the ⚙ Settings tab.</div>
      </div>
    </OverlayPanel>
  )

  // ── Full windowed app shell (dashboard + sidebar) for the management views ──
  if (SHELL_VIEWS.includes(view)) {
    const shellHeader = { fontSize: 20, fontWeight: 600, color: T.text1, marginBottom: 4 }
    let content = null
    if (view === 'home') content = (
      <>
        {auth?.guest && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.35)', borderRadius: T.rCard, padding: '11px 14px', marginBottom: 14 }}>
            <span style={{ fontSize: 12.5, color: '#5eead4', flex: 1 }}>You're exploring as a guest — BYOK on this device (sessions save locally). <strong>Sign in</strong> for an account and Managed AI when the hosted proxy is available.</span>
            <button onClick={() => auth.signIn?.()} style={{ height: 34, padding: '0 16px', background: T.accent, color: '#fff', border: 'none', borderRadius: T.rCtrl, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: T.font, whiteSpace: 'nowrap' }}>Sign in</button>
          </div>
        )}
        <DashboardHome auth={auth} sessions={sessions} noProviders={noProviders}
          onNav={setView} />
      </>
    )
    else if (view === 'solo') content = <Solo onHome={goHome} noProviders={noProviders} />
    else if (view === 'duo') content = <Duo onHome={goHome} />
    else if (view === 'jobs') content = (
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <div style={shellHeader}>Job Matching</div>
        <Jobs
          onHome={goHome}
          noProviders={noProviders}
          onSettings={() => setView('settings')}
          onOpenCareer={seed => { setCareerSeed(seed); setView('career') }}
          onUseForInterview={(job, destination) => useJobForInterview({ job }, destination)}
          embedded
        />
      </div>
    )
    else if (view === 'career') content = (
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <div style={shellHeader}>Resume Studio</div>
        <Career
          onHome={goHome}
          noProviders={noProviders}
          onSettings={() => setView('settings')}
          embedded
          initialJd={careerSeed?.initialJd}
          initialRole={careerSeed?.initialRole}
          initialCompany={careerSeed?.initialCompany}
          initialTab={careerSeed?.initialTab}
          limitedJd={careerSeed?.limitedJd}
          onSeedConsumed={() => setCareerSeed(null)}
          onUseForInterview={(fields, destination) => useJobForInterview(fields, destination)}
        />
      </div>
    )
    else if (view === 'settings') content = (
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={shellHeader}>Settings</div>
        <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.5, marginBottom: 16 }}>Choose how MockMate gets its AI. <strong>Bring your own key</strong> keeps provider keys on this device. <strong>Managed AI</strong> uses MockMate’s hosted proxy when configured — otherwise add your own keys.</div>
        {auth?.guest && (
          <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.35)', borderRadius: T.rCard, fontSize: 12.5, color: '#5eead4', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1 }}>You're a guest — use <strong>your own API keys</strong> below. Sign in for an account; keyless Managed AI needs the hosted backend.</span>
            <button onClick={() => auth.signIn?.()} style={{ height: 32, padding: '0 14px', background: T.accent, color: '#fff', border: 'none', borderRadius: T.rCtrl, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: T.font, whiteSpace: 'nowrap' }}>Sign in</button>
          </div>
        )}
        <ApiKeysPanel showStatus onSaved={recheckProviders} onModeChange={recheckProviders} />
        <AiAnswerSettings />
        <div style={{ marginTop: 18, padding: '14px 16px', background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>App updates</div>
            <div style={{ fontSize: 11.5, color: T.text2, marginTop: 2 }}>MockMate updates automatically in the background. <button onClick={() => setWhatsNewSignal(n => n + 1)} style={{ background: 'none', border: 'none', color: T.accentFrom, cursor: 'pointer', padding: 0, fontSize: 11.5, fontFamily: T.font, textDecoration: 'underline' }}>See what's new</button>.</div>
          </div>
          <button onClick={() => window.electronAPI?.checkForUpdates?.()}
            style={{ height: 36, padding: '0 16px', background: 'transparent', color: T.text1, border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: T.font, whiteSpace: 'nowrap' }}>Check for updates</button>
        </div>
      </div>
    )
    else if (view === 'account') content = <div style={{ maxWidth: 640, margin: '0 auto' }}><div style={shellHeader}>Account</div><Account auth={auth} noProviders={noProviders} onManageKeys={() => setView('settings')} /></div>
    else if (view === 'history') content = (
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {openSession ? (
          <SoloFeedback report={openSession.report} transcript={openSession.transcript}
            onAgain={() => setOpenSession(null)} onAgainLabel="← Back to sessions" />
        ) : (
          <>
            <div style={shellHeader}>Sessions</div>
            <SessionsTable sessions={sessions} onOpen={s => setOpenSession(s)}
              onDelete={id => { if (window.confirm('Delete this session permanently? Its transcript and feedback can\'t be recovered.')) { deleteSession(id); refreshSessions() } }} />
          </>
        )}
      </div>
    )

    return (
      <>
        {stealthSafety}
        {shellPill && (
          <OverlayPanel minimized
            onMinimize={expandFromPill}
            onStealth={expandFromPill}
            panelSize={panelSize}
          />
        )}
        <div style={shellPill ? { display: 'none' } : undefined} aria-hidden={shellPill || undefined}>
          <AppShell active={view} onNav={setView} auth={auth} meetingActive={meetingActive}
            stealth={stealth} onStealth={requestStealthToggle}
            onMinimize={collapseToPill} onClose={() => window.close?.()}>
            <WhatsNew openSignal={whatsNewSignal} />
            {content}
          </AppShell>
        </div>
      </>
    )
  }

  // Live Interview is the only view that renders as the compact floating overlay — everything
  // else lives in the dashboard shell (handled above).
  if (view === 'companion') return (
    <>
    {stealthSafety}
    <LiveCompanion onHome={goHome} onPhaseChange={setCompanionPhase} panelSize={panelSize} stealth={stealth} opacity={opacity} onOpacity={setOverlayOpacity} minimized={minimized}
      onSessionStart={resetLiveSessionContext} onSessionEnd={resetLiveSessionContext}
      onStealth={requestStealthToggle}
      onMinimize={() => {
        if (minimized) expandFromPill()
        else collapseToPill()
      }}
      clickThrough={clickThrough} onClickThrough={() => setClickThrough(c => !c)}
      onResize={startResize} onDrag={startDrag}
      screenAnalysis={screenAnalysis} screenAnalyzing={screenAnalyzing} screenFlowStatus={screenFlowStatus} onDismissScreen={dismissScreenAnalysis}
      codingDetected={codingDetected} onCaptureScreen={capturePreferredScreen}
      onContinueScreen={captureAsContinuation} onNewScreen={captureAsNewQuestion}
      onUndoScreen={screenUndoRef.current ? undoScreenMerge : undefined}
      onReanalyze={reanalyze}
      onLiveSpokenQuestion={onLiveSpokenQuestion}
      captureDisplays={captureDisplays} captureDisplayId={captureDisplayId} onCaptureDisplayId={setCaptureDisplayId} />
    </>
  )

  return null   // every other view is handled by the dashboard shell above
}

// Lightweight, dependency-free syntax highlighter — generic across Python/JS/
// Java/C++/Go/TS. Tokenizes comments, strings, numbers, and common keywords;
// good enough for a read-at-a-glance hint, no heavy library in the bundle.
const CODE_KEYWORDS = new Set([
  'function','def','return','if','else','elif','for','while','class','const','let','var',
  'int','long','float','double','void','bool','boolean','char','string','str','public','private',
  'protected','static','new','import','from','export','async','await','try','catch','except',
  'finally','throw','throws','raise','break','continue','in','of','is','not','and','or','None',
  'null','nil','true','false','True','False','this','self','super','struct','func','fn','package',
  'interface','type','enum','switch','case','default','do','lambda','yield','with','as','typeof',
  'instanceof','extends','implements','abstract','final','override','val','var','print','println','echo'
])
function highlightCode(code) {
  const re = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][A-Za-z0-9_$]*)|(\s+)|([^\sA-Za-z0-9_$]+)/g
  const out = []
  let m, i = 0
  while ((m = re.exec(code)) !== null) {
    let color = '#e6edf3'
    if (m[1]) color = '#8b949e'                              // comment
    else if (m[2]) color = '#a5d6ff'                         // string
    else if (m[3]) color = '#79c0ff'                         // number
    else if (m[4]) color = CODE_KEYWORDS.has(m[4]) ? '#ff7b72' : '#e6edf3'  // keyword / identifier
    out.push(<span key={i++} style={{ color }}>{m[0]}</span>)
  }
  return out
}

// ── Code block with one-tap copy + syntax highlighting — the core of Coding mode ──
export function CodeBlock({ code, language }) {
  const [copied, setCopied] = useState(false)
  const [runState, setRunState] = useState(null)
  async function copy() {
    const ok = await copyText(code || '')
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500) }
  }
  async function run() {
    setRunState({ running: true })
    setRunState(await runJavaScriptIsolated(code))
  }
  const runnable = canRunLanguage(language)
  return (
    <div style={{ background: '#0d1117', border: '1px solid #1f2733', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 9px', borderBottom: '1px solid #1f2733', background: 'rgba(255,255,255,0.02)' }}>
        <span style={{ fontSize: 10, color: '#7d8590', fontFamily: 'monospace' }}>{language || 'code'}</span>
        {runnable && <button onClick={run} disabled={runState?.running}
          title="Runs JavaScript in a disposable worker with network/DOM access disabled and a 1.5s timeout"
          style={{ marginLeft: 'auto', background: 'rgba(94,234,212,0.1)', color: '#5eead4', border: '1px solid rgba(94,234,212,0.25)', borderRadius: 5, padding: '2px 9px', fontSize: 10, fontWeight: 600, cursor: runState?.running ? 'default' : 'pointer' }}>
          {runState?.running ? 'Running…' : '▶ Run JS'}
        </button>}
        <button onClick={copy} style={{ marginLeft: runnable ? 0 : 'auto', background: copied ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)', color: copied ? '#4ade80' : T.text2, border: 'none', borderRadius: 5, padding: '2px 9px', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
          {copied ? '✓ Copied' : '⧉ Copy'}
        </button>
      </div>
      <pre style={{ margin: 0, padding: '10px 12px', overflowX: 'auto', maxHeight: 260 }}>
        <code style={{ fontFamily: "'Menlo','Consolas',monospace", fontSize: 12, lineHeight: 1.6, color: '#e6edf3', whiteSpace: 'pre' }}>{highlightCode(code || '')}</code>
      </pre>
      {runState && !runState.running && <div role="status" style={{ padding: '6px 10px', borderTop: '1px solid #1f2733', fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: 10, color: runState.ok ? '#86efac' : '#fca5a5', maxHeight: 100, overflow: 'auto' }}>
        {runState.ok
          ? ([...(runState.logs || []), runState.result].filter(x => x != null && x !== '').join('\n') || '✓ Executed successfully (no console output)')
          : `✗ ${runState.error || 'Execution failed'}`}
      </div>}
    </div>
  )
}

// ── Screen Analysis Panel — shown when Ctrl+Shift+U is pressed ───────────────
export function ScreenAnalysisPanel({ analysis, analyzing, flowStatus, onDismiss, onReanalyze, onRecapture, onContinueCapture, onNewCapture, onUndoMerge, captureDisplays, captureDisplayId, onCaptureDisplayId, liveAttachHint }) {
  const [requestedLanguage, setRequestedLanguage] = useState('')
  useEffect(() => { if (!analyzing) setRequestedLanguage('') }, [analyzing, analysis])
  if (!analyzing && !analysis) return null
  // Supports wrapped screen-context records { analysis, status, error } and legacy flat analysis.
  const record = analysis?.analysis || analysis
  const status = analysis?.status
  const err = analysis?.error || record?.error
  const isCoding = (record?.contentType === 'coding') || (record?.screenFamily === 'screen_code')
  const accent = isCoding ? 'rgba(34,197,94,0.25)' : 'rgba(234,179,8,0.25)'
  const accentBg = isCoding ? 'rgba(34,197,94,0.06)' : 'rgba(234,179,8,0.08)'
  const statusLabel = analyzing ? 'Analyzing…'
    : status === 'not_captured' ? 'SCREEN NOT CAPTURED'
    : status === 'unsupported' ? 'CAPTURE UNSUPPORTED'
    : status === 'failed' || err ? 'SCREEN ANALYSIS FAILED'
    : status === 'analyzed_cached' ? 'SCREEN ANALYZED (cached)'
    : liveAttachHint === 'attached' ? 'SCREEN CONTEXT ATTACHED'
    : liveAttachHint === 'irrelevant' ? 'SCREEN SOLVED INDEPENDENTLY'
    : 'SCREEN ANALYZED'
  return (
    <div style={{ background: accentBg, border: `1px solid ${accent}`, borderRadius: 10, padding: '12px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: isCoding ? '#4ade80' : '#fbbf24' }}>{isCoding ? 'Coding Solution' : 'Screen Analysis'}</span>
        <span style={{ fontSize: 9, color: T.text3, background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 8 }}>F7 / Ctrl+Shift+U</span>
        <span style={{ fontSize: 9, color: err ? '#f87171' : T.text3, marginLeft: 4 }}>{statusLabel}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {onRecapture && <button onClick={onRecapture} title="Re-capture the screen" style={{ background: 'none', border: 'none', color: T.text3, cursor: 'pointer', fontSize: 13 }}>↻</button>}
          <button onClick={onDismiss} title="Dismiss" style={{ background: 'none', border: 'none', color: T.text3, cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>
      </div>
      {captureDisplays?.length > 1 && onCaptureDisplayId && (
        <div style={{ marginBottom: 8 }}>
          <select
            value={captureDisplayId || ''}
            onChange={e => {
              const v = e.target.value
              onCaptureDisplayId(v)
              try { localStorage.setItem('mm-capture-display-id', v) } catch {}
            }}
            style={{ fontSize: 11, background: 'rgba(0,0,0,0.25)', color: T.text2, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '3px 6px', maxWidth: '100%' }}
            aria-label="Capture display"
          >
            <option value="">Primary display</option>
            {captureDisplays.map(d => (
              <option key={d.id} value={d.id}>{d.primary ? `${d.label} (primary)` : d.label}</option>
            ))}
          </select>
        </div>
      )}
      {flowStatus && (
        <div role="status" aria-live="polite" style={{ marginBottom: 8, padding: '6px 8px', borderRadius: 6, background: 'rgba(45,212,191,0.1)', border: '1px solid rgba(45,212,191,0.24)', color: '#99f6e4', fontSize: 10.5, lineHeight: 1.4 }}>
          {flowStatus}
        </div>
      )}
      {analyzing
        ? <div style={{ fontSize: 12, color: '#fbbf24' }}>{requestedLanguage ? `Rewriting complete solution in ${requestedLanguage}…` : 'Analyzing screen…'}</div>
        : err
          ? <div style={{ fontSize: 12, color: '#f87171' }}>⚠ {err}</div>
          : isCoding
            ? (
              <>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  {record.pattern && <span style={{ fontSize: 9, padding: '2px 8px', background: 'rgba(20,184,166,0.3)', color: '#99f6e4', borderRadius: 10, fontWeight: 700 }}>{record.pattern}</span>}
                  {record.complexity && <span style={{ fontSize: 9, padding: '2px 8px', background: '#0d1117', color: '#7ee787', borderRadius: 10, fontFamily: 'monospace' }}>{record.complexity}</span>}
                  {record.language && <span style={{ fontSize: 9, padding: '2px 8px', background: 'rgba(255,255,255,0.06)', color: T.text2, borderRadius: 10 }}>{record.language}</span>}
                </div>
                {record.detectedText && <div style={{ fontSize: 11, color: T.text2, fontStyle: 'italic', marginBottom: 8, borderLeft: '2px solid rgba(34,197,94,0.3)', paddingLeft: 7 }}>{record.detectedText}</div>}
                {onReanalyze && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                    {CODING_LANGUAGES.map(lang => {
                      const on = (record.language || '').toLowerCase() === lang.toLowerCase()
                      return (
                        <button key={lang} disabled={analyzing} onClick={() => { setRequestedLanguage(lang); onReanalyze(lang) }} title={`Solve in ${lang}`}
                          style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, cursor: 'pointer', border: 'none', fontWeight: 600,
                            background: on ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.05)', color: on ? '#4ade80' : T.text3 }}>{lang}</button>
                      )
                    })}
                  </div>
                )}
                {Array.isArray(record.approach) && record.approach.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 9, color: T.text3, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 4 }}>APPROACH</div>
                    {record.approach.map((step, i) => (
                      <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 3, fontSize: 12, color: T.text1 }}>
                        <span style={{ color: '#4ade80', flexShrink: 0 }}>{i + 1}.</span><span>{step}</span>
                      </div>
                    ))}
                  </div>
                )}
                {record.code && <CodeBlock code={record.code} language={record.language} />}
                {Array.isArray(record.edgeCases) && record.edgeCases.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 9, color: T.text3, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 4 }}>EDGE CASES</div>
                    {record.edgeCases.map((ec, i) => (
                      <div key={i} style={{ fontSize: 11, color: T.text2, marginBottom: 2 }}>• {ec}</div>
                    ))}
                  </div>
                )}
                {record.watchOut && <div style={{ fontSize: 11, color: '#f59e0b' }}>⚠ {record.watchOut}</div>}
              </>
            )
            : record && (
              <>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  <span style={{ fontSize: 9, padding: '1px 7px', background: 'rgba(234,179,8,0.15)', color: '#fbbf24', borderRadius: 10, fontWeight: 700 }}>{TYPE_LABEL[record.contentType] || record.contentType}</span>
                </div>
                {record.detectedText && <div style={{ fontSize: 11, color: '#fcd34d', fontStyle: 'italic', marginBottom: 8, borderLeft: '2px solid rgba(234,179,8,0.3)', paddingLeft: 7 }}>{record.detectedText}</div>}
                {record.resumeStory && <div style={{ fontSize: 11, color: '#86efac', borderLeft: '2px solid #4ade80', paddingLeft: 7, marginBottom: 8 }}>{record.resumeStory}</div>}
                <div style={{ fontSize: 14, color: '#fef3c7', lineHeight: 1.7, marginBottom: 8 }}>{record.fullAnswer}</div>
                {record.watchOut && <div style={{ fontSize: 11, color: '#f59e0b' }}>⚠ {record.watchOut}</div>}
              </>
            )
      }
      {!analyzing && !err && record && (onContinueCapture || onNewCapture) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, paddingTop: 9, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          {onContinueCapture && <button type="button" onClick={onContinueCapture}
            style={{ flex: 1, minHeight: 32, borderRadius: 7, border: '1px solid rgba(45,212,191,0.4)', background: 'rgba(13,148,136,0.18)', color: '#99f6e4', cursor: 'pointer', fontSize: 10.5, fontWeight: 700 }}>
            + Add next screenshot
          </button>}
          {onNewCapture && <button type="button" onClick={onNewCapture}
            style={{ flex: 1, minHeight: 32, borderRadius: 7, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.05)', color: T.text2, cursor: 'pointer', fontSize: 10.5, fontWeight: 650 }}>
            Start separate question
          </button>}
          {onUndoMerge && <button type="button" onClick={onUndoMerge}
            style={{ flexBasis: '100%', minHeight: 30, borderRadius: 7, border: '1px solid rgba(251,191,36,0.32)', background: 'rgba(251,191,36,0.08)', color: '#fcd34d', cursor: 'pointer', fontSize: 10.5, fontWeight: 650 }}>
            ↶ Undo merge
          </button>}
        </div>
      )}
    </div>
  )
}

// Clean, evenly-sized icon button with a tooltip (shows the shortcut). Big enough
// to hit under interview pressure; no cryptic text labels.
// Inline SVG icons — emoji glyphs render as empty boxes on Linux (no color-emoji
// font is guaranteed), so every header icon is a real vector that draws on any OS.
function Glyph({ name }) {
  const p = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (name) {
    case 'eye':      return <svg {...p}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>
    case 'minimize': return <svg {...p}><line x1="5" y1="12" x2="19" y2="12" /></svg>
    case 'expand':   return <svg {...p}><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
    case 'stop':     return <svg {...p}><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
    case 'close':    return <svg {...p}><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
    case 'shield':   return <svg {...p}><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" /></svg>
    default:         return <span style={{ fontSize: 14 }}>{name}</span>
  }
}

export function IconBtn({ icon, title, onClick, active, danger }) {
  const [hover, setHover] = useState(false)
  const base = danger ? '#f87171' : active ? '#4ade80' : T.text2
  const bg = hover ? (danger ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.1)')
    : active ? 'rgba(34,197,94,0.14)' : 'transparent'
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} aria-pressed={active || undefined}
      onMouseDown={e => e.stopPropagation()}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: bg, color: base, border: 'none', borderRadius: 7, cursor: 'pointer',
        fontSize: 14, lineHeight: 1, transition: 'background 0.12s', flexShrink: 0
      }}><Glyph name={icon} /></button>
  )
}

// ── Score trend — dependency-free inline SVG line chart of recent session scores ──
// Renders nothing until there are at least 2 scored sessions (a single point isn't a
// trend). Uses a uniform-scaled viewBox so dots stay circular at any panel width.
function ScoreTrend({ sessions }) {
  const all = (sessions || []).filter(s => typeof s.score === 'number')
  if (all.length < 2) return null
  const scored = all.slice().reverse().slice(-20)   // oldest → newest, most recent 20
  const truncated = all.length > scored.length
  const n = scored.length
  const W = 300, H = 96, padX = 12, padTop = 10, padBot = 16
  const xAt = i => padX + (n === 1 ? (W - 2 * padX) / 2 : i * (W - 2 * padX) / (n - 1))
  const yAt = v => padTop + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - padTop - padBot)
  const pts = scored.map((s, i) => ({ x: xAt(i), y: yAt(s.score), s }))
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const avg = Math.round(scored.reduce((a, s) => a + s.score, 0) / n)
  const delta = scored[n - 1].score - scored[0].score
  const fmt = ts => { try { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) } catch { return '' } }
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.text1 }}>Score trend</span>
        <span style={{ fontSize: 10, color: T.text3 }}>avg {avg}</span>
        <span style={{ fontSize: 10, color: delta >= 0 ? '#4ade80' : '#f87171' }}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} since {truncated ? 'shown start' : 'first'}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {[75, 50].map(g => (
          <g key={g}>
            <line x1={padX} x2={W - padX} y1={yAt(g)} y2={yAt(g)} stroke="rgba(255,255,255,0.07)" strokeDasharray="3 3" />
            <text x={W - padX} y={yAt(g) - 2} fontSize="7" fill={T.text3} textAnchor="end">{g}</text>
          </g>
        ))}
        <path d={line} fill="none" stroke="rgba(45,212,191,0.75)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.6" fill={scoreColor(p.s.score)} stroke="#0a0a12" strokeWidth="1">
            <title>{`${(p.s.score / 10).toFixed(1)}/10 · ${fmt(p.s.ts)}${p.s.label ? ' · ' + p.s.label : ''}`}</title>
          </circle>
        ))}
        <text x={padX} y={H - 3} fontSize="7" fill={T.text3} textAnchor="start">{fmt(scored[0].ts)}</text>
        <text x={W - padX} y={H - 3} fontSize="7" fill={T.text3} textAnchor="end">{fmt(scored[n - 1].ts)}</text>
      </svg>
    </div>
  )
}

// ── AI answer settings (Response length + Screenshot replies) — persisted globally, read by
// Live hints and screenshot analysis. Mirrors the competitor's AI-Settings surface. ──
function Segmented({ label, hint, value, options, onChange }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: T.text1, marginBottom: hint ? 2 : 8 }}>{label}</div>
      {hint && <div style={{ fontSize: 11.5, color: T.text2, marginBottom: 8, lineHeight: 1.4 }}>{hint}</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        {options.map(o => {
          const on = value === o.value
          return (
            <button key={o.value} onClick={() => onChange(o.value)}
              style={{ flex: 1, height: 36, borderRadius: T.rCtrl, cursor: 'pointer', fontFamily: T.font, fontSize: 12.5, fontWeight: on ? 600 : 400,
                background: on ? 'rgba(20,184,166,0.16)' : T.surface2, border: `1px solid ${on ? 'rgba(20,184,166,0.45)' : T.border}`, color: on ? T.text1 : T.text2 }}>
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function AiAnswerSettings() {
  const [style, setStyle] = useState(getAnswerStyle())
  const [shot, setShot] = useState(getScreenshotSpeed())
  const [skip, setSkip] = useState(getAutoSkip() ? 'on' : 'off')
  return (
    <details style={{ marginTop: 18, padding: 16, background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard }}>
      <summary style={{ fontSize: 14, fontWeight: 600, color: T.text1, cursor: 'pointer', fontFamily: T.font }}>
        AI answers · advanced
      </summary>
      <div style={{ marginTop: 12 }}>
        <Segmented label="Response length"
          hint="Concise (default) streams the first word soonest and is easiest to glance at mid-interview; Detailed adds depth. Same preference as Live."
          value={style} onChange={v => { setStyle(v); setAnswerStyle(v) }}
          options={[{ value: 'concise', label: 'Concise' }, { value: 'balanced', label: 'Balanced' }, { value: 'detailed', label: 'Detailed' }]} />
        <Segmented label="Screenshot replies"
          hint="Faster gives quicker, more concise answers when solving from a screenshot; Quality keeps full depth."
          value={shot} onChange={v => { setShot(v); setScreenshotSpeed(v) }}
          options={[{ value: 'quality', label: 'Quality' }, { value: 'fast', label: 'Faster' }]} />
        <Segmented label="Auto-skip noise"
          hint="On: stay silent on small talk and non-questions during Live. Off: answer every line the interviewer says."
          value={skip} onChange={v => { setSkip(v); setAutoSkip(v === 'on') }}
          options={[{ value: 'on', label: 'Enable' }, { value: 'off', label: 'Disable' }]} />
        <DocThreshold />
      </div>
    </details>
  )
}

// "Filter document" — the RAG relevance cutoff for how strict document retrieval is.
function DocThreshold() {
  const [v, setV] = useState(getDocThreshold())
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>Filter documents</div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: T.text2, fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(2)}</div>
      </div>
      <div style={{ fontSize: 11.5, color: T.text2, marginBottom: 8, lineHeight: 1.4 }}>How strictly to match uploaded docs when grounding Live answers. Higher = fewer, more-relevant snippets. Default 0.20.</div>
      <input type="range" min="0" max="0.6" step="0.05" value={v}
        onChange={e => { const n = parseFloat(e.target.value); setV(n); setDocThreshold(n) }}
        style={{ width: '100%', accentColor: T.accentFrom, cursor: 'pointer' }} />
    </div>
  )
}

export function OverlayPanel({ children, panelSize, stealth, minimized, onDrag, onResize, onStealth, onMinimize, onClose, title, extra, actions, opacity = 0.95, onOpacity, autoHeight, clickThrough, onClickThrough, confirmClose }) {
  const [confirming, setConfirming] = useState(false)
  const confirmTimer = useRef(null)
  const pillDragged = useRef(false)
  // Drag the collapsed pill to reposition; a real drag suppresses the expand-click. Uses CUMULATIVE
  // distance from the press (a slow drag has tiny per-event deltas but a large total), and resets the
  // drag flag on the next tick after release so an off-button release can't swallow the next click.
  function startPillDrag(e) {
    if (e.button !== 0 || !inElectron) return
    pillDragged.current = false
    const startX = e.screenX, startY = e.screenY
    let lastX = e.screenX, lastY = e.screenY
    const onMove = ev => {
      if (Math.abs(ev.screenX - startX) + Math.abs(ev.screenY - startY) > 4) pillDragged.current = true
      window.electronAPI?.windowDrag?.(ev.screenX - lastX, ev.screenY - lastY); lastX = ev.screenX; lastY = ev.screenY
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp)
      setTimeout(() => { pillDragged.current = false }, 0)   // clears AFTER any click fires; unblocks the next click even if release was off-button
    }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }
  // 📌 Pin — keep the overlay above full-screen Zoom/Meet. Default ON for Live trust.
  // Persisted so it survives view changes, and re-asserted on mount so the window matches the saved state.
  const [pinned, setPinned] = useState(() => {
    try {
      const v = localStorage.getItem('mm-pinned')
      return v === null ? true : v === '1'
    } catch { return true }
  })
  useEffect(() => { if (inElectron) window.electronAPI?.setPin?.(pinned) }, [pinned])
  useEffect(() => {
    if (!inElectron) return
    window.electronAPI?.setClickThrough?.(!!clickThrough)
    return () => { window.electronAPI?.setClickThrough?.(false) }
  }, [clickThrough])
  // Alt+C force-off click-through (global shortcut → renderer)
  useEffect(() => {
    if (!inElectron || !onClickThrough) return
    const off = window.electronAPI?.onShortcutClickThroughOff?.(() => {
      if (clickThrough) onClickThrough()
    })
    return () => { try { off?.() } catch {} }
  }, [clickThrough, onClickThrough])
  // Region-aware: while click-through is on, accept mouse over interactive chrome only.
  // Keep CSS pointer-events ALL so elementFromPoint can see buttons (pointer-events:none
  // broke the toolbar — clicks never hit buttons → overlay felt "stuck").
  useEffect(() => {
    if (!inElectron || !clickThrough) return
    const root = document.getElementById('mockmate-overlay')
    if (!root) return
    const isInteractive = el => {
      if (!el || !root.contains(el)) return false
      return !!el.closest?.('[data-mm-hit],button,a,input,textarea,select,label,[role="button"]')
    }
    let accepting = false
    const setAccept = on => {
      if (on === accepting) return
      accepting = on
      window.electronAPI?.setIgnoreMouseEvents?.(!on, { forward: true })
    }
    const onMove = e => {
      // Prefer elementFromPoint — e.target is unreliable while ignore+forward is toggling.
      const el = document.elementFromPoint(e.clientX, e.clientY) || e.target
      setAccept(isInteractive(el))
    }
    const onLeave = () => setAccept(false)
    root.addEventListener('mousemove', onMove, true)
    root.addEventListener('mouseleave', onLeave, true)
    setAccept(false)
    return () => {
      root.removeEventListener('mousemove', onMove, true)
      root.removeEventListener('mouseleave', onLeave, true)
      // Do NOT re-enable click-through here — the companion setClickThrough(false) effect owns final state.
    }
  }, [clickThrough])
  function togglePin() {
    setPinned(p => { const v = !p; try { localStorage.setItem('mm-pinned', v ? '1' : '0') } catch {} ; return v })
  }
  function toggleClickThrough() {
    onClickThrough?.()
  }
  function handleClose() {
    if (!confirmClose) return onClose?.()
    if (confirming) { clearTimeout(confirmTimer.current); onClose?.(); return }
    setConfirming(true)
    confirmTimer.current = setTimeout(() => setConfirming(false), 3000)
  }

  // Collapsed → on-screen logo pill (never a full close). Protection follows the
  // explicit Stealth toggle; collapsing does not silently enable it.
  if (minimized) return (
    <div id="mockmate-overlay" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}>
      <button type="button" data-mm-hit="1"
        onMouseDown={startPillDrag}
        onClick={() => { if (!pillDragged.current) onMinimize?.() }}
        title="MockMate — click to expand · drag to move"
        style={{
          position: 'absolute', top: 6, left: 6, width: 56, height: 56, pointerEvents: 'all', cursor: 'grab',
          background: 'linear-gradient(145deg, #0f766e, #115e59)',
          border: '2px solid rgba(45,212,191,0.65)', borderRadius: 16,
          boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
          display: 'grid', placeItems: 'center', padding: 0,
        }}>
        <img src="/icon.png" alt="" width={30} height={30}
          style={{ borderRadius: 8, display: 'block', pointerEvents: 'none' }}
          onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling && (e.currentTarget.nextSibling.style.display = 'grid') }} />
        <span style={{ display: 'none', placeItems: 'center', width: 30, height: 30, borderRadius: 8, background: 'rgba(0,0,0,0.35)', color: '#5eead4', fontWeight: 800, fontSize: 16, fontFamily: T.font, pointerEvents: 'none' }}>M</span>
      </button>
    </div>
  )

  return (
    <div id="mockmate-overlay" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}>
      <div style={{
        position: 'absolute', left: 0, top: 0,
        // Electron: fill the OS window so edge-resize matches the real window chrome.
        // Browser: keep the floating CSS panel size.
        width: inElectron ? '100%' : panelSize.w,
        height: (minimized || autoHeight) ? 'auto' : (inElectron ? '100%' : panelSize.h),
        background: 'rgba(8,9,14,0.88)',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: 12,
        boxShadow: '0 10px 36px rgba(0,0,0,0.55)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        opacity,
        transition: 'opacity 0.1s',
        // Always 'all' — click-through is handled by Electron setIgnoreMouseEvents + region hover.
        pointerEvents: 'all',
        fontFamily: 'system-ui, sans-serif',
        color: T.text1,
        userSelect: 'none',
        boxSizing: 'border-box',
      }}>
        {/* Header — drag handle (above resize hit-zones so Live overlay stays movable) */}
        <div onMouseDown={onDrag} data-mm-hit="1" style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px 7px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(0,0,0,0.25)', cursor: 'grab', flexShrink: 0,
          position: 'relative', zIndex: 20,
        }}>
          {extra
            ? <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>{extra}</div>
            : <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.88)', fontWeight: 600, fontFamily: T.font }}>{title || 'MockMate'}</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }} onMouseDown={e => e.stopPropagation()} data-mm-hit="1">
            {actions}
            {inElectron && typeof onStealth === 'function' && (
              <button onClick={onStealth} onMouseDown={e => e.stopPropagation()}
                title={stealth ? 'Stealth ON — capture protection enabled. Verify the meeting share preview.' : 'Stealth OFF — overlay may appear in capture. Click to enable protection.'}
                aria-label={stealth ? 'Disable stealth capture protection' : 'Enable stealth capture protection'} aria-pressed={!!stealth}
                style={{ height: 28, minWidth: 28, padding: '0 7px', display: 'grid', placeItems: 'center', background: stealth ? 'rgba(13,148,136,0.42)' : 'transparent', color: stealth ? '#5eead4' : 'rgba(255,255,255,0.55)', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13 }}>🛡️</button>
            )}
            {typeof onOpacity === 'function' && (
              <label title="Transparency (like LockedIn) — lower = more see-through"
                style={{ display: 'flex', alignItems: 'center', gap: 4, height: 28, padding: '0 4px', cursor: 'pointer' }}
                onMouseDown={e => e.stopPropagation()}>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontWeight: 600 }}>◐</span>
                <input type="range" min="0.35" max="1" step="0.05" value={opacity}
                  onChange={e => onOpacity(e.target.value)}
                  style={{ width: 56, accentColor: '#2dd4bf', cursor: 'pointer' }}
                  aria-label="Overlay transparency" />
              </label>
            )}
            {inElectron && (
              <button onClick={togglePin} onMouseDown={e => e.stopPropagation()}
                title={pinned ? 'Pinned — stays open when you switch to Zoom/Meet. Click to unpin.' : 'Unpinned — collapses to the pill icon when you switch apps (never vanishes). Click to pin.'}
                aria-label={pinned ? 'Unpin — collapse to pill when switching windows' : 'Pin — keep overlay when switching windows'} aria-pressed={pinned}
                style={{ height: 28, width: 28, display: 'grid', placeItems: 'center', background: pinned ? 'rgba(13,148,136,0.35)' : 'transparent', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13, opacity: pinned ? 1 : 0.6 }}>📌</button>
            )}
            {inElectron && onClickThrough && (
              <button onClick={toggleClickThrough} onMouseDown={e => e.stopPropagation()}
                title={clickThrough ? 'Click-through ON — mouse clicks go through to Zoom/Meet. Hover the toolbar to use MockMate (Alt+C off).' : 'Click-through — let clicks pass through the overlay into the meeting (different from collapse)'}
                aria-label={clickThrough ? 'Disable click-through' : 'Enable click-through'} aria-pressed={!!clickThrough}
                style={{ height: 28, width: 28, display: 'grid', placeItems: 'center', background: clickThrough ? 'rgba(13,148,136,0.35)' : 'transparent', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, opacity: clickThrough ? 1 : 0.6, fontWeight: 700 }}>🖱️</button>
            )}
            {/* Single collapse control — eye + minimize were duplicates of the same pill action */}
            <IconBtn icon={minimized ? 'expand' : 'minimize'} onClick={onMinimize || onStealth}
              title={minimized ? 'Expand overlay' : 'Collapse to pill (stays on screen) · Alt+H'} />
            {confirming
              ? <button onClick={handleClose} onMouseDown={e => e.stopPropagation()} title="Confirm end"
                  style={{ height: 28, padding: '0 10px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>End?</button>
              : <IconBtn icon={confirmClose ? 'stop' : 'close'} onClick={handleClose} danger title={confirmClose ? 'End interview' : 'Close'} />}
          </div>
        </div>

        {!minimized && children}

        {/* Full-perimeter resize — thick hit zones on every border + corner of the Electron window */}
        {!minimized && onResize && (
          <>
            {[
              { edge: 'n',  cursor: 'ns-resize', style: { top: 0, left: 48, right: 48, height: 6 } },
              { edge: 's',  cursor: 'ns-resize', style: { bottom: 0, left: 14, right: 14, height: 10 } },
              { edge: 'e',  cursor: 'ew-resize', style: { top: 36, right: 0, bottom: 14, width: 10 } },
              { edge: 'w',  cursor: 'ew-resize', style: { top: 36, left: 0, bottom: 14, width: 10 } },
              { edge: 'nw', cursor: 'nwse-resize', style: { top: 0, left: 0, width: 14, height: 14 } },
              { edge: 'ne', cursor: 'nesw-resize', style: { top: 0, right: 0, width: 14, height: 14 } },
              { edge: 'sw', cursor: 'nesw-resize', style: { bottom: 0, left: 0, width: 16, height: 16 } },
              { edge: 'se', cursor: 'nwse-resize', style: { bottom: 0, right: 0, width: 18, height: 18, background: 'linear-gradient(135deg,transparent 50%,rgba(255,255,255,0.18) 50%)', borderRadius: '0 0 12px 0' } },
            ].map(h => (
              <div key={h.edge} data-mm-hit="1" title="Drag border to resize"
                onMouseDown={e => { e.stopPropagation(); onResize(e, h.edge) }}
                style={{
                  position: 'absolute', zIndex: 5, pointerEvents: 'all',
                  cursor: h.cursor, ...h.style,
                }} />
            ))}
          </>
        )}
      </div>

      <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        #mockmate-overlay button:focus-visible, #mockmate-overlay a:focus-visible, #mockmate-overlay input:focus-visible, #mockmate-overlay select:focus-visible, #mockmate-overlay textarea:focus-visible{outline:2px solid #2dd4bf;outline-offset:2px;border-radius:6px}
        #mockmate-overlay *{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.18) transparent}
        #mockmate-overlay ::-webkit-scrollbar{width:6px;height:6px}
        #mockmate-overlay ::-webkit-scrollbar-track{background:transparent}
        #mockmate-overlay ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.16);border-radius:3px}
        #mockmate-overlay ::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.3)}
        #mockmate-overlay ::-webkit-scrollbar-corner{background:transparent}`}</style>
    </div>
  )
}


// ── Home tile — new design-system card (dark surface, gradient accents, Kanit) ──
// `accent` is the hover/border color for the tile; `glow` optionally tints the surface.
function HomeTile({ onClick, icon, title, sub, accent = T.borderStrong, glow, badge, right }) {
  const [h, setH] = React.useState(false)
  return (
    <div onClick={onClick}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: glow ? `linear-gradient(135deg, ${glow}, ${T.surface1})` : T.surface1,
        border: `1px solid ${h ? accent : T.border}`,
        borderRadius: T.rCard, padding: '12px 14px', cursor: 'pointer',
        transform: h ? 'translateY(-1px)' : 'none',
        boxShadow: h ? '0 8px 22px rgba(0,0,0,0.4)' : 'none',
        transition: 'border-color .14s, transform .14s, box-shadow .14s',
        fontFamily: T.font,
      }}>
      {icon && (typeof icon === 'string'
        ? <div style={{
            width: 34, height: 34, flexShrink: 0, borderRadius: 9, display: 'grid', placeItems: 'center',
            fontSize: 16, background: 'rgba(255,255,255,0.05)', border: `1px solid ${T.border}`,
          }}>{icon}</div>
        : <div style={{ flexShrink: 0 }}>{icon}</div>)}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontWeight: 600, fontSize: 13.5, color: T.text1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
          {badge}
        </div>
        {sub && <div style={{ fontSize: 11, color: T.text2, marginTop: 2, lineHeight: 1.4 }}>{sub}</div>}
      </div>
      {right}
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  if (!inElectron) return <BrowserGate />
  return <AuthGate>{auth => <ElectronShell auth={auth} />}</AuthGate>
}
