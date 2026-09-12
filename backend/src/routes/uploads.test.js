import { describe, expect, it } from 'vitest'
import { extractText } from './uploads.js'

describe('hosted document extraction', () => {
  it('accepts plain text without changing its contents', async () => {
    await expect(extractText({
      mimetype: 'text/plain',
      originalname: 'resume.txt',
      buffer: Buffer.from('MockMate mobile résumé'),
    })).resolves.toBe('MockMate mobile résumé')
  })

  it('rejects unsupported document formats', async () => {
    await expect(extractText({
      mimetype: 'image/png',
      originalname: 'resume.png',
      buffer: Buffer.from('not a document'),
    })).rejects.toMatchObject({ status: 415 })
  })
})
