import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'
import { prepareWindowMode, PILL_SIZE } from './window-mode.cjs'

function nativeWindow() {
  return {
    min: [280, 180], size: [1200, 760], position: [0, 0],
    isDestroyed: () => false, isVisible: () => true,
    setMinimumSize(w, h) { this.min = [w, h] },
    setSize(w, h) { this.size = [Math.max(w, this.min[0]), Math.max(h, this.min[1])] },
    setResizable(value) { this.resizable = value },
    setHasShadow(value) { this.shadow = value },
    setBackgroundColor(value) { this.background = value },
    setIgnoreMouseEvents(value) { this.clickThrough = value },
    setPosition(x, y) { this.position = [x, y] },
    setAlwaysOnTop() {},
  }
}

describe('native collapse constraints', () => {
  it('shrinks the actual collapse path despite a dashboard minimum size', () => {
    const main = fs.readFileSync(new URL('./main.cjs', import.meta.url), 'utf8')
    const collapse = main.slice(main.indexOf('function applyPillGeometry()'), main.indexOf('function applyTeleprompterGeometry()'))
    const win = nativeWindow()
    const scope = {
      mainWindow: win, prepareWindowMode: (w, mode) => prepareWindowMode(w, mode, 'win32'), PILL_SIZE,
      activeDisplayWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
      pinnedState: true, lastWindowMode: 'app', syncOverlayShortcuts() {},
    }
    vm.runInNewContext(collapse + '\napplyPillGeometry()', scope)
    expect(win.size).toEqual([72, 72])
    expect(win.resizable).toBe(false)
    expect(win.background).toBe('#00000000')
    expect(win.shadow).toBe(false)
    expect(win.clickThrough).toBe(false)
    expect(scope.lastWindowMode).toBe('pill')
  })

  it.each(['app', 'overlay', 'teleprompter'])('restores usable %s sizing after collapse', mode => {
    const win = nativeWindow()
    prepareWindowMode(win, 'pill', 'win32')
    win.setSize(72, 72)
    prepareWindowMode(win, mode, 'win32')
    win.setSize(300, 360)
    expect(win.size).toEqual([300, 360])
    expect(win.min).toEqual([240, 180])
    expect(win.resizable).toBe(true)
  })

  it('keeps Linux opaque while removing the oversized backing window', () => {
    const win = nativeWindow()
    prepareWindowMode(win, 'pill', 'linux')
    win.setSize(72, 72)
    expect(win.size).toEqual([72, 72])
    expect(win.background).toBe('#08090e')
  })
})
