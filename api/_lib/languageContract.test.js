import { describe, it, expect } from 'vitest'
import { answerRequirementBlock } from './interview.js'
import { CODING_LANGUAGES } from '../../src/lib/languages.js'
describe('coding language contracts', () => {
  it.each(CODING_LANGUAGES)('carries %s into a spoken coding follow-up', codingLanguage => {
    expect(answerRequirementBlock('show the snippet',{codingLanguage},{isFollowUp:true,parentType:'dsa'})).toContain(`LANGUAGE CONTRACT: Use ${codingLanguage}`)
  })
  it.each(['C++','C#','Ruby','Rust','Kotlin','Swift','C'])('recognizes explicit %s over the profile', language => {
    expect(answerRequirementBlock(`Implement a heap in ${language}`,{codingLanguage:'Python'},{questionType:'dsa'})).toContain(`LANGUAGE CONTRACT: Use ${language};`)
  })
})
