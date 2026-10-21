import {metricEntries,metricColor,metricDisplayKind,infrastructureColor} from '../data/metrics.js';
export {metricColor} from '../data/metrics.js';
import {solarState} from './solar.js';
import {visualizationAssetKey} from '../data/overlays.js';

// These textures decorate the political raster. None participate in picking,
// painting, ownership, or the authoritative province/state identity table.
export const visualizationShader = `
uniform sampler2D terrainMap;
uniform sampler2D terrainPalette;
uniform sampler2D riverMap;
uniform sampler2D nightMap;
uniform sampler2D illuminationMap;
uniform sampler2D metricMap;
uniform sampler2D nativeLandMap;
uniform bool terrainEnabled;
uniform bool riversEnabled;
uniform bool lightsEnabled;
uniform bool solarEnabled;
uniform bool metricEnabled;
uniform bool metricLevels;
uniform float terrainOpacity;
uniform float riverOpacity;
uniform float riverWidth;
uniform float lightOpacity;
uniform float nightOpacity;
uniform float twilightWidth;
uniform float metricOpacity;
uniform float textureOpacity;
uniform vec3 sunDirection;
float riverDistance(vec2 uv){
 ivec2 dimensions=textureSize(riverMap,0);
 vec2 position=uv*vec2(dimensions)-.5;
 ivec2 cell=ivec2(floor(position));
 vec2 f=fract(position);
 vec4 samples=vec4(
  texelFetch(riverMap,clamp(cell,ivec2(0),dimensions-1),0).r,
  texelFetch(riverMap,clamp(cell+ivec2(1,0),ivec2(0),dimensions-1),0).r,
  texelFetch(riverMap,clamp(cell+ivec2(0,1),ivec2(0),dimensions-1),0).r,
  texelFetch(riverMap,clamp(cell+ivec2(1,1),ivec2(0),dimensions-1),0).r);
 vec4 d=(samples*255.-128.)/16.;
 float distance=mix(mix(d.x,d.y,f.x),mix(d.z,d.w,f.x),f.y);
 // A one-texel diagonal only touches at a corner in the source mask.
 // Pure bilinear SDF erosion would sever it. Reconstruct that local
 // center-to-center segment; no global river geometry is needed at runtime.
 if(d.x>0.&&d.w>0.){
  float t=clamp((f.x+f.y)*.5,0.,1.);
  distance=max(distance,.5-length(f-vec2(t)));
 }
 if(d.y>0.&&d.z>0.){
  float t=clamp((1.-f.x+f.y)*.5,0.,1.);
  distance=max(distance,.5-length(f-vec2(1.-t,t)));
 }
 return distance;
}
vec3 visualize(vec3 base,vec2 source,uint code){
 vec2 uv=source/size;
 bool land=true;
 if(terrainEnabled||riversEnabled||metricLevels)land=texelFetch(nativeLandMap,table(code),0).r>.5;
 // Quantitative level colors take precedence over decorative land layers.
 // Missing land records retain the neutral base, distinct from known zero.
 if(metricLevels&&land){vec4 level=texelFetch(metricMap,table(code),0);return level.a>.5?level.rgb:base;}
 if(terrainEnabled&&land){
  int category=int(texture(terrainMap,uv).r*255.+.5);
  vec4 tint=texelFetch(terrainPalette,ivec2(category,0),0);
  base=mix(base,tint.rgb,tint.a*terrainOpacity);
 }
 vec4 metricTint=vec4(0.);
 if(metricEnabled){metricTint=texelFetch(metricMap,table(code),0);if(!metricLevels)base=mix(base,metricTint.rgb,metricTint.a*metricOpacity);}
 if(riversEnabled&&land){
  // Offline signed distance in river-texture texels, positive inside.
  // Width is a relative map-space adjustment, not a CSS-pixel promise:
  // 1 preserves the source boundary; .5 contracts each side by .25 texel;
  // 3 expands each side by 1 texel. Even one-texel branches can get thinner.
  float distance=riverDistance(uv);
  float threshold=(1.-riverWidth)*.5;
  // scale already includes DPR. Analytic footprint avoids derivatives inside
  // the non-uniform native-land branch. Cap the filter at one texture texel:
  // it must not turn a subpixel river into a broad low-zoom halo.
  float feather=max(1./32.,min(.5,float(textureSize(riverMap,0).x)/size.x/scale*.5));
  float river=smoothstep(threshold-feather,threshold+feather,distance);
  base=mix(base,vec3(.26,.57,.69),river*riverOpacity);
 }
 if(textureOpacity>0.){
  float grain=fract(sin(dot(floor(source),vec2(12.9898,78.233)))*43758.5453)-.5;
  base=clamp(base+grain*.075*textureOpacity,0.,1.);
 }
 float night=1.;
 if(solarEnabled){
  vec4 geography=texture(illuminationMap,uv);
  // RGB is premultiplied by an offline visual edge weight. Recover only the
  // supported normal after one hardware-filtered sample; invalid RGBA is zero.
  vec3 normal=geography.rgb/max(geography.a,1./255.)*2.-1.;
  float coverage=smoothstep(0.,sin(radians(twilightWidth)),-dot(normalize(normal+vec3(1e-8)),sunDirection));
  night=coverage*geography.a;
  base=mix(base,base*vec3(.22,.29,.43),night*nightOpacity);
 }
 if(lightsEnabled){
  float radiance=texture(nightMap,uv).r;
  float glow=pow(radiance,.7)*lightOpacity*night;
  base=1.-(1.-base)*(1.-vec3(1.,.75,.35)*glow);
 }
 return base;
}`;

