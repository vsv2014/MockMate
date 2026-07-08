// Preload for the main window — exposes a narrow IPC bridge to React.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  getAudioSources: () => ipcRenderer.invoke('get-audio-sources'),
  windowDrag: (dx, dy) => ipcRenderer.send('window-drag', { dx, dy }),
  windowResize: (w, h) => ipcRenderer.send('window-resize', { w, h }),
  // 'app' = full windowed dashboard (large, centered); 'overlay' = compact floating panel.
  setWindowMode: mode => ipcRenderer.send('set-window-mode', mode),
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
  setPin: on => ipcRenderer.send('set-pin', on),
  // Duo co-pilot: open/close the protected hint window + push hints into it (see main.cjs).
  setRoomActive: on => ipcRenderer.send('set-room-active', on),
  sendHint: payload => ipcRenderer.send('send-hint', payload),
  getUserDataPath: () => ipcRenderer.sendSync('get-userdata-path'),
  // Auth API base URL (env-configurable; local fork by default)
  getApiBase: () => ipcRenderer.sendSync('get-api-base'),
  // JWT storage — encrypted at rest via OS keychain in the main process. Never localStorage.
  auth: {
    getToken: () => ipcRenderer.invoke('auth-get-token'),
    setToken: token => ipcRenderer.invoke('auth-set-token', token),
    clearToken: () => ipcRenderer.invoke('auth-clear-token'),
  },
  // Auto-update toast: subscribe to progress, restart-to-install, and manual check.
  onUpdateStatus: cb => {
    const h = (_, d) => cb(d)
    ipcRenderer.on('update-status', h)
    return () => ipcRenderer.removeListener('update-status', h)
  },
  installUpdate: () => ipcRenderer.invoke('install-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  checkForUpdates: () => ipcRenderer.invoke('check-updates-now'),
  writeEnv: content => ipcRenderer.invoke('write-env', content),
  relaunchApp: () => ipcRenderer.invoke('relaunch-app'),
  applyKeys: () => ipcRenderer.invoke('apply-keys'),
  openKeySetup: () => ipcRenderer.invoke('open-key-setup'),
  openExternal: url => ipcRenderer.invoke('open-external', url)
})
