/**
 * Daisu Physics Server
 * Authoritative multiplayer physics server for dice simulation
 */

import express from 'express'
import { createServer } from 'http'
import { config, validateConfig, logConfig } from './config.js'
import { SocketServer } from './network/SocketServer.js'

// Validate configuration
validateConfig()

// Create Express app
const app = express()
const httpServer = createServer(app)

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Daisu Physics Server',
    version: '0.1.0',
    status: 'running',
  })
})

// Initialize Socket.io server
const socketServer = new SocketServer(httpServer, config)

// Start server
httpServer.listen(config.port, () => {
  console.log('╔════════════════════════════════════════╗')
  console.log('║  Daisu Physics Server                 ║')
  console.log('╚════════════════════════════════════════╝')
  console.log('')
  logConfig()
  console.log('')
  console.log(`Server running on port ${config.port}`)
  console.log(`Health check: http://localhost:${config.port}/health`)
  console.log('')
  console.log('Ready for connections!')
})

// Graceful shutdown
const shutdown = () => {
  console.log('\nShutting down gracefully...')

  httpServer.close(() => {
    console.log('HTTP server closed')
    socketServer.shutdown()
    process.exit(0)
  })

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown')
    process.exit(1)
  }, 10000)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
