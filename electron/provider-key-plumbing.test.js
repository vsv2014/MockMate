import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL_CATALOG } from '../shared/modelRegistry.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

const bootstrap = read('electron/bootstrap.cjs')
const main = read('electron/main.cjs')
const setup = read('setup.html')
const hostedConfig = read('backend/src/hostedConfig.js')
const arch = read('backend/src/arch.js')

// Every key a user can save in Settings must survive the whole desktop path:
// bootstrap allowlist → main-process key detection → removal map → first-run setup.
// v1.6.4 added OpenRouter to the UI and the API but not to these lists, so the
// hardened write-env handler silently dropped OPENROUTER_API_KEY and the key
// never appeared in Settings, the Ready Room or Live.
const LLM_ENV_KEYS = [...new Set(Object.values(MODEL_CATALOG).map(record => record.envKey))].sort()
const VOICE_ENV_KEY = 'DEEPGRAM_API_KEY'
const ALL_ENV_KEYS = [...LLM_ENV_KEYS, VOICE_ENV_KEY].sort()

describe('provider key plumbing (desktop)', () => {
  it('discovers every provider key in the shared catalog', () => {
    // Guards the test itself: a catalog change must keep these lists non-trivial.
    expect(LLM_ENV_KEYS).toContain('OPENROUTER_API_KEY')
    expect(LLM_ENV_KEYS.length).toBeGreaterThanOrEqual(6)
  })

  it('lets every provider key through the bootstrap write-env allowlist', () => {
    const allowlist = bootstrap.match(/const ENV_KEYS = new Set\(\[([\s\S]*?)\]\)/)?.[1] || ''
    expect(allowlist).not.toBe('')
    for (const envKey of ALL_ENV_KEYS) expect(allowlist, `${envKey} missing from electron/bootstrap.cjs ENV_KEYS`).toContain(`'${envKey}'`)
  })

  it('allows every per-provider model override so a pinned model id is not dropped', () => {
    const allowlist = bootstrap.match(/const ENV_KEYS = new Set\(\[([\s\S]*?)\]\)/)?.[1] || ''
    for (const record of Object.values(MODEL_CATALOG)) {
      for (const override of record.envOverrides || []) {
        expect(allowlist, `${override} missing from electron/bootstrap.cjs ENV_KEYS`).toContain(`'${override}'`)
      }
    }
  })

  it('counts every AI key as "keys configured" so BYOK users are not sent to setup', () => {
    const hasApiKeys = main.match(/function hasApiKeys\(\) \{([\s\S]*?)\n\}/)?.[1] || ''
    expect(hasApiKeys).not.toBe('')
    for (const envKey of LLM_ENV_KEYS) expect(hasApiKeys, `${envKey} missing from hasApiKeys()`).toContain(envKey)
  })

  it('can remove every provider key from Settings', () => {
    const keysByProvider = main.match(/const keysByProvider = \{([\s\S]*?)\n  \}/)?.[1] || ''
    expect(keysByProvider).not.toBe('')
    // Settings removes a provider by id: OPENROUTER_API_KEY → 'openrouter'.
    for (const envKey of ALL_ENV_KEYS) {
      const providerId = envKey.replace('_API_KEY', '').toLowerCase()
      expect(keysByProvider, `${providerId} missing from remove-provider-key`).toContain(`${providerId}: [`)
    }
  })

  it('offers every provider key on the first-run setup screen', () => {
    for (const envKey of ALL_ENV_KEYS) {
      expect(setup, `${envKey} has no input on setup.html`).toContain(`id="${envKey}"`)
      expect(setup, `${envKey} is not persisted by setup.html`).toMatch(new RegExp(`KEYS = \\[[^\\]]*'${envKey}'`))
    }
    for (const envKey of LLM_ENV_KEYS) {
      expect(setup, `${envKey} does not satisfy the setup LLM requirement`).toMatch(new RegExp(`LLM  = \\[[^\\]]*'${envKey}'`))
    }
    expect(setup).not.toMatch(new RegExp(`LLM  = \\[[^\\]]*'${VOICE_ENV_KEY}'`))
  })

  it('keeps hosted and ARCH provider maps in sync with the catalog', () => {
    for (const envKey of LLM_ENV_KEYS) {
      expect(hostedConfig, `${envKey} missing from hostedConfig hasLlmProvider`).toContain(`'${envKey}'`)
      expect(arch, `${envKey} missing from arch LLM_PROVIDERS`).toContain(`'${envKey}'`)
    }
  })
})
