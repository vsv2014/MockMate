import { describe, expect, it } from 'vitest'
import { windowResizeGeometry } from './windowResizeGeometry'
const start = { x: 100, y: 100, w: 1200, h: 760, edge: 'nw', lastX: 0, lastY: 0 }

describe('dashboard resize geometry', () => {
  it('starts from native bounds instead of a smaller zoomed viewport or Live HUD', () => {
    const result = windowResizeGeometry({ ...start, edge: 'se' }, { x: 140, y: 130 })
    expect(result).toMatchObject({ w: 1240, h: 790, dx: 0, dy: 0 })
  })
  it('keeps opposite edges anchored while shrinking north/west', () => {
    const first = windowResizeGeometry(start, { x: 140, y: 130 })
    expect(first).toMatchObject({ w: 1160, h: 730, x: 40, y: 30 })
    const next = windowResizeGeometry({ ...start, lastX: first.x, lastY: first.y }, { x: 170, y: 150 })
    expect(next).toMatchObject({ w: 1130, h: 710, dx: 30, dy: 20 })
    expect(next.x + next.w).toBe(start.w)
    expect(next.y + next.h).toBe(start.h)
  })
  it('clamps small windows without continuing to move the stationary opposite edge', () => {
    const first = windowResizeGeometry(start, { x: 2100, y: 2100 })
    const next = windowResizeGeometry({ ...start, lastX: first.x, lastY: first.y }, { x: 3100, y: 3100 })
    expect(next).toMatchObject({ w: 240, h: 180, dx: 0, dy: 0 })
  })
  it.each(['n', 's', 'e', 'w'])('does not resize the other axis from the %s edge', edge => {
    const result = windowResizeGeometry({ ...start, edge }, { x: 180, y: 160 })
    expect(edge === 'n' || edge === 's' ? result.w : result.h).toBe(edge === 'n' || edge === 's' ? start.w : start.h)
  })
})
