// IDs are categorical; only resolved colors are mixed. Navigation resamples the
// final RGBA surface, never the integer ID textures.
const VERTEX = `#version 300 es
in vec2 point;
uniform vec2 viewportSize;
uniform vec2 origin;
uniform vec2 extent;
void main() {
  vec2 p = (origin + point * extent) / viewportSize;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
}`;
const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp sampler2D;
uniform usampler2D codes;
uniform usampler2D edgeIds;
uniform sampler2D edgeWeights;
uniform sampler2D palette;
uniform vec2 viewportSize;
uniform vec2 origin;
uniform int edgeWidth;
uniform int paletteWidth;
out vec4 color;
ivec2 address(uint offset, int width) {
  return ivec2(int(offset % uint(width)), int(offset / uint(width)));
}
vec4 paint(uint code) {
  return texelFetch(palette, address(code, paletteWidth), 0);
}
void main() {
  ivec2 pixel = ivec2(floor(vec2(gl_FragCoord.x, viewportSize.y - gl_FragCoord.y) - origin));
  uint code = texelFetch(codes, pixel, 0).r;
  if ((code & 0x80000000u) == 0u) {
    color = paint(code);
    return;
  }
  uint start = code & 0x7fffffffu;
  uint count = texelFetch(edgeIds, address(start, edgeWidth), 0).r;
  vec4 mixed = vec4(0.0);
  for (uint i = 1u; i <= count; i++) {
    ivec2 at = address(start + i, edgeWidth);
    uint id = texelFetch(edgeIds, at, 0).r;
    float coverage = texelFetch(edgeWeights, at, 0).r;
    mixed += paint(id) * coverage;
  }
  // RGB is premultiplied by coverage, as required by the canvas compositor.
  color = mixed;
}`;

export function createPoliticalIdRasterGpu({
  canvas = new OffscreenCanvas(1, 1),
  onContextLost = () => {},
} = {}) {
  const gl = canvas.getContext("webgl2", {
    alpha: true, antialias: false, premultipliedAlpha: true,
    depth: false, stencil: false, preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error("Political ID raster prototype requires WebGL2.");
  const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const resources = new Set();
  const resident = new Map();
  let disposed = false, lost = false, paletteTexture = null, paletteWidth = 1;
  let paletteBytes = 0, tileUploads = 0, paletteUploads = 0, draws = 0;
  let paletteRevision = null, paletteLength = 0;
  let program, vao, buffer;
  const shaders = [];

  function assertAvailable() {
    if (disposed || lost || gl.isContextLost()) throw new Error("Political ID raster GPU is unavailable.");
  }
  function onLost(event) {
    event.preventDefault();
    lost = true;
    onContextLost();
  }
  canvas.addEventListener?.("webglcontextlost", onLost);
  function compile(type, source) {
    const shader = gl.createShader(type);
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  }
  function texture(internal, width, height, format, type, pixels) {
    if (width > limit || height > limit) throw new RangeError("ID raster data exceeds this GPU texture limit.");
    const handle = gl.createTexture();
    resources.add(handle);
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, pixels);
    if (gl.getError() !== gl.NO_ERROR) {
      removeTexture(handle);
      throw new Error("GPU rejected ID raster texture allocation.");
    }
    return handle;
  }
  function removeTexture(handle) {
    if (!handle) return;
    if (!lost && !gl.isContextLost()) gl.deleteTexture(handle);
    resources.delete(handle);
  }
  function dimensions(length) {
    const width = Math.min(limit, 1024, Math.max(1, length));
    const height = Math.max(1, Math.ceil(length / width));
    if (height > limit) throw new RangeError("Sparse ID coverage table exceeds GPU limits.");
    return { width, height };
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener?.("webglcontextlost", onLost);
    if (!lost && !gl.isContextLost()) {
      for (const handle of resources) gl.deleteTexture(handle);
      for (const shader of shaders) gl.deleteShader(shader);
      if (buffer) gl.deleteBuffer(buffer);
      if (vao) gl.deleteVertexArray(vao);
      if (program) gl.deleteProgram(program);
      // Repeated scenario/projection replacement should release the context
      // promptly instead of waiting for the browser's context-count GC limit.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    resources.clear();
    resident.clear();
    paletteTexture = null;
    paletteBytes = 0;
    canvas.width = 0;
    canvas.height = 0;
  }
  try {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || shaders.map(shader => gl.getShaderInfoLog(shader)).join("\n"));
    }
    gl.useProgram(program);
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, "point");
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    const uniforms = Object.fromEntries(
      ["viewportSize", "origin", "extent", "edgeWidth", "paletteWidth"].map(name => [name, gl.getUniformLocation(program, name)]),
    );
    for (const [unit, name] of ["codes", "edgeIds", "edgeWeights", "palette"].entries()) {
      gl.uniform1i(gl.getUniformLocation(program, name), unit);
    }

    function setPalette(bytes, revision) {
      assertAvailable();
      if (!(bytes instanceof Uint8Array) || bytes.length % 4 || bytes.length < 4) {
        throw new TypeError("Palette must contain packed RGBA bytes.");
      }
      if (paletteTexture && revision === paletteRevision && bytes.length === paletteLength) return false;
      const shape = dimensions(bytes.length / 4);
      const padded = new Uint8Array(shape.width * shape.height * 4);
      padded.set(bytes);
      gl.activeTexture(gl.TEXTURE3);
      if (paletteTexture && paletteBytes === padded.byteLength && paletteWidth === shape.width) {
        gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, shape.width, shape.height, gl.RGBA, gl.UNSIGNED_BYTE, padded);
      } else {
        const next = texture(gl.RGBA8, shape.width, shape.height, gl.RGBA, gl.UNSIGNED_BYTE, padded);
        removeTexture(paletteTexture);
        paletteTexture = next;
      }
      paletteBytes = padded.byteLength;
      paletteLength = bytes.length;
      paletteWidth = shape.width;
      paletteRevision = revision;
      paletteUploads++;
      return true;
    }
    function setTiles(tiles) {
      assertAvailable();
      const next = new Set(tiles);
      for (const [tile, resource] of resident) {
        if (next.has(tile)) continue;
        for (const handle of resource.textures) removeTexture(handle);
        resident.delete(tile);
      }
      for (const tile of tiles) {
        if (resident.has(tile)) continue;
        if (!(tile.codes instanceof Uint32Array) || tile.codes.length !== tile.width * tile.height
          || !(tile.edgeIds instanceof Uint32Array) || !(tile.edgeWeights instanceof Float32Array)
          || tile.edgeIds.length !== tile.edgeWeights.length) throw new TypeError("Invalid ID raster tile.");
        const shape = dimensions(tile.edgeIds.length);
        const ids = new Uint32Array(shape.width * shape.height);
        const weights = new Float32Array(ids.length);
        ids.set(tile.edgeIds); weights.set(tile.edgeWeights);
        const allocated = [];
        try {
          gl.activeTexture(gl.TEXTURE0);
          allocated.push(texture(gl.R32UI, tile.width, tile.height, gl.RED_INTEGER, gl.UNSIGNED_INT, tile.codes));
          allocated.push(texture(gl.R32UI, shape.width, shape.height, gl.RED_INTEGER, gl.UNSIGNED_INT, ids));
          allocated.push(texture(gl.R32F, shape.width, shape.height, gl.RED, gl.FLOAT, weights));
          resident.set(tile, { textures: allocated, edgeWidth: shape.width, bytes: tile.codes.byteLength + ids.byteLength + weights.byteLength });
          tileUploads++;
        } catch (error) {
          for (const handle of allocated) removeTexture(handle);
          throw error;
        }
      }
    }
    function draw({ width, height, originX = 0, originY = 0, context = null } = {}) {
      assertAvailable();
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
        || width > limit || height > limit || !paletteTexture) throw new RangeError("Invalid ID raster frame.");
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniform2f(uniforms.viewportSize, width, height);
      gl.uniform1i(uniforms.paletteWidth, paletteWidth);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
      for (const [tile, resource] of resident) {
        for (let unit = 0; unit < resource.textures.length; unit++) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, resource.textures[unit]);
        }
        gl.uniform2f(uniforms.origin, (tile.originX || 0) - originX, (tile.originY || 0) - originY);
        gl.uniform2f(uniforms.extent, tile.width, tile.height);
        gl.uniform1i(uniforms.edgeWidth, resource.edgeWidth);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      if (context) context.drawImage(canvas, 0, 0);
      draws++;
    }
    // Only for the prototype's correctness oracle. Production interaction must
    // not use synchronous GPU readback.
    function readPixelsForValidation() {
      assertAvailable();
      const raw = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      const topLeft = new Uint8Array(raw.length), stride = canvas.width * 4;
      for (let y = 0; y < canvas.height; y++) {
        topLeft.set(raw.subarray((canvas.height - y - 1) * stride, (canvas.height - y) * stride), y * stride);
      }
      return topLeft;
    }
    return {
      canvas, setPalette, setTiles, draw, readPixelsForValidation, dispose,
      isAvailable: () => !disposed && !lost && !gl.isContextLost(),
      getStats: () => ({
        tileUploads, paletteUploads, draws, residentTiles: resident.size, contextLost: lost,
        gpuTextureBytes: paletteBytes + [...resident.values()].reduce((sum, value) => sum + value.bytes, 0),
        outputSurfaceBytesEstimate: canvas.width * canvas.height * 4,
        accounting: "explicit-texture-and-surface-estimates-not-driver-vram",
      }),
      getEnvironment: () => {
        const debug = gl.getExtension("WEBGL_debug_renderer_info");
        return {
          version: gl.getParameter(gl.VERSION), maxTextureSize: limit,
          renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
        };
      },
      // Tests request loss through the platform extension; no app state changes.
      loseContextForValidation: () => gl.getExtension("WEBGL_lose_context")?.loseContext(),
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
