import * as THREE from 'three'
import { attachDungeonFloorSurface, createDungeonFloorGeometry } from './dungeonFloor'
import { attachWorldCel } from './environmentCel'
import { createTextureOwner, resolveWorldLayout } from './environmentRuntime'
import type { EnvironmentQuality } from '../../lib/environmentQuality'
type Point = [number, number, number]
type Transform = { p: Point; r?: Point; s?: Point; c?: THREE.Color }
type Surface = 'brick' | 'stone' | 'wood' | 'iron' | 'moss' | 'bone' | 'leather'
interface DungeonOptions { quality: EnvironmentQuality; arenaHalfX: number; arenaHalfZ: number; groundY: number; seed: number }

// Geometry and material recipes ported from the frozen reviewed dungeon factory.
function roundedBox(w: number, h: number, d: number, bevel = .045) {
  // Shared subdivided box, vertex-clamped to an inset cuboid with rounded corners.
  const geometry = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
  const p = geometry.attributes.position, n = new THREE.Vector3(), inner = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    n.fromBufferAttribute(p, i);
    inner.set(THREE.MathUtils.clamp(n.x,-w/2+bevel,w/2-bevel),THREE.MathUtils.clamp(n.y,-h/2+bevel,h/2-bevel),THREE.MathUtils.clamp(n.z,-d/2+bevel,d/2-bevel));
    n.sub(inner).normalize().multiplyScalar(bevel).add(inner);
    p.setXYZ(i,n.x,n.y,n.z);
  }
  geometry.computeVertexNormals();
  const uv = geometry.attributes.uv, normal = geometry.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const nx=Math.abs(normal.getX(i)), ny=Math.abs(normal.getY(i)), nz=Math.abs(normal.getZ(i));
    if (ny >= nx && ny >= nz) uv.setXY(i,p.getX(i)*.85,p.getZ(i)*.85);
    else if (nx >= nz) uv.setXY(i,p.getZ(i)*.85,p.getY(i)*.85);
    else uv.setXY(i,p.getX(i)*.85,p.getY(i)*.85);
  }
  return geometry;
}
function linkGeometry() {
  const path = new THREE.CurvePath<THREE.Vector3>();
  // Actual elongated closed oval wire, not a line or a torus silhouette card.
  class Oval extends THREE.Curve<THREE.Vector3> {
    constructor() { super() }
    getPoint(t: number, target = new THREE.Vector3()) {
      const angle=t*Math.PI*2;
      return target.set(Math.cos(angle)*.125, Math.sin(angle)*.205,0);
    }
  }
  path.add(new Oval());
  return new THREE.TubeGeometry(path, 24, .028, 6, true);
}

