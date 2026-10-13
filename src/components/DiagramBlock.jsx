import React, { useEffect, useId, useState } from 'react'

// SVG is displayed as an image, never inserted into the privileged Electron DOM.
export default function DiagramBlock({ source }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const [result, setResult] = useState({ source, url: null, error: null })
  useEffect(() => {
    let active = true
    setResult({ source, url: null, error: null })
    async function render() {
      try {
        if (source.length > 16000 || /%%\{|^\s*---|^\s*click\s/im.test(source)) throw new Error('Unsupported diagram configuration')
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark', htmlLabels: false, fontSize: 24, maxTextSize: 16000, maxEdges: 100, suppressErrorRendering: true })
        const { svg } = await mermaid.render(`diagram${id}`, source)
        if (active) setResult({ source, url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, error: null })
      } catch {
        if (active) setResult({ source, url: null, error: 'Diagram could not be drawn. The source is preserved below.' })
      }
    }
    render()
    return () => { active = false }
  }, [source, id])
  const current = result.source === source ? result : { url: null, error: null }
  return <figure style={{ margin: '12px 0', maxWidth: '100%', overflow: 'auto' }}>
    {current.url ? <img src={current.url} alt="Architecture diagram" style={{ display: 'block', minWidth: 560, width: '100%', maxHeight: 900 }} /> : <div role="status">{current.error || 'Drawing diagram…'}</div>}
    <details open={!!current.error}><summary style={{ fontSize: 20, cursor: 'pointer' }}>Diagram source</summary><pre style={{ fontSize: 22, whiteSpace: 'pre', overflow: 'auto' }}>{source}</pre></details>
  </figure>
}
