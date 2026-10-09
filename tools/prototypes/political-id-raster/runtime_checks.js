import { loadPoliticalFixture } from "./fixtures.js";
import { getFeatureId } from "../../../js/core/feature_identity.js";
import { applyFeaturePaintState } from "../../../js/core/state/color_state.js";
import { createPoliticalIdRasterWorkerClient } from "../../../js/core/political_id_raster_worker_client.js";
import { createPoliticalIdRasterRuntimeOwner } from "../../../js/core/renderer/political_id_raster_runtime_owner.js";

const CSS_WIDTH = 720;
const CSS_HEIGHT = 480;
const now = () => performance.now();
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const BACKGROUND = "#aadaff";

function buildNativePaths(fixture) {
  const path = d3.geoPath(fixture.projection);
  return new Map(fixture.collection.features.map((feature) => {
    const value = new Path2D();
    path.context(value)(feature);
    return [getFeatureId(feature), value];
  }));
}

function drawNative({ fixture, paths, canvas, context = canvas.getContext("2d", { willReadFrequently: false }), dpr, transform }) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.setTransform(dpr * transform.k, 0, 0, dpr * transform.k,
    dpr * transform.x, dpr * transform.y);
  context.lineWidth = 0.75 / transform.k;
  context.lineJoin = "round";
  context.lineCap = "round";
  for (const feature of fixture.collection.features) {
    const id = getFeatureId(feature);
    const color = fixture.resolveColor(feature, id);
    const path = paths.get(id);
    context.fillStyle = color;
    context.strokeStyle = color;
    context.fill(path);
    if (fixture.strokeCodeForEntry({ feature, id }) !== 0) context.stroke(path);
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  return context;
}

function makeOwner(fixture, dpr, width, height) {
  const state = {
    activeScenarioId: fixture.id,
    dpr,
    zoomTransform: { x: 0, y: 0, k: 1 },
  };
  let colorVersion = 0;
  let colorChangedIds = null;
  const contextCanvas = new OffscreenCanvas(width, height);
  const context = contextCanvas.getContext("2d");
  const client = createPoliticalIdRasterWorkerClient();
  const identity = {
    sceneKey: fixture.id,
    projectionKey: `${fixture.id}:base-720x480`,
    coverageKey: "fixture-order;round-stroke:0.75css",
    version: 1,
    colorVersion,
    colorScope: "fixture-palette",
  };
  const helpers = {
    isEnabled: () => true,
    getFeatures: () => fixture.collection.features,
    getFeatureId,
    getBounds: fixture.getBounds,
    resolveColor: fixture.resolveColor,
    hasStroke: (feature) => fixture.strokeCodeForEntry({ feature }) !== 0,
    getSourceIdentity: () => ({ ...identity, colorVersion }),
    getChangedColorIds: () => colorChangedIds,
    getLayout: () => ({ pixelWidth: width, pixelHeight: height, offsetX: 0, offsetY: 0 }),
  };
  let renderWakeCount = 0;
  return Promise.resolve({
    state,
    contextCanvas,
    client,
    helpers,
    identity,
    getColorVersion: () => colorVersion,
    incrementColorVersion(featureIds = null) {
      colorVersion += 1;
      colorChangedIds = Array.isArray(featureIds) ? [...featureIds] : null;
    },
    renderWakeCount: () => renderWakeCount,
    owner: createPoliticalIdRasterRuntimeOwner({
      state,
      surface: { getProjection: () => fixture.projection, getContext: () => context },
      helpers,
      effects: { requestRender: () => { renderWakeCount += 1; } },
      client,
    }),
  });
}

async function waitForOwnerDraw(ownerBundle, timeoutMs = 120_000) {
  const deadline = now() + timeoutMs;
  let lastResult = null;
  let draws = 0;
  while (now() < deadline) {
    const started = now();
    lastResult = ownerBundle.owner.draw();
    draws += 1;
    const drawMs = now() - started;
    const diagnostics = ownerBundle.owner.getDiagnostics();
    if (diagnostics.failed) throw new Error(`Runtime owner failed: ${diagnostics.failed}`);
    if (lastResult && diagnostics.pending === 0) return { result: lastResult, diagnostics, drawMs, draws };
    await nextFrame();
  }
  throw new Error(`Runtime owner did not finish in ${timeoutMs}ms: ${JSON.stringify(ownerBundle.owner.getDiagnostics())}`);
}

