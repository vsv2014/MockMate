import React, { useState, useMemo } from 'react'
import { T } from '../auth/tokens'
import { parseCustomInstructionSections } from '../../shared/customInstructions.js'
import { CUSTOM_INSTRUCTIONS_PACK_MAX, CUSTOM_INSTRUCTIONS_STORE_MAX } from '../lib/interviewConfig'
import { getScopedItem, setScopedItem } from '../lib/accountScope'
import { trackProductEvent } from '../lib/productIntelligence'

const SAVED_PLAYBOOKS_KEY = 'mm-saved-playbooks-v1'
const CORE_TITLE_RE = /^(VOICE|TRUTH|ASR|UNKNOWN|FINAL(?: SILENT)? RULE|CORE(?: BEHAVIOU?R)?|BEHAVIOU?R RULES?|GLOBAL|ALWAYS|PREAMBLE)$/i

export const PLAYBOOK_TEMPLATES = [
  {
    id: 'swe_coding',
    label: '⚡ SWE / Coding',
    roleHint: 'DSA, Backend & Full-Stack rounds',
    prompt: [
      'VOICE: Lead with a direct 1-sentence answer in natural spoken first-person. Keep explanations crisp, technical, and free of filler.',
      'TRUTH: Ground project examples strictly in my uploaded resume and documents. Never invent employers, metrics, or ownership.',
      'CODING/DSA: State the algorithmic pattern and time/space complexity in the first sentence, walk through the core invariant in 2-3 bullets, provide clean production-grade code, and call out boundary edge cases.',
      'API/BACKEND: Emphasize idempotency, pagination, rate limiting, schema validation, and observability (p95 latency, structured logs).',
      'BEHAVIORAL: Use tight STAR structure—open with the headline outcome metric, then my specific engineering decision and trade-off.',
    ].join('\n'),
  },
  {
    id: 'system_design',
    label: '🏗 System Design / Staff',
    roleHint: 'HLD, LLD & Distributed Systems',
    prompt: [
      'VOICE: Speak like a pragmatic Staff Engineer—clarify scale assumptions first, state explicit trade-offs, and avoid textbook hand-waving.',
      'TRUTH: Anchor production war stories and scale numbers strictly in my verified resume and knowledge bank.',
      'SYSTEM DESIGN: Structure answers as (1) functional & non-functional requirements + QPS/storage math, (2) high-level data flow, (3) storage & partitioning choice, and (4) bottleneck mitigation & failure modes.',
      'DISTRIBUTED: Highlight backpressure, idempotency keys, dead-letter queues, partition hot-spotting, and graceful degradation.',
    ].join('\n'),
  },
  {
    id: 'ai_rag',
    label: '🤖 AI / LLM / RAG',
    roleHint: 'Applied AI, Agentic & ML Systems',
    prompt: [
      'VOICE: Answer with concrete systems rigor—balance model quality against TTFT latency, token cost, and deterministic guardrails.',
      'TRUTH: Reference only my actual AI/ML pipelines, benchmarks, and architectures from my resume and uploaded notes.',
      'AI/RAG/AGENTS: Cover hybrid retrieval (dense vector + lexical BM25), structure-aware chunking, cross-encoder re-ranking, groundedness/faithfulness evals, and streaming guardrails.',
      'PYTHON/FASTAPI: Prefer async streaming pipelines, bounded timeouts, structured outputs, and provider failover.',
    ].join('\n'),
  },
  {
    id: 'data_sql',
    label: '📊 Data / SQL',
    roleHint: 'SQL, Data Engineering & Analytics',
    prompt: [
      'VOICE: State the grain of the table and join cardinality first, then give the cleanest readable query.',
      'TRUTH: Use only my real data warehouse, ETL, and analytics experience from my uploaded materials.',
      'SQL/DATABASE: Prefer readable CTEs, explicit window functions (ROW_NUMBER/RANK/LAG), NULL-safe joins, and index-aware predicates. Call out duplicate-row traps.',
      'DISTRIBUTED: Discuss partitioning vs clustering keys, incremental idempotency, and late-arriving data handling.',
    ].join('\n'),
  },
  {
    id: 'behavioral_star',
    label: '🎯 Behavioral STAR',
    roleHint: 'Hiring Manager, Bar Raiser & Leadership',
    prompt: [
      'VOICE: Warm, executive, and ownership-focused. Always say "I" for my direct work and give the headline result in the first 15 seconds.',
      'TRUTH: Never fabricate conflicts, metrics, or leadership scope—adapt my real resume stories to the question angle.',
      'BEHAVIORAL: Follow a tight spoken STAR arc: (1) 1-sentence Situation/Task with stakes, (2) 2 concrete Actions I drove and why, (3) quantified Result + what I would do differently.',
    ].join('\n'),
  },
  {
    id: 'anti_fail',
    label: '🛡 Anti-Fail Guardrails',
    roleHint: 'Forensic rules from competitor-autopsy failure patterns (docs/lockedin-failure-patterns.md)',
    prompt: [
      'MISHEARD QUESTIONS: If the question contains a garbled or ambiguous term (e.g. "notes" vs "nodes"), never answer a guessed question — ask one clarifying line, or state the assumption explicitly before answering.',
      'NOT-ASKED QUESTIONS: Never answer a different question. Logistical turns (availability, salary, process) get a one-sentence answer and stop — no technical monologue.',
      'TRUTH: If the question names a tool, metric or employer absent from my resume, do not claim it — bridge honestly ("I have not used X in production; the closest is Y and here is how it transfers").',
      'COMPANY CONTEXT: For "why us / how would you do this here" answers, anchor to THIS company\'s domain from the JD; generic boilerplate is forbidden.',
      'SQL/CODING: Restate table grain and schema assumptions before writing queries; never invent columns; if schema is unknown, say the assumption in one line first.',
      'PACING: 90–120 second answers; STAR 10% situation / 10% task / 70–80% action / 10% result; stop immediately when the interviewer interrupts or moves on.',
      'SENIORITY BAND: Match depth to my actual years — no intern-shallow or architect-deep answers outside my band.',
    ].join('\n'),
  },
]

