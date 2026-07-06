/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string
  readonly VITE_MULTIPLAYER_SERVER_URL?: string
  readonly VITE_MULTIPLAYER_SERVER_HTTP_URL?: string
  readonly VITE_LOCAL_ROOM_SERVER_URL?: string
  readonly VITE_LOCAL_ROOM_SERVER_HTTP_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
