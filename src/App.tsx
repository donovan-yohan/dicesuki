import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { SoloRoom } from './components/SoloRoom'
import { checkDeviceCompatibility } from './lib/deviceDetection'
import { DeviceMotionProvider } from './contexts/DeviceMotionProvider'
import { ThemeProvider } from './contexts/ThemeProvider'
import { useInventoryStore } from './store/useInventoryStore'
import { useAuthStore } from './store/useAuthStore'
import { initDataSync } from './lib/dataSync'
import DiceFaceTestHarness from './components/test/DiceFaceTestHarness'
import ProductionDicePreviewHarness from './components/test/ProductionDicePreviewHarness'
import { MultiplayerRoom } from './components/multiplayer/MultiplayerRoom'
import { RoomBrowser } from './components/multiplayer/RoomBrowser'
import { StartupSplash } from './components/brand/StartupSplash'

function MainApp() {
  const [isCompatible, setIsCompatible] = useState<boolean | null>(null)
  const [errorMessage, setErrorMessage] = useState<string>('')
  const regenerateCustomDiceBlobUrls = useInventoryStore(state => state.regenerateCustomDiceBlobUrls)

  useEffect(() => {
    const checkDevice = async () => {
      const result = await checkDeviceCompatibility()
      setIsCompatible(result.compatible)
      if (!result.compatible) {
        setErrorMessage(result.message)
      }
    }

    checkDevice()
  }, [])

  // Regenerate blob URLs for custom dice on app load
  useEffect(() => {
    regenerateCustomDiceBlobUrls()
  }, [regenerateCustomDiceBlobUrls])

  // Loading state
  if (isCompatible === null) {
    return <StartupSplash phase="device" />
  }

  // Device not compatible
  if (!isCompatible) {
    return (
      <div
        className="w-full h-full flex items-center justify-center [background-color:var(--startup-splash-bg)] [color:var(--startup-splash-text)]"
      >
        <div className="text-center max-w-md px-4">
          <img
            src="/brand/dicesuki-wordmark.svg"
            alt="Dicesuki"
            className="w-56 max-w-[70vw] mx-auto mb-8"
          />
          <h1 className="text-2xl font-bold mb-4">Device Not Supported</h1>
          <p className="mb-2">{errorMessage}</p>
          <p className="text-sm">
            This app requires a mid-range or better device for optimal performance.
          </p>
        </div>
      </div>
    )
  }

  // Default experience: a one-player room hosted by the in-browser WASM room
  // worker (issue #114). No native server, no health check, no network.
  return (
    <div className="w-full h-full">
      <SoloRoom />
    </div>
  )
}

function App() {
  // Bootstrap auth once at startup. When Supabase is unconfigured this resolves
  // straight to guest mode with no network calls and no console noise (#81).
  useEffect(() => {
    // Wire per-account data sync to auth state first (no-op / guest-safe when
    // Supabase is unconfigured), then bootstrap auth (#82, #81).
    initDataSync()
    void useAuthStore.getState().initialize()
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        {/* Dev-only test harness — bypasses device check and providers */}
        <Route path="/test/dice-faces" element={<DiceFaceTestHarness />} />
        <Route path="/test/production-dice-preview" element={<ProductionDicePreviewHarness />} />
        {/* Public room browser route (#79) */}
        <Route path="/rooms" element={
          <ThemeProvider>
            <RoomBrowser />
          </ThemeProvider>
        } />
        {/* Multiplayer room route */}
        <Route path="/room/:roomId" element={
          <ThemeProvider>
            <DeviceMotionProvider>
              <MultiplayerRoom />
            </DeviceMotionProvider>
          </ThemeProvider>
        } />
        {/* Main app with device check, theme, and motion providers */}
        <Route
          path="/*"
          element={
            <ThemeProvider>
              <DeviceMotionProvider>
                <MainApp />
              </DeviceMotionProvider>
            </ThemeProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
