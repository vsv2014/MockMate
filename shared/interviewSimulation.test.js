/**
 * M1 behavioral contracts — realistic interview simulations.
 * Assert classification, parent, context selection, screen relevance, generation authority.
 * NOT exact LLM prose. Question understanding completeness is M2.
 */
import { describe, it, expect } from 'vitest'
import { classifyTurn, contextNeedsFor, inferRoleFamily } from './interviewClassify.js'
import { evaluateScreenRelevance } from './screenContext.js'
import { createInterviewState } from './interviewState.js'
import { createGenerationManager } from './generationManager.js'
import { resolveContextSources, formatInterviewDevTrace } from './contextSelection.js'

function runTurn(state, text, profile, lastClassification, screen = null) {
  const history = state.getLlmHistory({ includeLastAnswer: false })
  const classification = classifyTurn({
    question: text,
    profile,
    conversationHistory: history,
    lastClassification,
    recentScreen: screen,
  })
  const relevance = evaluateScreenRelevance({ question: text, classification, screen })
  const hasPrior = history.some(t => t.role === 'interviewer')
  const ctx = resolveContextSources({
    classification,
    screenRelevant: relevance.attach,
    hasPriorTopicDiscussion: hasPrior && !!classification.isFollowUp,
  })
  const q = state.beginQuestion(text, classification, {
    contextSources: ctx.allowed,
    screenRelevant: relevance.attach,
    screenReason: relevance.reason,
    screenContextId: screen?.screenContextId || null,
  })
  state.setContextDecision(q.id, {
    contextSources: ctx.allowed,
    screenRelevant: relevance.attach,
    screenReason: relevance.reason,
    screenContextId: screen?.screenContextId || null,
  })
  return { q, classification, relevance, ctx }
}

function expectExperienceish(type) {
  expect(['experience', 'intro', 'behavioral', 'project', 'project_walkthrough', 'situational', 'leadership']).toContain(type)
}

describe('TEST A — System design IRCTC chain', () => {
  const profile = { targetRole: 'Software Engineer' }

  it('classifies IRCTC root + follow-ups + topic reset to experience', () => {
    const state = createInterviewState({ profile })
    let last = null

    const a1 = runTurn(state, 'Design an IRCTC-like train booking system.', profile, last)
    expect(a1.classification.questionType).toBe('system_design')
    expect(a1.classification.roleFamily).toBe('software_engineering')
    expect(a1.classification.isFollowUp).toBe(false)
    expect(a1.q.parentQuestionId).toBeNull()
    last = { ...a1.classification, parentTopic: a1.q.text, question: a1.q.text }

    const a2 = runTurn(state, 'What are your functional requirements?', profile, last)
    expect(a2.classification.questionType).toMatch(/system_design|follow_up/)
    // If marked follow_up, parent type must be system_design
    if (a2.classification.isFollowUp) {
      expect(a2.classification.parentType).toBe('system_design')
      expect(a2.q.parentQuestionId).toBe(a1.q.id)
    } else {
      expect(a2.classification.questionType).toBe('system_design')
    }
    last = {
      questionType: a2.classification.isFollowUp ? 'follow_up' : a2.classification.questionType,
      parentType: a2.classification.parentType || 'system_design',
      parentTopic: a1.q.text,
      question: a2.q.text,
    }

    const a3 = runTurn(state, 'Okay. What about non-functional requirements?', profile, last)
    expect(a3.classification.isFollowUp || a3.classification.questionType === 'system_design').toBe(true)
    if (a3.classification.isFollowUp) expect(a3.classification.parentType).toBe('system_design')

    last = {
      questionType: a3.classification.isFollowUp ? 'follow_up' : a3.classification.questionType,
      parentType: 'system_design',
      parentTopic: a1.q.text,
      question: a3.q.text,
    }

    const a4 = runTurn(state, 'How would you handle concurrent seat booking?', profile, last)
    expect(a4.classification.isFollowUp || a4.classification.questionType === 'system_design').toBe(true)
    if (a4.classification.isFollowUp) expect(a4.classification.parentType).toBe('system_design')

    last = {
      questionType: a4.classification.isFollowUp ? 'follow_up' : 'system_design',
      parentType: 'system_design',
      parentTopic: a1.q.text,
      question: a4.q.text,
    }

    const a5 = runTurn(state, 'Why PostgreSQL?', profile, last)
    expect(a5.classification.isFollowUp).toBe(true)
    expect(a5.classification.parentType).toBe('system_design')
    expect(a5.q.parentQuestionId).toBeTruthy()

    last = {
      questionType: 'follow_up',
      parentType: 'system_design',
      parentTopic: a1.q.text,
      question: a5.q.text,
    }

    const a6 = runTurn(state, 'What if PostgreSQL goes down?', profile, last)
    expect(a6.classification.isFollowUp).toBe(true)
    expect(a6.classification.parentType).toBe('system_design')

    last = {
      questionType: 'follow_up',
      parentType: 'system_design',
      parentTopic: a1.q.text,
      question: a6.q.text,
    }

    const a7 = runTurn(state, "Tell me about the hardest production incident you've handled.", profile, last)
    expectExperienceish(a7.classification.questionType)
    expect(a7.classification.questionType).not.toBe('system_design')
    expect(a7.classification.isFollowUp).toBe(false)
    expect(a7.q.parentQuestionId).toBeNull()
    expect(a7.ctx.forbidden).toEqual(expect.arrayContaining(['previous_hld', 'irctc_architecture']))
  })
})

