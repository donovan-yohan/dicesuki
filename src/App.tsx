import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { SoloRoom } from './components/SoloRoom'
import { checkDeviceCompatibility } from './lib/deviceDetection'
import { DeviceMotionProvider } from './contexts/DeviceMotionProvider'
import { ThemeProvider } from './contexts/ThemeProvider'
import { useAuthStore } from './store/useAuthStore'
import { initDataSync } from './lib/dataSync'
import DiceFaceTestHarness from './components/test/DiceFaceTestHarness'
import { MultiplayerRoom } from './components/multiplayer/MultiplayerRoom'
import { RoomBrowser } from './components/multiplayer/RoomBrowser'
import { StartupSplash } from './components/brand/StartupSplash'
import { isPaymentsEnabled } from './lib/paymentsConfig'
import { useEconomyAccess } from './hooks/useEconomyAccess'
import { purgeLegacyCustomDiceDatabase } from './lib/legacyCustomDiceCleanup'

// Payments (Xsolla sandbox checkout, issue #153) is flag-gated OFF by default.
// Lazy so the checkout code — and, deeper, the Pay Station SDK — is NEVER part
// of the main bundle; the routes below are only registered when the flag is on,
// so with payments disabled these modules are never even imported.
const CheckoutReturnRoute = lazy(() => import('./components/checkout/CheckoutReturnRoute'))
const PendingPurchaseBanner = lazy(() => import('./components/checkout/PendingPurchaseBanner'))
const TermsPage = lazy(() => import('./components/legal/TermsPage'))
const PrivacyPage = lazy(() => import('./components/legal/PrivacyPage'))

function MainApp() {
  const [isCompatible, setIsCompatible] = useState<boolean | null>(null)
  const [errorMessage, setErrorMessage] = useState<string>('')

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

export function AppRoutes({ paymentsEnabled }: { paymentsEnabled: boolean }) {
  // The only economy chrome outside the table `Scene`, so it takes the same
  // per-user gate (`src/hooks/useEconomyAccess.ts`). The `/checkout/return`
  // route below is deliberately NOT gated: it is the landing URL an external
  // payment provider redirects to, and hiding it would strand a player
  // mid-transaction with no status. It stays behind the payments env flag and
  // is unreachable without a checkout that only a flagged player can start.
  const economyAccess = useEconomyAccess()
  return (
    <>
      {/* Cold-relaunch reconciliation: if a purchase was in flight when the app
          was last closed, surface a "confirming purchase" affordance. Flag-gated
          and null when there is no pending order, so it is inert by default. */}
      {paymentsEnabled && economyAccess && (
        <Suspense fallback={null}>
          <PendingPurchaseBanner />
        </Suspense>
      )}
      <Routes>
        {/* Dev-only test harness — bypasses device check and providers */}
        <Route path="/test/dice-faces" element={<DiceFaceTestHarness />} />
        {/* Payment checkout return — status-only (issue #153). Registered only
            when payments are enabled; otherwise it falls through to the app. */}
        {paymentsEnabled && (
          <Route
            path="/checkout/return"
            element={
              <Suspense fallback={<StartupSplash phase="device" />}>
                <CheckoutReturnRoute />
              </Suspense>
            }
          />
        )}
        {/* Public legal pages — available without an account or device check. */}
        <Route
          path="/terms"
          element={
            <ThemeProvider>
              <Suspense fallback={<StartupSplash phase="boot" />}>
                <TermsPage />
              </Suspense>
            </ThemeProvider>
          }
        />
        <Route
          path="/privacy"
          element={
            <ThemeProvider>
              <Suspense fallback={<StartupSplash phase="boot" />}>
                <PrivacyPage />
              </Suspense>
            </ThemeProvider>
          }
        />
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
    </>
  )
}

function App() {
  // Bootstrap auth once at startup. When Supabase is unconfigured this resolves
  // straight to guest mode with no network calls and no console noise (#81).
  useEffect(() => {
    // Inventory v6 has already removed every reference to customer-authored
    // models. Reclaim their retired IndexedDB bytes once per browser profile.
    void purgeLegacyCustomDiceDatabase().catch(error => {
      console.warn('[LegacyDice] IndexedDB cleanup will retry next startup', error)
    })
    // Wire per-account data sync to auth state first (no-op / guest-safe when
    // Supabase is unconfigured), then bootstrap auth (#82, #81).
    initDataSync()
    void useAuthStore.getState().initialize()
  }, [])

  return (
    <BrowserRouter>
      <AppRoutes paymentsEnabled={isPaymentsEnabled()} />
    </BrowserRouter>
  )
}

export default App
