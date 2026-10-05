import { buildCountryLabelCandidates, filterCountryLabelHoles, fitCountryLabel } from "./country_label_layout.js";

export function createCountryLabelLayoutWorkerHandler() {
  let generation = null;
  let countries = new Map();
  return ({ requestId, generation: nextGeneration, countryCode, polygons, options }) => {
    if (nextGeneration !== generation) {
      generation = nextGeneration;
      countries = new Map();
    }
    let record = countries.get(countryCode);
    if (!record) {
      record = { polygons, candidateSets: new Map() };
      countries.set(countryCode, record);
    }
    const fitPolygons = filterCountryLabelHoles(record.polygons, options?.minHoleArea);
    // Thresholds retaining the same rings share candidates, including adjacent
    // zoom bands. Raw geometry remains intact for stricter future fits.
    const key = `${options?.allowArcs === true}:${fitPolygons.map((polygon) => polygon.length).join(",")}`;
    const candidateBuilt = !record.candidateSets.has(key);
    if (candidateBuilt) {
      record.candidateSets.set(key, buildCountryLabelCandidates(fitPolygons, { allowArcs: options?.allowArcs === true }));
      while (record.candidateSets.size > 4) record.candidateSets.delete(record.candidateSets.keys().next().value);
    }
    const candidates = record.candidateSets.get(key);
    const fit = candidates.length ? fitCountryLabel(candidates, {
      ...options, polygons: record.polygons,
    }) : null;
    return { requestId, generation, countryCode, fit, candidateBuilt, candidateCount: candidates.length,
      cachedCandidateSets: record.candidateSets.size };
  };
}

if (typeof self !== "undefined" && typeof self.postMessage === "function" && typeof document === "undefined") {
  const handle = createCountryLabelLayoutWorkerHandler();
  self.addEventListener("message", ({ data }) => {
    try { self.postMessage(handle(data)); }
    catch (error) { self.postMessage({ requestId: data.requestId, generation: data.generation, error: String(error?.message || error) }); }
  });
}