export function createVisualizationGpu(gl,program,dataset) {
  const definitions=[
    ['terrain',4,'terrainMap',1,false],['terrainPalette',5,'terrainPalette',4,false],
    ['rivers',6,'riverMap',1,true],['nightLights',7,'nightMap',1,true],
    // Premultiplied encoded normals keep invalid cells out of interpolation.
    ['illumination',8,'illuminationMap',4,true],['metric',9,'metricMap',4,false],
    ['nativeLand',10,'nativeLandMap',1,false]
  ];
  const slots=new Map(),uniforms={};
  let lastMetric=null,lastMetricId=null,disposed=false;
  const names=['terrainEnabled','riversEnabled','lightsEnabled','solarEnabled','metricEnabled','metricLevels',
    'terrainOpacity','riverOpacity','riverWidth','lightOpacity','nightOpacity','twilightWidth',
    'metricOpacity','textureOpacity','sunDirection'];
  for(const name of names)uniforms[name]=gl.getUniformLocation(program,name);
  for(const [key,unit,sampler,channels,linear] of definitions){
    const texture=gl.createTexture();
    slots.set(key,{texture,unit,channels,linear,resource:null});
    gl.uniform1i(gl.getUniformLocation(program,sampler),unit);
    upload(key,null);
  }
  // Downsampled cells may straddle a coast. Clip geography with the exact
  // original province identity instead of letting interpolation paint water.
  const nativeStates=new Map(dataset.core.states.map(s=>[String(s.id),s]));
  const land=new Uint8Array(256*Math.ceil(dataset.core.provinceIds.length/256));
  for(let i=1;i<dataset.core.provinceIds.length;i++){
    const state=nativeStates.get(String(dataset.core.provinceStateIds[i]));
    if(state&&state.entityTag!=='WTR')land[i]=255;
  }
  upload('nativeLand',{width:256,height:land.length/256,data:land});
  function upload(key,resource) {
    const slot=slots.get(key);
    gl.activeTexture(gl.TEXTURE0+slot.unit);gl.bindTexture(gl.TEXTURE_2D,slot.texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,slot.linear?gl.LINEAR:gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,slot.linear?gl.LINEAR:gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.texImage2D(gl.TEXTURE_2D,0,slot.channels===4?gl.RGBA8:gl.R8,
      resource?.width||1,resource?.height||1,0,slot.channels===4?gl.RGBA:gl.RED,
      gl.UNSIGNED_BYTE,resource?.data||new Uint8Array(slot.channels));
    slot.resource=resource;
  }
  function sync(resources,layers) {
    for(const key of ['terrain','rivers','nightLights','illumination']){
      const enabled=key==='illumination'?layers.dayNight:layers[key];
      const resource=enabled?resources?.get(visualizationAssetKey(key,layers)):null;
      if(slots.get(key).resource!==(resource||null))upload(key,resource);
    }
    const palette=layers.terrain?resources?.get('terrainPalette'):null;
    if(slots.get('terrainPalette').source!==palette||slots.get('terrainPalette').mode!==layers.terrainMode){
      slots.get('terrainPalette').source=palette;
      slots.get('terrainPalette').mode=layers.terrainMode;
      const colors=new Uint8Array(256*4);
      for(const entry of palette?.data?.palette||palette?.data||[]){
        const id=Number(entry.code??entry.id);
        const color=layers.terrainMode==='native'?entry.baseColor:layers.terrainMode==='geomorphology'?entry.modernColor:entry.color;
        if(!Number.isInteger(id)||id<1||id>255||!/^#[a-f0-9]{6}$/i.test(color||''))continue;
        colors.set([...[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)),255],id*4);
      }
      upload('terrainPalette',palette?{width:256,height:1,data:colors}:null);
    }
    const kind=metricDisplayKind(layers.metric),metricId=['fill','levels'].includes(kind)?layers.metric:null;
    const metrics=metricId?resources?.get('metrics'):null;
    if(lastMetric!==metrics||lastMetricId!==metricId){
      lastMetric=metrics;lastMetricId=metricId;
      if(!metrics){upload('metric',null);return;}
      const rows=Math.ceil(dataset.core.provinceIds.length/256),data=new Uint8Array(256*rows*4);
      const entries=new Map(metricEntries(metrics.data,layers.metric).map(e=>[String(e.stateId),e]));
      for(let i=1;i<dataset.core.provinceIds.length;i++){
        const entry=entries.get(String(dataset.core.provinceStateIds[i]));
        data.set(kind==='levels'?infrastructureColor(entry?.value??null):metricColor(entry?.normalized??null),i*4);
      }
      upload('metric',{width:256,height:rows,data});
    }
  }
  return {
    sync,
    draw(layers,solar=solarState(layers)){
      const bools={terrainEnabled:layers.terrain&&slots.get('terrain').resource&&slots.get('terrainPalette').resource,
        riversEnabled:layers.rivers&&slots.get('rivers').resource,lightsEnabled:layers.nightLights&&slots.get('nightLights').resource,
        solarEnabled:layers.dayNight&&slots.get('illumination').resource,
        metricEnabled:['fill','levels'].includes(metricDisplayKind(layers.metric))&&slots.get('metric').resource,
        metricLevels:metricDisplayKind(layers.metric)==='levels'&&slots.get('metric').resource};
      for(const [name,value]of Object.entries(bools))gl.uniform1i(uniforms[name],value?1:0);
      for(const [name,key,fallback]of [
        ['terrainOpacity','terrainOpacity',.35],['riverOpacity','riverOpacity',.8],['riverWidth','riverWidth',1],
        ['lightOpacity','nightLightOpacity',.85],['nightOpacity','nightOpacity',.72],['twilightWidth','twilightWidth',10],
        ['metricOpacity','metricOpacity',.65],['textureOpacity','textureOpacity',0]
      ])gl.uniform1f(uniforms[name],Number.isFinite(layers[key])?layers[key]:fallback);
      gl.uniform3f(uniforms.sunDirection,...solar.direction);
    },
    dispose({contextLost=false}={}){
      if(disposed)return;disposed=true;
      if(!contextLost)for(const slot of slots.values())gl.deleteTexture(slot.texture);
      slots.clear();lastMetric=null;lastMetricId=null;
    }
  };
}
