// Preload for the main window — exposes a narrow IPC bridge to React.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  sendHint: data => ipcRenderer.send('hint-update', data),
  setRoomActive: active => ipcRenderer.send('room-state', { active }),
  getAudioSources: () => ipcRenderer.invoke('get-audio-sources'),
  windowDrag: (dx, dy) => ipcRenderer.send('window-drag', { dx, dy }),
  windowResize: (w, h) => ipcRenderer.send('window-resize', { w, h }),
  onScreenCaptured: cb => ipcRenderer.on('screen-captured', (_, base64) => cb(base64)),
  onMeetingDetected: cb => ipcRenderer.on('meeting-detected', (_, active) => cb(active)),
  onShortcutStealth: cb => ipcRenderer.on('shortcut-stealth', () => cb()),
  hideWindow: () => ipcRenderer.send('hide-window'),
  getUserDataPath: () => ipcRenderer.sendSync('get-userdata-path')
})
