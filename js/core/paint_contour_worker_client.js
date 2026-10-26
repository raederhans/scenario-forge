import { createWorkerTaskClient } from './worker_task_client.js';
import { createPaintContourGraphBuilder } from './renderer/paint_contour_graph.js';
import { packGeometryCooperatively } from './cooperative_geometry_transport.js';

function contourGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object') return geometry;
  if (geometry.type === 'GeometryCollection') return { type: geometry.type,
    geometries: Array.isArray(geometry.geometries) ? geometry.geometries.map(contourGeometry) : geometry.geometries };
  return { type: geometry.type, coordinates: geometry.coordinates };
}

function coordinateCount(geometry) {
  if (geometry?.type === 'Polygon') return (geometry.coordinates || []).reduce((sum, ring) => sum + ring.length, 0);
  if (geometry?.type === 'MultiPolygon') return (geometry.coordinates || []).reduce((sum, polygon) => sum + polygon.reduce((n, ring) => n + ring.length, 0), 0);
  if (geometry?.type === 'GeometryCollection') return (geometry.geometries || []).reduce((sum, g) => sum + coordinateCount(g), 0);
  return 0;
}

export function createPaintContourWorkerClient({
  createWorker = () => new Worker(new URL('../workers/paint_contour.worker.js', import.meta.url), { type: 'module' }),
  isSupported = () => typeof Worker === 'function',
  yieldToHost = () => new Promise(resolve => setTimeout(resolve, 0)),
} = {}) {
  const client = createWorkerTaskClient({ createWorker, resolveMessage: message => message.result });
  let fallback = null, fallbackFinished = false, fallbackDirty = true, generation = 0, controller = new AbortController();
  const abort = () => new DOMException('Stale paint contour request', 'AbortError');
  async function build(features, removedIds, { reset = false, reuse = false, certifiedEquivalent = false,
    waterMask = undefined, nearSeamTolerance = 0.05 } = {}) {
    if (reuse && (reset || removedIds.length || (features.length && !certifiedEquivalent))) throw new TypeError('Contour reuse cannot mutate source');
    if (certifiedEquivalent && (!reuse || reset || removedIds.length || !features.length)) throw new TypeError('Invalid certified contour reuse');
    const current = generation;
    const signal = controller.signal;
    const supported = isSupported();
    const dispatch = async (type, payload = {}) => {
      if (current !== generation) throw abort();
      let result;
      if (supported) {
        let transfer = [];
        if (type === 'WATER' && payload.waterMask) {
          transfer = [payload.waterMask.land, payload.waterMask.water].flatMap(mask =>
            [mask.coordinates.buffer, mask.ringOffsets.buffer, mask.polygonOffsets.buffer]);
        }
        if (type === 'PATCH' && payload.features.length) {
          const updates = payload.features.map(({ id, geometry, coordinatePrecision }) => ({
            id, geometry: contourGeometry(geometry), coordinatePrecision,
          }));
          const packed = await packGeometryCooperatively(updates, { signal, yieldTask: yieldToHost,
            pack: batch => globalThis.__scenarioForgeGeometryTransferCodecShared.pack(batch, { minCoordinateCount: 0 }) });
          if (current !== generation) throw abort();
          payload = { features: null, removedIds: payload.removedIds, geometryTransport: packed.payload,
            certifiedEquivalent: payload.certifiedEquivalent };
          transfer = packed.transferables;
        }
        result = await client.dispatchTask(type, payload, { signal, transfer });
      }
      else {
        // Unsupported environments retain correctness. Yield between bounded
        // batches; normal browsers do all indexing/noding on the worker.
        await yieldToHost();
        if (current !== generation) throw abort();
        if (type === 'BEGIN') {
          fallback = createPaintContourGraphBuilder({ nearSeamTolerance }); fallbackFinished = false; fallbackDirty = true;
        } else if (type === 'WATER') {
          fallback.setWaterMask(payload.waterMask); fallbackDirty = true;
        } else if (type === 'CONFIRM') {
          if (!fallbackFinished || fallbackDirty) throw new Error('No completed unchanged contour graph');
          result = { unchanged: true };
        } else if (type === 'PATCH') {
          if (payload.certifiedEquivalent && (!fallbackFinished || fallbackDirty || payload.removedIds.length)) {
            throw new Error('No completed unchanged contour graph');
          }
          fallbackDirty = true;
          fallback.patch(payload.features, payload.removedIds);
          if (payload.certifiedEquivalent) fallbackDirty = false;
        } else {
          fallbackDirty = true;
          result = fallback.finish(); fallbackFinished = true; fallbackDirty = false;
        }
      }
      if (current !== generation) throw abort();
      return result;
    };
    if (reset) await dispatch('BEGIN', { nearSeamTolerance });
    if (waterMask !== undefined) await dispatch('WATER', { waterMask });
    if (removedIds.length) await dispatch('PATCH', { features: [], removedIds });
    let batch = [], points = 0;
    for (const feature of features) {
      const count = coordinateCount(feature.geometry);
      if (batch.length && (batch.length >= 128 || points + count > 32768)) {
        await dispatch('PATCH', { features: batch, removedIds: [], certifiedEquivalent });
        batch = []; points = 0;
      }
      batch.push(feature); points += count;
    }
    if (batch.length) await dispatch('PATCH', { features: batch, removedIds: [], certifiedEquivalent });
    return dispatch(reuse ? 'CONFIRM' : 'FINISH');
  }
  return Object.freeze({ build, dispose() {
    generation += 1; fallback = null; fallbackFinished = false; fallbackDirty = true;
    controller.abort(); controller = new AbortController();
    client.terminate(new DOMException('Paint contour scene replaced', 'AbortError'));
  } });
}