describe('TEST B — Intro / experience', () => {
  const profile = { targetRole: 'Backend Engineer', resume: 'Built payments at Acme' }

  it('keeps experience questions out of technical', () => {
    const state = createInterviewState({ profile })
    let last = null

    const b1 = runTurn(state, 'What do you do in your current role?', profile, last)
    expect(b1.classification.questionType).toBe('experience')
    expect(b1.classification.questionType).not.toBe('technical')
    last = { ...b1.classification, question: b1.q.text }

    const b2 = runTurn(state, 'What are your strengths?', profile, last)
    expect(b2.classification.questionType).toBe('experience')
    expect(b2.classification.questionType).not.toBe('technical')
    expect(b2.ctx.allowed.join(',')).toMatch(/resume/)
    expect(b2.ctx.forbidden).toEqual(expect.arrayContaining(['previous_hld', 'irctc_architecture']))

    last = { ...b2.classification, question: b2.q.text }
    const b3 = runTurn(state, 'Tell me about a difficult project.', profile, last)
    expect(['project', 'project_walkthrough', 'experience']).toContain(b3.classification.questionType)

    last = {
      questionType: b3.classification.questionType,
      parentType: b3.classification.questionType,
      parentTopic: b3.q.text,
      question: b3.q.text,
    }
    const b4 = runTurn(state, 'What was your contribution?', profile, last)
    expect(b4.classification.isFollowUp || ['experience', 'project', 'project_walkthrough'].includes(b4.classification.questionType)).toBe(true)
    if (b4.classification.isFollowUp) {
      expect(['project', 'project_walkthrough', 'experience']).toContain(b4.classification.parentType)
    }
  })
})

describe('TEST C — DSA then behavioral', () => {
  const profile = { targetRole: 'Software Engineer', codingLanguage: 'Java' }

  it('DSA chain then behavioral topic reset', () => {
    const state = createInterviewState({ profile })
    let last = null

    const c1 = runTurn(state, 'Given an array of integers, find two numbers that sum to a target.', profile, last)
    expect(c1.classification.questionType).toBe('dsa')
    expect(c1.ctx.allowed).toContain('coding_language')
    last = { ...c1.classification, parentTopic: c1.q.text, question: c1.q.text }

    const c2 = runTurn(state, 'Can you optimize this?', profile, last)
    expect(c2.classification.isFollowUp || c2.classification.questionType === 'dsa').toBe(true)
    if (c2.classification.isFollowUp) expect(c2.classification.parentType).toBe('dsa')

    last = {
      questionType: c2.classification.isFollowUp ? 'follow_up' : 'dsa',
      parentType: 'dsa',
      parentTopic: c1.q.text,
      question: c2.q.text,
    }
    const c3 = runTurn(state, "What's the time complexity?", profile, last)
    expect(c3.classification.isFollowUp || c3.classification.questionType === 'dsa').toBe(true)

    last = {
      questionType: 'follow_up',
      parentType: 'dsa',
      parentTopic: c1.q.text,
      question: c3.q.text,
    }
    const c4 = runTurn(state, 'Write it in Java.', profile, last)
    expect(c4.classification.isFollowUp || c4.classification.questionType === 'dsa').toBe(true)
    const needs = contextNeedsFor(
      c4.classification.isFollowUp ? (c4.classification.parentType || 'dsa') : c4.classification.questionType,
      { isFollowUp: c4.classification.isFollowUp, parentType: 'dsa' },
    )
    expect(needs.codingLanguage).toBe(true)

    last = {
      questionType: 'follow_up',
      parentType: 'dsa',
      parentTopic: c1.q.text,
      question: c4.q.text,
    }
    const c5 = runTurn(state, 'Now tell me about a conflict you had with a teammate.', profile, last)
    expect(c5.classification.questionType).toBe('behavioral')
    expect(c5.classification.isFollowUp).toBe(false)
  })
})

