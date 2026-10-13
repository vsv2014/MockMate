// Apply constraints BEFORE native bounds. Otherwise Electron can retain the
// dashboard minimum size while React renders only the collapsed badge.
const PILL_SIZE = 72

// Windows-only trap this guards against:
//  - electron#41190: a small frameless *transparent* window gets a phantom strip
//    below it whose size varies with the display, so the OS window is taller than
//    what was requested.
//  - electron#13043: with `resizable: false`, Electron re-applies min/max from the
//    *observed* bounds on every move. Feeding an already-drifted size back in makes
//    the badge grow a little on each drag — the "background keeps increasing" report.
// Pinning min AND max to the badge while collapsed removes both, and pillDragBounds
// below never reads the observed size into the next bounds.
function prepareWindowMode(win, mode, platform = process.platform) {
  const pill = mode === 'pill'
  win.setMinimumSize(pill ? PILL_SIZE : 240, pill ? PILL_SIZE : 180)
  // (0, 0) is Electron's "no maximum" default (max_width/max_height unset — see
  // electron#33025), so leaving pill mode restores the normal, screen-bounded window.
  win.setMaximumSize(pill ? PILL_SIZE : 0, pill ? PILL_SIZE : 0)
  // Keep Windows layered-window styles stable across collapse/expand.
  // setSize/setBounds remain available to our custom resize handles.
  win.setResizable(platform !== 'win32' && !pill)
  win.setHasShadow(!pill)
  win.setBackgroundColor(platform === 'linux' ? '#08090e' : '#00000000')
}

/**
 * Next bounds for a collapsed badge being dragged.
 *
 * Always returns exactly `size`×`size`, computed from the requested delta only —
 * the observed width/height are never fed back into the window. The caller can log
 * `drift` to prove the OS disagreed with the requested size, which turns any future
 * "the black area grew" report into evidence instead of a guess.
 *
 * @returns {{ bounds: {x:number,y:number,width:number,height:number},
 *             drifted: boolean, observed: {width:number,height:number} }}
 */
function pillDragBounds(current = {}, dx = 0, dy = 0, size = PILL_SIZE) {
  const number = value => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0)
  const observed = {
    width: number(current.width) || size,
    height: number(current.height) || size,
  }
  return {
    bounds: { x: number(current.x) + number(dx), y: number(current.y) + number(dy), width: size, height: size },
    drifted: observed.width !== size || observed.height !== size,
    observed,
  }
}

module.exports = { prepareWindowMode, pillDragBounds, PILL_SIZE }
