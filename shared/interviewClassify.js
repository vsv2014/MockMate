/**
 * Deterministic interview turn classifier (shared client/server).
 * No LLM call — high-confidence rules first. Prefer specific intents over broad technical.
 *
 * Classification is ADVISORY for playbook/tier/tone. It must not hard-veto user-selected
 * docs, fresh screen evidence, or short resume/JD fact cards (see contextNeedsFor).
 *
 * Prompt / classifier version — bump when matching rules or contextNeeds change.
 */
export const CLASSIFIER_VERSION = 'classify_v2_soft_ctx'

/** @typedef {'software_engineering'|'AI_ML'|'data'|'product'|'business_analysis'|'program_management'|'sales'|'business_development'|'marketing'|'finance'|'operations'|'customer_success'|'customer_support'|'HR'|'design'|'consulting'|'leadership'|'domain_specific'|'unknown'} RoleFamily */

const ROLE_RULES = [
  { family: 'product', re: /\b(product manager|product owner|\bpm\b|product management)\b/i },
  { family: 'AI_ML', re: /\b(machine learning|ml engineer|ai engineer|data scientist|llm|genai|deep learning)\b/i },
  { family: 'data', re: /\b(data engineer|analytics engineer|bi engineer|etl|data analyst)\b/i },
  { family: 'sales', re: /\b(account executive|\bae\b|sales|sdr|bdr|quota|pipeline)\b/i },
  { family: 'business_development', re: /\b(business development|\bbd\b|partnerships)\b/i },
  { family: 'marketing', re: /\b(marketing|growth|brand|campaign|seo|content marketer)\b/i },
  { family: 'finance', re: /\b(finance|accountant|fp&a|controller|investment analyst)\b/i },
  { family: 'HR', re: /\b(human resources|\bhr\b|recruiter|talent acquisition|people ops)\b/i },
  { family: 'design', re: /\b(ux|ui|product designer|visual designer|design systems?)\b/i },
  { family: 'customer_management', re: /\b(program manager|project manager|scrum master|delivery manager)\b/i },
  { family: 'business_analysis', re: /\b(business analyst|\bba\b|requirements analyst)\b/i },
  { family: 'operations', re: /\b(operations|ops manager|process improvement|supply chain)\b/i },
  { family: 'customer_success', re: /\b(customer success|\bcs\b manager|csm)\b/i },
  { family: 'customer_support', re: /\b(customer support|support engineer|help desk)\b/i },
  { family: 'consulting', re: /\b(consultant|consulting|advisory)\b/i },
  { family: 'leadership', re: /\b(engineering manager|director|vp |head of|cto|ceo)\b/i },
  { family: 'software_engineering', re: /\b(software|backend|frontend|full[- ]?stack|sre|devops|platform engineer| swe\b|engineer)\b/i },
]

export function inferRoleFamily(profile = {}) {
  const blob = [profile.targetRole, profile.currentRole, profile.jobDescription, profile.interviewType]
    .filter(Boolean).map(String).join(' ')
  if (!blob.trim()) return 'unknown'
  for (const r of ROLE_RULES) if (r.re.test(blob)) return r.family
  return 'unknown'
}

const EXPLICIT_NEW_TOPIC = /\b(forget (?:that|the design|about)|let'?s (?:do|switch|move)|switch(?:ing)? to|new question|coding question|leetcode|two sum|tell me about (?:yourself|a time|your)|walk me through|design (?:a|an|the)\b|design [A-Za-z])/i

const FOLLOW_UP_SHAPE = /^(?:why(?:\s+not)?|how(?:\s+so)?|what\s+if|what\s+about|how\s+about|okay\.?\s+what about|and(?:\s+then)?|can you (?:explain|elaborate|expand|optimi[sz]e)|explain(?:\s+that|\s+more)?|elaborate|give me an example|go back|no,?\s*i meant|the other (?:one|thing)|scale that|what happens if|why (?:postgres(?:ql)?|mongodb|redis|mysql|kafka|sql|nosql)\b)/i

const SHORT_FOLLOW_UP = /^(why|why not|how|how so|and then|what if|what about|explain|elaborate)(\?|\.)?\s*$/i

/** Topic-continuation cues when lastClassification anchors the parent (M1 contracts). */
const SD_CONTINUATION = /\b(functional requirements?|non[- ]?functional|nfrs?|concurrent|seat booking|caching|sharding|shard|availability|consistency|latency|throughput|postgres(?:ql)?|mongodb|redis|database|scale that|load balanc)/i
const DSA_CONTINUATION = /\b(optimi[sz]e(?:\s+this)?|time complexity|space complexity|big[- ]?o|write (?:it|this|the (?:code|solution)) in|brute force|edge cases?|in (?:java|python|typescript|javascript|go|c\+\+|kotlin|swift)\b)/i
const PM_CONTINUATION = /\b(metrics?(?:\s+would you)?|north star|trade.?offs?|prioriti[sz]e|success metrics|user stor)/i
const SALES_CONTINUATION = /\b(still refuse|still say no|push ?back|discount|what if they)/i
const PROJECT_CONTINUATION = /\b(your contribution|what was your (?:role|contribution)|what did you (?:personally )?(?:do|own|build)|how did you (?:approach|solve))/i

function lastInterviewer(history = []) {
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i]
    if (t?.role === 'interviewer' && t.text) return String(t.text)
  }
  return ''
}