describe('TEST D — PM product design (not SWE HLD)', () => {
  const profile = { targetRole: 'Product Manager' }

  it('PM feature design + metrics + tradeoffs', () => {
    expect(inferRoleFamily(profile)).toBe('product')
    const state = createInterviewState({ profile })
    let last = null

    const d1 = runTurn(state, 'Design a feature for booking trains.', profile, last)
    expect(d1.classification.questionType).toBe('product_case')
    expect(d1.classification.questionType).not.toBe('system_design')
    expect(d1.classification.roleFamily).toBe('product')
    last = { ...d1.classification, parentTopic: d1.q.text, question: d1.q.text }

    const d2 = runTurn(state, 'What metrics would you track?', profile, last)
    expect(d2.classification.isFollowUp || d2.classification.questionType === 'product_case').toBe(true)
    if (d2.classification.isFollowUp) expect(d2.classification.parentType).toBe('product_case')

    last = {
      questionType: d2.classification.isFollowUp ? 'follow_up' : 'product_case',
      parentType: 'product_case',
      parentTopic: d1.q.text,
      question: d2.q.text,
    }
    const d3 = runTurn(state, 'What tradeoffs would you consider?', profile, last)
    expect(d3.classification.isFollowUp || ['product_case', 'strategy'].includes(d3.classification.questionType)).toBe(true)
  })
})

describe('TEST E — Sales objection', () => {
  const profile = { targetRole: 'Account Executive / Sales' }

  it('sales objection + follow-up', () => {
    expect(inferRoleFamily(profile)).toBe('sales')
    const state = createInterviewState({ profile })
    let last = null

    const e1 = runTurn(state, 'How would you handle a customer saying our product is too expensive?', profile, last)
    expect(e1.classification.questionType).toBe('sales_roleplay')
    last = { ...e1.classification, parentTopic: e1.q.text, question: e1.q.text }

    const e2 = runTurn(state, 'What if they still refuse?', profile, last)
    expect(e2.classification.isFollowUp || e2.classification.questionType === 'sales_roleplay').toBe(true)
    if (e2.classification.isFollowUp) expect(e2.classification.parentType).toBe('sales_roleplay')
  })
})

describe('TEST F — Screen + spoken', () => {
  const profile = { targetRole: 'Software Engineer' }
  const now = Date.now()
  const codeScreen = {
    screenContextId: 'sc_code',
    contentType: 'coding',
    timestamp: now,
    analysis: { contentType: 'coding' },
  }
  const diagramScreen = {
    screenContextId: 'sc_diag',
    contentType: 'system_design',
    timestamp: now,
    analysis: { contentType: 'system_design' },
  }

  it('attaches screen only when relevant', () => {
    const state = createInterviewState({ profile })

    const f1 = runTurn(state, 'What does this code do?', profile, null, codeScreen)
    expect(f1.relevance.attach).toBe(true)
    expect(f1.classification.questionType).toMatch(/screen_code|dsa|coding/)
    expect(f1.ctx.allowed).toContain('screen')

    const f2 = runTurn(state, "What's your biggest strength?", profile, {
      ...f1.classification, question: f1.q.text,
    }, codeScreen)
    expect(f2.relevance.attach).toBe(false)
    expect(f2.ctx.forbidden).toContain('screen')
    expectExperienceish(f2.classification.questionType)

    const f3 = runTurn(state, 'Explain this architecture.', profile, {
      ...f2.classification, question: f2.q.text,
    }, diagramScreen)
    expect(f3.relevance.attach).toBe(true)
    expect(f3.ctx.allowed).toContain('screen')

    const f4 = runTurn(state, 'Tell me about your current role.', profile, {
      ...f3.classification, question: f3.q.text,
    }, diagramScreen)
    expect(f4.relevance.attach).toBe(false)
    expect(f4.classification.questionType).toBe('experience')
  })
})

