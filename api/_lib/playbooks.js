/**
 * Modular interview playbook registry. Versioned guides injected into Live answer/coach prompts.
 * Adding a role strategy = add a card here; do not grow one mega-prompt.
 */
export const PLAYBOOK_REGISTRY_VERSION = 'playbooks_v2'

/** @type {Record<string, { key: string, version: string, tier: 'fast'|'strong', answer: string, coach: string }>} */
export const PLAYBOOK_BY_KEY = {
  intro: {
    key: 'intro', version: 'intro_v1', tier: 'fast',
    answer: 'Self-introduction: 3-5 spoken sentences grounded ONLY in the resume. Who you are, current/recent role, 1-2 signature strengths with evidence, why you are here. Never invent employers, titles, or metrics. confidence:"resume".',
    coach: '**Who:** role + years in one line.\n**Proof:** 1-2 resume strengths with a concrete example.\n**Why here:** one sincere line tied to the JD if present.',
  },
  experience: {
    key: 'experience', version: 'experience_v1', tier: 'fast',
    answer: 'Experience / resume question. Answer what was asked using ONLY resume facts. First person. Name real projects/tech from the resume. If the resume lacks a detail, say so briefly and give the closest real experience + how you would approach it — never invent. confidence:"resume". 3-5 sentences.',
    coach: '**Answer the ask:** one line.\n**Evidence:** resume project/tech/metric to use.\n**Gap:** if missing, closest experience + approach — no invention.',
  },
  project_walkthrough: {
    key: 'project_walkthrough', version: 'project_walkthrough_v2', tier: 'strong',
    answer: 'Narrate END-TO-END: context + scale (why it mattered) → what YOU owned (say "I", not "we") → the architecture and the 1-2 key technical decisions and WHY → the hardest trade-off/challenge and how you resolved it → measurable impact (numbers) + what you would do differently. Ground every detail in the resume. 5-7 spoken sentences.',
    coach: '**Context:** the problem + scale in one line.\n**Your role:** what YOU owned — say "I".\n**Architecture:** design + 1-2 key decisions and why.\n**Trade-offs:** the hard call.\n**Challenge:** toughest problem and how it was cracked.\n**Impact:** measurable result + what you would change.',
  },
  system_design: {
    key: 'system_design', version: 'system_design_v2', tier: 'strong',
    answer: `SYSTEM DESIGN of whatever product/system the interviewer named — answer THAT design.
confidence MUST be "general". NEVER open with a personal project or past employer. NEVER replace the asked system with a resume story.
For a FULL design ask, speak 6-10 short sentences covering: clarifying assumption (scale/consistency) → functional requirements (top) → NFRs → core entities/APIs → high-level components + WHY each exists → data stores + WHY → one critical flow → one failure/recovery → one trade-off (WHAT/WHY/HOW/TRADEOFF on key decisions).
If the ask is a NARROW follow-up already handled elsewhere, still answer only what is asked — do not restart the full scaffold.`,
    coach: '**Clarify:** scope (DAU/QPS, consistency).\n**FR / NFR:** top requirements.\n**Domain:** entities for THIS system.\n**Components:** services + WHY each exists.\n**Data:** stores + why.\n**Flow / failure:** critical path + recovery.\n**Trade-off:** one concrete WHAT/WHY/HOW/TRADEOFF.\nDo NOT pivot to a resume project.',
  },
  dsa: {
    key: 'dsa', version: 'dsa_v2', tier: 'strong',
    answer: 'CODING/DSA — NEVER jump straight to code. Open with 1-2 sharp clarifying questions, then state assumptions. Then: restate the problem briefly → brute force + bottleneck → OPTIMAL approach (name the pattern: HashMap/two pointers/sliding window/stack/queue/binary search/BFS/DFS/heap/trie/DP/graph/union-find/backtracking/intervals/prefix sums when it fits) → time/space complexity → FULL runnable fenced code in the REQUESTED language (see Coding language line; if unspecified use the profile default) → dry-run on one example → edge cases. Speak the why, not only steps.',
    coach: '**Clarify:** 1-2 sharp questions.\n**Restate / assumptions.**\n**Brute → bottleneck → optimal pattern.**\n**Complexity:** time/space.\n**Code:** requested language.\n**Dry-run + edges.**',
  },
  company: {
    key: 'company', version: 'company_v2', tier: 'fast',
    answer: 'Ground in the LIVE WEB SEARCH facts. Tie 1-2 SPECIFIC, current facts about the company/product to your own experience or goals. Genuine and specific — never generic flattery. 2-4 sentences.',
    coach: '**Hook:** one specific current fact.\n**Fit:** connect to YOUR experience.\n**Why now:** sincere specific reason.',
  },
  behavioral: {
    key: 'behavioral', version: 'behavioral_v2', tier: 'fast',
    answer: 'Behavioral / situational: light STAR (Situation → Task → Action → Result → Lesson). Open with a SPECIFIC project from the resume. First person, conversational. Quantify the result when the resume supports it. Never invent ownership, metrics, or tools. confidence:"resume" when grounded. 3-5 sentences. Do NOT use system-design or DSA structure.',
    coach: '**STAR:** Situation / Task / Action / Result (+ Lesson) from the resume.\n**Signal:** ownership trait (say "I", quantify when real).',
  },
  technical: {
    key: 'technical', version: 'technical_v2', tier: 'fast',
    answer: 'PURE KNOWLEDGE question — answer from GENERAL knowledge, NOT the resume. Do NOT name a personal project, do NOT say "in our project", do NOT invent experience. confidence MUST be "general". In 2-4 spoken sentences: the precise answer, the WHY / mechanism, and one trade-off or gotcha. Be concrete and correct over broad.',
    coach: '**Concept:** precise definition.\n**Why/mechanism.**\n**Trade-off / gotcha.**',
  },
  follow_up: {
    key: 'follow_up', version: 'followup_v1', tier: 'strong',
    answer: `FOLLOW-UP — answer ONLY this probe. Do NOT restart a full system-design, DSA, STAR, or intro answer.
Resolve "that"/"it"/"why" against the conversation history and parent topic.
Use WHAT → WHY → HOW → TRADEOFF when the probe is a design/tech decision (e.g. Why PostgreSQL?).
If the parent was behavioral, stay in that story — deepen Action/Result, do not invent a new story.
Keep 2-5 spoken sentences unless they asked for detail. confidence usually "general" for design/tech probes; "resume" only if probing their experience.`,
    coach: '**Resolve reference:** what "that" means from history.\n**Direct answer** to this probe only.\n**WHY / TRADEOFF** if a decision question.\n**Do not** restart the full prior structure.',
  },
  product_case: {
    key: 'product_case', version: 'role_pm_v1', tier: 'strong',
    answer: 'Product / PM case — NOT system design infrastructure. Cover: user/problem → goals/metrics → options → prioritization → high-level solution (UX + policy, not Kafka diagrams unless asked) → risks/rollout → how you measure success. Speak as a PM candidate. Do not invent past product launches not on the resume; conceptual answers are fine. 5-8 sentences.',
    coach: '**User/problem.**\n**Goals/metrics.**\n**Options + prioritize.**\n**Solution (product, not infra).**\n**Risks/rollout + measure.**',
  },
  sales_objection: {
    key: 'sales_objection', version: 'role_sales_v1', tier: 'fast',
    answer: 'Sales / objection-handling role-play. Acknowledge → clarify need → reframe value → evidence/social proof (only if on resume/JD materials) → next step question. Conversational, not a lecture. 3-5 sentences. Do not invent deals you closed.',
    coach: '**Acknowledge.**\n**Clarify.**\n**Value reframe.**\n**Proof (real only).**\n**Next step ask.**',
  },
  customer_scenario: {
    key: 'customer_scenario', version: 'role_cs_v1', tier: 'fast',
    answer: 'Customer success/support scenario: listen/clarify → diagnose → resolve/options → set expectations → follow-up. Empathetic and concrete. 3-5 sentences. Do not invent CSAT metrics.',
    coach: '**Clarify.**\n**Diagnose.**\n**Resolve + expectations.**\n**Follow-up.**',
  },
  marketing_strategy: {
    key: 'marketing_strategy', version: 'role_mkt_v1', tier: 'strong',
    answer: 'Marketing/strategy: audience → insight → channel/mix → messaging → measurement → risks. Role-appropriate depth. Do not invent campaign results. 4-7 sentences.',
    coach: '**Audience/insight.**\n**Channels + messaging.**\n**Measure.**\n**Risks.**',
  },
  hr_situational: {
    key: 'hr_situational', version: 'role_hr_v1', tier: 'fast',
    answer: 'HR / people situational: clarify facts → stakeholders → policy/fairness → action steps → follow-up. Balanced and professional. STAR only if they asked about YOUR past experience. 3-5 sentences.',
    coach: '**Clarify.**\n**Stakeholders + fairness.**\n**Actions.**\n**Follow-up.**',
  },
  design_portfolio: {
    key: 'design_portfolio', version: 'role_design_v1', tier: 'fast',
    answer: 'Design reasoning: problem/user → constraints → options explored → decision + WHY → outcome/learning. Ground in portfolio/resume only when claiming past work. 3-5 sentences.',
    coach: '**Problem/user.**\n**Options.**\n**Decision + why.**\n**Outcome/learning.**',
  },
  operations_process: {
    key: 'operations_process', version: 'role_ops_v1', tier: 'fast',
    answer: 'Operations/process: current state → bottleneck → proposed change → owners/SLA → metrics → risks. Practical and stepwise. 3-5 sentences.',
    coach: '**Current → bottleneck.**\n**Change + owners/SLA.**\n**Metrics + risks.**',
  },
  general: {
    key: 'general', version: 'general_v2', tier: 'fast',
    answer: 'Answer the CURRENT question directly in 2-4 spoken sentences. Do NOT force system-design, DSA, or STAR structure. Do NOT inject resume stories unless the question is clearly about the candidate. Prefer general knowledge when unsure. State reasoning briefly.',
    coach: '**Frame:** what they really asked.\n**Point:** 2-3 key things.\n**Why:** brief reasoning.',
  },
}

/** Ordered legacy-compatible list for first-match fallbacks / tests. */
export const PLAYBOOKS = [
  PLAYBOOK_BY_KEY.project_walkthrough,
  PLAYBOOK_BY_KEY.system_design,
  PLAYBOOK_BY_KEY.dsa,
  PLAYBOOK_BY_KEY.company,
  PLAYBOOK_BY_KEY.behavioral,
  PLAYBOOK_BY_KEY.intro,
  PLAYBOOK_BY_KEY.experience,
  PLAYBOOK_BY_KEY.follow_up,
  PLAYBOOK_BY_KEY.product_case,
  PLAYBOOK_BY_KEY.sales_objection,
  PLAYBOOK_BY_KEY.customer_scenario,
  PLAYBOOK_BY_KEY.marketing_strategy,
  PLAYBOOK_BY_KEY.hr_situational,
  PLAYBOOK_BY_KEY.design_portfolio,
  PLAYBOOK_BY_KEY.operations_process,
  PLAYBOOK_BY_KEY.technical,
  PLAYBOOK_BY_KEY.general,
]

export function getPlaybook(key) {
  return PLAYBOOK_BY_KEY[key] || PLAYBOOK_BY_KEY.general
}
