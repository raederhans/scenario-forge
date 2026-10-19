import { gpuAffineMatrix } from "./gpu_scene_compositor.js";

// IDs are categorical. Direct navigation resolves four texels to premultiplied
// RGBA before interpolation; integer IDs are always fetched with texelFetch.
const VERTEX = `#version 300 es
in vec2 point;
uniform vec2 viewportSize;
uniform vec2 origin;
uniform vec2 extent;
uniform mat3 transform;
out vec2 tilePixel;
void main() {
  tilePixel = point * extent;
  vec2 p = (transform * vec3(origin + tilePixel, 1.0)).xy / viewportSize;
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
in vec2 tilePixel;
uniform int smoothColors;
uniform int edgeWidth;
uniform int paletteWidth;
out vec4 color;
ivec2 address(uint offset, int width) {
  return ivec2(int(offset % uint(width)), int(offset / uint(width)));
}
vec4 paint(uint code) {
  vec4 rgba = texelFetch(palette, address(code, paletteWidth), 0);
  return vec4(rgba.rgb * rgba.a, rgba.a);
}
vec4 resolve(ivec2 pixel) {
  uint code = texelFetch(codes, pixel, 0).r;
  if ((code & 0x80000000u) == 0u) {
    return paint(code);
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
  return mixed;
}
void main() {
  if (smoothColors == 0) { color = resolve(ivec2(floor(tilePixel))); return; }
  vec2 sampleAt = tilePixel + vec2(0.5);
  ivec2 base = ivec2(floor(sampleAt));
  vec2 weight = fract(sampleAt);
  color = mix(mix(resolve(base), resolve(base + ivec2(1, 0)), weight.x),
    mix(resolve(base + ivec2(0, 1)), resolve(base + ivec2(1, 1)), weight.x), weight.y);
}`;

