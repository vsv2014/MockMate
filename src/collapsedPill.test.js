import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

const styles = read('src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '')
const app = read('src/App.jsx')

// The Windows artifact behind "on collapse it has black background, and moving it makes
// the background grow": the native window can be larger than the 72×72 badge
// (electron#41190 phantom strip, plus min/max re-applied while dragging a
// non-resizable window — electron#13043). Nothing the app paints may cover that area.
describe('collapsed badge paints nothing around itself', () => {
  it('transparent-ises every full-window app surface while collapsed', () => {
    expect(styles).toMatch(/body\.mm-collapsed[^{]*\{[^}]*background:\s*transparent\s*!important/)
    expect(styles).toMatch(/body\.mm-collapsed\s*#root/)
    expect(styles).toMatch(/body\.mm-collapsed\s*\[data-mm-surface=["']opaque["']\]/)
    expect(styles).toMatch(/background-image:\s*none\s*!important/)
  })

  it('marks each full-window opaque surface, so a new one cannot be forgotten', () => {
    // These four paint the whole window: the signed-in stage (the one that made the
    // collapsed badge black), the loading screen, the pre-auth shell, the dashboard shell.
    expect(read('src/auth/AuthGate.jsx')).toMatch(/className="mm-ready-stage" data-mm-surface="opaque"/)
    expect(read('src/auth/AuthGate.jsx')).toMatch(/<div data-mm-surface="opaque"/)
    expect(read('src/auth/AuthShell.jsx')).toMatch(/id="mm-auth" data-mm-surface="opaque"/)
    expect(read('src/Dashboard.jsx')).toMatch(/className="mm-shell" data-mm-surface="opaque"/)
  })

  it('toggles body.mm-collapsed with the minimized state', () => {
    expect(app).toContain("document.body.classList.toggle('mm-collapsed', minimized)")
    // ...and clears it again, so expanding restores the normal dashboard background.
    expect(app).toContain("document.body.classList.remove('mm-collapsed')")
  })

  it('does not rely on the v1.6.4 body-only band-aid, which missed the real surface', () => {
    // That <style> only ran inside the pill branch of OverlayPanel and only touched
    // `body`, while `.mm-ready-stage` (position:fixed; inset:0) stayed opaque.
    expect(app).not.toContain('body { background: transparent !important; }')
  })

  it('keeps the badge itself visible while collapsed', () => {
    const start = app.indexOf('if (minimized) return (')
    // Ends where the expanded OverlayPanel return begins (its own <div id="mockmate-overlay">).
    const end = app.indexOf('\n  return (', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const pill = app.slice(start, end)
    expect(pill).toContain('data-mm-hit="1"')
    expect(pill).toMatch(/linear-gradient\(145deg, #0f766e, #115e59\)/)
    // The badge must stay clickable: it is the only way back out of the collapsed state.
    expect(pill).toContain('onClick={() => { if (!pillDragged.current) onMinimize?.() }}')
    expect(pill).toContain("pointerEvents: 'all'")
  })
})
