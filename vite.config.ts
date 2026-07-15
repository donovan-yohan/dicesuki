import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'
import path from 'path'

// Check if SSL certificates exist (only in local development)
const certKeyPath = path.resolve(__dirname, '.cert/localhost+3-key.pem')
const certPath = path.resolve(__dirname, '.cert/localhost+3.pem')
const hasLocalCerts = fs.existsSync(certKeyPath) && fs.existsSync(certPath)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // PWA / offline support (issue #116). Solo play runs entirely in-browser
    // (WASM room worker, #114), so the app shell + worker + wasm are precached
    // and solo works with no network. Multiplayer, room discovery, the OG
    // unfurl (#108) and Supabase all stay network-only — see `workbox` below.
    VitePWA({
      // `autoUpdate`: a new deploy's service worker activates immediately
      // (skipWaiting + clientsClaim) and reloads open clients, so users never
      // get stuck on a stale bundle. This is the deliberate answer to the
      // "stale-bundle-forever" trap called out in issue #116's acceptance.
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Extra static files to precache that Vite doesn't fingerprint.
      includeAssets: [
        'brand/dicesuki-icon.svg',
        'brand/dicesuki-wordmark.svg',
        'brand/dicesuki-lockup.svg',
        'icons/favicon.svg',
        'icons/apple-touch-icon.png',
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
        background_color: '#fff8f5',
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
      workbox: {
        // Precache the app shell + hashed JS/CSS chunks + the WASM room worker
        // chunk and its `.wasm` (~830KB) so solo boots offline. Generated from
        // the real build output, so sibling bundle changes (#115/#117) are
        // picked up automatically — nothing is hardcoded.
        globPatterns: ['**/*.{js,css,html,wasm,svg,woff,woff2}'],
        // Artist/UV tooling assets aren't part of the runtime app shell.
        globIgnores: ['**/artist-resources/**'],
        // The wasm binary exceeds Workbox's 2 MiB default precache ceiling.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // SPA navigation fallback — serve the cached shell for app routes.
        navigateFallback: '/index.html',
        // ...but NOT for these. `/room/:id` and `/rooms` are multiplayer and
        // MUST reach the network so (a) the Vercel `/room/:id → api/og` unfurl
        // rewrite (#108) is never shadowed and (b) they degrade honestly when
        // offline instead of loading a shell that can't connect. `/api/` is
        // reserved for Vercel serverless (og.js) and stays network-only.
        navigateFallbackDenylist: [/^\/room\//, /^\/rooms(?:\/|$)/, /^\/api\//],
        runtimeCaching: [
          {
            // Dice models/textures (e.g. the starter Devil D6 GLB, ~18MB) are
            // too large to precache. Cache-first on demand: fetched on the
            // first online visit, then available offline. Range requests are
            // enabled because GLTFLoader may issue them for large models.
            urlPattern: ({ url }) => url.pathname.startsWith('/dice/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'dicesuki-dice-assets',
              rangeRequests: true,
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 64,
                maxAgeSeconds: 60 * 60 * 24 * 60, // 60 days
              },
            },
          },
        ],
        // Drop old precache versions on activate so deploys don't accrete caches.
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
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
    exclude: [...configDefaults.exclude, 'e2e/**', '.worktrees/**'],
  }
})
