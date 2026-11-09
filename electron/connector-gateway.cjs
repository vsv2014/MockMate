// Electron-main connector gateway. No credentials in the renderer, AI service, or installer.
// OAuth is user-initiated; per-account source reads and sync are explicit and bounded.
const fs = require('fs')
const path = require('path')
const http = require('http')
const crypto = require('crypto')

const MAX_BYTES = 250 * 1024
const MODES = new Set(['github', 'googledrive', 'googlecalendar'])
const GOOGLE_SCOPES = {
  googledrive: 'openid email profile https://www.googleapis.com/auth/drive.readonly',
  googlecalendar: 'openid email profile https://www.googleapis.com/auth/calendar.events.readonly',
}
const fail = message => { throw new Error(message) }
const clean = (x, max = 500) => String(x ?? '').trim().slice(0, max)
const hash = s => crypto.createHash('sha256').update(s).digest('hex')
const random = () => crypto.randomBytes(32).toString('base64url')
const WAIT_MS = 10 * 60 * 1000
const time = () => Date.now()
const defaultVault = () => ({ version: 1, owners: {} })
function assertOwner(owner) { if (!/^[a-zA-Z0-9._-]{1,160}$/.test(String(owner || ''))) fail('Sign in to a valid MockMate account first'); return owner }
function providerCheck(provider) { if (!MODES.has(provider)) fail('Unsupported connector'); return provider }
function sourceCheck(provider, sourceId) {
  const id = clean(sourceId, 600)
  if (provider === 'github' && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+:[A-Za-z0-9_./-]+\.(md|markdown|txt)$/i.test(id)) fail('GitHub source must be owner/repo:path.md (no traversal)')
  if (provider === 'github' && (id.includes('..') || id.includes('//'))) fail('Unsafe GitHub path')
  if (provider === 'googledrive' && !/^[A-Za-z0-9_-]{8,160}$/.test(id)) fail('Invalid Drive file ID')
  if (provider === 'googlecalendar') {
    const p = id.split('::')
    if (p.length !== 2 || !p[0] || !p[1] || p.some(x => x.length > 180 || /[?#/\\]/.test(x))) fail('Invalid calendar event identifier')
  }
  return id
}
async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 12000, fetchImpl = fetch } = {}) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || ![
    'api.github.com', 'github.com', 'accounts.google.com', 'oauth2.googleapis.com',
    'www.googleapis.com',
  ].includes(parsed.hostname)) fail('Unsafe connector endpoint')
  const response = await fetchImpl(url, {
    method, headers: { 'Accept': 'application/json', ...headers },
    ...(body ? { body } : {}),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  })
  if (!response.ok) {
    if ([401, 403].includes(response.status)) fail('Connector authorization failed (' + response.status + '); reconnect or verify scopes')
    if (response.status === 404) fail('Selected source was not found or is not permitted')
    if (response.status === 429) fail('Connector rate limit reached; retry later')
    fail('Connector request HTTP ' + response.status)
  }
  const len = Number(response.headers?.get?.('content-length') || 0)
  if (len > MAX_BYTES * 4) fail('Connector response too large')
  const text = await response.text()
  if (Buffer.byteLength(text) > MAX_BYTES * 4) fail('Connector response too large')
  try { return JSON.parse(text) } catch { fail('Connector response was not JSON') }
}
function normalizedText(text) {
  if (typeof text !== 'string') fail('Selected source has no text')
  const out = text.replace(/\r\n?/g, '\n').normalize('NFC')
  if (!out.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(out)) fail('Selected source is empty or unsupported')
  if (Buffer.byteLength(out, 'utf8') > MAX_BYTES) fail('Source exceeds 250 KiB limit')
  return out
}
function accountPublic(record) {
  return { id: record.id, provider: record.provider, label: record.label, subject: record.subject,
    scopes: record.scopes || '', connectedAt: record.connectedAt, lastVerifiedAt: record.lastVerifiedAt }
}

