import React, { useEffect, useRef } from 'react'
import { windowResizeGeometry } from './lib/windowResizeGeometry'

const edges = [
  ['n', 'ns-resize', { top: 0, left: 12, right: 12, height: 6 }],
  ['s', 'ns-resize', { bottom: 0, left: 12, right: 12, height: 6 }],
  ['w', 'ew-resize', { left: 0, top: 12, bottom: 12, width: 6 }],
  ['e', 'ew-resize', { right: 0, top: 12, bottom: 12, width: 6 }],
  ['nw', 'nwse-resize', { top: 0, left: 0, width: 12, height: 12 }],
  ['ne', 'nesw-resize', { top: 0, right: 0, width: 12, height: 12 }],
  ['sw', 'nesw-resize', { bottom: 0, left: 0, width: 12, height: 12 }],
  ['se', 'nwse-resize', { bottom: 0, right: 0, width: 12, height: 12 }],
]

// Dashboard views use native window bounds, not the separately persisted Live HUD size.
export default function WindowResizeHandles({ disabled = false }) {
  const gesture = useRef(null)
  useEffect(() => {
    if (disabled) { gesture.current = null; return }
    const move = event => {
      const start = gesture.current
      if (!start || event.pointerId !== start.pointerId) return
      const next = windowResizeGeometry(start, { x: event.screenX, y: event.screenY })
      window.electronAPI?.windowResize?.(next.w, next.h, { dx: next.dx, dy: next.dy })
      start.lastX = next.x; start.lastY = next.y
      event.preventDefault()
    }
    const stop = () => { gesture.current = null }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop)
    document.addEventListener('pointercancel', stop)
    window.addEventListener('blur', stop)
    return () => {
      stop()
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
      document.removeEventListener('pointercancel', stop)
      window.removeEventListener('blur', stop)
    }
  }, [disabled])
  if (disabled || typeof window === 'undefined' || !window.electronAPI?.isElectron) return null
  return edges.map(([edge, cursor, bounds]) => (
    <div key={edge} className="mm-nodrag" data-window-resize={edge} aria-hidden="true"
      onPointerDown={event => {
        if (event.button !== 0) return
        event.preventDefault(); event.stopPropagation()
        const nativeSize = window.electronAPI?.getWindowSize?.()
        gesture.current = { edge, pointerId: event.pointerId, x: event.screenX, y: event.screenY, w: nativeSize?.width || window.innerWidth, h: nativeSize?.height || window.innerHeight, lastX: 0, lastY: 0 }
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
      }}
      style={{ position: 'fixed', ...bounds, zIndex: 10000, cursor, touchAction: 'none' }} />
  ))
}
