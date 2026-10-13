import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'
import { prepareWindowMode, pillDragBounds, expandedOverlaySize, PILL_SIZE } from './window-mode.cjs'

function nativeWindow() {
  return {
    min: [280, 180], max: [0, 0], size: [1200, 760], position: [0, 0],
    isDestroyed: () => false, isVisible: () => true,
    setMinimumSize(w, h) { this.min = [w, h] },
    setMaximumSize(w, h) { this.max = [w, h] },
    setBounds(bounds) {
      this.position = [bounds.x, bounds.y]
      // Windows keeps a phantom strip on small transparent windows: model a host that
      // honours the size but never reports less than the requested minimum.
      this.size = [Math.max(bounds.width, this.min[0]), Math.max(bounds.height, this.min[1])]
    },
    setSize(w, h) { this.size = [Math.max(w, this.min[0]), Math.max(h, this.min[1])] },
    getBounds() { return { x: this.position[0], y: this.position[1], width: this.size[0], height: this.size[1] } },
    setResizable(value) { this.resizable = value },
    setHasShadow(value) { this.shadow = value },
    setBackgroundColor(value) { this.background = value },
    setIgnoreMouseEvents(value) { this.clickThrough = value },
    setPosition(x, y) { this.position = [x, y] },
    setAlwaysOnTop() {},
  }
}

function runCollapse(win) {
  const main = fs.readFileSync(new URL('./main.cjs', import.meta.url), 'utf8')
  const collapse = main.slice(main.indexOf('function applyPillGeometry()'), main.indexOf('function applyTeleprompterGeometry()'))
  const scope = {
    mainWindow: win, prepareWindowMode: (w, mode) => prepareWindowMode(w, mode, 'win32'), PILL_SIZE,
    activeDisplayWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
    pinnedState: true, lastWindowMode: 'app', syncOverlayShortcuts() {}, diag() {},
  }
  vm.runInNewContext(collapse + '\napplyPillGeometry()', scope)
  return win
}

describe('native collapse constraints', () => {
  it('shrinks the actual collapse path despite a dashboard minimum size', () => {
    const win = runCollapse(nativeWindow())
    expect(win.size).toEqual([72, 72])
    expect(win.resizable).toBe(false)
    expect(win.background).toBe('#00000000')
    expect(win.shadow).toBe(false)
    expect(win.clickThrough).toBe(false)
  })

  it('pins the collapsed badge with a maximum size, then clears it when expanding', () => {
    const win = nativeWindow()
    prepareWindowMode(win, 'pill', 'win32')
    // A maximum of exactly PILL_SIZE is what stops Windows from growing the window
    // while the badge is dragged.
    expect(win.max).toEqual([PILL_SIZE, PILL_SIZE])
    for (const mode of ['app', 'overlay', 'teleprompter']) {
      prepareWindowMode(win, mode, 'win32')
      // (0, 0) is Electron's documented "no maximum" default.
      expect(win.max).toEqual([0, 0])
      expect(win.min).toEqual([240, 180])
    }
  })

  it.each(['app', 'overlay', 'teleprompter'])('restores usable %s sizing after collapse', mode => {
    const win = nativeWindow()
    prepareWindowMode(win, 'pill', 'win32')
    win.setSize(72, 72)
    prepareWindowMode(win, mode, 'win32')
    win.setBounds({ x: 0, y: 0, width: 300, height: 360 })
    expect(win.size).toEqual([300, 360])
    expect(win.min).toEqual([240, 180])
    expect(win.resizable).toBe(true)
  })

  it('keeps Linux opaque while removing the oversized backing window', () => {
    const win = nativeWindow()
    prepareWindowMode(win, 'pill', 'linux')
    win.setBounds({ x: 0, y: 0, width: 72, height: 72 })
    expect(win.size).toEqual([72, 72])
    expect(win.background).toBe('#08090e')
  })

  it('never feeds an observed (phantom) size back into the badge bounds', () => {
    // A 72×72 badge the OS reports as 72×76 (electron#41190 phantom strip).
    const phantom = { x: 100, y: 40, width: 72, height: 76 }
    const { bounds, drifted, observed } = pillDragBounds(phantom, 12, -3)
    expect(bounds).toEqual({ x: 112, y: 37, width: PILL_SIZE, height: PILL_SIZE })
    expect(drifted).toBe(true)
    expect(observed).toEqual({ width: 72, height: 76 })

    // Repeated drags cannot accumulate: the input is always the observed bounds.
    let current = phantom
    for (let step = 0; step < 25; step++) {
      const next = pillDragBounds(current, 2, 2)
      expect(next.bounds.width).toBe(PILL_SIZE)
      expect(next.bounds.height).toBe(PILL_SIZE)
      current = { ...next.bounds, height: next.bounds.height + 4 }   // the OS adds its strip again
    }
    expect(current.height).toBe(PILL_SIZE + 4)
  })

  it('tolerates fractional-display rounding without reporting every drag as a correction', () => {
    for (const [width, height] of [[73, 73], [72, 73], [73, 72], [71, 72]]) {
      const next = pillDragBounds({ x: 20, y: 30, width, height }, 3, 4)
      expect(next.drifted).toBe(false)
      expect(next.bounds).toEqual({ x: 23, y: 34, width: 72, height: 72 })
    }
    expect(pillDragBounds({ width: 74, height: 72 }, 1, 0).drifted).toBe(true)
  })

  it('reports no drift for a badge the OS already sized correctly', () => {
    const { bounds, drifted } = pillDragBounds({ x: 0, y: 0, width: PILL_SIZE, height: PILL_SIZE }, 5, 5)
    expect(drifted).toBe(false)
    expect(bounds).toEqual({ x: 5, y: 5, width: PILL_SIZE, height: PILL_SIZE })
  })

  it('keeps the badge a fixed size while the drag IPC handler runs', () => {
    const main = fs.readFileSync(new URL('./main.cjs', import.meta.url), 'utf8')
    expect(main).toContain('pillDragBounds(mainWindow.getBounds(), moveX, moveY)')
    expect(main).toContain("diag('window', 'pill_geometry_corrected'")
    expect(main).toContain("diag('window', 'pill_geometry_phantom'")
    // The pill branch must not move with setPosition: that path re-applies min/max
    // from the observed bounds and lets the artifact grow on Windows.
    const drag = main.slice(main.indexOf("ipcMain.on('window-drag'"), main.indexOf("ipcMain.on('window-resize'"))
    const pillBranch = drag.slice(drag.indexOf("if (lastWindowMode === 'pill')"), drag.indexOf('} else if (moveX || moveY)'))
    expect(pillBranch).toContain('mainWindow.setBounds(bounds)')
    expect(pillBranch).not.toContain('mainWindow.setPosition(')
  })
})


