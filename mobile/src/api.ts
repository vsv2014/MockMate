import * as SecureStore from 'expo-secure-store'

const TOKEN_KEY = 'mockmate.auth.token'
const configuredBase = (process.env.EXPO_PUBLIC_API_BASE || '').trim().replace(/\/$/, '')

export type User = {
  id: string
  name: string
  email: string
  plan?: string
  targetRole?: string
  createdAt?: string
}

export type Account = {
  user: User
  plan: string
  usage: { llmCalls: number; sttSeconds: number; period?: string }
  limits: { llmCalls: number | null; sttSeconds: number | null }
}

export type SyncedSession = {
  _id: string
  mode: 'live' | 'solo' | 'mock' | 'coding'
  title?: string
  company?: string
  role?: string
  objective?: string
  createdAt: string
  score?: Record<string, unknown> | null
}

export class ApiError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message)
    this.name = 'ApiError'
  }
}

export function apiConfigured() {
  return Boolean(configuredBase)
}

async function request<T>(path: string, options: RequestInit & { auth?: boolean } = {}): Promise<T> {
  if (!configuredBase) throw new ApiError('Connect a hosted MockMate API before signing in.', 0)
  if (!/^https:\/\//i.test(configuredBase) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredBase)) {
    throw new ApiError('MockMate mobile requires an HTTPS API.', 0)
  }

  const { auth, ...fetchOptions } = options
  const headers = new Headers(fetchOptions.headers)
  headers.set('Content-Type', 'application/json')
  if (auth) {
    const token = await SecureStore.getItemAsync(TOKEN_KEY)
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  let response: Response
  try {
    response = await fetch(`${configuredBase}${path}`, { ...fetchOptions, headers, signal: controller.signal })
  } catch (error) {
    throw new ApiError(error instanceof Error && error.name === 'AbortError'
      ? 'MockMate took too long to respond. Try again.'
      : 'Can’t reach MockMate. Check your connection and try again.')
  } finally {
    clearTimeout(timeout)
  }

  let data: any = null
  try { data = await response.json() } catch { /* empty response */ }
  if (!response.ok) {
    if (response.status === 401 && auth) await SecureStore.deleteItemAsync(TOKEN_KEY)
    throw new ApiError(data?.error || 'Something went wrong. Try again.', response.status)
  }
  return data as T
}

async function saveAuth(result: { token: string; user: User }) {
  await SecureStore.setItemAsync(TOKEN_KEY, result.token)
  return result.user
}

export const api = {
  hasToken: async () => Boolean(await SecureStore.getItemAsync(TOKEN_KEY)),
  login: (email: string, password: string) => request<{ token: string; user: User }>('/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password }),
  }).then(saveAuth),
  signup: (name: string, email: string, password: string) => request<{ token: string; user: User }>('/auth/signup', {
    method: 'POST', body: JSON.stringify({ name, email, password }),
  }).then(saveAuth),
  account: () => request<Account>('/auth/me', { auth: true }),
  sessions: () => request<{ sessions: SyncedSession[] }>('/sessions', { auth: true }),
  createSession: (draft: { mode: string; company: string; role: string; objective: string; title: string }) =>
    request<{ session: SyncedSession }>('/sessions', { method: 'POST', auth: true, body: JSON.stringify({ ...draft, source: 'mobile' }) }),
  logout: async () => {
    try { await request('/auth/logout', { method: 'POST', auth: true }) } finally {
      await SecureStore.deleteItemAsync(TOKEN_KEY)
    }
  },
}
