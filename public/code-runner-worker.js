/* Disposable JavaScript runner. It has no DOM/network and MockMate terminates it quickly. */
const deny = name => {
  try { Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false }) } catch {}
}
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'WebAssembly', 'SharedArrayBuffer', 'Atomics']) deny(name)

// A time limit alone does not stop a one-line giant allocation from exhausting the renderer's
// memory before the watchdog fires. Guard the common binary allocation constructors inside this
// disposable worker. Interview coding exercises do not need multi-megabyte buffers.
const MAX_BUFFER_BYTES = 8 * 1024 * 1024
function boundedCtor(Ctor, bytesPerElement = 1) {
  return new Proxy(Ctor, {
    construct(target, args, newTarget) {
      const first = Number(args?.[0])
      if (Number.isFinite(first) && first >= 0 && first * bytesPerElement > MAX_BUFFER_BYTES) throw new RangeError('Allocation exceeds MockMate runner limit')
      return Reflect.construct(target, args, newTarget)
    },
  })
}
const SafeArrayBuffer = boundedCtor(ArrayBuffer, 1)
const SafeUint8Array = boundedCtor(Uint8Array, 1)
const SafeInt8Array = boundedCtor(Int8Array, 1)
const SafeUint16Array = boundedCtor(Uint16Array, 2)
const SafeInt16Array = boundedCtor(Int16Array, 2)
const SafeUint32Array = boundedCtor(Uint32Array, 4)
const SafeInt32Array = boundedCtor(Int32Array, 4)
const SafeFloat32Array = boundedCtor(Float32Array, 4)
const SafeFloat64Array = boundedCtor(Float64Array, 8)

self.onmessage = async event => {
  const { id, code } = event.data || {}
  const source = String(code || '')
  if (source.length > 12000) return self.postMessage({ id, ok: false, error: 'Code exceeds the runner size limit' })
  const logs = []
  let logBytes = 0
  const safeConsole = {}
  for (const method of ['log', 'info', 'warn', 'error']) {
    safeConsole[method] = (...args) => {
      if (logs.length >= 40 || logBytes >= 16000) return
      const line = args.map(value => {
        try { return typeof value === 'string' ? value : JSON.stringify(value) } catch { return String(value) }
      }).join(' ').slice(0, 2000)
      logBytes += line.length
      logs.push(line)
    }
  }
  try {
    const fn = new Function(
      'console', 'ArrayBuffer', 'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array',
      `"use strict";\n${source}`,
    )
    const result = await fn(safeConsole, SafeArrayBuffer, SafeUint8Array, SafeInt8Array, SafeUint16Array, SafeInt16Array, SafeUint32Array, SafeInt32Array, SafeFloat32Array, SafeFloat64Array)
    self.postMessage({ id, ok: true, logs, result: result === undefined ? null : String(result).slice(0, 1000) })
  } catch (error) {
    self.postMessage({ id, ok: false, logs, error: String(error?.stack || error).slice(0, 1600) })
  }
}
