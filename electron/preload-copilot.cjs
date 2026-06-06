// Preload for the protected co-pilot window — receives hint data from the main process.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  onHintData: cb => ipcRenderer.on('hint-data', (_, data) => cb(data))
})
