import { getGPUTier } from 'detect-gpu'

interface DeviceCheckResult {
  compatible: boolean
  message: string
  tier?: number
  gpu?: string
}

/**
 * Checks if the device meets minimum requirements for the app
 * Target: iPhone 12+ (2020), iPad Air 4+ (2020), Android 4GB+ RAM
 * GPU Tier: 2+ (mid-range or better)
 */
export async function checkDeviceCompatibility(): Promise<DeviceCheckResult> {
  try {
    const gpuTier = await getGPUTier()

    console.log('Device GPU Info:', {
      tier: gpuTier.tier,
      type: gpuTier.type,
      gpu: gpuTier.gpu,
      isMobile: gpuTier.isMobile,
      fps: gpuTier.fps
    })

    // Tier 0-1: Low-end devices (block)
    // Tier 2-3: Mid-range to high-end (allow)
    if (gpuTier.tier < 2) {
      return {
        compatible: false,
        message: 'Your device GPU is not powerful enough for this application.',
        tier: gpuTier.tier,
        gpu: gpuTier.gpu
      }
    }

    // Check for WebGL support
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')

    if (!gl) {
      return {
        compatible: false,
        message: 'Your device does not support WebGL, which is required for 3D graphics.'
      }
    }

    return {
      compatible: true,
      message: 'Device is compatible',
      tier: gpuTier.tier,
      gpu: gpuTier.gpu
    }
  } catch (error) {
    console.error('Device compatibility check failed:', error)

    // If detection fails, allow but warn
    // Better to let users try than block them unnecessarily
    return {
      compatible: true,
      message: 'Could not detect GPU tier, proceeding with caution'
    }
  }
}
