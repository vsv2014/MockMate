// Preload for the main window — exposes a narrow IPC bridge to React.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  sendHint: data => ipcRenderer.send('hint-update', data),
  setRoomActive: active => ipcRenderer.send('room-state', { active }),
  getAudioSources: () => ipcRenderer.invoke('get-audio-sources'),
  windowDrag: (dx, dy) => ipcRenderer.send('window-drag', { dx, dy }),
  windowResize: (w, h) => ipcRenderer.send('window-resize', { w, h }),
  onScreenCaptured: cb => {
    const handler = (_, base64) => cb(base64)
    ipcRenderer.on('screen-captured', handler)
    return () => ipcRenderer.removeListener('screen-captured', handler)
  },
  onMeetingDetected: cb => {
    const handler = (_, active) => cb(active)
    ipcRenderer.on('meeting-detected', handler)
    return () => ipcRenderer.removeListener('meeting-detected', handler)
  },
  onCodingDetected: cb => {
    const handler = (_, active) => cb(active)
    ipcRenderer.on('coding-detected', handler)
    return () => ipcRenderer.removeListener('coding-detected', handler)
  },
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  excludeFromCapture: () => ipcRenderer.invoke('exclude-from-capture'),
  onShortcutStealth: cb => {
    const handler = () => cb()
    ipcRenderer.on('shortcut-stealth', handler)
    return () => ipcRenderer.removeListener('shortcut-stealth', handler)
  },
  hideWindow: () => ipcRenderer.send('hide-window'),
  getUserDataPath: () => ipcRenderer.sendSync('get-userdata-path'),
  writeEnv: content => ipcRenderer.invoke('write-env', content),
  relaunchApp: () => ipcRenderer.invoke('relaunch-app')
})
