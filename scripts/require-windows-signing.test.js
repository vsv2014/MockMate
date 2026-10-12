import { describe, expect, it } from 'vitest'
import { requireWindowsSigning } from './require-windows-signing.mjs'
const pkg = { build: { publish: [{ provider: 'github' }], win: { forceCodeSigning: true, verifyUpdateCodeSignature: true } } }
const env = { WIN_CSC_LINK: 'test-cert', WIN_CSC_KEY_PASSWORD: 'test-password', SIGNING_PUBLISHER: 'test-publisher' }
it('allows only complete signing configuration', () => expect(requireWindowsSigning(env, pkg)).toBe(true))
it.each(Object.keys(env))('fails closed when %s is missing without exposing secrets', name => {
  expect(() => requireWindowsSigning({ ...env, [name]: '' }, pkg)).toThrow(name)
  try { requireWindowsSigning({ ...env, [name]: '' }, pkg) } catch (error) { expect(error.message).not.toContain('test-password') }
})
it('rejects unsigned preview identity or weakened signing', () => {
  expect(() => requireWindowsSigning(env, { ...pkg, personalPreviewBuild: true })).toThrow()
  expect(() => requireWindowsSigning(env, { build: { ...pkg.build, win: { ...pkg.build.win, forceCodeSigning: false } } })).toThrow()
})
