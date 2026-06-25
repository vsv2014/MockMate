// Resume / career LLM tools — the "legit" career-toolkit side of MockMate (resume gets you
// the interview; Solo/Companion help you pass it). Reuses the hardened provider stack
// (completeJSON → retry + failover) in core.js. All return plain JSON for the UI.
import { completeJSON } from './core.js'

function requireResume(resume) {
  if (!resume || !resume.trim()) { const e = new Error('Add your resume first (paste it in Solo setup or upload a PDF).'); e.status = 400; throw e }
}

// ── ATS resume score — how applicant-tracking software + a recruiter would grade it ──
export async function atsScore({ resume = '', targetRole = '', jobDescription = '', provider } = {}) {
  requireResume(resume)
  const system = `You are an applicant-tracking system (ATS) combined with a senior technical recruiter. Grade this resume the way real ATS software AND a recruiter would for the target role. Be specific, honest, and actionable — most resumes are auto-rejected by software before a human sees them.
Return ONE JSON object, no prose:
{
  "overallScore": <0-100 integer>,
  "verdict": "<one blunt line on whether it passes ATS + a recruiter skim>",
  "dimensions": [ { "name": "<one of: Keyword match, Skills coverage, Impact metrics, Action verbs, Formatting & ATS parse-safety, Length & density, Contact & links, Tailoring to role, Seniority signal, Clarity>", "score": <0-5>, "comment": "<specific, what to change>" } ],
  "missingKeywords": [ "<important keyword/skill the role expects that is absent or weak>" ],
  "topFixes": [ "<concrete, prioritized fix — most impactful first>" ],
  "redFlags": [ "<things that trigger auto-reject: tables/columns/images, no metrics, generic objective, typos, dense walls of text>" ]
}
Cover at least 20 concrete checks across those dimensions. Score honestly — a generic resume for a senior role scores low.`
  const user = `TARGET ROLE: ${targetRole || '(infer from the resume)'}\n${jobDescription ? `JOB DESCRIPTION:\n${String(jobDescription).slice(0, 2000)}\n\n` : ''}RESUME:\n${String(resume).slice(0, 6000)}`
  return completeJSON({ maxTokens: 2200, provider, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
}

// ── Per-role resume tailoring — concrete edits to optimize the resume for a role/JD ──
export async function tailorResume({ resume = '', targetRole = '', jobDescription = '', provider } = {}) {
  requireResume(resume)
  const system = `You are a senior resume writer + ATS optimizer. Tailor the candidate's EXISTING resume to the target role/JD WITHOUT inventing experience — only re-emphasize, reword, reorder, and surface keywords they truthfully have. Never fabricate tools, numbers, or roles.
Return ONE JSON object, no prose:
{
  "summary": "<a tailored 2-3 line professional summary for this role, grounded in their real background>",
  "rewrittenBullets": [ { "before": "<an existing weak bullet>", "after": "<stronger, metric-forward, keyword-optimized rewrite — same truth>" } ],
  "keywordsToAdd": [ "<role keyword they genuinely match but didn't surface>" ],
  "sectionOrder": [ "<recommended top-to-bottom section order for this role>" ],
  "notes": [ "<short tailoring tip>" ]
}`
  const user = `TARGET ROLE: ${targetRole || '(infer)'}\n${jobDescription ? `JOB DESCRIPTION:\n${String(jobDescription).slice(0, 2000)}\n\n` : ''}RESUME:\n${String(resume).slice(0, 6000)}`
  return completeJSON({ maxTokens: 2400, provider, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
}

// ── Referral message drafter — a personalized DM to ask for a referral ──
export async function referralMessage({ resume = '', targetRole = '', company = '', person = '', provider } = {}) {
  requireResume(resume)
  const system = `You write concise, warm, NON-cringe referral request messages for tech job seekers. Personalized, specific, humble, easy to say yes to. 90-130 words. No buzzwords, no flattery overload, no "I am writing to express". Sound like a real person. Ground the candidate's fit in their actual resume.
Return ONE JSON object, no prose:
{
  "short": "<a 1-2 line LinkedIn connection-note version (<=300 chars)>",
  "message": "<the full personalized referral request DM>",
  "why": "<1 line: the specific fit hook you used>"
}`
  const user = `CANDIDATE RESUME:\n${String(resume).slice(0, 4000)}\n\nTARGET ROLE: ${targetRole || '(infer)'}\nCOMPANY: ${company || '(unspecified)'}\nPERSON (who you're asking, if known): ${person || '(unknown — keep it generally addressable)'}`
  return completeJSON({ maxTokens: 1200, provider, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
}
