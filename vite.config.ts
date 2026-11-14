import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'
import path from 'path'
import { woodlandDevAssets } from './scripts/woodlandDevAssets'

// Check if SSL certificates exist (only in local development)
const certKeyPath = path.resolve(__dirname, '.cert/localhost+3-key.pem')
const certPath = path.resolve(__dirname, '.cert/localhost+3.pem')
const hasLocalCerts = fs.existsSync(certKeyPath) && fs.existsSync(certPath)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    woodlandDevAssets(),
    // PWA / offline support (issue #116). Solo play runs entirely in-browser
    // (WASM room worker, #114), so the app shell + worker + wasm are precached
    // and solo works with no network. Multiplayer, room discovery, the OG
    // unfurl (#108) and Supabase all stay network-only in src/sw.ts.
    VitePWA({
      // Activation is explicit and guarded in src/sw.ts and src/lib/swUpdate.ts.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      // `null`, not `'auto'`: `src/main.tsx` imports the virtual register module,
      // so the plugin must not also inject a bare
      // `navigator.serviceWorker.register('/sw.js')` into index.html. `'auto'`
      // happens to detect that import today; stating it removes the dependency
      // on that detection and makes a double registration impossible.
      injectRegister: null,
      // Extra static files to precache that Vite doesn't fingerprint.
      includeAssets: [
        'brand/dicesuki-icon.svg',
        'brand/dicesuki-wordmark.svg',
        'brand/dicesuki-lockup.svg',
        'icons/favicon.svg',
        'icons/apple-touch-icon.png',
        'licenses/monster-manual/5e-attribution.txt',
        'licenses/monster-manual/pf2e-attribution.txt',
        'licenses/monster-manual/upstream-ORCLicense.md',
        'licenses/monster-manual/ORC_License_FINAL.pdf',
      ],
      manifest: {
        name: 'Dicesuki — 3D Dice Simulator',
        short_name: 'Dicesuki',
        description:
          'Roll physics-based 3D dice. Solo play works fully offline — no install, no server.',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#f3ebe2',
        theme_color: '#3f1d3f',
        categories: ['games', 'entertainment'],
        icons: [
          { src: 'icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/pwa-512x512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        // Core shell/engine/lighting only. Collectible models stay on demand.
        globPatterns: ['**/*.{js,css,html,wasm,svg,woff,woff2,hdr}'],
        globIgnores: ['dice/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      // Keep the SW out of `vite dev` so it never interferes with HMR.
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    // Only use HTTPS in local development with certificates
    ...(hasLocalCerts && {
      https: {
        key: fs.readFileSync(certKeyPath),
        cert: fs.readFileSync(certPath),
      }
    })
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    exclude: [
      ...configDefaults.exclude,
      'e2e/**',
      '.worktrees/**',
      'supabase/tests/**/*.test.mjs',
    ],
  }
})
