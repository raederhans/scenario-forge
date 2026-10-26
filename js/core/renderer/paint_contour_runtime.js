import { getContourCoordinatePrecision } from '../paint_contour_source.js';
import { createPaintContourWorkerClient } from '../paint_contour_worker_client.js';
import { createPaintContourMesh } from './paint_contour_mesh.js';
import { createBorderClassification } from './border_classification.js';

const EMPTY = Object.freeze([]);
// Compare only fields sent by contourGeometry, without serialization, hashes or
// a second resident geometry copy. A flat stack bounds temporary traversal state.
function* sameCoordinates(left, right) {
  yield;
  if (Object.is(left, right)) return true;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const stack = [left, right, 0];
  while (stack.length) {
    const at = stack.length - 3, a = stack[at], b = stack[at + 1], index = stack[at + 2]++;
    if (index >= a.length) { stack.length = at; continue; }
    yield;
    if ((index in a) !== (index in b)) return false;
    if (Object.is(a[index], b[index])) continue;
    if (!Array.isArray(a[index]) || !Array.isArray(b[index]) || a[index].length !== b[index].length) return false;
    stack.push(a[index], b[index], 0);
  }
  return true;
}
function* sameContourGeometry(left, right) {
  yield;
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || left.type !== right.type) return false;
  if (left.type !== 'GeometryCollection') return yield* sameCoordinates(left.coordinates, right.coordinates);
  const a = left.geometries, b = right.geometries;
  if (Object.is(a, b)) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if ((index in a) !== (index in b) || !(yield* sameContourGeometry(a[index], b[index]))) return false;
  }
  return true;
}
export function createPaintContourRuntime({ state, getFeatures, getFeatureId,
  isEligible = () => true, resolveColor, onChange = () => {},
  resolveBoundaryKey = () => null,
  getBoundaryRevision = () => 0,
  separatePoliticalBorders = () => false,
  isArcEligible = () => true,
  resolveClassification = null,
  getClassificationRevision = () => [],
  client = createPaintContourWorkerClient(),
  schedule = callback => setTimeout(callback, 0),
  yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)),
  nowMs = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  let scene = '', sourceRef = null, sourceSignal = '', sourceVersion = 0, generation = 0;
  let sourceInputs = null;
  let topologyRevision = -1, geometryEpoch = 0, registeredEpoch = -1;
  let featuresById = new Map(), precisionById = new Map(), registered = null, registeredPrecision = null, view = null;
  let acknowledgedGraph = null;
  let inFlight = null, scheduled = false, revision = 0, paintRevision = -1;
  let boundaryRevision = null, bordersSeparated = false;
  // A geometry rebuild within one scene keeps the last paint-aware borders;
  // reverting to reference borders would revive edges the user painted away.
  let classificationRevision = [], classified = false, lastClassification = null;
  const shouldClassify = () => !!resolveClassification && !!state.activeScenarioId
    && state.activeScenarioId !== 'blank_base' && state.mapSemanticMode !== 'blank';
  let status = 'idle', error = '', graphDiagnostics = null, builds = 0, sentFeatures = 0;
  let reuseAcks = 0, comparedFeatures = 0, equalFeatures = 0, comparisonYields = 0, comparisonMaxSliceMs = 0;
  const sceneIdentity = () => [state.activeScenarioId || '', state.sceneGeneration || 0].join('|');
  function clear() {
    generation += 1; client.dispose(); registered = null; registeredPrecision = null; view = null; inFlight = null;
    acknowledgedGraph = null; lastClassification = null;
    status = 'idle'; error = ''; graphDiagnostics = null; revision += 1;
  }
  function queue() {
    if (scheduled || inFlight || !featuresById.size) return;
    scheduled = true;
    schedule(() => { scheduled = false; if (!inFlight && featuresById.size) start(); });
  }
  function syncSource(publication = null) {
    const nextScene = sceneIdentity();
    const sameScene = scene === nextScene;
    if (scene !== nextScene) { clear(); scene = nextScene; sourceRef = null; }
    const features = getFeatures() || EMPTY;
    const inputs = [state.scenarioDataGeneration || 0, state.showScenarioAtlantropa, state.showWaterRegions, state.mapSemanticMode];
    const sameInputs = sourceInputs?.every((value, index) => value === inputs[index]);
    const signal = [state.topologyRevision || 0, ...inputs].join('|');
    if (sourceRef === features && signal === sourceSignal && sameInputs) return;
    const nextTopologyRevision = Number(state.topologyRevision || 0);
    // A normal immutable source publication can be observed before its trailing
    // topology bump (for example by a color notification during adoption). The
    // publisher may certify that one adjacent bump; never retain an exemption
    // for a future revision or infer one from scenario-data generations.
    const publishedSource = sameScene && publication != null
      && publication.previousTopologyRevision === topologyRevision
      && nextTopologyRevision === topologyRevision + 1;
    // Adoption can already have compared this exact immutable source. Only its
    // certified trailing topology bump needs acknowledgement, not a second scan.
    if (publishedSource && sourceRef === features && sameInputs) {
      topologyRevision = nextTopologyRevision; sourceSignal = signal;
      syncPaint();
      return;
    }
    // Published geometry is normally immutable. An explicit topology revision
    // with the same collection also supports an in-place geometry publisher.
    const forcedGeometryRefresh = !publishedSource && sourceRef === features && topologyRevision !== nextTopologyRevision;
    topologyRevision = nextTopologyRevision;
    if (forcedGeometryRefresh) geometryEpoch += 1;
    sourceRef = features; sourceSignal = signal; sourceInputs = inputs;
    const next = new Map(), nextPrecision = new Map();
    for (const feature of features) {
      const id = getFeatureId(feature);
      if (id && isEligible(feature, id) && feature.geometry) {
        next.set(id, feature); nextPrecision.set(id, getContourCoordinatePrecision(feature.geometry));
      }
    }
    const geometryChanged = next.size !== featuresById.size || [...next].some(([id, feature]) => featuresById.get(id)?.geometry !== feature.geometry || precisionById.get(id) !== nextPrecision.get(id));
    featuresById = next; precisionById = nextPrecision;
    if (geometryChanged || forcedGeometryRefresh || status === 'idle') {
      sourceVersion += 1; view = null; revision += 1; status = next.size ? 'building' : 'empty';
      if (!next.size) { clear(); featuresById = next; status = 'empty'; }
      else queue();
    } else syncPaint(null, true);
  }
  function syncPaint(ids = null, force = false) {
    if (!view) return;
    const next = Number(state.colorRevision || 0);
    const nextBoundaryRevision = String(getBoundaryRevision());
    const nextBordersSeparated = !!separatePoliticalBorders();
    const nextClassificationRevision = getClassificationRevision();
    const modeChanged = classified !== shouldClassify();
    if (modeChanged) createView();
    const boundaryChanged = nextBoundaryRevision !== boundaryRevision || nextBordersSeparated !== bordersSeparated
      || modeChanged || nextClassificationRevision.length !== classificationRevision.length
      || nextClassificationRevision.some((value, index) => value !== classificationRevision[index]);
    if (!force && next === paintRevision && !boundaryChanged && ids == null) return;
    const scoped = !force && !boundaryChanged && ids && next === paintRevision + 1 ? ids : null;
    const changed = view.refresh(scoped) || modeChanged;
    if (changed) revision += 1;
    paintRevision = next;
    boundaryRevision = nextBoundaryRevision;
    bordersSeparated = nextBordersSeparated;
    classificationRevision = nextClassificationRevision;
    if (changed && (classified || modeChanged)) onChange('paint-contours-colors');
  }
  function createView() {
    classified = shouldClassify();
    view = classified
      ? createBorderClassification(acknowledgedGraph, id => {
        const feature = featuresById.get(id);
        return { ...resolveClassification(feature, id), color: resolveColor(feature, id) };
      }, { isArcEligible })
      : createPaintContourMesh(acknowledgedGraph, id => {
        const feature = featuresById.get(id);
        return feature ? resolveColor(feature, id) : null;
      }, {
        resolveBoundaryKey: id => {
          const feature = featuresById.get(id);
          return feature ? resolveBoundaryKey(feature, id) : null;
        },
        separatePoliticalBorders,
        isArcEligible,
      });
  }
  function start() {
    const ownedGeneration = generation, ownedVersion = sourceVersion, snapshot = featuresById;
    const epoch = geometryEpoch, snapshotPrecision = precisionById;
    const changed = [], removed = [];
    let equivalent = true;
    const owned = () => generation === ownedGeneration && inFlight === task;
    const current = () => owned() && sourceVersion === ownedVersion && geometryEpoch === epoch && sceneIdentity() === scene;
    const abort = () => new DOMException('Stale contour comparison', 'AbortError');
    function* compareSource() {
      for (const [id, feature] of snapshot) {
        yield;
        const previous = registered?.get(id);
        const forced = !previous || registeredEpoch !== epoch || registeredPrecision?.get(id) !== snapshotPrecision.get(id);
        if (forced || previous.geometry !== feature.geometry) {
          // Keep the original PATCH order, including equal replacements. Only
          // FINISH may be skipped; future edits must see the same builder history.
          changed.push({ id, geometry: feature.geometry, coordinatePrecision: snapshotPrecision.get(id) });
          if (forced) equivalent = false;
          else if (equivalent) {
            comparedFeatures++;
            if (yield* sameContourGeometry(previous.geometry, feature.geometry)) equalFeatures++;
            else equivalent = false;
          }
        }
      }
      for (const id of registered?.keys() || EMPTY) { yield; if (!snapshot.has(id)) removed.push(id); }
    }
    status = 'building'; error = '';
    let task;
    task = Promise.resolve().then(async () => {
      let dispatched = false;
      try {
        syncSource();
        if (!current()) throw abort();
        const iterator = compareSource();
        let work = 0, sliceStartedAt = nowMs();
        try {
          let next = iterator.next();
          while (!next.done) {
            if (++work % 512 === 0) {
              const sliceMs = nowMs() - sliceStartedAt;
              if (sliceMs >= 4) {
                comparisonMaxSliceMs = Math.max(comparisonMaxSliceMs, sliceMs); comparisonYields++;
                await yieldControl();
                syncSource();
                if (!current()) throw abort();
                sliceStartedAt = nowMs();
              }
            }
            next = iterator.next();
          }
          comparisonMaxSliceMs = Math.max(comparisonMaxSliceMs, nowMs() - sliceStartedAt);
        } finally { iterator.return(); }
        syncSource();
        if (!current()) throw abort();
        const reset = !registered, reuse = !reset && !!acknowledgedGraph && equivalent && !removed.length;
        sentFeatures += changed.length;
        if (!reuse) builds++;
        dispatched = true;
        const graph = await client.build(changed, removed, { reset, reuse, certifiedEquivalent: reuse && changed.length > 0 });
        if (!owned()) return;
        syncSource();
        if (!owned()) return;
        if (graph?.unchanged === true) {
          if (!reuse || !acknowledgedGraph) throw new Error('Unexpected contour reuse acknowledgement');
          reuseAcks++;
        } else acknowledgedGraph = graph;
        registered = snapshot; registeredPrecision = snapshotPrecision; registeredEpoch = epoch;
        if (!current()) return;
        // One full graph, owned by the latest real Worker ACK. Recreate the
        // current view so colors, ownership and eligibility are read afresh.
        createView();
        graphDiagnostics = acknowledgedGraph.diagnostics;
        paintRevision = Number(state.colorRevision || 0);
        boundaryRevision = String(getBoundaryRevision());
        bordersSeparated = !!separatePoliticalBorders();
        classificationRevision = getClassificationRevision();
        status = 'ready'; revision += 1;
        onChange('paint-contours-ready');
      } catch (failure) {
        if (!owned()) return;
        if (!dispatched && failure?.name === 'AbortError' && !current()) return;
        // A failed/stale geometry result must never revive reference borders.
        view = null; acknowledgedGraph = null; registered = null; registeredPrecision = null; lastClassification = null;
        status = 'error'; error = failure?.message || String(failure);
        client.dispose(); revision += 1; onChange('paint-contours-error');
      } finally {
        if (owned()) {
          inFlight = null;
          if (sourceVersion !== ownedVersion && status !== 'error') queue();
        }
      }
    });
    inFlight = task;
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
    getClassification() {
      syncSource(); syncPaint();
      if (classified && view) lastClassification = view.getMeshes();
      return shouldClassify() ? lastClassification : null;
    },
    getRevision() { syncSource(); syncPaint(); return revision; },
    // Call immediately after the publisher's topology bump, before other reads.
    // This certifies immutable geometry identities, not an in-place mutation.
    notifySourcePublished(publication) { const before = revision; syncSource(publication); return revision !== before; },
    notifyPaintChanged(ids = null) { const before = revision; syncSource(); syncPaint(ids); return revision !== before; },
    diagnostics() { syncSource(); syncPaint(); return { status, error, revision, sourceVersion, builds, sentFeatures,
      activeArcCount: view?.getActiveArcCount() || 0, reuseAcks, comparedFeatures, equalFeatures,
      comparisonYields, comparisonMaxSliceMs, ...graphDiagnostics,
      classificationArcs: classified && view ? view.getCounts() : null }; },
    dispose() { clear(); scene = ''; sourceRef = null; featuresById = new Map(); precisionById = new Map(); },
  });
}
