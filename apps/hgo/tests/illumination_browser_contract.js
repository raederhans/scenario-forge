// Main-thread localhost contract against the production visualization shader.
import {createVisualizationGpu,visualizationShader} from '../src/render/visualization.js';
import {DEFAULT_LAYERS} from '../src/render/settings.js';

const check=(ok,message)=>{if(!ok)throw new Error(message);};
export function runIlluminationPixels(){
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{antialias:false});
  check(gl,'WebGL2 unavailable');
  const program=gl.createProgram(),shaders=[];
  const compile=(type,source)=>{const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);check(gl.getShaderParameter(s,gl.COMPILE_STATUS),gl.getShaderInfoLog(s));gl.attachShader(program,s);};
  compile(gl.VERTEX_SHADER,`#version 300 es
    void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`);
  compile(gl.FRAGMENT_SHADER,`#version 300 es
    precision highp float;precision highp int;
    uniform vec2 size;uniform float scale;
    ivec2 table(uint code){return ivec2(int(code),0);}
    ${visualizationShader}
    out vec4 result;
    void main(){result=vec4(visualize(vec3(.2),gl_FragCoord.xy/scale,uint(1)),1.);}`);
  gl.linkProgram(program);check(gl.getProgramParameter(program,gl.LINK_STATUS),gl.getProgramInfoLog(program));gl.useProgram(program);
  const gpu=createVisualizationGpu(gl,program,{core:{provinceIds:[null,1],provinceStateIds:[null,1],states:[{id:1,entityTag:'AAA'}]}});
  // Offline four-cell smoothstep weights; encoded normal points along +X.
  const weights=[0,11,81,174,244,255,255,255,255];
  const data=new Uint8Array(weights.flatMap(a=>[a,Math.round(128*a/255),Math.round(128*a/255),a]));
  const layers={...DEFAULT_LAYERS,dayNight:true,nightOpacity:1};
  gpu.sync(new Map([['illumination',{width:9,height:1,data}]]),layers);
  const cases=[];
  try{
    for(const zoom of [.5,2,8])for(const dpr of [1,2]){
      const scale=zoom*dpr;canvas.width=90*scale;canvas.height=10*scale;
      gl.viewport(0,0,canvas.width,canvas.height);gl.uniform2f(gl.getUniformLocation(program,'size'),90,10);gl.uniform1f(gl.getUniformLocation(program,'scale'),scale);
      const rows=[];
      for(const direction of [[-1,0,0],[1,0,0]]){
        gpu.draw(layers,{direction});gl.drawArrays(gl.TRIANGLES,0,3);
        const pixels=new Uint8Array(canvas.width*4);gl.readPixels(0,Math.floor(canvas.height/2),canvas.width,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        rows.push(Array.from({length:canvas.width},(_,x)=>pixels[x*4]));
      }
      const [night,day]=rows;
      check(day.every(v=>v===51),'Invalid neighbors must not introduce false night on the day side');
      check(night[0]===51,'Unsupported domain must remain unshaded');
      check(Math.abs(night.at(-1)-11)<=1,'Supported interior night must keep full strength');
      const steps=night.slice(1).map((v,i)=>Math.abs(v-night[i]));
      const maxStep=Math.max(...steps);
      check(maxStep<=Math.ceil(2/scale)+2,`Hard seam remains at zoom ${zoom}, DPR ${dpr}: ${maxStep}`);
      check(night.slice(1).every((v,i)=>v<=night[i]+1),'Edge fade must be monotonic apart from byte quantization');
      cases.push({zoom,dpr,maxRedStep:maxStep});
    }
    check(gl.getError()===gl.NO_ERROR,'Illumination draw/read failed');
    return {status:'PASS',cases,checks:['continuous domain edge','invalid-normal isolation','unchanged full night','no false day-side shading']};
  }finally{gpu.dispose();gl.deleteProgram(program);for(const s of shaders)gl.deleteShader(s);gl.getExtension('WEBGL_lose_context')?.loseContext();}
}
