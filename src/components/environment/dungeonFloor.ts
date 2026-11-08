import * as THREE from 'three'

/** A single indexed mesh: 2,565 individually cut stones, never 2,565 draw calls.
 * Course depths and joint positions vary independently. Each octagonal outline
 * has four independent chipped corners and a shallow, asymmetric worn crown.
 * Generation is mount-only; no canvas textures, frame work or owned materials.
 */
export function createDungeonFloorGeometry(seed: number) {
  let state = seed >>> 0
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], stones: number[] = [], indices: number[] = []
  const depths = Array.from({ length: 57 }, () => .72 + random() * .86)
  const depthScale = 55.6 / depths.reduce((a, b) => a + b, 0)
  let z = -27.8, id = 0, minW = Infinity, maxW = 0, minD = Infinity, maxD = 0
  for (const rawDepth of depths) {
    const depth = rawDepth * depthScale
    const widths = Array.from({ length: 45 }, () => .64 + random() * 1.55)
    const widthScale = 55.8 / widths.reduce((a, b) => a + b, 0)
    let x = -27.9
    for (const rawWidth of widths) {
      const width = rawWidth * widthScale, gap = .025 + random() * .024
      const w = width - gap, d = depth - gap, cx = x + width / 2, cz = z + depth / 2
      minW = Math.min(minW, w); maxW = Math.max(maxW, w); minD = Math.min(minD, d); maxD = Math.max(maxD, d)
      const chips = Array.from({ length: 8 }, () => .025 + random() * .13)
      const outline = [[-w/2+chips[0],-d/2],[w/2-chips[1],-d/2],[w/2,-d/2+chips[2]],[w/2,d/2-chips[3]],[w/2-chips[4],d/2],[-w/2+chips[5],d/2],[-w/2,d/2-chips[6]],[-w/2,-d/2+chips[7]]]
      const base = positions.length / 3, identity = ++id / 2566
      const shade = .71 + random() * .27, warmth = random()
      const crown = .032 + random() * .013
      const put = (px: number, y: number, pz: number, wear: number) => {
        positions.push(cx + px, y, cz + pz)
        // Continuous source-map sampling (not the old per-tile UV translation).
        uvs.push((cx + px) * .31, (cz + pz) * .31)
        stones.push(px / w + .5, pz / d + .5, identity)
        colors.push(shade * wear, shade * (.97 + warmth * .035) * wear, shade * (.91 + warmth * .07) * wear)
      }
      put((random()-.5)*w*.2, crown, (random()-.5)*d*.2, 1)
      // Inner crown, chipped bevel, dark sides. 25 vertices per stone.
      for (const [px,pz] of outline) put(px*.91, crown - .005 - random()*.008, pz*.91, .98 + random()*.025)
      for (const [px,pz] of outline) put(px, .006 + random()*.009, pz, .82 + random()*.09)
      for (const [px,pz] of outline) put(px, -.15, pz, .66)
      for (let j = 0; j < 8; j++) {
        const k = (j + 1) % 8
        // Outline is clockwise as seen from above; native top normals face up.
        indices.push(base, base+1+k, base+1+j)
        for (const ring of [1,9]) indices.push(base+ring+j,base+ring+k,base+ring+8+j,base+ring+k,base+ring+8+k,base+ring+8+j)
      }
      x += width
    }
    z += depth
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setAttribute('aStone', new THREE.Float32BufferAttribute(stones, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere()
  geometry.userData = { stoneCount: id, widthRange: [minW,maxW], depthRange: [minD,maxD], recipe: 'hand-cut-crypt-v1' }
  return geometry
}

/** Floor-only albedo geology. Native cel incident light and shadow chunks remain
 * untouched; this is not emissive fill, an exposure adjustment or a light floor.
 * Existing authored maps supply quiet grain, not a repeated tile composition.
 */
export function attachDungeonFloorSurface(material: THREE.MeshToonMaterial) {
  material.vertexColors = true
  const compile = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    compile(shader, renderer)
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec3 aStone;
varying vec3 vDungeonStone;
varying vec2 vDungeonGround;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vDungeonStone = aStone;
vDungeonGround = position.xz;`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vDungeonStone;
varying vec2 vDungeonGround;
float dungeonStoneHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float dungeonStoneNoise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(dungeonStoneHash(i),dungeonStoneHash(i+vec2(1,0)),f.x),mix(dungeonStoneHash(i+vec2(0,1)),dungeonStoneHash(i+vec2(1,1)),f.x),f.y);
}`).replace('#include <map_fragment>', `
vec3 floorUnmapped = diffuseColor.rgb;
#include <map_fragment>
// Compress the authored image's composition; keep its small-scale stone grain.
#ifdef USE_MAP
  diffuseColor.rgb = mix(diffuseColor.rgb, floorUnmapped * .22, .78);
#endif
vec2 ground = vDungeonGround;
float stoneId = dungeonStoneHash(vec2(vDungeonStone.z * 8191.0,9.2)) * 8191.0;
float mineral = dungeonStoneNoise(ground*2.3 + stoneId);
float grain = dungeonStoneNoise(ground*17.0);
float damp = smoothstep(.39,.76,dungeonStoneNoise(ground*.31+vec2(21.7,-8.2)));
float strata = dungeonStoneNoise(vec2(ground.x*1.9+ground.y*.7,ground.y*5.2)+stoneId);
diffuseColor.rgb *= (.79 + mineral*.29 + grain*.09 + strata*.12) * (1.0-damp*.28);
diffuseColor.rgb *= mix(vec3(1.0),vec3(.86,.94,.89),damp*.5);
// Some stones split along short meandering faults; most retain quiet faces.
float fractureAngle = fract(stoneId*3.71)*6.2831853;
vec2 local = mat2(cos(fractureAngle),-sin(fractureAngle),sin(fractureAngle),cos(fractureAngle))*(vDungeonStone.xy-.5)+.5;
float broken = step(.69, fract(stoneId*13.17));
float fault = local.x - (.28 + fract(stoneId)*.42 + (local.y-.5)*.36 + (dungeonStoneNoise(vec2(local.y*11.0,stoneId))-.5)*.16);
float aa = max(fwidth(fault),.001);
float floorFracture = (1.0-smoothstep(.001, .003+aa,abs(fault))) * broken;
float fractureLength = smoothstep(.08,.27,local.y) * (1.0-smoothstep(.67,.94,local.y));
diffuseColor.rgb *= 1.0-floorFracture*fractureLength*.55;
`)
  }
  material.customProgramCacheKey = () => 'dungeon-hand-cut-geology-night-cel-v1'
  return material
}
