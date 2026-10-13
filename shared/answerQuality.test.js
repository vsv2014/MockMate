import { describe, expect, it } from 'vitest'
import { requiresImplementation, implementationIssue, showFullCodeDuringStream } from './answerQuality.js'
import { interviewAnswerPolicy } from '../backend/src/arch.js'

describe('ARCH interview completeness policy', () => {
  it.each(['concise','balanced','detailed'])('reserves implementation room for %s on either hint transport', style => {
    const policy=interviewAnswerPolicy({ question:'Find the minimum jumps to reach the last index',classification:{questionType:'dsa'},style,baseBudget:380 })
    expect(policy.requiresCode).toBe(true); expect(policy.maxTokens).toBeGreaterThanOrEqual(3600)
    expect(policy.directive).toContain('complete runnable fenced implementation')
  })
  it.each([
    ['show the snippet',{isFollowUp:true,parentType:'dsa'},true],
    ['write console',{isFollowUp:true,parentType:'coding'},true],
    ['What is its time complexity?',{isFollowUp:true,parentType:'dsa'},false],
    ['Explain only the approach',{questionType:'dsa'},false],
    ['Find subarray sum, without code',{questionType:'dsa'},false],
    ['What is dynamic programming?',{questionType:'dsa'},false],
    ['Design a RAG pipeline',{questionType:'system_design'},false],
    ['Tell me about your project',{questionType:'experience'},false],
  ])('classifies implementation requirement: %s', (q,c,expected) => expect(requiresImplementation(q,c)).toBe(expected))
  it('does not override Coach mode or small conversational budgets', () => {
    expect(requiresImplementation('Implement a heap',{questionType:'dsa'},'coach')).toBe(false)
    expect(interviewAnswerPolicy({question:'What is cloud computing?',classification:{questionType:'technical'},baseBudget:380}).maxTokens).toBe(380)
  })
  it('detects absent/unfinished code without claiming correctness of a closed block', () => {
    expect(implementationIssue('Use a hashmap',true)).toBe('code_missing')
    expect(implementationIssue('```ts\nfunction f() {',true)).toBe('code_unfinished')
    expect(implementationIssue('```ts\n```',true)).toBe('code_missing')
    expect(implementationIssue('```ts\nfunction f() { return 1 }\n```',true)).toBeNull()
    expect(implementationIssue('Explanation only',false)).toBeNull()
    expect(showFullCodeDuringStream('Approach\n```typescript\nfunction f()')).toBe(true)
  })
})

 describe('ARCH diagram requests', () => {
  it.each(['draw that', 'show the architecture diagram', 'visualize the RAG pipeline'])('provides a renderable diagram contract for %s', question => {
    const policy = interviewAnswerPolicy({question,classification:{isFollowUp:true,parentType:'system_design'},baseBudget:380})
    expect(policy.requiresDiagram).toBe(true)
    expect(policy.directive).toContain('fenced mermaid')
    expect(policy.maxTokens).toBeGreaterThanOrEqual(3600)
  })
  it('respects no-diagram and coach requests', () => {
    expect(interviewAnswerPolicy({question:'Explain without a diagram',classification:{questionType:'system_design'},baseBudget:380}).requiresDiagram).toBe(false)
    expect(interviewAnswerPolicy({question:'draw that',mode:'coach',classification:{questionType:'system_design'},baseBudget:380}).requiresDiagram).toBe(false)
  })
})
