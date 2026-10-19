import { createGpuSceneCompositor } from "./gpu_scene_compositor.js";
import { createPoliticalIdRasterGpu } from "./political_id_raster_gpu.js";

const POLITICAL_TEXTURE_LIMIT = 80 * 1024 * 1024;
// The original 80 MiB pool covered political textures alone. Direct scene
// composition also retains the other passes as textures, so account those
// together under a separate finite cap without enlarging the political pool.
const SCENE_TEXTURE_LIMIT = 160 * 1024 * 1024;
const validTransform = value => !!value && [value.x, value.y, value.k].every(Number.isFinite) && value.k > 0;
const validLayout = value => !!value && [value.offsetX ?? 0, value.offsetY ?? 0].every(Number.isFinite);

export function createTnoRasterSceneOwner({
  surface, helpers: h, resourceBudget = null, onContextLost = () => {},
  createCompositor = createGpuSceneCompositor, createGpu = createPoliticalIdRasterGpu,
} = {}) {
  const resourceOwner = Symbol("tno-raster-scene");
  const revisions = new Map();
  let canvas = null, compositor = null, mapCanvas = null, politicalGpu = null;
  let active = false, disposed = false, previousVisibility = null;
  let fallbackReason = "not-presented", totalFrameMs = 0, view = null;
  let published = null, overview = null, publications = 0, retainedFrames = 0, usingOverview = false;
  let colorBaselineFrame = null;
  let lastPresentationState = "unavailable";
  let publicationPreparation = null, preparationError = "";

  function cancelPublicationPreparation() {
    publicationPreparation = null;
    compositor?.cancelPreparedLayers?.();
    account();
  }
  function snapshotPublication(transform) {
    const names = h.getActivePassNames();
    if (!validTransform(transform) || !Array.isArray(names)) return null;
    const passes = names.filter(name => name !== "political").map(name => {
      const source = h.getPassCanvas(name), reference = h.getPassReferenceTransform(name), layout = h.getPassLayout(name);
      return { name, canvas: source, width: source?.width, height: source?.height, revision: revisions.get(name) || 0,
        reference: { ...reference }, layout: { ...layout } };
    });
    return { identity: h.getPreparationIdentity?.() ?? h.getDirectFrame(), sceneIdentity: h.getSceneIdentity?.(),
      map: surface.getMapCanvas(), compositor, transform: { ...transform }, dpr: h.getDpr?.(),
      width: mapCanvas?.width, height: mapCanvas?.height, names: [...names], passes };
  }
  function samePublication(a, b, { identity = true } = {}) {
    if (!a || !b || a.map !== b.map || a.compositor !== b.compositor || a.sceneIdentity !== b.sceneIdentity
      || (identity && a.identity !== b.identity) || a.dpr !== b.dpr || a.width !== b.width || a.height !== b.height
      || ["x", "y", "k"].some(key => a.transform[key] !== b.transform[key])
      || a.names.length !== b.names.length || a.names.some((name, i) => name !== b.names[i])) return false;
    return a.passes.every((pass, i) => {
      const next = b.passes[i];
      return pass.canvas === next.canvas && pass.width === next.width && pass.height === next.height && pass.revision === next.revision
        && ["x", "y", "k"].every(key => pass.reference[key] === next.reference[key])
        && JSON.stringify(pass.layout) === JSON.stringify(next.layout);
    });
  }
  function preparationCurrent(job, options) {
    return !disposed && compositor?.isAvailable() && publicationPreparation === job
      && samePublication(job.snapshot, snapshotPublication(h.getCurrentTransform?.() || job.snapshot.transform), options);
  }
  function preparePublication(transform) {
    if (!compositor?.prepareLayers || disposed) return true;
    const existing = publicationPreparation;
    if (existing && samePublication(existing.snapshot, snapshotPublication(transform))) return existing.status !== "pending";
    cancelPublicationPreparation();
    // Coverage refresh can commit passes. Complete it before taking any snapshot.
    try {
      if (h.ensurePassCoverage?.(transform) === false) return true;
    } catch (error) {
      preparationError = error.message;
      return true; // present() retains its existing coverage failure handling.
    }
    const snapshot = snapshotPublication(transform);
    if (!snapshot?.identity) return true;
    const job = { snapshot, status: "pending" };
    publicationPreparation = job;
    preparationError = "";
    compositor.prepareLayers({ layers: snapshot.passes.map(pass => ({ name: pass.name, canvas: pass.canvas, revision: pass.revision })),
      getReservedTextureBytes: () => politicalGpu?.getStats().gpuTextureBytes || 0,
      isCurrent: () => preparationCurrent(job), yieldControl: h.yieldControl, onProgress: account,
    }).then(ready => {
      if (publicationPreparation !== job) return;
      if (!ready || !preparationCurrent(job)) cancelPublicationPreparation();
      else job.status = "ready";
      account();
      h.requestRender?.("scene-layers-prepared");
    }).catch(error => {
      if (publicationPreparation !== job) return;
      // Keep the attempted identity: this scene gets one ordinary synchronous
      // upload attempt, never an unbounded prepare/retry cycle.
      preparationError = error.message;
      job.status = "failed";
      account();
      h.requestRender?.("scene-layers-preparation-failed");
    });
    return false;
  }

  function account() {
    const stats = compositor?.getStats();
    resourceBudget?.update(resourceOwner, {
      gpuTextures: stats?.gpuTextureBytes || 0,
      workerSurfaces: stats?.outputSurfaceBytesEstimate || 0,
    });
  }
  function hide(reason) {
    if (canvas) canvas.style.display = "none";
    if (mapCanvas && previousVisibility !== null) mapCanvas.style.visibility = previousVisibility;
    previousVisibility = null;
    active = false;
    fallbackReason = reason;
    return false;
  }
  function contextLost() {
    cancelPublicationPreparation();
    hide("context-lost");
    onContextLost();
  }
  function releaseSurface() {
    cancelPublicationPreparation();
    hide("surface-replaced");
    compositor?.dispose();
    compositor = null;
    politicalGpu = null;
    published = null;
    overview = null;
    colorBaselineFrame = null;
    canvas?.remove();
    canvas = null;
    mapCanvas = null;
    resourceBudget?.release(resourceOwner);
  }
  function ensureSurface() {
    if (disposed) throw new Error("TNO raster scene is disposed.");
    const nextMapCanvas = surface.getMapCanvas();
    if (!nextMapCanvas?.parentNode || !nextMapCanvas.ownerDocument) throw new Error("TNO raster scene surface is unavailable.");
    if (mapCanvas === nextMapCanvas && compositor?.isAvailable()) return compositor;
    if (compositor || canvas) releaseSurface();
    mapCanvas = nextMapCanvas;
    canvas = mapCanvas.ownerDocument.createElement("canvas");
    canvas.id = "map-scene-canvas";
    canvas.setAttribute("aria-hidden", "true");
    const computed = mapCanvas.ownerDocument.defaultView?.getComputedStyle?.(mapCanvas);
    Object.assign(canvas.style, {
      position: "absolute", inset: "0", width: "100%", height: "100%",
      pointerEvents: "none", zIndex: mapCanvas.style.zIndex || computed?.zIndex || "auto", display: "none",
    });
    canvas.width = mapCanvas.width;
    canvas.height = mapCanvas.height;
    mapCanvas.parentNode.insertBefore(canvas, mapCanvas.nextSibling);
    try {
      compositor = createCompositor({ canvas, maxTextureBytes: SCENE_TEXTURE_LIMIT, onContextLost: contextLost });
      account();
      return compositor;
    } catch (error) {
      canvas.remove();
      canvas = null;
      throw error;
    }
  }
  function ensureGpu(options = {}) {
    try {
      const scene = ensureSurface();
      politicalGpu = createGpu({ ...options, canvas, gl: scene.gl, maxTextureBytes: POLITICAL_TEXTURE_LIMIT,
        // Only nonpolitical textures come from the compositor, so this does not
        // recursively count the political owner's primary/overview/candidate.
        getReservedTextureBytes: () => Math.max(0, (scene.getStats().gpuTextureBytes || 0)
          - (SCENE_TEXTURE_LIMIT - POLITICAL_TEXTURE_LIMIT)),
      });
      return politicalGpu;
    } catch (error) {
      hide(`gpu-unavailable: ${error.message}`);
      throw error;
    }
  }
  function notePassCommit(name) {
    cancelPublicationPreparation();
    revisions.set(name, (revisions.get(name) || 0) + 1);
  }
  function covers(frame, passes, transform, width, height, dpr) {
    if (!frame?.plan || !validTransform(frame.transform) || frame.dpr !== dpr) return false;
    const ratio = transform.k / frame.transform.k;
    const x = (transform.x - frame.transform.x * ratio) * dpr;
    const y = (transform.y - frame.transform.y * ratio) * dpr;
    const left = (frame.plan.outputX - (frame.layout.offsetX || 0) * dpr) * ratio + x;
    const top = (frame.plan.outputY - (frame.layout.offsetY || 0) * dpr) * ratio + y;
    if (left > 1e-6 || top > 1e-6 || left + frame.plan.outputWidth * ratio < width - 1e-6
      || top + frame.plan.outputHeight * ratio < height - 1e-6) return false;
    for (const pass of passes?.values() || []) {
      const scale = transform.k / pass.reference.k;
      const dx = (transform.x - (pass.reference.x + (pass.layout.offsetX || 0)) * scale) * dpr;
      const dy = (transform.y - (pass.reference.y + (pass.layout.offsetY || 0)) * scale) * dpr;
      if (dx > 1e-6 || dy > 1e-6 || dx + pass.width * scale < width - 1e-6 || dy + pass.height * scale < height - 1e-6) return false;
    }
    return true;
  }
  function present(transform, { refresh = true } = {}) {
    if (publicationPreparation && !preparationCurrent(publicationPreparation, { identity: !refresh })) cancelPublicationPreparation();
    if (disposed) return hide("disposed");
    if (!compositor?.isAvailable() || surface.getMapCanvas() !== mapCanvas) return hide("surface-unavailable");
    let frame = h.getDirectFrame();
    if (!frame || frame.complete === false || frame.gpu !== politicalGpu || !frame.gpu?.isAvailable()) return hide("direct-frame-unavailable");
    if (!validTransform(transform) || !validTransform(frame.transform) || !validLayout(frame.layout)
      || !Number.isFinite(frame.dpr) || frame.dpr <= 0) return hide("invalid-direct-frame");
    const dpr = h.getDpr?.() ?? frame.dpr;
    if (dpr !== frame.dpr) return hide("direct-frame-dpr-mismatch");
    const width = mapCanvas.width, height = mapCanvas.height;
    // Match the editor's logical surface, not the bordered container's content
    // box. Percentage sizing would shrink only the GPU layer by the borders.
    canvas.style.width = mapCanvas.style.width || `${width / dpr}px`;
    canvas.style.height = mapCanvas.style.height || `${height / dpr}px`;
    const overviewFrame = h.getOverviewFrame?.();
    if (overview && overview.frame !== overviewFrame) {
      compositor.releaseRetainedLayers?.([...overview.passes.values()].map(pass => pass.textureName));
      overview = null;
    }
    const retainPrimary = published?.frame === frame && (!refresh || frame.presentationState === "retained");
    usingOverview = !!overview && !covers(frame, retainPrimary ? published.passes : null, transform, width, height, dpr)
      && covers(overview.frame, overview.passes, transform, width, height, dpr);
    if (usingOverview) frame = overview.frame;
    const plan = frame.plan;
    if (!plan || ![plan.scale, plan.originX, plan.originY, plan.width, plan.height,
      plan.outputX, plan.outputY, plan.outputWidth, plan.outputHeight].every(Number.isFinite)
      || plan.scale <= 0 || plan.width <= 0 || plan.height <= 0 || plan.outputWidth <= 0 || plan.outputHeight <= 0
      || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return hide("invalid-direct-plan");
    const ratio = transform.k / frame.transform.k;
    const dx = transform.x - frame.transform.x * ratio, dy = transform.y - frame.transform.y * ratio;
    const offsetX = frame.layout.offsetX ?? 0, offsetY = frame.layout.offsetY ?? 0;
    const left = (plan.outputX - offsetX * dpr) * ratio + dx * dpr;
    const top = (plan.outputY - offsetY * dpr) * ratio + dy * dpr;
    const right = left + plan.outputWidth * ratio, bottom = top + plan.outputHeight * ratio;
    // A retained frame is useful only while its complete tile rectangle covers
    // the current output. Tiny rounding differences at exact edges are harmless.
    if (left > 1e-6 || top > 1e-6 || right < width - 1e-6 || bottom < height - 1e-6) return hide("direct-frame-coverage");
    // Cache canvases belong to the candidate producer and can change between
    // yielded passes. Navigation only reads the uploaded published textures.
    const retainedScene = usingOverview ? overview : published;
    const retain = usingOverview || retainPrimary;
    // The caller knows the painted footprint (including culling overscan), and
    // can refresh only uncovered passes. Read their canvases/revisions after it
    // returns so a successful refresh is included in this same presentation.
    try {
      const preparedCoverage = publicationPreparation && publicationPreparation.status !== "pending"
        && samePublication(publicationPreparation.snapshot, snapshotPublication(transform), { identity: false });
      if (!retain && !preparedCoverage && h.ensurePassCoverage?.(transform) === false) return hide("pass-coverage");
    } catch (error) {
      return hide(`pass-coverage: ${error.message}`);
    }
    const directTransform = {
      a: plan.scale * ratio, d: plan.scale * ratio,
      e: (plan.outputX - plan.originX * plan.scale - offsetX * dpr) * ratio + dx * dpr,
      f: (plan.outputY - plan.originY * plan.scale - offsetY * dpr) * ratio + dy * dpr,
    };
    const layers = [];
    const names = retain ? retainedScene.names : h.getActivePassNames();
    const passSnapshots = new Map();
    if (!Array.isArray(names) || !names.includes("political")) return hide("political-pass-inactive");
    for (const name of names) {
      if (name === "political") {
        layers.push({ name, draw: output => frame.gpu.drawLayer({ ...output, transform: directTransform }) });
        continue;
      }
      const saved = retain ? retainedScene.passes.get(name) : null;
      const source = saved || h.getPassCanvas(name);
      const reference = saved?.reference || h.getPassReferenceTransform(name);
      const layout = saved?.layout || h.getPassLayout(name);
      if (!source || source.width <= 0 || source.height <= 0 || !validTransform(reference) || !validLayout(layout)) return hide(`pass-unavailable:${name}`);
      const scale = transform.k / reference.k;
      const x = transform.x - reference.x * scale, y = transform.y - reference.y * scale;
      const layerTransform = { a: scale * (saved?.scaleX || 1), d: scale * (saved?.scaleY || 1),
        e: (x - (layout.offsetX ?? 0) * scale) * dpr,
        f: (y - (layout.offsetY ?? 0) * scale) * dpr };
      // A callback can enforce a narrower painted footprint, but even without
      // one a viewport raster must cover every output pixel after navigation.
      if (layerTransform.e > 1e-6 || layerTransform.f > 1e-6
        || layerTransform.e + source.width * scale < width - 1e-6
        || layerTransform.f + source.height * scale < height - 1e-6) return hide("pass-coverage");
      const revision = saved?.revision ?? (revisions.get(name) || 0);
      passSnapshots.set(name, { width: source.width, height: source.height, reference: { ...reference }, layout: { ...layout }, revision });
      layers.push({ name: saved?.textureName || name, ...(retain ? { retained: true } : { canvas: source }), revision,
        transform: layerTransform,
      });
    }
    const start = performance.now();
    try {
      const reservedTextureBytes = politicalGpu.getStats().gpuTextureBytes;
      if (compositor.render({ width, height, layers, reservedTextureBytes, preserveLayers: usingOverview }) === false) throw new Error("compositor rejected frame");
      if (!retain && publicationPreparation) {
        compositor.cancelPreparedLayers?.();
        publicationPreparation = { snapshot: snapshotPublication(transform), status: "consumed" };
      }
      if (colorBaselineFrame !== frame) {
        h.capturePublishedColorBaseline?.({ overview: usingOverview });
        colorBaselineFrame = frame;
      }
      lastPresentationState = retain ? "retained" : "published";
      if (retain) retainedFrames++;
      else {
        if (published?.frame !== frame) publications++;
        published = { frame, names: [...names], passes: passSnapshots };
        if (overviewFrame && overviewFrame.sourceFrame === frame && overview?.frame !== overviewFrame) {
          const captured = compositor.captureRetainedLayers?.(layers, { reservedTextureBytes });
          if (captured) overview = { frame: overviewFrame, names: [...names], passes: new Map(captured.map(layer => [layer.sourceName,
            { ...passSnapshots.get(layer.sourceName), textureName: layer.name, scaleX: layer.scaleX, scaleY: layer.scaleY }])) };
        }
      }
      if (previousVisibility === null) previousVisibility = mapCanvas.style.visibility || "";
      mapCanvas.style.visibility = "hidden";
      canvas.style.display = "block";
      active = true;
      fallbackReason = "";
      view = { x: transform.x, y: transform.y, k: transform.k, dpr, width, height };
      account();
      return true;
    } catch (error) {
      cancelPublicationPreparation();
      account();
      return hide(/budget/i.test(error.message) ? "gpu-budget" : `render-failed: ${error.message}`);
    } finally {
      totalFrameMs += performance.now() - start;
    }
  }
  function clear() {
    cancelPublicationPreparation();
    hide("cleared");
    view = null;
    // Keep the shared GL alive: the raster owner may still own resident tiles.
    account();
  }
  function dispose() {
    if (disposed) return;
    releaseSurface();
    disposed = true;
    revisions.clear();
    fallbackReason = "disposed";
    view = null;
  }
  function getDiagnostics() {
    const stats = compositor?.getStats() || {};
    return {
      active, frames: stats.frames || 0, textureUploads: stats.textureUploads || 0,
      bytes: (stats.gpuTextureBytes || 0) + (stats.outputSurfaceBytesEstimate || 0),
      gpuTextureBytes: stats.gpuTextureBytes || 0, outputSurfaceBytesEstimate: stats.outputSurfaceBytesEstimate || 0,
      lastFrameMs: stats.lastFrameMs || 0, totalFrameMs, fallbackReason, view: view ? { ...view } : null,
      presentationState: active ? lastPresentationState : "unavailable",
      publishedEpoch: published?.frame?.epoch ?? null, publications, retainedFrames,
      usingOverview, overviewReady: !!overview,
      publicationPending: ["pending", "ready"].includes(publicationPreparation?.status), preparationError,
      preparedPassCount: stats.preparedPassCount || 0, preparedBytes: stats.preparedBytes || 0,
      privateTextureBytes: stats.privateTextureBytes || 0, maxUploadTaskMs: stats.maxUploadTaskMs || 0,
    };
  }
  return { ensureGpu, preparePublication, cancelPublicationPreparation, present, notePassCommit, clear, dispose, getDiagnostics, isActive: () => active };
}
