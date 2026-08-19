// Solo (you-vs-AI) interview engine for the web app. Open-ended, speech-first,
// no difficulty knob — the interviewer calibrates to the target role.
import { completeJSON, visionComplete, extractJSON, streamText, pickFastProvider, pickStrongProvider, completeTextQuick } from './core.js'
import { analyze, BANNED_WORDS } from '../../shared/delivery.js'
import { glanceLayers, stripHintMeta } from '../../shared/hintLayers.js'
import { classifyTurn } from '../../shared/interviewClassify.js'
import {
  contextNeedsForScreenAnalysis,
  normalizeScreenContentType,
  toLegacyContentType,
  evaluateScreenRelevance,
  buildScreenContextBlock,
  SCREEN_CONTEXT_VERSION,
} from '../../shared/screenContext.js'
import { searchWeb, needsWebSearch } from './search.js'
import { getPlaybook, PLAYBOOK_BY_KEY, PLAYBOOK_REGISTRY_VERSION } from './playbooks.js'
import { CUSTOM_INSTRUCTIONS_PACK_MAX } from '../../shared/interviewConfig.js'

// Web-search grounding must NEVER stall an answer — above all a live streamed hint, where
// time-to-first-word is the whole product. Time-box the lookup: if it returns within budget we
// ground the answer in it; otherwise we start answering immediately (ungrounded) and drop the
// late result. Bounds worst-case TTFT to the budget instead of the search engine's 10s timeout.
// Live streaming is latency-critical → a tight search budget (grounding is a bonus, speed is not
// optional). Solo turns (blocking) can afford a little more since there's no token-by-token stream.
const SEARCH_BUDGET_MS = { stream: 1200, blocking: 2500 }
function groundedSearch(question, budgetMs) {
  const search = searchWeb(question, budgetMs).catch(() => null)   // swallow late/slow failures
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), budgetMs))
  return Promise.race([search, timeout])
}

// Answer verbosity — the "Concise / Balanced / Detailed" control. Concise = faster first word +
// fewer tokens + easier to glance at mid-call (Live); Detailed = fuller depth. Returns a prompt
// directive to append to the system message and a maxTokens cap relative to the caller's base.
function styleFor(style, baseTokens) {
  if (style === 'concise') return {
    directive: '\n\nLENGTH: Be CONCISE — lead with the direct answer in the first sentence, then at most two short supporting sentences. No preamble, no filler.',
    // Strong tier (base ≥900: coding / system-design) keeps room so a code block or design
    // walkthrough isn't hard-truncated; only the fast/simple tier gets the tight cap.
    maxTokens: Math.min(baseTokens, baseTokens >= 900 ? 650 : 380),
  }
  if (style === 'detailed') return {
    directive: '\n\nLENGTH: Be thorough — a complete, well-structured answer with specifics and concrete examples.',
    maxTokens: Math.max(baseTokens, 1100),
  }
  return { directive: '', maxTokens: baseTokens }   // balanced (default) — unchanged behavior
}

function profileBlock(p = {}) {
  let s = ''
  if (p.name) s += `\nCandidate name: ${p.name}`
  if (p.targetRole) s += `\nTarget role: ${p.targetRole}`
  if (p.targetCompany) s += `\nTarget company: ${p.targetCompany}`
  if (p.yearsExp) s += `\nExperience level: ${p.yearsExp}`
  if (p.resume) s += `\n\nResume:\n${String(p.resume).slice(0, 1800)}`
  if (p.jobDescription) s += `\n\nJob description:\n${String(p.jobDescription).slice(0, 1200)}`
  return s
}

const CONTEXT_PRECEDENCE =
  'CONTEXT PRECEDENCE (use only what is relevant to the CURRENT question; ignore the rest): '
  + '1) current question + conversation  2) screen evidence if present  '
  + '3) retrieved documents  4) resume/JD fact cards only when the ask is about you/the role  '
  + '5) never invent facts not present here.'

/**
 * Soft candidate context packer.
 * Classification budgets resume/JD size; it must not strip selected docs or force empty packs.
 * When opts.classification / opts.contextNeeds is omitted, keeps legacy Solo dump behavior.
 */
export function packCandidateContext(profile = {}, extraContext = '', opts = {}) {
  const needs = opts.contextNeeds
    || opts.classification?.contextNeeds
    // Legacy callers (Solo interviewer, old tests): keep prior dump behavior when no intent passed.
    || { identity: true, resume: 'full', jd: 'full', rag: true, customPrompt: true, codingLanguage: false, history: true }

  const extra = String(extraContext || '').trim()
  const hasRag = /RELEVANT FROM YOUR DOCUMENTS/i.test(extra)
  const parts = [CONTEXT_PRECEDENCE]

  if (needs.identity !== false) {
    const id = []
    if (profile.name) id.push(`Name: ${profile.name}`)
    if (profile.targetRole) id.push(`Target role: ${profile.targetRole}`)
    if (profile.targetCompany) id.push(`Target company: ${profile.targetCompany}`)
    if (profile.yearsExp) id.push(`Experience: ${profile.yearsExp}`)
    if (id.length) parts.push('CANDIDATE IDENTITY:\n' + id.join('\n'))
  }

  const resume = String(profile.resume || '').trim()
  const jd = String(profile.jobDescription || '').trim()
  const resumeMode = needs.resume || 'none'
  const jdMode = needs.jd || 'none'

  // Soft: always allow RAG/extra when present — never hard-veto selected materials.
  if (hasRag && extra) {
    parts.push(extra)
    if (resume && resumeMode !== 'none') {
      const cap = resumeMode === 'short' ? 500 : 800
      parts.push('RESUME FACT CARD (use only if relevant; do not invent; prefer retrieved docs when they conflict):\n' + resume.slice(0, cap))
    }
    if (jd && jdMode !== 'none') {
      const cap = jdMode === 'short' ? 400 : 500
      parts.push('JD CONTEXT (use only if relevant):\n' + jd.slice(0, cap))
    }
  } else {
    if (resume && resumeMode === 'full') {
      parts.push('CANDIDATE RESUME (ground truth — never invent beyond this):\n' + resume.slice(0, 3600))
    } else if (resume && resumeMode === 'short') {
      parts.push('RESUME FACT CARD (use only if the question is about the candidate — never invent):\n' + resume.slice(0, 600))
    }
    if (jd && jdMode === 'full') {
      parts.push('JOB DESCRIPTION (prioritize its skills when choosing examples/tools, but never claim experience absent from the resume):\n' + jd.slice(0, 2400))
    } else if (jd && jdMode === 'short') {
      parts.push('JD CONTEXT (use only if relevant):\n' + jd.slice(0, 400))
    }
    if (extra) parts.push(extra)
  }

  if (needs.customPrompt !== false && profile.customPrompt?.trim()) {
    // Product safety / playbooks stay in system; this is voice + emphasis only (budgeted).
    parts.push('CANDIDATE VOICE / INSTRUCTIONS (match this; never override honesty rules):\n'
      + String(profile.customPrompt).trim().slice(0, CUSTOM_INSTRUCTIONS_PACK_MAX))
  }
  if (needs.codingLanguage && (profile.codingLanguage || profile.language)) {
    parts.push('Coding language for solutions: ' + String(profile.codingLanguage || 'Python'))
  }
  return parts.filter(Boolean).join('\n\n')
}

