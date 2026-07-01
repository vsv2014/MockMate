# Deploying the MockMate auth backend (Render + MongoDB)

The desktop app forks `backend/server.js` **locally** by default (file-store, offline-safe) — you don't need this to ship the app. You only need a hosted backend when you want **one shared account across devices** and the **web dashboard / password reset** to work for real users.

## What gets hosted
Only `backend/` (the Express + JWT auth API). The Vite frontend and `api/*` functions deploy separately (Vercel). The backend is stateless except for the user store, which becomes MongoDB in production.

## 1. MongoDB Atlas (free tier)
1. Create a free M0 cluster at https://cloud.mongodb.com
2. Database Access → add a user (username + password).
3. Network Access → allow `0.0.0.0/0` (Render egress IPs aren't fixed).
4. Copy the connection string: `mongodb+srv://USER:PASS@cluster.xxx.mongodb.net/mockmate?retryWrites=true&w=majority`

## 2. Render web service
1. New → Web Service → connect the repo.
2. **Root directory:** `backend`
3. **Build:** `npm install`
4. **Start:** `node server.js`
5. **Environment variables:**

| Key | Value | Notes |
|---|---|---|
| `MONGO_URI` | *(Atlas string above)* | switches store from file → mongo automatically |
| `JWT_SECRET` | *(long random string)* | must be stable — rotating it logs everyone out |
| `JWT_EXPIRES` | `30d` | optional |
| `CORS_ORIGIN` | `https://your-frontend.vercel.app` | comma-separate multiple; omit = allow all |
| `RESEND_API_KEY` | *(from resend.com)* | omit → reset links log to console instead of emailing |
| `RESET_FROM` | `MockMate <noreply@yourdomain>` | required if using Resend |
| `RESET_URL_BASE` | `https://your-frontend.vercel.app/reset.html` | where reset links point |
| `HOST` | `0.0.0.0` | Render requires this (already the default) |

Render sets `PORT` automatically — `server.js` reads it.

## 3. Point the clients at it
- **Web** (`landing.html`, `dashboard.html`, `reset.html`): set `window.MOCKMATE_API = 'https://your-backend.onrender.com'` (or the default in `public/auth-web.js`).
- **Desktop:** set env `MOCKMATE_API_BASE=https://your-backend.onrender.com` to skip the local fork and use the hosted API. Leave unset to keep the offline local backend.

## 4. Verify
```
curl https://your-backend.onrender.com/health          # -> { ok: true }
curl -X POST https://your-backend.onrender.com/auth/signup \
  -H 'content-type: application/json' \
  -d '{"name":"Test","email":"t@e.com","password":"secret12"}'   # -> { token, user }
```

## Notes
- Render free tier sleeps after 15 min idle — first request after sleep takes ~30s. Fine for early users; upgrade for production.
- The file store (`MOCKMATE_DATA_DIR`) is only used when `MONGO_URI` is unset. Never rely on it on Render — its disk is ephemeral.
- Keep `JWT_SECRET` identical between any hosted instances or tokens won't validate across them.
