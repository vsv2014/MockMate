import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { configDefaults } from 'vitest/config'
import { readFileSync } from 'fs'

// App version injected at build time so the renderer (What's New modal) can show it without an
// IPC round-trip — works in the browser dev server and the packaged app alike.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 550,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-sentry', test: /node_modules[\\/]@sentry[\\/]/, priority: 110 },
            // livekit-client can be nested below @livekit packages. Give the more
            // specific client group higher priority so it is not swallowed by
            // the broader @livekit UI group under Rolldown's first-match rules.
            { name: 'vendor-livekit-client', test: /node_modules[\\/]livekit-client[\\/]/, priority: 100 },
            { name: 'vendor-livekit-ui', test: /node_modules[\\/]@livekit[\\/]/, priority: 90 },
            { name: 'vendor-html2canvas', test: /node_modules[\\/]html2canvas[\\/]/, priority: 70 },
            { name: 'vendor-jspdf', test: /node_modules[\\/]jspdf[\\/]/, priority: 60 },
            { name: 'vendor-pdf-reader', test: /node_modules[\\/]pdfjs-dist[\\/]/, priority: 50 },
            {
              name: 'vendor-react',
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 40,
            },
          ],
        },
      },
    },
  },
  // The mobile workspace owns its Expo toolchain and runs through
  // `npm run mobile:verify`. A clean desktop `npm ci` intentionally does not
  // install mobile/node_modules, so the desktop release suite must not
  // auto-discover Expo tests from mobile/.
  test: {
    exclude: [...configDefaults.exclude, 'mobile/**'],
  },
  server: {
    port: 5174,
    // Keep Vite's safe default host policy. Controlled preview hosts can be
    // added through __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS rather than opening
    // the dev server to every Host header.
    // In dev, proxy /api/* to the local Express shim (server.js). In production
    // on Vercel, /api/* is served by the serverless functions directly.
    proxy: {
      '/api': 'http://localhost:3002'
    }
  }
})