const ANSWER_LOOP_RE = /\b(please\s+answer|go\s+ahead\s+and\s+answer|your\s+answer\s*(please)?|can\s+you\s+answer|answer\s+the\s+question|provide\s+your\s+answer|i('m| am)\s+waiting\s+for\s+your\s+answer)\b/i

function buildPrompt(config = {}, profile = {}, extraContext = '') {
  // Prefer packCandidateContext (RAG hierarchy + fact card) over a raw resume dump.
  const ctx = packCandidateContext(profile, extraContext) || profileBlock(profile)
  const hasResume = !!(profile.resume && String(profile.resume).trim().length > 40)
  const hasJd = !!(profile.jobDescription && String(profile.jobDescription).trim().length > 40)
  const hasRag = /RELEVANT FROM YOUR DOCUMENTS/i.test(String(extraContext || ''))
  const hasGrounding = hasResume || hasJd || hasRag
  const track = [config.domainLabel, config.roundLabel].filter(Boolean).join(' — ') || 'general interview'
  const depth = config.followupDepth
  const followLine = depth === 'light'
    ? 'After each answer, ask at most ONE brief follow-up, and only if it was unclear — otherwise move on.'
    : depth === 'deep'
      ? 'After each answer, ask 2–3 probing follow-ups, drilling into specifics (real numbers, the tradeoff they rejected, what broke, why not the alternative) before moving on.'
      : 'After each answer, you may ask 0–2 natural follow-ups (about reasoning, complexity, tradeoffs, or how it scales) before moving on.'

  const groundingRules = hasGrounding
    ? `
GROUNDING (mandatory — this is a practice interview for THIS candidate):
- Main questions (kind:"question") MUST reference something concrete from the resume, JD, and/or retrieved document snippets when provided (a project name, tech, metric, requirement, or responsibility). Do not ask generic bank questions that ignore their materials.
- Follow-ups (kind:"followup") MUST react to what the candidate just said — quote or paraphrase a detail they used — never jump to an unrelated topic until probes for the current beat are done.
- Prefer a natural conversation arc: open → 1–2 probes → next grounded topic. Vary openings; never sound like a quizmaster.
- Ban robotic filler: never say "please answer", "go ahead and answer", "your answer please", "can you answer that", or similar.`
    : `
GROUNDING:
- No resume/JD was provided — ask clear role-appropriate questions for the target role/company, still conversational (not quizmaster filler).`

  return `You are an experienced, professional interviewer running a REALISTIC mock interview so the candidate can practice as if it were real.

Interview track: ${track}
Calibrate difficulty yourself to the target role and the candidate's seniority (from their background) — interview them exactly as a real panel for that role and level would.
${config.focus ? `\n[Candidate's requested focus — shape questions around this, but never reveal answers or break character]\n"${String(config.focus).slice(0, 600)}"\n` : ''}${ctx ? `\n[Candidate background]${ctx}\n` : ''}${config.relentless ? `\n[RELENTLESS MODE] The moment an answer sounds rehearsed, generic, or buzzword-heavy, challenge it directly ("That sounds rehearsed — give me a concrete example from YOUR experience") and drill for specifics. Tough but respectful. Never reveal answers.\n` : ''}
${groundingRules}
HOW A REAL INTERVIEWER BEHAVES (follow strictly):
- Ask ONE question at a time. Never dump multiple questions at once.
- Stay within the interview track. ${followLine}
- Do NOT give the candidate the answer, hints, or coaching during the interview. Stay neutral.
- Briefly acknowledge ("Got it.", "Okay, makes sense.") then ask the next question or follow-up in the SAME turn when natural — never leave a dead "answer…" prompt with no question.
- Talk like a real human interviewer, not a script: contractions ("Let's", "Why'd you", "Tell me about a time"), natural phrasing, vary how you open each question. Warm but neutral — not robotic, not a quizmaster reading a list.
- Keep turns short and conversational, the way people actually speak.
- This is OPEN-ENDED: there is NO fixed number of questions. Do NOT end the interview yourself and do NOT give a closing line — the candidate ends it when ready. Always set "isComplete" to false; keep moving to new relevant areas.
- Optional: set "grounding" to a short label of what you anchored on (e.g. project name or JD skill), or null.

Respond with ONE valid JSON object and nothing else, no markdown fences:
{ "say": "<your spoken line — must include a real question or follow-up>", "kind": "question" | "followup", "questionNumber": <1-based integer of the current MAIN question>, "isComplete": false, "grounding": "<short label or null>" }`
}

export async function interviewerTurn({ config = {}, transcript = [], profile = {}, provider, language = 'English', extraContext = '' }) {
  // Only send recent turns to the model. An unbounded transcript over a long (20+ min)
  // session makes each request bigger and slower — raising latency, cost, and the chance
  // of provider overload/timeout (the "503" mid-interview). Recent context is what drives
  // follow-ups; the FULL transcript is still used for the end-of-session evaluation.
  const RECENT_TURNS = 40
  const recent = transcript.length > RECENT_TURNS ? transcript.slice(-RECENT_TURNS) : transcript
  const messages = recent.map(t => ({ role: t.role === 'interviewer' ? 'assistant' : 'user', content: t.text }))
  if (messages.length === 0) messages.push({ role: 'user', content: "I'm ready. Please begin the interview with your first question." })
  const langNote = language && language !== 'English' ? `\n\nConduct this interview entirely in ${language}.` : ''
  const lastInterviewer = [...recent].reverse().find(t => t.role === 'interviewer')?.text || ''
  // extraContext is folded into packCandidateContext inside buildPrompt (RAG hierarchy).

  const runOnce = async (extraSystem = '') => completeJSON({
    maxTokens: 700, provider,
    messages: [{ role: 'system', content: buildPrompt(config, profile, extraContext) + langNote + extraSystem }, ...messages]
  })

  let turn = await runOnce()
  // Guard: a model can return valid JSON that's missing "say" (off-schema). Surface it as a
  // retryable error — the client auto-retries + fails over — instead of a dead "Service error (200)".
  if (!turn || typeof turn.say !== 'string' || !turn.say.trim()) {
    const e = new Error('The interviewer glitched for a second — tap Continue again.'); e.status = 502; throw e
  }
  // Anti-loop: reject quizmaster filler / duplicate turns once with a stricter regen.
  const say = turn.say.trim()
  const loop = ANSWER_LOOP_RE.test(say) || (lastInterviewer && say.toLowerCase() === lastInterviewer.trim().toLowerCase())
  if (loop) {
    turn = await runOnce('\n\nREGEN: Your previous line was invalid (filler like "please answer" or a duplicate). Ask a concrete, conversational interview question grounded in the resume/JD if available. No filler.')
    if (!turn || typeof turn.say !== 'string' || !turn.say.trim() || ANSWER_LOOP_RE.test(turn.say)) {
      const e = new Error('The interviewer glitched for a second — tap Continue again.'); e.status = 502; throw e
    }
  }
  return turn
}

/** Normalize META-like fields + spoken prose into the UI hint shape (stream + JSON fallback share this). */
function normalizeHint(meta = {}, prose = '') {
  const cleaned = stripHintMeta(prose || meta.fullAnswer || meta.sampleAnswer || meta.answer || '')
  const m = { ...cleaned.meta, ...meta }
  const layers = glanceLayers(cleaned.prose, m)
  return {
    questionType: m.type || m.questionType || 'other',
    pattern: m.pattern || null,
    complexity: m.complexity || null,
    confidence: m.confidence === 'resume' ? 'resume' : 'general',
    resumeStory: m.resumeStory || null,
    opener: layers.opener,
    keyPoints: layers.keyPoints,
    sampleAnswer: layers.fullAnswer,
    fullAnswer: layers.fullAnswer,
    watchOut: m.watch || m.watchOut || layers.watchOut || null,
    ...(m.searchSources?.length ? { _searchSources: m.searchSources } : {}),
  }
}

// Thin export — implementation lives after playbooks/buildAnswerSystem (hoisted via function decl).
export async function generateHint(opts) {
  return generateHintImpl(opts)
}

// Re-export for tests / callers that want glance layers without the full engine.
export { glanceLayers } from '../../shared/hintLayers.js'

// ── Interview playbooks (modular registry) ───────────────────────────────────
// Classification lives in shared/interviewClassify.js; guides in playbooks.js.
// pickPlaybook remains the Live entry — first-match regex removed in favor of
// intent-ordered classifyTurn (specific > broad). PLAYBOOK_BY_KEY kept for tests.
export { PLAYBOOK_BY_KEY as PLAYBOOKS, PLAYBOOK_REGISTRY_VERSION }

/**
 * Resolve playbook for a question. Optional history/profile enable follow-ups + role routing.
 * @param {string} question
 * @param {object} [opts]
 */
export function pickPlaybook(question = '', opts = {}) {
  const classification = opts.classification || classifyTurn({
    question,
    profile: opts.profile,
    conversationHistory: opts.conversationHistory,
    lastClassification: opts.lastClassification,
    recentScreen: opts.recentScreen,
  })
  const pb = getPlaybook(classification.playbookKey)
  return { ...pb, classification }
}

function classificationBlock(c) {
  if (!c) return ''
  const bits = [
    `roleFamily=${c.roleFamily}`,
    `questionType=${c.questionType}`,
    `playbook=${c.playbookKey}`,
    `isFollowUp=${!!c.isFollowUp}`,
    c.parentType ? `parentType=${c.parentType}` : null,
    c.parentTopic ? `parentTopic=${String(c.parentTopic).slice(0, 120)}` : null,
    c.referencedConcept ? `ref=${c.referencedConcept}` : null,
    `classifier=${c.classifierVersion}`,
    `playbooks=${PLAYBOOK_REGISTRY_VERSION}`,
  ].filter(Boolean)
  return `\n\n[INTERNAL ROUTING — do not mention to the candidate: ${bits.join('; ')}]`
}

export function answerRequirementBlock(question = '', profile = {}) {
  const q = String(question || '')
  const rules = [
    'EVIDENCE: Resume is the only source for first-person work claims. JD describes desired skills, not candidate experience.',
    'If a requested skill is absent from the resume, say so briefly, then give a practical conceptual approach. Never fabricate hands-on use.',
    'FIT: For career/project questions, frame truthful resume evidence toward the JD priorities. For knowledge questions, answer the current question directly.',
  ]
  const wantsCode = /\b(write|show|give|provide|implement|code|function|script|pseudo[ -]?code)\b/i.test(q)
    && /\b(code|function|script|test|implementation|pseudo[ -]?code|python|javascript|typescript|java|sql)\b/i.test(q)
  if (wantsCode) rules.push('OUTPUT CONTRACT: The interviewer requested code. Put complete runnable code (or pseudocode only if explicitly allowed) first; keep explanation after it very short. Do not answer with explanation alone.')
  if (/\b(brief|briefly|short|concise|one line|quickly)\b/i.test(q)) {
    rules.push('OUTPUT CONTRACT: Keep the answer brief and direct.')
  }
  const explicitLanguage = q.match(/\b(Python|JavaScript|TypeScript|Java|SQL|C\+\+|C#|Go)\b/i)?.[1]
  if (explicitLanguage) rules.push(`LANGUAGE CONTRACT: Use ${explicitLanguage}; do not silently switch languages.`)
  else if (wantsCode && /\bJavaScript\b/i.test(String(profile.jobDescription || ''))) {
    rules.push('LANGUAGE CONTRACT: No language was explicitly chosen; prefer JavaScript because it is central to the target JD.')
  }
  return `\n\nCURRENT-TURN REQUIREMENTS:\n- ${rules.join('\n- ')}`
}

// BANNED_WORDS is imported from delivery.js (single source shared with the live coach).
const META_LINE = '1) FIRST LINE ONLY: a single-line VALID JSON object (every value a quoted string or null — no unquoted text), then a newline. Shape: META: {"type":"dsa|coding|technical|system_design|behavioral|resume|culture|intro|experience|follow_up|product|other","confidence":"resume|general","pattern":"<pattern name, or null>","complexity":"<e.g. O(n) time, O(1) space, or null>","watch":"<one specific mistake to avoid for THIS question, <=12 words>"}'

// Answer mode: shared spoken-style rules + ONLY the matched card's structure.
function buildAnswerSystem(language, guide) {
  return `You are an elite real-time interview copilot. The candidate reads your answer ALOUD as you stream it. Language: ${language}.

If the input is NOT a real interview question (greeting, filler, the candidate's own answer, background noise), output EXACTLY "[SKIP]" and nothing else.

Otherwise output, in this exact order:
${META_LINE}
2) Then a newline, then the answer. For coding requests, include a short practical approach followed by one COMPLETE runnable fenced code block in the requested language. For non-coding questions, return spoken prose with no markdown headers.
CRITICAL: Never repeat the META JSON (or any JSON) inside the answer. Code must never be emitted as loose plain-text lines.

SPOKEN STYLE (said out loud, not read): real-person contractions and connectors ("so", "honestly", "basically"); start mid-thought, never a textbook definition; plain words over jargon when possible; ALWAYS state the WHY / the trade-off, not just the what. Never use these AI-tell words: ${BANNED_WORDS}.

WHEN TO USE THE RESUME (critical — applies to EVERY question type):
- EXPERIENCE / behavioral / "tell me about a time" / project walkthrough → ground in the resume. NAME the project. Never invent tools or numbers not on it.
- SYSTEM DESIGN / DSA / coding / pure knowledge / "design X" / "what is X" / "how does Y work" → solve or explain what the interviewer ASKED. confidence:"general". Do NOT substitute a resume project for the asked topic. A one-line analogy at the end is optional; the body must answer the question asked.
- Wrong: interviewer asks to design a train booking system → you talk about your contact-center routing work.
- Right: design the train booking system; only then, optionally, "similar consistency tricks to what I used for …" if it truly fits.

Pick ONE option, don't list three ("I'd use X"). If they say "just tell me X", give only X. If it's a repeat, answer shorter.

FOR THIS EXACT QUESTION TYPE — follow this and nothing else:
${guide}`
}

// Coach mode: shared coaching framing + ONLY the matched card's label structure.
function buildCoachSystem(language, guide) {
  return `You are an elite interview COACH (not an answer key). Google/Amazon/Microsoft grade HOW the candidate solves — structuring thoughts out loud, trade-offs over brute force, clear naming, staying calm, and explaining the WHY — not just the final answer. So DO NOT give a finished answer to read. Give a glanceable STRUCTURE the candidate speaks in their OWN words. Language: ${language}.

If the input is NOT a real interview question, output EXACTLY "[SKIP]" and nothing else.

Otherwise output, in this exact order:
${META_LINE}
2) Then a newline, then a SCANNABLE guide using **bold labels** and short lines (never prose, never a script), following EXACTLY this label set and order:
${guide}

CRITICAL: Never repeat the META JSON (or any JSON) inside the guide. Labels + short lines only.
Keep every line short. Calm, confident framing. Never use these AI-tell words: ${BANNED_WORDS}.`
}

/** Prefer client-committed classification (one authority); otherwise classify here. */
function resolveTurnClassification({
  question,
  profile,
  conversationHistory,
  lastClassification,
  recentScreen,
  classification = null,
} = {}) {
  if (classification && classification.questionType && classification.classifierVersion) {
    return classification
  }
  return classifyTurn({
    question, profile, conversationHistory, lastClassification, recentScreen,
  })
}

// Streaming variant of generateHint — emits a one-line META header (badges/type/
// complexity/watch) then streams the SPOKEN answer prose token-by-token, so the UI
// shows words in <1s instead of waiting for a full JSON object. Outputs the sentinel
// [SKIP] when the input isn't a real interview question.
export async function streamHint({ question, profile = {}, conversationHistory = [], provider, language = 'English', extraContext = '', mode = 'answer', style = 'balanced', autoSkip = true, lastClassification = null, recentScreen = null, classification: clientClassification = null } = {}, { onMeta, onToken, onUsage, signal } = {}) {
  if (!question || !String(question).trim()) return { skipped: true }

  // Web-search grounding for company/product/current-events questions (same as generateHint).
  let searchSources = [], searchBlock = ''
  if (needsWebSearch(question)) {
    try {
      const results = await groundedSearch(question, SEARCH_BUDGET_MS.stream)
      if (results?.sources?.length) {
        searchSources = results.sources
        searchBlock = '\n\nLIVE WEB SEARCH RESULTS (ground the answer in these current facts):\n'
          + (results.answer ? `Summary: ${results.answer}\n\n` : '')
          + results.sources.map(s => `[${s.title}] ${s.snippet}`).join('\n\n')
      }
    } catch { /* search failure/timeout is non-fatal */ }
  }

  const classification = resolveTurnClassification({
    question, profile, conversationHistory, lastClassification, recentScreen,
    classification: clientClassification,
  })
  const relevance = evaluateScreenRelevance({ question, classification, screen: recentScreen })
  const screenBlock = relevance.attach ? buildScreenContextBlock(recentScreen) : ''
  // Soft: screen attach must not strip RAG / fact cards — only shrink full resume → short.
  let packClassification = classification
  if (relevance.attach) {
    const n = classification.contextNeeds || {}
    packClassification = {
      ...classification,
      contextNeeds: {
        ...n,
        resume: n.resume === 'full' ? 'short' : (n.resume || 'short'),
        codingLanguage: true,
      },
    }
  }
  const packed = packCandidateContext(profile, extraContext, { classification: packClassification })
  const historyBlock = conversationHistory.length
    ? '\n\nConversation so far (resolve "that"/"it"/"what you said" against this):\n' + conversationHistory.slice(-8).map(t => `${t.role.toUpperCase()}: ${String(t.text).slice(0, 300)}`).join('\n') : ''

  const pb = pickPlaybook(question, { classification })
  const baseSystem = mode === 'coach' ? buildCoachSystem(language, pb.coach) : buildAnswerSystem(language, pb.answer)
  const followParent = classification.isFollowUp && classification.parentTopic
    ? `\n\nParent topic for this follow-up: "${String(classification.parentTopic).slice(0, 240)}"${classification.parentType ? ` (prior type: ${classification.parentType})` : ''}`
    : ''
  const screenNote = screenBlock
    ? `\n\n${screenBlock}\n(Use the screen evidence above for the CURRENT question. Do not invent pixels. Follow CONTEXT PRECEDENCE in the candidate pack.)`
    : ''
  const user = `${packed ? packed + '\n\n' : ''}${historyBlock}${searchBlock}${followParent}${screenNote}\n\nCurrent question: "${String(question).slice(0, 800)}"`

  // HONOR THE USER'S EXPLICIT MODEL CHOICE. If they picked a model in the dropdown
  // (provider is a real id, not '' / 'auto'), use it for EVERY question — so choosing
  // Claude Opus actually gets you Opus, not gpt-4o-mini. Only when they leave it on
  // Auto do we escalate (fast model for simple Qs, strong for coding/system-design).
  const tier = pb.tier
  const escalateFast = pickFastProvider()
  const escalateStrong = pickStrongProvider()
  const userPicked = provider && provider !== 'auto'
  const chosen = userPicked ? provider : ((tier === 'strong' ? escalateStrong : escalateFast) || provider)

  // Apply the verbosity control on top of the tier's base budget.
  const { directive, maxTokens } = styleFor(style, (tier === 'strong' || mode === 'coach') ? 900 : 700)
  // Auto-skip OFF → force an answer for every input (override the [SKIP] instruction).
  const skipDirective = autoSkip ? '' : '\n\nALWAYS ANSWER: respond to every input — do NOT output [SKIP], even for small talk, filler, or a partial/unclear question. Do your best with what was said.'
  const system = baseSystem + directive + skipDirective + classificationBlock(classification)
    + answerRequirementBlock(question, profile)

  let buf = '', metaSent = false, skipped = false, proseEmitted = false
  const emitProse = t => { if (t) { proseEmitted = true; onToken?.(t) } }
  const routingExtra = {
    roleFamily: classification.roleFamily,
    questionType: classification.questionType,
    playbook: pb.key,
    playbookVersion: pb.version,
    isFollowUp: classification.isFollowUp,
    classifierVersion: classification.classifierVersion,
    screenAttached: relevance.attach,
    screenRelevance: relevance.reason,
    screenContextId: relevance.attach ? recentScreen?.screenContextId : null,
    screenContextVersion: SCREEN_CONTEXT_VERSION,
  }
  await streamText({
    provider: chosen, maxTokens,
    onUsage, signal,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    onToken: tok => {
      // After META is parsed, stream tokens as-is (client strips any trailing JSON leak).
      if (skipped) return
      if (metaSent === 'done') { emitProse(tok); return }
      buf += tok
      if (/^\s*\[SKIP\]/i.test(buf)) { skipped = true; return }
      if (buf.length < 6) return

      // Preferred format: META: {...}\nprose  — also bare leading JSON meta
      if (/^\s*META:/i.test(buf) || /^\s*\{/.test(buf) || /^\s*```/.test(buf)) {
        const stripped = stripHintMeta(buf)
        if (stripped.pending) return
        if (Object.keys(stripped.meta).length || /^\s*META:/i.test(buf) || /^\s*\{/.test(buf)) {
          if (searchSources.length) stripped.meta.searchSources = searchSources
          stripped.meta._routing = routingExtra
          onMeta?.(stripped.meta)
          metaSent = 'done'
          emitProse(stripped.prose)
          return
        }
      }

      // Model skipped META entirely — prose only
      onMeta?.({ ...(searchSources.length ? { searchSources } : {}), _routing: routingExtra })
      metaSent = 'done'
      emitProse(buf)
    }
  })
  if (skipped) return { skipped: true, classification, screenRelevance: relevance }
  // Stream ended while still buffering META / leading JSON
  if (metaSent !== 'done' && buf.trim()) {
    const stripped = stripHintMeta(buf)
    const meta = { ...stripped.meta, _routing: routingExtra }
    if (searchSources.length) meta.searchSources = searchSources
    onMeta?.(meta)
    emitProse(stripped.prose)
    return proseEmitted ? { skipped: false, searchSources, classification, screenRelevance: relevance } : { skipped: true, classification, screenRelevance: relevance }
  }
  if (metaSent !== 'done' || !proseEmitted) return { skipped: true, classification, screenRelevance: relevance }
  return { skipped: false, searchSources, classification, screenRelevance: relevance }
}


