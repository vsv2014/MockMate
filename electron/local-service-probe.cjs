// Verify an expected MockMate service via its OWN process ID on loopback.
// A 200 response from an arbitrary process using our port must never count as ready.
const http = require('node:http')

function probeOwnedLoopbackService({ port, pid, service, timeoutMs = 900 } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 ||
      !Number.isInteger(pid) || pid < 1 || !service) return Promise.resolve(false)
  return new Promise(resolve => {
    let finished = false
    const done = result => { if (finished) return; finished = true; resolve(result) }
    let req
    try {
      req = http.get({
        host: '127.0.0.1', port, path: '/health', agent: false,
        headers: { accept: 'application/json', 'cache-control': 'no-store' },
      }, res => {
        let body = ''
        res.on('data', chunk => {
          body += chunk.toString('utf8')
          if (body.length > 2048) req.destroy()
        })
        res.on('end', () => {
          try {
            const actual = JSON.parse(body)
            done(res.statusCode === 200 &&
              actual?.ok === true &&
              actual?.service === service &&
              actual?.pid === pid)
          } catch { done(false) }
        })
        res.on('error', () => done(false))
      })
      req.setTimeout(Math.max(250, timeoutMs), () => req.destroy())
      req.on('error', () => done(false))
    } catch { done(false) }
  })
}

function makeOwnedLoopbackProbe(child, { port, service }) {
  // UtilityProcess.pid can initially be undefined until spawn; re-read each poll.
  return () => probeOwnedLoopbackService({
    port, service, pid: Number(child?.pid),
  })
}

module.exports = { probeOwnedLoopbackService, makeOwnedLoopbackProbe }
