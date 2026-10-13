import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, Suspense, lazy } from 'react'
import { apiFetch } from './lib/apiClient'
import LiveCompanion from './LiveCompanion'
import AuthGate from './auth/AuthGate'

const Solo = lazy(() => import('./Solo'))
const Duo = lazy(() => import('./Duo'))
const Jobs = lazy(() => import('./Jobs'))
const Career = lazy(() => import('./Career'))
const Account = lazy(() => import('./Account'))
import { T } from './auth/tokens'
import { AppShell, SessionsTable } from './Dashboard'
import { JourneyHome, InterviewKitsScreen, ReadyRoom } from './journey/JourneyScreens'
import {
  activeInterviewKit,
  createInterviewKit,
  interviewKitFromProfile,
  loadInterviewKitState,
  normalizeInterviewKit,
  profileFromInterviewKit,
  saveInterviewKitState,
} from './lib/interviewKits'
import SoloFeedback from './SoloFeedback'
import WhatsNew from './WhatsNew'
import ApiKeysPanel from './ApiKeys'
import { getAiMode } from './lib/aiMode'
import { getAnswerStyle, setAnswerStyle, getScreenshotSpeed, setScreenshotSpeed, screenshotStyle, getAutoSkip, setAutoSkip, getDocThreshold, setDocThreshold } from './lib/aiSettings'
import { loadSessionsAsync, getSessionAsync, deleteSessionAsync } from './history'
import { removeKitDocs } from './lib/docs'
import { scoreColor, TYPE_LABEL } from './lib/ui'
import { CODING_LANGUAGES } from './lib/languages'
import { loadProfile, saveProfile } from './lib/profile'
import {
  buildInterviewJobSeed,
  applyInterviewJobSeed,
  interviewSeedConfirmMessage,
} from './lib/interviewJobSeed'
import { activeAccountScope, getScopedItem } from './lib/accountScope'
import { copyText, downloadTextFile } from './lib/clipboard'
import { startWindowDrag } from './lib/windowDrag'
import { canRunLanguage, runJavaScriptIsolated } from './lib/codeRunner'
import { diagnostic } from './lib/diagnostics'
import { trackProductEvent, attachRageClickObserver } from './lib/productIntelligence'
import ProductIntelligencePanel from './components/ProductIntelligencePanel'
import {
  createScreenContextRecord,
  previousScreenForContinuation,
  screenContinuationCandidate,
  screenFingerprint,
} from '../shared/screenContext.js'

const isLocalDevApp = Boolean(import.meta.env?.DEV)
  && typeof window !== 'undefined'
  && /^(localhost|127\.0\.0\.1)$/i.test(window.location?.hostname || '')
const inElectron = typeof window !== 'undefined' && (
  !!window.electronAPI?.isElectron
  || isLocalDevApp
)
const isLinux = typeof window !== 'undefined' && window.electronAPI?.platform === 'linux'

