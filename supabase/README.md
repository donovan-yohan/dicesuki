# Supabase Setup for Daisu Multiplayer

This directory contains database migrations and configuration for the multiplayer backend.

## Quick Start

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Click "New Project"
3. Choose organization and fill in:
   - **Project name**: `daisu` (or your choice)
   - **Database password**: (save this securely!)
   - **Region**: Choose closest to your users
   - **Pricing plan**: Free tier

### 2. Run Migration

**Option A: Using Supabase Dashboard (Easiest)**

1. Go to your project dashboard
2. Click **SQL Editor** in the left sidebar
3. Click **New query**
4. Copy the entire contents of `migrations/001_initial_schema.sql`
5. Paste into the query editor
6. Click **Run** (bottom right)
7. Verify success message appears

**Option B: Using Supabase CLI**

```bash
# Install Supabase CLI (one-time)
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref <your-project-ref>

# Run migration
supabase db push
```

### 3. Get API Credentials

1. In Supabase dashboard, go to **Settings** → **API**
2. Copy the following values:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon (public) key**: `eyJhbG...` (long string)
   - **service_role key**: `eyJhbG...` (keep this secret!)

3. Create `.env.local` file in the **root of this repo**:

```bash
# Client-side (public)
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbG...

# Server-side (private - never commit!)
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...
```

**Important:** Add `.env.local` to `.gitignore` (already done if using standard template)

### 4. Install Supabase Client

In the root of this repo:

```bash
npm install @supabase/supabase-js
```

### 5. Verify Setup

Run this query in SQL Editor to verify tables were created:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('rooms', 'room_players', 'user_preferences');
```

You should see all three tables listed.

---

## Database Schema Overview

### Tables

- **`rooms`**: Game rooms where players join
  - `code`: 6-char short code (e.g., "ABC123")
  - `password_hash`: Optional bcrypt hash for password-protected rooms
  - `max_players`: Default 8, max 16
  - `expires_at`: Auto-cleanup after 24 hours

- **`room_players`**: Players in rooms
  - Supports both authenticated users and guests
  - Tracks player name, color, join time

- **`user_preferences`**: User settings (authenticated only)
  - Dice presets, themes, haptic/motion settings
  - Synced across devices

### Key Features

- **Auto-cleanup**: Rooms expire after 24 hours or 1 hour of inactivity
- **Guest support**: No authentication required to play
- **Password protection**: Optional bcrypt-hashed room passwords
- **Row-level security**: Enforces access controls
- **Automatic player counting**: Triggers keep `current_players` in sync

---

## Scheduled Cleanup (Optional)

To automatically clean up expired rooms, set up a Supabase Edge Function or external cron job:

### Option A: Manual Cleanup (Testing)

Run in SQL Editor:

```sql
SELECT cleanup_expired_rooms();
```

### Option B: Supabase pg_cron (Recommended)

Enable pg_cron extension and schedule cleanup:

```sql
-- Enable extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule cleanup every hour
SELECT cron.schedule(
  'cleanup-expired-rooms',
  '0 * * * *',  -- Every hour
  $$ SELECT cleanup_expired_rooms(); $$
);
```

### Option C: External Cron Job

Call this via a server-side cron job:

```bash
curl -X POST https://xxxxx.supabase.co/rest/v1/rpc/cleanup_expired_rooms \
  -H "apikey: YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
```

---

## Testing Schema

### Create a Test Room

```sql
INSERT INTO rooms (code, max_players, room_name)
VALUES (generate_room_code(), 8, 'Test Room')
RETURNING *;
```

### Add a Test Player

```sql
-- Replace <room_id> with UUID from previous query
INSERT INTO room_players (room_id, player_id, player_name, player_color, is_guest)
VALUES ('<room_id>', gen_random_uuid(), 'Test Player', '#3b82f6', true)
RETURNING *;
```

### Verify Player Count Auto-Update

```sql
SELECT id, code, current_players, max_players FROM rooms;
```

The `current_players` should now be `1`.

---

## Troubleshooting

### Migration Fails

- **Error: "relation already exists"**: Tables already created. Either drop them first or skip migration.
- **Error: "permission denied"**: Make sure you're using the SQL Editor as the database owner.

### RLS Policies Too Strict

If you're testing and RLS is blocking queries:

```sql
-- Temporarily disable RLS for testing (NOT for production!)
ALTER TABLE rooms DISABLE ROW LEVEL SECURITY;
ALTER TABLE room_players DISABLE ROW LEVEL SECURITY;
```

Re-enable when done:

```sql
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_players ENABLE ROW LEVEL SECURITY;
```

### Can't Connect from Client

- Verify `.env.local` has correct values
- Check that `VITE_` prefix is present (required for Vite)
- Restart dev server: `npm run dev`

---

## Next Steps

After completing this setup:

1. ✅ Supabase project created
2. ✅ Migration run successfully
3. ✅ Environment variables configured
4. ✅ Supabase client installed

You're ready to implement the client-side multiplayer stores and room management UI!
