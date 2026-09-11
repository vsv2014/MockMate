import {
  CUSTOM_INSTRUCTIONS_CORE_MAX,
  CUSTOM_INSTRUCTIONS_PACK_MAX,
  CUSTOM_INSTRUCTIONS_ROUTE_MAX,
  CUSTOM_INSTRUCTIONS_STORE_MAX,
} from './interviewConfig.js'

const HEADING_RE = /^([A-Z][A-Z0-9 &/+_.()-]{1,72}):\s*(.*)$/
const CORE_TITLE_RE = /^(VOICE|TRUTH|ASR|UNKNOWN|FINAL(?: SILENT)? RULE|CORE(?: BEHAVIOU?R)?|BEHAVIOU?R RULES?|GLOBAL|ALWAYS)$/i

const ROUTES = [
  { re: /ASSIGNMENT|TAKE.?HOME|REPOSITORY|REPO/, types: [], words: /\b(assignment|take.?home|repository|repo|readme)\b/i },
  { re: /ARCHITECTURE|SYSTEM DESIGN|HLD|LLD/, types: [], words: /\b(architect|system design|design|scale|component|service|database)\b/i },
  { re: /SQL|DATABASE|\bDB\b/, types: [], words: /\b(sql|query|database|table|join|group by|having|index|mysql|postgres|mongo|salary|select|insert|update|delete)\b/i },
  { re: /PYTHON|FASTAPI/, types: [], words: /\b(python|fastapi|pytest|pandas|django|flask)\b/i },
  { re: /CODING|DSA|ALGORITHM|PROGRAMMING/, types: ['dsa', 'coding', 'screen_code'], words: /\b(code|coding|algorithm|complexity|array|string|hashmap|function|typescript|javascript|java|c\+\+)\b/i },
  { re: /API|BACKEND|SERVER/, types: [], words: /\b(api|backend|endpoint|rest|controller|middleware|auth|http|status code|service|repository)\b/i },
  { re: /ANGULAR|TYPESCRIPT|JAVASCRIPT|FRONTEND|RXJS/, types: [], words: /\b(angular|typescript|javascript|rxjs|observable|promise|eventemitter|frontend|component)\b/i },
  { re: /AI IDE|CURSOR|CLAUDE CODE|CODEX|COPILOT/, types: [], words: /\b(cursor|claude code|codex|copilot|ai ide|coding assistant)\b/i },
  { re: /\bAI\b|\bRAG\b|\bAGENTS?\b|\bLLM\b|\bMCP\b|EMBED/, types: [], words: /\b(ai|rag|agent|llm|mcp|embedding|vector|chunk|prompt|model)\b/i },
  { re: /DISTRIBUTED|PROD|KAFKA|QUEUE|SCAL/, types: [], words: /\b(distributed|production|kafka|queue|retry|idempot|observability|latency|throughput|tenant|workflow|scale)\b/i },
  { re: /BEHAVIOU?RAL|LEADERSHIP|DEV\s*III|MANAGER/, types: ['behavioral', 'situational', 'leadership'], words: /\b(behavioral|leadership|conflict|failure|ownership|mentor|pressure|deadline|tell me about a time)\b/i },
]

function appendWithin(parts, text, budget) {
  const used = parts.reduce((n, p) => n + p.length + 2, 0)
  const remaining = Math.max(0, budget - used)
  if (!remaining) return false
  parts.push(text.slice(0, remaining))
  return true
}

/** Split an instruction playbook without requiring a proprietary template. */
export function parseCustomInstructionSections(value = '') {
  const text = String(value || '').replace(/\r\n?/g, '\n').trim().slice(0, CUSTOM_INSTRUCTIONS_STORE_MAX)
  if (!text) return []

  const sections = []
  let current = { title: 'PREAMBLE', body: [] }
  for (const line of text.split('\n')) {
    const match = line.trim().match(HEADING_RE)
    if (match) {
      if (current.body.some(Boolean)) sections.push({ title: current.title, text: current.body.join('\n').trim() })
      current = { title: match[1].trim(), body: [match[2].trim()] }
    } else {
      current.body.push(line)
    }
  }
  if (current.body.some(Boolean)) sections.push({ title: current.title, text: current.body.join('\n').trim() })
  return sections
}

function isRelevant(section, question, classification) {
  const title = section.title
  const q = String(question || '')
  const type = classification?.isFollowUp
    ? (classification.parentType || classification.questionType)
    : classification?.questionType
  const role = classification?.roleFamily

  if (title === 'PREAMBLE' || CORE_TITLE_RE.test(title)) return true
  for (const route of ROUTES) {
    if (!route.re.test(title)) continue
    if (route.words.test(q) || route.types.includes(type) || route.types.includes(role)) return true
  }

  // Custom headings still route when their meaningful words occur in the ask.
  const tokens = title.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) || []
  const lowerQ = q.toLowerCase()
  return tokens.some(token => lowerQ.includes(token))
}

/**
 * Compile a long user playbook for one turn. Core rules are always retained;
 * domain rules are selected by the committed question/classification.
 */
export function compileCustomInstructions(value = '', { question = '', classification = null } = {}) {
  const sections = parseCustomInstructionSections(value)
  if (!sections.length) return { text: '', selectedSections: [], omittedSections: [] }

  // Ordinary short prose should behave exactly as before.
  if (sections.length === 1 && sections[0].title === 'PREAMBLE') {
    return {
      text: sections[0].text.slice(0, CUSTOM_INSTRUCTIONS_PACK_MAX),
      selectedSections: ['PREAMBLE'],
      omittedSections: [],
    }
  }

  const core = sections.filter(s => s.title === 'PREAMBLE' || CORE_TITLE_RE.test(s.title))
  const routed = sections.filter(s => !core.includes(s) && isRelevant(s, question, classification))
  const coreParts = []
  const routeParts = []
  const included = []

  for (const section of core) {
    if (appendWithin(coreParts, `${section.title}: ${section.text}`.trim(), CUSTOM_INSTRUCTIONS_CORE_MAX)) included.push(section)
  }
  for (const section of routed) {
    if (appendWithin(routeParts, `${section.title}: ${section.text}`.trim(), CUSTOM_INSTRUCTIONS_ROUTE_MAX)) included.push(section)
  }

  const text = [...coreParts, ...routeParts].join('\n\n').slice(0, CUSTOM_INSTRUCTIONS_PACK_MAX)
  return {
    text,
    selectedSections: included.map(s => s.title),
    omittedSections: sections.filter(s => !included.includes(s)).map(s => s.title),
  }
}
