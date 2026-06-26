// Minimal email delivery — no SDK, just fetch.
//   • If RESEND_API_KEY is set → send via Resend's HTTP API.
//   • Otherwise → log the link to the server console (dev fallback) so the flow is
//     fully testable without an email provider wired.
// Returns { delivered: 'email' | 'console' } so callers can log how it went (never to the client).
export async function sendResetEmail(to, link) {
  if (process.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.RESET_FROM || 'MockMate <onboarding@resend.dev>',
          to,
          subject: 'Reset your MockMate password',
          html: `<p>We received a request to reset your MockMate password.</p>
                 <p><a href="${link}">Reset your password</a> — this link expires in 30 minutes.</p>
                 <p>If you didn't request this, you can ignore this email.</p>`,
        }),
      })
      if (res.ok) return { delivered: 'email' }
      console.error('[reset] Resend responded', res.status)
    } catch (e) { console.error('[reset] email send failed:', e.message) }
  }
  // Dev fallback — no provider configured (or send failed): surface the link in logs.
  console.log(`[reset] password-reset link for ${to}: ${link}`)
  return { delivered: 'console' }
}
