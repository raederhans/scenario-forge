const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive, waitForRenderIdle } = require("../support/playwright-app");
const { DEFAULT_FAST_APP_OPEN_PATH, toRootPath } = require("../support/startup-paths");

// Paired current-run references, never golden snapshots or semantic correctness proof.
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
test.setTimeout(180_000);

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sourceIdentity() {
  return {
    head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    trackedDiffSha256: sha256(execFileSync("git", ["diff", "HEAD", "--binary"], { maxBuffer: 32 * 1024 * 1024 })),
    specSha256: sha256(fs.readFileSync(__filename)),
    entrySha256: sha256(fs.readFileSync(path.resolve("index.html"))),
    editorEntryOverride: process.env.MAPCREATOR_EDITOR_ENTRY || process.env.MAPCREATOR_EDITOR_SOURCE || null,
    // Served response digests below also identify untracked/imported JS and actual assets.
  };
}

function trackAssetIdentity(page) {
  const entries = [];
  const requests = new Set();
  let pendingBodies = 0;
  let revision = 0;
  const started = (request) => { requests.add(request); revision += 1; };
  const finished = (request) => { requests.delete(request); revision += 1; };
  const failed = (request) => {
    finished(request);
    entries.push({ url: request.url(), resourceType: request.resourceType(), status: null,
      identityState: "request-failed", identityError: request.failure()?.errorText || "request failed" });
  };
  page.on("request", started);
  page.on("requestfinished", finished);
  page.on("requestfailed", failed);
  const listener = (response) => {
    const url = new URL(response.url());
    if (response.status() >= 400) {
      // The JSON loaders reject at headers and do not consume error bodies.
      // Record the actual failure without waiting for inspector body completion.
      requests.delete(response.request());
      entries.push({ url: response.url(), resourceType: response.request().resourceType(), status: response.status(), identityState: "http-error" });
      revision += 1;
      return;
    }
    if (!/\.(?:js|css|json|geojson|png|webp|jpg|svg|woff2?)$/i.test(url.pathname)) return;
    pendingBodies += 1;
    const entry = { url: response.url(), status: response.status(), identityState: "pending-body" };
    entries.push(entry);
    void (async () => {
      try {
        const body = await response.body();
        Object.assign(entry, { bytes: body.length, sha256: sha256(body), identityState: "captured" });
      } catch (error) {
        entry.identityError = String(error.message);
        entry.identityState = "identity-unavailable";
      }
      pendingBodies -= 1;
      revision += 1;
    })();
  };
  page.on("response", listener);
  return { snapshot: () => ({ revision, pendingRequests: requests.size, pendingBodies,
    pendingRequestUrls: [...requests].map((request) => request.url()),
    pendingBodyUrls: entries.filter((entry) => entry.identityState === "pending-body").map((entry) => entry.url),
  }), finish: async () => {
    page.off("response", listener);
    page.off("request", started);
    page.off("requestfinished", finished);
    page.off("requestfailed", failed);
    // Successful sampling already requires pendingBodies === 0. On failure,
    // freeze unresolved identities as gaps instead of extending the test timeout.
    return entries.map((entry) => ({ ...entry })).sort((a, b) => a.url.localeCompare(b.url));
  } };
}