export const QUICK_SNIPPETS = [
  {
    id: 'voice',
    label: '+ Voice & Tone',
    heading: 'VOICE',
    line: 'VOICE: Lead with a direct 1-sentence headline answer in natural spoken first-person; keep sentences short and conversational.',
  },
  {
    id: 'truth',
    label: '+ Truth Boundary',
    heading: 'TRUTH',
    line: 'TRUTH: Ground all claims in my uploaded resume and documents; never invent employers, metrics, or technologies.',
  },
  {
    id: 'coding',
    label: '+ Coding / DSA',
    heading: 'CODING/DSA',
    line: 'CODING/DSA: State pattern + O(t)/O(s) complexity first, give 2-3 intuition steps, write clean runnable code, and list edge cases.',
  },
  {
    id: 'sysdesign',
    label: '+ System Design',
    heading: 'SYSTEM DESIGN',
    line: 'SYSTEM DESIGN: Cover scale assumptions, API & data model, sharding/caching strategy, and single-point-of-failure trade-offs.',
  },
  {
    id: 'sql',
    label: '+ SQL Rules',
    heading: 'SQL/DATABASE',
    line: 'SQL/DATABASE: Use clean CTEs and window functions, state table grain first, and guard against NULLs and fan-out joins.',
  },
  {
    id: 'behavioral',
    label: '+ Behavioral STAR',
    heading: 'BEHAVIORAL',
    line: 'BEHAVIORAL: Open with the measurable outcome, then walk through Situation, my specific Action, and the quantified Result.',
  },
]

export function loadSavedPlaybooks() {
  try {
    const raw = JSON.parse(getScopedItem(SAVED_PLAYBOOKS_KEY, '[]') || '[]')
    return Array.isArray(raw) ? raw.filter(p => p && p.id && p.name && typeof p.prompt === 'string') : []
  } catch {
    return []
  }
}

