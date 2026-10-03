/** JD text for Resume Studio handoff — prefer listing snippet; else a honest stub. */
export function jobAnalysisJd(j) {
  const snip = String(j?.snippet || j?.description || '').trim()
  if (snip.length > 40) return { jd: snip, limited: false }
  const stub = [
    j?.title && `Role: ${j.title}`,
    j?.company && `Company: ${j.company}`,
    j?.location && `Location: ${j.location}`,
    j?.tags?.length && `Tags: ${j.tags.slice(0, 8).join(', ')}`,
    j?.url && `Listing: ${j.url}`,
    '',
    '(Limited JD from the job listing — paste a fuller description in Resume Studio for better results.)',
  ].filter(Boolean).join('\n')
  return { jd: stub, limited: true }
}
