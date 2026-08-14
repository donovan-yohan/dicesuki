import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { startServiceWorkerUpdates } from './lib/swUpdate'

// Register the service worker and own the update/reload flow (issue #256).
// Importing `virtual:pwa-register` (via this module) is also what tells
// vite-plugin-pwa not to inject its own bare registration script.
startServiceWorkerUpdates()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