async function capture(page, key) {
  return page.evaluate(async (frameKey) => {
    const { state } = await import("/js/core/state.js");
    const { RENDER_PASS_NAMES, projectGeoToScreen } = await import("/js/core/map_renderer.js");
    const { createHgoRuntimePreviewRenderOwner } = await import("/js/core/map_renderer/hgo_runtime_preview_render_owner.js");
    const { isRenderTransactionDiagnosticsEnabled } = await import("/js/core/renderer/render_transaction_diagnostics.js");
    const cache = state.renderPassCache;
    const canvas = document.getElementById("map-canvas");
    if (!canvas || !cache?.canvases?.political) throw new Error("Populated political canvas required");
    let snapshotPng;
    const read = (surface, includePng = false) => {
      if (!surface?.width || !surface?.height) return null;
      const scratch = document.createElement("canvas");
      scratch.width = surface.width;
      scratch.height = surface.height;
      const scratchContext = scratch.getContext("2d", { willReadFrequently: true });
      scratchContext.drawImage(surface, 0, 0);
      const pixels = scratchContext.getImageData(0, 0, scratch.width, scratch.height);
      if (includePng) snapshotPng = scratch.toDataURL("image/png");
      return pixels;
    };
    if (frameKey) {
      const pixels = Object.fromEntries(RENDER_PASS_NAMES.map((name) => [name, read(cache.canvases[name])]));
      pixels.visible = read(canvas, true);
      globalThis.__normalVisualFrames ||= {};
      globalThis.__normalVisualFrames[frameKey] = pixels;
    }
    const activePasses = createHgoRuntimePreviewRenderOwner({ runtimeState: state, renderPassNames: RENDER_PASS_NAMES }).getActiveRenderPassNames();
    const bundle = state.scenarioBundleCacheById?.[state.activeScenarioId] || {};
    const chunks = state.runtimeChunkLoadState || {};
    const promotionSnapshot = (value) => value ? Object.fromEntries([
      "scenarioId", "reason", "scenarioApplyEpoch", "scenarioApplyRequestId", "selectionVersion", "promotionVersion",
      "queuedAt", "changedLayerKeys", "hasPoliticalGeometryChange", "primaryVisibleDerivedStateReady", "completePoliticalDerivedStateReady",
    ].filter((field) => value[field] !== undefined).map((field) => [field, value[field]])) : null;
    const scheduler = state.postReadyTaskDiagnostics || state.renderPerfMetrics?.postReadySchedulerState || {};
    const pendingKeys = (object) => Object.keys(object || {}).filter((key) => !!object[key]).sort();
    const pendingLoads = {
      context: pendingKeys(state.contextLayerLoadPromiseByName),
      optional: pendingKeys(bundle.optionalLayerPromises),
      chunkPayloads: pendingKeys(bundle.chunkPayloadPromisesById),
      chunks: pendingKeys(chunks.inFlightByChunkId),
      city: !!state.baseCityDataPromise,
      localization: !!state.baseLocalizationDataPromise,
      metadata: !!bundle.deferredMetadataLoadPromise && !bundle.deferredMetadataLoadSettled,
      detail: !!state.detailPromotionInFlight,
      scenario: !!state.scenarioApplyInFlight,
      promotion: !!(chunks.pendingPromotion || chunks.pendingVisualPromotion || chunks.pendingInfraPromotion || chunks.refreshScheduled || chunks.promotionScheduled || chunks.promotionCommitInFlight || chunks.pendingPostCommitRefresh),
      scheduler: !!(state.activePostReadyTaskKey || scheduler.activeTaskKey || scheduler.pendingTaskKeys?.length),
      politicalWarmup: !!(cache.politicalPathWarmupHandle || cache.politicalPathWarmupQueue?.length),
    };
    let viewportCenter = null;
    if (frameKey) {
      // Invert the public projection numerically, and report only a solution
      // verified by reprojection; never label the requested target as actual.
      let [lon, lat] = globalThis.__normalVisualRegion?.lonLat || [0, 20];
      const center = [state.width / 2, state.height / 2];
      for (let step = 0; step < 15; step += 1) {
        const p = projectGeoToScreen(lon, lat);
        if (!p?.every(Number.isFinite)) break;
        const error = [center[0] - p[0], center[1] - p[1]];
        const residualPx = Math.hypot(...error);
        if (residualPx < 0.05) { viewportCenter = { lonLat: [lon, lat], residualPx }; break; }
        const q = projectGeoToScreen(lon + 0.001, lat), r = projectGeoToScreen(lon, lat + 0.001);
        if (!q?.every(Number.isFinite) || !r?.every(Number.isFinite)) break;
        const a = (q[0] - p[0]) / 0.001, b = (r[0] - p[0]) / 0.001;
        const c = (q[1] - p[1]) / 0.001, d = (r[1] - p[1]) / 0.001;
        const determinant = a * d - b * c;
        if (Math.abs(determinant) < 1e-8) break;
        lon = Math.max(-179.999, Math.min(179.999, lon + (error[0] * d - error[1] * b) / determinant));
        lat = Math.max(-85, Math.min(85, lat + (a * error[1] - c * error[0]) / determinant));
      }
    }
    globalThis.__normalVisualResourceIds ||= { ids: new WeakMap(), next: 1 };
    const registry = globalThis.__normalVisualResourceIds;
    const resourceRefs = Object.fromEntries(Object.keys(state)
      .filter((name) => /(?:Data|Topology)$/.test(name) || ["colors", "activeScenarioManifest"].includes(name))
      .sort().map((name) => {
        const value = state[name];
        if (!value || typeof value !== "object") return [name, value ?? null];
        if (!registry.ids.has(value)) registry.ids.set(value, registry.next++);
        return [name, registry.ids.get(value)];
      }));
    return {
      key: frameKey,
      scenarioId: state.activeScenarioId,
      scenarioDataGeneration: state.scenarioDataGeneration,
      sceneGeneration: state.sceneGeneration,
      selectionVersion: state.runtimeChunkLoadState?.selectionVersion,
      loadedChunkIds: state.activeScenarioChunks?.loadedChunkIds || [],
      manifest: state.activeScenarioManifest,
      landFeatureCount: state.landData?.features?.length || 0,
      colorCount: Object.keys(state.colors || {}).length,
      viewport: { width: innerWidth, height: innerHeight },
      dpr: devicePixelRatio,
      effectiveDpr: state.dpr,
      canvasSize: { width: canvas.width, height: canvas.height },
      transform: { x: state.zoomTransform?.x, y: state.zoomTransform?.y, k: state.zoomTransform?.k },
      renderPhase: state.renderPhase,
      renderScheduling: {
        bootBlocking: !!state.bootBlocking,
        startupReadonly: !!state.startupReadonly,
        startupReadonlyUnlockInFlight: !!state.startupReadonlyUnlockInFlight,
        scenarioApplyInFlight: !!state.scenarioApplyInFlight,
        isInteracting: !!state.isInteracting,
        deferExactAfterSettle: !!state.deferExactAfterSettle,
        exactAfterSettleHandle: !!state.exactAfterSettleHandle,
        zoomRenderScheduled: !!state.zoomRenderScheduled,
        pendingZoomTransform: state.pendingZoomTransform
          ? { x: state.pendingZoomTransform.x, y: state.pendingZoomTransform.y, k: state.pendingZoomTransform.k }
          : null,
        renderPhaseTimerId: !!state.renderPhaseTimerId,
        deferContextBasePass: !!state.deferContextBasePass,
        scenarioChunkPromotionRenderLocked: !!state.scenarioChunkPromotionRenderLocked,
        currentScenarioApplyRequestId: state.currentScenarioApplyRequestId,
      },
      diagnosticsEnabled: isRenderTransactionDiagnosticsEnabled(state),
      counters: { ...cache.counters },
      signatures: { ...cache.signatures },
      layouts: { ...cache.layouts },
      referenceTransforms: { ...cache.referenceTransforms },
      referenceTransform: cache.referenceTransform,
      dirty: { ...cache.dirty },
      reasons: { ...cache.reasons },
      scheduler: { ...scheduler, currentActiveTaskKey: state.activePostReadyTaskKey || "" },
      politicalCache: {
        pathSize: cache.politicalPathCache?.size || 0,
        signature: cache.politicalPathCacheSignature,
        transform: cache.politicalPathCacheTransform,
        reason: cache.politicalPathCacheReason,
        warmupQueueLength: cache.politicalPathWarmupQueue?.length || 0,
        warmupHandle: !!cache.politicalPathWarmupHandle,
        warmupSignature: cache.politicalPathWarmupSignature,
        warmupReason: cache.politicalPathWarmupReason,
        dataStage: cache.politicalPassDataStage,
        fullReady: cache.politicalPassFullReady,
        fineCacheReady: cache.politicalPassFineCacheReady,
      },
      politicalMetrics: Object.fromEntries(Object.entries(state.renderPerfMetrics || {}).filter(([name]) => /political|background.*cache/i.test(name))),
      viewportCenter,
      requestedRegion: globalThis.__normalVisualRegion || null,
      activePasses,
      pendingLoads,
      chunkWork: {
        generation: chunks.generation,
        selectionVersion: chunks.selectionVersion,
        shellStatus: chunks.shellStatus,
        registryStatus: chunks.registryStatus,
        pendingReason: chunks.pendingReason,
        pendingDelayMs: chunks.pendingDelayMs,
        pendingScenarioApplyRequestId: chunks.pendingScenarioApplyRequestId,
        refreshScheduled: !!chunks.refreshScheduled,
        refreshTimerPresent: !!chunks.refreshTimerId,
        promotionScheduled: !!chunks.promotionScheduled,
        promotionTimerPresent: !!chunks.promotionTimerId,
        promotionCommitInFlight: !!chunks.promotionCommitInFlight,
        promotionCommitRunId: chunks.promotionCommitRunId,
        promotionRetryCount: chunks.promotionRetryCount,
        lastPromotionRetryAt: chunks.lastPromotionRetryAt,
        promotionCommitStatus: chunks.promotionCommitStatus,
        promotionCommitScenarioId: chunks.promotionCommitScenarioId,
        promotionCommitSelectionVersion: chunks.promotionCommitSelectionVersion,
        promotionCommitReason: chunks.promotionCommitReason,
        promotionCommitError: chunks.promotionCommitError,
        pendingPromotion: promotionSnapshot(chunks.pendingPromotion),
        pendingVisualPromotion: promotionSnapshot(chunks.pendingVisualPromotion),
        pendingInfraPromotion: promotionSnapshot(chunks.pendingInfraPromotion),
        pendingPostCommitRefresh: promotionSnapshot(chunks.pendingPostCommitRefresh),
        inFlightChunkIds: pendingKeys(chunks.inFlightByChunkId),
        activeChunkScenarioId: state.activeScenarioChunks?.scenarioId,
        activeChunkApplyEpoch: state.activeScenarioChunks?.scenarioApplyEpoch,
        activeChunkApplyRequestId: state.activeScenarioChunks?.scenarioApplyRequestId,
      },
      backgroundWork: {
        hitCanvasBuildScheduled: !!state.hitCanvasBuildScheduled,
        interactionInfrastructureBuildInFlight: !!state.interactionInfrastructureBuildInFlight,
        activeInteractionRecoveryTaskKey: state.activeInteractionRecoveryTaskKey || "",
      },
      resourceRefs,
      contextLayerRevision: state.contextLayerRevision,
      contextLayerLoadStateByName: state.contextLayerLoadStateByName,
      contextLayerSourceByName: state.contextLayerSourceByName,
      settled: state.renderPhase === "idle"
        && !state.deferExactAfterSettle && !state.exactAfterSettleHandle && !state.zoomRenderScheduled
        && !state.pendingZoomTransform && !state.renderPhaseTimerId
        && activePasses.every((name) => cache.dirty[name] === false)
        && Object.values(pendingLoads).every((value) => Array.isArray(value) ? value.length === 0 : !value),
      passOrder: RENDER_PASS_NAMES,
      png: snapshotPng,
    };
  }, key);
}

