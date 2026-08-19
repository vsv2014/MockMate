import { describe, it, expect } from 'vitest'
import { pickPlaybook, packCandidateContext, analyzeScreen, answerRequirementBlock } from './interview.js'
import { classifyTurn } from '../../shared/interviewClassify.js'
import { glanceLayers } from '../../shared/hintLayers.js'

describe('current-turn output and evidence contracts', () => {
  it('requires code and prefers the JD language when unspecified', () => {
    const out = answerRequirementBlock(
      'Can you write an asynchronous API test with five concurrent requests?',
      { jobDescription: 'Required: JavaScript async/await and Playwright' },
    )
    expect(out).toMatch(/complete runnable code/i)
    expect(out).toMatch(/prefer JavaScript/i)
    expect(out).toMatch(/JD describes desired skills/i)
  })

  it('honors an explicitly requested language', () => {
    const out = answerRequirementBlock('Write the function in Python', { jobDescription: 'JavaScript' })
    expect(out).toMatch(/Use Python/i)
    expect(out).not.toMatch(/prefer JavaScript/i)
  })
})

describe('pickPlaybook (question classification)', () => {
  const cases = [
    ['explain temporal dead zone in JavaScript', 'technical'],
    ['what is the difference between let and const', 'technical'],
    ['reverse a linked list', 'dsa'],
    ['find the longest substring without repeating characters', 'dsa'],
    ['design a URL shortener', 'system_design'],
    ['design IRCTC train booking system', 'system_design'],
    ['how would you design a train reservation system', 'system_design'],
    ['system design for a ticket booking platform', 'system_design'],
    ['tell me about a time you had a conflict', 'behavioral'],
    ['walk me through your most challenging project', 'project_walkthrough'],
    ['why do you want to work here', 'company'],
    ['tell me about yourself', 'intro'],
    ['what do you do in your current role?', 'experience'],
    ['what are your strengths?', 'experience'],
    ['what are your weaknesses?', 'experience'],
    ['why are you looking for a change?', 'experience'],
    ['what did you personally build?', 'experience'],
    ['tell me about a production incident', 'experience'],
  ]
  for (const [q, key] of cases) {
    it(`"${q}" → ${key}`, () => expect(pickPlaybook(q).key).toBe(key))
  }
  it('falls back to general for unclassifiable input', () => {
    expect(pickPlaybook('so anyway').key).toBe('general')
  })
})