function parentAnchorType(lastClassification) {
  if (!lastClassification) return null
  if (lastClassification.questionType === 'follow_up') {
    return lastClassification.parentType || null
  }
  return lastClassification.questionType || lastClassification.parentType || null
}

function looksLikeFollowUp(question, history, lastClassification = null) {
  const q = String(question || '').trim()
  if (!q) return false
  // Career / intro / company "why" questions are standalone, not follow-ups.
  if (INTRO_RE.test(q) || EXPERIENCE_RE.test(q) || BEHAVIORAL_RE.test(q) || PROJECT_RE.test(q) || ASSIGNMENT_RE.test(q)) return false
  // Company fit is standalone — but not sales objections that mention "our product".
  if (COMPANY_RE.test(q) && !SALES_RE.test(q)) return false
  if (EXPLICIT_NEW_TOPIC.test(q) && !SHORT_FOLLOW_UP.test(q)) return false
  const prior = lastInterviewer(history)
  const anchor = parentAnchorType(lastClassification)
  if (!prior && !history?.length && !anchor) return false
  if (SHORT_FOLLOW_UP.test(q)) return true
  if (FOLLOW_UP_SHAPE.test(q)) return true
  if (words(q) <= 8 && /\b(that|this|it|those|these|there|instead|alternative)\b/i.test(q)) return true
  if (words(q) <= 12 && /\b(why (?:not )?(?:postgres(?:ql)?|mongodb|redis|mysql|kafka)|what if .{0,40} (?:fail|goes? down)|how (?:would|do) you scale)\b/i.test(q)) return true

  // Anchored continuations (same parent topic) — prevents "general" when SD/DSA/PM mid-thread.
  if (anchor === 'system_design' && SD_CONTINUATION.test(q)) return true
  if ((anchor === 'dsa' || anchor === 'coding') && DSA_CONTINUATION.test(q)) return true
  if (anchor === 'product_case' && PM_CONTINUATION.test(q)) return true
  if ((anchor === 'sales_roleplay' || anchor === 'customer_scenario') && SALES_CONTINUATION.test(q)) return true
  if ((anchor === 'project' || anchor === 'project_walkthrough' || anchor === 'experience') && PROJECT_CONTINUATION.test(q)) return true
  return false
}

/**
 * Spoken follow-up that transforms the *current* coding/screen solution
 * ("do it without X", "use O(1) space", "rewrite simpler") — must keep screen + prior code.
 */
export function isCodingTransformFollowUp(question = '') {
  const q = String(question || '').trim()
  if (!q || q.length > 220) return false
  return /\b(can you |could you |please )?(do (?:it|that|this)|rewrite|reimplement|solve (?:it|that|this)|change (?:it|the (?:code|solution))|make (?:it|that))\b/i.test(q)
    || /\bwithout (?:using )?(?:any )?(?:extra )?(?:data structures?|arrays?|hash\s*maps?|maps?|sets?|recursion|heaps?)\b/i.test(q)
    || /\b(?:using )?(?:only )?(?:o\(1\)\s*space|constant space|in[- ]?place|two pointers?|no extra (?:space|memory))\b/i.test(q)
    || /\b(?:simpler|brute force|more optimal|optimize (?:it|this|the (?:code|solution)))\b/i.test(q)
}

