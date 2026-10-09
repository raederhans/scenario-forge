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
out vec4 result;
ivec2 table(uint code){return ivec2(int(code)%256,int(code)/256);}
uint stateAt(ivec2 p){if(any(lessThan(p,ivec2(0)))||any(greaterThanEqual(p,ivec2(size))))return uint(0);return texelFetch(states,table(texelFetch(ids,p,0).r),0).r;}
void main(){
 vec2 screen=vec2(gl_FragCoord.x,viewport.y-gl_FragCoord.y);
 ivec2 p=ivec2(floor((screen-viewport*.5)/scale+center));
 if(any(lessThan(p,ivec2(0)))||any(greaterThanEqual(p,ivec2(size)))){result=vec4(.075,.09,.11,1.);return;}
 uint code=texelFetch(ids,p,0).r;
 if(code==uint(0)){result=vec4(.12,.15,.18,1.);return;}
 result=texelFetch(colors,table(code),0);
 uint s=stateAt(p);
 bool edge=stateAt(p+ivec2(1,0))!=s||stateAt(p+ivec2(0,1))!=s;
 if(borders&&edge)result.rgb=mix(result.rgb,vec3(.12,.14,.17),.6);
 if(texelFetch(selected,table(code),0).r>.5){result.rgb=mix(result.rgb,vec3(1.,.85,.35),edge?.95:.22);}
}`;
export function createRenderer(canvas, dataset) {
  const gl = canvas.getContext('webgl2', {alpha:false,antialias:false,preserveDrawingBuffer:false});
  if (!gl) throw new Error('This editor requires WebGL 2');
  const {width,height} = dataset.manifest.coordinateSpace;
  if (Math.max(width,height,256) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error('Native map exceeds this GPU texture limit');
  const shaders = [], textures = [];
  let program, buffer, vao, disposed=false;
  function shader(type, source) { const s = gl.createShader(type); shaders.push(s); gl.shaderSource(s,source); gl.compileShader(s); if (!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function texture(unit, internal, w,h,format,type,data) { const t = gl.createTexture(); textures.push(t); gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,t); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE); gl.pixelStorei(gl.UNPACK_ALIGNMENT,1); gl.texImage2D(gl.TEXTURE_2D,0,internal,w,h,0,format,type,data); return t; }
  function dispose({contextLost=false}={}) {
    if(disposed)return;
    disposed=true;
    // A lost context already invalidated these handles. Never pass them to a
    // restored context, where deletion would poison its new GL error state.
    if(!contextLost){for(const t of textures)gl.deleteTexture(t);for(const s of shaders)gl.deleteShader(s);if(buffer)gl.deleteBuffer(buffer);if(vao)gl.deleteVertexArray(vao);if(program)gl.deleteProgram(program);}
    textures.length=0;shaders.length=0;program=null;buffer=null;vao=null;
  }
  try {
    program=gl.createProgram(); gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex)); gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment)); gl.linkProgram(program); if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)); gl.useProgram(program);
    vao=gl.createVertexArray();gl.bindVertexArray(vao);buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW); const pos=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
    const rows=Math.ceil(dataset.core.provinceIds.length/256), stateCodes=new Uint16Array(256*rows);
    const stateIndex=new Map(dataset.core.states.map((s,i)=>[String(s.id),i+1]));
    if(stateIndex.size>65535)throw new Error('Too many states for native state table');
    for(let i=1;i<dataset.core.provinceIds.length;i++)stateCodes[i]=stateIndex.get(String(dataset.core.provinceStateIds[i]));
    texture(0,gl.R16UI,width,height,gl.RED_INTEGER,gl.UNSIGNED_SHORT,dataset.ids);
    texture(1,gl.R16UI,256,rows,gl.RED_INTEGER,gl.UNSIGNED_SHORT,stateCodes);
    texture(2,gl.RGBA8,256,rows,gl.RGBA,gl.UNSIGNED_BYTE,null);
    texture(3,gl.R8,256,rows,gl.RED,gl.UNSIGNED_BYTE,null);
    for(const [i,name] of ['ids','states','colors','selected'].entries())gl.uniform1i(gl.getUniformLocation(program,name),i);
    const palette=new Uint8Array(rows*256*4), selection=new Uint8Array(rows*256);
    const uniforms=Object.fromEntries(['size','viewport','center','scale','borders'].map(k=>[k,gl.getUniformLocation(program,k)]));
    if(gl.getError()!==gl.NO_ERROR)throw new Error('GPU rejected native integer map textures');
    return {
      gl,
      update(document, selected) { for(let i=1;i<dataset.core.provinceIds.length;i++){if(dataset.core.provinceStateIds[i]===null)continue;const id=String(dataset.core.provinceStateIds[i]),c=document.color(id);palette[i*4]=parseInt(c.slice(1,3),16);palette[i*4+1]=parseInt(c.slice(3,5),16);palette[i*4+2]=parseInt(c.slice(5,7),16);palette[i*4+3]=255;selection[i]=selected.has(id)?255:0;} gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,textures[2]);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,256,rows,gl.RGBA,gl.UNSIGNED_BYTE,palette);gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,textures[3]);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,256,rows,gl.RED,gl.UNSIGNED_BYTE,selection); },
      draw(view,layers,pixelRatio=1) { gl.useProgram(program);gl.bindVertexArray(vao);gl.viewport(0,0,canvas.width,canvas.height);gl.uniform2f(uniforms.size,width,height);gl.uniform2f(uniforms.viewport,canvas.width,canvas.height);gl.uniform2f(uniforms.center,view.x,view.y);gl.uniform1f(uniforms.scale,view.scale*pixelRatio);gl.uniform1i(uniforms.borders,layers.borders?1:0);gl.drawArrays(gl.TRIANGLES,0,6); },
      dispose
    };
  } catch(error) { dispose();throw error; }
}

export function drawOverlay(canvas,dataset,document,view,layers,pixelRatio=1) {
  const ctx=canvas.getContext('2d');ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);const w=canvas.width/pixelRatio,h=canvas.height/pixelRatio;ctx.clearRect(0,0,w,h);
  const boxes=[];const point=(x,y)=>[(x-view.x)*view.scale+w/2,(y-view.y)*view.scale+h/2];
  function label(text,x,y,size,bold=false) { if(x<0||y<0||x>w||y>h)return;ctx.font=`${bold?'600':'500'} ${size}px system-ui, sans-serif`;const tw=ctx.measureText(text).width,box=[x-tw/2-3,y-size/2-2,x+tw/2+3,y+size/2+2];if(boxes.some(b=>box[0]<b[2]&&box[2]>b[0]&&box[1]<b[3]&&box[3]>b[1]))return;boxes.push(box);ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=3;ctx.strokeStyle='rgba(255,255,245,.86)';ctx.strokeText(text,x,y);ctx.fillStyle='#152027';ctx.fillText(text,x,y); }
  if(layers.cities)for(const p of dataset.places||[]) { if(view.scale<.7&&!p.isCapital)continue;const [x,y]=point(p.x,p.y);if(x<0||y<0||x>w||y>h)continue;ctx.beginPath();ctx.arc(x,y,p.isCapital?3.5:2.3,0,Math.PI*2);ctx.fillStyle='#17232e';ctx.fill();ctx.strokeStyle='#fff8df';ctx.lineWidth=1;ctx.stroke();label(p.name,x,y-10,11,!!p.isCapital); }
  if(layers.labels) {
    if(view.scale<1.4)for(const e of dataset.core.entities)if(e.anchor&&e.kind!=='water'){const [x,y]=point(...e.anchor);label(e.name,x,y,13,true);}
    if(view.scale>=.65)for(const s of dataset.core.states){if((s.pixelCount||1)*view.scale*view.scale<900&&!document.labels[s.id])continue;const [x,y]=point(...s.anchor);label(document.labels[s.id]||s.name,x,y,12);}
  }
}