function comparePixels(reference, actual) {
  if (reference.length !== actual.length || reference.length % 4 !== 0) {
    throw new RangeError("Native and raster output dimensions differ.");
  }
  let sumMaxChannelError = 0;
  let pixelsOver32 = 0;
  let channelOver32 = 0;
  let maximumChannelError = 0;
  for (let i = 0; i < reference.length; i += 4) {
    let pixelMax = 0;
    for (let c = 0; c < 4; c += 1) {
      const error = Math.abs(reference[i + c] - actual[i + c]);
      pixelMax = Math.max(pixelMax, error);
      if (error > 32) channelOver32 += 1;
    }
    maximumChannelError = Math.max(maximumChannelError, pixelMax);
    sumMaxChannelError += pixelMax;
    if (pixelMax > 32) pixelsOver32 += 1;
  }
  const pixelCount = reference.length / 4;
  return {
    pixels: pixelCount,
    meanMaxChannelError: sumMaxChannelError / pixelCount,
    maximumChannelError,
    pixelsOver32Ratio: pixelsOver32 / pixelCount,
    channelsOver32Ratio: channelOver32 / reference.length,
  };
}

function readCanvas(canvas) {
  return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
}

function makeFrameCanvases(width, height) {
  return { native: new OffscreenCanvas(width, height), actual: new OffscreenCanvas(width, height) };
}

function drawActualFrame(ownerBundle, canvas, width, height) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, width, height);
  ownerBundle.contextCanvas.getContext("2d").clearRect(0, 0, width, height);
  ownerBundle.owner.draw();
  context.drawImage(ownerBundle.contextCanvas, 0, 0);
  return context.getImageData(0, 0, width, height).data;
}

async function timedOwnerDraw(ownerBundle, width, height) {
  const start = now();
  const settled = await waitForOwnerDraw(ownerBundle);
  const frameCanvas = new OffscreenCanvas(width, height);
  const actual = drawActualFrame(ownerBundle, frameCanvas, width, height);
  const elapsedMs = now() - start;
  frameCanvas.width = frameCanvas.height = 0;
  return { ...settled, elapsedMs, actual };
}

