// Web search for live context — Tavily (AI-optimised) or Serper (Google).
// Tavily returns clean AI-ready snippets; Serper returns raw Google results.
// Whichever key is set gets used; Tavily is preferred.
// (searchConfigured() lives in core.js — the single source consumers import.)
import { fetchWithTimeout as fetchT } from './http.js'

// Detect questions that need live web context — company info, recent news,
// product details, "why us" questions. DSA/algo/behavioral → no search needed.
export function needsWebSearch(question) {
  const q = question.toLowerCase()
  return (
    /why (did you choose|do you want|are you applying|this company|our company|join us)/.test(q) ||
    /what do you know about (our|the|this|us)/.test(q) ||
    /tell me about (our|the|this) (company|product|platform|service|team|startup)/.test(q) ||
    /have you (used|heard of|seen|tried|worked with|come across)/.test(q) ||
    /(latest|recent|new|current) (feature|product|release|update|news|version|launch)/.test(q) ||
    /what('s| is) (your|the) (opinion|take|thought|view) on/.test(q) ||
    /familiar with (our|the)/.test(q) ||
    /why (google|meta|apple|amazon|microsoft|openai|anthropic|kore|salesforce|oracle|uber|airbnb|netflix|stripe|figma|notion|slack|zoom)/.test(q)
  )
}

// timeoutMs caps the underlying HTTP request so a slow search engine can't linger (the caller
// also races this against its own answer budget — see groundedSearch in interview.js).
export async function searchWeb(query, timeoutMs = 8000) {
  if (process.env.TAVILY_API_KEY) return searchTavily(query, timeoutMs)
  if (process.env.SERPER_API_KEY) return searchSerper(query, timeoutMs)
  return null
}

async function searchTavily(query, timeoutMs = 8000) {
  const resp = await fetchT('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query: query.slice(0, 400),
      search_depth: 'basic',
      max_results: 3,
      include_answer: true
    })
  }, timeoutMs)
  if (!resp.ok) throw new Error(`Tavily ${resp.status}`)
  const data = await resp.json()
  return {
    engine: 'tavily',
    answer: data.answer || null,
    sources: (data.results || []).slice(0, 3).map(r => ({
      title: r.title,
      snippet: (r.content || '').slice(0, 400),
      url: r.url
    }))
  }
}

async function searchSerper(query, timeoutMs = 8000) {
  const resp = await fetchT('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': process.env.SERPER_API_KEY },
    body: JSON.stringify({ q: query.slice(0, 400), num: 3 })
  }, timeoutMs)
  if (!resp.ok) throw new Error(`Serper ${resp.status}`)
  const data = await resp.json()
  return {
    engine: 'serper',
    answer: data.answerBox?.answer || data.answerBox?.snippet || null,
    sources: (data.organic || []).slice(0, 3).map(r => ({
      title: r.title,
      snippet: r.snippet || '',
      url: r.link
    }))
  }
}