describe('manual screen capture precedence', () => {
  it('does not send the previous spoken question unless the caller explicitly opts in', async () => {
    let capturedPrompt = ''
    let capturedDetail = ''
    const analysis = await analyzeScreen({
      imageBase64: 'aaaa',
      spokenQuestion: 'previous OCR question that must not hijack the new screen',
      _visionCall: async ({ prompt, detail }) => {
        capturedPrompt = prompt
        capturedDetail = detail
        return JSON.stringify({
          contentType: 'other', screenFamily: 'screen_text', detectedText: 'new visible QA question',
          keyPoints: ['answer'], fullAnswer: 'new answer', code: null, approach: [], edgeCases: [],
        })
      },
    })
    expect(capturedPrompt).not.toContain('previous OCR question')
    expect(capturedPrompt).toContain('answer THAT visible question directly')
    expect(capturedDetail).toBe('auto')
    expect(analysis.detectedText).toBe('new visible QA question')
  })

  it('allows matched spoken context only through an explicit opt-in', async () => {
    let capturedPrompt = ''
    await analyzeScreen({
      imageBase64: 'aaaa',
      spokenQuestion: 'explain this visible diagram',
      useSpokenContext: true,
      _visionCall: async ({ prompt }) => {
        capturedPrompt = prompt
        return JSON.stringify({ contentType: 'system_design', detectedText: 'diagram', keyPoints: [], fullAnswer: 'answer' })
      },
    })
    expect(capturedPrompt).toContain('explain this visible diagram')
    expect(capturedPrompt).toContain('secondary evidence only')
  })

  it('merges a confirmed second screenshot into one complete question', async () => {
    let capturedPrompt = ''
    const out = await analyzeScreen({
      imageBase64: 'bbbb',
      previousScreen: {
        screenContextId: 'sc_first',
        detectedText: 'Write an asynchronous test that sends requests',
        contentType: 'coding',
      },
      _visionCall: async ({ prompt }) => {
        capturedPrompt = prompt
        return JSON.stringify({
          contentType: 'coding', screenFamily: 'screen_code', isContinuation: true,
          detectedText: 'Write an asynchronous test that sends requests with at most five concurrent requests',
          language: 'Python', code: 'async def run():\n    pass', approach: ['semaphore'], edgeCases: [],
          keyPoints: [], fullAnswer: 'Use a semaphore capped at five.',
        })
      },
    })
    expect(capturedPrompt).toContain('POSSIBLE PREVIOUS SCREENSHOT')
    expect(capturedPrompt).toContain('Write an asynchronous test that sends requests')
    expect(out.isContinuation).toBe(true)
    expect(out.continuationOf).toBe('sc_first')
    expect(out.detectedText).toMatch(/five concurrent/i)
  })

  it('cannot claim continuation when no previous screenshot was supplied', async () => {
    const out = await analyzeScreen({
      imageBase64: 'cccc',
      _visionCall: async () => JSON.stringify({
        contentType: 'other', screenFamily: 'screen_text', isContinuation: true,
        detectedText: 'Independent question', keyPoints: [], fullAnswer: 'Independent answer',
      }),
    })
    expect(out.isContinuation).toBe(false)
    expect(out.continuationOf).toBeUndefined()
  })

  it('honors an explicit Continue question override', async () => {
    const out = await analyzeScreen({
      imageBase64: 'dddd',
      continuationMode: 'continue',
      previousScreen: { screenContextId: 'sc_manual', detectedText: 'first portion' },
      _visionCall: async () => JSON.stringify({
        contentType: 'other', screenFamily: 'screen_text', isContinuation: false,
        detectedText: 'first portion plus second portion', keyPoints: [], fullAnswer: 'combined',
      }),
    })
    expect(out.isContinuation).toBe(true)
    expect(out.continuationOf).toBe('sc_manual')
  })

  it('normalizes provider string continuation values', async () => {
    const out = await analyzeScreen({
      imageBase64: 'eeee',
      previousScreen: { screenContextId: 'sc_string', detectedText: 'first half' },
      _visionCall: async () => JSON.stringify({
        contentType: 'other', screenFamily: 'screen_text', isContinuation: 'true',
        detectedText: 'first half and second half', keyPoints: [], fullAnswer: 'combined answer',
      }),
    })
    expect(out.isContinuation).toBe(true)
    expect(out.continuationOf).toBe('sc_string')
  })

  it('treats a selected coding language as a strict transform', async () => {
    let visionPrompt = ''
    let rewritePrompt = ''
    const out = await analyzeScreen({
      imageBase64: 'aaaa',
      language: 'Python',
      _visionCall: async ({ prompt }) => {
        visionPrompt = prompt
        return JSON.stringify({
          contentType: 'coding', screenFamily: 'screen_code', detectedText: 'find largest',
          language: 'JavaScript', code: 'function max(a) { return Math.max(...a) }',
          approach: ['scan'], edgeCases: ['empty'], keyPoints: [], fullAnswer: 'scan once',
        })
      },
      _textCall: async ({ prompt }) => {
        rewritePrompt = prompt
        return JSON.stringify({
          contentType: 'coding', screenFamily: 'screen_code', detectedText: 'find largest',
          language: 'Python', code: 'def max_value(values):\n    return max(values)',
          approach: ['scan'], edgeCases: ['empty'], keyPoints: [], fullAnswer: 'scan once',
        })
      },
    })
    expect(visionPrompt).toMatch(/EXPLICIT USER LANGUAGE OVERRIDE/i)
    expect(rewritePrompt).toMatch(/explicitly selected Python/i)
    expect(out.language).toBe('Python')
    expect(out.code).toMatch(/^def /)
    expect(out.code).not.toMatch(/function /)
  })
})

describe('follow-up + topic switch (golden)', () => {
  const hist = (q) => [{ role: 'interviewer', text: q }]
  const last = (type, topic) => ({ questionType: type, parentTopic: topic, playbookKey: type })

  it('Why PostgreSQL? after Design IRCTC → follow_up (not technical)', () => {
    const pb = pickPlaybook('Why PostgreSQL?', {
      conversationHistory: hist('Design an IRCTC-like train booking system.'),
      lastClassification: last('system_design', 'Design an IRCTC-like train booking system.'),
    })
    expect(pb.key).toBe('follow_up')
    expect(pb.classification.parentType).toBe('system_design')
  })

  it('What if payment succeeds but booking fails? stays follow_up', () => {
    const pb = pickPlaybook('What happens if payment succeeds but booking confirmation fails?', {
      conversationHistory: hist('Design IRCTC'),
      lastClassification: last('system_design', 'Design IRCTC'),
    })
    expect(pb.key).toBe('follow_up')
  })

  it('hardest production incident after HLD → experience (not sticky HLD)', () => {
    const pb = pickPlaybook('Okay, forget the design. Tell me about your hardest production incident.', {
      conversationHistory: hist('Design IRCTC'),
      lastClassification: last('system_design', 'Design IRCTC'),
    })
    expect(pb.key).toBe('experience')
  })

  it('Two Sum after behavioral → dsa', () => {
    const pb = pickPlaybook("Let's do a coding question. Two Sum.", {
      conversationHistory: hist('Tell me about a conflict'),
      lastClassification: last('behavioral', 'Tell me about a conflict'),
    })
    expect(pb.key).toBe('dsa')
  })

  it('short Why? inherits follow_up', () => {
    const pb = pickPlaybook('Why?', {
      conversationHistory: hist('Design IRCTC'),
      lastClassification: last('system_design', 'Design IRCTC'),
    })
    expect(pb.key).toBe('follow_up')
  })
})