export function savePlaybookSlot(name, prompt) {
  const cleanName = String(name || '').trim().slice(0, 48)
  const cleanPrompt = String(prompt || '').trim().slice(0, CUSTOM_INSTRUCTIONS_STORE_MAX)
  if (!cleanName || !cleanPrompt) return loadSavedPlaybooks()
  const list = loadSavedPlaybooks()
  const existingIdx = list.findIndex(p => p.name.toLowerCase() === cleanName.toLowerCase())
  const entry = {
    id: existingIdx >= 0 ? list[existingIdx].id : `pb_${Date.now().toString(36)}`,
    name: cleanName,
    prompt: cleanPrompt,
    updatedAt: Date.now(),
  }
  const next = existingIdx >= 0
    ? list.map((p, i) => (i === existingIdx ? entry : p))
    : [entry, ...list].slice(0, 8)
  try { setScopedItem(SAVED_PLAYBOOKS_KEY, JSON.stringify(next)) } catch {}
  return next
}

export function deletePlaybookSlot(id) {
  const next = loadSavedPlaybooks().filter(p => p.id !== id)
  try { setScopedItem(SAVED_PLAYBOOKS_KEY, JSON.stringify(next)) } catch {}
  return next
}

export function insertOrUpdateSnippet(currentText = '', snippet) {
  if (!snippet?.line) return currentText
  const cur = String(currentText || '').trim()
  const headingPrefix = `${snippet.heading}:`
  if (cur.toUpperCase().includes(headingPrefix.toUpperCase())) return cur
  const joined = cur ? `${cur}\n${snippet.line}` : snippet.line
  return joined.slice(0, CUSTOM_INSTRUCTIONS_STORE_MAX)
}

export function classifyPlaybookSections(value = '') {
  const sections = parseCustomInstructionSections(value)
  return sections.map(s => ({
    title: s.title,
    chars: s.text.length,
    mode: CORE_TITLE_RE.test(s.title) ? 'core' : 'routed',
  }))
}

