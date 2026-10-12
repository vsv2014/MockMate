import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./diagnostics.js', () => ({ diagnostic: vi.fn() }))

// Minimal Web Storage stub (the vitest node environment has no DOM storage).
function makeStorage() {
  const map = new Map()
  return {
    get length() { return map.size },
    key: i => [...map.keys()][i] ?? null,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: k => { map.delete(k) },
    clear: () => map.clear(),
  }
}

// A DOM-free control: only the attributes passed in exist, and visible labels throw if read.
function control({ attrs = {}, tag = 'BUTTON', section = null, label = 'Ask this interview question: Tell me about Acme Corp' } = {}) {
  const sectionEl = section ? { getAttribute: name => (name === 'data-pi-section' ? section : null) } : null
  const el = {
    tagName: tag,
    textContent: label,
    getAttribute: name => {
      if (['aria-label', 'title', 'name'].includes(name)) throw new Error(`must not read ${name}`)
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null
    },
    closest: selector => (selector === '[data-pi-section]' ? sectionEl : el),
  }
  return el
}

function fakeRoot() {
  let handler = null
  return {
    addEventListener: (_type, fn) => { handler = fn },
    removeEventListener: () => { handler = null },
    click: target => handler?.({ target }),
  }
}

let pi
let diagnostic
beforeEach(async () => {
  globalThis.localStorage = makeStorage()
  globalThis.sessionStorage = makeStorage()
  vi.resetModules()
  pi = await import('./productIntelligence.js')
  ;({ diagnostic } = await import('./diagnostics.js'))
  diagnostic.mockClear()
})

describe('fixedControlTarget', () => {
  it('uses data-pi-target, then a clean id, then a coarse section:role descriptor', () => {
    expect(pi.fixedControlTarget(control({ attrs: { 'data-pi-target': 'room_ask_question', id: 'x' } }))).toBe('room_ask_question')
    expect(pi.fixedControlTarget(control({ attrs: { id: 'mm-add-api-key' } }))).toBe('mm-add-api-key')
    expect(pi.fixedControlTarget(control({ section: 'settings' }))).toBe('settings:button')
    expect(pi.fixedControlTarget(control({ attrs: { role: 'switch' }, tag: 'DIV' }))).toBe('switch')
  })

  it('ignores ids that carry dynamic values such as a Duo room code', () => {
    expect(pi.fixedControlTarget(control({ attrs: { id: 'share-mock-7f3a9c2e41b0' }, section: 'duo' }))).toBe('duo:button')
    expect(pi.fixedControlTarget(control({ attrs: { id: 'session-20261013' } }))).toBe('button')
    expect(pi.fixedControlTarget(control({ attrs: { id: 'decade-picker' } }))).toBe('decade-picker')
  })

  it('never reads aria-label, title, name or visible text', () => {
    expect(() => pi.fixedControlTarget(control({ section: 'duo' }))).not.toThrow()
  })
})

describe('attachRageClickObserver', () => {
  it('records a burst on one control with only its fixed identifier', () => {
    const root = fakeRoot()
    pi.attachRageClickObserver(root)
    const question = control({ section: 'duo' })
    root.click(question); root.click(question); root.click(question)
    const events = pi.readProductEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ action: 'rage_click', target: 'duo:button', clicks: 3 })
    expect(JSON.stringify(localStorage.getItem('mm-product-intel-v2::guest'))).not.toMatch(/acme|interview|question/i)
  })

  it('does not treat quick clicks on different controls as a burst', () => {
    const root = fakeRoot()
    pi.attachRageClickObserver(root)
    root.click(control({ section: 'settings' }))
    root.click(control({ section: 'settings' }))
    root.click(control({ section: 'settings' }))
    expect(pi.readProductEvents()).toHaveLength(0)
  })
})

describe('diagnostics forwarding and legacy data', () => {
  it('writes usage events to the diagnostics log only after the user opts in', () => {
    pi.trackProductEvent('live_setup')
    expect(diagnostic).not.toHaveBeenCalled()
    pi.setReplayOptIn(true)
    pi.trackProductEvent('live_setup')
    expect(diagnostic).toHaveBeenCalledWith('product_intel', 'live_setup', expect.objectContaining({ action: 'live_setup' }))
    pi.setReplayOptIn(false)
    diagnostic.mockClear()
    pi.trackProductEvent('live_setup')
    expect(diagnostic).not.toHaveBeenCalled()
  })

  it('deletes the v1 store, which could hold label-derived targets, without reading it', () => {
    localStorage.setItem('mm-product-intel-v1::guest', JSON.stringify([{ ts: 1, action: 'rage_click', target: 'remove_jane_doe_resume_pdf' }]))
    expect(pi.readProductEvents()).toEqual([])
    expect(localStorage.getItem('mm-product-intel-v1::guest')).toBeNull()
  })
})