/** Execute browser-only owner/Worker/GPU checks. Call from the prototype page. */
export async function runRuntimeChecks(scenarioId, { dpr = 1 } = {}) {
  if (![1, 2].includes(Number(dpr))) throw new RangeError("Runtime checks support DPR 1 or 2.");
  if (typeof OffscreenCanvas !== "function" || typeof Path2D !== "function") {
    throw new Error("Runtime checks require OffscreenCanvas and Path2D.");
  }
  const pixelRatio = Number(dpr);
  // Build a canonical CSS-pixel fixture. The owner and worker apply DPR/LOD
  // once; supplying an already-DPR-scaled projection would double scale it.
  const fixture = await loadPoliticalFixture(scenarioId, {
    width: CSS_WIDTH, height: CSS_HEIGHT, dpr: 1,
  });
  const width = CSS_WIDTH * pixelRatio;
  const height = CSS_HEIGHT * pixelRatio;
  const pathBuildStarted = now();
  const paths = buildNativePaths(fixture);
  const pathBuildMs = now() - pathBuildStarted;
  const ownerBundle = await makeOwner(fixture, pixelRatio, width, height);
  const report = {
    scenarioId,
    dpr: pixelRatio,
    viewportCss: { width: CSS_WIDTH, height: CSS_HEIGHT },
    viewportPhysical: { width, height },
    fixture: fixture.metadata,
    limitations: [
      "Standalone canonical fixture, not the application startup/chunk compositor.",
      "GPU timings are CPU submission and next-rAF observations, not timer-query GPU execution or display presentation.",
      "Context loss and Worker output are browser/platform dependent; no pass threshold is inferred here.",
      "Earlier 10%-29% measurements used readback-oriented native contexts and are not a valid main-app acceleration baseline; retain those reports and compare only with a new run using this context setup.",
    ],
  };
  try {
    const base = await timedOwnerDraw(ownerBundle, width, height);
    const baseFrame = makeFrameCanvases(width, height);
    const baseNativeContext = baseFrame.native.getContext("2d", { willReadFrequently: false });
    baseNativeContext.setTransform(1, 0, 0, 1, 0, 0);
    drawNative({ fixture, paths, canvas: baseFrame.native, context: baseNativeContext,
      dpr: pixelRatio, transform: ownerBundle.state.zoomTransform });
    const baseNative = readCanvas(baseFrame.native);
    const baseQuality = comparePixels(baseNative, base.actual);
    report.base = {
      quality: baseQuality,
      owner: base.diagnostics,
      timings: { firstCompleteDrawMs: base.elapsedMs, drawCalls: base.draws },
    };

    // Warm both execution paths before collecting paired edit timings.
    const warmCanvas = new OffscreenCanvas(width, height);
    const warmNativeContext = warmCanvas.getContext("2d", { willReadFrequently: false });
    warmNativeContext.setTransform(1, 0, 0, 1, 0, 0);
    drawNative({ fixture, paths, canvas: warmCanvas, context: warmNativeContext,
      dpr: pixelRatio, transform: ownerBundle.state.zoomTransform });
    await waitForOwnerDraw(ownerBundle);
    drawActualFrame(ownerBundle, warmCanvas, width, height);
    warmCanvas.width = warmCanvas.height = 0;

    const candidates = fixture.collection.features.filter((feature) => fixture.strokeCodeForEntry({ feature }) !== 0);
    const warmEdits = [];
    for (let index = 0; index < Math.min(10, candidates.length); index += 1) {
      const feature = candidates[index];
      const id = getFeatureId(feature);
      const oldColor = fixture.resolveColor(feature, id);
      const colorVersionBefore = ownerBundle.getColorVersion();
      const before = ownerBundle.owner.getDiagnostics();
      applyFeaturePaintState(fixture.state, [id], index % 2 ? "#2a93bc" : "#d64f46");
      ownerBundle.incrementColorVersion([id]);
      const nativeCanvas = new OffscreenCanvas(width, height);
      const nativeContext = nativeCanvas.getContext("2d", { willReadFrequently: false });
      nativeContext.setTransform(1, 0, 0, 1, 0, 0);
      let nativeMs = 0;
      let raster = null;
      const measureNative = () => {
        const started = now();
        drawNative({ fixture, paths, canvas: nativeCanvas, context: nativeContext,
          dpr: pixelRatio, transform: ownerBundle.state.zoomTransform });
        nativeMs = now() - started;
      };
      const measureRaster = async () => {
        raster = await waitForOwnerDraw(ownerBundle);
      };
      if (index % 2 === 0) {
        measureNative();
        await measureRaster();
      } else {
        await measureRaster();
        measureNative();
      }
      const rasterReadbackStarted = now();
      const rasterCanvas = new OffscreenCanvas(width, height);
      const rasterActual = drawActualFrame(ownerBundle, rasterCanvas, width, height);
      const rasterReadbackMs = now() - rasterReadbackStarted;
      const after = raster.diagnostics;
      warmEdits.push({
        id,
        priorColor: oldColor,
        colorRevisionDelta: ownerBundle.getColorVersion() - colorVersionBefore,
        nativeFullReferenceMs: nativeMs,
        rasterPaletteAndDrawMs: raster.drawMs,
        rasterSettleAndReadbackMs: rasterReadbackMs,
        rasterBuildDelta: after.builds - before.builds,
        tileUploadDelta: Number(after.gpu?.tileUploads || 0) - Number(before.gpu?.tileUploads || 0),
        quality: comparePixels(readCanvas(nativeCanvas), rasterActual),
        owner: after,
      });
      nativeCanvas.width = nativeCanvas.height = 0;
      rasterCanvas.width = rasterCanvas.height = 0;
    }
    report.warmColorEdits = warmEdits;

    const beforePan = ownerBundle.owner.getDiagnostics();
    ownerBundle.state.zoomTransform.x += 32;
    const panned = await timedOwnerDraw(ownerBundle, width, height);
    const panAfter = panned.diagnostics;
    const afterPanBuilds = panAfter.builds;
    ownerBundle.state.zoomTransform.x -= 32;
    const revisited = await timedOwnerDraw(ownerBundle, width, height);
    report.sameLevelPanReturn = {
      levelBefore: beforePan.level,
      levelPanned: panAfter.level,
      levelReturned: revisited.diagnostics.level,
      panBuildDelta: panAfter.builds - beforePan.builds,
      revisitBuildDelta: revisited.diagnostics.builds - afterPanBuilds,
      panDrawMs: panned.elapsedMs,
      revisitDrawMs: revisited.elapsedMs,
      ownerAfterReturn: revisited.diagnostics,
    };

    const beforeFractionalZoom = ownerBundle.owner.getDiagnostics();
    ownerBundle.state.zoomTransform.k = 1.1;
    const fractional = await timedOwnerDraw(ownerBundle, width, height);
    const fractionalNative = new OffscreenCanvas(width, height);
    const fractionalContext = fractionalNative.getContext("2d", { willReadFrequently: false });
    fractionalContext.setTransform(1, 0, 0, 1, 0, 0);
    drawNative({ fixture, paths, canvas: fractionalNative, context: fractionalContext,
      dpr: pixelRatio, transform: ownerBundle.state.zoomTransform });
    report.fractionalZoom = {
      k: ownerBundle.state.zoomTransform.k,
      buildDelta: fractional.diagnostics.builds - beforeFractionalZoom.builds,
      quality: comparePixels(readCanvas(fractionalNative), fractional.actual),
      owner: fractional.diagnostics,
    };
    const fractionalBuilds = fractional.diagnostics.builds;
    ownerBundle.state.zoomTransform.k = 1;
    const zoomReturned = await timedOwnerDraw(ownerBundle, width, height);
    report.zoomReturnToOne = {
      k: ownerBundle.state.zoomTransform.k,
      buildDelta: zoomReturned.diagnostics.builds - fractionalBuilds,
      owner: zoomReturned.diagnostics,
    };
    fractionalNative.width = fractionalNative.height = 0;

    const nativeFinalCanvas = new OffscreenCanvas(width, height);
    const finalNativeContext = nativeFinalCanvas.getContext("2d", { willReadFrequently: false });
    finalNativeContext.setTransform(1, 0, 0, 1, 0, 0);
    drawNative({ fixture, paths, canvas: nativeFinalCanvas, context: finalNativeContext,
      dpr: pixelRatio, transform: ownerBundle.state.zoomTransform });
    const finalActual = drawActualFrame(ownerBundle, baseFrame.actual, width, height);
    report.finalQuality = comparePixels(readCanvas(nativeFinalCanvas), finalActual);
    report.fullNativeReference = {
      pathBuildMs,
      fullDrawAfterCacheMs: (() => {
        const started = now();
        drawNative({ fixture, paths, canvas: nativeFinalCanvas, context: finalNativeContext,
          dpr: pixelRatio, transform: ownerBundle.state.zoomTransform });
        return now() - started;
      })(),
      featureCount: fixture.collection.features.length,
      note: "All fixture paths filled and stroked at .75 CSS px / k under the DPR transform.",
    };
    const beforeLoss = ownerBundle.owner.getDiagnostics();
    ownerBundle.owner.loseContextForValidation();
    const lossDeadline = now() + 12_000;
    let afterLoss = ownerBundle.owner.getDiagnostics();
    while (now() < lossDeadline && afterLoss.contextLosses <= beforeLoss.contextLosses) {
      await nextFrame();
      afterLoss = ownerBundle.owner.getDiagnostics();
    }
    const lossSupported = afterLoss.contextLosses > beforeLoss.contextLosses;
    let recovered = null;
    if (lossSupported) recovered = await timedOwnerDraw(ownerBundle, width, height);
    report.contextLoss = {
      supported: lossSupported,
      contextLossDelta: afterLoss.contextLosses - beforeLoss.contextLosses,
      buildDeltaAfterLoss: (recovered?.diagnostics.builds ?? afterLoss.builds) - beforeLoss.builds,
      gpuTileUploadsAfterRecovery: recovered?.diagnostics.gpu?.tileUploads ?? null,
      recoveredOwner: recovered?.diagnostics || afterLoss,
      qualityAfterRecovery: recovered
        ? comparePixels(readCanvas(nativeFinalCanvas), recovered.actual)
        : null,
    };
    nativeFinalCanvas.width = nativeFinalCanvas.height = baseFrame.native.width = baseFrame.native.height = 0;
    baseFrame.actual.width = baseFrame.actual.height = 0;
    report.completedAt = new Date().toISOString();
    return report;
  } finally {
    ownerBundle.owner.dispose();
    report.afterDispose = ownerBundle.owner.getDiagnostics();
    ownerBundle.contextCanvas.width = ownerBundle.contextCanvas.height = 0;
  }
}
