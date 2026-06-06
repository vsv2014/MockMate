import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev server on 5174 (the Electron app uses 5173). API calls to /token and
// /report are proxied to the Express server so the browser stays same-origin.
export default defineConfig({
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