async function generateHintImpl({ question, profile = {}, conversationHistory = [], provider, language = 'English', extraContext = '', style = 'balanced', autoSkip = true, mode = 'answer', lastClassification = null, recentScreen = null, classification: clientClassification = null } = {}) {
  if (!question || !String(question).trim()) return null

  let searchSources = [], searchBlock = ''
  if (needsWebSearch(question)) {
    try {
      const results = await groundedSearch(question, SEARCH_BUDGET_MS.blocking)
      if (results?.sources?.length) {
        searchSources = results.sources
        searchBlock = '\n\nLIVE WEB SEARCH RESULTS (ground the answer in these current facts):\n'
          + (results.answer ? `Summary: ${results.answer}\n\n` : '')
          + results.sources.map(s => `[${s.title}] ${s.snippet}`).join('\n\n')
      }
    } catch { /* non-fatal */ }
  }

  const classification = resolveTurnClassification({
    question, profile, conversationHistory, lastClassification, recentScreen,
    classification: clientClassification,
  })
  const relevance = evaluateScreenRelevance({ question, classification, screen: recentScreen })
  const screenBlock = relevance.attach ? buildScreenContextBlock(recentScreen) : ''
  let packClassification = classification
  if (relevance.attach) {
    const n = classification.contextNeeds || {}
    packClassification = {
      ...classification,
      contextNeeds: {
        ...n,
        resume: n.resume === 'full' ? 'short' : (n.resume || 'short'),
        codingLanguage: true,
      },
    }
  }
  const pb = pickPlaybook(question, { classification })
  const baseSystem = mode === 'coach' ? buildCoachSystem(language, pb.coach) : buildAnswerSystem(language, pb.answer)
  const packed = packCandidateContext(profile, extraContext, { classification: packClassification })
  const historyBlock = conversationHistory.length
    ? '\n\nConversation so far (resolve "that"/"it" against this):\n' + conversationHistory.slice(-8).map(t => `${t.role.toUpperCase()}: ${String(t.text).slice(0, 300)}`).join('\n')
    : ''
  const followParent = classification.isFollowUp && classification.parentTopic
    ? `\n\nParent topic for this follow-up: "${String(classification.parentTopic).slice(0, 240)}"${classification.parentType ? ` (prior type: ${classification.parentType})` : ''}`
    : ''
  const screenNote = screenBlock
    ? `\n\n${screenBlock}\n(Use the screen evidence above for the CURRENT question. Do not invent pixels. Follow CONTEXT PRECEDENCE in the candidate pack.)`
    : ''
  const userPicked = provider && provider !== 'auto'
  const escalateFast = pickFastProvider()
  const escalateStrong = pickStrongProvider()
  const chosen = userPicked ? provider : ((pb.tier === 'strong' ? escalateStrong : escalateFast) || provider)
  const { directive } = styleFor(style, 700)
  const maxTokens = style === 'detailed' ? 1100 : (pb.tier === 'strong' || mode === 'coach') ? 900 : 700
  const skipDirective = autoSkip
    ? ''
    : '\n\nALWAYS ANSWER: respond to every input — do NOT skip, even for small talk or a partial question.'

  const schemaNote = `

OUTPUT FORMAT — return ONE JSON object only (no markdown fences):
${autoSkip ? '{ "skip": true } if this is NOT an interview question, OR ' : ''}{
  "type": "dsa|coding|technical|system_design|behavioral|resume|culture|intro|experience|follow_up|product|other",
  "confidence": "resume|general",
  "pattern": "<pattern or null>",
  "complexity": "<complexity or null>",
  "watch": "<one short mistake to avoid or null>",
  "keyPoints": ["<short beat 1>", "<beat 2>", "<beat 3>"],
  "fullAnswer": "<the spoken answer / coach guide — same rules as streaming prose above>"
}`

  const hint = await completeJSON({
    maxTokens, provider: chosen,
    messages: [
      { role: 'system', content: baseSystem + directive + skipDirective + classificationBlock(classification) + answerRequirementBlock(question, profile) + schemaNote },
      { role: 'user', content: `${packed ? packed + '\n\n' : ''}${historyBlock}${searchBlock}${followParent}${screenNote}\n\nCurrent question: "${String(question).slice(0, 800)}"` },
    ],
  })

  if (hint?.skip) return null
  if (searchSources.length) hint.searchSources = searchSources
  const prose = hint.fullAnswer || hint.sampleAnswer || hint.answer || ''
  if (!String(prose).trim()) return null
  const normalized = normalizeHint(hint, prose)
  normalized._routing = {
    roleFamily: classification.roleFamily,
    questionType: classification.questionType,
    playbook: pb.key,
    playbookVersion: pb.version,
    isFollowUp: classification.isFollowUp,
    classifierVersion: classification.classifierVersion,
    screenAttached: relevance.attach,
    screenRelevance: relevance.reason,
    screenContextId: relevance.attach ? recentScreen?.screenContextId : null,
    screenContextVersion: SCREEN_CONTEXT_VERSION,
  }
  return normalized
}