describe('TEST G — Interruptions / stale generation', () => {
  it('old generation cancelled; chunks cannot appear in final UI', () => {
    const state = createInterviewState({ profile: { targetRole: 'SWE' } })
    const gm = createGenerationManager()
    const ui = { answer: '' }

    const q1 = state.beginQuestion('Design IRCTC.', {
      questionType: 'system_design', isFollowUp: false, roleFamily: 'software_engineering',
    })
    const g1 = gm.start({ questionId: q1.id })
    g1.markGenerating()

    // Interrupt
    const q2 = state.beginQuestion('Actually, tell me about your hardest production issue.', {
      questionType: 'experience', isFollowUp: false, roleFamily: 'software_engineering',
    })
    const g2 = gm.start({ questionId: q2.id, reason: 'topic_switch' })
    g2.markGenerating()

    expect(g1.status).toBe('stale')
    expect(g1.canCommit()).toBe(false)

    if (g1.canCommit()) {
      ui.answer = 'IRCTC HLD...'
      state.commitAnswer({ questionId: q1.id, generationId: g1.generationId, text: ui.answer })
    }
    if (g2.canCommit()) {
      ui.answer = 'Hardest incident: ...'
      state.commitAnswer({ questionId: q2.id, generationId: g2.generationId, text: ui.answer })
      g2.complete()
    }

    expect(ui.answer).toBe('Hardest incident: ...')
    expect(state.getSnapshot().lastAnswer.text).toBe('Hardest incident: ...')
    expect(state.getSnapshot().lastAnswer.generationId).toBe(g2.generationId)
    expect(state.getSnapshot().lastAnswer.questionId).toBe(q2.id)
  })
})

describe('TEST H — Ambiguous follow-up Why?', () => {
  const profile = { targetRole: 'Software Engineer' }

  it('Why? binds to sharding; strengths resets', () => {
    const state = createInterviewState({ profile })
    let last = null

    const h1 = runTurn(state, 'How would you shard the booking database?', profile, last)
    expect(h1.classification.questionType).toBe('system_design')
    last = { ...h1.classification, parentTopic: h1.q.text, question: h1.q.text }

    const h2 = runTurn(state, 'Why?', profile, last)
    expect(h2.classification.isFollowUp).toBe(true)
    expect(h2.q.parentQuestionId).toBe(h1.q.id)
    expect(h2.classification.parentType).toBe('system_design')

    last = {
      questionType: 'follow_up',
      parentType: 'system_design',
      parentTopic: h1.q.text,
      question: h2.q.text,
    }
    const h3 = runTurn(state, 'What are your strengths?', profile, last)
    expect(h3.classification.questionType).toBe('experience')
    expect(h3.classification.isFollowUp).toBe(false)
  })
})

describe('TEST I — Topic reset', () => {
  const profile = { targetRole: 'Software Engineer' }

  it('behavioral switch clears HLD parent contamination', () => {
    const state = createInterviewState({ profile })
    let last = null

    const i1 = runTurn(state, 'How would you design IRCTC?', profile, last)
    expect(i1.classification.questionType).toBe('system_design')
    last = { ...i1.classification, parentTopic: i1.q.text, question: i1.q.text }

    const i2 = runTurn(state, 'What about caching?', profile, last)
    last = {
      questionType: i2.classification.isFollowUp ? 'follow_up' : i2.classification.questionType,
      parentType: 'system_design',
      parentTopic: i1.q.text,
      question: i2.q.text,
    }

    const i3 = runTurn(state, "Let's switch topics. Tell me about a time you disagreed with your manager.", profile, last)
    expect(i3.classification.questionType).toBe('behavioral')
    expect(i3.q.parentQuestionId).toBeNull()
    expect(i3.ctx.forbidden).toEqual(expect.arrayContaining(['previous_hld', 'irctc_architecture']))
  })
})