function createConnectorGateway({ userData, safeStorage, openExternal, currentOwner, fetchImpl = fetch, now = time } = {}) {
  if (!userData || !safeStorage) fail('Connector gateway requires secure desktop storage')
  const file = path.join(userData, 'connected-accounts.v1.bin')
  const flows = new Map()
  const busy = new Set()
  let livePaused = false
  function ensureEncryption() {
    if (!safeStorage.isEncryptionAvailable()) fail('OS credential encryption unavailable. Connections are disabled; no plaintext token fallback.')
  }
  function readVault() {
    ensureEncryption()
    if (!fs.existsSync(file)) return defaultVault()
    try {
      const raw = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)))
      if (raw.version !== 1 || !raw.owners || typeof raw.owners !== 'object') fail('Invalid connector vault version')
      return raw
    } catch { fail('Could not decrypt connector vault; existing credentials have NOT been overwritten') }
  }
  function writeVault(data) {
    ensureEncryption()
    fs.mkdirSync(userData, { recursive: true })
    const temp = file + '.tmp'
    fs.writeFileSync(temp, safeStorage.encryptString(JSON.stringify(data)), { mode: 0o600 })
    try { fs.renameSync(temp, file) } catch (e) { try { fs.rmSync(temp, { force: true }) } catch {}; throw e }
  }
  function accountState(vault, owner) {
    assertOwner(owner)
    if (!vault.owners[owner]) vault.owners[owner] = { accounts: [], active: {}, subscriptions: [] }
    return vault.owners[owner]
  }
  function state(owner) {
    const vault = readVault()
    const row = accountState(vault, owner)
    return {
      accounts: row.accounts.map(accountPublic), active: { ...row.active },
      subscriptions: row.subscriptions.map(s => ({ ...s })),
      paused: livePaused,
    }
  }
  function setActive(owner, provider, accountId) {
    providerCheck(provider)
    const vault = readVault(), row = accountState(vault, owner)
    if (!row.accounts.some(x => x.id === accountId && x.provider === provider)) fail('Connected account not owned by current MockMate user')
    row.active[provider] = accountId
    writeVault(vault)
    return state(owner)
  }
  function removeAccount(owner, provider, accountId) {
    providerCheck(provider)
    const vault = readVault(), row = accountState(vault, owner)
    if (!row.accounts.some(x => x.id === accountId && x.provider === provider)) fail('Connection not found')
    row.accounts = row.accounts.filter(x => x.id !== accountId)
    row.subscriptions = row.subscriptions.filter(x => x.accountId !== accountId)
    if (row.active[provider] === accountId) {
      const next = row.accounts.find(x => x.provider === provider)
      if (next) row.active[provider] = next.id
      else delete row.active[provider]
    }
    writeVault(vault)
    return { ...state(owner), note: 'Local credentials removed; revoke upstream access in your provider account settings if desired.' }
  }
  async function bearer(owner, provider, accountId) {
    const vault = readVault(), row = accountState(vault, owner)
    const entry = row.accounts.find(x => x.provider === provider && x.id === accountId)
    if (!entry) fail('Connection not found for current MockMate user')
    if (entry.expiresAt && entry.expiresAt < now() + 60000) {
      if (!entry.refreshToken) fail('Provider token expired; reconnect the account')
      const params = new URLSearchParams({
        client_id: entry.clientId, grant_type: 'refresh_token', refresh_token: entry.refreshToken,
      })
      if (provider !== 'github' && entry.clientSecret) params.set('client_secret', entry.clientSecret)
      const url = provider === 'github' ? 'https://github.com/login/oauth/access_token' : 'https://oauth2.googleapis.com/token'
      const response = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(), fetchImpl })
      if (!response.access_token) fail('Could not refresh connector token; reconnect account')
      entry.accessToken = response.access_token
      if (response.refresh_token) entry.refreshToken = response.refresh_token
      entry.expiresAt = now() + (Number(response.expires_in) || 3600) * 1000
      writeVault(vault)
    }
    return entry.accessToken
  }
  // Explicit, read-only re-verification of a saved account. Never trust a
  // renderer-supplied subject and never replace an account with a different one.
  async function verifyAccount(owner, provider, accountId) {
    providerCheck(provider)
    const vault = readVault(), row = accountState(vault, owner)
    const entry = row.accounts.find(x => x.id === accountId && x.provider === provider)
    if (!entry) fail('Connected account not owned by current MockMate user')
    const token = await bearer(owner, provider, accountId)
    const target = provider === 'github'
      ? 'https://api.github.com/user'
      : 'https://www.googleapis.com/oauth2/v3/userinfo'
    const identity = await request(target, {
      headers: { Authorization: 'Bearer ' + token, ...(provider === 'github' ? { 'User-Agent': 'MockMate-Desktop' } : {}) },
      fetchImpl,
    })
    const subject = provider === 'github' ? String(identity.id || '') : String(identity.sub || '')
    if (!subject || subject !== entry.subject) fail('Connector account identity changed; disconnect and reauthorize')
    // Re-read after possible token refresh, retaining the updated encrypted token.
    const latest = readVault(), current = accountState(latest, owner)
    const saved = current.accounts.find(x => x.id === accountId && x.provider === provider)
    if (!saved || saved.subject !== subject) fail('Connected account changed during verification')
    saved.lastVerifiedAt = new Date(now()).toISOString()
    writeVault(latest)
    return { ok: true, account: accountPublic(saved) }
  }

  function saveConnected(owner, provider, metadata, token, opts = {}) {
    providerCheck(provider)
    const vault = readVault(), row = accountState(vault, owner)
    const id = provider + ':' + clean(metadata.subject, 180)
    if (!metadata.subject) fail('Provider did not return a verified account identifier')
    const current = row.accounts.find(x => x.id === id)
    const entry = {
      ...current, id, provider, subject: clean(metadata.subject, 180), label: clean(metadata.label, 180),
      scopes: clean(token.scope || opts.scopes, 1000),
      connectedAt: current?.connectedAt || new Date(now()).toISOString(),
      lastVerifiedAt: new Date(now()).toISOString(),
      accessToken: token.access_token, refreshToken: token.refresh_token || current?.refreshToken || null,
      expiresAt: token.expires_in ? now() + Number(token.expires_in) * 1000 : null,
      clientId: opts.clientId, clientSecret: opts.clientSecret || null,
    }
    row.accounts = [...row.accounts.filter(x => x.id !== id), entry]
    row.active[provider] = id
    writeVault(vault)
    return accountPublic(entry)
  }
  function newFlow(owner, provider, extras = {}) {
    assertOwner(owner); providerCheck(provider)
    for (const [key, flow] of flows) {
      if (now() - flow.created > WAIT_MS || flow.status === 'expired') {
        try { flow.server?.close() } catch {}
        flows.delete(key)
      }
    }
    if ([...flows.values()].filter(flow => flow.owner === owner).length >= 3)
      fail('Too many pending authorization attempts. Complete or expire an earlier request.')
    const id = random()
    const flow = { id, owner, provider, status: 'pending', created: now(), ...extras }
    flows.set(id, flow)
    const timer = setTimeout(() => {
      if (flows.get(id) !== flow) return
      flow.status = 'expired'
      try { flow.server?.close() } catch {}
    }, WAIT_MS)
    timer.unref?.()
    return id
  }
  function activeFlow(owner, id) {
    const flow = flows.get(id)
    if (!flow || flow.owner !== owner) fail('Authorization flow not found for this account')
    if (now() - flow.created > WAIT_MS || flow.status === 'expired') {
      try { flow.server?.close() } catch {}
      flows.delete(id)
      fail('Authorization expired; connect again')
    }
    return flow
  }
  async function startGithub(owner, clientId, { privateRepos = false } = {}) {
    const client = clean(clientId, 160)
    if (!/^[a-zA-Z0-9._-]{10,160}$/.test(client)) fail('A GitHub OAuth App client ID is required')
    const scope = privateRepos === true ? 'read:user repo' : 'read:user'
    const result = await request('https://github.com/login/device/code', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: client, scope }).toString(), fetchImpl,
    })
    if (!result.device_code || !result.user_code) fail('GitHub device authorization was not available; enable device flow in the GitHub OAuth App')
    const id = newFlow(owner, 'github', {
      deviceCode: result.device_code, clientId: client, interval: Math.max(5000, Number(result.interval || 5) * 1000),
      nextPoll: 0, status: 'pending', requestedScopes: scope,
    })
    return { flowId: id, verificationUri: 'https://github.com/login/device', userCode: clean(result.user_code, 24),
      expiresIn: Math.min(Number(result.expires_in || 900), 900), intervalMs: flows.get(id).interval }
  }
  async function pollFlow(owner, id) {
    const flow = activeFlow(owner, id)
    if (flow.status === 'success') { flows.delete(id); return { status: 'connected', account: flow.account } }
    if (flow.status === 'error') { flows.delete(id); return { status: 'error', error: flow.error } }
    if (flow.provider !== 'github') return { status: 'pending' }
    if (now() < flow.nextPoll) return { status: 'pending', retryAfterMs: flow.nextPoll - now() }
    flow.nextPoll = now() + flow.interval
    const token = await request('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: flow.clientId, device_code: flow.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }).toString(), fetchImpl,
    })
    if (token.error) {
      if (token.error === 'authorization_pending') return { status: 'pending' }
      if (token.error === 'slow_down') {
        flow.interval += 5000
        flow.nextPoll = now() + flow.interval
        return { status: 'pending', retryAfterMs: flow.interval }
      }
      flow.status = 'error'; flow.error = 'GitHub authorization: ' + clean(token.error, 90)
      return { status: 'error', error: flow.error }
    }
    if (!token.access_token) fail('GitHub authorization returned no access token')
    const github = await request('https://api.github.com/user', {
      headers: { Authorization: 'Bearer ' + token.access_token, 'User-Agent': 'MockMate-Desktop' }, fetchImpl,
    })
    flow.account = saveConnected(owner, 'github',
      { subject: github.id, label: github.login || github.name || 'GitHub account' },
      token, { clientId: flow.clientId, scopes: flow.requestedScopes })
    flow.status = 'success'
    flows.delete(id)
    return { status: 'connected', account: flow.account }
  }
  async function startGoogle(owner, provider, clientId, clientSecret = '') {
    if (!GOOGLE_SCOPES[provider]) fail('Choose Google Drive or Google Calendar')
    const client = clean(clientId, 256)
    if (!/^[0-9]+-[A-Za-z0-9_.-]+\.apps\.googleusercontent\.com$/.test(client)) fail('Use a Google Desktop OAuth client ID')
    const secret = clean(clientSecret, 300)
    const verifier = random() + random()
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
    const stateValue = random()
    const id = newFlow(owner, provider, { status: 'pending' })
    const flow = flows.get(id)
    const server = http.createServer(async (req, res) => {
      const remote = req.socket.remoteAddress
      if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(remote)) { res.writeHead(403); res.end('Forbidden'); return }
      let u
      try { u = new URL(req.url, 'http://127.0.0.1') } catch { res.writeHead(400); res.end('Invalid request'); return }
      if (u.pathname !== '/oauth/callback') { res.writeHead(404); res.end('Not found'); return }
      const code = u.searchParams.get('code')
      const returnedState = u.searchParams.get('state') || ''
      if (returnedState.length !== stateValue.length || !crypto.timingSafeEqual(Buffer.from(returnedState), Buffer.from(stateValue))) {
        res.writeHead(400); res.end('Invalid OAuth state'); return
      }
      if (!code || flow.status !== 'pending') { res.writeHead(400); res.end('No pending authorization'); return }
      flow.status = 'processing'
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end('MockMate received your authorization. You can close this page and return to the app.')
      server.close()
      try {
        const params = new URLSearchParams({ code, client_id: client, redirect_uri: flow.redirectUri,
          grant_type: 'authorization_code', code_verifier: verifier })
        if (secret) params.set('client_secret', secret)
        const token = await request('https://oauth2.googleapis.com/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(), fetchImpl,
        })
        if (!token.access_token) fail('Google authorization returned no access token')
        const user = await request('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: 'Bearer ' + token.access_token }, fetchImpl,
        })
        if (!user.sub || !user.email) fail('Google did not return a verified identity')
        if (typeof currentOwner === 'function' && await currentOwner() !== owner)
          fail('MockMate account changed during external authorization; no credential was stored')
        flow.account = saveConnected(owner, provider, { subject: user.sub, label: user.email },
          token, { clientId: client, clientSecret: secret, scopes: GOOGLE_SCOPES[provider] })
        flow.status = 'success'
      } catch (error) { flow.status = 'error'; flow.error = error.message }
    })
    flow.server = server
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      flow.redirectUri = 'http://127.0.0.1:' + address.port + '/oauth/callback'
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      for (const [key, val] of Object.entries({
        client_id: client, redirect_uri: flow.redirectUri, response_type: 'code',
        scope: GOOGLE_SCOPES[provider], state: stateValue,
        code_challenge: challenge, code_challenge_method: 'S256',
        access_type: 'offline', prompt: 'consent',
      })) url.searchParams.set(key, val)
      await openExternal(url.toString())
      return { flowId: id, status: 'pending', message: 'Complete Google consent in your system browser.' }
    } catch (error) {
      flows.delete(id)
      try { server.close() } catch {}
      throw error
    }
  }
  async function authorized(owner, provider, accountId, endpoint) {
    const accessToken = await bearer(owner, provider, accountId)
    return request(endpoint, { headers: {
      Authorization: 'Bearer ' + accessToken, ...(provider === 'github' ? { 'User-Agent': 'MockMate-Desktop',
        'X-GitHub-Api-Version': '2022-11-28' } : {}),
    }, fetchImpl })
  }
  async function listSources(owner, provider, accountId, query = '') {
    providerCheck(provider)
    const q = clean(query, 140)
    let raw, sources = []
    if (provider === 'github') {
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(q)) fail('Enter a selected GitHub owner/repository')
      const repoInfo = await authorized(owner, provider, accountId, 'https://api.github.com/repos/' + q)
      const ref = encodeURIComponent(String(repoInfo.default_branch || 'main'))
      raw = await authorized(owner, provider, accountId,
        'https://api.github.com/repos/' + q + '/git/trees/' + ref + '?recursive=1')
      sources = (raw.tree || []).filter(x => x.type === 'blob' && /\.(md|markdown|txt)$/i.test(x.path)
        && x.size <= MAX_BYTES && !x.path.includes('..')).slice(0, 100)
        .map(x => ({ sourceId: q + ':' + x.path, title: x.path, revision: x.sha }))
    } else if (provider === 'googledrive') {
      const queryFilter = "trashed = false and (mimeType = 'application/vnd.google-apps.document' or mimeType = 'text/plain')"
      const params = new URLSearchParams({ page_size: '40', pageSize: '40',
        fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size)',
        q: queryFilter + (q ? " and name contains '" + q.replace(/['\\]/g, '') + "'" : ''),
        orderBy: 'modifiedTime desc' })
      raw = await authorized(owner, provider, accountId, 'https://www.googleapis.com/drive/v3/files?' + params)
      sources = (raw.files || []).slice(0, 40).map(x => ({ sourceId: x.id, title: x.name, revision: x.modifiedTime, mimeType: x.mimeType }))
    } else {
      const params = new URLSearchParams({ maxResults: '40', singleEvents: 'true', orderBy: 'startTime',
        timeMin: new Date(now() - 24 * 3600 * 1000).toISOString(),
        timeMax: new Date(now() + 100 * 24 * 3600 * 1000).toISOString() })
      raw = await authorized(owner, provider, accountId, 'https://www.googleapis.com/calendar/v3/calendars/primary/events?' + params)
      sources = (raw.items || []).filter(x => x.status !== 'cancelled' && x.id)
        .slice(0, 40).map(x => ({ sourceId: 'primary::' + x.id, title: x.summary || 'Untitled event', revision: x.updated }))
    }
    return { sources }
  }
  async function readSource(owner, provider, accountId, sourceId) {
    providerCheck(provider)
    const id = sourceCheck(provider, sourceId)
    let title, revision, text
    if (provider === 'github') {
      const at = id.indexOf(':')
      const repo = id.slice(0, at), filePath = id.slice(at + 1)
      const raw = await authorized(owner, provider, accountId,
        'https://api.github.com/repos/' + repo + '/contents/' + filePath.split('/').map(encodeURIComponent).join('/'))
      if (raw.type !== 'file' || raw.encoding !== 'base64' || raw.size > MAX_BYTES) fail('Selected GitHub source must be a small text file')
      title = raw.name; revision = raw.sha
      text = Buffer.from(String(raw.content || '').replace(/\s/g, ''), 'base64').toString('utf8')
    } else if (provider === 'googledrive') {
      const raw = await authorized(owner, provider, accountId,
        'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?fields=id,name,mimeType,modifiedTime,size')
      if (raw.size && Number(raw.size) > MAX_BYTES) fail('Selected Drive file is too large')
      if (!['application/vnd.google-apps.document', 'text/plain'].includes(raw.mimeType)) fail('Only Google Docs or plain text are supported')
      title = raw.name; revision = raw.modifiedTime
      const target = raw.mimeType === 'text/plain'
        ? 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media'
        : 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '/export?mimeType=text%2Fplain'
      const accessToken = await bearer(owner, provider, accountId)
      const response = await fetchImpl(target, {
        headers: { Authorization: 'Bearer ' + accessToken }, signal: AbortSignal.timeout(12000), redirect: 'error',
      })
      if (!response.ok) fail('Selected Drive document download failed: HTTP ' + response.status)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length > MAX_BYTES) fail('Selected Drive document exceeds 250 KiB')
      text = buffer.toString('utf8')
    } else {
      const [calendarId, eventId] = id.split('::')
      const raw = await authorized(owner, provider, accountId,
        'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId)
        + '/events/' + encodeURIComponent(eventId))
      title = raw.summary || 'Untitled event'; revision = raw.updated || raw.etag
      text = [
        'Title: ' + title,
        'Start: ' + (raw.start?.dateTime || raw.start?.date || 'Unknown'),
        'End: ' + (raw.end?.dateTime || raw.end?.date || 'Unknown'),
        'Location: ' + (raw.location || ''),
        'Description: ' + (raw.description || ''),
      ].join('\n')
    }
    const normalized = normalizedText(text)
    return { provider, accountId, sourceId: id, title: clean(title, 180), revision: clean(revision, 120),
      text: normalized, sha256: hash(normalized), sizeBytes: Buffer.byteLength(normalized, 'utf8'),
      selectedByUser: true, mimeType: provider === 'github' ? 'text/markdown'
        : provider === 'googledrive' ? 'text/plain' : 'text/calendar-event' }
  }
  function subscribe(owner, { importId, provider, accountId, sourceId, sha256, autoSync = true } = {}) {
    providerCheck(provider)
    const id = sourceCheck(provider, sourceId)
    const vault = readVault(), row = accountState(vault, owner)
    if (!row.accounts.some(x => x.id === accountId && x.provider === provider)) fail('Account does not belong to this MockMate user')
    if (!/^imp_[a-z0-9_]+$/.test(String(importId || '')) || !/^[a-f0-9]{64}$/.test(String(sha256 || '')))
      fail('Approved import ID and content hash required')
    row.subscriptions = [...row.subscriptions.filter(s => s.importId !== importId),
      { importId, provider, accountId, sourceId: id, appliedSha: sha256, autoSync: autoSync === true,
        connectedAt: new Date(now()).toISOString(), lastSyncedAt: null, lastError: null }]
    writeVault(vault)
    return state(owner)
  }
  function setSync(owner, importId, enabled) {
    const vault = readVault(), row = accountState(vault, owner)
    const entry = row.subscriptions.find(s => s.importId === importId)
    if (!entry) fail('Subscription not found')
    entry.autoSync = enabled === true
    writeVault(vault)
    return state(owner)
  }
  function unsubscribe(owner, importId) {
    const vault = readVault(), row = accountState(vault, owner)
    row.subscriptions = row.subscriptions.filter(s => s.importId !== importId)
    writeVault(vault)
    return state(owner)
  }
  async function syncNow(owner) {
    if (livePaused) return { paused: true, updates: [], failures: [] }
    assertOwner(owner)
    if (busy.has(owner)) return { busy: true, updates: [], failures: [] }
    busy.add(owner)
    try {
      const records = readVault().owners[owner]?.subscriptions || []
      const updates = [], failures = []
      for (const sub of records.filter(s => s.autoSync).slice(0, 30)) {
        try {
          const source = await readSource(owner, sub.provider, sub.accountId, sub.sourceId)
          if (source.sha256 !== sub.appliedSha) updates.push({ ...source, importId: sub.importId })
        } catch (error) { failures.push({ importId: sub.importId, error: error.message }) }
      }
      return { paused: false, updates, failures }
    } finally { busy.delete(owner) }
  }
  function acknowledgeSync(owner, importId, sha256) {
    const vault = readVault(), row = accountState(vault, owner)
    const sub = row.subscriptions.find(s => s.importId === importId)
    if (!sub) fail('Subscription not found')
    if (!/^[a-f0-9]{64}$/.test(sha256)) fail('Invalid sync fingerprint')
    sub.appliedSha = sha256
    sub.lastSyncedAt = new Date(now()).toISOString()
    sub.lastError = null
    writeVault(vault)
    return { ok: true }
  }
  function purgeOwner(owner) {
    assertOwner(owner)
    const vault = readVault()
    delete vault.owners[owner]
    for (const [flowId, flow] of flows) {
      if (flow.owner === owner) {
        try { flow.server?.close() } catch {}
        flows.delete(flowId)
      }
    }
    writeVault(vault)
    return { ok: true }
  }
  function setLivePaused(value) { livePaused = value === true }
  function close() { for (const flow of flows.values()) { try { flow.server?.close() } catch {} }; flows.clear() }
  return { state, setActive, removeAccount, verifyAccount, startGithub, startGoogle, pollFlow, listSources, readSource,
    subscribe, setSync, unsubscribe, syncNow, acknowledgeSync, purgeOwner, setLivePaused, close,
    _forTests: { saveConnected, readVault, sourceCheck } }
}
module.exports = { createConnectorGateway, normalizedText, sourceCheck, MAX_BYTES }
