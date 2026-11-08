import { afterEach, expect, it, vi } from 'vitest'
import { PerspectiveCamera, ShaderLib, TextureLoader, Mesh, MeshToonMaterial, Vector2, BoxGeometry, OrthographicCamera } from 'three'
import { createFoliageReveal } from './foliageReveal'
import { ROOM_DICE_CAPACITY } from '../../config/roomCapacity'
import { createReviewedCanopy } from './reviewedCanopy'
import { createWoodlandResources } from './woodlandGeometry'

afterEach(() => vi.restoreAllMocks())
it('installs bounded local reveal only on the actual canopy color material', () => {
  vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(() => {}))
  const canopy = createReviewedCanopy({halfX:4,halfZ:7,groundY:-.5,time:{value:0}})
  try {
    const shader = {uniforms:{},vertexShader:ShaderLib.toon.vertexShader,fragmentShader:ShaderLib.toon.fragmentShader} as Parameters<typeof canopy.leafMesh.material.onBeforeCompile>[0]
    canopy.leafMesh.material.onBeforeCompile(shader, {} as never)
    expect(shader.uniforms).toHaveProperty('uFoliageReveals')
    expect(shader.fragmentShader).toContain('gl_FragCoord.xy')
    expect(shader.fragmentShader).toContain('vFoliageViewDepth < reveal.w')
    const depth = {uniforms:{},vertexShader:ShaderLib.depth.vertexShader,fragmentShader:ShaderLib.depth.fragmentShader} as typeof shader
    canopy.leafMesh.customDepthMaterial!.onBeforeCompile(depth, {} as never)
    expect(depth.fragmentShader).not.toContain('uFoliageReveals')
    expect(canopy.woodMesh.material.customProgramCacheKey()).not.toContain('foliage-reveal')
    expect(canopy.leafMesh.material.transparent).toBe(false)
  } finally { canopy.dispose() }
})

it('canonical factory updates gameplay reveal while the ambient clock is frozen', () => {
  vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(() => {}))
  const resources=createWoodlandResources({arenaHalfX:4,arenaHalfZ:7,recipe:{kind:'woodland',seed:1,grass:{base:'#25452d',tip:'#9bbd58'},sunlight:'#ffe4ac',pollen:'#ffe9ad',shading:'cel'},quality:{tier:'low',grassCount:100,particleCount:0,shaftCount:0}})
  try {
    const leaf=resources.root.getObjectByName('woodland-canopy') as Mesh<never,MeshToonMaterial>
    const shader={uniforms:{},vertexShader:ShaderLib.toon.vertexShader,fragmentShader:ShaderLib.toon.fragmentShader} as Parameters<typeof leaf.material.onBeforeCompile>[0]
    leaf.material.onBeforeCompile(shader,{} as never)
    const camera=new PerspectiveCamera(40,1,.1,100),pixels=new Vector2(500,500),dice=new Map([['one',die()]])
    resources.update(.1,false,dice,0,-.5,camera,pixels)
    const centers=shader.uniforms.uFoliageReveals.value
    const x=centers[0].x
    resources.update(.1,false,dice,1,-.5,camera,pixels)
    expect(centers[0].x).toBeGreaterThan(x)
    expect(shader.uniforms.treeTime.value).toBe(0)
    resources.update(.1,false,new Map(),1,-.5,camera,pixels)
    expect(shader.uniforms.uFoliageRevealCount.value).toBe(0)
  } finally {resources.dispose()}
})

const die = (id = 'one') => ({id, diceType:'d20' as const, prevPosition:[-2,0,-10] as [number,number,number], targetPosition:[2,0,-10] as [number,number,number],prevRotation:[0,0,0,1] as [number,number,number,number],targetRotation:[0,0,0,1] as [number,number,number,number]})
it('projects interpolated dice in drawing-buffer pixels, rotates and resizes without reallocating', () => {
  const mesh = new Mesh(new BoxGeometry(), new MeshToonMaterial()), reveal = createFoliageReveal(mesh)
  const camera = new PerspectiveCamera(40, 2, .1, 100), pixels = new Vector2(1000,500), dice = new Map([['one',die()]])
  reveal.update(dice, .5, camera, pixels)
  const center = reveal.uniforms.uFoliageReveals.value[0], radius = center.z
  expect(center.x).toBeCloseTo(500); expect(center.y).toBeCloseTo(250); expect(center.w).toBeCloseTo(9)
  reveal.update(dice, 1, camera, pixels)
  expect(center.x).toBeGreaterThan(500)
  const x = center.x
  pixels.multiplyScalar(2); reveal.update(dice, 1, camera, pixels)
  expect(center.x).toBeCloseTo(x*2); expect(center.z).toBeGreaterThan(radius*2)
  camera.rotation.z = Math.PI/2; reveal.update(dice, 1, camera, pixels)
  expect(center.x).toBeCloseTo(1000); expect(center.y).toBeLessThan(500)
  expect(reveal.uniforms.uFoliageReveals.value[0]).toBe(center)
  reveal.dispose(); mesh.geometry.dispose(); mesh.material.dispose()
})
it('admits the complete room cap and immediately clears removed, invalid, offscreen and retired centers', () => {
  const mesh = new Mesh(new BoxGeometry(),new MeshToonMaterial()), reveal=createFoliageReveal(mesh), camera=new PerspectiveCamera(40,1,.1,100), pixels=new Vector2(500,500)
  const dice=new Map(Array.from({length:ROOM_DICE_CAPACITY},(_,i)=>[String(i),die(String(i))]))
  reveal.update(dice,.5,camera,pixels);expect(reveal.uniforms.uFoliageRevealCount.value).toBe(ROOM_DICE_CAPACITY)
  reveal.update(new Map(),1,camera,pixels);expect(reveal.uniforms.uFoliageRevealCount.value).toBe(0)
  for(const pos of [[0,0,10],[NaN,0,-10],[100,0,-10]]){
    const d=die();d.prevPosition=d.targetPosition=pos as [number,number,number]
    reveal.update(new Map([['one',d]]),1,camera,pixels);expect(reveal.uniforms.uFoliageRevealCount.value).toBe(0)
  }
  reveal.update(dice,1,camera,new Vector2(0,0));expect(reveal.uniforms.uFoliageRevealCount.value).toBe(0)
  reveal.dispose();reveal.update(dice,1,camera,pixels);expect(reveal.uniforms.uFoliageRevealCount.value).toBe(0)
  mesh.geometry.dispose();mesh.material.dispose()
})
it('supports orthographic projection and gates the color hook to the accepted gameplay camera', () => {
  const mesh=new Mesh(new BoxGeometry(),new MeshToonMaterial()), prior=mesh.onBeforeRender, reveal=createFoliageReveal(mesh),camera=new OrthographicCamera(-5,5,5,-5,.1,100)
  reveal.update(new Map([['one',die()]]),.5,camera,new Vector2(500,500));expect(reveal.uniforms.uFoliageReveals.value[0].x).toBeCloseTo(250)
  mesh.onBeforeRender({} as never,{} as never,camera,mesh.geometry,mesh.material,{} as never);expect(reveal.uniforms.uFoliageRevealEnabled.value).toBe(1)
  mesh.onBeforeRender({} as never,{} as never,new PerspectiveCamera(),mesh.geometry,mesh.material,{} as never);expect(reveal.uniforms.uFoliageRevealEnabled.value).toBe(0)
  reveal.dispose();reveal.dispose();expect(mesh.onBeforeRender).toBe(prior);mesh.geometry.dispose();mesh.material.dispose()
})
