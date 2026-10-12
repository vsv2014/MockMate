// screen coordinates and native DIP bounds keep browser zoom out of the initial size.
export function windowResizeGeometry(start, point) {
  const dx = point.x - start.x, dy = point.y - start.y
  const w = Math.max(240, start.w + (start.edge.includes('w') ? -dx : start.edge.includes('e') ? dx : 0))
  const h = Math.max(180, start.h + (start.edge.includes('n') ? -dy : start.edge.includes('s') ? dy : 0))
  const x = start.edge.includes('w') ? start.w - w : 0
  const y = start.edge.includes('n') ? start.h - h : 0
  return { w, h, x, y, dx: x - start.lastX, dy: y - start.lastY }
}