export async function evaluateSolo({ config = {}, transcript = [], profile = {}, provider }) {
  const candidateText = transcript.filter(t => t.role === 'candidate').map(t => t.text).join('\n')
  const delivery = analyze(candidateText)
  const convo = transcript.map(t => `${t.role === 'interviewer' ? 'INTERVIEWER' : 'CANDIDATE'}: ${t.text}`).join('\n\n')
  const track = [config.domainLabel, config.roundLabel].filter(Boolean).join(' — ') || 'interview'

  const system = `You are a fair but rigorous interview evaluator. Score the candidate's performance in this ${track} mock interview at the level expected for the target role, the way a real hiring panel would. Be honest and specific.
${profileBlock(profile)}
GROUND EVERYTHING IN THE TRANSCRIPT — this is the most important rule:
- Every score, strength, and improvement must be based ONLY on what the candidate ACTUALLY said. Reference or paraphrase their specific answers.
- Do NOT invent strengths they didn't show or critique things they were never asked. No generic filler praise.
- If they barely answered, gave one-word replies, or dodged, score LOW and say so plainly — a kind but useless score helps no one.
- The point is honest practice feedback they can act on, not encouragement.
Return ONE JSON object, no prose:
{ "overallScore": <0-100 integer>, "verdict": "Strong Hire" | "Hire" | "Lean Hire" | "Lean No Hire" | "No Hire",
  "dimensions": [ { "name": "<dimension>", "score": <0-5>, "comment": "<specific>" } ],
  "strengths": [ "<bullet>" ], "improvements": [ "<actionable bullet>" ],
  "delivery": { "tip": "<one delivery change for next time>" },
  "summary": "<3-5 sentences; the single most important thing to improve next>" }`
  const report = await completeJSON({
    maxTokens: 2600, provider,
    messages: [{ role: 'system', content: system }, { role: 'user', content: `Transcript:\n${convo}` }]
  })
  report._delivery = delivery
  return report
}

