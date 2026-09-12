import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { configDefaults } from 'vitest/config'
import { readFileSync } from 'fs'

// App version injected at build time so the renderer (What's New modal) can show it without an
// IPC round-trip — works in the browser dev server and the packaged app alike.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))

// Dev server on 5174 (the Electron app uses 5173). API calls to /token and
// /report are proxied to the Express server so the browser stays same-origin.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react()],
  // The mobile workspace owns its Expo toolchain and runs through
  // `npm run mobile:verify`. A clean desktop `npm ci` intentionally does not
  // install mobile/node_modules, so the desktop release suite must not
  // auto-discover Expo tests from mobile/.
  test: {
    exclude: [...configDefaults.exclude, 'mobile/**'],
  },
  server: {
    port: 5174,
    // In dev, proxy /api/* to the local Express shim (server.js). In production
    // on Vercel, /api/* is served by the serverless functions directly.
    proxy: {
      '/api': 'http://localhost:3002'
    }
  }
})
