import { createGeometryRasterWorkerClient } from "../geometry_raster_worker_client.js";
import { getProjectionGeometryGeneration as identityOf } from "./projection_geometry_identity.js";

export function createGeometryRasterRuntimeOwner({ state, surface, helpers: h, effects: e, client = null }) {
  const worker = client || createGeometryRasterWorkerClient({ onMetric: e.recordMetric });
  const pending = new Map();
  // The client coalesces A -> B -> A onto A's original promise. Keep one
  // consumer per identity so an obsolete subscriber cannot close A's bitmap.
  const inFlight = new Map();
  let politicalFrame = null;
  let disposed = false;
  const close = (result) => result?.bitmap?.close?.();
  const enabled = () => !disposed && worker.available() && h.isEnabled() && state.firstVisibleFramePainted
    && !state.startupReadonly && !state.startupReadonlyUnlockInFlight;

  function describe(kind, entries) {
    const projection = surface.getProjection();
    const transform = { x: state.zoomTransform.x, y: state.zoomTransform.y, k: state.zoomTransform.k };
    const projectionKey = String(identityOf(projection));
    const sceneKey = [state.activeScenarioId, state.sceneGeneration, state.scenarioDataGeneration,
      state.topologyRevision, identityOf(state.landData)].join(":");
    const layout = kind === "political" ? h.getPoliticalLayout() : null;
    const width = kind === "political" ? (layout.pixelWidth ?? Math.floor(layout.paddedWidth * state.dpr)) : surface.getHitCanvas().width;
    const height = kind === "political" ? (layout.pixelHeight ?? Math.floor(layout.paddedHeight * state.dpr)) : surface.getHitCanvas().height;
    const semanticKey = kind === "political" ? h.getPoliticalSignature()
      : [identityOf(state.idToKey), state.mapSemanticMode, state.scenarioShellOverlayRevision, state.sovereigntyRevision].join(":");
    const contentKey = entries.map(({ id, feature, fillColor, strokeColor, lineWidth }) =>
      [id, identityOf(feature.geometry), fillColor, strokeColor, lineWidth]);
    const identity = JSON.stringify([kind, sceneKey, projectionKey, transform, width, height, state.dpr, layout, semanticKey, contentKey]);
    return { kind, sceneKey, projectionKey, identity, transform, width, height,
      dpr: state.dpr, offsetX: layout?.offsetX || 0, offsetY: layout?.offsetY || 0 };
  }

  function projectionOptions() {
    const projection = surface.getProjection();
    const result = { factory: "geoEqualEarth", pointRadius: h.pointRadius };
    for (const key of ["scale", "translate", "center", "rotate", "angle", "reflectX", "reflectY", "precision", "clipAngle", "clipExtent"]) {
      if (typeof projection[key] === "function") result[key] = projection[key]();
    }
    return result;
  }

  function getPoliticalEntries() {
    const items = h.collectPoliticalItems();
    if (!items) return null;
    const entries = [];
    for (const item of h.orderPoliticalItems(items)) {
      const { feature } = item;
      const id = item.id || h.getFeatureId(feature);
      if (!id || !feature?.geometry || h.excludeVisual(feature, id) || h.skipVisual(feature)) continue;
      const fillColor = h.resolveFillColor(feature, id, item.drawOrder);
      entries.push({ id, feature, fillColor, strokeColor: h.resolveStrokeColor(feature, fillColor),
        lineWidth: 0.75 / Math.max(0.0001, state.zoomTransform.k) });
    }
    return entries;
  }

  function preparePolitical({ force = false } = {}) {
    if (!enabled() || h.hasPendingColorEdit()) return null;
    if (!force && !h.needsPoliticalRender()) return null;
    const entries = getPoliticalEntries();
    if (!entries) return null;
    const description = describe("political", entries);
    if (politicalFrame?.identity === description.identity) return null;
    if (pending.get("political")?.identity === description.identity) return pending.get("political").promise;
    close(politicalFrame?.result);
    politicalFrame = null;
    const existing = inFlight.get(description.identity);
    if (existing) {
      pending.set("political", existing);
      return existing.promise;
    }
    const task = { identity: String(description.identity) };
    let receivedResult = null;
    task.promise = worker.request({ ...description, projectionOptions: projectionOptions(), entries }).then((result) => {
      receivedResult = result;
      if (!result) {
        if (!disposed && pending.get("political") === task) e.requestRender("geometry-worker-fallback");
        return;
      }
      const currentEntries = enabled() && !h.hasPendingColorEdit() ? getPoliticalEntries() : null;
      if (pending.get("political") !== task || !currentEntries
        || describe("political", currentEntries).identity !== task.identity) {
        close(result);
        e.recordMetric("geometryWorkerStaleResult", 0, { kind: "political" });
        return;
      }
      close(politicalFrame?.result);
      politicalFrame = { identity: task.identity, result, ids: new Set(entries.map((entry) => entry.id)) };
      e.requestRender("geometry-worker-political-ready");
    }).catch(() => {
      if (receivedResult !== politicalFrame?.result) close(receivedResult);
      if (!disposed && pending.get("political") === task) e.requestRender("geometry-worker-fallback");
    }).finally(() => {
      if (pending.get("political") === task) pending.delete("political");
      if (inFlight.get(task.identity) === task) inFlight.delete(task.identity);
    });
    pending.set("political", task);
    inFlight.set(task.identity, task);
    return task.promise;
  }

  function drawPolitical() {
    if (!enabled() || h.hasPendingColorEdit() || !politicalFrame) return null;
    const entries = getPoliticalEntries();
    if (!entries || politicalFrame.identity !== describe("political", entries).identity) return null;
    const context = surface.getContext();
    const startedAt = performance.now();
    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.drawImage(politicalFrame.result.bitmap, 0, 0);
    } finally { context.restore(); }
    e.recordMetric("geometryWorkerPoliticalCommit", performance.now() - startedAt, {
      renderedCount: politicalFrame.result.renderedCount,
    });
    return { fillMs: performance.now() - startedAt, strokeMs: 0,
      renderedCount: politicalFrame.result.renderedCount, renderedIds: politicalFrame.ids };
  }

  function getHitEntries() {
    const collected = h.collectHitItems();
    if (!collected) return null;
    const entries = [];
    for (const item of collected.items) {
      const key = state.idToKey.get(item.id);
      if (!key || !item.feature?.geometry || h.excludeHit(item.feature, item.id)) continue;
      entries.push({ id: item.id, feature: item.feature, fillColor: h.keyToColor(key) });
    }
    return { collected, entries };
  }

  function requestHit(details = {}) {
    if (!enabled() || !state.hitCanvasDirty) return false;
    const current = getHitEntries();
    if (!current) return false;
    const { collected, entries } = current;
    const description = describe("hit", entries);
    if (pending.get("hit")?.identity === description.identity) return true;
    const existing = inFlight.get(description.identity);
    if (existing) {
      pending.set("hit", existing);
      return true;
    }
    const task = { identity: String(description.identity) };
    task.promise = worker.request({ ...description, projectionOptions: projectionOptions(), entries }).then((result) => {
      if (!result) {
        if (!disposed && pending.get("hit") === task) e.requestRender("geometry-worker-hit-fallback");
        return;
      }
      try {
        if (!enabled() || pending.get("hit") !== task || !state.hitCanvasDirty) return;
        const currentEntries = getHitEntries()?.entries;
        if (!currentEntries || describe("hit", currentEntries).identity !== task.identity) return;
        e.commitHit(result, { ...collected.stats, visibleItemCount: collected.items.length,
          drawnItemCount: entries.length, ...details });
      } finally { close(result); }
    }).catch(() => {
      if (!disposed && pending.get("hit") === task) e.requestRender("geometry-worker-hit-fallback");
    }).finally(() => {
      if (pending.get("hit") === task) pending.delete("hit");
      if (inFlight.get(task.identity) === task) inFlight.delete(task.identity);
    });
    pending.set("hit", task);
    inFlight.set(task.identity, task);
    return true;
  }

  function prepareFrame() {
    if (state.renderPhase !== "idle" || state.deferExactAfterSettle) return false;
    return !!preparePolitical();
  }

  return Object.freeze({ prepareFrame, preparePolitical, drawPolitical, requestHit,
    getPendingWorkCount: () => inFlight.size,
    dispose() { disposed = true; worker.dispose(); close(politicalFrame?.result); politicalFrame = null; pending.clear(); inFlight.clear(); } });
}