const IDENTITY_FIELDS = ["scenarioId", "scenarioDataGeneration", "sceneGeneration", "selectionVersion", "transform", "loadedChunkIds", "resourceRefs", "contextLayerRevision", "contextLayerLoadStateByName", "contextLayerSourceByName", "landFeatureCount", "colorCount", "effectiveDpr", "canvasSize", "signatures", "activePasses"];
function identity(snapshot) {
  return JSON.stringify(IDENTITY_FIELDS.map((field) => snapshot[field]));
}

function throwOnPageError(report) {
  if (report.pageErrors.length) throw new Error(`runtime-error: ${report.pageErrors.map((error) => error.message).join("; ")}`);
}

async function waitForNaturalPreparation(page, assets, report, key) {
  const startedAt = Date.now();
  const preparation = { key, status: "pending", budgetMs: 45_000 };
  report.preparations.push(preparation);
  while (Date.now() - startedAt < preparation.budgetMs) {
    throwOnPageError(report);
    let last;
    try {
      last = await capture(page, null);
    } catch (error) {
      preparation.status = "interrupted";
      preparation.elapsedMs = Date.now() - startedAt;
      preparation.error = String(error.message || error);
      report.inconclusive = { key, reason: "natural-preparation-interrupted", elapsedMs: preparation.elapsedMs,
        last: preparation.last || null, assets: assets.snapshot(), error: preparation.error };
      throw error;
    }
    preparation.elapsedMs = Date.now() - startedAt;
    preparation.last = last;
    preparation.assets = assets.snapshot();
    throwOnPageError(report);
    if (last.settled && Object.values(last.backgroundWork).every((value) => !value)
      && !preparation.assets.pendingRequests && !preparation.assets.pendingBodies) {
      preparation.status = "naturally-ready";
      return;
    }
    await page.waitForTimeout(100);
  }
  preparation.status = "inconclusive";
  report.inconclusive = { key, reason: "natural-preparation-timeout", elapsedMs: preparation.elapsedMs,
    last: preparation.last, assets: preparation.assets };
  throw new Error(`inconclusive: ${key} did not naturally finish loading and clean active passes within 45s`);
}

