/**
 * Server Configuration
 * Loads environment variables and provides typed config object
 */

import dotenv from 'dotenv'
import type { ServerConfig } from './types/index.js'

// Load environment variables
dotenv.config()

const env = process.env

/**
 * Get environment variable with fallback
 */
function getEnv(key: string, fallback: string): string {
  return env[key] || fallback
}

function getEnvNumber(key: string, fallback: number): number {
  const value = env[key]
  return value ? parseFloat(value) : fallback
}

function getEnvBoolean(key: string, fallback: boolean): boolean {
  const value = env[key]
  return value ? value.toLowerCase() === 'true' : fallback
}

/**
 * Server configuration
 */
export const config: ServerConfig = {
  port: getEnvNumber('PORT', 3001),
  environment: (getEnv('NODE_ENV', 'development') as 'development' | 'production'),

  supabase: {
    url: getEnv('SUPABASE_URL', ''),
    serviceRoleKey: getEnv('SUPABASE_SERVICE_ROLE_KEY', ''),
  },

  physics: {
    gravity: [0, -9.81, 0],
    tickRate: getEnvNumber('PHYSICS_TICK_RATE', 60),
    broadcastRate: getEnvNumber('BROADCAST_TICK_RATE', 20),

    dice: {
      restitution: 0.3,
      friction: 0.6,
    },

    rest: {
      linearVelocityThreshold: 0.01,
      angularVelocityThreshold: 0.01,
      durationMs: 500,
    },

    maxDiceVelocity: 25,
  },

  room: {
    maxPlayers: getEnvNumber('MAX_PLAYERS_PER_ROOM', 8),
    maxDice: getEnvNumber('MAX_DICE_PER_ROOM', 32),
    idleTimeoutMs: getEnvNumber('ROOM_IDLE_TIMEOUT', 300000), // 5 minutes
    cleanupIntervalMs: getEnvNumber('ROOM_CLEANUP_INTERVAL', 60000), // 1 minute
  },

  security: {
    bcryptRounds: getEnvNumber('BCRYPT_ROUNDS', 10),
    maxRoomsPerIp: getEnvNumber('MAX_ROOMS_PER_IP', 3),
    rateLimitWindow: getEnvNumber('RATE_LIMIT_WINDOW', 60000),
    rateLimitMaxRequests: getEnvNumber('RATE_LIMIT_MAX_REQUESTS', 100),
  },

  logging: {
    level: (getEnv('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error'),
    logPhysicsStats: getEnvBoolean('LOG_PHYSICS_STATS', false),
  },
}

/**
 * Validate required configuration
 */
export function validateConfig(): void {
  const errors: string[] = []

  if (!config.supabase.url) {
    errors.push('SUPABASE_URL is required')
  }

  if (!config.supabase.serviceRoleKey) {
    errors.push('SUPABASE_SERVICE_ROLE_KEY is required')
  }

  if (config.physics.tickRate < 10 || config.physics.tickRate > 120) {
    errors.push('PHYSICS_TICK_RATE must be between 10 and 120')
  }

  if (config.physics.broadcastRate < 5 || config.physics.broadcastRate > 60) {
    errors.push('BROADCAST_TICK_RATE must be between 5 and 60')
  }

  if (errors.length > 0) {
    console.error('Configuration errors:')
    errors.forEach(error => console.error(`  - ${error}`))
    process.exit(1)
  }
}

/**
 * Log configuration (safe - no secrets)
 */
export function logConfig(): void {
  console.log('Server Configuration:')
  console.log(`  Environment: ${config.environment}`)
  console.log(`  Port: ${config.port}`)
  console.log(`  Physics Tick Rate: ${config.physics.tickRate} FPS`)
  console.log(`  Broadcast Rate: ${config.physics.broadcastRate} Hz`)
  console.log(`  Max Players/Room: ${config.room.maxPlayers}`)
  console.log(`  Max Dice/Room: ${config.room.maxDice}`)
  console.log(`  Log Level: ${config.logging.level}`)
}
