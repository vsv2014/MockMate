// Solo (you-vs-AI) interview engine for the web app. Open-ended, speech-first,
// no difficulty knob — the interviewer calibrates to the target role.
import { completeJSON, visionComplete, extractJSON, streamText, pickFastProvider, pickStrongProvider } from './core.js'
import { analyze, BANNED_WORDS } from '../../shared/delivery.js'
import { glanceLayers } from '../../shared/hintLayers.js'
import { searchWeb, needsWebSearch } from './search.js'

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

/** Short identity + resume/JD with hierarchy. When RAG chunks are present, skip stuffing a long resume. */
export function packCandidateContext(profile = {}, extraContext = '') {
  const extra = String(extraContext || '').trim()
  const hasRag = /RELEVANT FROM YOUR DOCUMENTS/i.test(extra)
  const parts = []
  const id = []
  if (profile.name) id.push(`Name: ${profile.name}`)
  if (profile.targetRole) id.push(`Target role: ${profile.targetRole}`)
  if (profile.targetCompany) id.push(`Target company: ${profile.targetCompany}`)
  if (profile.yearsExp) id.push(`Experience: ${profile.yearsExp}`)
  if (id.length) parts.push('CANDIDATE IDENTITY:\n' + id.join('\n'))

  if (hasRag) {
    // Source hierarchy: retrieved docs first, then a short resume fact card (not the full dump).
    parts.push(extra)
    const resume = String(profile.resume || '').trim()
    if (resume) parts.push('RESUME FACT CARD (do not invent beyond this; prefer retrieved docs above when they conflict):\n' + resume.slice(0, 800))
    const jd = String(profile.jobDescription || '').trim()
    if (jd) parts.push('JD CONTEXT:\n' + jd.slice(0, 500))
  } else {
    const resume = String(profile.resume || '').trim()
    if (resume) parts.push('CANDIDATE RESUME (ground truth — never invent beyond this):\n' + resume.slice(0, 1800))
    const jd = String(profile.jobDescription || '').trim()
    if (jd) parts.push('JOB DESCRIPTION:\n' + jd.slice(0, 900))
    if (extra) parts.push(extra)
  }
  if (profile.customPrompt?.trim()) {
    parts.push('CANDIDATE VOICE / INSTRUCTIONS (match this):\n' + String(profile.customPrompt).trim().slice(0, 800))
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
  const layers = glanceLayers(prose || meta.fullAnswer || meta.sampleAnswer || meta.answer || '', meta)
  return {
    questionType: meta.type || meta.questionType || 'other',
    pattern: meta.pattern || null,
    complexity: meta.complexity || null,
    confidence: meta.confidence === 'resume' ? 'resume' : 'general',
    resumeStory: meta.resumeStory || null,
    opener: layers.opener,
    keyPoints: layers.keyPoints,
    sampleAnswer: layers.fullAnswer,
    fullAnswer: layers.fullAnswer,
    watchOut: meta.watch || meta.watchOut || null,
    ...(meta.searchSources?.length ? { _searchSources: meta.searchSources } : {}),
  }
}

// Thin export — implementation lives after playbooks/buildAnswerSystem (hoisted via function decl).
export async function generateHint(opts) {
  return generateHintImpl(opts)
}

// Re-export for tests / callers that want glance layers without the full engine.
export { glanceLayers } from '../../shared/hintLayers.js'

// ── Interview playbooks ──────────────────────────────────────────────────────
// One "card" per question archetype: how to DETECT it (match), which model TIER it
// deserves, and the type-specific structure for ANSWER mode and COACH mode. The
// prompt builder injects ONLY the matched card — so each answer stays focused, rules
// never collide, and adding new interview wisdom = adding one card here (not editing
// a giant prompt). Order matters: first match wins; `general` is the catch-all last.
const PLAYBOOKS = [
  {
    key: 'project_walkthrough', tier: 'strong',
    match: /\b(walk me through|end.?to.?end|deep.?dive|project you (built|led|worked|shipped)|tell me about (a|your).{0,18}(project|system you built|service you built)|something you built|most (challenging|complex) project)\b/i,
    answer: 'Narrate END-TO-END: context + scale (why it mattered) → what YOU owned (say "I", not "we") → the architecture and the 1-2 key technical decisions and WHY → the hardest trade-off/challenge and how you resolved it → measurable impact (numbers) + what you would do differently. Ground every detail in the resume. 5-7 spoken sentences.',
    coach: '**Context:** the problem + scale in one line (why it mattered).\n**Your role:** what YOU owned — say "I", not "we".\n**Architecture:** the design + the 1-2 key technical decisions and why.\n**Trade-offs:** the hard call made and what was given up.\n**Challenge:** the toughest problem and how it was cracked.\n**Impact:** measurable result (numbers) + what you would do differently.'
  },
  {
    key: 'system_design', tier: 'strong',
    match: /\b(system design|design (a|an|the)|architect|scal|throughput|load.?balanc|shard|partition|replicat|distributed|micro.?service|\bcdn\b|consistency|cap theorem|\bsql\b|nosql|kafka|rabbitmq)\b/i,
    answer: 'SYSTEM DESIGN — never start designing blind. ALWAYS open by asking 1-2 sharp scoping questions out loud (scale / QPS, read-vs-write ratio, consistency vs availability, key use cases), then state your assumptions. Then, in 4-6 spoken sentences: the data-store choice and WHY, the key components, and the MAIN trade-off — conversationally, not a lecture.',
    coach: '**Clarify:** scope questions to ask (QPS, read/write ratio, consistency vs availability).\n**Scale:** which of horizontal-vs-vertical, load balancing, caching, sharding apply here.\n**Data:** SQL vs NoSQL + why; indexing / partitioning / replication if relevant.\n**Components:** the queues / caches / CDN to mention + one concrete trade-off (e.g. Kafka vs RabbitMQ).\n**Trade-offs:** the 1-2 trade-offs to verbalize — this is what is actually graded.'
  },
  {
    key: 'dsa', tier: 'strong',
    match: /\b(algorithm|complexity|big[- ]?o|dynamic programming|\bdp\b|recursion|binary search|two pointers|sliding window|\bbfs\b|\bdfs\b|leetcode|subarray|substring|linked list|\bgraph\b|\btree\b|\bheap\b|\barray\b|hashmap|optimi[sz]e|time limit)\b/i,
    answer: 'CODING/DSA — NEVER jump straight to code; that is the biggest red flag. ALWAYS open by asking the 1-2 SHARPEST clarifying questions out loud (sorted? duplicates? input size / expected complexity? 4 or 8 directions? in-place?) — one or two sharp ones, not a barrage — then state the assumption you will go with. Next, in 2-3 spoken sentences: name the PATTERN and why it fits, the brute-force + its complexity, then the OPTIMAL approach with its time/space complexity and WHY it actually works (the key insight/invariant — not just the steps), and the main edge cases. THEN give the FULL, correct, runnable solution in a fenced ``` code block — default to Python unless the candidate\'s language is set otherwise — clean code in one go.',
    coach: '**Clarify:** 1-2 sharp questions to ask first (sorted? duplicates? input size? directions?).\n**Pattern:** name it (sliding window / BFS / DP-…) and why it fits.\n**Approach:** brute-force in one line + its complexity → optimal + its time/space complexity.\n**Why it works:** the key insight/invariant to say out loud (and the trade-off, e.g. BFS vs DFS, HashMap vs Set).\n**Edge cases:** the 2-3 to mention before coding.\n**Clean code:** name things clearly; default Python.'
  },
  {
    key: 'company', tier: 'fast',
    match: /\b(why (do you want to work|us\b|this company|here\b|join)|what do you know about (us|the company|our)|our (product|mission|company|team))\b/i,
    answer: 'Ground in the LIVE WEB SEARCH facts. Tie 1-2 SPECIFIC, current facts about the company/product to your own experience or goals. Genuine and specific — never generic flattery. 2-4 sentences.',
    coach: '**Hook:** one specific, current fact about the company/product (from the search results).\n**Fit:** connect that fact to YOUR experience or goal.\n**Why now:** a sincere, specific reason — not generic.'
  },
  {
    key: 'behavioral', tier: 'fast',
    match: /\b(tell me about a time|describe a (situation|time)|conflict|disagree|weakness|strength|failure|mistake|proud|gave feedback|leadership|missed a deadline|under pressure)\b/i,
    answer: 'Open with a SPECIFIC project from the resume, light STAR shape, first person, conversational. Surface ownership — say "I", quantify the result. Set confidence:"resume" when grounded in the resume. 3-5 sentences.',
    coach: '**STAR:** Situation / Task / Action / Result as four short bullets pulled from the resume — points to expand in their own words, never a script.\n**Signal:** the ownership/leadership trait to surface (say "I", quantify the result).'
  },
  {
    // Pure technical / conceptual knowledge ("what is X", "explain Y", "difference
    // between A and B"). Must come AFTER dsa/system_design so real coding problems still
    // get those cards, but BEFORE the general catch-all so concept questions are NOT
    // resume-grounded. Answer from general knowledge, confidence:"general".
    key: 'technical', tier: 'fast',
    match: /\b(what(?:'s| is| are| does| do)|explain|describe what|difference between|differ(?:ence)?|define|pros and cons|trade.?offs? between|when (?:would|should|do) you use|why (?:do we|use|is|are)|what happens (?:when|if)|how does .* work)\b/i,
    answer: 'PURE KNOWLEDGE question — answer from GENERAL technical knowledge, NOT the resume. Do NOT name a personal project, do NOT say "in our project", do NOT invent experience. confidence MUST be "general". In 2-4 spoken sentences: the precise answer, the WHY / mechanism underneath, and the one trade-off or gotcha that signals real depth. Be concrete and correct over broad.',
    coach: '**Concept:** the precise definition in one line.\n**Why/mechanism:** what is actually happening under the hood.\n**Trade-off / gotcha:** the subtle point that signals depth.'
  },
  {
    key: 'general', tier: 'fast',
    match: /.*/,
    answer: 'Answer directly in 2-3 spoken sentences. If the question is about the candidate\'s own experience, ground it in the resume; if it is a general/knowledge question, answer from general knowledge and set confidence:"general" — do NOT force a resume reference. State the reasoning behind your take.',
    coach: '**Frame:** restate what they are really asking, in one line.\n**Point:** the 2-3 key things to say.\n**Why:** the reasoning behind your take.'
  }
]

// First matching card wins (general is the catch-all). Zero added latency — pure regex.
export function pickPlaybook(question = '') {
  for (const pb of PLAYBOOKS) if (pb.match.test(question)) return pb
  return PLAYBOOKS[PLAYBOOKS.length - 1]
}

// BANNED_WORDS is imported from delivery.js (single source shared with the live coach).
const META_LINE = '1) FIRST LINE ONLY: a single-line VALID JSON object (every value a quoted string or null — no unquoted text), then a newline. Shape: META: {"type":"dsa|coding|technical|system_design|behavioral|resume|culture|other","confidence":"resume|general","pattern":"<pattern name, or null>","complexity":"<e.g. O(n) time, O(1) space, or null>","watch":"<one specific mistake to avoid for THIS question, <=12 words>"}'

// Answer mode: shared spoken-style rules + ONLY the matched card's structure.
function buildAnswerSystem(language, guide) {
  return `You are an elite real-time interview copilot. The candidate reads your answer ALOUD as you stream it. Language: ${language}.

If the input is NOT a real interview question (greeting, filler, the candidate's own answer, background noise), output EXACTLY "[SKIP]" and nothing else.

Otherwise output, in this exact order:
${META_LINE}
2) Then a newline, then the SPOKEN answer prose (no markdown headers).

SPOKEN STYLE (said out loud, not read): real-person contractions and connectors ("so", "honestly", "basically", "what I did was"); start mid-thought, never a textbook definition; 2-4 sentences then STOP — don't keep teaching; plain words, not jargon ("response time" not "latency"); ALWAYS state the WHY / the trade-off, not just the what. Never use these AI-tell words: ${BANNED_WORDS}.

GROUND IN THE CANDIDATE (critical — they're reading this as their OWN work):
- The RESUME is the only source of truth — NEVER invent tools, numbers, projects, or features that aren't in it. If asked about something not on it: "honestly haven't used that directly, but I'd approach it by…" then the closest real thing from the resume. Never fake expertise.
- For EXPERIENCE / behavioral answers, NAME the specific project and open with it ("In our <project>, what we did was…"). But for a PURE KNOWLEDGE / conceptual question (what is X, explain Y, difference between A and B), answer from general knowledge and do NOT force a project reference or resume grounding.
- Keep numbers messy and human ("around 0.8-ish, I'd have to check") — never clean, fabricated-sounding ranges.
- Pick ONE option, don't list three ("I'd use X"). If they say "just tell me X", give only X. If it's a repeat, answer shorter.

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

Keep every line short. Calm, confident framing. Never use these AI-tell words: ${BANNED_WORDS}.`
}

// Streaming variant of generateHint — emits a one-line META header (badges/type/
// complexity/watch) then streams the SPOKEN answer prose token-by-token, so the UI
// shows words in <1s instead of waiting for a full JSON object. Outputs the sentinel
// [SKIP] when the input isn't a real interview question.
export async function streamHint({ question, profile = {}, conversationHistory = [], provider, language = 'English', extraContext = '', mode = 'answer', style = 'balanced', autoSkip = true } = {}, { onMeta, onToken, onUsage, signal } = {}) {
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

  const packed = packCandidateContext(profile, extraContext)
  const historyBlock = conversationHistory.length
    ? '\n\nConversation so far (resolve "that"/"it"/"what you said" against this):\n' + conversationHistory.slice(-8).map(t => `${t.role.toUpperCase()}: ${String(t.text).slice(0, 300)}`).join('\n') : ''

  // Pick the ONE playbook for this question and inject only its structure — focused
  // prompt = the model follows it far more reliably than one giant all-types prompt.
  const pb = pickPlaybook(question)
  const baseSystem = mode === 'coach' ? buildCoachSystem(language, pb.coach) : buildAnswerSystem(language, pb.answer)
  const user = `${packed ? packed + '\n\n' : ''}${historyBlock}${searchBlock}\n\nCurrent question: "${String(question).slice(0, 800)}"`

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
  const system = baseSystem + directive + skipDirective

  let buf = '', metaSent = false, skipped = false, proseEmitted = false
  const emit = t => { if (t) { proseEmitted = true; onToken?.(t) } }   // track that real answer text went out
  await streamText({
    provider: chosen, maxTokens,
    onUsage, signal,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    onToken: tok => {
      if (skipped || metaSent === 'done') { if (metaSent === 'done') emit(tok); return }
      buf += tok
      if (/^\s*\[SKIP\]/i.test(buf)) { skipped = true; return }
      if (buf.length < 6) return                       // wait to rule out "[SKIP]"/"META:"
      if (/^\s*META:/i.test(buf)) {
        const nl = buf.indexOf('\n')
        if (nl === -1) return                          // still buffering the META line
        let meta = {}
        const mm = buf.slice(0, nl).match(/\{[\s\S]*\}/)
        if (mm) { try { meta = JSON.parse(mm[0]) } catch {} }
        if (searchSources.length) meta.searchSources = searchSources
        onMeta?.(meta)
        metaSent = 'done'
        emit(buf.slice(nl + 1).replace(/^\s+/, ''))
      } else {
        // Model skipped the META format — treat everything as prose.
        onMeta?.(searchSources.length ? { searchSources } : {})
        metaSent = 'done'
        emit(buf)
      }
    }
  })
  if (skipped) return { skipped: true }
  // Stream ended without a clean META+newline (e.g. model omitted the newline, or got cut
  // off mid-META). Emit meta + prose WITHOUT leaking the raw "META: {…}" line to the user.
  if (metaSent !== 'done' && buf.trim()) {
    let meta = searchSources.length ? { searchSources } : {}
    let prose = buf
    const m = buf.match(/^\s*META:\s*(\{[\s\S]*?\})?\s*([\s\S]*)$/i)
    if (m) {
      if (m[1]) { try { meta = { ...JSON.parse(m[1]), ...(searchSources.length ? { searchSources } : {}) } } catch {} }
      prose = (m[2] || '').replace(/^\s+/, '')
    }
    onMeta?.(meta)
    emit(prose.trim() ? prose : '')
    return proseEmitted ? { skipped: false, searchSources } : { skipped: true }
  }
  // Model streamed nothing usable — either no META at all, OR a META header with zero answer
  // prose after it. Either way treat as a skip so the client shows nothing (and can retry)
  // instead of a `done` event with badges but a blank answer body.
  if (metaSent !== 'done' || !proseEmitted) return { skipped: true }
  return { skipped: false, searchSources }
}


async function generateHintImpl({ question, profile = {}, conversationHistory = [], provider, language = 'English', extraContext = '', style = 'balanced', autoSkip = true, mode = 'answer' } = {}) {
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

  const pb = pickPlaybook(question)
  const baseSystem = mode === 'coach' ? buildCoachSystem(language, pb.coach) : buildAnswerSystem(language, pb.answer)
  const packed = packCandidateContext(profile, extraContext)
  const historyBlock = conversationHistory.length
    ? '\n\nConversation so far (resolve "that"/"it" against this):\n' + conversationHistory.slice(-8).map(t => `${t.role.toUpperCase()}: ${String(t.text).slice(0, 300)}`).join('\n')
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
  "type": "dsa|coding|technical|system_design|behavioral|resume|culture|other",
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
      { role: 'system', content: baseSystem + directive + skipDirective + schemaNote },
      { role: 'user', content: `${packed ? packed + '\n\n' : ''}${historyBlock}${searchBlock}\n\nCurrent question: "${String(question).slice(0, 800)}"` },
    ],
  })

  if (hint?.skip) return null
  if (searchSources.length) hint.searchSources = searchSources
  const prose = hint.fullAnswer || hint.sampleAnswer || hint.answer || ''
  if (!String(prose).trim()) return null
  return normalizeHint(hint, prose)
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

export async function analyzeScreen({ imageBase64, profile = {}, language, style = 'balanced' }) {
  if (!imageBase64) { const e = new Error('No screenshot captured. Try the capture shortcut again.'); e.status = 400; throw e }
  const ctx = profileBlock(profile)
  const codeLang = language || profile.codingLanguage || 'Python'
  // "Faster Screenshot Replies": concise → answer-first, minimal prose, tighter token budget.
  // (Code solutions still get room — the cap only trims the surrounding explanation.)
  const fast = style === 'concise'

  const prompt = `You are a private interview coach analyzing a screenshot taken during a live interview.
${ctx ? `\nCandidate background:\n${ctx}\n` : ''}
Identify what is on screen and generate instant guidance the candidate can use RIGHT NOW.

Rules:
- coding/algorithm problem → identify the pattern, give a full WORKING code solution + approach + complexity + edge cases
- system design question → framework: requirements → scale → components → trade-off
- behavioral/HR question → STAR scaffold + resume hook ONLY from real experience in the profile
- slide/presentation → extract the key question or topic and give talking points

NEVER FABRICATE: if the screen references a tool, tech, or project NOT in the candidate's profile, do not claim they used it — answer the concept generally or pivot honestly to their real experience.
- other → extract what's being asked and give concise guidance

For CODING problems specifically:
- Write the solution in ${codeLang}. (If the screen clearly shows a different required language, use that and set "language" accordingly.)
- "code" must be a COMPLETE, correct, idiomatic, ready-to-paste solution — not pseudocode. Include the function signature.
- Output ONLY the raw code in the "code" field — NO markdown fences, NO \`\`\` wrappers.
- "approach" = 3-5 short plain-English steps explaining the solution.
- "edgeCases" = the specific edge cases to mention to the interviewer.

BANNED WORDS: ${BANNED_WORDS}.
Answer must sound like a real engineer talking — natural, slightly imperfect, NOT textbook.

Return ONE JSON object, no markdown:
{
  "contentType": "coding" | "system_design" | "behavioral" | "slide" | "other",
  "detectedText": "<the question or main text you can see on screen>",
  "pattern": "<coding only: algorithm pattern name, null otherwise>",
  "complexity": "<coding only: O() time and space, null otherwise>",
  "language": "<coding only: solution language e.g. 'Python', null otherwise>",
  "approach": ["<coding only: step 1>", "<step 2>", "<step 3>"],
  "code": "<coding only: complete runnable solution with the function signature — null otherwise>",
  "edgeCases": ["<coding only: edge case to mention>"],
  "confidence": "resume" | "general",
  "resumeStory": "<if behavioral and resume has a match: one line pointing to it, null otherwise>",
  "keyPoints": ["<3-5 word bullet>", "<3-5 word bullet>", "<3-5 word bullet>"],
  "fullAnswer": "<complete 3-6 sentence natural spoken answer — for coding, explain the approach out loud>",
  "watchOut": "<one specific mistake to avoid>"
}`

  // Retries + falls over OpenAI ↔ Gemini, so a single provider's 429 no longer breaks it.
  const faster = fast ? '\n\nFASTER MODE: Lead with the answer/solution first. Keep prose minimal — the code and the 1-2 most important points only.' : ''
  // Fast mode trims PROSE via the prompt, not the token ceiling: the whole response is one JSON
  // object that must contain a complete `code` solution, so a low cap truncates mid-JSON and
  // extractJSON throws (the feature fails on exactly the hard coding screenshots it targets). Keep
  // the cap high enough to never cut off a real solution — a short answer finishes early regardless.
  const raw = await visionComplete({ imageBase64, prompt: prompt + faster, maxTokens: fast ? 1400 : 1500 })
  const out = extractJSON(raw)
  // Defensive: strip any markdown code fences the model wrapped around the code.
  if (out && typeof out.code === 'string') {
    out.code = out.code.replace(/^\s*```[a-zA-Z0-9+#]*\n?/, '').replace(/\n?```\s*$/, '').trim()
  }
  return out
}
