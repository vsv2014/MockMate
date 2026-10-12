// Credential presence and model availability are different states. No secrets needed.
export function configuredKeyRows(data = {}) {
  if (Array.isArray(data.allProviders)) return data.allProviders.filter(row => row.configured)
  if (Array.isArray(data.providers)) return data.providers
  throw new Error('Provider status response is incomplete')
}

export function keyFieldStatus({ added = false, edited = false, status = 'ready', testStatus } = {}) {
  if (edited) return added ? 'Replacement not saved' : 'New value not saved'
  if (status === 'loading') return 'Checking key status…'
  if (status === 'error') return 'Key status unavailable'
  if (!added) return 'Not configured'
  if (testStatus === 'testing') return 'Key detected · testing…'
  if (testStatus === 'ok') return 'Key detected · test passed'
  if (testStatus === 'error') return 'Key detected · test failed'
  return 'Key detected · not tested'
}