export function createPoliticalIdRasterGpu({
  canvas = null,
  gl: sharedGl = null,
  maxTextureBytes = 256 * 1024 * 1024,
  onContextLost = () => {},
  getReservedTextureBytes = () => 0,
} = {}) {
  if (!Number.isFinite(maxTextureBytes) || maxTextureBytes <= 0) throw new RangeError("Invalid political GPU texture budget.");
  canvas = canvas || sharedGl?.canvas || new OffscreenCanvas(1, 1);
  const gl = sharedGl || canvas.getContext("webgl2", {
    alpha: true, antialias: false, premultipliedAlpha: true,
    depth: false, stencil: false, preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error("Political ID raster prototype requires WebGL2.");
  const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const resources = new Set();
  const resident = new Map();
  let pendingFrame = null;
  let preparedFrameUploads = 0, preparedFrameCommits = 0, preparedFrameCancellations = 0, preparedFrameBudgetRejects = 0;
  // Identity must survive repeated uploads without retaining the CPU payload.
  // Neither tokens nor resident descriptors point back to their WeakMap keys.
  const tileTokens = new WeakMap();
  function tokenOf(tile) {
    let token = tileTokens.get(tile);
    if (!token) { token = {}; tileTokens.set(tile, token); }
    return token;
  }
  let disposed = false, lost = false, paletteTexture = null, paletteWidth = 1;
  let paletteBytes = 0, tileUploads = 0, paletteUploads = 0, draws = 0;
  let paletteRevision = null, paletteLength = 0;
  let program, vao, buffer, overview = null;
  const pendingTextureBytes = () => pendingFrame?.bytes || 0;
  const primaryTextureBytes = () => paletteBytes + [...resident.values()].reduce((sum, item) => sum + item.bytes, 0) + pendingTextureBytes();
  const reservedTextureBytes = () => getReservedTextureBytes() + (overview?.getStats().gpuTextureBytes || 0);
  const shaders = [];

  function assertAvailable() {
    if (disposed || lost || gl.isContextLost()) throw new Error("Political ID raster GPU is unavailable.");
  }
  function onLost(event) {
    event.preventDefault();
    lost = true;
    cancelPendingFrame();
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
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, pixels);
    return handle;
  }
  function removeTexture(handle) {
    if (!handle) return;
    if (!lost && !gl.isContextLost()) gl.deleteTexture(handle);
    resources.delete(handle);
  }
  function cancelPendingFrame(job = pendingFrame) {
    if (!job || job.finished) return;
    job.finished = true;
    job.signal?.removeEventListener("abort", job.onAbort);
    for (const resource of job.created) for (const handle of resource.textures) removeTexture(handle);
    job.created.clear(); job.tiles.clear(); job.bytes = 0;
    if (pendingFrame === job) pendingFrame = null;
    preparedFrameCancellations++;
    job.onProgress?.();
  }
  function dimensions(length) {
    const width = Math.min(limit, 1024, Math.max(1, length));
    const height = Math.max(1, Math.ceil(length / width));
    if (height > limit) throw new RangeError("Sparse ID coverage table exceeds GPU limits.");
    return { width, height };
  }
  function dispose() {
    if (disposed) return;
    cancelPendingFrame();
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
      if (!sharedGl) gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    overview?.dispose(); overview = null;
    resources.clear();
    resident.clear();
    paletteTexture = null;
    paletteBytes = 0;
    if (!sharedGl) { canvas.width = 0; canvas.height = 0; }
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
      ["viewportSize", "origin", "extent", "edgeWidth", "paletteWidth", "transform", "smoothColors"].map(name => [name, gl.getUniformLocation(program, name)]),
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
      const nextBytes = shape.width * shape.height * 4;
      if (nextBytes + [...resident.values()].reduce((sum, item) => sum + item.bytes, 0) + pendingTextureBytes() + reservedTextureBytes() > maxTextureBytes) throw new RangeError("Political GPU texture budget exceeded.");
      const padded = new Uint8Array(nextBytes);
      padded.set(bytes);
      gl.activeTexture(gl.TEXTURE3);
      if (paletteTexture && paletteBytes === padded.byteLength && paletteWidth === shape.width) {
        gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
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
    function planTiles(tiles) {
      assertAvailable();
      const next = new Set(tiles);
      if (next.size !== tiles.length) throw new TypeError("Duplicate ID raster tiles.");
      return tiles.map(tile => planTile(tile, tiles));
    }
    function planTile(tile, tiles) {
      if (!Number.isSafeInteger(tile.width) || !Number.isSafeInteger(tile.height) || tile.width <= 0 || tile.height <= 0
        || !Number.isSafeInteger(tile.originX ?? 0) || !Number.isSafeInteger(tile.originY ?? 0)) throw new TypeError("Invalid ID raster tile.");
      const x = tile.originX || 0, y = tile.originY || 0;
      const neighbors = sharedGl ? tiles.filter(other => other !== tile
        && (other.originX || 0) <= x + tile.width && (other.originX || 0) + other.width >= x
        && (other.originY || 0) <= y + tile.height && (other.originY || 0) + other.height >= y) : [];
      const token = tokenOf(tile);
      const neighborTokens = neighbors.map(tokenOf);
      const existing = resident.get(token);
      if (existing && existing.originX === x && existing.originY === y && existing.width === tile.width && existing.height === tile.height
        && existing.neighbors.length === neighborTokens.length && existing.neighbors.every((value, index) => value === neighborTokens[index])) {
        return { tile, token, existing, bytes: existing.bytes };
      }
      // Accepted derived tiles are immutable. Resident texture replay needs
      // only layout/token compatibility, not materialized CPU payloads.
      const sourceCodes = tile.codes;
      if (!(sourceCodes instanceof Uint32Array) || sourceCodes.length !== tile.width * tile.height
        || !(tile.edgeIds instanceof Uint32Array) || !(tile.edgeWeights instanceof Float32Array)
        || tile.edgeIds.length !== tile.edgeWeights.length) throw new TypeError("Invalid ID raster tile.");
      const upload = sharedGl ? paddedTile(tile, neighbors) : tile;
      const shape = dimensions(upload.edgeIds.length);
      if (upload.width > limit || upload.height > limit) throw new RangeError("ID raster data exceeds this GPU texture limit.");
      return { tile, token, upload, neighbors: neighborTokens, shape, bytes: upload.codes.byteLength + shape.width * shape.height * 8 };
    }
    function checkTileBudget(plans, nextPaletteBytes = paletteBytes) {
      if (nextPaletteBytes + plans.reduce((sum, plan) => sum + plan.bytes, 0) + reservedTextureBytes() > maxTextureBytes) throw new RangeError("Political GPU texture budget exceeded.");
    }
    function releaseReplacedTiles(plans) {
      for (const [token, resource] of resident) {
        if (plans.some(plan => plan.token === token && plan.existing)) continue;
        for (const handle of resource.textures) removeTexture(handle);
        resident.delete(token);
      }
    }
    function uploadTile({ tile, existing, upload, neighbors, shape, bytes }) {
      if (existing) return existing;
      const ids = new Uint32Array(shape.width * shape.height), weights = new Float32Array(ids.length);
      ids.set(upload.edgeIds); weights.set(upload.edgeWeights);
      const allocated = [];
      try {
        gl.activeTexture(gl.TEXTURE0);
        allocated.push(texture(gl.R32UI, upload.width, upload.height, gl.RED_INTEGER, gl.UNSIGNED_INT, upload.codes));
        allocated.push(texture(gl.R32UI, shape.width, shape.height, gl.RED_INTEGER, gl.UNSIGNED_INT, ids));
        allocated.push(texture(gl.R32F, shape.width, shape.height, gl.RED, gl.FLOAT, weights));
        const resource = { textures: allocated, neighbors, edgeWidth: shape.width, bytes,
          originX: tile.originX || 0, originY: tile.originY || 0, width: tile.width, height: tile.height };
        tileUploads++;
        return resource;
      } catch (error) {
        for (const handle of allocated) removeTexture(handle);
        throw error;
      }
    }
    function uploadTiles(plans) {
      for (const plan of plans) if (!plan.existing) resident.set(plan.token, uploadTile(plan));
    }
    function setTiles(tiles) {
      cancelPendingFrame();
      const plans = planTiles(tiles);
      checkTileBudget(plans);
      releaseReplacedTiles(plans);
      uploadTiles(plans);
    }
    function setFrame({ tiles, palette, revision }) {
      assertAvailable();
      cancelPendingFrame();
      if (!(palette instanceof Uint8Array) || palette.length % 4 || palette.length < 4) {
        throw new TypeError("Palette must contain packed RGBA bytes.");
      }
      const startedAt = performance.now();
      const shape = dimensions(palette.length / 4);
      // Preflight and upload consume the same private plan. In particular,
      // compressed CPU tiles and their gutters are materialized only once.
      const plans = planTiles(tiles);
      checkTileBudget(plans, shape.width * shape.height * 4);
      const plannedAt = performance.now();
      // The complete candidate has passed validation and the shared cap. Free
      // replaced tiles before checking/uploading its palette: a larger palette
      // can fit a smaller frame even when it cannot coexist with the old tiles.
      releaseReplacedTiles(plans);
      setPalette(palette, revision);
      const paletteAt = performance.now();
      uploadTiles(plans);
      return { planningMs: plannedAt - startedAt, paletteUploadMs: paletteAt - plannedAt,
        tileBindingMs: performance.now() - paletteAt };
    }
    async function prepareFrame({ tiles, palette, signal, isCurrent = () => true, onProgress = () => {},
      yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) }) {
      assertAvailable();
      if (!(palette instanceof Uint8Array) || palette.length < 4 || palette.length % 4) throw new TypeError("Palette must contain packed RGBA bytes.");
      if (new Set(tiles).size !== tiles.length) throw new TypeError("Duplicate ID raster tiles.");
      cancelPendingFrame();
      const job = { tiles: new Map(), created: new Set(), bytes: 0, signal, onProgress, finished: false, ready: false };
      const stats = { planningMs: 0, uploadMs: 0, maxTaskMs: 0, yieldCount: 0, uploadedTiles: 0 };
      job.onAbort = () => cancelPendingFrame(job);
      pendingFrame = job;
      signal?.addEventListener("abort", job.onAbort, { once: true });
      const check = () => {
        assertAvailable();
        if (signal?.aborted || job.finished || pendingFrame !== job || !isCurrent()) throw new DOMException("Stale political GPU candidate", "AbortError");
      };
      try {
        const nextPaletteShape = dimensions(palette.length / 4);
        const paletteReservation = Math.max(paletteBytes, nextPaletteShape.width * nextPaletteShape.height * 4);
        for (const tile of tiles) {
          // One bounded tile per real host task. Never keep padded CPU arrays
          // for a whole frame or make pending textures visible to drawLayer.
          await yieldTask(); stats.yieldCount++; check();
          const startedAt = performance.now();
          const plan = planTile(tile, tiles);
          const plannedAt = performance.now();
          stats.planningMs += plannedAt - startedAt;
          const extra = plan.existing ? 0 : plan.bytes;
          const oldTileBytes = [...resident.values()].reduce((sum, item) => sum + item.bytes, 0);
          if (paletteReservation + oldTileBytes + job.bytes + extra + reservedTextureBytes() > maxTextureBytes) {
            preparedFrameBudgetRejects++;
            return null;
          }
          const resource = uploadTile(plan);
          if (!plan.existing) { job.created.add(resource); job.bytes += resource.bytes; preparedFrameUploads++; stats.uploadedTiles++; }
          job.tiles.set(plan.token, resource);
          onProgress();
          stats.uploadMs += performance.now() - plannedAt;
          stats.maxTaskMs = Math.max(stats.maxTaskMs, performance.now() - startedAt);
        }
        check(); job.ready = true;
        return {
          stats,
          cancel: () => cancelPendingFrame(job),
          commit({ palette: currentPalette, revision }) {
            check();
            if (!job.ready) throw new Error("Political GPU candidate is not ready.");
            const start = performance.now();
            // Palette edits during preparation are resolved by the caller at
            // this final synchronous boundary; no candidate recolors old tiles.
            setPalette(currentPalette, revision);
            const paletteAt = performance.now();
            const kept = new Set(job.tiles.values());
            for (const resource of resident.values()) if (!kept.has(resource)) for (const handle of resource.textures) removeTexture(handle);
            resident.clear();
            for (const [token, resource] of job.tiles) resident.set(token, resource);
            job.finished = true; signal?.removeEventListener("abort", job.onAbort);
            job.created.clear(); job.tiles.clear(); job.bytes = 0; pendingFrame = null;
            preparedFrameCommits++;
            onProgress();
            return { planningMs: 0, paletteUploadMs: paletteAt - start, tileBindingMs: performance.now() - paletteAt };
          },
        };
      } finally { if (!job.ready) cancelPendingFrame(job); }
    }
    function canSetFrame({ tiles, palette }) {
      const shape = dimensions(palette.length / 4);
      let bytes = shape.width * shape.height * 4 + reservedTextureBytes();
      for (const tile of tiles) {
        const x = tile.originX || 0, y = tile.originY || 0;
        const neighbors = sharedGl ? tiles.filter(other => other !== tile
          && (other.originX || 0) <= x + tile.width && (other.originX || 0) + other.width >= x
          && (other.originY || 0) <= y + tile.height && (other.originY || 0) + other.height >= y) : [];
        const existing = resident.get(tileTokens.get(tile));
        const neighborTokens = neighbors.map(value => tileTokens.get(value));
        if (existing && existing.neighbors.length === neighborTokens.length
          && existing.neighbors.every((value, index) => value === neighborTokens[index])) bytes += existing.bytes;
        else {
          const upload = sharedGl ? paddedTile(tile, neighbors) : tile;
          const edge = dimensions(upload.edgeIds.length);
          bytes += upload.codes.byteLength + edge.width * edge.height * 8;
        }
        if (bytes > maxTextureBytes) return false;
      }
      return true;
    }
    function createOverview({ tiles, palette, revision }) {
      assertAvailable();
      let candidate = null;
      try {
        candidate = createPoliticalIdRasterGpu({ gl, maxTextureBytes,
          getReservedTextureBytes: () => primaryTextureBytes() + getReservedTextureBytes()
            + (overview && overview !== candidate ? overview.getStats().gpuTextureBytes : 0) });
        candidate.setFrame({ tiles, palette, revision });
        overview?.dispose();
        overview = candidate;
        return candidate;
      } catch (error) {
        candidate?.dispose();
        if (error instanceof RangeError) return null;
        throw error;
      }
    }
    function drawLayer({ width, height, transform = {} } = {}) {
      assertAvailable();
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
        || width > limit || height > limit || !paletteTexture) throw new RangeError("Invalid ID raster frame.");
      const matrix = gpuAffineMatrix(transform);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniform2f(uniforms.viewportSize, width, height);
      gl.uniformMatrix3fv(uniforms.transform, false, matrix);
      gl.uniform1i(uniforms.smoothColors, sharedGl ? 1 : 0);
      gl.uniform1i(uniforms.paletteWidth, paletteWidth);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
      for (const resource of resident.values()) {
        for (let unit = 0; unit < resource.textures.length; unit++) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, resource.textures[unit]);
        }
        gl.uniform2f(uniforms.origin, resource.originX, resource.originY);
        gl.uniform2f(uniforms.extent, resource.width, resource.height);
        gl.uniform1i(uniforms.edgeWidth, resource.edgeWidth);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      draws++;
      return true;
    }
    function draw({ width, height, originX = 0, originY = 0, context = null } = {}) {
      if (sharedGl) throw new Error("Use drawLayer for a shared GPU context.");
      assertAvailable();
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
        || width > limit || height > limit || !paletteTexture) throw new RangeError("Invalid ID raster frame.");
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawLayer({ width, height, transform: { e: -originX, f: -originY } });
      if (context) context.drawImage(canvas, 0, 0);
      return true;
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
      canvas, setPalette, setTiles, setFrame, prepareFrame, canSetFrame, createOverview, draw, drawLayer, readPixelsForValidation, dispose,
      isAvailable: () => !disposed && !lost && !gl.isContextLost(),
      getStats: () => ({
        tileUploads, paletteUploads, draws, residentTiles: resident.size, contextLost: lost,
        gpuTextureBytes: primaryTextureBytes() + (overview?.getStats().gpuTextureBytes || 0),
        overviewTextureBytes: overview?.getStats().gpuTextureBytes || 0,
        pendingTextureBytes: pendingTextureBytes(), pendingFrameReady: !!pendingFrame?.ready,
        preparedFrameUploads, preparedFrameCommits, preparedFrameCancellations, preparedFrameBudgetRejects,
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

// Include adjacent tile pixels in the color interpolation footprint. Sparse
// spans from neighbors need new local offsets; never interpolate their IDs.
function paddedTile(tile, neighbors) {
  const width = tile.width + 2, height = tile.height + 2;
  const codes = new Uint32Array(width * height);
  const ids = [], weights = [], spans = new Map();
  const originX = tile.originX || 0, originY = tile.originY || 0;
  {
    const interiorCodes = tile.codes;
    for (let y = 0; y < tile.height; y++) codes.set(interiorCodes.subarray(y * tile.width, (y + 1) * tile.width), (y + 1) * width + 1);
  }
  // Code access can materialize a compressed CPU tile and compact another one.
  // Finish each neighbor before reading the next, rather than alternating top
  // and bottom payloads for every gutter pixel under a tight cache budget.
  const owners = new Uint32Array(2 * width + 2 * (height - 2));
  for (let index = 0; index < neighbors.length; index++) {
    const neighbor = neighbors[index], nx = neighbor.originX || 0, ny = neighbor.originY || 0;
    const left = Math.max(0, nx - originX + 1), right = Math.min(width, nx + neighbor.width - originX + 1);
    const top = Math.max(0, ny - originY + 1), bottom = Math.min(height, ny + neighbor.height - originY + 1);
    if (left >= right || top >= bottom) continue;
    let neighborCodes;
    function copy(x, y, perimeterIndex) {
      if (owners[perimeterIndex]) return;
      neighborCodes ||= neighbor.codes;
      const pixel = (originY + y - 1 - ny) * neighbor.width + originX + x - 1 - nx;
      codes[y * width + x] = neighborCodes[pixel];
      // A transparent first neighbor still owns this pixel: later overlapping
      // neighbors must not replace it, matching the original find() semantics.
      owners[perimeterIndex] = index + 1;
    }
    if (top === 0) for (let x = left; x < right; x++) copy(x, 0, x * 2);
    if (bottom === height) for (let x = left; x < right; x++) copy(x, height - 1, x * 2 + 1);
    if (left === 0) for (let y = Math.max(1, top); y < Math.min(height - 1, bottom); y++) copy(0, y, 2 * width + (y - 1) * 2);
    if (right === width) for (let y = Math.max(1, top); y < Math.min(height - 1, bottom); y++) copy(width - 1, y, 2 * width + (y - 1) * 2 + 1);
  }
  // Serialize spans in the original perimeter order, preserving local offsets
  // and Float32 contributor bytes as well as resolved colors.
  for (let at = 0; at < owners.length; at++) {
    if (!owners[at]) continue;
    const neighbor = neighbors[owners[at] - 1];
    const x = at < 2 * width ? Math.floor(at / 2) : at % 2 === 0 ? 0 : width - 1;
    const y = at < 2 * width ? at % 2 === 0 ? 0 : height - 1 : Math.floor((at - 2 * width) / 2) + 1;
    let code = codes[y * width + x];
    if (code & 0x80000000) {
      const offset = code & 0x7fffffff;
      let mapped = spans.get(neighbor);
      if (!mapped) { mapped = new Map(); spans.set(neighbor, mapped); }
      if (!mapped.has(offset)) {
        const count = neighbor.edgeIds[offset];
        if (!count || offset + count >= neighbor.edgeIds.length) throw new RangeError("Invalid neighboring edge span.");
        mapped.set(offset, tile.edgeIds.length + ids.length);
        for (let i = 0; i <= count; i++) { ids.push(neighbor.edgeIds[offset + i]); weights.push(neighbor.edgeWeights[offset + i]); }
      }
      code = (0x80000000 | mapped.get(offset)) >>> 0;
    }
    codes[y * width + x] = code;
  }
  const edgeIds = new Uint32Array(tile.edgeIds.length + ids.length), edgeWeights = new Float32Array(edgeIds.length);
  edgeIds.set(tile.edgeIds); edgeIds.set(ids, tile.edgeIds.length);
  edgeWeights.set(tile.edgeWeights); edgeWeights.set(weights, tile.edgeWeights.length);
  return { width, height, codes, edgeIds, edgeWeights };
}
