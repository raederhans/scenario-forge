import { decodeBathymetryDepth, invertProjectedPoint } from './bathymetry_texture_math.js';
import { depthToToneIndex } from './bathymetry_texture_palette.js';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const CONTOURS = [200, 1000, 2000, 4000];

export function estimateGeographicBounds(width, height, inverseFn, gridSize = 33) {
  const samples = [], longitudes = [];
  let south = 90, north = -90, longitudeStep = 0, latitudeStep = 0, touchesEdge = false;
  for (let row = 0; row < gridSize; row++) for (let col = 0; col < gridSize; col++) {
    const point = inverseFn(col * width / (gridSize - 1), row * height / (gridSize - 1));
    samples.push(point);
    if (!point) continue;
    const [lon, lat] = point;
    longitudes.push(lon);
    south = Math.min(south, lat); north = Math.max(north, lat);
    if (row === 0 || col === 0 || row === gridSize - 1 || col === gridSize - 1) touchesEdge = true;
    for (const neighbor of [col > 0 ? samples[samples.length - 2] : null,
      row > 0 ? samples[samples.length - 1 - gridSize] : null]) {
      if (!neighbor) continue;
      const difference = Math.abs(lon - neighbor[0]);
      longitudeStep = Math.max(longitudeStep, Math.min(difference, 360 - difference));
      latitudeStep = Math.max(latitudeStep, Math.abs(lat - neighbor[1]));
    }
  }
  if (!longitudes.length) return null;
  longitudes.sort((a, b) => a - b);
  let west = longitudes[0], east = longitudes[longitudes.length - 1], largestGap = 180;
  for (let i = 1; i < longitudes.length; i++) {
    const gap = longitudes[i] - longitudes[i - 1];
    if (gap > largestGap) { largestGap = gap; west = longitudes[i]; east = longitudes[i - 1]; }
  }
  const span = east < west ? east - west + 360 : east - west;
  south = Math.max(-90, south - latitudeStep); north = Math.min(90, north + latitudeStep);
  if (!touchesEdge || span + 2 * longitudeStep >= 359) return [-180, south, 180, north];
  const normalize = (lon) => ((lon + 180) % 360 + 360) % 360 - 180;
  return [normalize(west - longitudeStep), south, normalize(east + longitudeStep), north];
}

const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const BATHYMETRY_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
precision highp usampler2D;
uniform sampler2D overviewTex, overlayTex, rampTex;
uniform sampler2DArray tileTex;
uniform usampler2D indexTex;
uniform mat3 inverseTransform;
uniform vec4 projection;
uniform vec4 overlayBounds;
uniform vec2 blockOrigin, blockSize;
uniform float maxDepth, toneScale, contourStrength;
uniform float hillshadeStrength, hillshadeExaggeration;
uniform int detail, hasOverlay, preset;
out vec4 color;
const float PI = 3.141592653589793;
const float M = 0.8660254037844386;
const float A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796;
const float stops[9] = float[9](0.,50.,100.,200.,500.,1000.,2000.,4000.,6000.);
const float tones[9] = float[9](0.,.14,.25,.38,.50,.61,.73,.89,1.);
const float contours[4] = float[4](200.,1000.,2000.,4000.);
const int bayer[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);

// Pixel center -> inverse affine transform -> Equal Earth inverse -> lon/lat.
bool geographic(vec2 pixel, out vec2 ll) {
  vec2 plane = (inverseTransform * vec3(pixel, 1.)).xy;
  vec2 raw = vec2(plane.x - projection.y, projection.z - plane.y) / projection.x;
  float l = raw.y;
  bool converged = false;
  for (int i = 0; i < 12; i++) {
    float l2 = l*l, l6 = l2*l2*l2;
    float delta = (l*(A1+A2*l2+l6*(A3+A4*l2))-raw.y)/(A1+3.*A2*l2+l6*(7.*A3+9.*A4*l2));
    l -= delta;
    if (abs(delta) < 1e-7) { converged = true; break; }
  }
  if (!converged || abs(l) > PI/3. + 1e-7) return false;
  float l2=l*l, l6=l2*l2*l2;
  float lambda=M*raw.x*(A1+3.*A2*l2+l6*(7.*A3+9.*A4*l2))/cos(l);
  if (abs(lambda) > PI) return false;
  ll = vec2(mod(lambda-projection.w+PI,2.*PI)-PI, asin(clamp(sin(l)/M,-1.,1.))) * (180./PI);
  return true;
}

