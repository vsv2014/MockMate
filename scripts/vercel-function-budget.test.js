import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const apiDirectory = fileURLToPath(new URL('../api/', import.meta.url))

function deployableFunctions() {
  return readdirSync(apiDirectory)
    .filter(name => name.endsWith('.js') && !name.startsWith('_'))
    .sort()
}

describe('Vercel Hobby function budget', () => {
  it('keeps tests and helpers out of the deployable api root', () => {
    const functions = deployableFunctions()
    expect(functions.filter(name => name.includes('.test.'))).toEqual([])
    expect(functions).toHaveLength(12)
  })
})
