import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@react-three/rapier']
  },
  server: {
    host: true,
    port: 3000,
    https: {
      key: fs.readFileSync('./.cert/localhost+3-key.pem'),
      cert: fs.readFileSync('./.cert/localhost+3.pem')
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true
  }
})