// Views that render in the full windowed app shell (large window + sidebar). Solo runs
// here too — there's no interviewer watching, so it gets the roomy dashboard, not the
// overlay. ONLY the Live companion drops to the compact always-on-top overlay.
const SHELL_VIEWS = ['home', 'kits', 'ready-room', 'solo', 'duo', 'jobs', 'career', 'settings', 'account', 'history']

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
  const [kitState, setKitState] = useState(() => loadInterviewKitState(loadProfile()))
  const [launchKitId, setLaunchKitId] = useState(null)
  const [readyAudioSource, setReadyAudioSource] = useState(null)
  const kits = kitState.kits || []
  const activeKit = useMemo(() => activeInterviewKit(kitState), [kitState])
  const launchKit = kits.find(kit => kit.id === launchKitId) || null
  const [careerSeed, setCareerSeed] = useState(null)       // one-shot Jobs → Resume Studio handoff
  const [whatsNewSignal, setWhatsNewSignal] = useState(0)   // bump to re-open the What's New modal
  const [report, setReport] = useState(null)
  const [panelSize, setPanelSize] = useState(() => {
    try {
      const raw = localStorage.getItem('mm-overlay-size')
      if (raw) {
        const p = JSON.parse(raw)
        if (p?.w >= 240 && p?.h >= 180) return { w: Math.max(600, p.w), h: Math.max(600, p.h) }
      }
    } catch {}
    // Leave enough room for readable Live text on first launch.
    return { w: 600, h: 720 }
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
  const onClickThrough = useCallback(enabled => {
    setClickThrough(current => typeof enabled === 'boolean' ? enabled : !current)
  }, [])
  const [minimized, setMinimized] = useState(false)
  const [screenAnalysis, setScreenAnalysis] = useState(null)   // vision analysis result
  const [screenAnalyzing, setScreenAnalyzing] = useState(false)
  const [screenFlowStatus, setScreenFlowStatus] = useState('')
  const profileRef = useRef({})
  const resizing = useRef(false)
  const resizeStart = useRef({})

  function commitKitState(next) {
    if (!saveInterviewKitState(next)) return false
    setKitState(next)
    return true
  }

  function activateKit(id) {
    if (!kits.some(kit => kit.id === id)) return false
    return commitKitState({ ...kitState, activeKitId: id })
  }

  function createKit() {
    if (kits.length >= 30) {
      window.alert('You can save up to 30 Interview Kits on this device.')
      return null
    }
    const kit = createInterviewKit({}, { title: 'New interview kit' })
    const next = { ...kitState, kits: [kit, ...kits], activeKitId: kit.id }
    if (!commitKitState(next)) return null
    setLaunchKitId(kit.id)
    return kit.id
  }

  function saveKit(value) {
    const existing = kits.find(kit => kit.id === value?.id)
    if (!existing) return false
    const updated = normalizeInterviewKit({ ...existing, ...value, updatedAt: new Date().toISOString() })
    const next = { ...kitState, kits: kits.map(kit => kit.id === updated.id ? updated : kit) }
    return commitKitState(next)
  }

  function deleteKit(id) {
    const remaining = kits.filter(kit => kit.id !== id)
    const next = { ...kitState, kits: remaining, activeKitId: kitState.activeKitId === id ? (remaining[0]?.id || null) : kitState.activeKitId }
    const ok = commitKitState(next)
    if (ok) {
      if (!removeKitDocs(id)) {
        diagnostic('kits', 'material_cleanup_failed', {}, 'warn')
        window.alert('The Kit was deleted, but its local attachments could not be cleared. Check device storage and remove them before sharing this device.')
      }
      setLaunchKitId(current => current === id ? null : current)
    }
    return ok
  }

  function saveKitProfile(id, profile) {
    const kit = kits.find(item => item.id === id)
    return kit ? saveKit(interviewKitFromProfile(kit, profile)) : false
  }

  function openKitEditor(kit) {
    if (kit?.id) activateKit(kit.id)
    setView('kits')
  }

  function openReadyRoom(kit = activeKit) {
    if (kit?.id) activateKit(kit.id)
    setView('ready-room')
  }

  function startPractice() {
    if (!activeKit) { setView('kits'); return }
    setLaunchKitId(activeKit.id)
    setView('solo')
  }

  function continueToLive(kit = activeKit, readiness = {}) {
    setReadyAudioSource(readiness.audioSource || null)
    if (!kit) { setView('kits'); return }
    activateKit(kit.id)
    setLaunchKitId(kit.id)
    setView('companion')
  }

  function handleNav(destination) {
    if (destination === 'companion') { setView('ready-room'); return }
    if (destination === 'solo') setLaunchKitId(activeKit?.id || null)
    setView(destination)
  }

  async function applyReadyRoomProtection() {
    if (!window.electronAPI?.setContentProtection) return { ok: false, unsupported: true, error: 'Electron capture protection is unavailable.' }
    try {
      const result = await window.electronAPI.setContentProtection(true)
      if (result?.ok) setStealth(true)
      return result || { ok: false, error: 'No protection status was returned.' }
    } catch (error) {
      return { ok: false, error: error?.message || 'Capture protection request failed.' }
    }
  }

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
  const [diagnosticStatus, setDiagnosticStatus] = useState('')
  const exportDiagnostics = useCallback(async () => {
    setDiagnosticStatus('Preparing…')
    try {
      const r = await window.electronAPI?.exportDiagnostics?.()
      if (r?.canceled) setDiagnosticStatus('')
      else setDiagnosticStatus(r?.ok ? 'Exported' : (r?.error || 'Export failed'))
    } catch { setDiagnosticStatus('Export failed') }
  }, [])
  const clearDiagnostics = useCallback(async () => {
    if (!window.confirm('Clear local diagnostic logs? Saved interview sessions are not affected.')) return
    try {
      const r = await window.electronAPI?.clearDiagnostics?.()
      setDiagnosticStatus(r?.ok ? 'Cleared' : (r?.error || 'Clear failed'))
    } catch { setDiagnosticStatus('Clear failed') }
  }, [])
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
  const [sessions, setSessions] = useState([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyError, setHistoryError] = useState('')
  const [openSession, setOpenSession] = useState(null)
  const refreshSessions = useCallback(async (offset = 0) => {
    const scope = activeAccountScope()
    try { const result = await loadSessionsAsync(offset); if (scope !== activeAccountScope()) return; setSessions(rows => offset ? [...rows,...result.sessions] : result.sessions); setHistoryTotal(result.total); setHistoryError(result.warning || '') }
    catch { if (scope !== activeAccountScope()) return; setHistoryError('History could not be loaded. Legacy data is retained; retry or export before changing versions.') }
  }, [])
  useEffect(() => { refreshSessions() }, [refreshSessions])

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
          const { w, h } = panelSizeRef.current || { w: 600, h: 720 }
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
  }, [])

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
    trackProductEvent('login')
    return attachRageClickObserver()
  }, [])

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
    diagnostic('screen', 'analysis_started', {
      requestId, language: language || 'auto', retry, continuationMode,
      hasPreviousScreen: !!previousScreen, width: imageDimensions?.width, height: imageDimensions?.height,
    })
    if (cached && retry === 0) {
      diagnostic('screen', 'analysis_cache_hit', { requestId, continuation: !!cached.isContinuation })
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
        diagnostic('screen', 'analysis_failed', { requestId, status: res.status, code: code || 'unknown', retry }, 'error')
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
          diagnostic('screen', 'analysis_completed', {
            requestId, continuation: !!analysis.isContinuation,
            captureCount: analysis._captureCount || 1, language: language || analysis.language || 'auto',
          })
          trackProductEvent('screen_analyzed', {
            continuation: !!analysis.isContinuation,
            captureCount: analysis._captureCount || 1,
          })
          setScreenFlowStatus(analysis.isContinuation
            ? `Combined ${analysis._captureCount} screenshots — one answer updated`
            : 'Captured as a new question')
        }
      }
    } catch (e) {
      if (abort.signal.aborted || gen !== analysisGenRef.current) return // cancelled — no retry
      diagnostic('screen', 'analysis_exception', { requestId, retry, errorName: e?.name, reason: e?.message }, 'error')
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
        trackProductEvent('f7_captured', { mode: shot.continuationMode || 'auto' })
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
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
    window.addEventListener('blur', onUp)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', onUp)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  // A Windows pointer-up can be lost while a frameless window is moving or shrinking.
  // Never carry a stale resize session into the 72×72 pill: the next pill drag would
  // otherwise move and resize simultaneously, producing an expanding black rectangle.
  useEffect(() => {
    if (minimized) resizing.current = false
  }, [minimized])

  // Collapsed to the badge: the native window can be bigger than the badge (a Windows
  // transparent-window artifact) and the app must not paint anything across it, or the
  // excess shows as a black rectangle. src/styles.css owns the rule; this only toggles it.
  // Layout effect, not effect: the class must be in place before the collapse paints,
  // otherwise the badge flashes a black frame on the way in.
  useLayoutEffect(() => {
    document.body.classList.toggle('mm-collapsed', minimized)
    return () => document.body.classList.remove('mm-collapsed')
  }, [minimized])

  function expandFromPill() {
    setMinimized(false)
    if (inElectron && viewRef.current === 'companion' && companionPhaseRef.current === 'live') {
      const { w, h } = panelSizeRef.current || { w: 600, h: 720 }
      queueMicrotask(() => window.electronAPI?.windowResize?.(w, h))
    }
  }

  function collapseToPill() {
    window.electronAPI?.setWindowMode?.('pill')
    setClickThrough(false)
    setMinimized(true)
  }

  const startDrag = e => {
    resizing.current = false
    startWindowDrag(e)
  }

  function startResize(e, edge = 'se') {
    resizing.current = true
    trackProductEvent('overlay_resize', { edge })
    const native = inElectron ? window.electronAPI?.getWindowSize?.() : null
    const size = native ? { w: native.width, h: native.height } : panelSize
    resizeStart.current = {
      x: e.screenX, y: e.screenY,
      w: size.w, h: size.h,
      edge,
      _lastW: size.w, _lastH: size.h,
    }
    try { e.currentTarget?.setPointerCapture?.(e.pointerId) } catch {}
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
      // Explicit Jobs/Career handoff is the shared-profile route, not an active Kit launch.
      setLaunchKitId(null)
      setView(destination === 'live' ? 'companion' : 'solo')
    } catch (e) {
      window.alert(e?.message || 'Could not apply that job description.')
    }
  }

  // Persist manual edge-resizes so the next Live session opens at the same HUD size.
  useEffect(() => {
    if (view === 'companion' && companionPhase === 'live') {
      try { localStorage.setItem('mm-overlay-size', JSON.stringify(panelSize)) } catch {}
    }
  }, [panelSize, view, companionPhase])

  // Resize the OS window: full dashboard for shell views + Live setup/feedback; compact
  // invisible overlay for the live interview itself; a tiny logo pill when minimized.
  useLayoutEffect(() => {
    let mode
    if (minimized) mode = 'pill'                          // collapsed → tiny click-to-expand pill
    else if (view === 'companion') mode = companionPhase === 'live' ? 'overlay' : 'app'
    else mode = (!showWelcome && SHELL_VIEWS.includes(view)) ? 'app' : 'overlay'
    window.electronAPI?.setWindowMode?.(mode, mode === 'overlay' ? panelSizeRef.current : undefined)
  }, [view, showWelcome, companionPhase, minimized])

  // The sessions list is a snapshot — refresh it when the Sessions tab opens so a
  // just-finished interview shows up without navigating away and back.
  useEffect(() => { if (view === 'history') refreshSessions() }, [view])

  // Collapsed pill for dashboard/shell — keep shell views mounted (hidden) so Career JD /
  // form state survives minimize. Live overlay keeps its own minimized handling.
  const shellPill = minimized && !(view === 'companion' && companionPhase === 'live') && SHELL_VIEWS.includes(view)
  const stealthSafety = <StealthSafetyPrompt confirmOff={stealthConfirmOff} notice={stealthNotice}
    onCancel={() => setStealthConfirmOff(false)} onConfirmOff={() => applyStealth(false)} />

  // ── First-run welcome — guide a brand-new user straight to adding a key ──
  if (showWelcome) return (
    <OverlayPanel panelSize={panelSize} stealth={stealth} minimized={minimized} opacity={opacity} onOpacity={setOpacity}
      onDrag={startDrag} onResize={startResize}
      onStealth={requestStealthToggle} onMinimize={() => setMinimized(m => !m)} clickThrough={clickThrough} onClickThrough={onClickThrough}
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
      <JourneyHome auth={auth} sessions={sessions} kits={kits} activeKit={activeKit}
        onSelectKit={activateKit}
        onOpenKits={() => setView('kits')}
        onOpenReadyRoom={() => openReadyRoom(activeKit)}
        onStartPractice={startPractice}
        onOpenHistory={openHistory}
        onSettings={() => setView('settings')} />
    )
    else if (view === 'kits') content = (
      <InterviewKitsScreen key={activeKit?.id || 'no-active-kit'} kits={kits} activeKitId={activeKit?.id || null}
        onCreate={createKit} onSave={saveKit} onDelete={deleteKit} onActivate={activateKit}
        onOpenReadyRoom={kit => openReadyRoom(kit || activeKit)} />
    )
    else if (view === 'ready-room') content = (
      <ReadyRoom key={activeKit?.id || 'no-active-kit'} kit={activeKit}
        onOpenKits={() => setView('kits')}
        onEditKit={openKitEditor}
        onSettings={() => setView('settings')}
        onContinueLive={continueToLive}
        onApplyProtection={applyReadyRoomProtection}
        isLinux={isLinux} stealth={stealth} />
    )
    else if (view === 'solo') {
      const soloKit = launchKit
      const initialProfile = soloKit ? profileFromInterviewKit(soloKit, loadProfile()) : undefined
      content = <Solo key={soloKit?.id || 'shared-profile'} onHome={goHome} noProviders={noProviders}
        initialProfile={initialProfile} kitId={soloKit?.id} kitName={soloKit?.title} draftScope={soloKit?.id}
        onProfileChange={profile => soloKit && saveKitProfile(soloKit.id, profile)} />
    }
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
        <ProductIntelligencePanel />
        <div style={{ marginTop: 12, padding: '14px 16px', background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>Diagnostics</div>
              <div style={{ fontSize: 11.5, color: T.text2, marginTop: 2, lineHeight: 1.45 }}>Privacy-safe local events for API, transcription, screenshots, sessions, auth and updates. Keys, tokens, passwords, résumé, transcripts, prompts and screenshots are redacted.</div>
            </div>
            <button onClick={exportDiagnostics} style={{ height: 36, padding: '0 14px', background: T.accent, color: '#fff', border: 'none', borderRadius: T.rCtrl, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: T.font, whiteSpace: 'nowrap' }}>Export logs</button>
            <button onClick={clearDiagnostics} style={{ height: 36, padding: '0 14px', background: 'transparent', color: T.text2, border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl, fontSize: 12, cursor: 'pointer', fontFamily: T.font, whiteSpace: 'nowrap' }}>Clear</button>
          </div>
          {diagnosticStatus && <div role="status" style={{ marginTop: 8, fontSize: 11.5, color: diagnosticStatus === 'Exported' || diagnosticStatus === 'Cleared' ? '#5eead4' : T.text2 }}>{diagnosticStatus}</div>}
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
            {historyError && <div role="alert">{historyError}<button onClick={() => refreshSessions()}>Retry History</button><button onClick={() => downloadTextFile('mockmate-legacy-history.json', getScopedItem('mm-sessions','[]'),'application/json')}>Export legacy data</button></div>}
            <SessionsTable sessions={sessions} onOpen={async s => { try { setOpenSession(await getSessionAsync(s.id)) } catch { setHistoryError('This session could not be opened. Please retry.') } }}
              onDelete={async id => { if (window.confirm('Delete this session from History? Original legacy migration copies may still be retained.')) { if (sessions.find(row => row.id === id)?.legacyReadOnly) { setHistoryError('Read-only legacy sessions cannot be deleted until import is resolved.'); return } try { await deleteSessionAsync(id); await refreshSessions() } catch { setHistoryError('Delete failed. The session has been retained.') } } }} />
            {sessions.length < historyTotal && <button onClick={() => refreshSessions(sessions.length)}>Load more sessions</button>}
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
        <div style={shellPill ? { display: 'none' } : undefined} aria-hidden={shellPill || undefined} data-pi-section={view}>
          <AppShell minimized={shellPill} active={view} onNav={handleNav} auth={auth} meetingActive={meetingActive}
            stealth={stealth} onStealth={requestStealthToggle}
            onMinimize={collapseToPill} onClose={() => window.close?.()}>
            <WhatsNew openSignal={whatsNewSignal} />
            <Suspense fallback={<div style={{ color: T.text3, fontSize: 12.5, padding: '24px 4px', fontFamily: T.font }}>Loading workspace…</div>}>
              {content}
            </Suspense>
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
    <LiveCompanion initialAudioSource={readyAudioSource} key={launchKit?.id || 'shared-profile'}
      initialProfile={launchKit ? profileFromInterviewKit(launchKit, loadProfile()) : undefined}
      initialKit={launchKit ? { id: launchKit.id, name: launchKit.title } : null}
      onProfileChange={profile => launchKit && saveKitProfile(launchKit.id, profile)}
      onHome={goHome} onPhaseChange={setCompanionPhase} panelSize={panelSize} stealth={stealth} opacity={opacity} onOpacity={setOverlayOpacity} minimized={minimized}
      onSessionStart={resetLiveSessionContext} onSessionEnd={resetLiveSessionContext}
      onStealth={requestStealthToggle}
      onMinimize={() => {
        if (minimized) expandFromPill()
        else collapseToPill()
      }}
      clickThrough={clickThrough} onClickThrough={onClickThrough}
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

  // Fallback: unrecognized view — show a minimal branded panel instead of a black window.
  // This prevents the overlay window from appearing as a blank black rectangle when the
  // saved view is stale or invalid.
  return (
    <OverlayPanel panelSize={panelSize} stealth={stealth} minimized={minimized} opacity={opacity} onOpacity={setOpacity}
      onDrag={startDrag} onResize={startResize}
      onStealth={requestStealthToggle} onMinimize={() => setMinimized(m => !m)} clickThrough={clickThrough} onClickThrough={onClickThrough}
      onClose={goHome} title="MockMate" autoHeight>
      <div style={{ padding: '14px 16px 16px', fontFamily: T.font, textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: T.text1, marginBottom: 8 }}>MockMate</div>
        <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.5, marginBottom: 12 }}>
          Something went wrong. Click below to return to the dashboard.
        </div>
        <button onClick={goHome}
          style={{ width: '100%', height: 36, background: T.accentFrom, color: '#fff', border: 'none', borderRadius: T.rCtrl, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>
          Go to Dashboard
        </button>
      </div>
    </OverlayPanel>
  )
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
export function CodeBlock({ code, runnableCode, language, fontScale = 1 }) {
  const [copied, setCopied] = useState(false)
  const [copiedRunnable, setCopiedRunnable] = useState(false)
  const [runState, setRunState] = useState(null)
  async function copy() {
    const ok = await copyText(code || '')
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500) }
  }
  async function run() {
    setRunState({ running: true })
    setRunState(await runJavaScriptIsolated(runnableCode || code))
  }
  async function copyRunnable() {
    const ok = await copyText(runnableCode || '')
    if (ok) { setCopiedRunnable(true); setTimeout(() => setCopiedRunnable(false), 1500) }
  }
  const runnable = canRunLanguage(language)
  const hasSeparateRunnable = Boolean(runnableCode && String(runnableCode).trim() !== String(code || '').trim())
  return (
    <div style={{ background: '#0d1117', border: '1px solid #1f2733', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 9px', borderBottom: '1px solid #1f2733', background: 'rgba(255,255,255,0.02)' }}>
        <span style={{ fontSize: 10 * fontScale, color: '#7d8590', fontFamily: 'monospace' }}>{language || 'code'}</span>
        {runnable && <button onClick={run} disabled={runState?.running}
          title="Runs JavaScript in a disposable worker with network/DOM access disabled and a 1.5s timeout"
          style={{ marginLeft: 'auto', background: 'rgba(94,234,212,0.1)', color: '#5eead4', border: '1px solid rgba(94,234,212,0.25)', borderRadius: 5, padding: '2px 9px', fontSize: 10 * fontScale, fontWeight: 600, cursor: runState?.running ? 'default' : 'pointer' }}>
          {runState?.running ? 'Running…' : '▶ Run JS'}
        </button>}
        {!runnable && <span title="Execution is currently available for JavaScript only; this solution can still be copied"
          style={{ marginLeft: 'auto', color: '#7d8590', fontSize: 9 * fontScale }}>
          Preview · Run supports JS only
        </span>}
        <button onClick={copy} title="Copy the clean interview-platform solution" style={{ marginLeft: runnable ? 0 : 6, background: copied ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)', color: copied ? '#4ade80' : T.text2, border: 'none', borderRadius: 5, padding: '2px 7px', fontSize: 10 * fontScale, fontWeight: 600, cursor: 'pointer' }}>
          {copied ? '✓ Copied' : '⧉ Solution'}
        </button>
        {hasSeparateRunnable && <button onClick={copyRunnable} title="Copy standalone code for Programiz or another online compiler"
          style={{ background: copiedRunnable ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)', color: copiedRunnable ? '#4ade80' : T.text2, border: 'none', borderRadius: 5, padding: '2px 7px', fontSize: 10 * fontScale, fontWeight: 600, cursor: 'pointer' }}>
          {copiedRunnable ? '✓ Copied' : '⧉ Runnable'}
        </button>}
      </div>
      <pre style={{ margin: 0, padding: '10px 12px', overflowX: 'auto', maxHeight: 260 }}>
        <code style={{ fontFamily: T.fontMono, fontSize: 12 * fontScale, lineHeight: 1.6, color: '#e6edf3', whiteSpace: 'pre' }}>{highlightCode(code || '')}</code>
      </pre>
      {hasSeparateRunnable && <details style={{ borderTop: '1px solid #1f2733' }}>
        <summary style={{ padding: '6px 10px', cursor: 'pointer', color: '#7d8590', fontSize: 10 * fontScale }}>Runnable version · online compiler</summary>
        <pre style={{ margin: 0, padding: '10px 12px', overflowX: 'auto', maxHeight: 220, borderTop: '1px solid #1f2733' }}>
          <code style={{ fontFamily: T.fontMono, fontSize: 12 * fontScale, lineHeight: 1.6, color: '#e6edf3', whiteSpace: 'pre' }}>{highlightCode(runnableCode)}</code>
        </pre>
      </details>}
      {runState && !runState.running && <div role="status" style={{ padding: '6px 10px', borderTop: '1px solid #1f2733', fontFamily: T.fontMono, whiteSpace: 'pre-wrap', fontSize: 10 * fontScale, color: runState.ok ? '#86efac' : '#fca5a5', maxHeight: 100, overflow: 'auto' }}>
        {runState.ok
          ? ([...(runState.logs || []), runState.result].filter(x => x != null && x !== '').join('\n') || '✓ JavaScript loaded successfully. Add a function call or console.log to see output.')
          : `✗ ${runState.error || 'Execution failed'}`}
      </div>}
    </div>
  )
}

// ── Screen Analysis Panel — shown when Ctrl+Shift+U is pressed ───────────────
export function ScreenAnalysisPanel({ analysis, analyzing, flowStatus, onDismiss, onReanalyze, onRecapture, onContinueCapture, onNewCapture, onUndoMerge, captureDisplays, captureDisplayId, onCaptureDisplayId, liveAttachHint }) {
  const [requestedLanguage, setRequestedLanguage] = useState('')
  const [codingTab, setCodingTab] = useState('all') // 'all' | 'code' | 'approach'
  useEffect(() => { if (!analyzing) setRequestedLanguage('') }, [analyzing, analysis])
  useEffect(() => { setCodingTab('all') }, [analysis])
  if (!analyzing && !analysis) return null
  // Supports wrapped screen-context records { analysis, status, error } and legacy flat analysis.
  const record = analysis?.analysis || analysis
  const status = analysis?.status
  const err = analysis?.error || record?.error
  const isCoding = (record?.contentType === 'coding') || (record?.screenFamily === 'screen_code')
  const hasCodingTabs = Boolean(record?.code && Array.isArray(record?.approach) && record.approach.length > 0)
  const activeCodingTab = hasCodingTabs ? codingTab : 'all'
  const accent = isCoding ? 'rgba(34,197,94,0.28)' : 'rgba(234,179,8,0.28)'
  const accentBg = isCoding ? 'rgba(12, 28, 22, 0.88)' : 'rgba(28, 23, 12, 0.88)'
  const statusLabel = analyzing ? 'Analyzing…'
    : status === 'not_captured' ? 'SCREEN NOT CAPTURED'
    : status === 'unsupported' ? 'CAPTURE UNSUPPORTED'
    : status === 'failed' || err ? 'SCREEN ANALYSIS FAILED'
    : status === 'analyzed_cached' ? 'SCREEN ANALYZED (cached)'
    : liveAttachHint === 'attached' ? 'SCREEN CONTEXT ATTACHED'
    : liveAttachHint === 'irrelevant' ? 'SCREEN SOLVED INDEPENDENTLY'
    : 'SCREEN ANALYZED'
  return (
    <div style={{ background: accentBg, border: `1px solid ${accent}`, borderRadius: 10, padding: '12px', marginBottom: 10, boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: isCoding ? '#4ade80' : '#fbbf24' }}>{isCoding ? 'Coding Solution' : 'Screen Analysis'}</span>
        <span style={{ fontSize: 9, color: T.text3, background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 8, fontFamily: T.fontMono }}>F7 / Ctrl+Shift+U</span>
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
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                  {record.pattern && <span style={{ fontSize: 9, padding: '2px 8px', background: 'rgba(20,184,166,0.3)', color: '#99f6e4', borderRadius: 10, fontWeight: 700 }}>{record.pattern}</span>}
                  {record.complexity && <span style={{ fontSize: 9, padding: '2px 8px', background: '#0d1117', color: '#7ee787', borderRadius: 10, fontFamily: T.fontMono }}>{record.complexity}</span>}
                  {record.language && <span style={{ fontSize: 9, padding: '2px 8px', background: 'rgba(255,255,255,0.06)', color: T.text2, borderRadius: 10 }}>{record.language}</span>}
                  {record.code && Array.isArray(record.approach) && record.approach.length > 0 && (
                    <div style={{ marginLeft: 'auto', display: 'inline-flex', background: 'rgba(0,0,0,0.32)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7, padding: 2, gap: 2 }}>
                      {[['all', 'All'], ['code', 'Code'], ['approach', 'Steps']].map(([id, lbl]) => (
                        <button key={id} type="button" onClick={() => { setCodingTab(id); if (id !== 'all') trackProductEvent('coding_tab_used', { tab: id }) }}
                          style={{ fontSize: 9.5, fontWeight: 600, padding: '2px 7px', borderRadius: 5, border: 'none', cursor: 'pointer',
                            background: codingTab === id ? 'rgba(20,184,166,0.28)' : 'transparent',
                            color: codingTab === id ? '#5eead4' : T.text3 }}>{lbl}</button>
                      ))}
                    </div>
                  )}
                </div>
                {record.detectedText && <div style={{ fontSize: 11, color: T.text2, marginBottom: 8, borderLeft: '2px solid rgba(34,197,94,0.35)', paddingLeft: 7 }}>{record.detectedText}</div>}
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
                {activeCodingTab !== 'code' && Array.isArray(record.approach) && record.approach.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 9, color: T.text3, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 4 }}>APPROACH</div>
                    {record.approach.map((step, i) => (
                      <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 3, fontSize: 12, color: T.text1 }}>
                        <span style={{ color: '#4ade80', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{i + 1}.</span><span>{step}</span>
                      </div>
                    ))}
                  </div>
                )}
                {activeCodingTab !== 'approach' && record.code && <CodeBlock code={record.code} runnableCode={record.runnableCode} language={record.language} />}
                {activeCodingTab !== 'code' && Array.isArray(record.testCases) && record.testCases.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 9, color: T.text3, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 4 }}>SAMPLE TESTS</div>
                    {record.testCases.slice(0, 4).map((test, i) => (
                      <div key={i} style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, padding: '5px 7px', marginBottom: 4, fontFamily: T.fontMono, fontSize: 10, color: T.text2 }}>
                        <div><span style={{ color: T.text3 }}>input:</span> {String(test?.input ?? '')}</div>
                        <div><span style={{ color: T.text3 }}>expected:</span> {String(test?.expectedOutput ?? '')}</div>
                        <div style={{ color: test?.source === 'question' ? '#86efac' : '#fbbf24', marginTop: 2, fontFamily: T.font }}>
                          {test?.source === 'question' ? 'From visible question' : 'Illustrative sanity test'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {activeCodingTab !== 'code' && Array.isArray(record.edgeCases) && record.edgeCases.length > 0 && (
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
    case 'pin':      return <svg {...p}><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z" /></svg>
    case 'cursor':   return <svg {...p}><path d="M4 4l7.07 17 2.51-7.39L21 11.07z" /><path d="M13.5 13.5L19 19" /></svg>
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
      <input type="range" min="0" max="0.6" step="0.05" value={v} aria-label="Document retrieval match threshold"
        onChange={e => { const n = parseFloat(e.target.value); setV(n); setDocThreshold(n) }}
        style={{ width: '100%', accentColor: T.accentFrom, cursor: 'pointer' }} />
    </div>
  )
}

export function OverlayPanel({ children, panelSize, stealth, minimized, onDrag, onResize, onStealth, onMinimize, onClose, title, extra, actions, opacity = 0.95, onOpacity, autoHeight, clickThrough, onClickThrough, confirmClose }) {
  const [confirming, setConfirming] = useState(false)
  const [clickThroughError, setClickThroughError] = useState('')
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
    if (!inElectron || typeof window.electronAPI?.setClickThrough !== 'function') return
    let active = true
    const requested = !!clickThrough
    window.electronAPI.setClickThrough(requested).then(result => {
      if (!active) return
      if (result?.ok === false) {
        setClickThroughError(`Could not ${requested ? 'enable' : 'disable'} click-through: ${result.error || 'the overlay window did not accept the change.'}`)
        if (requested) onClickThrough?.(false)
      } else if (requested) {
        setClickThroughError('')
      }
    }).catch(error => {
      if (!active) return
      setClickThroughError(`Could not ${requested ? 'enable' : 'disable'} click-through: ${error?.message || 'IPC request failed.'}`)
      if (requested) onClickThrough?.(false)
    })
    return () => {
      active = false
      if (requested) window.electronAPI?.setClickThrough?.(false)?.catch?.(() => {})
    }
  }, [clickThrough, onClickThrough])
  // Alt+C force-off click-through (global shortcut → renderer)
  useEffect(() => {
    if (!inElectron || !onClickThrough) return
    const off = window.electronAPI?.onShortcutClickThroughOff?.(() => {
      setClickThroughError('')
      if (clickThrough) onClickThrough(false)
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
    let active = true
    const setAccept = on => {
      if (on === accepting) return
      accepting = on
      const pending = window.electronAPI?.setIgnoreMouseEvents?.(!on, { forward: true })
      if (pending && typeof pending.then === 'function') {
        pending.then(result => {
          if (!active) return
          if (result?.ok === false) {
            setClickThroughError(`Mouse forwarding failed: ${result.error || 'the overlay could not update its hit region.'} Click-through has been turned off.`)
            onClickThrough?.(false)
          }
        }).catch(error => {
          if (!active) return
          setClickThroughError(`Mouse forwarding failed: ${error?.message || 'IPC request failed.'} Click-through has been turned off.`)
          onClickThrough?.(false)
        })
      }
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
      active = false
      root.removeEventListener('mousemove', onMove, true)
      root.removeEventListener('mouseleave', onLeave, true)
      // Do NOT re-enable click-through here — the companion setClickThrough(false) effect owns final state.
    }
  }, [clickThrough, onClickThrough])
  function togglePin() {
    setPinned(p => { const v = !p; try { localStorage.setItem('mm-pinned', v ? '1' : '0') } catch {} ; return v })
  }
  function toggleClickThrough() {
    setClickThroughError('')
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
    <div id="mockmate-overlay" style={{ position: 'fixed', inset: 0, background: 'transparent', pointerEvents: 'none', zIndex: 9999 }}>
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
            onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling && (e.currentTarget.nextSibling.style.display = 'grid') …25616 tokens truncated…tiveRag(ragSpec.current.q, text)) return

    const launch = () => {
      if (!sessionActiveRef.current) return
      if (ragSpec.current?.p && canReuseSpeculativeRag(ragSpec.current.q, text)) return
      const peek = classifyTurn({
        question: text,
        profile: profileRef.current,
        conversationHistory: interviewStateRef.current?.getLlmHistory?.({ includeLastAnswer: false }) || [],
        lastClassification: lastClassificationRef.current,
        recentScreen: recentScreenRef.current,
      })
      if (!shouldRetrieveDocs(peek)) return
      try { ragSpec.current?.ac?.abort() } catch {}
      const ac = new AbortController()
      const opts = { ...liveRagOpts(peek, interviewConfigRef.current, 600), signal: ac.signal }
      ragSpec.current = {
        q: text,
        ac,
        timer: null,
        p: retrieveContext(text, opts).catch(() => ''),
      }
    }

    if (immediate) {
      launch()
    } else {
      ragSpec.current.timer = setTimeout(launch, RAG_PREFETCH_DEBOUNCE_MS)
    }
  }, [])

  // M2 question capture pipeline — commit BEFORE generate.
  if (!captureRef.current) {
    const buffer = createTranscriptBuffer()
    captureRef.current = createQuestionCaptureController({
      buffer,
      getHadPriorQuestion: () => {
        const snap = interviewStateRef.current?.getSnapshot?.()
        return !!(snap?.questionHistory?.length || snap?.questions?.some(q => q.committedAt))
      },
      getLastCommittedText: () => {
        const snap = interviewStateRef.current?.getSnapshot?.()
        const hist = snap?.questionHistory || []
        return hist[hist.length - 1]?.text || lastHintText.current || ''
      },
      // System/loopback capture is meeting audio by construction → Turn-1 commit boost.
      getAudioSource: () => (liveSourceIdRef.current && liveSourceIdRef.current !== 'microphone' ? 'system' : 'microphone'),
      onLive: ({ text, status, reason }) => {
        liveCaptureTextRef.current = text || ''
        setLiveCaptureText(text || '')
        setCaptureStatus(status || 'listening')
        interviewStateRef.current?.setLiveCapture?.({ text, status, reason })
      },
      onCandidate: (c) => {
        interviewStateRef.current?.upsertCaptureCandidate?.({
          questionId: c.id,
          text: c.text,
          rawTranscript: c.rawTranscript,
          speaker: c.speaker,
          status: c.status || 'candidate',
          revisionCount: c.revisionCount,
          source: 'stt',
        })
        // Debounced, single-flight speculative RAG pre-warm DURING the stabilization window.
        const candText = String(c?.text || '').trim()
        if (candText && candText.split(/\s+/).length >= 5) {
          startSpeculativeRag(candText, { immediate: false })
        }
        // The interviewer kept talking: an early answer for the shorter text is stale.
        speculativeHintRef.current?.cancelUnlessKey(normalizeCaptureText(candText), 'speech_continued')
      },
      onStabilizing: (c) => { startSpeculativeHintRef.current?.(c) },
      onCommitted: (c) => { handleCommittedRef.current?.(c) },
      onRevision: (evt) => { speculativeHintRef.current?.cancel('revision'); handleRevisionRef.current?.(evt) },
      onRefinement: (evt) => { speculativeHintRef.current?.cancel('refinement'); handleRefinementRef.current?.(evt) },
      onReject: (reason) => {
        metricsRef.current?.markQuestionReject?.(reason)
        speculativeHintRef.current?.cancel('rejected')
      },
      onDebug: (evt) => {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('mm-debug-live') === '1') {

          console.info(formatCaptureDebugLine(evt))
        }
      },
    })
  }

  useEffect(() => { extraContextRef.current = extraContext }, [extraContext])
  useEffect(() => { coachModeRef.current = coachMode }, [coachMode])   // so generateHint (a [] useCallback closure) reads the live value
  useEffect(() => { liveCaptureTextRef.current = liveCaptureText }, [liveCaptureText])
  useEffect(() => { manualQRef.current = manualQ }, [manualQ])
  useEffect(() => {
    interviewStateRef.current?.setProfile?.(profile)
    profileRef.current = profile
  }, [profile])

  // Bound recent screen context for spoken fusion (replaces older capture).
  useEffect(() => {
    if (!screenAnalysis) return
    recentScreenRef.current = screenAnalysis
    codingScreenRef.current = updateCodingSessionContext(codingScreenRef.current, screenAnalysis)
    interviewStateRef.current?.setScreenContext?.(screenAnalysis)
    const a = screenAnalysis.analysis
    const isCode = !screenAnalysis.error && (
      screenAnalysis.contentType === 'screen_code'
      || a?.contentType === 'coding'
      || a?.screenFamily === 'screen_code'
    )
    if (!isCode || !a) return
    // Seed coding thread so "do it without X" keeps House Robber context after F7.
    lastClassificationRef.current = {
      questionType: 'screen_code',
      playbookKey: 'dsa',
      isFollowUp: false,
      parentType: null,
      parentTopic: a.detectedText || 'Screen coding problem',
      contextNeeds: { identity: true, resume: 'short', jd: 'none', rag: true, ragTypes: null, customPrompt: true, codingLanguage: true, history: true },
      classifierVersion: 'screen_f7_seed',
      question: a.detectedText || 'Screen coding problem',
    }
    const seedText = [
      a.detectedText && `Problem: ${a.detectedText}`,
      a.pattern && `Pattern: ${a.pattern}`,
      Array.isArray(a.approach) && a.approach.length ? `Approach: ${a.approach.slice(0, 5).join(' | ')}` : '',
      a.code ? `Code:\n${String(a.code).slice(0, 900)}` : '',
      a.complexity && `Complexity: ${a.complexity}`,
    ].filter(Boolean).join('\n')
    if (!seedText.trim()) return
    const state = interviewStateRef.current
    if (!state?.commitQuestion || !state?.commitAnswer) return
    const qid = screenAnalysis.screenContextId || `f7_${Date.now().toString(36)}`
    let q = state.getSnapshot?.()?.questions?.find?.(x => x.id === qid)
    if (!q) {
      q = state.commitQuestion(a.detectedText || 'Screen solve (F7)', null, {
        questionId: qid,
        source: 'screen_f7',
      })
    }
    if (q?.id) {
      state.attachClassification?.(q.id, lastClassificationRef.current)
      state.commitAnswer({
        questionId: q.id,
        generationId: `f7_${qid}`,
        text: seedText.slice(0, 1400),
        hint: { ...a, fullAnswer: seedText },
        incomplete: false,
      })
    }
  }, [screenAnalysis])

  useEffect(() => { answerStyleRef.current = answerStyle; persistAnswerStyle(answerStyle) }, [answerStyle])

  useEffect(() => {
    const scope = activeAccountScope()
    const committed = new Map()
    let queue = Promise.resolve(), alive = true
    const off = interviewStateRef.current.subscribe(snapshot => {
      const pending = snapshot.speechTurns.map((turn,seq) => ({ ...turn,seq }))
        .filter(turn => committed.get(turn.id) !== JSON.stringify(turn))
      if (!pending.length) return
      queue = queue.then(async () => {
        for (let i=0;i<pending.length;i+=100) {
          const batch = pending.slice(i,i+100)
          const ack = await appendCapturedTurns(sessionIdRef.current,batch,scope)
          if (ack?.enabled === false) return
          for (const turn of batch) committed.set(turn.id,JSON.stringify(turn))
        }
      }).catch(error => { diagnostic('session','capture_commit_failed',{ runId:sessionIdRef.current,errorCode:error.code || 'capture_write_failed' },'error'); if (alive) setError('Capture could not be saved. Keep this window open and copy your transcript before leaving.') })
    })
    return () => { alive = false; off() }
  }, [])


  // Save the visible Q&A feed, not profile/secrets/raw audio. A crash or
  // unexpected renderer reload can then offer explicit read-only recovery.
  useEffect(() => {
    if (!transcript.some(item => item.isQuestion)) return
    const timer = setTimeout(() => {
      if (sessionActiveRef.current) {
        saveLiveCheckpoint({ sessionId: sessionIdRef.current, transcript })
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [transcript])

  useEffect(() => {
    bcRef.current = new BroadcastChannel('mockmate-live')
    sessionActiveRef.current = true
    return () => {
      if (sessionActiveRef.current && checkpointRowsRef.current.length) {
        saveLiveCheckpoint({ sessionId: sessionIdRef.current, transcript: checkpointRowsRef.current })
      }
      sessionActiveRef.current = false
      cancelSpeculativeRag()
      speculativeHintRef.current?.cancel('unmount')
      try { genManagerRef.current?.cancelCurrent?.('unmount') } catch {}
      try { captureRef.current?.reset?.() } catch {}
      bcRef.current?.close()
      try { pipWindow?.close() } catch {}
      clearInterval(streamTimer.current)
      clearTimeout(lockTimerRef.current)
      clearTimeout(postMetaTimerRef.current)
      stopSpeaking()
    }
  }, [])

  async function openProtectedPip() {
    if (!window.documentPictureInPicture) return
    try {
      const pip = await window.documentPictureInPicture.requestWindow({ width: 440, height: 620 })
      pip.document.title = 'MockMate — Protected'
      pip.document.body.style.cssText = `margin:0;padding:0;background:${T.bg};font-family:${T.font};color:${T.text1};overflow-y:auto;`
      mountPip(pip.document)
      pip.addEventListener('pagehide', () => setPipWindow(null))
      setPipWindow(pip)
      // Sync current state immediately
      bcRef.current?.postMessage({ type: 'init', transcript, hint, hintLoading, buyTimePhrase, lastQ: lastHintText.current, streaming })
      // Ask the Electron main process to apply setContentProtection(true) to the new window.
      // The browser-window-created listener in main.cjs is the primary safety net, but we
      // invoke this handler as belt-and-suspenders and to surface a warning if it fails.
      if (window.electronAPI?.excludeFromCapture) {
        await new Promise(r => setTimeout(r, 100))  // let the OS register the window
        const result = await window.electronAPI.excludeFromCapture()
        // Honest confirmation (round-5 review): the handler returns the id of the
        // window it actually protected AND the sender's id. If they match, only
        // the opener was protected — do not claim PiP confirmation (the
        // browser-window-created listener still auto-protects new windows, but
        // we surface the warning rather than a false positive).
        const pipConfirmed = Boolean(result?.ok) && result.senderId != null && result.id !== result.senderId
        if (!result?.ok || !pipConfirmed) {
          setPipProtected(false)
          console.warn('[MockMate] Screen protection not confirmed for PiP window:', result?.error || `protected window ${result?.id} is the opener (${result?.senderId})`)
        } else {
          setPipProtected(true)
          console.log('[MockMate] Screen protection confirmed on hints window', result.id)
        }
      }
    } catch (e) { console.warn('PiP failed:', e.message) }
  }

  useEffect(() => {
    const id = setInterval(() => setClock(Date.now() - startedAt.current), 1000)
    return () => clearInterval(id)
  }, [])

  const latestQuestion = [...transcript].filter(s => s.isQuestion).at(-1)
  const latestQuestionId = latestQuestion?.questionId
  const latestHasAnswer = !!(latestQuestion?.hint && (latestQuestion.answer !== undefined || latestQuestion.hint.incomplete))
  const scrollLatestIntoView = useCallback((target, block = 'start') => {
    if (!target) return
    programmaticScrollRef.current = true
    clearTimeout(programmaticScrollTimerRef.current)
    target.scrollIntoView({ behavior: 'smooth', block, inline: 'nearest' })
    programmaticScrollTimerRef.current = setTimeout(() => { programmaticScrollRef.current = false }, 500)
  }, [])

  useEffect(() => {
    if (!latestQuestionId) return
    if (!followLatestRef.current) {
      setShowJumpLatest(true)
      return
    }
    const frame = requestAnimationFrame(() => {
      scrollLatestIntoView(latestQuestionRef.current)
    })
    return () => cancelAnimationFrame(frame)
  }, [latestQuestionId, scrollLatestIntoView])

  // The question is shown before generation. When the answer bubble is created,
  // move that bubble into view once; otherwise compact overlays leave it below
  // the fold and make the user scroll during the interview.
  useEffect(() => {
    if (!latestQuestionId || !latestHasAnswer) return
    if (!followLatestRef.current) {
      setShowJumpLatest(true)
      return
    }
    const frame = requestAnimationFrame(() => scrollLatestIntoView(latestAnswerRef.current))
    return () => cancelAnimationFrame(frame)
  }, [latestQuestionId, latestHasAnswer, scrollLatestIntoView])

  const jumpToLatest = useCallback(() => {
    followLatestRef.current = true
    setShowJumpLatest(false)
    scrollLatestIntoView(latestAnswerRef.current || latestQuestionRef.current)
  }, [scrollLatestIntoView])

  const copyFeedText = useCallback(async (key, value) => {
    const ok = await copyText(String(value || ''))
    if (!ok) {
      setError('Could not copy text — select it manually or retry')
      return
    }
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(current => current === key ? '' : current), 1400)
  }, [])

  // Pure planning shared by generateHint and the early answer start. `pending`
  // previews the history as it will be once the question commits, so a request
  // prepared during stabilization is byte-identical to the committed one.
  function planHintTurn(qText, { pending = false } = {}) {
    const history = interviewStateRef.current.getLlmHistory({
      limit: 12, includeLastAnswer: true, ...(pending ? { pendingInterviewerText: qText } : {}),
    })
    const prevClassification = lastClassificationRef.current
    const classification = classifyTurn({
      question: qText,
      profile: profileRef.current,
      conversationHistory: history.filter(t => t.role === 'interviewer' || t.role === 'candidate'),
      lastClassification: prevClassification,
      recentScreen: recentScreenRef.current,
    })
    const selectedScreen = selectScreenForTurn({
      question: qText,
      classification,
      recentScreen: recentScreenRef.current,
      codingScreen: codingScreenRef.current,
    })
    const relevance = evaluateScreenRelevance({ question: qText, classification, screen: selectedScreen })
    return { prevClassification, classification, selectedScreen, relevance }
  }

  function composeHintBody({ qText, history, prevClassification, classification, attachScreen, selectedScreen, ragContext }) {
    return {
      question: qText, profile: profileRef.current, conversationHistory: history,
      provider: providerRef.current, language: profileRef.current?.language || 'English',
      extraContext: [extraContextRef.current, ragContext].filter(Boolean).join('\n\n') || undefined,
      mode: coachModeRef.current ? 'coach' : 'answer',
      style: answerStyleRef.current, autoSkip: getAutoSkip(),
      lastClassification: prevClassification,
      classification, // one authority — server must not re-classify when present
      recentScreen: attachScreen ? selectedScreen : null,
    }
  }

  // Early answer start (system audio, BYOK only). Capture reports a complete
  // question that is only waiting for its silence window; prepare the exact request
  // generateHint would send and start it without showing anything. generateHint
  // claims it on commit if nothing changed; otherwise it is aborted.
  const earlyAnswerEnabled = () => {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('mm-live-early-answer') === '0') return false
    } catch {}
    return !isManaged()   // never spend managed quota on a request that may be discarded
  }
  startSpeculativeHintRef.current = async (captured) => {
    const early = speculativeHintRef.current
    if (!early || !earlyAnswerEnabled() || !sessionActiveRef.current) return
    if (!liveSourceIdRef.current || liveSourceIdRef.current === 'microphone') return
    const text = String(captured?.text || '').trim()
    const key = normalizeCaptureText(text)
    if (!key || early.activeKey() === key) return
    const ticket = early.prepare(key)
    try {
      const plan = planHintTurn(text, { pending: true })
      let ragContext = ''
      if (shouldRetrieveDocs(plan.classification)) {
        // Share the retrieval generateHint will reuse so both bodies get identical context.
        let spec = ragSpec.current
        if (!(spec?.p && canReuseSpeculativeRag(spec.q, text))) {
          startSpeculativeRag(text, { immediate: true })
          spec = ragSpec.current
        }
        if (!(spec?.p && canReuseSpeculativeRag(spec.q, text))) { early.abandon(ticket, 'retrieval_unavailable'); return }
        ragContext = await spec.p.catch(() => '')
      }
      // Re-read history after the await: an earlier answer may have completed meanwhile.
      const history = interviewStateRef.current.getLlmHistory({ limit: 12, includeLastAnswer: true, pendingInterviewerText: text })
      const body = composeHintBody({
        qText: text, history, prevClassification: plan.prevClassification, classification: plan.classification,
        attachScreen: plan.relevance.attach, selectedScreen: plan.selectedScreen, ragContext,
      })
      early.start(ticket, { key, bodyJson: JSON.stringify(body) })
    } catch {
      early.abandon(ticket, 'prepare_failed')
    }
  }

  // Hint generation — only after QUESTION_COMMITTED (or manual Answer this).
  async function generateHint(question, { force, manual = false, questionId: existingQuestionId } = {}) {
    if (!question) return
    const sameQ = question === lastHintText.current
    if (!force && sameQ && hintInFlight.current) return
    if (!force && sameQ && !hintIncompleteRef.current) return
    if (force) hintIncompleteRef.current = false

    const state = interviewStateRef.current
    const gm = genManagerRef.current

    // Classify AFTER durable capture (M2). Never classify unstable fragments here.
    const priorTurns = () => state.getLlmHistory({ limit: 12, includeLastAnswer: true })

    const prevClassification = lastClassificationRef.current
    let qRec = existingQuestionId ? state.getQuestion(existingQuestionId) : null
    if (!qRec || qRec.status === 'candidate' || qRec.status === 'stabilizing') {
      qRec = state.commitQuestion(question, null, {
        questionId: existingQuestionId || newQuestionId(),
        source: existingQuestionId ? 'stt_capture' : 'manual',
      })
    }

    // STATE B — question must be visible before thinking / generation.
    setTranscript(t => {
      if (t.some(s => s.questionId === qRec.id)) {
        return t.map(s => (s.questionId === qRec.id ? { ...s, text: qRec.text, status: 'committed' } : s))
      }
      return [...t, {
        text: qRec.text,
        questionId: qRec.id,
        ts: qRec.committedAt || Date.now(),
        isQuestion: true,
        answer: '',
        status: 'committed',
      }]
    })
    lastHintText.current = qRec.text
    setLiveCaptureText('')
    setCaptureStatus('committed')

    // Same pure planning the early answer start uses (history already includes qRec).
    const plan = planHintTurn(qRec.text)
    const classification = plan.classification
    state.attachClassification(qRec.id, classification)
    lastClassificationRef.current = classification
    try { onLiveSpokenQuestion?.(qRec.text) } catch {}

    const selectedScreen = plan.selectedScreen
    const relevance = plan.relevance
    const ctx = resolveContextSources({
      classification,
      screenRelevant: relevance.attach,
      hasPriorTopicDiscussion: !!classification.isFollowUp,
    })
    state.setContextDecision(qRec.id, {
      contextSources: ctx.allowed,
      screenRelevant: relevance.attach,
      screenReason: relevance.reason,
      screenContextId: selectedScreen?.screenContextId || null,
    })
    setScreenAttachHint(relevance.attach ? 'attached' : (recentScreenRef.current && !recentScreenRef.current.error ? 'irrelevant' : null))

    // Trust evaluateScreenRelevance (career types already neverAttach unless deictic).
    // Do not double-strip screen here — that deleted valid "this/code" evidence.
    const attachScreen = relevance.attach

    const prevType = prevClassification?.questionType === 'follow_up'
      ? prevClassification?.parentType
      : prevClassification?.questionType
    const topicSwitch = !classification.isFollowUp
      && ['behavioral', 'experience', 'intro', 'situational'].includes(classification.questionType)
      && ['system_design', 'dsa', 'coding', 'product_case'].includes(prevType)

    const questionId = qRec.id
    const qText = qRec.text
    const previousQuestionId = activeQuestionIdRef.current
    activeQuestionIdRef.current = questionId
    state.supersedeOpenQuestions?.(questionId, 'new_question')
    if (previousQuestionId && previousQuestionId !== questionId) {
      setTranscript(t => t.map(s => s.questionId === previousQuestionId && !s.answer
        ? { ...s, status: 'superseded' }
        : s))
    }

    if (activeGenerationRef.current?.canCommit?.()) {
      metricsRef.current?.markGenerationCancelled?.()
    }
    const gen = gm.start({
      questionId,
      reason: topicSwitch ? 'topic_switch' : 'new_question',
    })
    state.setQuestionGeneration?.(questionId, gen.generationId)
    activeGenerationRef.current = gen
    const isCurrent = () => sessionActiveRef.current && gen.canCommit()

    clearTimeout(lockTimerRef.current)
    clearTimeout(postMetaTimerRef.current)
    hintInFlight.current = true
    setManualQ('')
    pendingManualQ.current = null
    gen.markGenerating()

    let incomplete = false
    let gotToken = false
    const markIncomplete = (answer, hintObj, reason) => {
      incomplete = true
      hintIncompleteRef.current = true
      metricsRef.current?.markIncomplete?.()
      if (!isCurrent()) return
      const text = (answer || '').trimEnd()
      const patched = text ? `${text}\n\n[incomplete — ${reason}]` : ''
      const h = { ...(hintObj || { confidence: 'general' }), fullAnswer: answer || '', incomplete: true }
      if (patched) upsert({ answer: patched, hint: h })
      else upsert({ hint: h })
      setHint(prev => (prev ? { ...prev, incomplete: true } : h))
      setError(`Hint timed out — tap Retry`)
      state.commitAnswer({
        questionId, generationId: gen.generationId, text: answer || '', hint: h, incomplete: true,
        validation: { status: 'incomplete', reason },
      })
    }

    // Hard backstop before the first token: the server may spend one attempt budget on
    // each configured provider before it finds a healthy fallback. Keep this deadline
    // above the default three-provider budget so the browser does not cancel failover.
    // Once text is streaming, a long answer is never cut off for being long: only a
    // stall (no new tokens for LIVE_HINT_STALL_TIMEOUT_MS) ends it.
    const onBackstop = reason => () => {
      if (!isCurrent()) return
      hintInFlight.current = false
      setHintLoading(false); setStreaming(false); setBuyTimePhrase('')
      if (gotToken || incomplete) markIncomplete(lastAnswer, lastHintObj, reason)
      else {
        hintIncompleteRef.current = true
        incomplete = true
        setError('Hint timed out — tap Retry')
        upsert({ hint: { confidence: 'general', fullAnswer: '', incomplete: true } })
        state.markQuestionFailed?.(questionId, 'timed_out')
      }
      try { gen.fail(gotToken ? 'stalled' : 'timed_out') } catch {}
    }
    let lockTimeout = setTimeout(onBackstop('timed out'), LIVE_HINT_OVERALL_TIMEOUT_MS)
    lockTimerRef.current = lockTimeout
    const armStallBackstop = () => {
      clearTimeout(lockTimeout)
      lockTimeout = setTimeout(onBackstop('answer stopped arriving'), LIVE_HINT_STALL_TIMEOUT_MS)
      lockTimerRef.current = lockTimeout
    }

    let lastAnswer = ''
    let lastHintObj = null

    if (isCurrent()) {
      setBuyTimePhrase(thinkingLabel(profileRef.current?.language))
      setHint(null)
      setStreaming(false)
      clearInterval(streamTimer.current)
      setHintLoading(true)
      setError(e => (e === 'Hint timed out — tap Retry' ? '' : e))
    }

    // Upsert the feed entry for this question by questionId (avoids same-text collisions).
    const upsert = patch => {
      if (!isCurrent()) return
      setTranscript(t => {
        const idx = t.findIndex(s => s.questionId === questionId || (!s.questionId && s.text === question && !s.answer))
        if (idx >= 0) {
          const next = t.slice()
          next[idx] = { ...next[idx], questionId, ...patch }
          return next
        }
        return [...t, { text: question, questionId, ts: Date.now(), isQuestion: true, answer: '', ...patch }]
      })
    }

    const clearTimers = () => {
      clearTimeout(lockTimeout)
      clearTimeout(postMetaTimerRef.current)
      clearTimeout(programmaticScrollTimerRef.current)
    }

    const logTrace = (status) => {
      if (typeof localStorage === 'undefined' || localStorage.getItem('mm-debug-live') !== '1') return
      const trace = state.getDevTrace(questionId, { generationId: gen.generationId, status })

      console.info(formatInterviewDevTrace({
        ...trace,
        contextSources: ctx.allowed,
        generationStatus: status || gen.status,
      }))
    }

    const finalize = (answer, hintObj) => {
      if (!isCurrent()) return
      if (incomplete || hintIncompleteRef.current) return // never finalize over an incomplete upsert
      clearTimers()
      setStreaming(false); setHintLoading(false); hintInFlight.current = false
      setBuyTimePhrase('')
      hintIncompleteRef.current = false
      const formattedAnswer = ensureCodingCodeBlock(answer, hintObj?.questionType || classification.questionType)
      if (formattedAnswer.includes('```') && !autoExpandedCodeRef.current.has(questionId)) {
        autoExpandedCodeRef.current.add(questionId)
        setExpandedAnswers(prev => new Set(prev).add(qText))
      }
      const layers = glanceLayers(formattedAnswer, hintObj || {})
      const finalHint = {
        ...(hintObj || { confidence: 'general' }),
        opener: layers.opener,
        keyPoints: layers.keyPoints,
        fullAnswer: layers.fullAnswer || answer,
        sampleAnswer: layers.fullAnswer || answer,
        incomplete: false,
      }
      setHint(finalHint)
      if (hintObj?._routing || hintObj?.questionType) {
        lastClassificationRef.current = {
          questionType: hintObj._routing?.questionType || hintObj.questionType,
          parentType: hintObj._routing?.parentType,
          parentTopic: question,
          playbookKey: hintObj._routing?.playbook,
          question,
        }
      }
      // Authoritative answer commit — do NOT push AI text into interviewer/candidate convo.
      state.commitAnswer({
        questionId,
        generationId: gen.generationId,
        text: layers.fullAnswer || answer,
        hint: finalHint,
        validation: { status: 'ok' },
      })
      gen.complete()
      logTrace('completed')
      upsert({ isQuestion: true, answer: layers.fullAnswer || answer, hint: finalHint })
    }
    const resetSkip = () => {
      if (!isCurrent()) return
      clearTimers()
      setHintLoading(false); setStreaming(false); hintInFlight.current = false
      lastHintText.current = ''; setBuyTimePhrase(''); hintIncompleteRef.current = false
      state.markQuestionCancelled?.(questionId, 'skip')
      upsert({ status: 'failed', hint: { failed: true, incomplete: true }, answer: '' })
      setError('No answer: the model skipped this question. Use Answer this or retry to request an answer explicitly.')
      gen.complete()
    }

    const armPostMetaWatchdog = () => {
      clearTimeout(postMetaTimerRef.current)
      postMetaTimerRef.current = setTimeout(() => {
        if (!isCurrent() || gotToken) return
        hintInFlight.current = false
        setHintLoading(false); setStreaming(false); setBuyTimePhrase('')
        markIncomplete('', lastHintObj, 'no tokens after meta')
        try { gen.fail('no_tokens_after_meta') } catch {}
      }, 8000)
    }

    if (typeof localStorage !== 'undefined' && localStorage.getItem('mm-debug-screen') === '1') {

      console.info('[MockMate screen]', formatScreenDebugTrace({
        capture: recentScreenRef.current,
        classification,
        relevance,
        playbook: classification.playbookKey,
        attached: relevance.attach,
      }))
    }
    logTrace('generating')

    let ragContext = ''
    cancelSpeculativeRag({ keepComplete: true })
    if (shouldRetrieveDocs(classification)) {
      const spec = ragSpec.current
      const opts = liveRagOpts(classification, interviewConfigRef.current, 600)
      if (spec?.p && canReuseSpeculativeRag(spec.q, question)) {
        ragContext = await spec.p.catch(() => '')
      } else {
        try { spec?.ac?.abort() } catch {}
        ragContext = await retrieveContext(question, opts).catch(() => '')
      }
    }
    ragSpec.current = { q: '', p: null, ac: null, timer: null }
    if (!isCurrent()) return
    const hintBody = () => ({ ...composeHintBody({
      qText, history: priorTurns(), prevClassification, classification,
      attachScreen, selectedScreen, ragContext,
    }), ...(manual ? { autoSkip: false } : {}) })

    hintTimingRef.current = metricsRef.current?.startHint?.() || null
    let rawAnswer = '', answer = '', hintObj = null
    // Adopt the early request only if it was prepared for exactly this request body;
    // otherwise claim() aborts it and the normal request below is sent.
    const requestBody = hintBody()
    const early = speculativeHintRef.current?.claim({
      key: normalizeCaptureText(qText), bodyJson: JSON.stringify(requestBody),
    }) || null
    if (early) gen.signal?.addEventListener?.('abort', early.abort, { once: true })
    let earlyResponse = early?.response || null
    const controller = createLiveSessionController({
      isCurrent,
      getSignal: () => gen.signal,
      getHintBody: () => requestBody,
      getPrefetchedResponse: () => { const response = earlyResponse; earlyResponse = null; return response },
      onMarkFallback: () => { metricsRef.current?.markFallback?.() },
      onSkip: () => { metricsRef.current?.markSkip?.(); resetSkip() },
      onFallbackHint: h => {
        metricsRef.current?.markFirstToken?.(hintTimingRef.current)
        gotToken = true
        finalize(h.fullAnswer || h.sampleAnswer || '', h)
      },
      onStreamEvent: async ({ event: ev, data }) => {
        if (ev === 'meta') {
          hintObj = {
            confidence: data?.confidence === 'resume' ? 'resume' : 'general',
            questionType: data?.type, pattern: data?.pattern || null,
            complexity: data?.complexity || null, watchOut: data?.watch || null,
            _searchSources: data?.searchSources,
            _routing: data?._routing || null,
            fullAnswer: '', sampleAnswer: ''
          }
          lastHintObj = hintObj
          if (data?._routing) {
            lastClassificationRef.current = {
              ...classification,
              playbookKey: data._routing.playbook || classification.playbookKey,
              parentTopic: classification.parentTopic || qText,
              question: qText,
            }
          }
          if (isCurrent()) {
            setHint(hintObj); setHintLoading(false); setStreaming(true)
            upsert({ isQuestion: true, answer: '', hint: hintObj })
            armPostMetaWatchdog()
          }
        } else if (ev === 'token') {
          if (!rawAnswer) metricsRef.current?.markFirstToken?.(hintTimingRef.current)
          gotToken = true
          armStallBackstop()
          clearTimeout(postMetaTimerRef.current)
          rawAnswer += typeof data === 'string' ? data : ''
          const cleaned = stripHintMeta(rawAnswer)
          if (Object.keys(cleaned.meta).length) {
            hintObj = {
              ...(hintObj || { confidence: 'general' }),
              confidence: cleaned.meta.confidence === 'resume' ? 'resume' : (hintObj?.confidence || 'general'),
              questionType: cleaned.meta.type || hintObj?.questionType,
              pattern: cleaned.meta.pattern ?? hintObj?.pattern ?? null,
              complexity: cleaned.meta.complexity ?? hintObj?.complexity ?? null,
              watchOut: cleaned.meta.watch || cleaned.meta.watchOut || hintObj?.watchOut || null,
            }
            lastHintObj = hintObj
          }
          answer = cleaned.pending ? '' : cleaned.prose
          const formattedAnswer = ensureCodingCodeBlock(answer, hintObj?.questionType || classification.questionType)
          if (formattedAnswer.includes('```') && !autoExpandedCodeRef.current.has(questionId)) {
            autoExpandedCodeRef.current.add(questionId)
            setExpandedAnswers(prev => new Set(prev).add(qText))
          }
          lastAnswer = formattedAnswer
          const layers = glanceLayers(formattedAnswer, hintObj || {})
          const liveHint = {
            ...(hintObj || { confidence: 'general' }),
            opener: layers.opener,
            keyPoints: layers.keyPoints,
            fullAnswer: layers.fullAnswer || formattedAnswer,
            watchOut: layers.watchOut || hintObj?.watchOut || null,
          }
          upsert({ answer: layers.fullAnswer || formattedAnswer, hint: liveHint })
          setHint(liveHint)
        } else if (ev === 'usage') {
          const u = data || {}
          setUsage(s => ({ tokens: s.tokens + (u.input || 0) + (u.output || 0), cost: s.cost + estimateCost(u.model, u.input || 0, u.output || 0) }))
        } else if (ev === 'provider') {
          metricsRef.current?.markProviderEvent?.(data || {})
        } else if (ev === 'skip') {
          metricsRef.current?.markSkip?.()
          resetSkip()
          return 'stop'
        } else if (ev === 'error') {
          if (answer.trim()) {
            incomplete = true
            hintIncompleteRef.current = true
            metricsRef.current?.markIncomplete?.()
            const message = data?.error
              ? formatLiveError(data)
              : 'The answer stream failed after partial output; the partial answer was kept and not retried automatically.'
            if (isCurrent()) {
              clearTimers()
              hintInFlight.current = false
              setHintLoading(false); setStreaming(false); setBuyTimePhrase('')
              metricsRef.current?.markError?.(message)
              setError(message)
              const layers = glanceLayers(answer, hintObj || {})
              upsert({
                answer: answer.trimEnd() + '\n\n[incomplete — connection/provider error]',
                hint: { ...(hintObj || { confidence: 'general' }), opener: layers.opener, keyPoints: layers.keyPoints, fullAnswer: answer, incomplete: true },
              })
              setHint(h => h ? { ...h, incomplete: true } : { confidence: 'general', incomplete: true })
              gen.fail('sse_error')
            }
          } else if (isCurrent()) {
            // The stream failed before producing a token: expose a retryable
            // error instead of leaving the loading spinner on indefinitely.
            clearTimers()
            hintInFlight.current = false
            hintIncompleteRef.current = true
            setHintLoading(false); setStreaming(false); setBuyTimePhrase('')
            const message = data?.error ? formatLiveError(data) : 'The answer stream ended before a response arrived.'
            metricsRef.current?.markError?.(message)
            setError(message)
            gen.fail('sse_error')
            state.markQuestionFailed?.(questionId, message)
            upsert({
              answer: 'Answer unavailable — tap Retry',
              hint: { confidence: 'general', fullAnswer: '', incomplete: true, failed: true },
            })
          }
          return 'stop'
        }
      },
    })
    try {
      const mode = await controller.generateViaTransport()

      if (!isCurrent()) return
      // streamLiveHint returns a result object, not a string. Never finalize a
      // skipped, aborted or failed generation (or trigger a duplicate fallback).
      if (['aborted', 'fallback', 'stopped', 'incomplete'].includes(mode?.mode)) return
      if (incomplete || hintIncompleteRef.current) {
        hintInFlight.current = false
        if (isCurrent()) {
          setHintLoading(false); setStreaming(false); setBuyTimePhrase('')
        }
        clearTimers()
        return
      }
      if (!answer.trim()) { metricsRef.current?.markFallback?.(); await controller.runFallback(); return }
      finalize(answer, hintObj)
    } catch (e) {
      if (e.name === 'AbortError') {
        if (!isCurrent()) return
        if (incomplete) {
          hintInFlight.current = false
          setHintLoading(false); setStreaming(false); setBuyTimePhrase('')
        }
        return
      }
      if (!isCurrent()) return
      // The transport already handles the explicit 404/405/501 compatibility
      // fallback. Retrying after 401/402/429/5xx or a mid-stream failure can
      // start a second paid LLM generation and overwrite a partial answer.
      clearTimers()
      setHintLoading(false); setStreaming(false)
      hintInFlight.current = false
      hintIncompleteRef.current = true
      setBuyTimePhrase('')
      const message = formatLiveError(e) || 'Unable to complete the Live answer.'
      metricsRef.current?.markError?.(message)
      setError(message)
      gen.fail(message)
      state.markQuestionFailed?.(questionId, message)
      if (answer.trim()) {
        const layers = glanceLayers(answer, hintObj || {})
        upsert({
          answer: answer.trimEnd() + '\n\n[incomplete — connection/provider error]',
          hint: { ...(hintObj || { confidence: 'general' }), opener: layers.opener, keyPoints: layers.keyPoints, fullAnswer: answer, incomplete: true, failed: true },
        })
      } else {
        upsert({
          answer: 'Answer unavailable — tap Retry',
          hint: { confidence: 'general', fullAnswer: '', incomplete: true, failed: true },
        })
      }
      logTrace('failed')
    }
  }

  // Durable commit handler — question visible before any generation.
  handleCommittedRef.current = (captured) => {
    if (!sessionActiveRef.current || !captured?.text) return
    // Turn-1 opener fix: once the first question commits, the Finalize-on-pause
    // heuristic has served its purpose — hand utterance timing back to Deepgram's
    // own endpointing for the rest of the session.
    if (!finalizeOffOnceRef.current) {
      finalizeOffOnceRef.current = true
      try { audio.setFinalizeOnPause?.(false) } catch {}
    }
    const state = interviewStateRef.current
    const q = state.commitQuestion(captured.text, null, {
      questionId: captured.id || newQuestionId(),
      rawTranscript: captured.rawTranscript,
      speaker: captured.speaker || 'interviewer',
      confidence: captured.confidence,
      source: 'stt_capture',
    })
    metricsRef.current?.markQuestionCapture?.({
      captureLatencyMs: captured.captureLatencyMs,
      revisions: captured.revisionCount,
      reason: captured.commitReason,
    })
    setTranscript(t => {
      if (t.some(s => s.questionId === q.id)) {
        return t.map(s => (s.questionId === q.id ? { ...s, text: q.text, status: 'committed' } : s))
      }
      return [...t, {
        text: q.text,
        questionId: q.id,
        ts: q.committedAt || Date.now(),
        isQuestion: true,
        answer: '',
        status: 'committed',
      }]
    })
    liveCaptureTextRef.current = ''
    setLiveCaptureText('')
    setCaptureStatus('committed')
    lastHintText.current = q.text

    const isMic = liveSourceIdRef.current === 'microphone'
    if (isMic && !(diarizationLockedRef.current && !degradedRef.current)) {
      // Pre-warm RAG once while waiting for manual confirmation
      startSpeculativeRag(q.text, { immediate: true })
      pendingManualQ.current = { text: q.text, questionId: q.id }
      manualQRef.current = q.text
      setManualQ(q.text)
      return
    }
    pendingManualQ.current = null
    manualQRef.current = ''
    setManualQ('')
    generateHint(q.text, { force: true, questionId: q.id })
  }
  generateHintRef.current = generateHint

  // A clear interviewer correction invalidates the answer currently being generated.
  // Keep the old card as an explicit superseded record instead of a mysterious blank.
  handleRevisionRef.current = () => {
    if (liveSourceIdRef.current === 'microphone' && !(diarizationLockedRef.current && !degradedRef.current)) return
    const activeId = activeQuestionIdRef.current
    if (activeGenerationRef.current?.canCommit?.()) {
      activeGenerationRef.current.cancel?.('interviewer_revision')
      metricsRef.current?.markGenerationCancelled?.()
    }
    if (activeId) {
      interviewStateRef.current?.markQuestionSuperseded?.(activeId, 'interviewer_revision')
      setTranscript(t => t.map(s => s.questionId === activeId && !s.answer
        ? { ...s, status: 'superseded' }
        : s))
    }
    hintInFlight.current = false
    setHintLoading(false)
    setStreaming(false)
    setBuyTimePhrase('')
    activeQuestionIdRef.current = null
  }


  // "Write it as code" / "be brief" modifies the active question rather than
  // becoming a second card. Regenerate the same card with the explicit contract.
  handleRefinementRef.current = ({ text }) => {
    if (liveSourceIdRef.current === 'microphone' && !(diarizationLockedRef.current && !degradedRef.current)) return
    const activeId = activeQuestionIdRef.current || interviewStateRef.current?.getCurrentQuestionId?.()
    const current = activeId ? interviewStateRef.current?.getQuestion?.(activeId) : null
    if (!current?.text || !text) return
    const revised = `${current.text}\nInterviewer instruction: ${text}`
    interviewStateRef.current?.commitQuestion?.(revised, current.classification, {
      questionId: activeId,
      source: 'stt_refinement',
    })
    setTranscript(t => t.map(s => s.questionId === activeId
      ? { ...s, text: revised, answer: '', hint: null, status: 'committed' }
      : s))
    generateHint(revised, { force: true, questionId: activeId })
  }

  const onEarlyQuestion = useCallback((text, meta) => {
    if (!sessionActiveRef.current) return
    if (liveSourceIdRef.current === 'microphone' && !(diarizationLockedRef.current && !degradedRef.current)) return // Wait for the microphone speaker heuristic to lock.
    const trimmed = String(text || '').trim()
    if (!trimmed) return
    if (meta?.isCandidate) {
      captureRef.current?.ingest?.({
        text: trimmed,
        isFinal: false,
        meta: { isCandidate: true, speakerRole: 'candidate', speaker: meta?.speaker },
      })
      return
    }
    const isSysAudio = Boolean(liveSourceIdRef.current && liveSourceIdRef.current !== 'microphone')
    captureRef.current?.ingest?.({
      text: trimmed,
      isFinal: false,
      meta: {
        isCandidate: false,
        speaker: meta?.speaker,
        speakerRole: isSysAudio ? 'interviewer' : (meta?.speakerRole || 'unknown'),
        diarizationLocked: isSysAudio || diarizationLockedRef.current,
      },
    })
    if (!hintInFlight.current && trimmed.split(/\s+/).length >= 4) {
      setBuyTimePhrase(thinkingLabel(profileRef.current?.language))
    }
  }, [])

  const onFinal = useCallback((text, meta) => {
    if (!sessionActiveRef.current) return
    const trimmed = String(text || '').trim()
    if (!trimmed) return
    metricsRef.current?.markSttFinal?.({
      confidence: meta?.confidence,
      degraded: !!meta?.degraded,
      diarizationLocked: !!meta?.diarizationLocked,
    })

    // Candidate speech: record, never commit as question.
    if (meta?.isCandidate) {
      if (!meta?.isQuestion && trimmed.split(/\s+/).length >= 2) {
        interviewStateRef.current?.recordCandidate?.(trimmed)
      }
      captureRef.current?.ingest?.({
        text: trimmed,
        isFinal: true,
        meta: { isCandidate: true, speakerRole: 'candidate', speaker: meta?.speaker },
      })
      return
    }

    const isSysAudio = Boolean(liveSourceIdRef.current && liveSourceIdRef.current !== 'microphone')
    const trustedMic = meta?.diarizationLocked && !meta?.degraded && meta?.speakerRole === 'interviewer'
    if (!isSysAudio && !trustedMic) {
      // Uncertain microphone speakers still need explicit confirmation.
      pendingManualQ.current = { text: trimmed, questionId: newQuestionId() }
      manualQRef.current = trimmed
      setManualQ(trimmed)
      return
    }
    captureRef.current?.ingest?.({
      text: trimmed,
      isFinal: true,
      confidence: meta?.confidence,
      meta: {
        isCandidate: false,
        speaker: meta?.speaker,
        speakerRole: isSysAudio ? 'interviewer' : (meta?.speakerRole || 'unknown'),
        diarizationLocked: isSysAudio || diarizationLockedRef.current,
        degraded: degradedRef.current,
      },
    })
  }, [])

  const [liveSourceId, setLiveSourceId] = useState(sourceId)
  const audio = useSystemAudio(onFinal, reason => { metricsRef.current?.markError?.(reason); setError(`Transcription stopped: ${reason}`) }, onEarlyQuestion, () => metricsRef.current?.markSttReconnect?.())

  useEffect(() => { liveSourceIdRef.current = liveSourceId }, [liveSourceId])
  useEffect(() => {
    diarizationLockedRef.current = !!audio.diarizationLocked
    degradedRef.current = !!audio.degraded
  }, [audio.diarizationLocked, audio.degraded])

  // Microphone speaker identities are inferred, not authenticated. Never flush
  // a pending question automatically when that heuristic changes.

  function audioOpts() {
    return {
      keyterms: resumeKeyterms(profileRef.current),
      language: STT_LANG[profileRef.current?.language] || 'en-US',
    }
  }

  function retryTranscription() {
    setError('')
    // Session-level state stays authoritative: do NOT reset finalizeOffOnceRef here —
    // a mid-session STT retry must not re-arm the Turn-1 Finalize heuristic.
    // Re-assert the current state defensively once the socket is back up.
    audio.restart(liveSourceId, audioOpts())
      .then(() => { try { audio.setFinalizeOnPause(!finalizeOffOnceRef.current) } catch {} })
      .catch(e => setError(`Could not restart transcription: ${e.message || e}`))
  }

  async function switchAudioSource() {
    const isLinux = window.electronAPI?.platform === 'linux'
    const next = liveSourceId === 'microphone' ? 'system' : 'microphone'
    if (next === 'system' && isLinux) {
      setError('System Audio is not available on Linux — staying on Microphone')
      return
    }
    let id = next
    if (next === 'system') {
      const srcs = await window.electronAPI?.getAudioSources?.() || []
      id = srcs.find(s => /screen|entire|display/i.test(s.name))?.id || 'microphone'
      if (id === 'microphone') {
        setError('System Audio not available — staying on Microphone')
        return
      }
    }
    setError('')
    setSwitchingAudio(true)
    setLiveSourceId(id === 'microphone' ? 'microphone' : id)
    try {
      await audio.restart(id, audioOpts())
      // Source switching is still the SAME Live session — keep the Turn-1 Finalize
      // decision authoritative (disabled once the first question committed).
      try { audio.setFinalizeOnPause(!finalizeOffOnceRef.current) } catch {}
    } catch (e) {
      setError(`Could not switch audio: ${e.message || e}`)
    } finally {
      setSwitchingAudio(false)
    }
  }

  // Sync all state to the PiP window whenever anything changes. Declared AFTER
  // `audio` so audio.active is in scope and can be a real dependency — otherwise
  // the PiP "Listening / Not capturing" indicator goes stale on reconnect/stop.
  useEffect(() => {
    if (!pipWindow || pipWindow.closed) return
    bcRef.current?.postMessage({
      type: 'update',
      transcript, hint, hintLoading, buyTimePhrase,
      lastQ: lastHintText.current,
      active: audio.active,
      streaming,
    })
  }, [transcript, hint, hintLoading, buyTimePhrase, pipWindow, audio.active, streaming])

  useEffect(() => {
    finalizeOffOnceRef.current = false
    audio.start(liveSourceId, audioOpts())
    warmDocs(interviewConfigRef.current?.selectedDocumentIds, { kitId: interviewConfigRef.current?.kitId || kitId })   // pre-embed selected docs only
    metricsRef.current = createSessionMetrics('live', { runId: sessionIdRef.current })
    hintTimingRef.current = null
    if (initialPip && !initialPip.closed) {
      initialPip.addEventListener('pagehide', () => {
        setPipWindow(null)
        onPipActive?.(false)
      })
      // The PiP was created in the Setup screen before LiveOverlay mounted. The
      // browser-window-created listener in main.cjs already applied protection, but
      // we confirm here and surface a warning if it somehow was not applied.
      if (window.electronAPI?.excludeFromCapture) {
        setTimeout(async () => {
          const result = await window.electronAPI.excludeFromCapture()
          const pipConfirmed = Boolean(result?.ok) && result.senderId != null && result.id !== result.senderId
          if (!result?.ok || !pipConfirmed) {
            setPipProtected(false)
            console.warn('[MockMate] Screen protection not confirmed for pre-opened PiP:', result?.error || `protected window ${result?.id} is the opener (${result?.senderId})`)
          } else {
            setPipProtected(true)
            console.log('[MockMate] Screen protection confirmed on hints window', result.id)
          }
        }, 100)
      }
    }
    const offCmd = window.electronAPI?.onOverlayCommand?.(cmd => {
      if (!cmd || typeof cmd !== 'object') return
      if (cmd.type === 'teleprompter') {
        setTeleprompter(!!cmd.active)
        trackProductEvent('teleprompter_toggle', { teleprompter: !!cmd.active, source: 'hotkey' })
      } else if (cmd.type === 'scroll-up') {
        followLatestRef.current = false
        feedRef.current?.scrollBy?.({ top: -140, behavior: 'smooth' })
      } else if (cmd.type === 'scroll-down') {
        feedRef.current?.scrollBy?.({ top: 140, behavior: 'smooth' })
      } else if (cmd.type === 'answer-now') {
        trackProductEvent('alt_r_answer_now')
        const candidateNow = resolveAnswerNowCandidate({
          liveCaptureText: liveCaptureTextRef.current,
          manualQ: manualQRef.current,
          pendingManualText: pendingManualQ.current?.text,
          lastHintText: lastHintText.current,
        })
        if (candidateNow) generateHintRef.current?.(candidateNow, { force: true, manual: true })
      }
    })
    return () => { try { offCmd?.() } catch {} }
  }, [])

  const [ending, setEnding] = useState(false)
  const evaluationRef = useRef(null)
  useEffect(() => () => evaluationRef.current?.controller.abort(), [])
  async function leaveEvaluation() {
    const pending = evaluationRef.current
    evaluationRef.current = null
    pending?.controller.abort()
    await onEnd({ runId: sessionIdRef.current, conversation: pending?.conversation || [], report: null, evaluationStatus: 'cancelled' })
  }

  async function endSession() {
    if (!sessionActiveRef.current) return
    try { metricsRef.current?.end({ tokens: usage.tokens, cost: usage.cost }) } catch {}
    metricsRef.current = null
    sessionActiveRef.current = false
    speculativeHintRef.current?.cancel('session_ended')
    try { genManagerRef.current?.cancelCurrent?.('end_session') } catch {}

    audio.stop(); stopSpeaking()
    clearTimeout(postMetaTimerRef.current)
    // The REAL conversation: interviewer questions + what YOU actually said (diarized),
    // NOT the AI's suggested answers. Merge consecutive same-speaker segments into clean turns.
    const conversation = mergeTurns(
      (interviewStateRef.current?.getSnapshot?.()?.speechTurns || [])
        .filter(t => t.role === 'interviewer' || t.role === 'candidate')
        .map(t => ({ role: t.role, text: t.text, ts: t.ts })),
    )
    if (conversation.length === 0) {
      await onCaptured?.({ runId: sessionIdRef.current, conversation, evaluationStatus: 'not_applicable' })
      await onEnd({ runId: sessionIdRef.current, conversation, report: null, evaluationStatus: 'not_applicable' }); return
    }

    const hasCandidate = conversation.some(t => t.role === 'candidate')
    // Commit captured material before starting any evaluator request.
    const captureCommit = await onCaptured?.({ runId: sessionIdRef.current, conversation, evaluationStatus: hasCandidate ? 'pending' : 'not_applicable' })
    if (captureCommit && !captureCommit.stored) {
      await onEnd({ runId: sessionIdRef.current, conversation, evaluationStatus: 'failed', report: { overallScore: null, summary: 'Evaluation was not requested because transcript preservation failed.', dimensions: [], strengths: [], improvements: [] } })
      return
    }
    if (!hasCandidate) {
      // Pair interviewer turns with overlay AI hints so notes can show "hints below".
      const withHints = []
      for (const turn of conversation) {
        withHints.push(turn)
        if (turn.role === 'interviewer') {
          const match = transcript.find(s => s.isQuestion && s.text === turn.text && (s.answer || s.hint?.fullAnswer))
          const hintText = (match?.answer || match?.hint?.fullAnswer || '').trim()
          if (hintText) withHints.push({ role: 'hint', text: hintText, ts: turn.ts })
        }
      }
      await onEnd({
        runId: sessionIdRef.current, evaluationStatus: 'not_applicable',
        conversation: withHints.length ? withHints : conversation,
        report: {
          summary: 'No candidate speech was captured (System Audio hears the interviewer only, or Mic diarization never locked). Hints are below — this is not a scored interview.',
          overallScore: null,
          dimensions: [],
          strengths: [],
          improvements: ['Use Microphone with diarization lock, or speak so your answers are captured for a real score.'],
        },
      })
      return
    }

    const pendingEvaluation = { controller: new AbortController(), conversation }
    evaluationRef.current = pendingEvaluation
    setEnding(true)
    try {
      const res = await apiFetch('/api/evaluate', {
        timeoutMs: 30000, signal: pendingEvaluation.controller.signal,
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: { runId: sessionIdRef.current, domainLabel: profileRef.current?.targetRole || 'Live interview', roundLabel: 'Live interview' },
          transcript: conversation,
          profile: profileRef.current,
          provider: providerRef.current
        })
      }).then(async r => { if (!r.ok) throw new Error('Evaluation request failed'); return r.json() })
      if (evaluationRef.current === pendingEvaluation) await onEnd({ runId: sessionIdRef.current, conversation, report: res?.report || null, evaluationStatus: res?.report?.overallScore != null ? 'scored' : 'failed' })
    } catch {
      if (evaluationRef.current === pendingEvaluation) await onEnd({ runId: sessionIdRef.current, conversation, report: null, evaluationStatus: 'failed' })
    }
    setEnding(false)
  }
  const badge = (bg, color) => ({ fontSize: 19, padding: '2px 7px', background: bg, color, borderRadius: 10, fontWeight: 600, whiteSpace: 'nowrap', letterSpacing: '0.01em' })
  const btn = (bg, color) => ({ fontSize: 21, padding: '3px 9px', minHeight: 22, background: bg, color, border: 'none', borderRadius: 5, cursor: 'pointer', fontFamily: T.font })

  // Clean status pill (left of header): one dot + one word + the timer. Nothing else.
  const isLinuxLive = typeof window !== 'undefined' && window.electronAPI?.platform === 'linux'
  const statusColor = switchingAudio ? '#f59e0b' : audio.active ? '#22c55e' : audio.reconnecting ? '#f59e0b' : '#ef4444'
  const statusLabel = switchingAudio ? 'Switching…' : audio.active ? 'Listening' : audio.reconnecting ? 'Reconnecting' : 'Paused'
  const titleExtra = (
    <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, boxShadow: `0 0 6px ${statusColor}`, animation: audio.active && !switchingAudio ? 'pulse 1.6s ease-in-out infinite' : 'none' }} />
      <span style={{ fontSize: 22, fontWeight: 600, color: statusColor }}>{statusLabel}</span>
      <span style={{ fontSize: 22, color: T.text3, fontFamily: T.fontMono, fontVariantNumeric: 'tabular-nums' }}>{fmtClock(clock)}</span>
      {/* Hide Sys↔Mic switch on Linux (System Audio unavailable). */}
      {!isLinuxLive && (
        <button type="button" onClick={switchAudioSource} disabled={switchingAudio}
          onMouseDown={e => e.stopPropagation()}
          title="Switch audio source mid-session (System Audio ↔ Microphone)"
          style={{ fontSize: 21, padding: '3px 8px', minHeight: 22, background: 'rgba(255,255,255,0.06)', color: T.text2, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 5, cursor: switchingAudio ? 'default' : 'pointer', opacity: switchingAudio ? 0.6 : 1, fontFamily: T.font }}>
          {liveSourceId === 'microphone' ? '🎤 Mic' : '🖥️ Sys'}
        </button>
      )}
      {inElectronLive && (
        <button type="button" onClick={toggleTeleprompter}
          onMouseDown={e => e.stopPropagation()}
          title="Dock at top-center under webcam (Alt+T)"
          style={{ fontSize: 21, padding: '3px 8px', minHeight: 22, background: teleprompter ? 'rgba(20,184,166,0.22)' : 'rgba(255,255,255,0.06)', color: teleprompter ? '#5eead4' : T.text2, border: `1px solid ${teleprompter ? 'rgba(20,184,166,0.45)' : 'rgba(255,255,255,0.12)'}`, borderRadius: 5, cursor: 'pointer', fontFamily: T.font }}>
          ⌖ Cam
        </button>
      )}
    </div>
  )

  // Shield = share-preview verify. Browser PiP when available; otherwise an in-overlay tip
  // (Electron often has no documentPictureInPicture — button must still do something useful).
  const liveActions = (
    <IconBtn icon="shield" active={!!(pipWindow && !pipWindow.closed) || verifyTip}
      onClick={() => {
        if (pipSupported) {
          if (pipWindow && !pipWindow.closed) { pipWindow.close(); setPipWindow(null) }
          else openProtectedPip()
        } else {
          setVerifyTip(v => !v)
        }
      }}
      title={pipSupported
        ? (pipWindow ? 'Protected window ON — check Zoom/Meet share preview' : 'Open protected hints window — then verify share preview')
        : 'How to verify the overlay is hidden from screen share'} />
  )

  if (ending) {
    return (
      <OverlayPanel panelSize={panelSize} stealth={stealth} minimized={minimized} onStealth={onStealth}
        onMinimize={onMinimize} onResize={onResize} onDrag={onDrag}
        opacity={opacity} onOpacity={onOpacity}
        clickThrough={false} onClickThrough={onClickThrough}
        onClose={leaveEvaluation} extra={<span style={{ fontSize: 22, fontWeight: 600, color: '#5eead4' }}>Ending…</span>}>
        <div role="status" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 600, color: T.text1 }}>Wrapping up…</div>
          <div style={{ fontSize: 24, color: T.text2, lineHeight: 1.45 }}>Building your notes. You can close this panel to continue without a report.</div>
        </div>
      </OverlayPanel>
    )
  }

  return (
    <OverlayPanel panelSize={panelSize} stealth={stealth} minimized={minimized} onStealth={onStealth} actions={liveActions} confirmClose
      onMinimize={onMinimize} onResize={onResize} onDrag={onDrag}
      opacity={opacity} onOpacity={onOpacity}
      clickThrough={clickThrough} onClickThrough={onClickThrough}
      onClose={endSession} extra={titleExtra}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {verifyTip && (
        <div role="status" style={{ margin: '8px 12px 0', padding: '10px 12px', background: 'rgba(13,148,136,0.12)', border: '1px solid rgba(13,148,136,0.35)', borderRadius: 8, fontSize: 23, color: T.text2, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 700, color: '#5eead4', marginBottom: 4 }}>Verify share preview</div>
          {stealth
            ? <>Stealth is ON and OS capture protection is enabled{inElectronLive ? ' (Electron)' : ''}. Open Zoom/Meet/Teams → Share and confirm MockMate is absent from the preview.</>
            : <>Stealth is OFF, so the main MockMate overlay may appear in screen capture. Turn on the shield in the toolbar before testing the share preview.</>}
          {pipSupported ? ' Tip: open the protected hints window (shield) and confirm that stays hidden too.' : ' (Browser PiP isn\'t available here — preview check is the real test.)'}
          <button type="button" onClick={() => setVerifyTip(false)} style={{ display: 'block', marginTop: 8, background: 'none', border: 'none', color: '#5eead4', cursor: 'pointer', fontSize: 22, padding: 0 }}>Dismiss</button>
        </div>
      )}
      {/* ── Single scrollable chat feed ── */}
      <div ref={feedRef} onScroll={e => {
        if (programmaticScrollRef.current) return
        const el = e.currentTarget
        // The feed is newest-first. Remaining anywhere inside the latest card is
        // still "following latest"; scrolling beyond it means reading older turns.
        const latestHeight = latestQuestionRef.current?.offsetHeight || 0
        const nearLatest = el.scrollTop < Math.max(56, latestHeight - 24)
        followLatestRef.current = nearLatest
        if (nearLatest) setShowJumpLatest(false)
      }} style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column' }}>
        {showJumpLatest && (
          <button type="button" onClick={jumpToLatest}
            style={{ position: 'sticky', top: 2, zIndex: 4, alignSelf: 'center', background: '#0f766e', color: '#fff', border: '1px solid rgba(94,234,212,0.55)', borderRadius: 999, padding: '5px 12px', marginBottom: 8, cursor: 'pointer', fontSize: 21, fontWeight: 700, boxShadow: '0 4px 14px rgba(0,0,0,0.35)' }}>
            Jump to latest ↓
          </button>
        )}
        {error && (
          <div role="alert" style={{ background: '#450a0a', border: '1px solid #ef4444', borderRadius: 5, padding: '5px 8px', fontSize: 20, color: '#fca5a5', marginBottom: 6, lineHeight: 1.4 }}>
            ⚠ {error}
            <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
              {/transcription|deepgram|connection|captur|token grant|audio/i.test(error) && (
                <>
                  <button onClick={retryTranscription}
                    style={{ background: 'rgba(94,234,212,0.15)', border: '1px solid rgba(94,234,212,0.4)', color: '#5eead4', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 20, fontWeight: 700 }}>
                    Retry transcription
                  </button>
                  {!isLinuxLive && (
                    <button onClick={switchAudioSource}
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: T.text2, borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 20, fontWeight: 600 }}>
                      Switch to {liveSourceId === 'microphone' ? 'System Audio' : 'Mic'}
                    </button>
                  )}
                </>
              )}
              <button onClick={() => { setError(''); hintInFlight.current = false; lastHintText.current = '' }}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
            </div>
          </div>
        )}

        {/* Coding platform auto-detected → one tap to capture + solve (no surprise auto-captures) */}
        {codingDetected && !screenAnalyzing && !screenAnalysis && (
          <button type="button" onClick={() => onCaptureScreen?.()}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: 8, padding: '9px 11px', marginBottom: 8, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit' }}>
            <span style={{ fontSize: 30 }}>💻</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 24, color: '#4ade80', fontWeight: 700 }}>Coding question detected</div>
              <div style={{ fontSize: 20, color: T.text3 }}>Tap to read the screen and get a solution · or press F7 / Ctrl+Shift+U</div>
            </div>
            <span style={{ fontSize: 22, color: '#4ade80', fontWeight: 700, background: 'rgba(34,197,94,0.15)', padding: '4px 10px', borderRadius: 6 }}>Solve it →</span>
          </button>
        )}

        <ScreenAnalysisPanel
          analysis={screenAnalysis} analyzing={screenAnalyzing}
          flowStatus={screenFlowStatus}
          onDismiss={onDismissScreen} onReanalyze={onReanalyze} onRecapture={onCaptureScreen}
          onContinueCapture={onContinueScreen} onNewCapture={onNewScreen}
          onUndoMerge={onUndoScreen}
          captureDisplays={captureDisplays} captureDisplayId={captureDisplayId} onCaptureDisplayId={onCaptureDisplayId}
          liveAttachHint={screenAttachHint}
        />

        {/* PiP active banner */}
        {pipWindow && !pipWindow.closed && pipProtected && (
          <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, padding: '10px 12px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 32 }}>🛡️</span>
            <div>
              <div style={{ fontSize: 24, color: '#4ade80', fontWeight: 700 }}>Protected window active</div>
              <div style={{ fontSize: 20, color: T.text3 }}>Hints are in a content-protected window — verify in your share preview before a real interview</div>
            </div>
            <button onClick={() => { pipWindow.close(); setPipWindow(null) }} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: T.text3, cursor: 'pointer', fontSize: 24 }}>✕</button>
          </div>
        )}

        {/* Warning: screen protection could not be applied — user must know */}
        {pipWindow && !pipWindow.closed && !pipProtected && (
          <div role="alert" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 8, padding: '10px 12px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 32 }}>⚠️</span>
            <div>
              <div style={{ fontSize: 24, color: '#f87171', fontWeight: 700 }}>Content protection unavailable — verify share preview</div>
              <div style={{ fontSize: 20, color: T.text3 }}>This window may appear in screen share. Restart MockMate or keep hints in the main overlay and verify preview.</div>
            </div>
          </div>
        )}

        {/* Empty state with status + keyboard shortcuts */}
        {transcript.length === 0 && !hintLoading && !audio.interim && !liveCaptureText && (
          <div style={{ padding: '16px 4px' }}>
            {/* Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '8px 12px', background: audio.active ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${audio.active ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`, borderRadius: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: audio.active ? '#22c55e' : '#ef4444', boxShadow: audio.active ? '0 0 8px #22c55e' : 'none', flexShrink: 0, animation: audio.active ? 'pulse 1.5s ease-in-out infinite' : 'none' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 24, color: audio.active ? '#4ade80' : audio.reconnecting ? '#f59e0b' : '#f87171', fontWeight: 700 }}>{audio.active ? 'Listening' : audio.reconnecting ? 'Reconnecting…' : 'Not capturing'}</div>
                <div style={{ fontSize: 20, color: T.text3 }}>
                  {!audio.active && !audio.reconnecting
                    ? 'Transcription stopped — retry or check Deepgram in Settings → Voice'
                    : audio.reconnecting
                      ? 'Connection dropped — restoring automatically'
                      : liveSourceId === 'microphone'
                        ? 'Microphone: automatic answers after speaker lock; confirm while learning speakers'
                        : 'Listening for the interviewer…'}
                </div>
              </div>
              {!audio.active && !audio.reconnecting && (
                <button onClick={retryTranscription}
                  style={{ background: 'rgba(94,234,212,0.15)', border: '1px solid rgba(94,234,212,0.4)', color: '#5eead4', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 22, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  Retry
                </button>
              )}
            </div>

            <div style={{ fontSize: 24, color: T.text3, lineHeight: 1.6, marginBottom: 14 }}>
              {liveSourceId === 'microphone'
                ? 'Microphone auto-answers the detected interviewer after speaker lock. Before lock, use Answer this. System Audio answers automatically.'
                : 'Hints appear when the interviewer asks a question. Read and respond in your own words.'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                ['Alt+H', 'Collapse / expand pill (same as − button)'],
                ['🖱️', 'Click-through — clicks pass to the meeting (overlay stays visible)'],
                ['📌 pin', 'Pinned: stays on app switch · Unpinned: collapses to pill'],
                ['◐ slider', 'Transparency'],
                ['Shield', 'Verify share preview (is MockMate hidden from the interviewer?)'],
                ['F7 / Ctrl+Shift+U', 'Screenshot → solve coding question'],
                ['Type + Enter', 'Submit a question when mic/STT fails'],
              ].map(([key, desc]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20, color: '#2dd4bf', background: 'rgba(13,148,136,0.15)', padding: '2px 7px', borderRadius: 5, fontFamily: T.fontMono, fontWeight: 600, minWidth: 92, textAlign: 'center' }}>{key}</span>
                  <span style={{ fontSize: 22, color: T.text3 }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STATE A — live transcript fragments (not yet committed) */}
        {!!liveCaptureText && !hintLoading && (
          <div style={{ fontSize: 22, color: T.text3, marginBottom: 8, paddingLeft: 4, opacity: 0.88 }}>
            {captureStatus === 'unclear' ? 'Question unclear — listening…' : 'Listening…'} {liveCaptureText}
          </div>
        )}

        {/* Mic waiting for lock — Answer this for the queued question */}
        {manualQ && liveSourceId === 'microphone' && !(audio.diarizationLocked && !audio.degraded) && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 8, padding: '9px 11px', marginBottom: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 22, color: '#fbbf24', fontWeight: 700, marginBottom: 3 }}>Microphone question — confirm before answering</div>
              <div style={{ fontSize: 24, color: T.text1, lineHeight: 1.4 }}>❓ {manualQ}</div>
            </div>
            <button type="button" onClick={() => {
              const pending = pendingManualQ.current
              generateHint(manualQ, { force: true, manual: true, questionId: pending?.questionId })
            }}
              style={{ background: 'rgba(94,234,212,0.15)', border: '1px solid rgba(94,234,212,0.4)', color: '#5eead4', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 22, fontWeight: 700, whiteSpace: 'nowrap' }}>
              Answer this
            </button>
          </div>
        )}

        {/* STATE C — Thinking… question text stays in transcript (STATE B), not replaced */}
        {hintLoading && (
          <div style={{ marginBottom: 10, marginLeft: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 7, padding: '7px 10px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 22, color: '#5eead4', marginBottom: 4, fontWeight: 600 }}>{buyTimePhrase || thinkingLabel(profileRef.current?.language)}</div>
            <div style={{ height: 2, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '40%', background: `linear-gradient(90deg,${T.accentFrom},#3b82f6)`, animation: 'slide 1.2s ease-in-out infinite' }} />
            </div>
          </div>
        )}

        {audio.interim && !liveCaptureText && <div style={{ fontSize: 22, color: T.text3, marginBottom: 8, paddingLeft: 4 }}>… {audio.interim}</div>}

        {[...transcript].filter(s => s.isQuestion).reverse().map((s, i) => {
          const isLatest = i === 0
          return (
          <div
            key={s.questionId || s.ts || s.text}
            ref={isLatest ? latestQuestionRef : null}
            style={{ marginBottom: teleprompter ? 10 : 14, opacity: isLatest ? 1 : (teleprompter ? 0.55 : 0.72), scrollMarginTop: 10 }}
          >
            {/* Q bubble — never replaced by Thinking…; in Teleprompter mode, compress to a single-line context bar so spoken cues dominate */}
            <div style={{
              display: 'flex', alignItems: teleprompter ? 'center' : 'flex-start', gap: 6,
              fontSize: teleprompter ? 23 : (isLatest ? 26 : 24),
              color: teleprompter ? T.text2 : T.text1,
              background: 'rgba(255,255,255,0.055)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '0 8px 8px 8px',
              padding: teleprompter ? '4px 8px 4px 10px' : '7px 8px 7px 11px',
              marginBottom: teleprompter ? 5 : 6,
              lineHeight: 1.45,
              fontWeight: isLatest ? 600 : 400,
              userSelect: 'text', WebkitUserSelect: 'text',
            }}>
              <span style={{
                flex: 1, minWidth: 0,
                ...(teleprompter ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : {}),
              }}>Q: {s.text}</span>
              <button type="button" onMouseDown={e => e.stopPropagation()}
                onClick={() => copyFeedText(`q:${s.questionId || s.ts}`, s.text)}
                style={btn('rgba(255,255,255,0.05)', T.text3)} title="Copy question" aria-label="Copy question">
                {copiedKey === `q:${s.questionId || s.ts}` ? '✓' : 'Copy'}
              </button>
            </div>
            {!s.answer && !s.hint && ['superseded', 'cancelled', 'failed'].includes(s.status) && (
              <div style={{ marginLeft: 10, marginBottom: 5, fontSize: 20, color: s.status === 'failed' ? '#fbbf24' : T.text3 }}>
                {s.status === 'failed' ? '⚠ Answer failed — use Retry' : '↪ Replaced by the corrected/latest question'}
                {s.status === 'failed' && (
                  <button type="button" onClick={() => generateHint(s.text, { force: true, manual: true, questionId: s.questionId })}
                    style={{ ...btn('rgba(251,191,36,0.15)', '#fbbf24'), marginLeft: 7 }}>Retry</button>
                )}
              </div>
            )}
            {/* A bubble (or incomplete stub with Retry) */}
            {s.hint && (s.answer !== undefined || s.hint.incomplete) && (
              <div ref={isLatest ? latestAnswerRef : null} style={{ marginLeft: teleprompter ? 4 : 10, scrollMarginTop: 8 }}>
                <div style={{ display: 'flex', gap: 4, marginBottom: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                  {s.hint.incomplete && <span style={badge('rgba(251,191,36,0.2)', '#fbbf24')}>⚠ INCOMPLETE</span>}
                  {s.hint.confidence === 'resume' && (
                    <span style={badge('rgba(34,197,94,0.16)', '#86efac')} title="Grounded in your verified resume experience">✓ RESUME</span>
                  )}
                  {Array.isArray(s.hint._routing?.ragSources) && s.hint._routing.ragSources.slice(0, 2).map((src, si) => {
                    const label = [src.doc?.replace(/\.(pdf|docx|txt|md)$/i, ''), src.section ? `§${src.section.slice(0, 22)}` : null].filter(Boolean).join(' · ')
                    return (
                      <span key={si} style={badge('rgba(56,189,248,0.14)', '#7dd3fc')} title={`Retrieved from ${src.doc}${src.section ? ` (${src.section})` : ''}`}>
                        📄 {label}
                      </span>
                    )
                  })}
                  {s.hint._routing?.screenAttached && (
                    <span style={badge('rgba(168,85,247,0.16)', '#d8b4fe')} title="Grounded in active screen capture">🖥 SCREEN</span>
                  )}
                  {Array.isArray(s.hint._searchSources) && s.hint._searchSources.length > 0 && (
                    <span style={badge('rgba(45,212,191,0.14)', '#5eead4')} title="Grounded in live web search">🌐 WEB</span>
                  )}
                  {s.hint.complexity && (
                    <span style={{ ...badge('rgba(255,255,255,0.06)', T.text2), fontFamily: T.fontMono }}>{s.hint.complexity}</span>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
                    {s.hint.incomplete && (
                      <button type="button" onClick={() => generateHint(s.text, { force: true, manual: true, questionId: s.questionId })} style={btn('rgba(251,191,36,0.15)', '#fbbf24')}>Retry</button>
                    )}
                    <button type="button" onMouseDown={e => e.stopPropagation()}
                      onClick={() => copyFeedText(`a:${s.questionId || s.ts}`, s.hint.fullAnswer || s.hint.sampleAnswer || s.answer || '')}
                      style={btn('rgba(255,255,255,0.05)', T.text3)} title="Copy answer" aria-label="Copy answer">
                      {copiedKey === `a:${s.questionId || s.ts}` ? '✓' : 'Copy'}
                    </button>
                  </div>
                </div>
                {s.hint.resumeStory && <div style={{ borderLeft: '2px solid #4ade80', paddingLeft: 7, fontSize: 21, color: '#86efac', marginBottom: 6 }}>{s.hint.resumeStory}</div>}
                {(() => {
                  const streamingThis = streaming && s.text === lastHintText.current
                  const layers = glanceLayers(s.answer || '', s.hint || {})
                  // Never auto-expand latest — that duplicated opener/bullets + full prose.
                  const expanded = expandedAnswers.has(s.text)
                  const showBullets = !expanded && layers.keyPoints.length > 0
                  const watch = s.hint.watchOut || layers.watchOut
                  const hasMore = !streamingThis && ((layers.fullAnswer || '').length > (layers.opener || '').length + 40)
                  const isResumeCard = s.hint.confidence === 'resume'
                  return (
                    <div role="log" aria-live="polite" aria-label="Suggested answer" style={{
                      fontSize: teleprompter ? 31 : 27,
                      color: isResumeCard ? '#dcfce7' : T.text1,
                      background: isResumeCard ? T.resumeAnswerBg : T.answerBg,
                      border: `1px solid ${isResumeCard ? T.resumeAnswerBorder : T.answerBorder}`,
                      boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.07)',
                      borderRadius: '8px 8px 8px 0',
                      padding: teleprompter ? '11px 14px' : '10px 12px',
                      lineHeight: teleprompter ? 1.5 : 1.55,
                      letterSpacing: teleprompter ? '-0.008em' : 'normal',
                      userSelect: 'text', WebkitUserSelect: 'text',
                    }}>
                      {/* Glance OR full — never both (was repeating the same answer twice). */}
                      {expanded && hasMore ? (
                        <div style={{ lineHeight: 1.68, fontSize: teleprompter ? 29 : 26 }}>{renderMd(layers.fullAnswer || s.answer || '')}</div>
                      ) : (
                        <>
                          <div style={{ fontWeight: 600, marginBottom: showBullets ? 8 : 0, lineHeight: teleprompter ? 1.48 : 1.45 }}>
                            {layers.opener || (streamingThis ? '…' : '…')}
                            {streamingThis && <span style={{ display: 'inline-block', width: 2, height: '0.9em', background: T.accentFrom, marginLeft: 2, verticalAlign: 'text-bottom', animation: 'blink 0.7s step-end infinite' }} />}
                          </div>
                          {showBullets && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: teleprompter ? 6 : 4, marginBottom: 4 }}>
                              {layers.keyPoints.map((pt, bi) => (
                                <div key={bi} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: teleprompter ? 28 : 25, lineHeight: teleprompter ? 1.45 : 1.4, color: isResumeCard ? '#bbf7d0' : '#E2E8F0' }}>
                                  <span style={{ color: T.accentFrom, flexShrink: 0, marginTop: 2, fontSize: 20 }}>▸</span>
                                  <span>{pt}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                      {hasMore && (
                        <button type="button" onClick={() => setExpandedAnswers(prev => {
                          const n = new Set(prev)
                          if (n.has(s.text)) n.delete(s.text); else n.add(s.text)
                          return n
                        })}
                          style={{ background: 'none', border: 'none', color: '#5eead4', fontSize: 22, cursor: 'pointer', padding: '6px 0 0', fontWeight: 600 }}>
                          {expanded ? 'Show glance' : 'Expand full answer'}
                        </button>
                      )}
                      {watch && <div style={{ fontSize: 20, color: '#f59e0b', marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>⚠ {watch}</div>}
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
          )
        })}
        </div>

        {/* Type a question when STT fails / for silent practice — Enter → LLM */}
        <form
          onSubmit={e => {
            e.preventDefault()
            const q = typedQ.trim()
            if (!q || hintInFlight.current) return
            setTypedQ('')
            setManualQ('')
            generateHint(q, { force: true, manual: true })
          }}
          style={{ flexShrink: 0, padding: '8px 10px 10px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 6 }}
          data-mm-hit="1"
        >
          <input
            type="text"
            value={typedQ}
            onChange={e => setTypedQ(e.target.value)}
            placeholder="Type a question · Enter to ask AI"
            disabled={!!hintLoading || ending}
            aria-label="Type interview question"
            style={{
              flex: 1, minWidth: 0, height: 48, padding: '0 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(0,0,0,0.35)', color: T.text1, fontSize: 24, fontFamily: T.font,
            }}
          />
          <button
            type="submit"
            disabled={!typedQ.trim() || !!hintLoading || ending}
            style={{
              height: 48, padding: '0 12px', borderRadius: 8, border: 'none', fontSize: 22, fontWeight: 700,
              background: typedQ.trim() && !hintLoading ? 'rgba(13,148,136,0.45)' : 'rgba(255,255,255,0.06)',
              color: typedQ.trim() && !hintLoading ? '#5eead4' : T.text3, cursor: typedQ.trim() && !hintLoading ? 'pointer' : 'default',
            }}
          >Ask</button>
        </form>

        {/* Secondary controls — collapsed so glance path stays opener + bullets */}
        <details style={{ flexShrink: 0, padding: '0 10px 8px', borderTop: 'none' }}>
          <summary style={{ listStyle: 'none', cursor: 'pointer', fontSize: 18, fontWeight: 700, letterSpacing: '0.07em', color: T.text3, userSelect: 'none', paddingTop: 4 }}>
            OPTIONS {coachMode ? '· COACH' : ''}{answerStyle !== 'concise' ? ` · ${answerStyle.toUpperCase()}` : ''}{extraContext ? ' · CTX' : ''}{usage.tokens > 0 ? ` · ${(usage.tokens / 1000).toFixed(1)}k` : ''}
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setAnswerStyle(s => s === 'concise' ? 'balanced' : s === 'balanced' ? 'detailed' : 'concise')}
                title="Answer length — Concise (fastest glance) · Balanced · Detailed"
                style={{ display: 'flex', alignItems: 'center', gap: 5, background: answerStyle === 'balanced' ? 'rgba(255,255,255,0.04)' : 'rgba(20,184,166,0.15)', border: `1px solid ${answerStyle === 'balanced' ? 'rgba(255,255,255,0.1)' : 'rgba(20,184,166,0.4)'}`, color: answerStyle === 'balanced' ? T.text2 : '#5eead4', fontSize: 18, fontWeight: 700, letterSpacing: '0.05em', borderRadius: 100, padding: '3px 9px', cursor: 'pointer' }}>
                {answerStyle === 'concise' ? '⚡ CONCISE' : answerStyle === 'detailed' ? '📖 DETAILED' : '⚖ BALANCED'}
              </button>
              <button type="button" onClick={() => {
                const next = !coachModeRef.current
                coachModeRef.current = next
                setCoachMode(next)
                const q = lastHintText.current
                if (q) generateHint(q, { force: true, questionId: activeQuestionIdRef.current })
              }}
                title="Coach = structure; Answer = full spoken answer"
                style={{ display: 'flex', alignItems: 'center', gap: 5, background: coachMode ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)', border: `1px solid ${coachMode ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.1)'}`, color: coachMode ? '#4ade80' : T.text2, fontSize: 18, fontWeight: 700, letterSpacing: '0.05em', borderRadius: 100, padding: '3px 9px', cursor: 'pointer' }}>
                {coachMode ? '🎓 COACH' : '💬 ANSWER'}
              </button>
              {usage.tokens > 0 && (
                <span title={`This session: ${usage.tokens.toLocaleString()} tokens · est. $${usage.cost.toFixed(3)}`}
                  style={{ fontSize: 20, color: T.text3, fontFamily: T.fontMono, fontVariantNumeric: 'tabular-nums', marginLeft: 'auto' }}>
                  {(usage.tokens / 1000).toFixed(1)}k tok · ~${usage.cost.toFixed(2)}
                </span>
              )}
            </div>
            <textarea aria-label="Extra context for AI interview hints" value={extraContext} onChange={e => setExtraContext(e.target.value)}
              placeholder="Extra context — e.g. 'Focus on Python' · 'System design round'"
              style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(20,184,166,0.25)', borderRadius: 5, color: T.text1, fontSize: 20, padding: '5px 7px', resize: 'vertical', minHeight: 44, fontFamily: T.font, lineHeight: 1.5, boxSizing: 'border-box' }} rows={2} />
          </div>
        </details>
      </div>
    </OverlayPanel>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function LiveCompanion({ onHome, onPhaseChange, onSessionStart, onSessionEnd, panelSize, stealth, minimized, onStealth, onMinimize, onResize, onDrag, opacity, onOpacity, screenAnalysis, screenAnalyzing, screenFlowStatus, onDismissScreen, codingDetected, onCaptureScreen, onContinueScreen, onNewScreen, onUndoScreen, onReanalyze, onPipActive, clickThrough, onClickThrough, onLiveSpokenQuestion, captureDisplays, captureDisplayId, onCaptureDisplayId, initialProfile, initialKit, onProfileChange, initialAudioSource }) {
  const [phase, setPhase] = useState('setup')
  const [sessionConfig, setSessionConfig] = useState(null)
  const [sessionNotes, setSessionNotes] = useState(null)
  const [recoveredLive, setRecoveredLive] = useState(() => loadLiveCheckpoint())
  const startPendingRef = useRef(false)
  // Tell the parent our phase so it can size the window: setup/notes = full dashboard
  // window; live = compact invisible overlay.
  useEffect(() => { onPhaseChange?.(phase) }, [phase, onPhaseChange])

  if (phase === 'notes' && sessionNotes?.recovered) {
    const recovered = sessionNotes.checkpoint
    return (
      <div style={{ minHeight: '100vh', background: T.bg, color: T.text1, fontFamily: T.font, overflowY: 'auto' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Recovered Live notes</h2>
          <p style={{ fontSize: 13, color: T.text2, lineHeight: 1.6, margin: 0 }}>
            These are questions and AI suggestions from an interrupted session, not your spoken answers or a scored interview.
            Audio and pending requests are not resumed. The original notes remain on this device for up to 12 hours unless discarded.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => copyText(checkpointToConversation(recovered).map(t => (t.role === 'interviewer' ? 'QUESTION: ' : 'AI SUGGESTION: ') + t.text).join('\n\n'))}
              style={{ border: 0, borderRadius: T.rCtrl, padding: '9px 12px', background: T.accentFrom, color: T.bg, cursor: 'pointer' }}>Copy recovered notes</button>
            <button type="button" onClick={onHome}
              style={{ border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl, padding: '9px 12px', background: T.surface2, color: T.text1, cursor: 'pointer' }}>← Dashboard</button>
          </div>
          {recovered.transcript.map((item, i) => {
            const suggested = item.answer || item.hint?.fullAnswer || ''
            return <div key={item.questionId || i} style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.accentFrom }}>QUESTION {i + 1}</div>
              <div style={{ fontSize: 13, marginTop: 6, whiteSpace: 'pre-wrap' }}>{item.text}</div>
              {suggested && <>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.text3, marginTop: 12 }}>AI SUGGESTION {item.hint?.incomplete ? '— INCOMPLETE' : ''}</div>
                <div style={{ fontSize: 12.5, color: T.text2, marginTop: 5, whiteSpace: 'pre-wrap' }}>{suggested}</div>
              </>}
            </div>
          })}
        </div>
      </div>
    )
  }

  if (phase === 'notes') {
    const conversation = sessionNotes?.conversation || []
    const report = sessionNotes?.report || { summary: 'Session ended — your conversation is below.', overallScore: null, dimensions: [], strengths: [], improvements: [] }
    return (
      <OverlayPanel panelSize={panelSize} stealth={stealth} minimized={minimized}
        onMinimize={onMinimize} onResize={onResize} onDrag={onDrag}
        onClose={() => window.electronAPI ? window.close() : onHome()}
        extra={<button type="button" onClick={onHome} style={{ fontSize: 18, padding: '8px 12px', color: T.text1, background: T.surface1, border: `1px solid ${T.borderStrong}`, borderRadius: 8 }}>← Back to dashboard</button>}>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: T.bg }}>
          <div style={{ maxWidth: 900, margin: '0 auto', padding: '22px 26px', boxSizing: 'border-box' }}>
            {report._storageWarning && sessionNotes?.runId && <button type="button" onClick={async () => {
              const result = await preserveLiveSession({ runId: sessionNotes.runId, conversation, report,
                evaluationStatus: sessionNotes.evaluationStatus, final: true,
                config: { interviewSetup: { ...sessionConfig?.interviewConfig, source: 'live' } }, profile: sessionConfig?.profile || {} })
              if (result.stored) setRecoveredLive(null)
              setSessionNotes({ ...sessionNotes, report: result.report })
            }} style={{ padding: '10px 16px', marginBottom: 12, color: T.text1, background: T.surface1,
              border: `1px solid ${T.borderStrong}`, borderRadius: 8 }}>Retry local save</button>}
            <SoloFeedback report={report} transcript={conversation} onAgain={onHome} onAgainLabel="← Back to dashboard" />
          </div>
        </div>
      </OverlayPanel>
    )
  }

  if (phase === 'setup') return (
    <SetupScreen initialAudioSource={initialAudioSource}
      recoveredLive={recoveredLive}
      initialProfile={initialProfile}
      initialKit={initialKit}
      onProfileChange={onProfileChange}
      onRecoverLive={() => {
        setSessionNotes({ recovered: true, checkpoint: recoveredLive })
        setPhase('notes')
      }}
      onDiscardLive={() => { clearLiveCheckpoint(); setRecoveredLive(null) }}
      onStart={async config => {
        if (startPendingRef.current) return
        startPendingRef.current = true
        try {
          const runId = globalThis.crypto?.randomUUID?.() || createSessionId()
          const provisional = await preserveLiveSession({ runId, conversation: [], captureStatus: 'provisional', evaluationStatus: 'not_requested',
            config: { interviewSetup: { ...config.interviewConfig, source: 'live' } }, profile: config.profile })
          if (!provisional.stored && await sqliteEnabled().catch(() => true)) {
            setSessionNotes({ runId, conversation: [], evaluationStatus: 'not_requested', report: provisional.report })
            setPhase('notes'); return
          }
          // Keep recovery until a verified final History commit.
          // Do not auto-open Protected/PiP — user opens it explicitly from the live overlay.
          onSessionStart?.()
          setSessionConfig({ ...config, runId, initialStorageWarning: provisional.report._storageWarning || '', pip: null })
          setPhase('live')
        } finally { startPendingRef.current = false }
      }}
      onHome={onHome}
      panelSize={panelSize} stealth={stealth}
      minimized={minimized}
      onStealth={onStealth} onMinimize={onMinimize}
      onResize={onResize} onDrag={onDrag}
      opacity={opacity} onOpacity={onOpacity}
    />
  )

  return (
    <LiveOverlay
      {...sessionConfig}
      panelSize={panelSize} stealth={stealth} minimized={minimized}
      onStealth={onStealth} onMinimize={onMinimize}
      onResize={onResize} onDrag={onDrag}
      opacity={opacity} onOpacity={onOpacity}
      onCaptured={data => preserveLiveSession({
        ...data, config: { interviewSetup: { ...sessionConfig?.interviewConfig, source: 'live' }, kitId: sessionConfig?.kitId },
        profile: sessionConfig?.profile || {},
      })}
      onEnd={async data => {
        onSessionEnd?.()
        const result = await preserveLiveSession({
          ...data, runId: data?.runId || sessionConfig.runId, final: true,
          config: { domainLabel: sessionConfig?.profile?.targetRole || 'Live interview', kitId: sessionConfig?.kitId,
            kitName: sessionConfig?.kitName, interviewSetup: { ...sessionConfig?.interviewConfig, source: 'live' } },
          profile: sessionConfig?.profile || {},
        })
        if (result.stored) setRecoveredLive(null)
        setSessionNotes({ ...data, report: result.report }); setPhase('notes')
      }}
      screenAnalysis={screenAnalysis} screenAnalyzing={screenAnalyzing} onDismissScreen={onDismissScreen}
      screenFlowStatus={screenFlowStatus} onContinueScreen={onContinueScreen} onNewScreen={onNewScreen}
      onUndoScreen={onUndoScreen}
      codingDetected={codingDetected} onCaptureScreen={onCaptureScreen} onReanalyze={onReanalyze}
      onLiveSpokenQuestion={onLiveSpokenQuestion}
      captureDisplays={captureDisplays} captureDisplayId={captureDisplayId} onCaptureDisplayId={onCaptureDisplayId}
      onPipActive={onPipActive}
      clickThrough={clickThrough} onClickThrough={onClickThrough}
    />
  )
}
