import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Scene from './components/Scene'
import DicePreview from './pages/DicePreview'
import { checkDeviceCompatibility } from './lib/deviceDetection'
import { DeviceMotionProvider } from './contexts/DeviceMotionContext'
import { ThemeProvider } from './contexts/ThemeContext'

function App() {
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

  // Main app with routing
  return (
    <BrowserRouter>
      <ThemeProvider>
        <DeviceMotionProvider>
          <Routes>
            {/* Main dice simulator app */}
            <Route
              path="/"
              element={
                <div className="w-full h-full">
                  <Scene />
                </div>
              }
            />

            {/* Dice preview utility (dev tool) */}
            <Route path="/preview" element={<DicePreview />} />
          </Routes>
        </DeviceMotionProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

export default App