async function waitForStableSample(page, assets, report, key) {
  const startedAt = Date.now();
  const deadline = startedAt + 20_000;
  let sampleCount = 0;
  let maxCaptureMs = 0;
  let stableSince = 0;
  let previous = "";
  let last;
  while (Date.now() < deadline) {
    throwOnPageError(report);
    const captureStartedAt = Date.now();
    last = await capture(page, null);
    throwOnPageError(report);
    sampleCount += 1;
    maxCaptureMs = Math.max(maxCaptureMs, Date.now() - captureStartedAt);
    const resourceActivity = assets.snapshot();
    const current = `${identity(last)}:${JSON.stringify(last.politicalCache)}:${resourceActivity.revision}`;
    if (last.settled && !resourceActivity.pendingRequests && !resourceActivity.pendingBodies) {
      if (!stableSince || current !== previous) stableSince = Date.now();
      if (stableSince && Date.now() - stableSince >= 1000) return;
    } else stableSince = 0;
    previous = current;
    await page.waitForTimeout(100);
  }
  report.inconclusive = { key, reason: "bounded-stability-timeout", elapsedMs: Date.now() - startedAt, sampleCount, maxCaptureMs, last, assets: assets.snapshot() };
  throw new Error(`inconclusive: ${key} did not hold idle, clean active passes and resource identity stable for 1s within 20s`);
}

