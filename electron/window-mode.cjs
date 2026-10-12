// Apply constraints BEFORE native bounds. Otherwise Electron can retain the
// dashboard minimum size while React renders only the collapsed badge.
const PILL_SIZE = 72
function prepareWindowMode(win, mode, platform = process.platform) {
  const pill = mode === 'pill'
  win.setMinimumSize(pill ? PILL_SIZE : 240, pill ? PILL_SIZE : 180)
  // Keep Windows layered-window styles stable across collapse/expand.
  // setSize/setBounds remain available to our custom resize handles.
  win.setResizable(platform !== 'win32' && !pill)
  win.setHasShadow(!pill)
  win.setBackgroundColor(platform === 'linux' ? '#08090e' : '#00000000')
}
module.exports = { prepareWindowMode, PILL_SIZE }
