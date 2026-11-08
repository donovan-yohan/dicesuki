import * as THREE from 'three'
const gradeGLSL=`
vec3 repairRgbHsv(vec3 c){vec4 K=vec4(0.,-1./3.,2./3.,-1.);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y);return vec3(abs(q.z+(q.w-q.y)/(6.*d+1.e-10)),d/(q.x+1.e-10),q.x);}
vec3 repairHsvRgb(vec3 c){vec3 p=abs(fract(c.xxx+vec3(0.,2./3.,1./3.))*6.-3.);return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y);}
vec3 repairAlbedo(vec3 linearColor,float environment){
 vec3 perceptual=pow(clamp(linearColor,0.,1.),vec3(1./2.2));vec3 h=repairRgbHsv(perceptual);
 float green=smoothstep(.17,.23,h.x)*(1.-smoothstep(.43,.49,h.x))*smoothstep(.08,.22,h.y);
 float readable=smoothstep(.09,.24,h.z);
 // Lift bark midtones only; black engraved glyphs do not acquire a white pedestal.
 h.z=mix(h.z,pow(h.z,.60),readable*(1.-environment*.75));
 h.y=clamp(h.y*1.06,0.,.84);
 // Restore chlorophyll, retaining pale/dark ordering instead of beige desaturation.
 h.x=mix(h.x,mix(.235,.315,clamp((h.x-.18)/.24,0.,1.)),green*environment*.65);
 h.y=mix(h.y,clamp(.40+h.y*.48,.44,.74),green*mix(.25,1.,environment));
 h.z=mix(h.z,.19+h.z*.66,green*environment);
 return pow(repairHsvRgb(h),vec3(2.2));
}
`;
const graded=new WeakSet<THREE.Material>();
export function repairWoodlandPalette(root: THREE.Group,environment=1){root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;for(const mat of Array.isArray(o.material)?o.material:[o.material]){if(!(mat instanceof THREE.MeshToonMaterial)||graded.has(mat))continue;graded.add(mat);const prior=mat.onBeforeCompile,key=mat.customProgramCacheKey();mat.onBeforeCompile=(s,r)=>{prior.call(mat,s,r);s.fragmentShader=gradeGLSL+s.fragmentShader;
 s.fragmentShader=s.fragmentShader.replace('vec3(0.56, 0.65, 0.61)','vec3(0.22, 0.32, 0.29)').replace('vec3(0.70, 0.77, 0.70)','vec3(0.44, 0.57, 0.45)').replace('vec3(0.88, 0.90, 0.80)','vec3(0.73, 0.83, 0.64)').replace('vec3(1.0, 0.98, 0.90)','vec3(1.0, 0.97, 0.84)');
 s.fragmentShader=s.fragmentShader.replace('diffuseColor.rgb * woodlandCelBands(woodlandCelIllumination)',`repairAlbedo(diffuseColor.rgb, ${environment.toFixed(1)}) * woodlandCelBands(woodlandCelIllumination)`);
};mat.customProgramCacheKey=()=>key+'-palette-repair-'+environment;mat.needsUpdate=true;}});}
