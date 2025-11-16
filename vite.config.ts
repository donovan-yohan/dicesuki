import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// Check if SSL certificates exist (only in local development)
const certKeyPath = path.resolve(__dirname, '.cert/localhost+3-key.pem')
const certPath = path.resolve(__dirname, '.cert/localhost+3.pem')
const hasLocalCerts = fs.existsSync(certKeyPath) && fs.existsSync(certPath)

// Read version from package.json
const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version)
  },
  optimizeDeps: {
    exclude: ['@react-three/rapier']
  },
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
    css: true
  }
})
