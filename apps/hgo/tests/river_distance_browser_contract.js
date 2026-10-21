// Run in a localhost browser by the main-thread owner. Uses the production
// visualization shader/GPU owner; no screenshot or shared browser is created.
import {createVisualizationGpu,visualizationShader} from '../src/render/visualization.js';
import {DEFAULT_LAYERS} from '../src/render/settings.js';

const assert=(condition,message)=>{if(!condition)throw new Error(message);};
function shader(gl,type,source){
  const result=gl.createShader(type);gl.shaderSource(result,source);gl.compileShader(result);
  assert(gl.getShaderParameter(result,gl.COMPILE_STATUS),gl.getShaderInfoLog(result));return result;
}

export function runRiverDistancePixels(){
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});
  assert(gl,'WebGL2 unavailable');
  const program=gl.createProgram(),shaders=[
    shader(gl,gl.VERTEX_SHADER,`#version 300 es
    void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`),
    shader(gl,gl.FRAGMENT_SHADER,`#version 300 es
    precision highp float;precision highp int;
    uniform vec2 size;uniform float scale;uniform float pixelRatio;
    ivec2 table(uint code){return ivec2(int(code),0);}
    ${visualizationShader}
    out vec4 result;
    void main(){vec2 source=gl_FragCoord.xy/scale;
      uint code=source.x/size.x<.625?uint(1):uint(2);
      result=vec4(visualize(vec3(.2),source,code),1.);}`)
  ];
  for(const item of shaders)gl.attachShader(program,item);
  gl.linkProgram(program);assert(gl.getProgramParameter(program,gl.LINK_STATUS),gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const dataset={core:{provinceIds:[null,1,2],provinceStateIds:[null,1,2],
    states:[{id:1,entityTag:'AAA'},{id:2,entityTag:'WTR'}]}};
  const gpu=createVisualizationGpu(gl,program,dataset),data=new Uint8Array(32*32);
  for(let y=0;y<32;y++)for(let x=0;x<32;x++){
    const distance=Math.min(Math.abs(x-8),Math.abs(x-24));
    data[y*32+x]=Math.max(0,Math.round(128+16*(distance===0?.5:.5-distance)));
  }
  const field={width:32,height:32,data};
  const resources=new Map([['rivers',field],['riversBalanced',field]]);
  const cases=[];
  try{
    for(const texelStep of [1,2])for(const zoom of [2,8])for(const dpr of [1,2]){
      const nativeSize=32*texelStep,deviceScale=zoom*dpr;
      canvas.width=canvas.height=nativeSize*deviceScale;
      gl.viewport(0,0,canvas.width,canvas.height);gl.useProgram(program);
      gl.uniform2f(gl.getUniformLocation(program,'size'),nativeSize,nativeSize);
      gl.uniform1f(gl.getUniformLocation(program,'scale'),deviceScale);
      gl.uniform1f(gl.getUniformLocation(program,'pixelRatio'),dpr);
      const measures=[],profiles=[];
      for(const width of [.5,1,3]){
        const layers={...DEFAULT_LAYERS,rivers:true,riverWidth:width,riverOpacity:1,
          quality:texelStep===1?'fine':'balanced'};
        gpu.sync(resources,layers);gpu.draw(layers);gl.drawArrays(gl.TRIANGLES,0,3);
        const row=new Uint8Array(canvas.width*4);
        gl.readPixels(0,Math.floor(canvas.height/2),canvas.width,1,gl.RGBA,gl.UNSIGNED_BYTE,row);
        assert(gl.getError()===gl.NO_ERROR,'River pixel draw/read failed');
        const coverage=[];
        for(let x=4*texelStep*deviceScale;x<13*texelStep*deviceScale;x++){
          coverage.push(Math.max(0,(row[x*4+2]-51)/(Math.round(.69*255)-51)));
        }
        const cssWidth=coverage.reduce((sum,value)=>sum+value,0)/dpr;
        const expected=width*texelStep*zoom;
        assert(Math.abs(cssWidth-expected)<.2,`Width ${width}: ${cssWidth} != ${expected}`);
        // A second identical river in native WTR must have zero visible effect,
        // including at the widest setting.
        for(let x=20*texelStep*deviceScale;x<canvas.width;x++)
          assert(row[x*4]===51&&row[x*4+1]===51&&row[x*4+2]===51,'River leaked into native water');
        if(zoom===8)assert(Math.max(...coverage)>.99,'Narrowing must not reduce center opacity');
        profiles.push(coverage);measures.push(Number(cssWidth.toFixed(4)));
      }
      assert(profiles[0].every((v,i)=>v<=profiles[1][i])&&profiles[1].every((v,i)=>v<=profiles[2][i]),
        'River footprints must be nested');
      cases.push({quality:texelStep===1?'fine':'balanced',zoom,dpr,cssWidths:measures});
    }
    const diagonal=new Uint8Array(32*32);
    for(let y=0;y<32;y++)for(let x=0;x<32;x++){
      const nearest=Math.round((x+y)/2);
      const distance=x===y?.5:.5-Math.hypot(x-nearest,y-nearest);
      diagonal[y*32+x]=Math.max(0,Math.round(128+16*distance));
    }
    resources.set('rivers',{width:32,height:32,data:diagonal});
    canvas.width=canvas.height=256;gl.viewport(0,0,256,256);
    gl.uniform2f(gl.getUniformLocation(program,'size'),32,32);
    gl.uniform1f(gl.getUniformLocation(program,'scale'),8);
    gl.uniform1f(gl.getUniformLocation(program,'pixelRatio'),1);
    const layers={...DEFAULT_LAYERS,rivers:true,riverWidth:.5,riverOpacity:1,quality:'fine'};
    gpu.sync(resources,layers);gpu.draw(layers);gl.drawArrays(gl.TRIANGLES,0,3);
    const pixels=new Uint8Array(256*256*4);gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    for(let i=16;i<152;i++)
      assert(pixels[(i*256+i)*4+2]>=175,`Thin diagonal broke at device pixel ${i}`);
    assert(gl.getError()===gl.NO_ERROR,'Diagonal draw/read failed');
    return {status:'PASS',cases,checks:['real edge contraction/expansion','DPR','quality texel size','opaque core','native water clipping','continuous thin diagonal']};
  }finally{
    gpu.dispose();gl.deleteProgram(program);for(const item of shaders)gl.deleteShader(item);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
