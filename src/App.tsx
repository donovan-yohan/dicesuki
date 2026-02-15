import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Scene from './components/Scene'
import { checkDeviceCompatibility } from './lib/deviceDetection'
import { DeviceMotionProvider } from './contexts/DeviceMotionContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { useInventoryStore } from './store/useInventoryStore'
import DiceFaceTestHarness from './components/test/DiceFaceTestHarness'

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
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-900 text-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p>Checking device compatibility...</p>
        </div>
      </div>
    )
  }

  // Device not compatible
  if (!isCompatible) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-900 text-white">
        <div className="text-center max-w-md px-4">
          <h1 className="text-2xl font-bold mb-4">Device Not Supported</h1>
          <p className="text-gray-300 mb-2">{errorMessage}</p>
          <p className="text-sm text-gray-400">
            This app requires a mid-range or better device for optimal performance.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full">
      <Scene />
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Dev-only test harness — bypasses device check and providers */}
        <Route path="/test/dice-faces" element={<DiceFaceTestHarness />} />
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
