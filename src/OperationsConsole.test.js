import React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import OperationsConsole from './OperationsConsole.jsx'

describe('ARCH operations management UI', () => {
  it('has an explicit trace explorer and honest measured/unknown usage disclaimer', () => {
    const html = renderToString(React.createElement(OperationsConsole))
    expect(html).toContain('ARCH Operations')
    expect(html).toContain('Execution explorer')
    expect(html).toContain('Module consumption ledger')
    expect(html).toContain('Unknown token counts')
    expect(html).not.toContain('dangerouslySetInnerHTML')
  })
})
