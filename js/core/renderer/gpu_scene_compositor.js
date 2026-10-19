// Matrices map source pixels to output device pixels, including DPR. Layers
// retain their own revision and camera reference; the caller owns that policy.
const VERTEX = `#version 300 es
in vec2 point;
uniform vec2 viewportSize;
uniform vec2 sourceSize;
uniform mat3 transform;
out vec2 uv;
void main() {
  vec2 p = (transform * vec3(point * sourceSize, 1.0)).xy / viewportSize;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
  uv = point;
}`;
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D surface;
in vec2 uv;
out vec4 color;
void main() { color = texture(surface, uv); }`;

export function gpuAffineMatrix(value = {}) {
  const { a = 1, b = 0, c = 0, d = 1, e = 0, f = 0 } = value;
  if (![a, b, c, d, e, f].every(Number.isFinite)) throw new TypeError("Invalid GPU layer transform.");
  return new Float32Array([a, b, 0, c, d, 0, e, f, 1]);
}

export function createGpuSceneCompositor({ canvas, maxTextureBytes = 256 * 1024 * 1024, onContextLost = () => {} } = {}) {
  if (!Number.isFinite(maxTextureBytes) || maxTextureBytes <= 0) throw new RangeError("Invalid GPU texture budget.");
  const gl = canvas?.getContext("webgl2", {
    alpha: true, antialias: false, premultipliedAlpha: true,
    depth: false, stencil: false, preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error("GPU scene compositor requires WebGL2.");
  const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const textures = new Map(), shaders = [];
  let program, vao, buffer, disposed = false, lost = false;
  let frames = 0, textureUploads = 0, lastFrameMs = 0;
  let preparation = null, preparedPassCount = 0, preparedBytes = 0, maxUploadTaskMs = 0;
  const textureBytes = values => [...values].reduce((sum, value) => sum + (value.width || 0) * (value.height || 0) * 4, 0);
  const privateBytes = () => textureBytes(preparation?.textures.values() || []);
  const available = () => !disposed && !lost && !gl.isContextLost();
  const onLost = (event) => { event.preventDefault(); lost = true; cancelPreparedLayers(); onContextLost(); };
  canvas.addEventListener?.("webglcontextlost", onLost);
  function cancelPreparedLayers() {
    if (!preparation) return;
    const onProgress = preparation.onProgress;
    for (const value of preparation.textures.values()) if (available()) gl.deleteTexture(value.texture);
    preparation.textures.clear();
    preparation = null;
    onProgress();
  }
  const matches = (cached, layer) => cached && cached.canvas === layer.canvas && cached.revision === layer.revision
    && cached.width === layer.canvas?.width && cached.height === layer.canvas?.height;
  function allocateTexture() {
    const texture = gl.createTexture();
    if (!texture) throw new Error("GPU scene texture allocation failed.");
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }
  function uploadTexture(cached, layer) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cached.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, layer.canvas);
    Object.assign(cached, { canvas: layer.canvas, revision: layer.revision, width: layer.canvas.width, height: layer.canvas.height });
    textureUploads++;
  }
  async function prepareLayers({ layers = [], getReservedTextureBytes = () => 0, isCurrent = () => true,
    yieldControl = () => globalThis.scheduler?.yield?.() ?? new Promise(resolve => setTimeout(resolve, 0)), maxPasses = 3,
    onProgress = () => {} } = {}) {
    cancelPreparedLayers();
    const job = { textures: new Map(), ready: false, onProgress };
    preparation = job;
    preparedPassCount = 0; preparedBytes = 0;
    const current = () => preparation === job && available() && isCurrent();
    const passLimit = Number.isSafeInteger(maxPasses) ? Math.max(0, Math.min(3, maxPasses)) : 3;
    const priority = name => ({ labels: 0, borders: 1, physicalBase: 2 })[name] ?? 3;
    const candidates = layers.filter(layer => layer.canvas && !layer.retained && !layer.draw && !matches(textures.get(layer.name), layer))
      .map(layer => ({ ...layer, width: layer.canvas.width, height: layer.canvas.height }))
      .sort((a, b) => priority(a.name) - priority(b.name) || b.width * b.height - a.width * a.height);
    try {
      const names = new Set();
      for (const layer of candidates) {
        if (!layer.name || names.has(layer.name)) throw new TypeError("GPU scene layers require unique names.");
        names.add(layer.name);
        if (typeof layer.revision !== "string" && !(typeof layer.revision === "number" && Number.isFinite(layer.revision))) throw new TypeError("GPU canvas layers require a revision.");
      }
      for (const layer of candidates) {
        if (job.textures.size >= passLimit) break;
        if (!current()) { if (preparation === job) cancelPreparedLayers(); return false; }
        // Even the first upload belongs to a fresh host task after pass painting.
        await yieldControl();
        if (!current() || layer.width !== layer.canvas.width || layer.height !== layer.canvas.height) {
          if (preparation === job) cancelPreparedLayers(); return false;
        }
        if (![layer.width, layer.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= limit)) throw new RangeError("Invalid GPU canvas layer.");
        const reserved = getReservedTextureBytes();
        if (!Number.isFinite(reserved) || reserved < 0) throw new RangeError("Invalid reserved texture budget.");
        const bytes = layer.width * layer.height * 4;
        if (textureBytes(textures.values()) + privateBytes() + reserved + bytes > maxTextureBytes) continue;
        const started = performance.now();
        const cached = { texture: allocateTexture(), width: layer.width, height: layer.height };
        job.textures.set(layer.name, cached);
        uploadTexture(cached, layer);
        preparedPassCount++; preparedBytes += bytes;
        maxUploadTaskMs = Math.max(maxUploadTaskMs, performance.now() - started);
        onProgress();
      }
      if (!current()) { if (preparation === job) cancelPreparedLayers(); return false; }
      job.ready = true;
      return true;
    } catch (error) {
      if (preparation === job) cancelPreparedLayers();
      throw error;
    }
  }
  function dispose() {
    if (disposed) return;
    cancelPreparedLayers();
    canvas.removeEventListener?.("webglcontextlost", onLost);
    if (available()) {
      for (const value of textures.values()) gl.deleteTexture(value.texture);
      for (const shader of shaders) gl.deleteShader(shader);
      if (buffer) gl.deleteBuffer(buffer);
      if (vao) gl.deleteVertexArray(vao);
      if (program) gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    disposed = true;
    textures.clear();
  }
  function releaseRetainedLayers(names) {
    for (const name of names) {
      const cached = textures.get(name);
      if (!cached?.pinned) continue;
      if (available()) gl.deleteTexture(cached.texture);
      textures.delete(name);
    }
  }
  try {
    program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]]) {
      const shader = gl.createShader(type);
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "GPU scene shader failed.");
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    const point = gl.getAttribLocation(program, "point");
    gl.enableVertexAttribArray(point);
    gl.vertexAttribPointer(point, 2, gl.FLOAT, false, 0, 0);
    const uniforms = Object.fromEntries(["viewportSize", "sourceSize", "transform", "surface"].map(name => [name, gl.getUniformLocation(program, name)]));

    function render({ width, height, layers = [], reservedTextureBytes = 0, preserveLayers = false } = {}) {
      if (!available()) throw new Error("GPU scene compositor is unavailable.");
      if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= limit)) throw new RangeError("Invalid GPU scene size.");
      if (!Number.isFinite(reservedTextureBytes) || reservedTextureBytes < 0) throw new RangeError("Invalid reserved texture budget.");
      const names = new Set();
      let bytes = reservedTextureBytes;
      // Validate the complete frame before replacing the visible output.
      for (const layer of layers) {
        if (!layer.name || names.has(layer.name)) throw new TypeError("GPU scene layers require unique names.");
        names.add(layer.name);
        gpuAffineMatrix(layer.transform);
        if (layer.clip && (![layer.clip.x, layer.clip.y, layer.clip.width, layer.clip.height].every(Number.isFinite)
          || layer.clip.width < 0 || layer.clip.height < 0)) throw new RangeError("Invalid GPU layer clip.");
        if (typeof layer.draw === "function") continue;
        if (layer.retained === true) {
          const cached = textures.get(layer.name);
          if (!cached || cached.revision !== layer.revision) throw new Error(`GPU retained layer is unavailable: ${layer.name}`);
          bytes += cached.width * cached.height * 4;
          continue;
        }
        if (typeof layer.revision !== "string" && !(typeof layer.revision === "number" && Number.isFinite(layer.revision))) throw new TypeError("GPU canvas layers require a revision.");
        if (!layer.canvas || ![layer.canvas.width, layer.canvas.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= limit)) throw new RangeError("Invalid GPU canvas layer.");
        bytes += layer.canvas.width * layer.canvas.height * 4;
      }
      for (const [name, cached] of textures) {
        if ((cached.pinned || preserveLayers) && !names.has(name)) bytes += cached.width * cached.height * 4;
      }
      const prepared = preparation?.ready ? preparation.textures : new Map();
      for (const [name, cached] of preparation?.textures || []) {
        if (!layers.some(layer => !layer.retained && layer.name === name && prepared.has(name) && matches(cached, layer))) {
          bytes += cached.width * cached.height * 4;
        }
      }
      if (bytes > maxTextureBytes) throw new RangeError("GPU scene texture budget exceeded.");
      const start = performance.now();
      for (const layer of layers) {
        const cached = prepared.get(layer.name);
        if (layer.retained || !matches(cached, layer)) continue;
        const old = textures.get(layer.name);
        if (old) gl.deleteTexture(old.texture);
        textures.set(layer.name, cached);
        prepared.delete(layer.name);
      }
      for (const [name, value] of textures) {
        if (value.pinned || preserveLayers) continue;
        if (layers.some(layer => layer.name === name && !layer.draw)) continue;
        gl.deleteTexture(value.texture);
        textures.delete(name);
      }
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      for (const layer of layers) {
        // A direct layer can use a different shader/VAO/texture unit. Rebind all
        // scene state for every layer; preserve premultiplied source-over order.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.colorMask(true, true, true, true);
        if (layer.clip) {
          const x = Math.max(0, Math.floor(layer.clip.x)), y = Math.max(0, Math.floor(layer.clip.y));
          const right = Math.min(width, Math.ceil(layer.clip.x + layer.clip.width));
          const bottom = Math.min(height, Math.ceil(layer.clip.y + layer.clip.height));
          gl.enable(gl.SCISSOR_TEST);
          gl.scissor(x, height - bottom, Math.max(0, right - x), Math.max(0, bottom - y));
        } else gl.disable(gl.SCISSOR_TEST);
        if (typeof layer.draw === "function") {
          if (layer.draw({ gl, width, height, transform: layer.transform }) === false) throw new Error(`GPU direct layer failed: ${layer.name}`);
          continue;
        }
        gl.useProgram(program);
        gl.bindVertexArray(vao);
        gl.activeTexture(gl.TEXTURE0);
        const source = layer.canvas;
        let cached = textures.get(layer.name);
        if (!cached) {
          cached = { texture: gl.createTexture() };
          textures.set(layer.name, cached);
          gl.bindTexture(gl.TEXTURE_2D, cached.texture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        } else gl.bindTexture(gl.TEXTURE_2D, cached.texture);
        if (!layer.retained && (cached.canvas !== source || cached.revision !== layer.revision || cached.width !== source.width || cached.height !== source.height)) {
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
          Object.assign(cached, { canvas: source, revision: layer.revision, width: source.width, height: source.height });
          textureUploads++;
        }
        gl.uniform1i(uniforms.surface, 0);
        gl.uniform2f(uniforms.viewportSize, width, height);
        gl.uniform2f(uniforms.sourceSize, cached.width, cached.height);
        gl.uniformMatrix3fv(uniforms.transform, false, gpuAffineMatrix(layer.transform));
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.disable(gl.SCISSOR_TEST);
      frames++;
      lastFrameMs = performance.now() - start;
      return true;
    }
    function captureRetainedLayers(layers, { reservedTextureBytes = 0, maxBytes = 2 * 1024 * 1024, maxEdge = 256 } = {}) {
      if (!available()) throw new Error("GPU scene compositor is unavailable.");
      const sources = layers.filter(layer => layer.canvas);
      const sourceBytes = sources.reduce((sum, layer) => sum + layer.canvas.width * layer.canvas.height * 4, 0);
      const reduction = Math.max(1, Math.sqrt(sourceBytes / maxBytes), ...sources.map(layer => Math.max(layer.canvas.width, layer.canvas.height) / maxEdge));
      const plans = sources.map(layer => ({ layer, name: `overview:${layer.name}`,
        width: Math.max(1, Math.floor(layer.canvas.width / reduction)), height: Math.max(1, Math.floor(layer.canvas.height / reduction)) }));
      const keys = new Set(plans.map(plan => plan.name));
      let bytes = reservedTextureBytes + privateBytes() + plans.reduce((sum, plan) => sum + plan.width * plan.height * 4, 0);
      for (const [name, cached] of textures) if (!keys.has(name)) bytes += cached.width * cached.height * 4;
      if (bytes > maxTextureBytes) return null;
      const captured = [];
      try {
        for (const plan of plans) {
          const small = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(plan.width, plan.height) : canvas.ownerDocument.createElement("canvas");
          small.width = plan.width; small.height = plan.height;
          small.getContext("2d").drawImage(plan.layer.canvas, 0, 0, plan.width, plan.height);
          const handle = gl.createTexture();
          captured.push({ ...plan, texture: handle });
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, handle);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, small);
          textureUploads++;
        }
      } catch (error) {
        for (const value of captured) gl.deleteTexture(value.texture);
        throw error;
      }
      releaseRetainedLayers(keys);
      for (const value of captured) textures.set(value.name, { texture: value.texture, width: value.width, height: value.height,
        revision: value.layer.revision, pinned: true });
      return captured.map(value => ({ name: value.name, sourceName: value.layer.name, revision: value.layer.revision,
        scaleX: value.layer.canvas.width / value.width, scaleY: value.layer.canvas.height / value.height }));
    }
    return { canvas, gl, render, prepareLayers, cancelPreparedLayers, captureRetainedLayers, releaseRetainedLayers, dispose, isAvailable: available, getStats: () => ({
      frames, textureUploads, lastFrameMs, residentLayers: textures.size, contextLost: lost,
      gpuTextureBytes: textureBytes(textures.values()) + privateBytes(),
      privateTextureBytes: privateBytes(), preparedPassCount, preparedBytes, maxUploadTaskMs,
      outputSurfaceBytesEstimate: canvas.width * canvas.height * 4,
      accounting: "explicit-texture-and-surface-estimates-not-driver-vram",
    }) };
  } catch (error) { dispose(); throw error; }
}
