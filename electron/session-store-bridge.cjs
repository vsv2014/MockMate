const { Worker } = require('node:worker_threads')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
function createSessionStoreBridge({ directory, safeStorage }) {
  if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('secure_storage_unavailable')
  fs.mkdirSync(directory, { recursive: true })
  const keyFile = path.join(directory,'session-store-key.bin')
  let key
  if (fs.existsSync(keyFile)) key = safeStorage.decryptString(fs.readFileSync(keyFile))
  else { if (fs.existsSync(path.join(directory,'sessions-v1.sqlite'))) throw new Error('encryption_key_missing'); key = crypto.randomBytes(32).toString('base64'); fs.writeFileSync(keyFile,safeStorage.encryptString(key),{ mode:0o600, flag:'wx' }) }
  const worker = new Worker(path.join(__dirname,'session-store-worker.cjs'), { workerData: { filename:path.join(directory,'sessions-v1.sqlite'), key } })
  const pending = new Map(); let sequence = 0, fatal = null
  function failAll(code) { fatal = code; for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error(code)) }; pending.clear() }
  worker.on('message', message => {
    if (message.initializationError) { failAll(message.initializationError); return }
    const waiter = pending.get(message.id); if (!waiter) return
    pending.delete(message.id); clearTimeout(waiter.timer)
    if (message.ok) waiter.resolve(message.value); else waiter.reject(new Error(message.code))
  })
  worker.on('error', () => failAll('database_worker_failed'))
  worker.on('exit', () => failAll('database_worker_closed'))
  return { request(payload) {
    if (fatal) return Promise.reject(new Error(fatal))
    return new Promise((resolve,reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error('database_request_timeout')) },30000); pending.set(id,{ resolve,reject,timer }); worker.postMessage({ ...payload,id }) })
  }, async close() {
    let timer
    try { if (!fatal) await Promise.race([this.request({ op:'close' }),new Promise((_,reject) => { timer=setTimeout(() => reject(new Error('database_close_timeout')),5000) })]) }
    finally { clearTimeout(timer); await worker.terminate() }
  } }
}
module.exports = { createSessionStoreBridge }