export default function CustomPromptStudio({ value = '', onChange, compact = false }) {
  const [savedList, setSavedList] = useState(() => loadSavedPlaybooks())
  const [savingName, setSavingName] = useState('')
  const [showSaveBox, setShowSaveBox] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')

  const modules = useMemo(() => classifyPlaybookSections(value), [value])
  const coreCount = modules.filter(m => m.mode === 'core').length
  const routedCount = modules.filter(m => m.mode === 'routed').length

  function flash(msg) {
    setStatusMsg(msg)
    setTimeout(() => setStatusMsg(cur => (cur === msg ? '' : cur)), 2200)
  }

  function applyTemplate(tpl) {
    if (value?.trim() && value.trim() !== tpl.prompt.trim()) {
      const ok = typeof window === 'undefined' || !window.confirm
        ? true
        : window.confirm(`Replace current playbook with the "${tpl.label}" template?`)
      if (!ok) return
    }
    onChange?.(tpl.prompt)
    trackProductEvent('playbook_template_applied', { templateId: tpl.id })
    flash(`✓ Loaded ${tpl.label} playbook`)
  }

  function addSnippet(snip) {
    const next = insertOrUpdateSnippet(value, snip)
    if (next === (value || '').trim()) {
      flash(`${snip.heading} section is already in your playbook`)
      return
    }
    onChange?.(next)
    flash(`✓ Added ${snip.heading} rule`)
  }

  function handleSaveSlot(e) {
    e?.preventDefault?.()
    if (!savingName.trim() || !value?.trim()) return
    const next = savePlaybookSlot(savingName, value)
    setSavedList(next)
    setSavingName('')
    setShowSaveBox(false)
    trackProductEvent('playbook_saved')
    flash('✓ Saved playbook preset')
  }

  function handleDeleteSlot(id, name) {
    const next = deletePlaybookSlot(id)
    setSavedList(next)
    flash(`Removed "${name}"`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 10 }}>
      {/* Top bar: Role templates (LockedIn style 1-click presets) */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: T.text2 }}>
            1-Click Role Playbooks <span style={{ color: T.text3, fontWeight: 400 }}>· auto-routes sections per question</span>
          </span>
          {statusMsg && (
            <span role="status" style={{ fontSize: 10.5, color: '#5eead4', fontWeight: 600 }}>
              {statusMsg}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PLAYBOOK_TEMPLATES.map(tpl => {
            const active = value?.trim() === tpl.prompt.trim()
            return (
              <button
                key={tpl.id}
                type="button"
                title={tpl.roleHint}
                onClick={() => applyTemplate(tpl)}
                style={{
                  padding: compact ? '4px 9px' : '5px 11px',
                  borderRadius: 999,
                  fontSize: compact ? 10.5 : 11.5,
                  fontWeight: active ? 600 : 500,
                  fontFamily: T.font,
                  cursor: 'pointer',
                  background: active ? 'rgba(20,184,166,0.22)' : 'rgba(255,255,255,0.045)',
                  color: active ? '#5eead4' : T.text2,
                  border: `1px solid ${active ? 'rgba(45,212,191,0.55)' : T.border}`,
                  transition: 'all 0.12s ease',
                }}
              >
                {tpl.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Saved user playbooks bar (if any exist) */}
      {savedList.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10.5, color: T.text3, fontWeight: 600 }}>Saved:</span>
          {savedList.map(slot => {
            const isCurrent = value?.trim() === slot.prompt.trim()
            return (
              <div
                key={slot.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  background: isCurrent ? 'rgba(56,189,248,0.16)' : T.surface2,
                  border: `1px solid ${isCurrent ? 'rgba(56,189,248,0.45)' : T.border}`,
                  borderRadius: 999,
                  padding: '2px 4px 2px 9px',
                  gap: 4,
                }}
              >
                <button
                  type="button"
                  onClick={() => { onChange?.(slot.prompt); flash(`✓ Loaded "${slot.name}"`) }}
                  style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    fontSize: 11, fontWeight: isCurrent ? 600 : 500, color: isCurrent ? '#7dd3fc' : T.text1, fontFamily: T.font,
                  }}
                >
                  bookmark · {slot.name}
                </button>
                <button
                  type="button"
                  title={`Remove saved playbook "${slot.name}"`}
                  aria-label={`Remove saved playbook ${slot.name}`}
                  onClick={() => handleDeleteSlot(slot.id, slot.name)}
                  style={{
                    background: 'none', border: 'none', color: T.text3, cursor: 'pointer',
                    fontSize: 11, padding: '0 4px', lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Modular rule snippet chips */}
      {!compact && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 10.5, color: T.text3, marginRight: 2 }}>Add block:</span>
          {QUICK_SNIPPETS.map(snip => {
            const exists = String(value || '').toUpperCase().includes(`${snip.heading}:`)
            return (
              <button
                key={snip.id}
                type="button"
                onClick={() => addSnippet(snip)}
                style={{
                  padding: '3px 8px',
                  borderRadius: 6,
                  fontSize: 10.5,
                  fontFamily: T.fontMono,
                  cursor: 'pointer',
                  background: exists ? 'rgba(34,197,94,0.10)' : 'rgba(255,255,255,0.035)',
                  color: exists ? '#86efac' : T.text2,
                  border: `1px solid ${exists ? 'rgba(34,197,94,0.30)' : T.border}`,
                }}
              >
                {exists ? `✓ ${snip.heading}` : snip.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Main Playbook Textarea */}
      <textarea
        aria-label="Interview Playbook"
        rows={compact ? 4 : 6}
        maxLength={CUSTOM_INSTRUCTIONS_STORE_MAX}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: T.surface2,
          color: T.text1,
          padding: compact ? '8px 10px' : '10px 12px',
          borderRadius: T.rCtrl,
          fontSize: compact ? 11.5 : 12.5,
          lineHeight: 1.55,
          fontFamily: T.font,
          resize: 'vertical',
          minHeight: compact ? 84 : 122,
          border: `1px solid ${value?.trim() ? 'rgba(34,211,238,0.6)' : T.border}`,
        }}
        value={value || ''}
        placeholder={'Example:\nVOICE: Keep answers confident and concise.\nTRUTH: Never invent experience or ownership.\nSQL/DATABASE: Give simple correct SQL first.\nCODING/DSA: Approach → code → complexity → edge cases.'}
        onChange={e => onChange?.(e.target.value.slice(0, CUSTOM_INSTRUCTIONS_STORE_MAX))}
      />

      {/* Live Compiler Inspector — shows parsed Core vs Auto-Routed sections */}
      {modules.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5,
          background: 'rgba(8,145,178,0.07)', border: '1px solid rgba(34,211,238,0.20)',
          borderRadius: 8, padding: '6px 9px',
        }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#67e8f9', marginRight: 3 }}>
            Compiled ({coreCount} always · {routedCount} auto-routed):
          </span>
          {modules.map((m, idx) => (
            <span
              key={`${m.title}-${idx}`}
              title={m.mode === 'core'
                ? 'Always injected on every interview turn'
                : 'Dynamically injected when the question matches this topic'}
              style={{
                fontSize: 9.5,
                fontFamily: T.fontMono,
                fontWeight: 600,
                padding: '1px 7px',
                borderRadius: 999,
                background: m.mode === 'core' ? 'rgba(20,184,166,0.18)' : 'rgba(56,189,248,0.15)',
                color: m.mode === 'core' ? '#5eead4' : '#7dd3fc',
                border: `1px solid ${m.mode === 'core' ? 'rgba(20,184,166,0.35)' : 'rgba(56,189,248,0.32)'}`,
              }}
            >
              {m.mode === 'core' ? '● ' : '⚡ '}{m.title}
            </span>
          ))}
        </div>
      )}

      {/* Footer: Character budget + Save preset + Clear */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 10.5, color: T.text3 }}>
        <span>
          {value?.trim()
            ? `✓ Active · routes core + matching sections up to ${CUSTOM_INSTRUCTIONS_PACK_MAX.toLocaleString()} chars`
            : 'Pick a role template above or write custom HEADING: rules'}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          {value?.trim() && !showSaveBox && (
            <button
              type="button"
              onClick={() => setShowSaveBox(true)}
              style={{
                background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.32)',
                color: '#5eead4', borderRadius: 6, padding: '2px 8px', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', fontFamily: T.font,
              }}
            >
              ★ Save preset
            </button>
          )}
          {value?.trim() && (
            <button
              type="button"
              onClick={() => onChange?.('')}
              style={{
                background: 'none', border: 'none', color: T.text3, fontSize: 10.5, cursor: 'pointer', padding: 0, fontFamily: T.font,
              }}
            >
              Clear
            </button>
          )}
          <span style={{ fontFamily: T.fontMono, fontVariantNumeric: 'tabular-nums' }}>
            {(value || '').length.toLocaleString()} / {CUSTOM_INSTRUCTIONS_STORE_MAX.toLocaleString()}
          </span>
        </div>
      </div>

      {showSaveBox && (
        <form onSubmit={handleSaveSlot} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="text"
            value={savingName}
            onChange={e => setSavingName(e.target.value)}
            placeholder="Preset name (e.g. Stripe Backend Round)"
            maxLength={48}
            style={{
              flex: 1, height: 30, padding: '0 9px', borderRadius: 7,
              background: T.surface2, border: `1px solid ${T.accentBorder}`, color: T.text1, fontSize: 11.5, fontFamily: T.font,
            }}
          />
          <button
            type="submit"
            disabled={!savingName.trim()}
            style={{
              height: 30, padding: '0 11px', borderRadius: 7, border: 'none',
              background: savingName.trim() ? T.accent : T.surface2, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: T.font,
            }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => { setShowSaveBox(false); setSavingName('') }}
            style={{
              height: 30, padding: '0 9px', borderRadius: 7, border: `1px solid ${T.border}`,
              background: 'transparent', color: T.text3, fontSize: 11, cursor: 'pointer', fontFamily: T.font,
            }}
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  )
}
