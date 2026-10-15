const { parentPort, workerData } = require('node:worker_threads')
const { SessionStore } = require('./session-store.cjs')
let store
try { store = new SessionStore(workerData.filename, Buffer.from(workerData.key,'base64')) }
catch (error) { parentPort.postMessage({ initializationError: error.code || 'database_open_failed' }); parentPort.close() }
if (store) parentPort.on('message', ({ id, op, scope, entry, runId, turns, sourceKey, raw, offset }) => {
  try {
    let value
    if (op === 'list') value = store.list(scope,offset)
    else if (op === 'get') value = store.get(scope,runId)
    else if (op === 'purge') value = store.purge(scope)
    else if (op === 'save') value = store.save(scope,entry)
    else if (op === 'append') value = store.append(scope,runId,turns)
    else if (op === 'import') value = store.import(scope,sourceKey,raw)
    else if (op === 'delete') value = store.delete(scope,runId)
    else if (op === 'close') { store.close(); parentPort.postMessage({ id, ok:true }); parentPort.close(); return }
    else throw Object.assign(new Error('unsupported_operation'), { code:'unsupported_operation' })
    parentPort.postMessage({ id, ok:true, value })
  } catch (error) { parentPort.postMessage({ id, ok:false, code:error.code || 'database_write_failed' }) }
})