export async function analyzeScreen({
  imageBase64, profile = {}, language, style = 'balanced', mime,
  spokenQuestion = '', contentTypeHint = '',
  previousScreen = null,
  continuationMode = 'auto',
  useSpokenContext = false,
  requestId = '', fingerprint = '', imageDimensions = null, signal,
  _visionCall = visionComplete, _textCall = completeTextQuick,
} = {}) {
  if (!imageBase64) { const e = new Error('No screenshot captured. Try the capture shortcut again.'); e.status = 400; e.code = 'SCREEN_EMPTY'; throw e }
  let b64 = String(imageBase64)
  let imageMime = mime || 'image/png'
  if (b64.startsWith('data:')) {
    const m = b64.match(/^data:([^;]+);base64,(.+)$/s)
    if (m) { imageMime = m[1]; b64 = m[2] }
  }
  if (!b64.trim()) { const e = new Error('Empty screenshot — recapture with F7 / Ctrl+Shift+U.'); e.status = 400; e.code = 'SCREEN_EMPTY'; throw e }

  // Explicit capture solves the new screen. The most recent STT question often
  // belongs to the previous turn, so it must not silently hijack F7. Callers may
  // opt in only when they know the speech and image belong to the same turn.
  const spoken = useSpokenContext === true ? String(spokenQuestion || '').trim() : ''
  const needs = contextNeedsForScreenAnalysis({ spokenQuestion: spoken, profile, contentTypeHint })
  const packed = packCandidateContext(profile, '', { contextNeeds: needs })
  const codeLang = language || profile.codingLanguage || 'Python'
  const fast = style === 'concise'
  const rid = requestId || `scr_${Date.now().toString(36)}`
  const previous = previousScreen?.detectedText ? {
    screenContextId: String(previousScreen.screenContextId || '').slice(0, 120),
    detectedText: String(previousScreen.detectedText || '').slice(0, 6000),
    contentType: String(previousScreen.contentType || '').slice(0, 40),
    screenFamily: String(previousScreen.screenFamily || '').slice(0, 40),
    language: String(previousScreen.language || '').slice(0, 40),
    fullAnswer: String(previousScreen.fullAnswer || '').slice(0, 1200),
    captureCount: Math.max(1, Number(previousScreen.captureCount) || 1),
  } : null

  const prompt = `You are a private interview coach analyzing a screenshot taken during a live interview.
${packed ? `\n${packed}\n` : ''}
${spoken ? `\nRECENT SPOKEN CONTEXT (secondary evidence only; speech recognition may be incomplete or wrong):\n"${spoken.slice(0, 500)}"\nUse it only when it clearly matches the visible screen. Never let garbled or unrelated speech override a readable question on screen.\n` : ''}
${previous ? `\nPOSSIBLE PREVIOUS SCREENSHOT FROM THE SAME LONG QUESTION:\n${JSON.stringify(previous)}\n${continuationMode === 'continue' ? 'The user explicitly selected CONTINUE QUESTION. Treat the new screenshot as the next portion, set isContinuation=true, merge both parts into detectedText, and regenerate one complete answer.' : 'First decide whether the NEW screenshot is clearly a continuation of that question. A continuation can show the next paragraph, constraints, examples, or the lower half of the same coding task even with little exact text overlap. If related, set isContinuation=true, merge both parts into detectedText, and regenerate one complete answer from the combined question. If it is a different question/page/task, set isContinuation=false and ignore the previous answer. Never join merely because captures are consecutive.'}\n` : ''}
This is an explicit user-triggered screen capture. First identify what is actually on screen. If a readable question or task is visible, answer THAT visible question directly and treat it as the primary ask. Only fall back to recent spoken context when the screen has no actionable question. Then give guidance the candidate can use RIGHT NOW.

CONTENT TYPE — pick the best match:
"coding" | "system_design" | "behavioral" | "slide" | "other"
(optional finer hint via keyPoints[0] prefix ok, but contentType must be one of those five)

STRATEGY BY TYPE (apply ONLY the matching branch — do NOT force HLD or STAR on everything):
- coding: approach steps, working code, complexity, edge cases. Narrow if the spoken question asks for one thing (e.g. bug only → focus on the bug).
- system_design (diagram/architecture): components, relationships, issues, tradeoffs relevant to what is shown. Do NOT dump a full FR→NFR→API scaffold unless the spoken question asks for a full design.
- behavioral: STAR ONLY if the screen/spoken ask is about experience; ground resume hooks ONLY from provided candidate context — never invent.
- slide: extract the visible question/topic + talking points.
- other (doc/ui/spreadsheet/unknown): extract visible info and answer the spoken question if any; otherwise concise observations.

NEVER FABRICATE candidate experience. Never claim tools/projects not in candidate context.
Prefer answering the visible question/task. Do not return a relevance warning when the screen itself contains a clear, answerable question.

For CODING problems:
- ${language ? `EXPLICIT USER LANGUAGE OVERRIDE: Write the entire solution in ${codeLang}. Ignore any different language shown or requested in the screenshot; the user deliberately switched languages. Set "language" to exactly "${codeLang}".` : `Write the solution in ${codeLang} unless the visible task explicitly requires another language.`}
- "code" = COMPLETE runnable solution with signature — raw code, NO markdown fences.
- "approach" = 3-5 short steps; "edgeCases" = specific edges to mention.

BANNED WORDS: ${BANNED_WORDS}.
Sound like a real engineer — natural, not textbook.

Return ONE JSON object, no markdown:
{
  "contentType": "coding" | "system_design" | "behavioral" | "slide" | "other",
  "screenFamily": "screen_code|screen_diagram|screen_document|screen_spreadsheet|screen_ui|screen_slide|screen_text|screen_unknown",
  "detectedText": "<main visible question or text>",
  "isContinuation": <true only when this continues the supplied previous screenshot, otherwise false>,
  "pattern": "<coding only, else null>",
  "complexity": "<coding only, else null>",
  "language": "<coding language or null>",
  "approach": ["<step>"],
  "code": "<raw code or null>",
  "edgeCases": ["<edge>"],
  "confidence": "resume" | "general",
  "resumeStory": "<behavioral+resume match only, else null>",
  "keyPoints": ["<short>", "<short>", "<short>"],
  "fullAnswer": "<3-6 spoken sentences scoped to the ask>",
  "watchOut": "<one mistake to avoid>"
}`

  const faster = fast ? '\n\nFASTER MODE: Lead with the answer/solution first. Keep prose minimal.' : ''
  // ONE image-analysis call (with provider failover inside visionComplete). Repair is text-only.
  const raw = await _visionCall({
    // "auto" is supported across OpenAI-compatible gateways and lets each
    // provider balance OCR quality, latency, and token cost.
    imageBase64: b64, mime: imageMime, detail: 'auto',
    prompt: prompt + faster, maxTokens: fast ? 1400 : 1500,
    requestId: rid, fingerprint: fingerprint || undefined,
    imageDimensions, signal,
  })
  let out
  try {
    out = extractJSON(raw)
  } catch {
    const fixed = await _textCall({
      prompt: 'Convert the following into ONE valid JSON object matching the screen-analysis schema (contentType, screenFamily, detectedText, keyPoints, fullAnswer, code, approach, edgeCases, etc). Output ONLY JSON, no markdown.\n\n' + String(raw || '').slice(0, 8000),
      maxTokens: 1500,
      signal,
      requestId: rid,
    })
    out = extractJSON(fixed)
  }
  // Language tabs are an explicit transform command. Vision models sometimes cling
  // to the language visible in the screenshot, so enforce the selected language with
  // a text-only rewrite (no second screenshot/vision call).
  if (language && out && normalizeScreenContentType(out.screenFamily || out.contentType) === 'screen_code') {
    const rewritten = await _textCall({
      prompt: `Rewrite this coding-solution JSON so the complete runnable code is in ${codeLang}.
The user explicitly selected ${codeLang}; ignore any other language in the screenshot or existing solution.
Preserve the detected problem, algorithm, complexity, approach, edge cases, and watch-out.
Set "language" to exactly "${codeLang}". Return ONE valid JSON object only, no markdown fences.

${JSON.stringify(out).slice(0, 10000)}`,
      maxTokens: 1500,
      signal,
      requestId: `${rid}_lang`,
    })
    out = extractJSON(rewritten)
    out.language = codeLang
  }
  if (out && typeof out.code === 'string') {
    out.code = out.code.replace(/^\s*```[a-zA-Z0-9+#]*\n?/, '').replace(/\n?```\s*$/, '').trim()
  }
  if (out) {
    const family = normalizeScreenContentType(out.screenFamily || out.contentType)
    out.screenFamily = family
    out.contentType = toLegacyContentType(family)
    out._screenContextVersion = SCREEN_CONTEXT_VERSION
    out._screenRequestId = rid
    const providerContinuation = /^(true|yes|1)$/i.test(String(out.isContinuation ?? '').trim())
    out.isContinuation = previous ? (continuationMode === 'continue' || providerContinuation) : false
    if (out.isContinuation) out.continuationOf = previous.screenContextId || null
  }
  return out
}
