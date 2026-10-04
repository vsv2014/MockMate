// Minimal email delivery — no SDK, just fetch.
// Returns { delivered: 'email' | 'console' | 'unavailable' }.
async function deliverEmail({ to, subject, html, tag, link }) {
  if (process.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.RESET_FROM || 'MockMate <onboarding@resend.dev>',
          to,
          subject,
          html,
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) return { delivered: 'email' }
      console.error(`[${tag}] Resend responded`, res.status)
    } catch (e) { console.error(`[${tag}] email send failed:`, e.message) }
  }

  const isDev = process.env.NODE_ENV !== 'production' && !process.env.HOST
  if (isDev) {
    console.log(`[${tag}] link for ${to}: ${link}`)
    return { delivered: 'console' }
  }

  const domain = String(to || '').split('@')[1] || '?'
  console.error(`[${tag}] delivery unavailable (email domain=${domain}; link redacted)`)
  return { delivered: 'unavailable' }
}

export async function sendResetEmail(to, link) {
  return deliverEmail({
    to,
    subject: 'Reset your MockMate password',
    html: `<p>We received a request to reset your MockMate password.</p>
           <p><a href="${link}">Reset your password</a> — this link expires in 30 minutes.</p>
           <p>If you didn't request this, you can ignore this email.</p>`,
    tag: 'reset',
    link,
  })
}

export async function sendVerificationEmail(to, link) {
  return deliverEmail({
    to,
    subject: 'Verify your MockMate email address',
    html: `<p>Welcome to MockMate!</p>
           <p><a href="${link}">Verify your email address</a> — this link expires in 24 hours.</p>
           <p>If you didn't create a MockMate account, you can ignore this email.</p>`,
    tag: 'verify',
    link,
  })
}
