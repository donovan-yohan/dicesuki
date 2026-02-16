import { getGPUTier } from 'detect-gpu'

interface DeviceCheckResult {
  compatible: boolean
  message: string
  tier?: number
  gpu?: string
}

/**
 * Known GPU family substrings used to bypass tier checks when detect-gpu's
 * benchmark database is outdated for newer hardware.
 */
const KNOWN_DESKTOP_GPUS = ['rtx', 'gtx', 'geforce', 'radeon', 'rx ', 'arc ']
const KNOWN_MOBILE_GPUS = ['adreno', 'mali', 'immortalis', 'xclipse', 'apple gpu', 'powervr']

/**
 * Returns true if the GPU name matches any entry in the given family list.
 */
function matchesKnownGPU(gpuName: string, families: string[]): boolean {
  const normalized = gpuName.toLowerCase()
  return families.some((family) => normalized.includes(family))
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

    // detect-gpu's benchmark database can be outdated for newer hardware,
    // returning tier 0/1 for GPUs that are actually capable. We bypass the
    // tier check when the GPU name matches a known family.
    const gpuName = gpuTier.gpu || ''
    const knownFamilies = gpuTier.isMobile ? KNOWN_MOBILE_GPUS : KNOWN_DESKTOP_GPUS
    const minTier = gpuTier.isMobile ? 2 : 1
    const hasKnownGPU = matchesKnownGPU(gpuName, knownFamilies)

    if (hasKnownGPU) {
      console.log('Known GPU family detected, allowing regardless of tier:', gpuName)
    } else if (gpuTier.tier < minTier) {
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
