// Solo (you-vs-AI) interview engine for the web app. Open-ended, speech-first,
// no difficulty knob — the interviewer calibrates to the target role.
import { completeJSON, resolveVisionProvider, extractJSON } from './core.js'
import { analyze } from '../../src/delivery.js'
import OpenAI from 'openai'

function profileBlock(p = {}) {
  let s = ''
  if (p.name) s += `\nCandidate name: ${p.name}`
  if (p.targetRole) s += `\nTarget role: ${p.targetRole}`
  if (p.targetCompany) s += `\nTarget company: ${p.targetCompany}`
  if (p.resume) s += `\n\nResume:\n${String(p.resume).slice(0, 3000)}`
  if (p.jobDescription) s += `\n\nJob description:\n${String(p.jobDescription).slice(0, 2000)}`
  return s
}

function buildPrompt(config = {}, profile = {}) {
  const ctx = profileBlock(profile)
  const track = [config.domainLabel, config.roundLabel].filter(Boolean).join(' — ') || 'general interview'
  const depth = config.followupDepth
  const followLine = depth === 'light'
    ? 'After each answer, ask at most ONE brief follow-up, and only if it was unclear — otherwise move on.'
    : depth === 'deep'
      ? 'After each answer, ask 2–3 probing follow-ups, drilling into specifics (real numbers, the tradeoff they rejected, what broke, why not the alternative) before moving on.'
      : 'After each answer, you may ask 0–2 natural follow-ups (about reasoning, complexity, tradeoffs, or how it scales) before moving on.'

  return `You are an experienced, professional interviewer running a REALISTIC mock interview so the candidate can practice as if it were real.

Interview track: ${track}
Calibrate difficulty yourself to the target role and the candidate's seniority (from their background) — interview them exactly as a real panel for that role and level would.
${config.focus ? `\n[Candidate's requested focus — shape questions around this, but never reveal answers or break character]\n"${String(config.focus).slice(0, 600)}"\n` : ''}${ctx ? `\n[Candidate background — tailor questions to this where natural]${ctx}\n` : ''}${config.relentless ? `\n[RELENTLESS MODE] The moment an answer sounds rehearsed, generic, or buzzword-heavy, challenge it directly ("That sounds rehearsed — give me a concrete example from YOUR experience") and drill for specifics. Tough but respectful. Never reveal answers.\n` : ''}
HOW A REAL INTERVIEWER BEHAVES (follow strictly):
- Ask ONE question at a time. Never dump multiple questions at once.
- Stay within the interview track. ${followLine}
- Do NOT give the candidate the answer, hints, or coaching during the interview. Stay neutral.
- Briefly acknowledge ("Got it.", "Okay.") but never praise or evaluate quality — feedback comes only at the end.
- Keep turns concise and conversational, like real speech.
- This is OPEN-ENDED: there is NO fixed number of questions. Do NOT end the interview yourself and do NOT give a closing line — the candidate ends it when ready. Always set "isComplete" to false; keep moving to new relevant areas.

Respond with ONE valid JSON object and nothing else, no markdown fences:
{ "say": "<your spoken line>", "kind": "question" | "followup", "questionNumber": <1-based integer of the current MAIN question>, "isComplete": false }`
}

export async function interviewerTurn({ config = {}, transcript = [], profile = {}, provider }) {
  const messages = transcript.map(t => ({ role: t.role === 'interviewer' ? 'assistant' : 'user', content: t.text }))
  if (messages.length === 0) messages.push({ role: 'user', content: "I'm ready. Please begin the interview with your first question." })
  return await completeJSON({
    maxTokens: 700, provider,
    messages: [{ role: 'system', content: buildPrompt(config, profile) }, ...messages]
  })
}

export async function generateHint({ question, profile = {}, conversationHistory = [], provider }) {
  const ctx = profileBlock(profile)

  const system = `You are a private interview coach. The candidate is in a REAL LIVE INTERVIEW with 5 seconds to glance at this hint.

You operate in TWO modes. Switch based on question type — do NOT mix them.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MODE A — CS EXPERT  (dsa, coding, technical, system_design)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
These are pure knowledge questions. Resume is irrelevant. Use accurate CS knowledge.
NEVER say "I haven't worked on that" — every engineer knows these fundamentals.

dsa (reverse/find/valid/count/sort/minimum/maximum/path/subarray/substring — algorithmic):
  • Identify the PATTERN: Sliding Window | Two Pointers | BFS | DFS | Binary Search | DP | HashMap | Stack | Heap | Trie | Union Find | Backtracking
  • Time + space complexity in O() notation
  • sampleAnswer (2-3 lines): pattern name → one-line approach → complexity
  • Fill "pattern" and "complexity" fields

coding (write a function / implement / code this):
  • Same as DSA. Pattern → approach → edge cases → complexity
  • sampleAnswer: "So I'd clarify — sorted? duplicates? Then the pattern here is..."

technical (React hooks / Java GC / Python async / SQL / REST vs GraphQL / OOP / OS / networking / any framework concept):
  • One sharp definition + one concrete real-world analogy
  • The single most common interview mistake on this topic
  • If resume shows they used this tech, add one line of personal context
  • confidence: "general"

system_design (design X / architect X / build X at scale):
  • Framework IN ORDER: requirements+constraints → scale estimate → core components → one key trade-off
  • Safe round numbers only (100M users, ~1K QPS) — never fabricate precise capacity
  • sampleAnswer is 4-6 lines for this type ONLY

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MODE B — RESUME NARRATOR  (behavioral, resume, culture)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${ctx
  ? `RESUME = GROUND TRUTH. Use ONLY the projects, tools, and numbers below. NEVER invent facts, metrics, dates, or tools not in it.\n${ctx}`
  : 'No resume provided — use generic examples and set confidence: "general".'}

behavioral ("tell me about a time" / "give an example" / "describe a situation"):
  • STAR: name the specific project → what YOU personally decided → measurable result
  • Point to the most relevant resume project in resumeStory field

resume ("walk me through your project" / "tell me about your role"):
  • Pull exact achievements from resume — real numbers, real tools, real outcomes

culture ("why this company" / "strengths/weaknesses" / "where do you see yourself"):
  • Authentic and specific. No clichés. One honest concrete thing.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SAMPLE ANSWER RULES (all types):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 2-4 spoken lines MAX (4-6 for system_design only). Stop. Do not keep teaching.
2. Natural speech openers: "Yeah so…" | "Basically…" | "So the pattern here is…" | "At a high level…" | "Honestly…" | "In my case…"
3. Sound slightly imperfect: "around O(n) I think" | "if I recall…" | "something like that"
4. BANNED: leverage, robust, seamless, delve, comprehensive, facilitate, utilize, best-in-class, cutting-edge
5. Simple English: "response time" not "latency" | "handles more load" not "scalable" | "managing steps" not "orchestration"
6. MODE B only — PROJECT-FIRST: "In our Document Intelligence project…" NOT "RAG works by…"
7. MODE A only — PATTERN-FIRST: "So this is a sliding window problem…" NOT a textbook definition

Return ONE JSON object, no prose, no markdown fences:
{
  "questionType": "dsa" | "coding" | "technical" | "system_design" | "behavioral" | "resume" | "culture" | "other",
  "pattern": "<dsa/coding only: pattern name e.g. 'Sliding Window', 'BFS', 'DP — 0/1 Knapsack' — null otherwise>",
  "complexity": "<dsa/coding only: e.g. 'O(n) time, O(1) space' — null otherwise>",
  "confidence": "resume" | "general",
  "resumeStory": "<behavioral/resume only: one sentence naming the specific project — null for technical>",
  "opener": "<one sentence to literally start speaking>",
  "keyPoints": ["<3-5 word bullet>", "<3-5 word bullet>", "<3-5 word bullet>"],
  "sampleAnswer": "<spoken answer — natural, follows all rules above>",
  "fullAnswer": "<complete ready-to-speak answer, 4-8 sentences. Natural, conversational, sounds like a real engineer in a live interview. No filler intros like 'Great question'. Starts immediately with substance. Resume-grounded for behavioral/resume types. Pattern-first for DSA. Same speech rules apply.>",
  "watchOut": "<one specific mistake for THIS exact question>"
}`

  const historyBlock = conversationHistory.length > 0
    ? '\n\nConversation so far (for follow-up questions — "that"/"it"/"what you said" refers to this):\n' +
      conversationHistory.slice(-6).map(t => `${t.role.toUpperCase()}: ${t.text}`).join('\n')
    : ''

  return await completeJSON({
    maxTokens: 900, provider,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `${historyBlock}\n\nCurrent question: "${String(question).slice(0, 800)}"` }
    ]
  })
}

export async function evaluateSolo({ config = {}, transcript = [], profile = {}, provider }) {
  const candidateText = transcript.filter(t => t.role === 'candidate').map(t => t.text).join('\n')
  const delivery = analyze(candidateText)
  const convo = transcript.map(t => `${t.role === 'interviewer' ? 'INTERVIEWER' : 'CANDIDATE'}: ${t.text}`).join('\n\n')
  const track = [config.domainLabel, config.roundLabel].filter(Boolean).join(' — ') || 'interview'

  const system = `You are a fair but rigorous interview evaluator. Score the candidate's performance in this ${track} mock interview at the level expected for the target role, the way a real hiring panel would. Be honest and specific.
${profileBlock(profile)}
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

export async function analyzeScreen({ imageBase64, profile = {} }) {
  const prov = resolveVisionProvider()   // requires Gemini
  const llm = new OpenAI({ apiKey: prov.key, baseURL: prov.baseURL })
  const ctx = profileBlock(profile)

  const prompt = `You are a private interview coach analyzing a screenshot taken during a live interview.
${ctx ? `\nCandidate background:\n${ctx}\n` : ''}
Identify what is on screen and generate instant guidance the candidate can use RIGHT NOW.

Rules:
- coding/algorithm problem → identify pattern (Sliding Window / BFS / DP etc.), give approach + complexity
- system design question → framework: requirements → scale → components → trade-off
- behavioral/HR question → STAR scaffold + resume hook if context available
- slide/presentation → extract the key question or topic and give talking points
- other → extract what's being asked and give concise guidance

BANNED WORDS: leverage, robust, seamless, delve, comprehensive, utilize.
Answer must sound like a real engineer talking — natural, slightly imperfect, NOT textbook.

Return ONE JSON object, no markdown:
{
  "contentType": "coding" | "system_design" | "behavioral" | "slide" | "other",
  "detectedText": "<the question or main text you can see on screen>",
  "pattern": "<coding only: algorithm pattern name, null otherwise>",
  "complexity": "<coding only: O() time and space, null otherwise>",
  "confidence": "resume" | "general",
  "resumeStory": "<if behavioral and resume has a match: one line pointing to it, null otherwise>",
  "keyPoints": ["<3-5 word bullet>", "<3-5 word bullet>", "<3-5 word bullet>"],
  "fullAnswer": "<complete 3-6 sentence natural spoken answer — ready to say out loud>",
  "watchOut": "<one specific mistake to avoid>"
}`

  const resp = await llm.chat.completions.create({
    model: prov.model,
    max_tokens: 900,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
        { type: 'text', text: prompt }
      ]
    }]
  })

  const raw = resp.choices?.[0]?.message?.content
  if (!raw) throw new Error('No response from vision model')
  return extractJSON(raw)
}
