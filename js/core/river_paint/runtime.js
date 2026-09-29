import { sameRiverParentGeometry } from './geometry_identity.js';
import {
  collectRiverCellIdsForParents, getActiveRiverPack, getRiverParentCompatibility,
  getRiverPartitionIndex, normalizeRiverPartitionPack,
} from './partition_model.js';
import { setRiverPaintEditModeState, setRiverPaintState } from '../state/actions/river_paint_actions.js';

const runtimes = new WeakMap();
const EMPTY = Object.freeze([]);
const featureId = feature => String(feature?.properties?.id || feature?.id || '');

export function createRiverPaintRuntime(state, { geoContains = (feature, point) => globalThis.d3.geoContains(feature, point) } = {}) {
  let scene = '', requestGeneration = 0, controller = null, pending = null;
  let status = 'idle', error = '';
  let pinnedCache = null, surfaceCache = null;
  const cellFeatures = new Map();
  let compositions = 0;
  const identity = () => [state.activeScenarioId || '', state.sceneGeneration || 0, state.scenarioBaselineHash || ''].join('|');
  const activePack = () => getActiveRiverPack(state.riverPaint, state.activeScenarioId, state.scenarioBaselineHash || '');
  function syncScene() {
    const next = identity();
    if (scene === next) return;
    scene = next; requestGeneration += 1; controller?.abort(); controller = null; pending = null;
    status = 'idle'; error = ''; pinnedCache = surfaceCache = null; cellFeatures.clear();
  }
  function cancel() {
    requestGeneration += 1; controller?.abort(); controller = null; pending = null;
    status = 'idle'; error = '';
  }
  function setMode(enabled) {
    syncScene();
    if (!enabled) cancel();
    setRiverPaintEditModeState(state, enabled);
  }
  async function enable(loadPack) {
    syncScene();
    setRiverPaintEditModeState(state, true);
    if (activePack()) { status = 'ready'; error = ''; return { ready: true, geometryChanged: false }; }
    if (pending) return pending;
    const generation = ++requestGeneration, expectedScene = scene;
    controller = new AbortController();
    const signal = controller.signal;
    status = 'loading'; error = '';
    const task = (async () => {
      try {
        const pack = normalizeRiverPartitionPack(await Promise.resolve().then(() => loadPack({ signal })));
        if (generation !== requestGeneration || expectedScene !== identity() || signal.aborted) return { ready: false, stale: true };
        if (!state.riverPaint?.editMode) { cancel(); return { ready: false, stale: true }; }
        if (pack.sceneId !== state.activeScenarioId || (pack.source.baselineHash && pack.source.baselineHash !== state.scenarioBaselineHash)) {
          throw new Error('River partition pack does not match this scenario baseline');
        }
        setRiverPaintState(state, { schemaVersion: 1, editMode: true, pack, overrides: {} });
        status = 'ready';
        return { ready: true, geometryChanged: true };
      } catch (failure) {
        if (generation !== requestGeneration || expectedScene !== identity() || signal.aborted) return { ready: false, stale: true };
        status = 'error'; error = failure?.message || String(failure);
        throw failure;
      } finally {
        if (generation === requestGeneration) { pending = null; controller = null; }
      }
    })();
    pending = task;
    return task;
  }

  // Small, immutable geometry pins are a derived display product. They do not
  // mutate topology, membership, source feature properties, or introduce IDs.
  // The reviewed baseline hash permits coarse/fine geometry changes inside the
  // same dataset, but never reuse against a new baseline or another scenario.
  function pinCollection(collection) {
    syncScene();
    const pack = activePack();
    if (!pack || !Array.isArray(collection?.features)) return collection;
    if (pinnedCache?.source === collection && pinnedCache.pack === pack) return pinnedCache.result;
    const index = getRiverPartitionIndex(pack);
    let changed = false;
    const features = collection.features.map(feature => {
      const id = featureId(feature);
      const parent = index.parents.get(id), support = index.support.get(id);
      const geometry = parent?.parentGeometry || support?.geometry;
      if (!geometry || geometry === feature.geometry) return feature;
      // Unversioned synthetic inputs may be pinned only when the actual source
      // geometry matches. Production assets always declare a baseline hash.
      if (!pack.source.baselineHash && getRiverParentCompatibility(pack, feature, id).status === 'geometry-mismatch') return feature;
      changed = true;
      return { ...feature, geometry };
    });
    const result = changed ? { ...collection, features } : collection;
    pinnedCache = { source: collection, pack, result };
    return result;
  }

  function surfaces(features = state.landData?.features || EMPTY) {
    syncScene();
    const pack = activePack();
    if (!pack) return features;
    if (surfaceCache?.source === features && surfaceCache.pack === pack) return surfaceCache.result;
    cellFeatures.clear();
    const index = getRiverPartitionIndex(pack), result = [];
    for (const feature of features) {
      const id = featureId(feature);
      const parent = index.parents.get(id);
      if (!parent || getRiverParentCompatibility(pack, feature, id).status !== 'ready') { result.push(feature); continue; }
      for (const cell of parent.cells) {
        const child = Object.freeze({ ...feature, id: cell.id,
          properties: Object.freeze({ ...feature.properties, id: cell.id, __riverParentId: id }),
          geometry: cell.geometry });
        result.push(child); cellFeatures.set(cell.id, child);
      }
    }
    compositions += 1;
    surfaceCache = { source: features, pack, result: Object.freeze(result) };
    return surfaceCache.result;
  }
  function getCellFeature(id) { surfaces(); return cellFeatures.get(id) || null; }
  function getParentFeature(feature) {
    const id = feature?.properties?.__riverParentId;
    return id ? state.landIndex?.get(id) || null : feature;
  }
  function refineHit(hit, lonLat) {
    syncScene();
    if (hit?.targetType !== 'land' || !hit.id || state.isEditingPreset
      || !['fill', 'eraser', 'eyedropper'].includes(state.currentTool)) return hit;
    const editing = !!state.riverPaint?.editMode && state.interactionGranularity !== 'country';
    if (!editing && state.currentTool !== 'eyedropper') return hit;
    const pack = activePack();
    if (!pack) return editing ? { ...hit, riverBlockedReason: status === 'loading' ? 'loading' : error || 'unavailable' } : hit;
    const parent = getRiverPartitionIndex(pack).parents.get(hit.id);
    if (!parent) return hit;
    const compatibility = getRiverParentCompatibility(pack, state.landIndex?.get(hit.id), hit.id);
    if (compatibility.status !== 'ready') return { ...hit, riverBlockedReason: compatibility.status };
    if (!Array.isArray(lonLat) || lonLat.some(v => !Number.isFinite(v))) return { ...hit, riverBlockedReason: 'outside' };
    const matches = parent.cells.filter(cell => geoContains({ type: 'Feature', properties: {}, geometry: cell.geometry }, lonLat));
    if (matches.length !== 1) return { ...hit, riverBlockedReason: matches.length ? 'ambiguous-boundary' : 'outside' };
    return { ...hit, riverCellId: matches[0].id, riverPackId: pack.packId };
  }
  function assertReadyForExport() {
    syncScene();
    const saved = state.riverPaint?.pack;
    if (!saved) {
      if (status === 'loading') throw new Error('River partitions are still loading');
      return;
    }
    const pack = activePack();
    if (!pack) throw new Error('Saved river partitions do not match the current scenario baseline');
    for (const parent of pack.parents) {
      if (getRiverParentCompatibility(pack, state.landIndex?.get(parent.parentId), parent.parentId).status !== 'ready') {
        throw new Error(`River partition geometry is not ready: ${parent.parentId}`);
      }
    }
    for (const support of pack.support) {
      if (!sameRiverParentGeometry(state.landIndex?.get(support.parentId)?.geometry, support.geometry)) {
        throw new Error(`River contour neighbor geometry is not ready: ${support.parentId}`);
      }
    }
  }
  return Object.freeze({
    enable, setMode, cancel, pinCollection, surfaces, getCellFeature, getParentFeature, refineHit, assertReadyForExport,
    getActivePack() { syncScene(); return activePack(); },
    expandDirtyIds(ids) { return [...new Set([...ids, ...collectRiverCellIdsForParents(state.riverPaint, ids)])]; },
    diagnostics() { syncScene(); return { status, error, scene, pending: !!pending,
      active: !!activePack(), saved: !!state.riverPaint?.pack, compositions, cellCount: cellFeatures.size }; },
  });
}

export function getRiverPaintRuntime(state) {
  if (!runtimes.has(state)) runtimes.set(state, createRiverPaintRuntime(state));
  return runtimes.get(state);
}