describe('expanded overlay restoration', () => {
  it('releases cached pill constraints after resizability changes', () => {
    const win=nativeWindow()
    prepareWindowMode(win,'pill','win32'); win.setSize(72,72)
    win.setResizable=function(value) { this.resizable=value; if(value) this.max=[...this.size] }
    win.setMinimumSize=function(w,h) { this.min=[Math.min(w,this.max[0] || Infinity),Math.min(h,this.max[1] || Infinity)] }
    prepareWindowMode(win,'overlay','win32')
    expect(win.max).toEqual([0,0]); expect(win.min).toEqual([240,180])
    const size=expandedOverlaySize({ w:72,h:72 },{ width:1920,height:1080 })
    win.setBounds({ x:0,y:0,width:size.w,height:size.h })
    expect(win.size).toEqual([600,720])
  })
  it('restores readable dimensions from a pill or undersized cached overlay', () => {
    expect(expandedOverlaySize({ w:72,h:73 },{ width:1920,height:1080 })).toEqual({ w:600,h:720 })
    expect(expandedOverlaySize({ w:240,h:180 },{ width:1920,height:1080 })).toEqual({ w:600,h:600 })
    expect(expandedOverlaySize({ w:900,h:850 },{ width:1920,height:1080 })).toEqual({ w:900,h:850 })
    expect(expandedOverlaySize({ w:900,h:850 },{ width:800,height:600 })).toEqual({ w:760,h:560 })
  })
  it('uses the actual native mode handler to expand a stale pill size', () => {
    const main=fs.readFileSync(new URL('./main.cjs',import.meta.url),'utf8')
    const start=main.indexOf("ipcMain.on('set-window-mode'")
    const source=main.slice(start,main.indexOf('// MERGE the submitted keys',start))
    const win=runCollapse(nativeWindow()); win.getPosition=() => win.position
    const scope={ mainWindow:win,lastWindowMode:'pill',lastOverlaySize:{w:72,h:72},
      expandedOverlaySize,prepareWindowMode:(w,mode)=>prepareWindowMode(w,mode,'win32'),
      activeDisplayWorkArea:()=>({ x:0,y:0,width:1920,height:1080 }),suppressBlurHide(){},syncOverlayShortcuts(){},diag(){},
      ipcMain:{on(_name,handler){this.handler=handler}} }
    vm.runInNewContext(source,scope)
    scope.ipcMain.handler({},'overlay',{w:72,h:73})
    expect(win.size).toEqual([600,720]); expect(win.max).toEqual([0,0]); expect(win.resizable).toBe(true)
  })
  it('re-enables dashboard mouse input and resize without resetting existing app bounds', () => {
    const main=fs.readFileSync(new URL('./main.cjs',import.meta.url),'utf8')
    const start=main.indexOf("ipcMain.on('set-window-mode'")
    const source=main.slice(start,main.indexOf('// MERGE the submitted keys',start))
    const win=nativeWindow(); win.size=[980,680]; win.resizable=false; win.max=[72,72]; win.clickThrough=true
    const scope={mainWindow:win,lastWindowMode:'app',clickThroughForcedOff:false,prepareWindowMode,ipcMain:{on(_name,handler){this.handler=handler}}}
    vm.runInNewContext(source,scope)
    scope.ipcMain.handler({},'app')
    expect(win.size).toEqual([980,680])
    expect(win.resizable).toBe(true)
    expect(win.max).toEqual([0,0])
    expect(win.clickThrough).toBe(false)
    expect(scope.clickThroughForcedOff).toBe(true)
  })

})
