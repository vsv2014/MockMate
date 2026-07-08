import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

// App version injected at build time so the renderer (What's New modal) can show it without an
// IPC round-trip — works in the browser dev server and the packaged app alike.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))

// Dev server on 5174 (the Electron app uses 5173). API calls to /token and
// /report are proxied to the Express server so the browser stays same-origin.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react()],
  server: {
    port: 5174,
    // In dev, proxy /api/* to the local Express shim (server.js). In production
    // on Vercel, /api/* is served by the serverless functions directly.
    proxy: {
      '/api': 'http://localhost:3002'
    }
  }
})
