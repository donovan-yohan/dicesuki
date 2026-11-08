/**
 * New LAST BOWL procedural texture and sign artwork: CC0-1.0.
 * Retained implementation and dependency code remains under its existing terms.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { quality as cyberpunkQuality, puddleOutline, clampDelta, random, surfaceKinds, type SurfaceKind, type SurfaceSize } from './cyberpunkSurfaces'
import { prepareCyberpunkSurfaces } from './cyberpunkSurfacePreparation'
import { attachWorldCel } from './environmentCel'
import { resolveWorldLayout } from './environmentRuntime'
import type { EnvironmentQuality } from '../../lib/environmentQuality'
type Point = [number, number, number]
interface CyberpunkOptions { quality: EnvironmentQuality; arenaHalfX: number; arenaHalfZ: number; groundY: number; seed: number }


/** @typedef {{tier:'low'|'high'}} Options */
/** Root owns all GPU resources. Caller owns camera, renderer and loop. */
export function createCyberpunkEnvironment({ quality, arenaHalfX, arenaHalfZ, groundY, seed }: CyberpunkOptions) {
  const tier=quality.tier==='high'?'high':'low';
  const policy=cyberpunkQuality(tier),layout=resolveWorldLayout(arenaHalfX,arenaHalfZ),root=new THREE.Group();root.position.y=groundY;root.name='cyberpunk-environment-last-bowl';
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>(),batches=new Map<string,{m: THREE.Material; gs: THREE.BufferGeometry[]; reflect: boolean}>(),animated: {mesh: THREE.Mesh; x: number; z: number; phase: number}[]=[];
  let disposed=false,time=0,neon=true,reflections=true,refresh=true,lastReflection=-1,reflectionPasses=0;
  const shared={uTime:{value:0}};
  const neonLights: THREE.PointLight[]=[];
  const ownMat=<T extends THREE.Material>(m: T)=>{materials.add(m);return m;};
  const ownTex=<T extends THREE.Texture>(t: T)=>{textures.add(t);return t;};
  // Native lit untextured materials are immediately usable while pure pixels
  // are prepared off-thread. GPU textures and publication belong to this root.
  const surfaceBindings: { material: THREE.MeshToonMaterial; kind: SurfaceKind; normals: boolean }[]=[];
  let surfaceStatus: 'pending' | 'ready' | 'unavailable' | 'cancelled'='pending';
  let surfaceError: string | null=null;
  const wetFallback=ownTex(new THREE.DataTexture(new Uint8Array([52,56,59,255]),1,1));
  wetFallback.colorSpace=THREE.SRGBColorSpace;wetFallback.needsUpdate=true;
  // The study used analytic illumination and had no shadow chunks. Production
  // uses real Three lights and the dungeon's combined-light bands, so rolling
  // dice and architecture genuinely shadow this pavement. No dice materials change.
  function cel(color: THREE.ColorRepresentation,{map=null,normal=null,surface,normals=true,repeat=1,metal=0,gloss=.2}: {map?: THREE.Texture | null; normal?: THREE.Texture | null; surface?: SurfaceKind; normals?: boolean; repeat?: number; metal?: number; gloss?: number; contact?: boolean}={}) {
    const m=attachWorldCel(new THREE.MeshToonMaterial({color,map,normalMap:normal,normalScale:new THREE.Vector2(.24,.24)}), 'night')
    m.onBeforeCompile=((compile)=> (shader,renderer)=>{
      compile(shader,renderer)
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n#ifdef USE_MAP\ndiffuseColor.rgb *= 3.8;\n#endif')
      shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
#ifdef USE_MAP
vMapUv *= ${repeat.toFixed(1)};
#endif
#ifdef USE_NORMALMAP
vNormalMapUv *= ${repeat.toFixed(1)};
#endif`)
    })(m.onBeforeCompile)
    m.customProgramCacheKey=()=>`cyberpunk-world-night-cel-${repeat}-${metal}-${gloss}`
    if(surface)surfaceBindings.push({material:m,kind:surface,normals});
    return ownMat(m)
  }
  const ground=cel(0xadb0ad,{surface:'paving',repeat:layout.groundSize/12,contact:true,gloss:0});
  const masonry=cel(0xb1b4a1,{surface:'wall',repeat:2});
  const dark=cel(0x273039,{surface:'metal'}), steel=cel(0x9aada8,{surface:'metal'}), edge=cel(0x111b23),rust=cel(0x9f5836,{surface:'metal',normals:false}),cream=cel(0xc9b890,{surface:'enamel'}),hazard=cel(0xc0a540,{surface:'enamel'});
  const rubber=cel(0x50595b,{surface:'rubber',repeat:3}),redPaint=cel(0x9b3b32,{surface:'enamel'}),patch=cel(0x6f777b,{surface:'paving',repeat:1}),paper=cel(0xbab39d,{surface:'enamel',normals:false}),warm=ownMat(new THREE.MeshBasicMaterial({color:new THREE.Color(0xf2dca3).multiplyScalar(2.4)}));
  const cyan=ownMat(new THREE.MeshBasicMaterial({color:new THREE.Color(0x56c8d5).multiplyScalar(5)})),pink=ownMat(new THREE.MeshBasicMaterial({color:new THREE.Color(0xee533b).multiplyScalar(5)}));
  const signMaterials: (THREE.MeshBasicMaterial | THREE.MeshToonMaterial)[]=[cyan,pink];
  const repaintSigns: (()=>void)[]=[]
  // No fetched fonts or image decode callbacks: all marks are authored synchronously.
  const font: FontFace | null=null;
  warm.userData.litColor=warm.color.clone();signMaterials.push(warm);
  cyan.userData.litColor=cyan.color.clone();pink.userData.litColor=pink.color.clone();
  function batch(g: THREE.BufferGeometry,m: THREE.Material,position: Point=[0,0,0],rotation: Point=[0,0,0],scale: Point=[1,1,1],reflect=false) {
    const positionMapped: Point = m === ground ? position : [layout.edgeX(position[0]),position[1],position[2]];
    const matrix=new THREE.Matrix4().compose(new THREE.Vector3(...positionMapped),new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),new THREE.Vector3(...scale));g.applyMatrix4(matrix);
    const key=m.uuid+(reflect?':ref':'');if(!batches.has(key))batches.set(key,{m,gs:[],reflect});batches.get(key)!.gs.push(g);
  }
  const box=(p: Point,s: Point,m: THREE.Material,rot: Point=[0,0,0],ref=false)=>batch(new THREE.BoxGeometry(...s),m,p,rot,[1,1,1],ref);
  function beam(a: Point,b: Point,r: number,m: THREE.Material,ref=false){const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A);const g=new THREE.CylinderGeometry(r,r,d.length(),8);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()));batch(g,m,A.add(B).multiplyScalar(.5).toArray() as Point,[0,0,0],[1,1,1],ref);}
  function floorPlate(points: number[][],y: number,m: THREE.Material){const shape=new THREE.Shape(points.map(p=>new THREE.Vector2(p[0],p[1])));const g=new THREE.ShapeGeometry(shape);batch(g,m,[0,y,0],[-Math.PI/2,0,0]);}
  batch(new THREE.PlaneGeometry(layout.groundSize,layout.groundSize),ground,[0,0,0],[-Math.PI/2,0,0]);
  // LAST BOWL: kitchen loading shoulder on west, municipal service riser east.
  // Unequal architecture; broad silhouettes first, small fittings only at the edges.
  box([-6.25,1.8,0],[2.2,3.6,44],masonry,[0,0,0],true);
  box([6.35,2.4,0],[2.3,4.8,44],dark,[0,0,0],true);
  box([-4.55,.12,-1.4],[1.1,.24,10.4],masonry,[0,0,0],true);
  box([4.6,.09,1.6],[.85,.18,12],masonry,[0,0,0],true);
  // Cast curb stones and scuffed, incomplete yellow safety band.
  for(let i=0;i<25;i++){
    const z=-11+i*.85;
    box([-4.05,.13,z],[.17,.26,.81],hazard);
    box([4.17,.11,z+.19],[.12,.22,.81],masonry);
    if(i%3!==0)box([-4.035,.267,z+.18],[.19,.012,.25],masonry);
  }
  // Kitchen shutter, sheet-metal rain hood and an offset grease extraction duct.
  box([-5.04,1.6,-2.5],[.18,2.8,4.9],edge,[0,0,0],true);
  for(let i=0;i<23;i++)box([-4.9,.3+i*.11,-2.5],[.15,.065,4.7],steel,[0,0,0],true);
  box([-4.65,3.1,-2.5],[1.1,.14,5.3],redPaint,[0,0,.08],true);
  for(let i=0;i<7;i++)box([-4.65,3.19,-4.85+i*.75],[1.1,.035,.045],rust,[0,0,.08],true);
  box([-4.65,2.15,1.3],[.68,.9,1.15],steel,[0,0,0],true);
  box([-4.62,3.2,1.3],[.46,1.6,.62],dark,[0,0,0],true);
  for(let i=0;i<10;i++)box([-4.28,1.8+i*.07,1.3],[.045,.025,1.0],edge,[0,0,0],true);
  // Hot-water return, one corroded elbow and cable loom on the service wall.
  for(const z of [-3.8,-3.56,4.7]){
    beam([4.94,.18,z],[4.94,3.4,z],.055,z===4.7?rust:steel,true);
    beam([4.94,3.4,z],[4.94,3.4,z+1.4],.055,rust,true);
  }
  box([4.8,1.28,2.8],[.38,2.1,2.0],rust,[0,0,0],true);
  box([4.56,1.28,2.8],[.12,1.88,1.8],dark,[0,0,0],true);
  for(let i=0;i<6;i++)box([4.48,1.65+i*.08,2.8],[.045,.025,1.4],steel,[0,0,0],true);
  for(const z of [-6.5,-.3,6.1]){
    box([5.06,2.3,z],[.3,.65,.42],cream,[0,0,0],true);
    for(let i=0;i<3;i++)beam([4.96,2.1,z+i*.08],[4.96,.3,z+i*.08],.023,edge,true);
  }
  // Sagging insulated cable, mounted only above the shoulder, not across dice.
  for(const side of [-1,1])for(let c=0;c<3;c++){
    for(let i=0;i<14;i++){
      const z=-10+i*1.5,y=3.4+c*.11-Math.sin(i/14*Math.PI)*.48;
      const zz=z+1.5,yy=3.4+c*.11-Math.sin((i+1)/14*Math.PI)*.48;
      beam([side*4.85,y,z],[side*4.85,yy,zz],.025,edge,true);
    }
  }
  // Ribbed dish-return mats and stacked washable crates, one functional cluster.
  box([-4.45,.26,-2.6],[.65,.035,2.3],rubber);
  for(let i=0;i<18;i++)box([-4.44,.285,-3.65+i*.12],[.6,.018,.035],edge);
  for(let i=0;i<3;i++){
    box([-4.48,.42+i*.33,.1],[.65,.31,.82],i===2?cream:redPaint,[0,0,0],true);
    for(let j=0;j<4;j++)box([-4.13,.42+i*.33,-.17+j*.17],[.015,.08,.09],edge,[0,0,0],true);
  }
  // Oil-safe runoff channel: longitudinal grate joins a diagonal foreground drain.
  box([-3.85,.014,0],[.18,.028,25],edge);
  for(let i=0;i<105;i++)box([-3.85,.031,-12+i*.23],[.16,.025,.045],steel);
  box([0,.008,5.6],[15,.018,.18],edge,[0,.13,0]);
  for(let i=0;i<50;i++)box([-7.2+i*.3,.025,5.6-(i-25)*.04],[.07,.025,.17],steel,[0,.13,0]);
  // Irregular repaired asphalt, tar seams, corner chips; no repeating paving grid.
  const rnd=random(seed^311);
  for(const [x,z,w,h] of [[-2.9,-3.8,1.1,1.7],[2.8,3.8,1.0,1.6],[-3.0,2.4,.55,1.2],[2.9,-4.5,.8,1.9]]){
    const pts=[[-w,-h],[w*.8,-h*.9],[w,h*.5],[w*.5,h],[-w*.85,h*.8]].map(([a,b])=>[x+a*.5,z+b*.5]);
    floorPlate(pts,.012,edge);
    floorPlate(pts.map(([a,b])=>[x+(a-x)*.92,z+(b-z)*.95]),.014,patch);
  }
  // Worn loading paint breaks up before entering the quiet dice corridor.
  for(let i=0;i<17;i++){
    const z=-6.1+i*.52;
    if(i===5||i===11)continue;
    box([-3.48,.019,z],[.065,.014,.3+rnd()*.16],cream,[0,.035,0]);
  }
  for(let i=0;i<7;i++)floorPlate([[-3.65+i*.19,4.1],[-3.56+i*.19,4.1],[-3.16+i*.19,4.65],[-3.25+i*.19,4.65]],.02,hazard);
  // Concrete wall repair patches and scraped poster backing vary by construction bay.
  for(const [x,z] of [[-4.8,3.0],[4.7,-2.1],[4.75,5.3]]){
    box([x,.24,z],[.55,.05,1.3],masonry);
    for(let i=0;i<6;i++)box([x+(rnd()-.5)*.3,.273,z+(rnd()-.5)*.9],[.08+rnd()*.17,.012,.12+rnd()*.25],paper,[0,rnd()*.3,0]);
  }
  // Beyond the lane, interrupted industrial silhouettes instead of neon pickets.
  for(let i=0;i<6;i++){
    const z=-19+i*7.1,x=(i%2?-1:1)*(8.3+(i%3));
    box([x,4+i%3,z],[3.1,7+i%3,4.4],dark,[0,0,0],true);
    if(i%2)box([x+1.6,4.6,z],[.035,.22,2.1],warm,[0,0,0],true);
  }
  function signTexture(title: string,sub: string){
    const c=document.createElement('canvas');c.width=512;c.height=256;const ctx=c.getContext('2d')!;
    const paint=()=>{
    const rnd=random(title.length*19+72);
    ctx.fillStyle=title==='LAST BOWL'?'#c5b99a':title==='HOT RETURN'?'#923f35':'#29383b';ctx.fillRect(0,0,512,256);
    // Hand-authored enamel, rolled edge, grease streaks, rust chipped at mount points.
    ctx.strokeStyle='#263235';ctx.lineWidth=12;ctx.strokeRect(8,8,496,240);
    ctx.fillStyle='#283335';ctx.font='900 57px sans-serif';ctx.fillText(title,26,108);
    ctx.font='700 24px monospace';ctx.fillText(sub,28,151);
    if(title==='LAST BOWL'){
      ctx.lineWidth=7;ctx.strokeStyle='#8e3d2e';ctx.beginPath();ctx.arc(408,180,55,0,Math.PI);ctx.stroke();
      ctx.beginPath();ctx.moveTo(350,173);ctx.lineTo(470,173);ctx.moveTo(394,149);ctx.lineTo(408,117);ctx.moveTo(420,151);ctx.lineTo(434,119);ctx.stroke();
      ctx.fillStyle='#8e3d2e';ctx.fillRect(27,181,257,33);ctx.fillStyle='#dbcfb4';ctx.font='700 23px monospace';ctx.fillText('KITCHEN / 24H',36,205);
    } else {
      ctx.fillStyle='#d1c099';ctx.fillRect(28,184,305,5);
      ctx.font='700 24px monospace';ctx.fillText('NO PUBLIC ACCESS',28,222);
    }
    for(let i=0;i<180;i++){
      const x=rnd()*512,y=rnd()*256;
      if(x<20||x>490||y<20||y>235||rnd()<.09){ctx.fillStyle=i%3?'#6e5140':'#293638';ctx.fillRect(x,y,2+rnd()*13,1+rnd()*5);}
    }
    for(const x of [20,490])for(const y of [20,235]){ctx.fillStyle='#434438';ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();}
    t.needsUpdate=true
    }
    const t=ownTex(new THREE.CanvasTexture(c));t.colorSpace=THREE.SRGBColorSpace
    paint();repaintSigns.push(paint);return t;
  }
  function sign(title: string,sub: string,pos: Point,rot: Point,w: number,h: number){
    const mat=ownMat(attachWorldCel(new THREE.MeshToonMaterial({map:signTexture(title,sub),side:THREE.DoubleSide}), 'night'));mat.userData.litColor=mat.color.clone();signMaterials.push(mat);
    // No HDR ink or custom compile override on painted enamel.
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);geometries.add(mesh.geometry);mesh.position.set(layout.edgeX(pos[0]),pos[1],pos[2]);mesh.rotation.set(...rot);mesh.layers.enable(1);mesh.name='physical-sign-'+title;mesh.raycast=()=>{};root.add(mesh);
    return mesh;
  }
  // One old kitchen canopy sign and one small maintenance plate: deliberately unequal.
  sign('LAST BOWL','DISH RETURN / WEST',[-4.65,2.7,-2.8],[-Math.PI/2,0,Math.PI/2-.045],2.5,.8);
  box([-4.65,2.62,-2.8],[.92,.14,2.62],rust,[0,-.045,0],true);
  sign('LAST BOWL','DISH RETURN / WEST',[-4.65,2.53,-2.8],[Math.PI/2,0,Math.PI/2+.045],2.5,.8);
  beam([-5.1,3.1,-3.0],[-4.65,3.1,-3],.055,steel,true);beam([-4.65,3.1,-3],[-4.65,2.7,-3],.04,steel,true);
  box([-4.17,2.78,-2.8],[.055,.055,2.1],warm,[0,-.045,0],true);
  sign('HOT RETURN','H-07 / KEEP CLEAR',[4.65,.8,2.8],[-Math.PI/2,0,Math.PI/2+.05],1.28,.55);
  box([4.65,.75,2.8],[.65,.1,1.4],edge,[0,.05,0],true);
  sign('LAST BOWL','LOADING ONLY',[-2.9,.018,1.8],[-Math.PI/2,0,0],1.7,.78);
  // Retain the real two local sources; cyan kitchen insect tube + red hot-water indicator.
  box([-3.7,.14,-2.3],[.07,.1,2.2],cyan,[0,0,0],true);
  box([3.85,.12,2.8],[.07,.1,1.2],pink,[0,0,0],true);
  const reflectionGeometries: THREE.BufferGeometry[]=[];
  for(const [seed,x,z,rx,rz] of [[41,-3.35,-2.7,.7,1.6],[12,3.25,2.7,.75,1.0],[18,-3.0,3.7,.55,.35],[61,2.9,-3.1,.5,.4]]) {
    const shape=new THREE.Shape(puddleOutline(seed,rx,rz).map(p=>new THREE.Vector2(p[0],p[1])));const g=new THREE.ShapeGeometry(shape);g.translate(layout.edgeX(x),-z,0);reflectionGeometries.push(g);
  }
  const puddleGeometry=mergeGeometries(reflectionGeometries)!;reflectionGeometries.forEach(g=>g.dispose());geometries.add(puddleGeometry);
  const reflectionShader={uniforms:{tDiffuse:{value:null},color:{value:new THREE.Color(0x101820)},textureMatrix:{value:new THREE.Matrix4()},uGround:{value:null},uReflect:{value:1},uTime:shared.uTime},
    vertexShader:`uniform mat4 textureMatrix;varying vec4 vReflect;varying vec3 vWorld;varying vec2 vGround;void main(){vGround=position.xy/${layout.groundSize.toFixed(1)}+.5;vReflect=textureMatrix*vec4(position,1.);vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform sampler2D tDiffuse,uGround;uniform float uReflect,uTime;varying vec4 vReflect;varying vec3 vWorld;varying vec2 vGround;void main(){vec2 uv=vReflect.xy/vReflect.w;vec2 ripple=vec2(sin(vWorld.z*19.+uTime*.7),cos(vWorld.x*14.-uTime*.45))*.0012;vec3 r=texture2D(tDiffuse,uv+ripple).rgb;vec2 groundUv=vGround*${(layout.groundSize/12).toFixed(4)};vec3 wet=texture2D(uGround,groundUv).rgb*.32+vec3(.005,.009,.013);float hi=max(r.r,max(r.g,r.b));float lo=min(r.r,min(r.g,r.b));float chroma=hi-lo;vec3 reflected=r*mix(.12,.78,smoothstep(.05,.30,chroma));gl_FragColor=vec4(wet+reflected*uReflect,1.);
    #include <colorspace_fragment>
    }`};
  const reflector=new Reflector(puddleGeometry,{textureWidth:policy.reflectionSize,textureHeight:policy.reflectionSize,multisample:0,clipBias:.003,shader:reflectionShader});
  reflector.name='wet-planar-receivers';reflector.rotation.x=-Math.PI/2;reflector.position.y=.028;
  reflector.getRenderTarget().texture.type=THREE.UnsignedByteType;reflector.camera.layers.set(1);reflector.raycast=()=>{};
  materials.add(reflector.material as THREE.ShaderMaterial);root.add(reflector);
  // Reflector is an unlit optical receiver. A single matching native shadow
  // receiver keeps rolling-die shadows present on wet areas as well as paving.
  const wetShadow = new THREE.Mesh(puddleGeometry, ownMat(new THREE.ShadowMaterial({color:0x080e18,opacity:.42,depthWrite:false})))
  wetShadow.rotation.x=-Math.PI/2;wetShadow.position.y=.030;wetShadow.receiveShadow=true;wetShadow.raycast=()=>{};root.add(wetShadow);
  // Uniform clone in Reflector needs deliberate rebinding for the one owner clock.
  (reflector.material as THREE.ShaderMaterial).uniforms.uTime=shared.uTime;(reflector.material as THREE.ShaderMaterial).uniforms.uGround.value=wetFallback;
  const reflectRender=reflector.onBeforeRender;
  let reflecting=false, animateReflections=true
  const previousView=new THREE.Matrix4(), previousProjection=new THREE.Matrix4()
  reflector.onBeforeRender=function(renderer,scene,camera,geometry,material,group){
    if(disposed || reflecting || !reflections)return
    const moved=!previousView.equals(camera.matrixWorld) || !previousProjection.equals(camera.projectionMatrix)
    if(!refresh && !moved && (!animateReflections || time-lastReflection<1/policy.reflectionHz))return
    previousView.copy(camera.matrixWorld);previousProjection.copy(camera.projectionMatrix)
    refresh=false;lastReflection=time;reflectionPasses++;reflecting=true
    const target=renderer.getRenderTarget(),autoClear=renderer.autoClear,xr=renderer.xr.enabled,shadow=renderer.shadowMap.autoUpdate,visible=this.visible
    const face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel()
    try { reflectRender.call(this,renderer,scene,camera,geometry,material,group) }
    // Binding restores the target's physical viewport/scissor (or the default's
    // DPR-scaled viewport). setViewport would overwrite it with logical defaults.
    finally { renderer.setRenderTarget(target,face,mip);renderer.autoClear=autoClear;renderer.xr.enabled=xr;renderer.shadowMap.autoUpdate=shadow;this.visible=visible;reflecting=false }
  };
  // Slow sparse vent wisps. Geometry, no video or world-raster backdrop.
  const steamGeo=new THREE.PlaneGeometry(.35,.8);geometries.add(steamGeo);
  const steamMat=ownMat(new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{},vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`varying vec2 vUv;void main(){float a=(1.-smoothstep(.0,.5,abs(vUv.x-.5)))*sin(vUv.y*3.14159)*.12;gl_FragColor=vec4(.32,.46,.53,a);}`}));
  const rng=random(seed ^ 87);
  for(let i=0;i<policy.steam;i++){const m=new THREE.Mesh(steamGeo,steamMat);const p={x:layout.edgeX(-4.1)+rng()*.5,z:-.6+rng()*.7,phase:rng()*6.28};m.rotation.x=-Math.PI/2;m.raycast=()=>{};root.add(m);animated.push({mesh:m,...p});}
  for(const {m,gs,reflect} of batches.values()){
    const g=mergeGeometries(gs)!;gs.forEach(g=>g.dispose());geometries.add(g);
    const mesh=new THREE.Mesh(g,m);mesh.raycast=()=>{};mesh.name='batched-'+(m.name||m.type);mesh.receiveShadow=true;mesh.castShadow=m!==ground;if(reflect)mesh.layers.enable(1);root.add(mesh);
  }
  for (const [x,y,z,color,power] of [[-3.6,2.7,-2.8,0x56c8d5,65],[3.7,3.1,2.7,0xee533b,75]]) {
    const light=new THREE.PointLight(color,power,Math.max(24,arenaHalfZ*3),2);light.position.set(layout.edgeX(x),y,z);root.add(light);neonLights.push(light)
  }
  const update=(delta: number,animate=true)=>{
    if(disposed)return;animateReflections=animate;const dt=clampDelta(delta);if(animate)time+=dt;shared.uTime.value=time;
    for(const p of animated){const cycle=(time*.15+p.phase)%1;p.mesh.position.set(p.x+Math.sin(time*.45+p.phase)*.13,.16+cycle*.9,p.z-cycle*.6);p.mesh.scale.setScalar(.7+cycle*.8);(p.mesh.material as THREE.Material).opacity=1;}
  };update(0,false);
  const preparation=prepareCyberpunkSurfaces(policy.textureSize as SurfaceSize);
  const surfacesReady=preparation.ready.then(result=>{
    if(disposed)return 'cancelled' as const;
    if(result.status!=='ready'){
      surfaceStatus=result.status;
      if(result.status==='unavailable')surfaceError=result.error;
      return surfaceStatus;
    }
    const created: THREE.Texture[]=[];
    try {
      const maps=Object.fromEntries(surfaceKinds.map(kind=>{
        const data=result.pixels[kind];
        const albedo=new THREE.DataTexture(data.albedo,policy.textureSize,policy.textureSize);created.push(albedo);
        albedo.colorSpace=THREE.SRGBColorSpace;
        const normal=new THREE.DataTexture(data.normal,policy.textureSize,policy.textureSize);created.push(normal);
        for(const t of [albedo,normal]){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;}
        return [kind,{albedo,normal}];
      })) as Record<SurfaceKind,{albedo:THREE.DataTexture;normal:THREE.DataTexture}>;
      if(disposed){for(const t of created)t.dispose();return 'cancelled' as const;}
      for(const {material,kind,normals} of surfaceBindings){material.map=maps[kind].albedo;material.normalMap=normals?maps[kind].normal:null;material.needsUpdate=true;}
      for(const t of created)ownTex(t);
      (reflector.material as THREE.ShaderMaterial).uniforms.uGround.value=maps.paving.albedo;
      textures.delete(wetFallback);wetFallback.dispose();refresh=true;surfaceStatus='ready';
    } catch {
      for(const t of created){textures.delete(t);t.dispose();}
      surfaceStatus='unavailable';surfaceError='Cyberpunk surface texture preparation failed';
    }
    return surfaceStatus;
  });
  return {root,policy,surfacesReady,reflectionSurface:reflector,celMaterial:cel,
    update,
    setNeon(value: boolean){neon=!!value;for(const light of neonLights)light.visible=neon;for(const m of signMaterials){if(neon)m.color.copy(m.userData.litColor);else m.color.set(0x101722);}refresh=true;},
    setReflections(value: boolean){reflections=!!value;(reflector.material as THREE.ShaderMaterial).uniforms.uReflect.value=reflections?1:0;refresh=true;},
    invalidateReflection(){refresh=true;},
    stats(){return {tier,time,neon,reflections,reflectionPasses,reflectionSize:policy.reflectionSize,reflectionHz:policy.reflectionHz,geometryObjects:geometries.size,materials:materials.size,textures:textures.size,steam:policy.steam,surfaceStatus,surfaceError,disposed};},
    dispose(){if(disposed)return;disposed=true;preparation.release();if(surfaceStatus==='pending')surfaceStatus='cancelled';surfaceBindings.length=0;if(font)document.fonts.delete(font);repaintSigns.length=0;reflector.getRenderTarget().dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();root.removeFromParent();root.clear();}
  };
}
