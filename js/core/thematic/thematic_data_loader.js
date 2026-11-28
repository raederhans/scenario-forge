import { frozenCopy } from "./frozen_copy.js";

export function createThematicDataLoader(basePath, normalizePayload, requireCondition) {
  const requestsByFetcher = new WeakMap();
  return async function loadPayload(fetchJson, metricId, scenarioId) {
    let cache = requestsByFetcher.get(fetchJson);
    if (!cache) {
      cache = { documents: null, payloads: new Map() };
      cache.documents = Promise.all([
        fetchJson(`${basePath}manifest.json`),
        fetchJson(`${basePath}metrics.admin0.json`),
      ]).then((documents) => documents.map(frozenCopy));
      requestsByFetcher.set(fetchJson, cache);
      cache.documents.catch(() => {
        if (requestsByFetcher.get(fetchJson) === cache) requestsByFetcher.delete(fetchJson);
      });
    }
    let request = cache.payloads.get(metricId);
    if (!request) {
      request = cache.documents.then(([manifest, metrics]) => normalizePayload(manifest, metrics, metricId));
      cache.payloads.set(metricId, request);
      request.catch(() => {
        if (cache.payloads.get(metricId) === request) cache.payloads.delete(metricId);
        if (requestsByFetcher.get(fetchJson) === cache) requestsByFetcher.delete(fetchJson);
      });
    }
    const payload = await request;
    if (!payload.supportedScenarios.includes(scenarioId) && requestsByFetcher.get(fetchJson) === cache) {
      requestsByFetcher.delete(fetchJson);
    }
    requireCondition(payload.supportedScenarios.includes(scenarioId), "requested scenario is not advertised");
    return payload;
  };
}
