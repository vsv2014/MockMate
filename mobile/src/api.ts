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
  preferences?: {
    mobilePlaybook?: string
    mobileResponseStyle?: 'concise' | 'balanced' | 'detailed'
  }
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
  customInstructions?: string
  responseStyle?: 'concise' | 'balanced' | 'detailed'
  selectedDocumentIds?: string[]
  createdAt: string
  score?: Record<string, unknown> | null
}

export type HostedDocument = {
  id: string
  name: string
  type: 'resume' | 'jd' | 'knowledge' | 'supporting' | 'training' | 'document'
  chars: number
  createdAt: string
}

export type InterviewTurn = { say: string; kind?: 'question' | 'followup'; questionNumber?: number }
export type Hint = { fullAnswer?: string; sampleAnswer?: string; opener?: string; keyPoints?: string[]; skip?: boolean; confidence?: string }
export type TranscriptTurn = { role: 'interviewer' | 'candidate' | 'assistant'; text: string; kind?: 'question' | 'followup' | 'answer'; ts?: number }

export class ApiError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message)
    this.name = 'ApiError'
  }
}

export function apiConfigured() {
  return Boolean(configuredBase)
}

async function request<T>(path: string, options: RequestInit & { auth?: boolean; timeoutMs?: number } = {}): Promise<T> {
  if (!configuredBase) throw new ApiError('Connect a hosted MockMate API before signing in.', 0)
  if (!/^https:\/\//i.test(configuredBase) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredBase)) {
    throw new ApiError('MockMate mobile requires an HTTPS API.', 0)
  }

  const { auth, timeoutMs = 15_000, ...fetchOptions } = options
  const headers = new Headers(fetchOptions.headers)
  if (!(fetchOptions.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (auth) {
    const token = await SecureStore.getItemAsync(TOKEN_KEY)
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
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
  createSession: (draft: { mode: string; company: string; role: string; objective: string; title: string; customInstructions: string; responseStyle: string; selectedDocumentIds: string[] }) =>
    request<{ session: SyncedSession }>('/sessions', { method: 'POST', auth: true, body: JSON.stringify({ ...draft, source: 'mobile' }) }),
  updateSession: (id: string, transcript: TranscriptTurn[]) => request<{ session: SyncedSession }>(`/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH', auth: true, body: JSON.stringify({ transcript }),
  }),
  updatePreferences: (preferences: NonNullable<User['preferences']>) =>
    request<{ user: User }>('/me', { method: 'PATCH', auth: true, body: JSON.stringify({ preferences }) }),
  documents: () => request<{ documents: HostedDocument[] }>('/documents', { auth: true }),
  addDocument: (draft: { name: string; type: HostedDocument['type']; text: string }) =>
    request<{ document: HostedDocument }>('/documents', { method: 'POST', auth: true, body: JSON.stringify(draft) }),
  uploadDocument: (file: { uri: string; name: string; mimeType?: string | null }, type: HostedDocument['type']) => {
    const body = new FormData()
    body.append('type', type)
    body.append('name', file.name)
    body.append('file', { uri: file.uri, name: file.name, type: file.mimeType || 'application/octet-stream' } as any)
    return request<{ document: HostedDocument }>('/documents/upload', { method: 'POST', auth: true, body, timeoutMs: 45_000 })
  },
  deleteDocument: (id: string) => request<{ ok: boolean }>(`/documents/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true }),
  documentContext: (question: string, documentIds: string[]) => request<{ context: string }>('/documents/context', {
    method: 'POST', auth: true, body: JSON.stringify({ question, documentIds }),
  }),
  nextInterviewTurn: (body: Record<string, unknown>) => request<{ turn: InterviewTurn }>('/api/interview', {
    method: 'POST', auth: true, body: JSON.stringify(body),
  }),
  hint: (body: Record<string, unknown>) => request<{ hint: Hint }>('/api/hint', {
    method: 'POST', auth: true, body: JSON.stringify(body),
  }),
  transcribe: (file: { uri: string; name?: string; mimeType?: string }) => {
    const body = new FormData()
    body.append('language', 'en')
    body.append('audio', { uri: file.uri, name: file.name || 'question.m4a', type: file.mimeType || 'audio/mp4' } as any)
    return request<{ transcript: string; duration: number }>('/transcribe', { method: 'POST', auth: true, body, timeoutMs: 45_000 })
  },
  deleteAccount: async () => {
    const result = await request<{ ok: boolean }>('/me', { method: 'DELETE', auth: true })
    await SecureStore.deleteItemAsync(TOKEN_KEY)
    return result
  },
  logout: async () => {
    try { await request('/auth/logout', { method: 'POST', auth: true }) } finally {
      await SecureStore.deleteItemAsync(TOKEN_KEY)
    }
  },
}
