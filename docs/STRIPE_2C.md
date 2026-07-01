# 2c — Stripe billing (runbook)

Turns the metered **402 "Upgrade or use your own key"** into a real **Upgrade to Pro** purchase.
On payment, a Stripe webhook flips `user.plan` → `pro` (metering then uses the Pro ceiling). Cancel
→ webhook flips it back to `free`. BYOK users never touch any of this.

> **What's already wired in code:**
> - `backend/src/routes/billing.js` — `POST /billing/checkout`, `POST /billing/portal` (authed),
>   `POST /billing/webhook` (raw-body, signature-verified). Stripe is **lazy-loaded + config-gated**:
>   with no `STRIPE_SECRET_KEY` the routes return **501** and the SDK is never imported.
> - `backend/server.js` — webhook mounted with `express.raw` *before* `express.json`; `/billing` router after.
> - `backend/src/store.js` — `findUserByStripeCustomerId` (file + mongo) for webhook plan flips.
> - Desktop — Account screen "Upgrade to Pro" → `startCheckout()` (`src/auth/api.js`) → opens Stripe
>   Checkout in the browser via the new `open-external` IPC. Pro users get "Manage subscription" → portal.
> - `stripe` is in `package.json` (host `npm install` fetches it; local file-mode never loads it).

---

## 1. Stripe dashboard (test mode first)
1. dashboard.stripe.com → keep the **Test mode** toggle ON while developing.
2. **Products** → add product **"MockMate Pro"** → add a **recurring price** (e.g. $20/mo) → copy its
   **Price ID** (`price_...`) → this is `STRIPE_PRICE_ID`.
3. **Developers → API keys** → copy the **Secret key** (`sk_test_...`) → `STRIPE_SECRET_KEY`.
4. Webhook secret comes from step 3 of testing (CLI) or step 4 of production below.

## 2. Backend env vars (add to Render/Fly alongside the B6 vars)
| Key | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` (then `sk_live_...` in production) |
| `STRIPE_PRICE_ID` | `price_...` for MockMate Pro |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (from the CLI locally, or the dashboard endpoint in prod) |
| `BILLING_SUCCESS_URL` | where Stripe returns after payment (e.g. `https://mockmate.app/upgraded`) |
| `BILLING_CANCEL_URL` | return/cancel page (e.g. `https://mockmate.app/account`) |

The success/cancel pages can be simple static pages — the plan flip happens via the **webhook**, not
the redirect, so the URLs are just UX.

## 3. Test locally with the Stripe CLI (test mode)
```bash
# 1. Run the backend locally with test keys
STRIPE_SECRET_KEY=sk_test_... STRIPE_PRICE_ID=price_... PORT=4000 node backend/server.js

# 2. Forward webhooks to it (prints a whsec_... — restart the backend with it set)
stripe listen --forward-to localhost:4000/billing/webhook
#   -> then re-run step 1 adding: STRIPE_WEBHOOK_SECRET=whsec_...

# 3. Drive the app against it, or trigger events directly:
stripe trigger checkout.session.completed
stripe trigger customer.subscription.deleted
```
In the app: point the desktop at the local backend (`MOCKMATE_API_BASE=http://localhost:4000
npm run electron:dev:nosandbox`), open **Account → Upgrade to Pro** → Stripe test-checkout opens in
the browser → pay with card **4242 4242 4242 4242** (any future date/CVC) → webhook fires →
`/auth/me` now returns `plan: "pro"` and the cap lifts.

## 4. Go live (production)
1. Flip Stripe to **Live mode**, recreate the product/price, grab `sk_live_...` + live `price_...`.
2. **Developers → Webhooks → Add endpoint:** `https://<your-backend>/billing/webhook`, events:
   `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
   Copy its signing secret → `STRIPE_WEBHOOK_SECRET`.
3. Set all five env vars (live values) on the host → redeploy.
4. Real purchase → plan flips to Pro. Manage/cancel via the in-app **Manage subscription** (portal).

## Verify
- `POST /billing/checkout` authed, keys set → returns `{ url: "https://checkout.stripe.com/..." }`.
- Without keys → **501** (proven in this build); no crash, SDK never imported.
- After test payment → `/auth/me` → `plan: "pro"`; the `402` no longer fires until the Pro ceiling.
- Cancel in the portal → `customer.subscription.deleted` → plan back to `free`.

## Notes
- The webhook is the **source of truth** for plan state — never trust the browser redirect alone.
- `checkout.session.completed` carries `client_reference_id` (our userId) → direct, reliable flip.
- Subscription update/delete events are matched back to the user via `stripeCustomerId`.
- Keep test vs live keys separate; test-mode webhooks won't validate against a live signing secret.
