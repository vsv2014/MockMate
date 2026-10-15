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
  // Windows may reapply cached constraints when toggling resizability. Expand first,
  // then release the pill maximum before raising the expanded minimum.
  if (!pill) {
    win.setResizable(true)
    win.setMaximumSize(0, 0)
    win.setMinimumSize(240, 180)
  } else win.setMinimumSize(PILL_SIZE, PILL_SIZE)
  // (0, 0) is Electron's "no maximum" default (max_width/max_height unset — see
  // electron#33025), so leaving pill mode restores the normal, screen-bounded window.
  if (pill) win.setMaximumSize(PILL_SIZE, PILL_SIZE)
  // Expanded windows must permit native resizing; only the badge is fixed.
  if (pill) win.setResizable(false)
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
    // Native DIP rounding can report one extra pixel at fractional display scaling.
    drifted: Math.abs(observed.width - size) > 1 || Math.abs(observed.height - size) > 1,
    observed,
  }
}

// Restoration is deliberately readable even if stale renderer/native state contains pill dimensions.
function expandedOverlaySize(size = {}, area = {}) {
  const valid = value => Number.isFinite(Number(value)) && Number(value) > PILL_SIZE + 1
  const width = valid(size.w) ? Math.max(600, Math.round(Number(size.w))) : 600
  const height = valid(size.h) ? Math.max(600, Math.round(Number(size.h))) : 720
  return { w: Math.min(width, Math.max(240,(area.width || 1280)-40)), h: Math.min(height,Math.max(180,(area.height || 800)-40)) }
}
module.exports = { prepareWindowMode, pillDragBounds, expandedOverlaySize, PILL_SIZE }