describe('role-aware routing', () => {
  it('PM + design a food delivery feature → product_case', () => {
    const pb = pickPlaybook('Design a feature for food delivery.', {
      profile: { targetRole: 'Product Manager' },
    })
    expect(pb.key).toBe('product_case')
  })

  it('Sales + too expensive → sales_objection', () => {
    const pb = pickPlaybook('A customer says your product is too expensive.', {
      profile: { targetRole: 'Account Executive' },
    })
    expect(pb.key).toBe('sales_objection')
  })

  it('HR + employee conflict → hr_situational', () => {
    const pb = pickPlaybook('How would you handle an employee conflict?', {
      profile: { targetRole: 'HR Business Partner' },
    })
    expect(pb.key).toBe('hr_situational')
  })

  it('Marketing + launch product → marketing_strategy', () => {
    const pb = pickPlaybook('How would you launch this product?', {
      profile: { targetRole: 'Marketing Manager' },
    })
    expect(pb.key).toBe('marketing_strategy')
  })
})

describe('packCandidateContext (source hierarchy + gating)', () => {
  it('dumps resume/JD when no intent opts (legacy Solo path)', () => {
    const out = packCandidateContext({
      name: 'Ada',
      targetRole: 'SWE',
      resume: 'Built Kafka pipelines at Acme. '.repeat(20),
      jobDescription: 'Need Kafka + Go experience. '.repeat(10),
    })
    expect(out).toMatch(/CANDIDATE IDENTITY/)
    expect(out).toMatch(/CANDIDATE RESUME/)
    expect(out).toMatch(/JOB DESCRIPTION/)
    expect(out).toMatch(/Kafka/)
  })

  it('prefers retrieved docs and shortens resume when RAG present', () => {
    const longResume = 'PROJECT ALPHA '.repeat(200)
    const rag = 'RELEVANT FROM YOUR DOCUMENTS (ground the answer in these — they were retrieved for THIS question):\n- Doc note about Redis'
    const out = packCandidateContext({ resume: longResume, jobDescription: 'JD text '.repeat(50) }, rag)
    expect(out).toMatch(/RELEVANT FROM YOUR DOCUMENTS/)
    expect(out).toMatch(/RESUME FACT CARD/)
    expect(out).not.toMatch(/CANDIDATE RESUME \(ground truth/)
    expect(out.length).toBeLessThan(longResume.length)
  })

  it('includes custom voice instructions', () => {
    const out = packCandidateContext({ customPrompt: 'Sound casual, say "I shipped"' })
    expect(out).toMatch(/CANDIDATE VOICE/)
    expect(out).toMatch(/Sound casual/)
  })

  it('system_design uses soft resume fact card (not full dump / not veto)', () => {
    const c = classifyTurn({ question: 'Design IRCTC' })
    const out = packCandidateContext({
      resume: 'Built SmartAssist contact center. Kafka everywhere.',
      jobDescription: 'Need HLD skills',
      targetRole: 'SWE',
    }, '', { classification: c })
    expect(out).toMatch(/CONTEXT PRECEDENCE/)
    expect(out).toMatch(/CANDIDATE IDENTITY/)
    expect(out).toMatch(/RESUME FACT CARD/)
    expect(out).toMatch(/SmartAssist/)
    expect(out).not.toMatch(/CANDIDATE RESUME \(ground truth/)
    expect(out).not.toMatch(/JOB DESCRIPTION/)
  })

  it('dsa soft fact card + coding language when set', () => {
    const c = classifyTurn({ question: 'Two sum with HashMap' })
    const out = packCandidateContext({
      resume: 'Java expert at Acme',
      codingLanguage: 'Java',
    }, '', { classification: c })
    expect(out).toMatch(/RESUME FACT CARD/)
    expect(out).toMatch(/Java expert/)
    expect(out).toMatch(/Coding language for solutions: Java/)
  })

  it('experience includes resume', () => {
    const c = classifyTurn({ question: 'What are your strengths?' })
    const out = packCandidateContext({
      resume: 'Led payments migration; cut latency 40%.',
    }, '', { classification: c })
    expect(out).toMatch(/payments migration/)
  })
})

describe('glanceLayers (stream/JSON shared contract)', () => {
  it('builds opener + bullets from prose', () => {
    const layers = glanceLayers('First beat. Second beat. Third beat. Fourth keeps going.')
    expect(layers.opener).toBe('First beat.')
    expect(layers.keyPoints.length).toBeGreaterThanOrEqual(2)
    expect(layers.fullAnswer).toMatch(/Fourth/)
  })

  it('honors meta.keyPoints when provided', () => {
    const layers = glanceLayers('Only one sentence here.', { keyPoints: ['A', 'B', 'C'] })
    expect(layers.keyPoints).toEqual(['A', 'B', 'C'])
  })
})
