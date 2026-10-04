/**
 * Shared Electron frameless window drag handler for overlay and auth shells.
 */
export function startWindowDrag(e) {
  if (!e || e.button !== 0) return
  const api = typeof window !== 'undefined' ? window.electronAPI : null
  if (!api?.isElectron || !api?.windowDrag) return
  e.preventDefault()
  let lastX = e.screenX
  let lastY = e.screenY
  const onMove = ev => {
    const dx = ev.screenX - lastX
    const dy = ev.screenY - lastY
    lastX = ev.screenX
    lastY = ev.screenY
    api.windowDrag(dx, dy)
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
