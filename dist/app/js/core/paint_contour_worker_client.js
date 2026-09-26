import { createWorkerTaskClient } from './worker_task_client.js';
import { createPaintContourGraphBuilder } from './renderer/paint_contour_graph.js';

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
  let fallback = null, generation = 0;
  const abort = () => new DOMException('Stale paint contour request', 'AbortError');
  async function build(features, removedIds, { reset = false } = {}) {
    const current = generation;
    const supported = isSupported();
    const dispatch = async (type, payload = {}) => {
      if (current !== generation) throw abort();
      let result;
      if (supported) result = await client.dispatchTask(type, payload);
      else {
        // Unsupported environments retain correctness. Yield between bounded
        // batches; normal browsers do all indexing/noding on the worker.
        await yieldToHost();
        if (current !== generation) throw abort();
        if (type === 'BEGIN') fallback = createPaintContourGraphBuilder();
        else if (type === 'PATCH') fallback.patch(payload.features, payload.removedIds);
        else result = fallback.finish();
      }
      if (current !== generation) throw abort();
      return result;
    };
    if (reset) await dispatch('BEGIN');
    if (removedIds.length) await dispatch('PATCH', { features: [], removedIds });
    let batch = [], points = 0;
    for (const feature of features) {
      const count = coordinateCount(feature.geometry);
      if (batch.length && (batch.length >= 128 || points + count > 32768)) {
        await dispatch('PATCH', { features: batch, removedIds: [] });
        batch = []; points = 0;
      }
      batch.push(feature); points += count;
    }
    if (batch.length) await dispatch('PATCH', { features: batch, removedIds: [] });
    return dispatch('FINISH');
  }
  return Object.freeze({ build, dispose() {
    generation += 1; fallback = null;
    client.terminate(new DOMException('Paint contour scene replaced', 'AbortError'));
  } });
}
