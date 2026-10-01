import { buildCountryLabelCandidates, fitCountryLabel } from "./country_label_layout.js";

export function createCountryLabelLayoutWorkerHandler() {
  let generation = null;
  let countries = new Map();
  return ({ requestId, generation: nextGeneration, countryCode, polygons, options }) => {
    if (nextGeneration !== generation) {
      generation = nextGeneration;
      countries = new Map();
    }
    let record = countries.get(countryCode);
    const candidateBuilt = !record;
    if (!record) {
      record = { polygons, candidates: buildCountryLabelCandidates(polygons) };
      countries.set(countryCode, record);
    }
    const fit = record.candidates.length ? fitCountryLabel(record.candidates, {
      ...options, polygons: record.polygons,
    }) : null;
    return { requestId, generation, countryCode, fit, candidateBuilt, candidateCount: record.candidates.length };
  };
}

if (typeof self !== "undefined" && typeof self.postMessage === "function" && typeof document === "undefined") {
  const handle = createCountryLabelLayoutWorkerHandler();
  self.addEventListener("message", ({ data }) => {
    try { self.postMessage(handle(data)); }
    catch (error) { self.postMessage({ requestId: data.requestId, generation: data.generation, error: String(error?.message || error) }); }
  });
}
