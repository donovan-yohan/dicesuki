/**
 * New LAST BOWL procedural texture artwork: CC0-1.0.
 * Retained implementation code remains under its existing terms.
 */
/** Pure study data. No repository settings or physics access. */
export const quality = (tier: 'low' | 'high') => {
  if (!['low','high'].includes(tier)) throw new Error('tier must be low or high');
  return tier === 'low' ? { reflectionSize:256, reflectionHz:12, steam:8, textureSize:256 } : { reflectionSize:512, reflectionHz:20, steam:18, textureSize:512 };
};
export const clampDelta = (dt: number) => Number.isFinite(dt) ? Math.max(0,Math.min(.05,dt)) : 0;
export function random(seed: number) { let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;}; }
export function puddleOutline(seed: number,rx: number,ry: number,n=36) {
  const rand=random(seed), phase=rand()*6.28;
  return Array.from({length:n},(_,i)=>{const a=i/n*Math.PI*2;const r=.87+.10*Math.sin(a*3+phase)+.06*Math.cos(a*7+phase);return [Math.cos(a)*rx*r,Math.sin(a)*ry*r];});
}
export const surfaceKinds = ['paving', 'wall', 'enamel', 'metal', 'rubber'] as const;
export type SurfaceKind = typeof surfaceKinds[number];
export type SurfacePixels = { albedo: Uint8Array<ArrayBuffer>; normal: Uint8Array<ArrayBuffer> };
export type SurfaceSet = Record<SurfaceKind, SurfacePixels>;
export type SurfaceSize = 256 | 512;
// Only the ten shipping kind/tier pairs are retained (12.5 MiB maximum).
// Private cached bytes never back a caller's mutable DataTexture or disposal owner.
const surfaceCache=new Map<string,{albedo: Uint8Array; normal: Uint8Array}>();
export function surfacePixels(size: number,kind: 'wall' | 'paving' | 'enamel' | 'metal' | 'rubber') {
  const cacheable=(size===256||size===512)&&['wall','paving','enamel','metal','rubber'].includes(kind),key=`${size}:${kind}`;
  const cached=cacheable?surfaceCache.get(key):undefined;
  if(cached)return {albedo:cached.albedo.slice(),normal:cached.normal.slice()};
  const rand=random(kind.length*711+901),height=new Float32Array(size*size),albedo=new Uint8Array(size*size*4),normal=new Uint8Array(size*size*4);
  const chips=Array.from({length:kind==='paving'?95:65},()=>({x:rand(),y:rand(),r:.002+rand()*.025,l:.008+rand()*.13}));
  // Rasterize only each inclusion's finite footprint, in original first-match
  // order. All inclusions have the same material effect, so one occupancy byte
  // suffices. Do not spend RNG here: the pixel loop must retain its exact stream.
  const inclusion=new Uint8Array(size*size);
  if(kind==='paving'||kind==='wall')for(const c of chips){
    const minX=Math.max(0,Math.floor((c.x-c.r)*size)),maxX=Math.min(size-1,Math.ceil((c.x+c.r)*size));
    const minY=Math.max(0,Math.floor((c.y-c.r*.36)*size)),maxY=Math.min(size-1,Math.ceil((c.y+c.r*.36)*size));
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
      const i=y*size+x;if(inclusion[i])continue;
      const dx=x/size-c.x,dy=y/size-c.y;
      if(Math.abs(dx)<c.r && Math.abs(dy)<c.r*.36 && Math.abs(dx)+Math.abs(dy)*1.7<c.r)inclusion[i]=1;
    }
  }
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=y*size+x,u=x/size,v=y/size,n=rand();
    const field=Math.sin(u*19+Math.sin(v*8)*2)+Math.cos(v*27-u*5)+.5*Math.sin(u*53+v*39);
    let r=0,g=0,b=0,h=.5;
    if(kind==='paving'){
      // Dry fine aggregate, wide troweled repairs, oil tracking along lane direction.
      let base=57+field*3+(n-.5)*5;
      const tire=Math.pow(Math.max(0,Math.cos(u*22+Math.sin(v*5)*.16)),20);
      base-=tire*7;
      const seam=Math.abs(Math.sin(u*8+v*2+Math.sin(v*18)*.2));
      if(seam<.012 && (u<.18||u>.83)){base-=19;h=.22;}
      else h=.48+(n-.5)*.015;
      r=base*.91;g=base*.99;b=base*1.04;
    }else if(kind==='wall'){
      // Uneven concrete lift line, cold spall and long gravity-fed leach marks.
      const drip=Math.pow(Math.max(0,Math.sin(u*83+Math.sin(u*19))),14)*(.4+.6*v);
      const joint=Math.abs(v-.58-Math.sin(u*18)*.002)<.004;
      const base=71+field*5+(n-.5)*7-drip*26-(joint?24:0);
      r=base*1.03;g=base;b=base*.89;h=joint?.15:.5+field*.01;
    }else if(kind==='metal'){
      const rust=Math.sin(u*21+Math.sin(v*13)*2)+Math.sin(v*8+u*9)>.65;
      const scratch=Math.sin(v*610+u*7)>.97;
      r=rust?91:72;g=rust?53:84;b=rust?33:85;
      r+=field*5+(scratch?23:0);g+=field*4+(scratch?20:0);b+=field*3+(scratch?16:0);h=rust?.42:.51;
    }else if(kind==='enamel'){
      const edge=Math.min(u,1-u,v,1-v);
      const chip=edge<.015+Math.max(0,Math.sin(u*193+v*171))*.018;
      const base=chip?37:112+field*3+(n-.5)*4;
      r=base;g=base*.96;b=base*.87;h=chip?.25:.52;
    }else{
      const rib=Math.sin(u*210)>0;
      r=rib?58:30;g=rib?62:34;b=rib?61:35;h=rib?.65:.25;
    }
    // Finite hand-shaped inclusions, not uniform overlaid grunge.
    if(inclusion[i]){
      const k=kind==='paving'?1.22:.71;r*=k;g*=k;b*=k;h+=.04;
    }
    height[i]=h;albedo.set([r,g,b,255],i*4);
  }
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const at=(a: number,b: number)=>height[((b+size)%size)*size+(a+size)%size];
    const dx=(at(x-1,y)-at(x+1,y))*.7,dy=(at(x,y-1)-at(x,y+1))*.7,l=Math.hypot(dx,dy,1);
    normal.set([(dx/l*.5+.5)*255,(dy/l*.5+.5)*255,(1/l*.5+.5)*255,255],(y*size+x)*4);
  }
  if(cacheable){surfaceCache.set(key,{albedo,normal});return {albedo:albedo.slice(),normal:normal.slice()};}
  return {albedo,normal};
}
