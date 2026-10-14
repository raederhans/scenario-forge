import {createLabelLayout} from './labels.js';
const vertex = `#version 300 es
in vec2 position;
void main(){gl_Position=vec4(position,0.,1.);}`;
const fragment = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D ids;
uniform usampler2D states;
uniform sampler2D colors;
uniform sampler2D selected;
uniform vec2 size;
uniform vec2 viewport;
uniform vec2 center;
uniform float scale;
uniform bool borders;
uniform float borderWidth;
uniform float borderOpacity;
uniform vec3 borderColor;
uniform float pixelRatio;
out vec4 result;
ivec2 table(uint code){return ivec2(int(code)%256,int(code)/256);}
uvec2 identityAt(ivec2 p){if(any(lessThan(p,ivec2(0)))||any(greaterThanEqual(p,ivec2(size))))return uvec2(0);return texelFetch(states,table(texelFetch(ids,p,0).r),0).rg;}
bool selectedAt(ivec2 p){if(any(lessThan(p,ivec2(0)))||any(greaterThanEqual(p,ivec2(size))))return false;return texelFetch(selected,table(texelFetch(ids,p,0).r),0).r>.5;}
void main(){
 vec2 screen=vec2(gl_FragCoord.x,viewport.y-gl_FragCoord.y);
 vec2 source=(screen-viewport*.5)/scale+center;
 ivec2 p=ivec2(floor(source));
 if(any(lessThan(p,ivec2(0)))||any(greaterThanEqual(p,ivec2(size)))){result=vec4(.075,.09,.11,1.);return;}
 uint code=texelFetch(ids,p,0).r;
 if(code==uint(0)){result=vec4(.12,.15,.18,1.);return;}
 result=texelFetch(colors,table(code),0);
 uvec2 current=identityAt(p);
 bool isSelected=texelFetch(selected,table(code),0).r>.5;
 vec2 f=fract(source);
 float coverage=0.,selectionCoverage=0.;
 // Four native neighbours locate actual state edges. Distances are in CSS
 // pixels, so zoom never turns an entire source pixel into a thick border.
 for(int i=0;i<4;i++){
  ivec2 direction=i==0?ivec2(-1,0):i==1?ivec2(1,0):i==2?ivec2(0,-1):ivec2(0,1);
  float distance=(i==0?f.x:i==1?1.-f.x:i==2?f.y:1.-f.y)*scale/pixelRatio;
  uvec2 neighbour=identityAt(p+direction);
  if(neighbour.r!=current.r){
   // Country emphasis follows original entityTag, never painted colour/cores.
   float width=min(2.,borderWidth*(neighbour.g!=current.g?1.25:1.));
   if(width>0.)coverage=max(coverage,clamp((width*.5+.5/pixelRatio-distance)*pixelRatio,0.,1.));
   if(!isSelected&&selectedAt(p+direction))selectionCoverage=max(selectionCoverage,clamp((1.25+.5/pixelRatio-distance)*pixelRatio,0.,1.));
  }
 }
 // Even a one-pixel selected state keeps its authoritative interior colour.
 if(borders&&!isSelected)result.rgb=mix(result.rgb,borderColor,coverage*borderOpacity);
 if(selectionCoverage>0.)result.rgb=mix(result.rgb,vec3(1.,.85,.35),selectionCoverage*.95);
}`;
const markerVertex=`#version 300 es
in vec2 anchor;
uniform vec2 viewport;
uniform vec2 center;
uniform float scale;
uniform float pixelRatio;
void main(){vec2 screen=(anchor-center)*scale+viewport*.5;gl_Position=vec4(screen.x/viewport.x*2.-1.,1.-screen.y/viewport.y*2.,0.,1.);gl_PointSize=8.*pixelRatio;}`;
const markerFragment=`#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D ids;
uniform sampler2D selected;
uniform vec2 size;
uniform vec2 viewport;
uniform vec2 center;
uniform float scale;
uniform float pixelRatio;
out vec4 result;
void main(){
 vec2 screen=vec2(gl_FragCoord.x,viewport.y-gl_FragCoord.y);
 ivec2 p=ivec2(floor((screen-viewport*.5)/scale+center));
 if(all(greaterThanEqual(p,ivec2(0)))&&all(lessThan(p,ivec2(size)))){
  uint code=texelFetch(ids,p,0).r;
  if(texelFetch(selected,ivec2(int(code)%256,int(code)/256),0).r>.5)discard;
 }
 // A small-state anchor ring is a selection locator, not geographic detail.
 float distance=abs(length(gl_PointCoord-vec2(.5))*8.-3.);
 float coverage=clamp((.625+.5/pixelRatio-distance)*pixelRatio,0.,1.);
 if(coverage<=0.)discard;
 result=vec4(1.,.85,.35,coverage*.95);
}`;
export function createRenderer(canvas, dataset) {
  const gl = canvas.getContext('webgl2', {alpha:false,antialias:false,preserveDrawingBuffer:false});
  if (!gl) throw new Error('This editor requires WebGL 2');
  const {width,height} = dataset.manifest.coordinateSpace;
  if (Math.max(width,height,256) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error('Native map exceeds this GPU texture limit');
  const shaders = [], textures = [];
  let program, buffer, vao, markerProgram, markerBuffer, markerVao, disposed=false;
  function shader(type, source) { const s = gl.createShader(type); shaders.push(s); gl.shaderSource(s,source); gl.compileShader(s); if (!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function texture(unit, internal, w,h,format,type,data) { const t = gl.createTexture(); textures.push(t); gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,t); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE); gl.pixelStorei(gl.UNPACK_ALIGNMENT,1); gl.texImage2D(gl.TEXTURE_2D,0,internal,w,h,0,format,type,data); return t; }
  function dispose({contextLost=false}={}) {
    if(disposed)return;
    disposed=true;
    // A lost context already invalidated these handles. Never pass them to a
    // restored context, where deletion would poison its new GL error state.
    if(!contextLost){for(const t of textures)gl.deleteTexture(t);for(const s of shaders)gl.deleteShader(s);for(const b of [buffer,markerBuffer])if(b)gl.deleteBuffer(b);for(const v of [vao,markerVao])if(v)gl.deleteVertexArray(v);for(const p of [program,markerProgram])if(p)gl.deleteProgram(p);}
    textures.length=0;shaders.length=0;program=null;buffer=null;vao=null;markerProgram=null;markerBuffer=null;markerVao=null;
  }
  try {
    program=gl.createProgram(); gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex)); gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment)); gl.linkProgram(program); if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)); gl.useProgram(program);
    vao=gl.createVertexArray();gl.bindVertexArray(vao);buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW); const pos=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
    const rows=Math.ceil(dataset.core.provinceIds.length/256), stateCodes=new Uint16Array(256*rows*2);
    const stateIndex=new Map(dataset.core.states.map((s,i)=>[String(s.id),i+1]));
    const stateById=dataset.stateById||new Map(dataset.core.states.map(s=>[String(s.id),s]));
    const ownerIndex=new Map([...new Set(dataset.core.states.map(s=>s.entityTag||''))].map((tag,i)=>[tag,i+1]));
    if(stateIndex.size>65535)throw new Error('Too many states for native state table');
    for(let i=1;i<dataset.core.provinceIds.length;i++){const id=String(dataset.core.provinceStateIds[i]);stateCodes[i*2]=stateIndex.get(id)||0;stateCodes[i*2+1]=ownerIndex.get(stateById.get(id)?.entityTag||'')||0;}
    texture(0,gl.R16UI,width,height,gl.RED_INTEGER,gl.UNSIGNED_SHORT,dataset.ids);
    texture(1,gl.RG16UI,256,rows,gl.RG_INTEGER,gl.UNSIGNED_SHORT,stateCodes);
    texture(2,gl.RGBA8,256,rows,gl.RGBA,gl.UNSIGNED_BYTE,null);
    texture(3,gl.R8,256,rows,gl.RED,gl.UNSIGNED_BYTE,null);
    for(const [i,name] of ['ids','states','colors','selected'].entries())gl.uniform1i(gl.getUniformLocation(program,name),i);
    const palette=new Uint8Array(rows*256*4), selection=new Uint8Array(rows*256);
    let selectedStates=[];
    const uniforms=Object.fromEntries(['size','viewport','center','scale','borders','borderWidth','borderOpacity','borderColor','pixelRatio'].map(k=>[k,gl.getUniformLocation(program,k)]));
    markerProgram=gl.createProgram();gl.attachShader(markerProgram,shader(gl.VERTEX_SHADER,markerVertex));gl.attachShader(markerProgram,shader(gl.FRAGMENT_SHADER,markerFragment));gl.linkProgram(markerProgram);if(!gl.getProgramParameter(markerProgram,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(markerProgram));
    markerVao=gl.createVertexArray();gl.bindVertexArray(markerVao);markerBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,markerBuffer);const anchor=gl.getAttribLocation(markerProgram,'anchor');gl.enableVertexAttribArray(anchor);gl.vertexAttribPointer(anchor,2,gl.FLOAT,false,0,0);
    gl.useProgram(markerProgram);gl.uniform1i(gl.getUniformLocation(markerProgram,'ids'),0);gl.uniform1i(gl.getUniformLocation(markerProgram,'selected'),3);
    const markerUniforms=Object.fromEntries(['size','viewport','center','scale','pixelRatio'].map(k=>[k,gl.getUniformLocation(markerProgram,k)]));
    const markerPoints=new Float32Array(64*2);
    const bounded=(value,fallback,max)=>Number.isFinite(value)?Math.max(0,Math.min(max,value)):fallback;
    if(gl.getError()!==gl.NO_ERROR)throw new Error('GPU rejected native integer map textures');
    return {
      gl,
      update(document, selected) { selectedStates=[...selected].map(id=>stateById.get(String(id))).filter(s=>Array.isArray(s?.anchor)&&s.anchor.length===2&&s.anchor.every(Number.isFinite)&&Number.isFinite(s.pixelCount)&&s.pixelCount>0);for(let i=1;i<dataset.core.provinceIds.length;i++){if(dataset.core.provinceStateIds[i]===null)continue;const id=String(dataset.core.provinceStateIds[i]),c=document.color(id);palette[i*4]=parseInt(c.slice(1,3),16);palette[i*4+1]=parseInt(c.slice(3,5),16);palette[i*4+2]=parseInt(c.slice(5,7),16);palette[i*4+3]=255;selection[i]=selected.has(id)?255:0;} gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,textures[2]);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,256,rows,gl.RGBA,gl.UNSIGNED_BYTE,palette);gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,textures[3]);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,256,rows,gl.RED,gl.UNSIGNED_BYTE,selection); },
      draw(view,layers,pixelRatio=1) {
        gl.disable(gl.BLEND);gl.useProgram(program);gl.bindVertexArray(vao);gl.viewport(0,0,canvas.width,canvas.height);
        gl.uniform2f(uniforms.size,width,height);gl.uniform2f(uniforms.viewport,canvas.width,canvas.height);gl.uniform2f(uniforms.center,view.x,view.y);gl.uniform1f(uniforms.scale,view.scale*pixelRatio);gl.uniform1f(uniforms.pixelRatio,pixelRatio);gl.uniform1i(uniforms.borders,layers.borders?1:0);
        gl.uniform1f(uniforms.borderWidth,bounded(layers.borderWidth,.7,2));gl.uniform1f(uniforms.borderOpacity,bounded(layers.borderOpacity,.45,1));
        const color=/^#[0-9a-f]{6}$/i.test(layers.borderColor||'')?layers.borderColor:'#1f2933';gl.uniform3f(uniforms.borderColor,...[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255));gl.drawArrays(gl.TRIANGLES,0,6);
        // At most 64 tiny visible states receive a locator ring. Only selected
        // metadata is visited; no raster scan or per-fragment anchor loop.
        let count=0;for(const s of selectedStates){if(count===64)break;if(s.pixelCount*view.scale*view.scale>=36)continue;const x=(s.anchor[0]-view.x)*view.scale+canvas.width/pixelRatio/2,y=(s.anchor[1]-view.y)*view.scale+canvas.height/pixelRatio/2;if(x< -4||y< -4||x>canvas.width/pixelRatio+4||y>canvas.height/pixelRatio+4)continue;markerPoints[count*2]=s.anchor[0];markerPoints[count*2+1]=s.anchor[1];count++;}
        if(count){gl.useProgram(markerProgram);gl.bindVertexArray(markerVao);gl.bindBuffer(gl.ARRAY_BUFFER,markerBuffer);gl.bufferData(gl.ARRAY_BUFFER,markerPoints.subarray(0,count*2),gl.DYNAMIC_DRAW);gl.uniform2f(markerUniforms.size,width,height);gl.uniform2f(markerUniforms.viewport,canvas.width,canvas.height);gl.uniform2f(markerUniforms.center,view.x,view.y);gl.uniform1f(markerUniforms.scale,view.scale*pixelRatio);gl.uniform1f(markerUniforms.pixelRatio,pixelRatio);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.drawArrays(gl.POINTS,0,count);gl.disable(gl.BLEND);}
      },
      dispose
    };
  } catch(error) { dispose();throw error; }
}

// Retain at most the layout for a live overlay canvas. Export canvases and their
// spatial index become collectible when the one-shot export finishes.
const overlayLayouts = new WeakMap();
export function drawOverlay(canvas,dataset,document,view,layers,pixelRatio=1,options={}) {
  let owner=overlayLayouts.get(canvas);
  if(!owner||owner.dataset!==dataset){owner={dataset,layout:createLabelLayout(dataset)};overlayLayouts.set(canvas,owner);}
  return owner.layout.draw(canvas,document,view,layers,pixelRatio,options);
}
