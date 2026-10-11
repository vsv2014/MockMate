import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
const app = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8')

describe('pill window geometry safety', () => {
  it('keeps pill mode while the badge is dragged', () => {
    expect(main).not.toContain("if (lastWindowMode === 'pill' || lastWindowMode == null) lastWindowMode = 'overlay'")
    expect(main).toContain('A pill remains a pill while it is repositioned')
  })

  it('rejects stale resize messages while the fixed-size pill is active', () => {
    expect(main).toContain("if (lastWindowMode === 'pill') return")
  })

  it('ends renderer resize sessions on pointer cancellation, blur, and minimize', () => {
    expect(app).toContain("document.addEventListener('pointercancel', onUp)")
    expect(app).toContain("window.addEventListener('blur', onUp)")
    expect(app).toContain('if (minimized) resizing.current = false')
    expect(app).toContain('onPointerDown={e => { e.stopPropagation(); onResize(e, h.edge) }}')
  })
})
