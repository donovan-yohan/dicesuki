/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string
  readonly VITE_MULTIPLAYER_SERVER_URL?: string
  readonly VITE_MULTIPLAYER_SERVER_HTTP_URL?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** Legacy fallback while older deployments migrate to publishable keys. */
  readonly VITE_SUPABASE_ANON_KEY?: string
  /**
   * Self-serve "Add the Dicesuki bot to your server" OAuth URL, shown in the
   * Post-to-Discord empty state (#246). Deployment configuration, not API data —
   * when unset the link is simply hidden.
   */
  readonly VITE_DISCORD_BOT_INVITE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
