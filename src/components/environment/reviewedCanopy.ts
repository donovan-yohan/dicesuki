import * as T from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {attachCombinedCel} from '../../lib/woodlandCelMaterial'
import { createTextureOwner } from './environmentRuntime'
import barkUrl from './textures/bark-albedo.png'
import normalUrl from './textures/bark-normal.png'
import leafUrl from './textures/leaf-albedo.png'
interface CanopyOptions { halfX: number; halfZ: number; groundY: number; time: { value: number } }

export function createReviewedCanopy({ halfX, halfZ, groundY, time }: CanopyOptions) {
 const root=new T.Group(),textureOwner=createTextureOwner(),loader=new T.TextureLoader()
 const bark=new T.Texture(),normal=new T.Texture(),leafMap=new T.Texture()

 for(const tex of [bark,normal]){tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.anisotropy=4;tex.minFilter=T.LinearMipmapLinearFilter;}bark.colorSpace=leafMap.colorSpace=T.SRGBColorSpace;normal.colorSpace=T.NoColorSpace;
 // The eight reviewed anchors move with the arena. Trunk/leaf dimensions do not.
 const trees=[[-9.3,-3.5,1.1,5.8],[-8.7,4.5,.9,5.3],[9.6,2.5,1.2,6.2],[8.7,-4.8,.95,5.5],[-4.8,-7.8,.85,5.7],[3.3,-7.5,1,5.5],[-3.9,8.1,1.1,5.8],[5.8,8,.9,5.1]].map(([x,z,r,h],i)=>[
   i<4?Math.sign(x)*(halfX+.8+Math.abs(x)-8.7):x/9*halfX,
   i<4?z/6.5*halfZ:Math.sign(z)*(halfZ+1+Math.abs(z)-7.5),r,h,
 ])
 const wood: T.BufferGeometry[]=[],leaves: T.BufferGeometry[]=[];let seed=87412;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);const V=(x: number,y: number,z: number)=>new T.Vector3(x,y,z);let leafCount=0;let extraSeed=7123;const extra=()=>((extraSeed=(Math.imul(extraSeed,1664525)+1013904223)>>>0)/4294967296);
 const greens=['#527842','#678b48','#789a50'].map(c=>new T.Color(c));
 function limb(a: T.Vector3,b: T.Vector3,r0: number,r1: number,segments=4,sides=7,phase=0){
  const d=b.clone().sub(a),axis=d.clone().normalize(),u=V(0,1,0).cross(axis);if(u.length()<.1)u.set(1,0,0);u.normalize();const v=axis.clone().cross(u).normalize();
  const p=[],uv=[],idx=[];const length=d.length(),circ=2*Math.PI*r0;
  for(let j=0;j<=segments;j++){const t=j/segments,center=a.clone().lerp(b,t);center.addScaledVector(u,Math.sin(t*Math.PI)*r0*.23);const radius=T.MathUtils.lerp(r0,r1,t);for(let k=0;k<=sides;k++){const ang=k/sides*Math.PI*2,flute=1+.075*Math.cos(ang*5+phase)*(1-t*.6);const q=center.clone().addScaledVector(u,Math.cos(ang)*radius*flute).addScaledVector(v,Math.sin(ang)*radius*flute);p.push(...q.toArray());uv.push(k/sides*circ/2.8,t*length/2.8+phase);if(j<segments&&k<sides){const i=j*(sides+1)+k;idx.push(i,i+1,i+sides+1,i+1,i+sides+2,i+sides+1);}}}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();wood.push(g.toNonIndexed());g.dispose();
 }
 function addLeaf(base: T.Vector3,dir: T.Vector3,len: number,width: number,phase: number,tone: number,crown: T.Vector3){
  const forward=dir.clone().normalize(),side=V(-forward.z,0,forward.x).normalize(),up=side.clone().cross(forward).normalize();if(up.y<0)up.negate();
  // Two bent rib sections; pointed silhouette is opaque geometry, never a transparent card.
  const coords=[[0,0],[.20,-.73],[.20,0],[.20,.73],[.46,-1],[.46,0],[.46,1],[.74,-.82],[.74,0],[.74,.82],[.92,-.36],[.92,0],[.92,.36],[1,0]];
  const p=[],uv=[],anchors=[],phases=[],weights=[],colors=[];
  const c=greens[tone].clone().multiplyScalar(.92+rand()*.12);
  for(const [t,w]of coords){const q=base.clone().addScaledVector(forward,t*len).addScaledVector(side,w*width).addScaledVector(up,Math.sin(t*Math.PI)*len*.12-Math.abs(w)*len*.075+(w===0?.025:0));p.push(...q.toArray());uv.push(w*.5+.5,t);anchors.push(...base.toArray());phases.push(phase);weights.push(t);colors.push(...c.toArray());}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setAttribute('aAnchor',new T.Float32BufferAttribute(anchors,3));g.setAttribute('aPhase',new T.Float32BufferAttribute(phases,1));g.setAttribute('aWeight',new T.Float32BufferAttribute(weights,1));g.setIndex([0,2,1,0,3,2,1,2,4,2,5,4,2,3,5,3,6,5,4,5,7,5,8,7,5,6,8,6,9,8,7,8,10,8,11,10,8,9,11,9,12,11,10,11,13,11,12,13]);g.computeVertexNormals();const ns=g.attributes.normal;
  for(let i=0;i<ns.count;i++){const n=new T.Vector3().fromBufferAttribute(ns,i);if(n.y<0)n.negate();const env=new T.Vector3().fromBufferAttribute(g.attributes.position,i).sub(crown);env.y=2.8;env.normalize();n.lerp(env,.62).normalize();ns.setXYZ(i,n.x,n.y,n.z);}leaves.push(g.toNonIndexed());g.dispose();leafCount++;
 }
 const variants: number[]=[];
 trees.forEach(([x,z,r,h],k)=>{
  const variant=k%3;variants.push(variant);const out=V(x,0,z).normalize(),base=V(x,groundY-.05,z),top=V(x+out.x*.5,h+.55,z+out.z*.5);limb(base,top,r*1.16,r*.20,8,11,k*.17);
  for(let j=0;j<6;j++){const a=j/6*Math.PI*2+k;const end=base.clone().add(V(Math.cos(a)*r*2.0,.08,Math.sin(a)*r*2.0));limb(end,base.clone().add(V(0,1.5,0)),.055,r*.54,2,6,j*.23);}
  for(let j=0;j<5;j++){
   const a=j*2.399+k*.63,reach=(variant===2?2.0:2.6)+rand()*.6;const inward=[0,2,5].includes(k)?0:1.45,cx=x-out.x*inward,cz=z-out.z*inward;const start=base.clone().lerp(top,.48+j*.065),fork=V(cx+Math.cos(a)*reach*.64,h-.8+rand()*.7,cz+Math.sin(a)*reach*.64);limb(start,fork,r*.31,.13,3,6,a);
   for(let s=0;s<3;s++){
    const aa=a+(s-1)*.63,tip=V(cx+Math.cos(aa)*reach,h+.12+(s===1?.4:0)+rand()*.32,cz+Math.sin(aa)*reach);limb(fork,tip,.13,.032,2,5,aa);
    for(let spray=0;spray<4;spray++){
     const t=.22+spray*.23,node=fork.clone().lerp(tip,t),yaw=aa+(spray%2?1:-1)*(.65+rand()*.3),twigEnd=node.clone().add(V(Math.cos(yaw)*(.60+rand()*.30),.12+rand()*.30,Math.sin(yaw)*(.60+rand()*.30)));limb(node,twigEnd,.027,.008,1,4,yaw);
     const phase=k*.71+j*.87+s*.3,tone=(k+j+s)%3;
     for(let l=0;l<5;l++){
      const at=.18+l*.16,attach=node.clone().lerp(twigEnd,at),angle=yaw+(l%2?1:-1)*(.72+rand()*.42),len=.54+rand()*.27;const dir=V(Math.cos(angle),-.13+rand()*.5,Math.sin(angle));addLeaf(attach,dir,len*1.32,len*(.43+rand()*.05),phase,tone,top);
     }
    }
    // A staggered inner tier follows the existing secondary limb, not a hull.
    // Save/restore primary RNG: wood, branch joints and original leaf anchors remain exact.
    const savedSeed=seed;
    for(let l=0;l<10;l++){
      const t=.025+l*.09+(extra()-.5)*.025,attach=fork.clone().lerp(tip,t);
      const angle=aa+(l%2?1:-1)*(.75+extra()*.5),len=.85+extra()*.35;
      addLeaf(attach,V(Math.cos(angle),.12+extra()*.22,Math.sin(angle)),len,len*(.40+extra()*.08),k*.71+j*.87+s*.3,(k+j+s)%3,top);
    }
    seed=savedSeed;
   }
  }
 });
 function merged(parts: T.BufferGeometry[],mat: T.Material,name: string){const geo=mergeGeometries(parts);parts.forEach(g=>g.dispose());geo!.computeBoundingBox();geo!.computeBoundingSphere();const mesh=new T.Mesh(geo!,mat);mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;mesh.raycast=()=>{};mesh.frustumCulled=false;root.add(mesh);return mesh;}
 // Empty Texture objects sample black. Keep each channel detached until decoded.
 const barkMat=new T.MeshToonMaterial({normalScale:new T.Vector2(.42,.42)});attachCombinedCel(barkMat);
 const leafMat=new T.MeshToonMaterial({vertexColors:true,side:T.DoubleSide});attachCombinedCel(leafMat);
 for (const [url,target,material,slot] of [[barkUrl,bark,barkMat,'map'],[normalUrl,normal,barkMat,'normalMap'],[leafUrl,leafMap,leafMat,'map']] as const) {
   void loader.loadAsync(url).then(texture => textureOwner.accept(texture, loaded => {
     target.image=loaded.image;target.needsUpdate=true;material[slot]=target;material.needsUpdate=true
   })).catch(()=>{ /* Retain the lit, untextured material when decoration fails. */ })
 }
 const reduced={value:0};
 const decl=`uniform float treeTime;uniform float treeReduced;attribute vec3 aAnchor;attribute float aPhase;attribute float aWeight;
 float treeBend(){return (1.-treeReduced)*(sin(treeTime*1.6+aPhase)*.105+sin(treeTime*.61)*.045+sin(treeTime*3.1+aPhase*2.)*.012);}`;
 function wind(mat: T.Material){const prior=mat.onBeforeCompile,key=mat.customProgramCacheKey();mat.onBeforeCompile=(s,r)=>{prior.call(mat,s,r);s.uniforms.treeTime=time;s.uniforms.treeReduced=reduced;s.vertexShader=decl+'\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nobjectNormal=normalize(objectNormal+vec3(-.891,0.,-.454)*treeBend()*aWeight*.30);');s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nfloat treeOffset=treeBend()*aWeight*aWeight;transformed.xz+=vec2(.891,.454)*treeOffset;transformed.y+=treeOffset*.19;');};mat.customProgramCacheKey=()=>key+'-anchored-tree-wind-v1';}
 wind(leafMat);const depth=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,side:T.DoubleSide});wind(depth);const distance=new T.MeshDistanceMaterial({side:T.DoubleSide});wind(distance);
 const woodMesh=merged(wood,barkMat,'woodland-mature-trunks');const leafMesh=merged(leaves,leafMat,'woodland-canopy');leafMesh.customDepthMaterial=depth;leafMesh.customDistanceMaterial=distance;
 let disposed=false
 return {root,woodMesh,leafMesh,leafCount,variants,dispose(){
   if(disposed)return;disposed=true;textureOwner.dispose()
   for(const texture of [bark,normal,leafMap])texture.dispose()
   for(const mesh of [woodMesh,leafMesh]){mesh.geometry.dispose();(mesh.material as T.Material).dispose()}
   depth.dispose();distance.dispose();root.removeFromParent();root.clear()
 }}
}
