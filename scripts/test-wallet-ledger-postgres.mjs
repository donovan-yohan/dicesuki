#!/usr/bin/env node

// Backward-compatible entry point retained for existing local workflows.
import { main } from './test-supabase-postgres.mjs'

await main()
