import * as THREE from 'three'

export function applyThemedSceneEnvironment(
  scene: THREE.Scene,
  backgroundColor: THREE.ColorRepresentation,
  colorMap?: THREE.Texture,
): () => void {
  const previousBackground = scene.background
  const previousEnvironment = scene.environment
  const sceneBackground = colorMap ?? new THREE.Color(backgroundColor)

  if (colorMap) colorMap.mapping = THREE.EquirectangularReflectionMapping
  scene.background = sceneBackground
  if (colorMap) scene.environment = colorMap

  return () => {
    if (scene.background === sceneBackground) scene.background = previousBackground
    if (colorMap && scene.environment === colorMap) scene.environment = previousEnvironment
  }
}
