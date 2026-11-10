import React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PolicyProposalEditor from './PolicyProposalEditor.jsx'

describe('read-only ABL policy proposal UI', () => {
  it('provides local validation, explicit export and truthful non-publication status', () => {
    const html = renderToString(React.createElement(PolicyProposalEditor))
    expect(html).toContain('Review a policy proposal')
    expect(html).toContain('Load local configuration')
    expect(html).toContain('Validate and compare')
    expect(html).toContain('Export validated proposal')
    expect(html).toContain('No policy is published')
    expect(html).not.toContain('dangerouslySetInnerHTML')
  })
})
