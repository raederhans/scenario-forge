const timerYield = () => new Promise(resolve => setTimeout(resolve, 0));

// The bitmap is only a GPU-consumption probe. No rendered pixels leave this
// kernel; the main thread will adopt its original private viewport canvas.
export function createCanvasGpuSubmissionKernel({
  createGpuCanvas = () => new OffscreenCanvas(1, 1),
  yieldTask = timerYield,
  now = () => performance.now(),
} = {}) {
  let canvas = null, gl = null, active = false, disposed = false;
  function releaseContext() {
    try { gl?.getExtension("WEBGL_lose_context")?.loseContext(); }
    finally {
      try { if (canvas) { canvas.width = 0; canvas.height = 0; } }
      finally { canvas = null; gl = null; }
    }
  }
  async function consume(bitmap, { width, height, isCancelled = () => false } = {}) {
    if (active) { bitmap?.close?.(); throw new Error("Canvas GPU submission kernel is busy."); }
    active = true;
    const startedAt = now();
    const bytes = width * height * 4;
    const stats = { width, height, workerContextInitMs: 0, workerTextureSetupMs: 0,
      workerContextCreationCount: 0, workerContextReuseCount: 0,
      workerUploadMs: 0, workerFenceMs: 0, workerFlushMs: 0,
      workerFenceWaitMs: 0, workerErrorCheckMs: 0, workerCleanupMs: 0, workerTotalMs: 0,
      bitmapBytes: bytes, gpuTextureBytes: bytes };
    let texture = null, fence = null, failed = false;
    function checkCurrent() {
      if (isCancelled()) throw new DOMException("Canvas GPU submission cancelled.", "AbortError");
      if (gl?.isContextLost()) throw new Error("Canvas GPU submission context was lost.");
    }
    try {
      if (disposed) throw new Error("Canvas GPU submission kernel is disposed.");
      if (!bitmap || ![width, height].every(value => Number.isSafeInteger(value) && value > 0)
        || bitmap.width !== width || bitmap.height !== height || !Number.isSafeInteger(bytes)
        || bytes * 3 > 80 * 1024 * 1024) throw new Error("Invalid canvas GPU submission bitmap.");
      checkCurrent();
      if (!gl) {
        const contextStartedAt = now();
        canvas = createGpuCanvas();
        canvas.width = 1; canvas.height = 1;
        gl = canvas.getContext("webgl2", { alpha: true, antialias: false, depth: false, stencil: false });
        stats.workerContextInitMs = now() - contextStartedAt;
        stats.workerContextCreationCount = 1;
        if (!gl) throw new Error("Canvas GPU submission requires Worker WebGL2.");
      } else stats.workerContextReuseCount = 1;
      const textureStartedAt = now();
      texture = gl.createTexture();
      if (!texture) throw new Error("Canvas GPU submission texture allocation failed.");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      stats.workerTextureSetupMs = now() - textureStartedAt;
      let phaseStartedAt = now();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      stats.workerUploadMs = now() - phaseStartedAt;
      phaseStartedAt = now();
      fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      stats.workerFenceMs = now() - phaseStartedAt;
      if (!fence) throw new Error("Canvas GPU submission fence allocation failed.");
      phaseStartedAt = now(); gl.flush(); stats.workerFlushMs = now() - phaseStartedAt;
      phaseStartedAt = now();
      for (;;) {
        await yieldTask();
        checkCurrent();
        const status = gl.clientWaitSync(fence, 0, 0);
        if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) break;
        if (status !== gl.TIMEOUT_EXPIRED) throw new Error("Canvas GPU submission fence wait failed.");
      }
      stats.workerFenceWaitMs = now() - phaseStartedAt;
      checkCurrent();
      phaseStartedAt = now();
      const error = gl.getError();
      stats.workerErrorCheckMs = now() - phaseStartedAt;
      if (error !== gl.NO_ERROR) throw new Error(`Canvas GPU submission upload failed (WebGL error ${error}).`);
      checkCurrent();
      return stats;
    } catch (error) {
      failed = error?.name !== "AbortError";
      throw error;
    } finally {
      const cleanupStartedAt = now();
      try {
        if (gl) {
          if (fence) gl.deleteSync(fence);
          if (texture) gl.deleteTexture(texture);
        }
      } finally {
        // A failed/lost context must not strand every later camera on the
        // native fallback. Healthy cancellation alone keeps the warm context.
        try { if (failed || gl?.isContextLost()) releaseContext(); }
        finally {
          try { bitmap?.close?.(); }
          finally {
            active = false;
            stats.workerCleanupMs = now() - cleanupStartedAt;
            stats.workerTotalMs = now() - startedAt;
          }
        }
      }
    }
  }
  function dispose() {
    if (active) throw new Error("Cannot dispose an active canvas GPU submission kernel.");
    if (disposed) return;
    disposed = true;
    releaseContext();
  }
  return { consume, dispose };
}