float imageValue(sampler2D tex, vec2 uv, bool wrapX) {
  ivec2 size = textureSize(tex, 0);
  vec2 p = uv * vec2(size) - .5, f = fract(p);
  ivec2 base = ivec2(floor(p));
  float values[4];
  for (int i=0;i<4;i++) {
    ivec2 q=base+ivec2(i%2,i/2);
    q.x=wrapX ? (q.x%size.x+size.x)%size.x : clamp(q.x,0,size.x-1);
    q.y=clamp(q.y,0,size.y-1);
    values[i]=texelFetch(tex,q,0).r*255.;
  }
  return mix(mix(values[0],values[1],f.x),mix(values[2],values[3],f.x),f.y);
}

// Four global-grid texels cross tile boundaries before interpolation.
float encoded(vec2 ll) {
  vec2 uv=vec2((ll.x+180.)/360.,(90.-ll.y)/180.);
  float value=imageValue(overviewTex,uv,true);
  if (detail == 1) {
    int tileSize=textureSize(tileTex,0).x;
    ivec2 world=ivec2(18,9)*tileSize;
    vec2 p=uv*vec2(world)-.5, f=fract(p);
    ivec2 base=ivec2(floor(p));
    float values[4]; bool missing=false;
    for(int i=0;i<4;i++) {
      ivec2 q=base+ivec2(i%2,i/2);
      q.x=(q.x%world.x+world.x)%world.x; q.y=clamp(q.y,0,world.y-1);
      uint layer=texelFetch(indexTex,q/tileSize,0).r;
      if(layer==255u) missing=true;
      values[i]=(layer==0u || layer==255u) ? 0. : texelFetch(tileTex,ivec3(q%tileSize,int(layer)-1),0).r*255.;
    }
    if(!missing) value=mix(mix(values[0],values[1],f.x),mix(values[2],values[3],f.x),f.y);
  }
  if(hasOverlay==1) {
    float span=overlayBounds.z-overlayBounds.x;
    if(span<0.) span+=360.;
    float dx=mod(ll.x-overlayBounds.x+360.,360.);
    if(dx<=span && ll.y>=overlayBounds.y && ll.y<=overlayBounds.w) {
      float v=imageValue(overlayTex,vec2(dx/span,(overlayBounds.w-ll.y)/(overlayBounds.w-overlayBounds.y)),span==360.);
      if(v>.5) value=v;
    }
  }
  return value;
}
float depthAt(vec2 pixel, float otherwise) {
  vec2 ll;
  if(!geographic(pixel,ll)) return otherwise;
  float v=encoded(ll);
  return maxDepth*pow(max(0.,v-1.)/254.,2.);
}
int toneIndex(float depth) {
  float d=clamp(depth,0.,6000.), t=0.;
  for(int i=1;i<9;i++) {
    if(d<=stops[i]) { t=mix(tones[i-1],tones[i],(d-stops[i-1])/(stops[i]-stops[i-1])); break; }
  }
  return int(floor(clamp(.5+(t-.5)*toneScale,0.,1.)*255.+.5));
}
void main() {
  vec2 pixel=blockOrigin+vec2(gl_FragCoord.x,blockSize.y-gl_FragCoord.y);
  vec2 ll;
  bool inside=geographic(pixel,ll);
  float depth=inside ? depthAt(pixel,0.) : 0.;
  float derivative=fwidth(depth);
  if(!inside) { color=vec4(0.); return; }
  vec3 rgb=texelFetch(rampTex,ivec2(toneIndex(depth),0),0).rgb;
  if(preset==1) {
    float dx=(sqrt(depthAt(pixel+vec2(1,0),depth))-sqrt(depthAt(pixel-vec2(1,0),depth)))*.5;
    float dy=(sqrt(depthAt(pixel+vec2(0,1),depth))-sqrt(depthAt(pixel-vec2(0,1),depth)))*.5;
    float light=dot(normalize(vec3(-dx*hillshadeExaggeration,-dy*hillshadeExaggeration,1.)),vec3(-.5,-.5,.7071067811865476));
    float brightness=1.+clamp(light-.7071067811865476,-hillshadeStrength,hillshadeStrength);
    ivec2 q=ivec2(floor(pixel));
    float dither=((float(bayer[(q.y%4)*4+q.x%4])+.5)/16.-.5)/255.;
    rgb=rgb*brightness+dither;
  } else if(preset==2) {
    for(int i=0;i<4;i++) {
      float coverage=max(0.,1.-abs(depth-contours[i])/max(derivative,1e-6));
      vec3 line=texelFetch(rampTex,ivec2(toneIndex(contours[i]),0),0).rgb*.65;
      rgb=mix(rgb,line,coverage*contourStrength);
    }
  }
  color=vec4(rgb,1.);
}`;

export function createBathymetryTextureRenderer({ createCanvas, getWebGL2Context = (canvas) => canvas.getContext('webgl2', { premultipliedAlpha: false }) }) {
  let pixels = new WeakMap(), gpu = null, unavailable = false, outputCanvas = null;
  function read(image) {
    if (pixels.has(image)) return pixels.get(image);
    let result;
    if (image.data) {
      if (image.data.length === image.width * image.height) result = image;
      else result = { width: image.width, height: image.height, data: Uint8Array.from({ length: image.width * image.height }, (_, i) => image.data[i * 4]) };
    } else {
      const canvas = createCanvas(image.width, image.height);
      canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const rgba = ctx.getImageData(0, 0, image.width, image.height).data;
      result = { width: image.width, height: image.height, data: Uint8Array.from({ length: image.width * image.height }, (_, i) => rgba[i * 4]) };
    }
    pixels.set(image, result);
    return result;
  }
  const wrap = (n, size) => ((n % size) + size) % size;
  function bilinear(image, u, v, wrapX) {
    const x = u * image.width - 0.5, y = v * image.height - 0.5;
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const at = (xx, yy) => image.data[Math.max(0, Math.min(image.height - 1, yy)) * image.width
      + (wrapX ? wrap(xx, image.width) : Math.max(0, Math.min(image.width - 1, xx)))];
    return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy)
      + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
  }
  function release() {
    if (!gpu) return;
    const { gl, program, textures } = gpu;
    for (const texture of textures) gl.deleteTexture(texture);
    gl.deleteProgram(program);
    gpu = null;
  }
  function initialize(prewarm = false) {
    const canvas = createCanvas(1, 1);
    const gl = getWebGL2Context(canvas);
    if (!gl) return null;
    const pending = prewarm ? gl.getExtension('KHR_parallel_shader_compile') : null;
    const program = gl.createProgram();
    for (const [type, code] of [[gl.VERTEX_SHADER, VERTEX_SHADER], [gl.FRAGMENT_SHADER, BATHYMETRY_FRAGMENT_SHADER]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, code); gl.compileShader(shader);
      if (!pending && !gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader); gl.deleteProgram(program); throw new Error(message);
      }
      gl.attachShader(program, shader); gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!pending && !gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program); gl.deleteProgram(program); throw new Error(message);
    }
    // getParameter forces a round trip that waits for every queued GPU command;
    // read these constants once instead of stalling each frame behind raster work.
    const limits = {
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxLayers: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS),
      viewport: gl.getParameter(gl.MAX_VIEWPORT_DIMS),
    };
    const state = { gl, canvas, program, pending, limits, textures: Array.from({ length: 5 }, () => gl.createTexture()),
      source: null, overview: null, overlay: undefined, ramp: null, capacity: 0,
      layers: new Map(), tileImages: new Map(), index: null };
    canvas.addEventListener?.('webglcontextlost', (event) => {
      event.preventDefault();
      if (gpu === state) { gpu = null; unavailable = false; }
    });
    return state;
  }
  function prewarm() {
    if (gpu || unavailable) return;
    try { gpu = initialize(true); unavailable = !gpu; } catch { unavailable = true; }
  }
  function isReady() {
    if (gpu?.pending) {
      const { gl, program, pending } = gpu;
      try {
        if (!gl.getProgramParameter(program, pending.COMPLETION_STATUS_KHR)) return false;
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
        gpu.pending = null;
      } catch { release(); unavailable = true; }
    }
    return !!gpu || unavailable;
  }
  function drawGpu(options, inverse, tiles, tileSize, overlayImage, output) {
    const { gl, canvas, program, textures } = gpu;
    const { width, height, source, projectionParams: p, ramp, overlay, detail, preset, contourStrength,
      hillshadeStrength, hillshadeExaggeration } = options;
    gl.useProgram(program);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const uniform = (name) => gl.getUniformLocation(program, name);
    function bind(unit, target) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, textures[unit]); }
    function parameters(target) {
      gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    function uploadImage(image) {
      if (image.data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, image.width, image.height, 0, gl.RED, gl.UNSIGNED_BYTE, read(image).data);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, image);
    }
    const maxTexture = gpu.limits.maxTexture;
    if (gpu.overview !== source.getOverview()) {
      let image = source.getOverview();
      if (image.width > maxTexture) image = read(image);
      while (image.width > maxTexture) {
        const w = Math.ceil(image.width / 2), h = Math.ceil(image.height / 2);
        image = { width: w, height: h, data: Uint8Array.from({ length: w * h }, (_, i) =>
          Math.round(bilinear(image, (i % w + .5) / w, (Math.floor(i / w) + .5) / h, true))) };
      }
      bind(0, gl.TEXTURE_2D); parameters(gl.TEXTURE_2D);
      uploadImage(image);
      gpu.overview = source.getOverview();
    }
    const capacity = Math.min(254, gpu.limits.maxLayers, source.getCapacity());
    bind(1, gl.TEXTURE_2D_ARRAY); parameters(gl.TEXTURE_2D_ARRAY);
    if (gpu.capacity !== capacity || gpu.tileSize !== tileSize) {
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8, tileSize, tileSize, capacity, 0, gl.RED, gl.UNSIGNED_BYTE, null);
      gpu.capacity = capacity; gpu.tileSize = tileSize;
      gpu.layers.clear(); gpu.tileImages.clear();
    }
    if (gpu.source !== source) { gpu.layers.clear(); gpu.tileImages.clear(); gpu.source = source; }
    for (const key of gpu.layers.keys()) {
      if (!tiles.has(key)) { gpu.layers.delete(key); gpu.tileImages.delete(key); }
    }
    const used = new Set(gpu.layers.values());
    for (const [key, bitmap] of tiles) {
      if (!gpu.layers.has(key)) {
        let layer = 0;
        while (used.has(layer)) layer++;
        gpu.layers.set(key, layer); used.add(layer);
      }
      if (gpu.tileImages.get(key) !== bitmap) {
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, gpu.layers.get(key), tileSize, tileSize, 1,
          gl.RED, gl.UNSIGNED_BYTE, bitmap.data ? read(bitmap).data : bitmap);
        gpu.tileImages.set(key, bitmap);
      }
    }
    const index = new Uint8Array(18 * 9);
    for (const key of source.getManifest().tiles.present) {
      const [col, row] = key.split('_').map(Number); index[row * 18 + col] = 255;
    }
    for (const [key, layer] of gpu.layers) {
      const [col, row] = key.split('_').map(Number); index[row * 18 + col] = layer + 1;
    }
    if (!gpu.index || index.some((value, i) => value !== gpu.index[i])) {
      bind(2, gl.TEXTURE_2D); parameters(gl.TEXTURE_2D);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, 18, 9, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, index);
      gpu.index = index;
    }
    if (gpu.overlay !== overlayImage) {
      const image = overlayImage || { width: 1, height: 1, data: new Uint8Array(1) };
      bind(3, gl.TEXTURE_2D); parameters(gl.TEXTURE_2D);
      uploadImage(image);
      gpu.overlay = overlayImage;
    }
    if (gpu.ramp !== ramp) {
      bind(4, gl.TEXTURE_2D); parameters(gl.TEXTURE_2D);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, ramp);
      gpu.ramp = ramp;
    }
    ['overviewTex', 'tileTex', 'indexTex', 'overlayTex', 'rampTex'].forEach((name, i) => {
      bind(i, i === 1 ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D); gl.uniform1i(uniform(name), i);
    });
    gl.uniformMatrix3fv(uniform('inverseTransform'), false, new Float32Array([inverse.a, inverse.b, 0, inverse.c, inverse.d, 0, inverse.e, inverse.f, 1]));
    gl.uniform4f(uniform('projection'), p.scale, p.offsetX, p.offsetY, p.rotation);
    gl.uniform4fv(uniform('overlayBounds'), overlay?.bounds || [-180, -90, 180, 90]);
    gl.uniform1f(uniform('maxDepth'), source.getManifest().encoding.max_depth_m);
    gl.uniform1f(uniform('toneScale'), Math.max(.6, Math.min(2.4, Number(ramp.scale) || 1)));
    gl.uniform1f(uniform('contourStrength'), contourStrength);
    gl.uniform1f(uniform('hillshadeStrength'), hillshadeStrength);
    gl.uniform1f(uniform('hillshadeExaggeration'), hillshadeExaggeration);
    gl.uniform1i(uniform('detail'), detail ? 1 : 0); gl.uniform1i(uniform('hasOverlay'), overlay ? 1 : 0);
    gl.uniform1i(uniform('preset'), preset === 'bathymetry_soft' ? 1 : preset === 'bathymetry_contours' ? 2 : 0);
    const viewport = gpu.limits.viewport;
    const limitX = Math.min(4096, maxTexture, viewport[0]), limitY = Math.min(4096, maxTexture, viewport[1]);
    const ctx = output.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    for (let y = 0; y < height; y += limitY) for (let x = 0; x < width; x += limitX) {
      const w = Math.min(limitX, width - x), h = Math.min(limitY, height - y);
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uniform('blockOrigin'), x, y); gl.uniform2f(uniform('blockSize'), w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      ctx.drawImage(canvas, x, y);
    }
  }

  function render({ width, height, transform, projectionParams, source, ramp, preset,
    contourStrength = 0, overlay = null, detail = true, hillshadeStrength = .12, hillshadeExaggeration = 4 }) {
    if (!gpu && !unavailable) {
      try { gpu = initialize(); unavailable = !gpu; } catch { unavailable = true; }
    }
    if (!isReady()) return { canvas: null, backend: 'pending', coveredBounds: null, missingTileKeys: [] };
    const canvas = outputCanvas ||= createCanvas(width, height);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const determinant = transform.a * transform.d - transform.b * transform.c;
    const inverse = { a: transform.d / determinant, b: -transform.b / determinant,
      c: -transform.c / determinant, d: transform.a / determinant,
      e: (transform.c * transform.f - transform.d * transform.e) / determinant,
      f: (transform.b * transform.e - transform.a * transform.f) / determinant };
    const geographic = (x, y) => invertProjectedPoint(projectionParams,
      inverse.a * x + inverse.c * y + inverse.e, inverse.b * x + inverse.d * y + inverse.f);
    const manifest = source.getManifest(), present = new Set(manifest.tiles.present);
    const layerLimit = gpu ? Math.min(254, gpu.limits.maxLayers, source.getCapacity()) : Infinity;
    const tiles = new Map([...source.getLoadedTiles()].slice(-layerLimit));
    const tileSize = tiles.values().next().value?.width ?? manifest.tiles.tile_size ?? 600;
    const coveredBounds = estimateGeographicBounds(width, height, geographic);
    const overlayBitmap = overlay ? overlay.bitmap || overlay : null;
    if (gpu) {
      const missingTileKeys = detail && coveredBounds
        ? source.getTileKeysForBounds(coveredBounds).filter((key) => !tiles.has(key)) : [];
      drawGpu({ width, height, source, projectionParams, ramp, overlay, detail, preset, contourStrength,
        hillshadeStrength, hillshadeExaggeration }, inverse, tiles, tileSize, overlayBitmap, canvas);
      return { canvas, backend: 'webgl2', coveredBounds, missingTileKeys };
    }
    const overview = read(source.getOverview());
    const overlayImage = overlayBitmap ? read(overlayBitmap) : null;
    const missing = new Set();
    function tileSamples(lon, lat) {
      const worldWidth = 18 * tileSize, worldHeight = 9 * tileSize;
      const x = (lon + 180) / 360 * worldWidth - .5, y = (90 - lat) / 180 * worldHeight - .5;
      const ix = Math.floor(x), iy = Math.floor(y), values = [];
      let absent = false;
      for (let i = 0; i < 4; i++) {
        const xx = wrap(ix + i % 2, worldWidth), yy = Math.max(0, Math.min(worldHeight - 1, iy + Math.floor(i / 2)));
        const key = `${Math.floor(xx / tileSize)}_${Math.floor(yy / tileSize)}`;
        const bitmap = tiles.get(key);
        if (!bitmap && present.has(key)) { missing.add(key); absent = true; }
        values.push(bitmap ? read(bitmap).data[(yy % tileSize) * tileSize + xx % tileSize] : 0);
      }
      if (absent) return null;
      const fx = x - ix, fy = y - iy;
      return (values[0] * (1 - fx) + values[1] * fx) * (1 - fy) + (values[2] * (1 - fx) + values[3] * fx) * fy;
    }
    function depthAt(x, y, otherwise = 0) {
      const ll = geographic(x, y);
      if (!ll) return otherwise;
      const [lon, lat] = ll;
      let value = detail ? tileSamples(lon, lat) : null;
      if (value === null) value = bilinear(overview, (lon + 180) / 360, (90 - lat) / 180, true);
      if (overlay) {
        const [west, south, east, north] = overlay.bounds;
        const span = east < west ? east - west + 360 : east - west;
        const dx = wrap(lon - west, 360);
        if (dx <= span && lat >= south && lat <= north) {
          const v = bilinear(overlayImage, dx / span, (north - lat) / (north - south), span === 360);
          if (v > .5) value = v;
        }
      }
      return decodeBathymetryDepth(value, manifest.encoding);
    }
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const ll = geographic(x + .5, y + .5);
      if (!ll) continue;
      const depth = depthAt(x + .5, y + .5), index = depthToToneIndex(depth, ramp.scale);
      const rgb = Array.from(ramp.slice(index * 4, index * 4 + 3));
      if (preset === 'bathymetry_soft' || preset === 'bathymetry_contours') {
        const left = depthAt(x - .5, y + .5, depth), right = depthAt(x + 1.5, y + .5, depth);
        const top = depthAt(x + .5, y - .5, depth), bottom = depthAt(x + .5, y + 1.5, depth);
        if (preset === 'bathymetry_soft') {
          const dx = (Math.sqrt(right) - Math.sqrt(left)) * .5 * hillshadeExaggeration;
          const dy = (Math.sqrt(bottom) - Math.sqrt(top)) * .5 * hillshadeExaggeration;
          const light = (.5 * dx + .5 * dy + Math.SQRT1_2) / Math.hypot(dx, dy, 1);
          const brightness = 1 + Math.max(-hillshadeStrength, Math.min(hillshadeStrength, light - Math.SQRT1_2));
          const dither = (BAYER[(y % 4) * 4 + x % 4] + .5) / 16 - .5;
          for (let c = 0; c < 3; c++) rgb[c] = rgb[c] * brightness + dither;
        } else {
          const derivative = Math.max(1e-6, (Math.abs(right - left) + Math.abs(bottom - top)) * .5);
          for (const contour of CONTOURS) {
            const alpha = Math.max(0, 1 - Math.abs(depth - contour) / derivative) * contourStrength;
            const lineIndex = depthToToneIndex(contour, ramp.scale);
            for (let c = 0; c < 3; c++) rgb[c] += (ramp[lineIndex * 4 + c] * .65 - rgb[c]) * alpha;
          }
        }
      }
      const offset = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) image.data[offset + c] = Math.round(rgb[c]);
      image.data[offset + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return { canvas, backend: 'cpu', coveredBounds, missingTileKeys: [...missing] };
  }
  return { prewarm, isReady, render, dispose() { release(); pixels = new WeakMap(); unavailable = false; outputCanvas = null; } };
}