describe('PART 4 — Context selection contracts', () => {
  it('strengths: resume allowed, IRCTC forbidden', () => {
    const c = classifyTurn({
      question: 'What are your strengths?',
      profile: { targetRole: 'SWE', resume: 'x' },
      lastClassification: {
        questionType: 'follow_up', parentType: 'system_design', parentTopic: 'Design IRCTC',
      },
    })
    expect(c.questionType).toBe('experience')
    const ctx = resolveContextSources({ classification: c, hasPriorTopicDiscussion: true })
    expect(ctx.allowed.join(',')).toMatch(/resume/)
    expect(ctx.forbidden).toEqual(expect.arrayContaining(['previous_hld', 'irctc_architecture']))
  })

  it('Why PostgreSQL: HLD history allowed, resume dump not required', () => {
    const c = classifyTurn({
      question: 'Why PostgreSQL?',
      profile: { targetRole: 'SWE' },
      conversationHistory: [{ role: 'interviewer', text: 'Design IRCTC' }],
      lastClassification: {
        questionType: 'system_design', parentTopic: 'Design IRCTC', question: 'Design IRCTC',
      },
    })
    expect(c.isFollowUp).toBe(true)
    const ctx = resolveContextSources({ classification: c, hasPriorTopicDiscussion: true })
    expect(ctx.allowed).toEqual(expect.arrayContaining(['previous_hld', 'conversation_history']))
    expect(ctx.forbidden).toEqual(expect.arrayContaining(['resume_dump']))
  })

  it('hardest production incident: experience, no IRCTC', () => {
    const c = classifyTurn({
      question: 'Tell me about your hardest production incident.',
      profile: { targetRole: 'SWE' },
      lastClassification: {
        questionType: 'follow_up', parentType: 'system_design', parentTopic: 'IRCTC',
      },
    })
    expect(c.questionType).toBe('experience')
    const ctx = resolveContextSources({ classification: c })
    expect(ctx.allowed.join(',')).toMatch(/resume/)
    expect(ctx.forbidden).toEqual(expect.arrayContaining(['irctc_architecture', 'previous_hld']))
  })
})

describe('PART 5 — Dev trace', () => {
  it('formats a readable single-line trace', () => {
    const state = createInterviewState({ profile: { targetRole: 'SWE' } })
    const gm = createGenerationManager()
    const q = state.beginQuestion('Why PostgreSQL?', {
      questionType: 'follow_up',
      isFollowUp: true,
      parentType: 'system_design',
      roleFamily: 'software_engineering',
      confidence: 'high',
      contextNeeds: contextNeedsFor('system_design'),
    }, { parentQuestionId: 'q_parent', contextSources: ['previous_hld'] })
    const g = gm.start({ questionId: q.id })
    g.markGenerating()
    const trace = state.getDevTrace(q.id, g)
    const line = formatInterviewDevTrace({
      ...trace,
      contextSources: q.contextSources,
      generationStatus: g.status,
    })
    expect(line).toContain(q.id)
    expect(line).toContain('follow_up')
    expect(line).toContain('previous_hld')
    expect(line).toMatch(/generation=g_/)
  })
})

describe('InterviewState authority', () => {
  it('LLM history does not treat AI answers as candidate speech', () => {
    const state = createInterviewState()
    state.beginQuestion('Design X', { questionType: 'system_design', isFollowUp: false })
    state.recordCandidate('I would start with requirements')
    state.commitAnswer({ questionId: state.getCurrentQuestionId(), generationId: 'g1', text: 'AI suggested HLD...' })
    const hist = state.getLlmHistory({ includeLastAnswer: true })
    const roles = hist.map(t => t.role)
    expect(roles).toContain('interviewer')
    expect(roles).toContain('candidate')
    expect(roles.filter(r => r === 'assistant').length).toBeLessThanOrEqual(1)
    expect(hist.find(t => t.role === 'candidate')?.text).not.toContain('AI suggested')
  })

  it('question ids are stable across snapshot', () => {
    const state = createInterviewState()
    const q = state.beginQuestion('Q1', { questionType: 'experience', isFollowUp: false })
    const snap = state.getSnapshot()
    expect(snap.currentQuestion.id).toBe(q.id)
    expect(state.getQuestion(q.id).text).toBe('Q1')
  })
})