/** Caller owns scene/renderer; this object owns only the resources it creates. */
export function createDungeonEnvironment({ quality, arenaHalfX, arenaHalfZ, groundY, seed }: DungeonOptions) {
  const tier = quality.tier === 'low' ? 'low' : 'standard'
  const layout = resolveWorldLayout(arenaHalfX, arenaHalfZ)
  const root = new THREE.Group(); root.name = 'monster-dungeon-environment'
  root.position.y = groundY - 0.04
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.MeshToonMaterial | THREE.MeshBasicMaterial>()
  const textures = new Set<THREE.Texture>(), textureOwner = createTextureOwner()
  const materialSurfaces = new Map<THREE.MeshToonMaterial, Surface>()
  let normalsEnabled = true
  let disposed = false, currentTime = 0
  const loader = new THREE.TextureLoader()
  const maps = {} as Record<Surface, { map: THREE.Texture; normalMap: THREE.Texture }>
  for (const kind of ['brick','stone','wood','iron','moss','bone','leather'] as const) {
    const pair = { map: new THREE.Texture(), normalMap: new THREE.Texture() }
    maps[kind] = pair
    for (const suffix of ['albedo','normal'] as const) {
      const placeholder = suffix === 'albedo' ? pair.map : pair.normalMap
      textures.add(placeholder)
      placeholder.wrapS = placeholder.wrapT = THREE.RepeatWrapping
      placeholder.colorSpace = suffix === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace
      placeholder.anisotropy = quality.tier === 'high' ? 4 : 1
      // Decode can complete after a theme switch. Never publish into a retired root.
      void loader.loadAsync(`/environments/monster-dungeon/${kind}-${suffix}.png`).then(texture => {
        textureOwner.accept(texture, loaded => {
          placeholder.image = loaded.image; placeholder.needsUpdate = true
          for (const [material, surface] of materialSurfaces) if (surface === kind) {
            if (suffix === 'albedo') material.map = placeholder
            else if (normalsEnabled) material.normalMap = placeholder
            material.needsUpdate = true
          }
        })
      }).catch(() => { /* Decorative failure keeps a lit, playable untextured world. */ })
    }
  }
  const compileToon=(kind: Surface,color: THREE.ColorRepresentation,normal: number)=>{
    // Empty Texture objects sample black. Attach each map only after decode.
    const m=attachWorldCel(new THREE.MeshToonMaterial({color,normalScale:new THREE.Vector2(normal,normal)}), 'night');
    materialSurfaces.set(m, kind)
    const compile=m.onBeforeCompile;
    m.onBeforeCompile=(shader,renderer)=>{
      compile(shader,renderer);
      shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
#ifdef USE_INSTANCING
  vec2 dungeonTileOffset=vec2(instanceMatrix[3].x*.137,instanceMatrix[3].z*.217);
  #ifdef USE_MAP
    vMapUv+=dungeonTileOffset;
  #endif
  #ifdef USE_NORMALMAP
    vNormalMapUv+=dungeonTileOffset;
  #endif
#endif`);
    };
    m.customProgramCacheKey=()=> 'dungeon-world-tile-uv-night-cel-v2';
    return m;
  };
  const toon=(kind: Surface,color=0xffffff,normal=.55)=>{
    const material=compileToon(kind,color,normal);
    materials.add(material); return material;
  };
  const stone=toon('stone',0xc4c6b4,.8), brick=toon('brick',0xc1b59f,.7), trim=toon('stone',0xa8b5b0,.55);
  const mortar=toon('stone',0x363f40,.5), iron=toon('iron',0xa4b0b0,.8), wood=toon('wood',0xb4a488,.7), moss=toon('moss',0xa4b05d,.85);
  const dummy=new THREE.Object3D();
  function geometry<T extends THREE.BufferGeometry>(g: T) { geometries.add(g); return g; }
  function batch(name: string,g: THREE.BufferGeometry,m: THREE.Material,transforms: Transform[],cast=true) {
    geometry(g);
    const mesh=new THREE.InstancedMesh(g,m,transforms.length);
    mesh.name=name; mesh.castShadow=cast; mesh.receiveShadow=true; mesh.raycast=()=>{};
    transforms.forEach((t,i)=>{
      const [x,y,z] = t.p; dummy.position.set(name.includes('flagstone') || name.includes('floor') ? x : layout.edgeX(x), y, name.includes('floor') || name.includes('flagstone') ? z : Math.abs(z) >= 4.3 ? layout.edgeZ(z) : z); dummy.rotation.set(...(t.r||[0,0,0])); dummy.scale.set(...(t.s||[1,1,1]));dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
      if(t.c) mesh.setColorAt(i,new THREE.Color(t.c));
    });
    mesh.computeBoundingSphere();root.add(mesh);return mesh;
  }
  const solid=(name: string,g: THREE.BufferGeometry,m: THREE.Material,p: Point,r: Point=[0,0,0])=>batch(name,g,m,[{p,r}]);
  // Continuous world is much larger than either camera footprint. No tray edge.
  solid('continuous deep flagstone mortar',new THREE.BoxGeometry(layout.groundSize,.4,layout.groundSize),mortar,[0,-.29,0]);
  const floorGeometry = geometry(createDungeonFloorGeometry(seed));
  const floorMaterial = attachDungeonFloorSurface(toon('stone',0xc4c6b4,.24));
  const floor = new THREE.Mesh(floorGeometry,floorMaterial);
  // Retain the stable inspected name/count for native diagnostics and texture
  // lifecycle callers. The old rounded-box grid is no longer used by this mesh.
  floor.name='2565 continuous worn flagstones';
  floor.receiveShadow=true;floor.castShadow=false;floor.raycast=()=>{};
  root.add(floor);
  const wall: Transform[]=[];
  for(let row=0;row<7;row++) for(let col=-18;col<=18;col++) {
    const x=col*1.18+(row%2)*.59;
    if(Math.abs(x)<1.8&&row<5) continue;
    wall.push({p:[x,.3+row*.58,-5.7],c:new THREE.Color(.82+(col+19)%4*.05,.87+(row%3)*.04,.9)});
  }
  for(const side of [-1,1]) for(let row=0;row<6;row++) for(let j=-24;j<=24;j++) wall.push({p:[side*7.25,.3+row*.58,j*1.18+(row%2)*.59],r:[0,Math.PI/2,0]});
  batch('aged coursed crypt walls extending beyond frustum',roundedBox(1.14,.54,.65,.045),brick,wall);
  const wallCore=geometry(new THREE.BoxGeometry(20,4.05,.56));
  batch('back wall mortar cores leave a real open passage',wallCore,mortar,[{p:[-11.8,2,-5.85]},{p:[11.8,2,-5.85]}]);
  solid('arch upper mortar spandrel',new THREE.BoxGeometry(3.6,.7,.56),mortar,[0,3.85,-5.85]);
  // Actual dark passage below an arched continuation, not a backdrop panel.
  const passage: Transform[]=[];
  for(let x=-1;x<=1;x++)for(let z=-6;z>=-14;z--)passage.push({p:[x*1.24,-.06,z*.96]});
  batch('passage floor continuation',roundedBox(1.20,.20,.91,.045),stone,passage);
  const pillars: Transform[]=[];
  for(const x of [-5.1,5.1]) for(const z of [-4.3,4.8,12,-13]) for(let y=0;y<5;y++) pillars.push({p:[x,.32+y*.55,z],r:[0,(y%2)*.07,0],s:[1,1,1]});
  batch('thick engaged octagonal pier drums',new THREE.CylinderGeometry(.67,.71,.52,8),trim,pillars);
  const bases: Transform[]=[];
  for(const x of [-5.1,5.1])for(const z of [-4.3,4.8,12,-13])for(const y of [.15,2.9])bases.push({p:[x,y,z]});
  batch('broad pier plinths and capitals',roundedBox(1.65,.32,1.65,.065),brick,bases);
  // Voussoirs cross a real arch; back arch crown is intentionally camera-cropped.
  const arch: Transform[]=[];
  for(let i=0;i<13;i++){
    const a=Math.PI*i/12;
    arch.push({p:[Math.cos(a)*2.05,1.65+Math.sin(a)*2.05,-5.38],r:[0,0,a-Math.PI/2]});
  }
  batch('back arched doorway individual voussoirs',roundedBox(.53,.65,.94,.04),trim,arch);
  const jambs: Transform[]=[];
  for(const x of [-2.05,2.05])for(let y=0;y<3;y++)jambs.push({p:[x,.32+y*.55,-5.38]});
  batch('arched doorway thick jambs',roundedBox(.67,.53,.94,.045),trim,jambs);
  // Side transverse rib fragments suggest a ceiling cut away for gameplay.
  const ribs: Transform[]=[];
  for(const side of [-1,1])for(const z of [-1.9,6.7])for(let i=0;i<5;i++){
    const a=i*.12;
    ribs.push({p:[side*(7.1-i*.38),2.8+Math.sin(a)*1.4,z],r:[0,0,side*(-a)],s:[1,1,1]});
  }
  batch('cropped overhead vault rib continuation',roundedBox(.53,.43,.7,.035),trim,ribs);
  // Worn timber cellar racks at edges. This is scenery, never a new collider.
  const boards: Transform[]=[], straps: Transform[]=[];
  for(const side of [-1,1])for(let i=0;i<5;i++)boards.push({p:[side*6.05,.35,-1.7+i*.24],r:[0,Math.PI/2,0]});
  batch('worn oak cellar shelf planks',roundedBox(1.45,.12,.2,.025),wood,boards);
  for(const side of [-1,1])for(const z of [-1.65,-.72])straps.push({p:[side*6.05,.25,z],r:[0,Math.PI/2,0]});
  batch('cellar shelf iron brackets',roundedBox(1.4,.16,.055,.015),iron,straps);
  const chain: Transform[]=[];
  // Low sagging chains above perimeter floor give overhead-visible real link shadows.
  for(const side of [-1,1])for(let i=0;i<34;i++) {
    const t=i/33;
    chain.push({p:[side*(3.8+Math.sin(t*Math.PI)*.23),.30+Math.pow(t-.5,2)*3.4,-3.7+t*7.6],r:[Math.PI/2,(i%2)*Math.PI/2,0]});
  }
  for(const x of [-2.55,2.55])for(let i=0;i<12;i++)chain.push({p:[x,.32+i*.21,-4.62],r:[0,(i%2)*Math.PI/2,0]});
  const chains=batch('92 individually closed alternating iron chain links',linkGeometry(),iron,chain);
  const anchors: Transform[]=[];
  for(const side of [-1,1])for(const z of [-3.7,3.9])anchors.push({p:[side*3.8,1.2,z],r:[0,0,Math.PI/2]});
  batch('stone chain bollards',new THREE.CylinderGeometry(.18,.24,1.1,8),trim,anchors.map(t=>({p:[t.p[0],.55,t.p[2]]})));
  batch('forged chain anchor rings',new THREE.TorusGeometry(.15,.035,6,16),iron,anchors);
  const growth: Transform[]=[];
  let randomSeed=seed;
  const random=()=>{randomSeed=(Math.imul(randomSeed,1664525)+1013904223)>>>0;return randomSeed/4294967296;};
  for(let i=0;i<(tier==='low'?180:360);i++) {
    const side=random()<.5?-1:1;
    const x=side*(3.3+random()*3.9),z=-6+random()*15;
    if(random()>.7&&Math.abs(z)<3.2)continue;
    growth.push({p:[x,.055,z],s:[.18+random()*.42,.025+random()*.06,.13+random()*.3],r:[0,random()*6.28,0],c:new THREE.Color(.65+random()*.3,.77+random()*.2,.6)});
  }
  // Correlated small geometry clusters remain outside the numeral-reading center.
  batch('damp moss cushions in sheltered floor joints',new THREE.IcosahedronGeometry(1,1),moss,growth,false);
  const seamMoss: Transform[]=[];
  for(let i=0;i<100;i++){const x=-12+random()*24;seamMoss.push({p:[x,.18+random()*.7,-5.28],s:[.1+random()*.28,.035+random()*.12,.065],r:[0,0,random()*.5]});}
  batch('damp moss in worn wall joints',new THREE.IcosahedronGeometry(1,1),moss,seamMoss,false);
  const warmLights: THREE.PointLight[]=[], flames: THREE.Mesh[]=[];
  const flameOuter=new THREE.MeshBasicMaterial({color:0xff8936});materials.add(flameOuter);
  const flameInner=new THREE.MeshBasicMaterial({color:0xffd38a});materials.add(flameInner);
  const torches=[[-3.08,1.35,-4.45],[3.08,1.35,-4.45],[-5.7,.8,2.4],[5.7,.8,2.4]];
  for(const [originalX,y,originalZ]of torches){
    const x=layout.edgeX(originalX),z=layout.edgeZ(originalZ);
    solid('forged torch wall plate',roundedBox(.3,.44,.12,.025),iron,[originalX,y-.2,originalZ-.09]);
    solid('charred torch handle',new THREE.CylinderGeometry(.055,.075,.65,8),wood,[originalX,y-.05,originalZ+.1],[.2,0,.09]);
    solid('iron torch basket',new THREE.CylinderGeometry(.145,.085,.24,8,1,true),iron,[originalX,y+.28,originalZ+.17]);
    const flame=new THREE.Mesh(geometry(new THREE.ConeGeometry(.115,.40,7)),flameOuter);flame.position.set(x,y+.6,z+.17);flame.raycast=()=>{};root.add(flame);flames.push(flame);
    const inner=new THREE.Mesh(geometry(new THREE.ConeGeometry(.06,.25,6)),flameInner);inner.position.set(x+.01,y+.55,z+.20);inner.raycast=()=>{};root.add(inner);
    const point=new THREE.PointLight(0xffb269,42,Math.max(24,arenaHalfZ*3),2);point.position.set(x,y+.65,z+.2);root.add(point);warmLights.push(point);
  }
  // One local shadowed torch on high; no duplicate global sun, hemisphere or HDR.
  let torchShadow: THREE.SpotLight | undefined
  if (quality.tier === 'high') {
    torchShadow = new THREE.SpotLight(0xffad65, 30, 13, Math.PI/2.7, .25, 2)
    torchShadow.position.set(layout.edgeX(3.08), 2.15, layout.edgeZ(-4.25))
    torchShadow.target.position.set(1, 0, 0); torchShadow.castShadow = true
    torchShadow.shadow.mapSize.setScalar(512)
    torchShadow.shadow.bias = -.00025; torchShadow.shadow.normalBias = .018
    root.add(torchShadow, torchShadow.target)
  }
  const stats = { tier, floorInstances: floorGeometry.userData.stoneCount as number, wallInstances: wall.length, chainLinks: chain.length, textureCount: textures.size }

  const controls={maps, chains, warmLights, get time(){return currentTime;}, setNormals(enabled: boolean){normalsEnabled=enabled;for(const[m,kind]of materialSurfaces){const map=maps[kind].normalMap;m.normalMap=enabled&&map.image?map:null;m.needsUpdate=true;}},setTorches(enabled: boolean){for(const light of warmLights)light.visible=enabled;if(torchShadow)torchShadow.visible=enabled;},setShadows(enabled: boolean){if(torchShadow)torchShadow.castShadow=enabled;},setChainVisible(enabled: boolean){chains.visible=enabled;},setChainShadow(enabled: boolean){chains.castShadow=enabled;}};
  return {root,stats,controls,
    update(delta: number, animate = true){
      if(disposed)return;
      if(animate) currentTime += Number.isFinite(delta) ? Math.max(0, Math.min(delta,.05)) : 0;
      for(let i=0;i<warmLights.length;i++){
        const pulse=1+.018*Math.sin(currentTime*2.15+i*1.7)+.009*Math.sin(currentTime*3.7+i);
        warmLights[i].intensity=42*pulse;
        flames[i].scale.set(1,1+.035*Math.sin(currentTime*2.15+i*1.7),1);
      }
    },
    dispose(){
      if(disposed)return;disposed=true;root.removeFromParent();
      root.traverse(object=>{if(object instanceof THREE.InstancedMesh)object.dispose();});
      for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();
      textureOwner.dispose();if(torchShadow)torchShadow.shadow.dispose();root.clear();
    }
  };
}
