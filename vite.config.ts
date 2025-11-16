import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// Check if SSL certificates exist
const certPath = path.resolve(__dirname, '.cert/localhost+3.pem')
const keyPath = path.resolve(__dirname, '.cert/localhost+3-key.pem')
const hasCerts = fs.existsSync(certPath) && fs.existsSync(keyPath)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@react-three/rapier']
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    https: hasCerts ? {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    } : undefined
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true
  }
})
