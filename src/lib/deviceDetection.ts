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

    // Desktop devices: be lenient since detect-gpu may not recognize newer GPUs
    // The library's benchmark database can be outdated for new GPUs (e.g., RTX 5090)
    if (!gpuTier.isMobile) {
      // Check if it looks like a dedicated/discrete GPU (not integrated)
      const gpuName = gpuTier.gpu?.toLowerCase() || ''
      const hasDedicatedGPU =
        gpuName.includes('rtx') ||
        gpuName.includes('gtx') ||
        gpuName.includes('geforce') ||
        gpuName.includes('radeon') ||
        gpuName.includes('rx ') ||
        gpuName.includes('arc ')  // Intel Arc

      if (hasDedicatedGPU) {
        console.log('Desktop with dedicated GPU detected, allowing regardless of tier')
        // Skip tier check for desktop with dedicated GPU
      } else if (gpuTier.tier < 1) {
        // Only block desktop if tier 0 AND no dedicated GPU detected
        return {
          compatible: false,
          message: 'Your device GPU is not powerful enough for this application.',
          tier: gpuTier.tier,
          gpu: gpuTier.gpu
        }
      }
    } else {
      // Mobile devices: stricter check (tier 2+)
      if (gpuTier.tier < 2) {
        return {
          compatible: false,
          message: 'Your device GPU is not powerful enough for this application.',
          tier: gpuTier.tier,
          gpu: gpuTier.gpu
        }
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
