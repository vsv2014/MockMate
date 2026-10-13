import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const rawStyles = fs.readFileSync(path.join(here, 'styles.css'), 'utf8')
// Comments explain the regression and quote the offending import; they are not CSS.
const styles = rawStyles.replace(/\/\*[\s\S]*?\*\//g, '')
const main = fs.readFileSync(path.join(here, 'main.jsx'), 'utf8')

describe('design system stylesheet', () => {
  it('never imports Tailwind Preflight into the shared app stylesheet', () => {
    // v1.6.4 shipped `@import "tailwindcss";` here. Preflight then reset headings,
    // lists, paragraphs and form controls across every screen. Theme + utilities
    // layers keep utility classes working without the global reset.
    expect(styles).not.toMatch(/@import\s+["']tailwindcss["']\s*;/)
    expect(styles).not.toMatch(/@import\s+["']tailwindcss\/preflight\.css["']/)
    expect(styles).toContain('@import "tailwindcss/theme.css"')
    expect(styles).toContain('@import "tailwindcss/utilities.css"')
  })

  it('is the only stylesheet the app shell loads', () => {
    expect(main).toContain("import './styles.css'")
    expect(fs.existsSync(path.join(here, 'index.css'))).toBe(false)
  })

  it('defines every custom property its own classes consume', () => {
    const defined = new Set([...styles.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(match => match[1]))
    // A documented fallback (var(--x, …)) is intentional; a bare reference is not.
    const used = new Set([...styles.matchAll(/var\((--[a-z0-9-]+)\s*\)/gi)].map(match => match[1]))
    expect(used.size).toBeGreaterThan(0)
    for (const variable of used) expect(defined.has(variable), `${variable} is used but never defined`).toBe(true)
    for (const required of ['--color-surface', '--color-text', '--radius-card', '--shadow-card', '--color-accent']) {
      expect(defined.has(required), `${required} token missing`).toBe(true)
    }
  })

  it('keeps the layout utilities the screens rely on', () => {
    for (const className of ['.mm-content-medium', '.mm-content-narrow', '.mm-panel', '.mm-title', '.mm-body-muted', '.mm-section']) {
      expect(styles, `${className} missing from styles.css`).toContain(`${className} {`)
    }
  })
})
