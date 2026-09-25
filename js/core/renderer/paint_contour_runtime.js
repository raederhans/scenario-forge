import { createPaintContourWorkerClient } from '../paint_contour_worker_client.js';
import { createPaintContourMesh } from './paint_contour_mesh.js';

const EMPTY = Object.freeze([]);
export function createPaintContourRuntime({ state, getFeatures, getFeatureId,
  isEligible = () => true, resolveColor, onChange = () => {},
  client = createPaintContourWorkerClient(),
  schedule = callback => setTimeout(callback, 0),
} = {}) {
  let scene = '', sourceRef = null, sourceSignal = '', sourceVersion = 0, generation = 0;
  let topologyRevision = -1, geometryEpoch = 0, registeredEpoch = -1;
  let featuresById = new Map(), registered = null, view = null;
  let inFlight = null, scheduled = false, revision = 0, paintRevision = -1;
  let status = 'idle', error = '', graphDiagnostics = null, builds = 0, sentFeatures = 0;
  const sceneIdentity = () => [state.activeScenarioId || '', state.sceneGeneration || 0, state.scenarioDataGeneration || 0].join('|');
  function clear() {
    generation += 1; client.dispose(); registered = null; view = null; inFlight = null;
    status = 'idle'; error = ''; graphDiagnostics = null; revision += 1;
  }
  function queue() {
    if (scheduled || inFlight || !featuresById.size) return;
    scheduled = true;
    schedule(() => { scheduled = false; if (!inFlight && featuresById.size) start(); });
  }
  function syncSource() {
    const nextScene = sceneIdentity();
    if (scene !== nextScene) { clear(); scene = nextScene; sourceRef = null; }
    const features = getFeatures() || EMPTY;
    const signal = [state.topologyRevision || 0, state.showScenarioAtlantropa, state.showWaterRegions, state.mapSemanticMode].join('|');
    if (sourceRef === features && signal === sourceSignal) return;
    // Published geometry is normally immutable. An explicit topology revision
    // with the same collection also supports an in-place geometry publisher.
    const forcedGeometryRefresh = sourceRef === features && topologyRevision !== Number(state.topologyRevision || 0);
    topologyRevision = Number(state.topologyRevision || 0);
    if (forcedGeometryRefresh) geometryEpoch += 1;
    sourceRef = features; sourceSignal = signal;
    const next = new Map();
    for (const feature of features) {
      const id = getFeatureId(feature);
      if (id && isEligible(feature, id) && feature.geometry) next.set(id, feature);
    }
    const geometryChanged = next.size !== featuresById.size || [...next].some(([id, feature]) => featuresById.get(id)?.geometry !== feature.geometry);
    featuresById = next;
    if (geometryChanged || forcedGeometryRefresh || !view) {
      sourceVersion += 1; view = null; revision += 1; status = next.size ? 'building' : 'empty';
      if (!next.size) { clear(); featuresById = next; status = 'empty'; }
      else queue();
    } else syncPaint(null, true);
  }
  function syncPaint(ids = null, force = false) {
    if (!view) return;
    const next = Number(state.colorRevision || 0);
    if (!force && next === paintRevision && ids == null) return;
    const scoped = ids && next === paintRevision + 1 ? ids : null;
    if (view.refresh(scoped)) revision += 1;
    paintRevision = next;
  }
  async function start() {
    const ownedGeneration = generation, ownedVersion = sourceVersion, snapshot = featuresById;
    const epoch = geometryEpoch;
    const changed = [];
    for (const [id, feature] of snapshot) {
      if (!registered || registeredEpoch !== epoch || registered.get(id)?.geometry !== feature.geometry) changed.push({ id, geometry: feature.geometry });
    }
    const removed = registered ? [...registered.keys()].filter(id => !snapshot.has(id)) : [];
    status = 'building'; error = ''; sentFeatures += changed.length; builds += 1;
    const task = client.build(changed, removed, { reset: !registered });
    inFlight = task;
    try {
      const graph = await task;
      if (generation !== ownedGeneration || inFlight !== task) return;
      registered = snapshot; registeredEpoch = epoch;
      if (sourceVersion !== ownedVersion || sceneIdentity() !== scene) return;
      view = createPaintContourMesh(graph, id => {
        const feature = featuresById.get(id);
        return feature ? resolveColor(feature, id) : null;
      });
      graphDiagnostics = graph.diagnostics;
      paintRevision = Number(state.colorRevision || 0);
      status = 'ready'; revision += 1;
      onChange('paint-contours-ready');
    } catch (failure) {
      if (generation !== ownedGeneration || inFlight !== task) return;
      // A failed/stale geometry result must never revive reference borders.
      view = null; registered = null; status = 'error'; error = failure?.message || String(failure);
      client.dispose(); revision += 1; onChange('paint-contours-error');
    } finally {
      if (generation === ownedGeneration && inFlight === task) {
        inFlight = null;
        if (sourceVersion !== ownedVersion && status !== 'error') queue();
      }
    }
  }
  async function ensureReady() {
    syncSource();
    const expectedScene = scene;
    while (status === 'building') {
      if (inFlight) await inFlight.catch(() => {});
      else await new Promise(resolve => schedule(resolve));
      syncSource();
      if (scene !== expectedScene) throw new DOMException('Scene changed during contour preparation', 'AbortError');
    }
    if (status === 'error') throw new Error(`Paint contour preparation failed: ${error}`);
    syncPaint();
  }
  return Object.freeze({
    ensureReady,
    hasPendingWork: () => scheduled || !!inFlight || status === 'building',
    getMeshes() { syncSource(); syncPaint(); return view?.getActiveArcCount() ? [view.getMesh()] : EMPTY; },
    getRevision() { syncSource(); syncPaint(); return revision; },
    notifyPaintChanged(ids = null) { const before = revision; syncSource(); syncPaint(ids); return revision !== before; },
    diagnostics() { syncSource(); syncPaint(); return { status, error, revision, sourceVersion, builds, sentFeatures,
      activeArcCount: view?.getActiveArcCount() || 0, ...graphDiagnostics }; },
    dispose() { clear(); scene = ''; sourceRef = null; featuresById = new Map(); },
  });
}