function words(q) {
  return String(q || '').split(/\s+/).filter(Boolean).length
}

/** Experience / intro / resume — must beat broad "what/why/do" technical matching. */
const INTRO_RE = /\b(tell me about yourself|introduce yourself|walk me through your (?:background|resume)|give me (?:a|your) (?:quick )?intro|who are you)\b/i
const EXPERIENCE_RE = /\b(what do you (?:do|work on)|what(?:'s| is) your (?:current )?role|current role|your experience|tell me about your experience|what did you (?:personally )?(?:build|own|ship|lead)|biggest challenge|hardest (?:project|bug|incident|problem)|production (?:incident|outage|issue)|looking for a (?:change|new role)|why are you looking|why (?:do you want to )?leave|your strengths?|your weaknesses?|what are you good at)\b/i
const PROJECT_RE = /\b(walk me through|end.?to.?end|deep.?dive|project you (built|led|worked|shipped)|tell me about (a|your).{0,18}(project|system you built|service you built)|something you built|most (challenging|complex) project)\b/i
/** Take-home / company assignment — not a textbook "what is X" knowledge Q. */
const ASSIGNMENT_RE = /\b(assignment|take[- ]?home|takehome|coding challenge|case study|homework)\b/i
const BEHAVIORAL_RE = /\b(tell me about a time|describe a (situation|time)|conflict|disagree|weakness|strength|failure|mistake|proud|gave feedback|leadership|missed a deadline|under pressure|handle(?:d)? ambiguity)\b/i
const COMPANY_RE = /\b(why (do you want to work|us\b|this company|here\b|join)|what do you know about (us|the company|our)|our (product|mission|company|team))\b/i
const SYSTEM_DESIGN_RE = /\b(system design|high[- ]?level design|\bhld\b|\blld\b|how (?:would|do) you design|design (?:a|an|the)\b|design [A-Za-z][\w.-]{1,40}|architect(?:ure|ing)?\b|scal(?:e|able|ability)|throughput|load.?balanc|shard|partition|replicat|distributed|micro.?services?|\bcdn\b|consistency|cap theorem|\bsql\b|nosql|kafka|rabbitmq|booking system|ticketing system|url shortener|news feed|chat (?:app|system)|rate limiter)\b/i
const DSA_RE = /\b(algorithm|complexity|big[- ]?o|dynamic programming|\bdp\b|recursion|binary search|two pointers|sliding window|\bbfs\b|\bdfs\b|leetcode|subarray|substring|linked list|\bgraph\b|\btree\b|\bheap\b|\barray\b|hashmap|hash map|optimi[sz]e|time limit|two sum|shortest path|union[- ]?find|backtracking|prefix sum|trie)\b/i
/** Narrow technical — concept knowledge only; excludes you/your/role/strength experience. */
const TECHNICAL_RE = /\b(what(?:'s| is| are)(?! you\b)(?! your\b)|explain(?! how you\b)|describe what|difference between|differ(?:ence)?|define|pros and cons|trade.?offs? between|when (?:would|should|do) you use|why (?:do we|use|is|are)(?! you\b)|what happens (?:when|if)|how does .{1,40} work)\b/i
const SCREEN_CODE_RE = /\b(what does (?:this|the) code|find the bug|what'?s wrong with (?:this|the) code|time complexity of this code|optimi[sz]e this code|implement this (?:function|method|code|algorithm))\b/i
const SCREEN_DIAGRAM_RE = /\b(explain (?:this|the) (?:architecture|diagram|design)|what'?s wrong with (?:this|the) diagram|walk me through (?:this|the) (?:architecture|diagram))\b/i

const PRODUCT_CASE_RE = /\b(design (?:a |an )?feature|prioriti[sz]e|roadmap|user stor(?:y|ies)|metric|north star|go.?to.?market|product sense|how would you (?:launch|measure|improve) (?:this )?(?:product|feature))\b/i
const SALES_RE = /\b(too expensive|objection|prospect|quota|discovery call|handle (?:a )?customer who|close the deal|competitor)\b/i
const HR_SIT_RE = /\b(employee conflict|performance (?:issue|review)|underperform|terminate|hire|interview panel|dei|harassment)\b/i
const MARKETING_RE = /\b(launch (?:this |the )?product|campaign|positioning|funnel|acquisition|retention|brand)\b/i
const DESIGN_PORTFOLIO_RE = /\b(portfolio|design decision|user research|wireframe|prototype|usability|accessibility)\b/i
const OPS_RE = /\b(improve (?:this |the )?process|sla|runbook|incident process|capacity planning|vendor)\b/i

/**
 * Soft context advisory — budgets/emphasis for the packer, NOT hard vetoes.
 * User-selected docs always stay eligible (rag:true, ragTypes:null).
 * Resume/JD use short fact cards for technical turns ("use if relevant"); full dump only for career turns.
 * @returns {{ identity: boolean, resume: 'none'|'short'|'full', jd: 'none'|'short'|'full', rag: boolean, ragTypes: string[]|null, customPrompt: boolean, codingLanguage: boolean, history: boolean }}
 */
export function contextNeedsFor(questionType, { isFollowUp = false, parentType = null } = {}) {
  const base = {
    identity: true,
    resume: 'short',
    jd: 'none',
    rag: true,
    ragTypes: null, // selection is the gate — never hard-filter doc types by classifier
    customPrompt: true,
    codingLanguage: false,
    history: true,
  }
  const t = isFollowUp && parentType ? parentType : questionType
  switch (t) {
    case 'intro':
    case 'resume':
    case 'experience':
    case 'project':
    case 'project_walkthrough':
    case 'behavioral':
    case 'situational':
    case 'leadership':
      return { ...base, resume: 'full', jd: 'short' }
    case 'company':
      return { ...base, resume: 'short', jd: 'full' }
    case 'system_design':
    case 'technical':
    case 'product_case':
    case 'business_case':
    case 'estimation':
    case 'analytics':
    case 'strategy':
    case 'domain':
    case 'screen_diagram':
    case 'screen_document':
    case 'sales_roleplay':
    case 'customer_scenario':
    case 'candidate_questions':
      // Soft fact card + full selected library; model ignores irrelevant resume lines.
      return { ...base, resume: 'short', jd: t === 'candidate_questions' ? 'short' : 'none' }
    case 'dsa':
    case 'coding':
    case 'screen_code':
      return { ...base, resume: 'short', jd: 'none', codingLanguage: true }
    case 'follow_up':
      return contextNeedsFor(parentType || 'general', { isFollowUp: false })
    case 'general':
    case 'unknown':
    default:
      return { ...base, resume: 'short', jd: 'none' }
  }
}

function pickPlaybookKey(questionType, roleFamily) {
  switch (questionType) {
    case 'intro': return 'intro'
    case 'experience':
    case 'resume': return 'experience'
    case 'project':
    case 'project_walkthrough': return 'project_walkthrough'
    case 'behavioral':
    case 'situational':
    case 'leadership': return 'behavioral'
    case 'company': return 'company'
    case 'system_design': return 'system_design'
    case 'dsa':
    case 'coding': return 'dsa'
    case 'technical': return 'technical'
    case 'follow_up': return 'follow_up'
    case 'product_case': return 'product_case'
    case 'sales_roleplay': return 'sales_objection'
    case 'customer_scenario': return roleFamily === 'customer_success' || roleFamily === 'customer_support' ? 'customer_scenario' : 'sales_objection'
    case 'strategy':
    case 'marketing': return 'marketing_strategy'
    case 'screen_code': return 'dsa'
    case 'screen_diagram': return 'system_design'
    case 'domain':
      if (roleFamily === 'HR') return 'hr_situational'
      if (roleFamily === 'design') return 'design_portfolio'
      if (roleFamily === 'operations' || roleFamily === 'program_management') return 'operations_process'
      return 'general'
    default: return 'general'
  }
}

/**
 * Classify one interviewer turn.
 * @returns {object} Internal classification — never show raw JSON to the candidate.
 */
export function classifyTurn({
  question = '',
  profile = {},
  conversationHistory = [],
  lastClassification = null,
  recentScreen = null,
} = {}) {
  const q = String(question || '').trim()
  const roleFamily = inferRoleFamily(profile)
  const parentType = lastClassification?.questionType && lastClassification.questionType !== 'follow_up'
    ? lastClassification.questionType
    : (lastClassification?.parentType || null)
  const parentTopic = lastClassification?.parentTopic
    || lastInterviewer(conversationHistory)
    || lastClassification?.question
    || ''

  const historyForFollowUp = conversationHistory.length
    ? conversationHistory
    : (parentTopic ? [{ role: 'interviewer', text: parentTopic }] : [])
  const isFollowUpCandidate = looksLikeFollowUp(q, historyForFollowUp, lastClassification)

  let questionType = 'unknown'
  let confidence = 'medium'
  let referencedConcept = null

  // Specific intents BEFORE follow-up / broad technical (prevents "Why are you looking…" → follow_up).
  if (SCREEN_CODE_RE.test(q) || (recentScreen?.contentType === 'coding' && /\b(this|code|bug|complexit|optim)/i.test(q))) {
    questionType = 'screen_code'
    confidence = 'high'
  } else if (SCREEN_DIAGRAM_RE.test(q) || (recentScreen?.contentType === 'system_design' && /\b(this|diagram|architecture)\b/i.test(q))) {
    questionType = 'screen_diagram'
    confidence = 'high'
  } else if (
    isCodingTransformFollowUp(q)
    && (
      /^(coding|screen_code|code)$/i.test(String(recentScreen?.contentType || ''))
      || /^(coding|screen_code)$/i.test(String(recentScreen?.analysis?.contentType || recentScreen?.analysis?.screenFamily || ''))
      || parentType === 'dsa' || parentType === 'coding' || parentType === 'screen_code'
      || lastClassification?.questionType === 'dsa'
      || lastClassification?.questionType === 'coding'
      || lastClassification?.questionType === 'screen_code'
    )
  ) {
    // "Do it without data structures" after F7 / DSA — stay on the coding thread.
    questionType = 'follow_up'
    confidence = 'high'
  } else if (INTRO_RE.test(q)) {
    questionType = 'intro'
    confidence = 'high'
  } else if (
    EXPERIENCE_RE.test(q)
    && !DSA_RE.test(q)
    && (
      !SYSTEM_DESIGN_RE.test(q)
      // Topic-reset lines often mention the prior SD topic ("forget the system design… hardest incident")
      || /\b(forget|switch topics?|hardest|production (?:incident|outage|issue)|strengths?|weaknesses?|current role)\b/i.test(q)
    )
  ) {
    questionType = 'experience'
    confidence = 'high'
  } else if (PROJECT_RE.test(q)) {
    questionType = 'project_walkthrough'
    confidence = 'high'
  } else if (
    ASSIGNMENT_RE.test(q)
    && /\b(you|your|did|do|built|work(?:ed)?|shipped|at|for|in)\b/i.test(q)
  ) {
    // "What is the assignment you did at Opptra?" must NOT become technical via "what is".
    questionType = 'project_walkthrough'
    confidence = 'high'
  } else if (roleFamily === 'HR' && (HR_SIT_RE.test(q) || /\b(employee )?conflict\b/i.test(q) || BEHAVIORAL_RE.test(q))) {
    questionType = 'situational'
    confidence = 'high'
  } else if (BEHAVIORAL_RE.test(q)) {
    questionType = 'behavioral'
    confidence = 'high'
  // Sales / product role intents before company — "our product is too expensive" is an objection, not company-fit.
  } else if ((roleFamily === 'sales' || roleFamily === 'business_development') && SALES_RE.test(q)) {
    questionType = 'sales_roleplay'
    confidence = 'high'
  } else if (
    (roleFamily === 'product' || roleFamily === 'business_analysis')
    && PRODUCT_CASE_RE.test(q)
    && !/\b(system design|\bhld\b|micro.?service|kafka|cap theorem)\b/i.test(q)
  ) {
    questionType = 'product_case'
    confidence = 'high'
  } else if (COMPANY_RE.test(q)) {
    questionType = 'company'
    confidence = 'high'
  } else if (roleFamily === 'marketing' && MARKETING_RE.test(q)) {
    questionType = 'strategy'
    confidence = 'high'
  } else if (roleFamily === 'design' && DESIGN_PORTFOLIO_RE.test(q)) {
    questionType = 'domain'
    confidence = 'high'
  } else if ((roleFamily === 'operations' || roleFamily === 'program_management') && OPS_RE.test(q)) {
    questionType = 'domain'
    confidence = 'high'
  } else if (isFollowUpCandidate) {
    questionType = 'follow_up'
    confidence = SHORT_FOLLOW_UP.test(q) ? 'high' : 'medium'
    const m = q.match(/\b(postgres(?:ql)?|mongodb|redis|mysql|kafka|consistency|nfrs?|scale|payment|booking)\b/i)
    referencedConcept = m ? m[1] : null
  } else if (
    TECHNICAL_RE.test(q)
    && /\b(what(?:'s| is| are)|define|explain|difference between)\b/i.test(q)
    && !/\b(how (?:would|do) you design|system design|\bhld\b|design (?:a|an|the)\b|design [A-Za-z])/i.test(q)
  ) {
    // Pure knowledge ("What is CAP theorem?") must beat SD keyword overlaps (cap theorem, sql…).
    questionType = 'technical'
    confidence = 'high'
  } else if (SYSTEM_DESIGN_RE.test(q)) {
    if (roleFamily === 'product' && /\bfeature\b/i.test(q) && !/\b(system|hld|distributed|kafka)\b/i.test(q)) {
      questionType = 'product_case'
    } else {
      questionType = 'system_design'
    }
    confidence = 'high'
  } else if (DSA_RE.test(q)) {
    questionType = 'dsa'
    confidence = 'high'
  } else if (TECHNICAL_RE.test(q)) {
    questionType = 'technical'
    confidence = 'medium'
  } else if (/\b(questions for (?:me|us)|do you have any questions)\b/i.test(q)) {
    questionType = 'candidate_questions'
    confidence = 'high'
  } else {
    questionType = 'general'
    confidence = 'low'
  }

  // Soft default: unknown parent → general (never assume system_design and strip career context).
  const effectiveParent = questionType === 'follow_up'
    ? (parentType && parentType !== 'follow_up' ? parentType : 'general')
    : null

  // If follow-up after behavioral/design, keep parent; default parent from history playbook cues
  let resolvedParent = effectiveParent
  if (questionType === 'follow_up' && isCodingTransformFollowUp(q)) {
    if (parentType === 'dsa' || parentType === 'coding' || parentType === 'screen_code') {
      resolvedParent = parentType
    } else if (/coding|screen_code|code/i.test(String(recentScreen?.contentType || recentScreen?.analysis?.contentType || ''))) {
      resolvedParent = 'screen_code'
    } else {
      resolvedParent = 'dsa'
    }
  } else if (questionType === 'follow_up' && !parentType) {
    const lastQ = parentTopic
    if (SYSTEM_DESIGN_RE.test(lastQ)) resolvedParent = 'system_design'
    else if (DSA_RE.test(lastQ)) resolvedParent = 'dsa'
    else if (BEHAVIORAL_RE.test(lastQ) || EXPERIENCE_RE.test(lastQ)) resolvedParent = 'behavioral'
    else if (PRODUCT_CASE_RE.test(lastQ)) resolvedParent = 'product_case'
    else resolvedParent = 'general'
  } else if (questionType === 'follow_up') {
    resolvedParent = parentType
  }

  const playbookKey = questionType === 'follow_up'
    ? 'follow_up'
    : pickPlaybookKey(questionType === 'situational' && roleFamily === 'HR' ? 'domain' : questionType, roleFamily)

  const contextNeeds = contextNeedsFor(
    questionType === 'follow_up' ? 'follow_up' : questionType,
    { isFollowUp: questionType === 'follow_up', parentType: resolvedParent },
  )

  return {
    classifierVersion: CLASSIFIER_VERSION,
    roleFamily,
    questionType,
    playbookKey,
    isFollowUp: questionType === 'follow_up',
    parentType: resolvedParent,
    parentTopic: questionType === 'follow_up' ? parentTopic : q,
    referencedConcept,
    confidence,
    contextNeeds,
    screenRelevant: !!(recentScreen && (questionType.startsWith('screen_') || /\b(this|screen|code|diagram)\b/i.test(q))),
  }
}

/**
 * Whether client should attempt document RAG for this turn.
 * Soft policy: always try when the session has selected docs — classifier must not veto.
 * (retrieveContext no-ops on empty selection.)
 */
export function shouldRetrieveDocs(_classification) {
  return true
}