async function compare(page, left, right) {
  return page.evaluate(({ leftKey, rightKey }) => {
    const frames = globalThis.__normalVisualFrames;
    const comparisons = Object.keys(frames[leftKey]).map((pass) => {
      const a = frames[leftKey][pass];
      const b = frames[rightKey][pass];
      if (!a && !b) return { pass, status: "absent-both", changedPixels: 0 };
      if (!a || !b || a.width !== b.width || a.height !== b.height) {
        return { pass, status: "surface-mismatch", changedPixels: null };
      }
      let changedPixels = 0;
      let maxChannelDelta = 0;
      let minX = a.width, minY = a.height, maxX = -1, maxY = -1;
      for (let i = 0; i < a.data.length; i += 4) {
        let changed = false;
        for (let c = 0; c < 4; c += 1) {
          const delta = Math.abs(a.data[i + c] - b.data[i + c]);
          maxChannelDelta = Math.max(maxChannelDelta, delta);
          changed ||= delta !== 0;
        }
        if (changed) {
          changedPixels += 1;
          const x = (i / 4) % a.width;
          const y = Math.floor(i / 4 / a.width);
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
      return { pass, status: "compared", changedPixels, ratio: changedPixels / (a.width * a.height), maxChannelDelta,
        bounds: changedPixels ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null };
    });
    const diffEntry = comparisons.find((entry) => entry.pass === "visible" && entry.changedPixels > 0)
      || comparisons.find((entry) => entry.changedPixels > 0);
    const bounds = diffEntry?.bounds;
    const diffCanvas = document.createElement("canvas");
    diffCanvas.width = bounds?.width || 1;
    diffCanvas.height = bounds?.height || 1;
    if (bounds) {
      const a = frames[leftKey][diffEntry.pass], b = frames[rightKey][diffEntry.pass];
      const ctx = diffCanvas.getContext("2d");
      const image = ctx.createImageData(bounds.width, bounds.height);
      for (let y = 0; y < bounds.height; y += 1) {
        for (let x = 0; x < bounds.width; x += 1) {
          const from = ((bounds.y + y) * a.width + bounds.x + x) * 4;
          const to = (y * bounds.width + x) * 4;
          // Alpha differences remain visible even when RGB is unchanged.
          const delta = Math.max(...[0, 1, 2, 3].map((c) => Math.abs(a.data[from + c] - b.data[from + c])));
          image.data[to] = delta;
          image.data[to + 1] = delta;
          image.data[to + 2] = delta;
          image.data[to + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    }
    return {
      left: leftKey, right: rightKey,
      firstDifferingPass: comparisons.find((entry) => entry.pass !== "visible" && (entry.status === "surface-mismatch" || entry.changedPixels > 0))?.pass || null,
      passes: comparisons.filter((entry) => entry.pass !== "visible"),
      visible: comparisons.find((entry) => entry.pass === "visible"),
      diffArtifact: { pass: diffEntry?.pass || null, bounds: bounds || null, png: diffCanvas.toDataURL("image/png") },
    };
  }, { leftKey: left, rightKey: right });
}

async function locateDifference(page, diff, normal, reference) {
  const pass = diff.firstDifferingPass || "visible";
  const entry = pass === "visible" ? diff.visible : diff.passes.find((item) => item.pass === pass);
  if (!entry?.bounds) return { status: "no-pixel-bounds", pass };
  return page.evaluate(async ({ pass, pixelBounds, visibleBounds, normal, reference }) => {
    const { state } = await import("/js/core/state.js");
    const { projectGeoToScreen } = await import("/js/core/map_renderer.js");
    const { getFeatureId } = await import("/js/core/feature_identity.js");
    const { getFeatureOwnerCode } = await import("/js/core/sovereignty_manager.js");
    const current = state.zoomTransform;
    const mapBox = (sample) => {
      const layout = pass === "visible" ? { offsetX: 0, offsetY: 0, dpr: sample.effectiveDpr } : sample.layouts?.[pass];
      const transform = pass === "visible" ? sample.transform : sample.referenceTransforms?.[pass] || sample.referenceTransform;
      if (!layout || !transform || !(transform.k > 0)) return null;
      const dpr = layout.dpr || sample.effectiveDpr;
      const point = (x, y) => [(x / dpr - layout.offsetX - transform.x) / transform.k, (y / dpr - layout.offsetY - transform.y) / transform.k];
      const min = point(pixelBounds.x, pixelBounds.y);
      const max = point(pixelBounds.x + pixelBounds.width, pixelBounds.y + pixelBounds.height);
      return { layout, transform, dpr, minX: min[0], minY: min[1], maxX: max[0], maxY: max[1] };
    };
    const normalBox = mapBox(normal), box = mapBox(reference);
    if (!box) return { status: "missing-pass-coordinate-metadata", pass, pixelBounds };
    const invert = (mapX, mapY) => {
      const target = [mapX * current.k + current.x, mapY * current.k + current.y];
      let [lon, lat] = reference.viewportCenter?.lonLat || reference.requestedRegion?.lonLat || [0, 20];
      for (let step = 0; step < 20; step += 1) {
        const p = projectGeoToScreen(lon, lat), q = projectGeoToScreen(lon + 0.001, lat), r = projectGeoToScreen(lon, lat + 0.001);
        if (![p, q, r].every((value) => value?.every(Number.isFinite))) return null;
        const ex = target[0] - p[0], ey = target[1] - p[1];
        const residualPx = Math.hypot(ex, ey);
        if (residualPx < 0.05) return { lonLat: [lon, lat], residualPx };
        const a = (q[0] - p[0]) / 0.001, b = (r[0] - p[0]) / 0.001;
        const c = (q[1] - p[1]) / 0.001, d = (r[1] - p[1]) / 0.001;
        const determinant = a * d - b * c;
        if (Math.abs(determinant) < 1e-8) return null;
        lon = Math.max(-179.999, Math.min(179.999, lon + (ex * d - ey * b) / determinant));
        lat = Math.max(-85, Math.min(85, lat + (a * ey - c * ex) / determinant));
      }
      return null;
    };
    const candidates = [];
    let missingProjectedBounds = 0;
    let totalCandidates = 0;
    for (const feature of state.landData?.features || []) {
      const id = getFeatureId(feature);
      const bounds = state.projectedBoundsById?.get(id);
      if (!bounds) { missingProjectedBounds += 1; continue; }
      if (bounds.maxX < box.minX || bounds.minX > box.maxX || bounds.maxY < box.minY || bounds.minY > box.maxY) continue;
      totalCandidates += 1;
      if (candidates.length < 30) candidates.push({ id, geometryType: feature.geometry?.type,
        name: feature.properties?.name || feature.properties?.NAME || null,
        owner: getFeatureOwnerCode(feature, { skipEnsure: true }),
        directOwner: state.sovereigntyByFeatureId?.[id] || null,
        projectedBounds: bounds,
        pathCacheExists: !!state.renderPassCache?.politicalPathCache?.get(id)?.path,
      });
    }
    const registry = globalThis.__normalVisualResourceIds;
    const alias = (value) => {
      if (!value || typeof value !== "object") return null;
      if (!registry.ids.has(value)) registry.ids.set(value, registry.next++);
      return registry.ids.get(value);
    };
    const candidateIds = new Set(candidates.map((candidate) => candidate.id));
    const featureAliasesByFrame = {};
    for (const sample of [reference]) {
      const saved = {
        pathCache: state.renderPassCache.politicalPathCache,
        collections: Object.fromEntries(Object.keys(state)
          .filter((name) => /political/i.test(name) || ["landData", "landDataFull"].includes(name))
          .filter((name) => Array.isArray(state[name]?.features))
          .map((name) => [name, state[name].features])),
        spatialItems: state.spatialItems || [],
      };
      const rows = [];
      const append = (source, feature, bounds = null) => {
        const id = getFeatureId(feature);
        if (!candidateIds.has(id)) return;
        rows.push({ id, source, featureRef: alias(feature), geometryRef: alias(feature.geometry),
          geometryType: feature.geometry?.type, bounds });
      };
      for (const [source, features] of Object.entries(saved.collections)) {
        for (const feature of features) append(source, feature);
      }
      for (const item of saved.spatialItems) {
        if (item?.feature) append("spatialItems", item.feature, { minX: item.minX, minY: item.minY, maxX: item.maxX, maxY: item.maxY });
      }
      featureAliasesByFrame[sample.key] = {
        sources: rows,
        cachedPaths: candidates.map(({ id }) => {
          const cached = saved.pathCache?.get(id);
          return { id, entryRef: alias(cached), pathRef: alias(cached?.path),
            entryKeys: cached ? Object.keys(cached) : [],
            storedGeometryRef: alias(cached?.geometryRef || cached?.geometry || cached?.feature?.geometry),
          };
        }),
      };
    }
    return {
      status: "localized-from-pass-pixels", pass, pixelBounds, visibleBounds,
      coordinateFormula: "map=(passPixel/layout.dpr-layout.offset-referenceTransform.translation)/referenceTransform.k",
      normalBox, referenceBox: box,
      geoCenter: invert((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2),
      geoCorners: [[box.minX, box.minY], [box.maxX, box.minY], [box.maxX, box.maxY], [box.minX, box.maxY]].map(([x, y]) => invert(x, y)),
      candidates, totalCandidates, candidateLimit: 30, missingProjectedBounds,
      featureAliasesByFrame,
      candidateMethod: "existing projectedBoundsById bbox intersection only; not geometry containment or semantic proof",
      cacheObservedAfterFrame: reference.key,
      scenarioId: state.activeScenarioId, scenarioDataGeneration: state.scenarioDataGeneration,
    };
  }, { pass, pixelBounds: entry.bounds, visibleBounds: diff.visible?.bounds, normal, reference });
}

const REGIONS = {
  tno_1962: { name: "dense-central-europe", lonLat: [13.4, 52.5], zoomPercent: 300 },
  hoi4_1936: { name: "english-channel-coast", lonLat: [1.5, 50.5], zoomPercent: 300 },
  modern_world: { name: "date-line-east-edge", lonLat: [179, 10], zoomPercent: 300 },
};

async function visitRegion(page, scenarioId, report) {
  const region = REGIONS[scenarioId];
  if (await page.locator("#scenarioGuideCloseBtn").isVisible()) await page.locator("#scenarioGuideCloseBtn").click();
  await page.evaluate(async (target) => {
    globalThis.__normalVisualRegion = target;
    (await import("/js/core/map_renderer.js")).setZoomPercent(target.zoomPercent);
  }, region);
  await waitForRenderIdle(page, { scenarioId });
  const locate = () => page.evaluate(async (lonLat) => {
    const { state } = await import("/js/core/state.js");
    const { projectGeoToScreen } = await import("/js/core/map_renderer.js");
    const point = projectGeoToScreen(...lonLat);
    const rect = document.getElementById("mapContainer").getBoundingClientRect();
    return { point, width: state.width, height: state.height, left: rect.left, top: rect.top,
      transform: { x: state.zoomTransform.x, y: state.zoomTransform.y, k: state.zoomTransform.k } };
  }, region.lonLat);
  const pans = [];
  for (let index = 0; index < 5; index += 1) {
    const before = await locate();
    expect(before.point?.every(Number.isFinite), "Region requires a projected geographic point").toBe(true);
    const dx = Math.max(-before.width * 0.6, Math.min(before.width * 0.6, before.width / 2 - before.point[0]));
    const dy = Math.max(-before.height * 0.6, Math.min(before.height * 0.6, before.height / 2 - before.point[1]));
    if (Math.hypot(dx, dy) < 2) break;
    const start = { x: before.left + before.width / 2 - dx / 2, y: before.top + before.height / 2 - dy / 2 };
    await page.keyboard.down("Shift");
    try {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
      await page.mouse.up();
    } finally {
      await page.keyboard.up("Shift");
    }
    await waitForRenderIdle(page, { scenarioId });
    const after = await locate();
    pans.push({ before, delta: [dx, dy], after });
    if (JSON.stringify(before.transform) === JSON.stringify(after.transform)) break;
  }
  const actual = await locate();
  const targetVisible = actual.point[0] >= 0 && actual.point[0] <= actual.width
    && actual.point[1] >= 0 && actual.point[1] <= actual.height;
  report.operations.push({ action: "geographic-region-zoom-and-pan", region, pans, actual, targetVisible });
  expect(targetVisible, `Requested representative region must be inside actual viewport: ${JSON.stringify(actual)}`).toBe(true);
}

const VISUAL_CASES = [
  ...["tno_1962", "hoi4_1936", "modern_world"].map((scenarioId) => ({
    scenarioId, caseId: scenarioId, phases: ["startup", "region-settled"],
  })),
  { scenarioId: "tno_1962", caseId: "tno_1962-switch", phases: ["startup", "switch-return"] },
];

for (const { scenarioId, caseId, phases } of VISUAL_CASES) {
  test(`@dev normal visual paths ${caseId}`, async ({ page }, testInfo) => {
    const outputDir = path.resolve(".runtime/browser/visual-correctness/v1", caseId);
    fs.mkdirSync(outputDir, { recursive: true });
    for (const filename of ["normal.png", "reference.png", "diff.png"]) {
      fs.rmSync(path.join(outputDir, filename), { force: true });
    }
    const report = {
      schemaVersion: 2, source: sourceIdentity(), scenarioId, caseId, phases, affectedPasses: ["political"],
      pixelReadback: {
        method: "native-size drawImage to test-owned willReadFrequently scratch; getImageData and PNG from scratch",
        productionContextReads: "no direct getImageData or toDataURL",
        limitation: "drawImage can still cause readback or color conversion; this comparison alone does not prove or exclude an observer effect",
      },
      operations: [], samples: [], pairs: [], preparations: [], pageErrors: [], pixelFailures: [],
      coverage: {
        originalSemantics: "not-tested: same-renderer references cannot establish source semantics",
        cache: "pending",
        viewportState: phases.includes("region-settled") ? "pending" : "not-tested: separate startup-and-region case",
        scenarioSwitch: phases.includes("switch-return") ? "pending: TNO-to-Modern-to-TNO" : "not-tested: separate tno_1962-switch case",
        interactionDegradation: "not-tested: only settled zoom frames are compared",
      },
    };
    const onPageError = (error) => report.pageErrors.push({ message: error.message, stack: error.stack, observedAt: new Date().toISOString() });
    page.on("pageerror", onPageError);
    const assets = trackAssetIdentity(page);
    const framePngs = new Map();
    const take = async (key, expectedScenarioId = scenarioId) => {
      await waitForStableSample(page, assets, report, key);
      const snapshot = await capture(page, key);
      throwOnPageError(report);
      const { png, ...metadata } = snapshot;
      framePngs.set(key, png);
      report.samples.push(metadata);
      expect(metadata.scenarioId).toBe(expectedScenarioId);
      expect(metadata.diagnosticsEnabled).toBe(false);
      expect(metadata.landFeatureCount).toBeGreaterThan(0);
      expect(metadata.colorCount).toBeGreaterThan(0);
      expect(metadata.settled, "Capture must remain settled after stability observation").toBe(true);
      return metadata;
    };
    try {
      const url = new URL(toRootPath(DEFAULT_FAST_APP_OPEN_PATH), "http://127.0.0.1");
      url.searchParams.delete("render_diag");
      url.searchParams.set("default_scenario", scenarioId);
      report.operations.push({ action: "startup", url: `${url.pathname}${url.search}` });
      const entryResponse = await gotoApp(page, `${url.pathname}${url.search}`, { waitUntil: "domcontentloaded" });
      report.servedEntry = { url: entryResponse.url(), sha256: sha256(await entryResponse.body()) };
      expect(report.servedEntry.sha256, "V1 requires the repository source index.html, not dist").toBe(report.source.entrySha256);
      await waitForAppInteractive(page);
      await waitForRenderIdle(page, { scenarioId });
      await waitForNaturalPreparation(page, assets, report, "startup-preparation");
      for (const phase of phases) {
        if (phase === "region-settled") await visitRegion(page, scenarioId, report);
        if (phase === "switch-return") {
          const otherScenarioId = scenarioId === "modern_world" ? "hoi4_1936" : "modern_world";
          for (const nextId of [otherScenarioId, scenarioId]) {
            report.operations.push({ action: "applyScenarioByIdCommand", from: nextId === otherScenarioId ? scenarioId : otherScenarioId, to: nextId });
            await page.evaluate(async (id) => {
              globalThis.__normalVisualRegion = null;
              const { applyScenarioByIdCommand } = await import("/js/core/scenario_dispatcher.js");
              await applyScenarioByIdCommand(id, { renderMode: "flush", markDirtyReason: "", showToastOnComplete: false });
            }, nextId);
            // Observe natural chunk completion directly so the shorter preparation
            // budget preserves pending state before a legacy 120s idle wait can expire.
            await waitForNaturalPreparation(page, assets, report, `switch-preparation-${nextId}`);
            if (nextId === otherScenarioId) await take("switch-B-populated", nextId);
          }
        }
        const before = await take(`${phase}-before`);
        report.operations.push({ action: "render", phase, invalidation: "none" });
        await page.evaluate(async () => (await import("/js/core/map_renderer.js")).render());
        await waitForRenderIdle(page, { scenarioId });
        const normal = await take(`${phase}-normal`);
        report.operations.push({ action: "reconcileDetailPromotionPoliticalPass", phase, affectedPasses: ["political"] });
        const requested = await page.evaluate(async () => (await import("/js/core/map_renderer.js")).reconcileDetailPromotionPoliticalPass("normal-visual-reference"));
        await waitForRenderIdle(page, { scenarioId });
        const reference = await take(`${phase}-reference`);
        const diff = await compare(page, normal.key, reference.key);
        const repeat = await compare(page, before.key, normal.key);
        const diffArtifact = diff.diffArtifact;
        const repeatArtifact = repeat.diffArtifact;
        delete diff.diffArtifact;
        delete repeat.diffArtifact;
        const cacheReused = normal.counters.politicalPassRenders === before.counters.politicalPassRenders;
        const referenceRedrawn = reference.counters.politicalPassRenders > normal.counters.politicalPassRenders;
        const identityStable = identity(normal) === identity(reference);
        const repeatIdentityStable = identity(before) === identity(normal);
        const pair = { phase, requested, cacheReused, referenceRedrawn, identityStable, repeatIdentityStable, repeat, diff,
          provenance: { evidence: "current-run-political-redraw", sourceSemantics: "not-established", comparedPasses: normal.activePasses },
          classification: !identityStable || !repeatIdentityStable ? "inconclusive-state-or-signature-drift"
            : !cacheReused ? "cache-reuse-not-exercised"
              : repeat.firstDifferingPass || repeat.visible.changedPixels !== 0 ? "normal-repeat-divergence-needs-triage"
            : diff.visible.changedPixels === 0 && diff.firstDifferingPass === null ? "equivalent-within-political-reference-scope"
              : "cache-reference-divergence-needs-triage" };
        report.pairs.push(pair);
        const repeatFailed = !repeatIdentityStable || repeat.firstDifferingPass || repeat.visible.changedPixels !== 0;
        const failed = repeatFailed || !identityStable || !cacheReused || !referenceRedrawn || diff.firstDifferingPass || diff.visible.changedPixels !== 0;
        if (failed && !report.failureArtifacts) {
          pair.diffLocation = await locateDifference(page, diff, normal, reference);
          const artifact = repeatFailed ? repeatArtifact : diffArtifact;
          const keys = repeatFailed ? [before.key, normal.key] : [normal.key, reference.key];
          const images = { "normal.png": framePngs.get(keys[0]), "reference.png": framePngs.get(keys[1]), "diff.png": artifact.png };
          for (const [filename, png] of Object.entries(images)) {
            fs.writeFileSync(path.join(outputDir, filename), Buffer.from(png.split(",")[1], "base64"));
          }
          report.failureArtifacts = { comparedFrames: keys, diffPass: artifact.pass, bounds: artifact.bounds, files: Object.keys(images) };
        }
        expect(identityStable, "Pair requires identical scene/data/viewport state").toBe(true);
        expect(repeatIdentityStable, "Repeat requires identical resource identities and all pass signatures").toBe(true);
        expect(cacheReused, "Normal render must reuse political cache").toBe(true);
        expect(referenceRedrawn, "Reference must actually redraw political pass").toBe(true);
        // Only pixel failures can accumulate after all pair prerequisites pass.
        // Keep collecting switch evidence, then fail the test on any nonzero diff.
        const pixelDifferences = [repeat, diff].flatMap((comparison) => [...comparison.passes, comparison.visible]
          .filter((entry) => entry.status === "surface-mismatch" || entry.changedPixels !== 0)
          .map((entry) => ({ left: comparison.left, right: comparison.right, ...entry })));
        if (pixelDifferences.length) report.pixelFailures.push({ phase, differences: pixelDifferences });
        report.coverage[phase === "startup" ? "cache" : phase === "region-settled" ? "viewportState" : "scenarioSwitch"] = pixelDifferences.length
          ? "failed-pixel-difference"
          : phase === "switch-return"
          ? "passed-return-to-A-political-reference; B-populated-observed"
          : "passed-political-reference";
      }
      if (phases.includes("region-settled")) {
        expect(report.samples.find((entry) => entry.key === "region-settled-before").transform)
          .not.toEqual(report.samples[0].transform);
      }
      if (report.pixelFailures.length) {
        report.failureKind = "pixel-difference";
        throw new Error(`Strict zero-pixel comparison failed in phases: ${report.pixelFailures.map((failure) => failure.phase).join(", ")}`);
      }
    } catch (error) {
      report.failure = String(error.stack || error);
      report.failureKind = report.pageErrors.length ? "runtime-error" : report.failureKind || report.inconclusive?.reason || "assertion-or-test-error";
      throw error;
    } finally {
      page.off("pageerror", onPageError);
      report.assetsAtFinish = assets.snapshot();
      report.assets = await assets.finish();
      const manifests = [...report.samples.map((sample) => sample.manifest), report.inconclusive?.last?.manifest].filter(Boolean);
      const requiredPaths = manifests.flatMap((manifest) => ["runtime_topology_url", "owners_url", "countries_url"]
        .map((field) => manifest[field]).filter(Boolean));
      report.networkFailures = report.assets.filter((asset) => ["http-error", "request-failed"].includes(asset.identityState)).map((asset) => {
        const pathname = new URL(asset.url).pathname;
        const required = ["document", "script", "stylesheet"].includes(asset.resourceType)
          || requiredPaths.some((resource) => pathname.endsWith(`/${String(resource).replace(/^\.\//, "")}`));
        const startupLocalizationFallback = /\/scenarios\/[^/]+\/(?:locales|geo_aliases)\.startup\.json$/.test(pathname);
        return { ...asset, classification: required ? "required-resource-failure"
          : startupLocalizationFallback ? "startup-localization-default-fallback: data_loader.loadLocalizationData"
            : "unclassified-resource-failure" };
      });
      report.resourceCompleteness = report.networkFailures.length ? "not-established: network failures recorded"
        : report.assets.some((asset) => asset.identityState !== "captured") ? "not-established: asset identity gaps"
          : "observed-asset-identities-captured; semantic completeness not established";
      const requiredFailures = report.networkFailures.filter((asset) => asset.classification === "required-resource-failure");
      const resourceError = report.failure ? null : report.pageErrors.length
        ? new Error(`runtime-error: ${report.pageErrors.map((error) => error.message).join("; ")}`)
        : requiredFailures.length ? new Error(`Required resources failed: ${requiredFailures.map((asset) => asset.url).join(", ")}`) : null;
      if (report.pageErrors.length) report.failureKind = "runtime-error";
      if (resourceError) report.failure = resourceError.message;
      fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      await testInfo.attach("normal-visual-paths", { path: path.join(outputDir, "report.json"), contentType: "application/json" });
      if (resourceError) throw resourceError;
    }
  });
}
