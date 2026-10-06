import { loadPopulationData, loadPopulationRasterTiles, POPULATION_LAYER_ID, POPULATION_DATA_VERSION, POPULATION_YEAR } from "./population_spatial_data.js";
import { isPopulationRequested, isPopulationActive, getPopulationGeometryVersion } from "./population_spatial_view_model.js";
import { resetPopulationRuntimeState, setPopulationRuntimeState } from "./state/actions/population_spatial_actions.js";

const requests = new WeakMap();
const heatmapRequests = new WeakMap();

function captureSelection(state) {
  return { scenarioId: state.activeScenarioId, geometryVersion: getPopulationGeometryVersion(state),
    key: JSON.stringify([state.activeScenarioId, getPopulationGeometryVersion(state),
      state.styleConfig?.population?.enabled, state.styleConfig?.population?.dataVersion,
      state.latestScenarioApplyRequestId, state.currentScenarioApplyRequestId,
      state.activeScenarioChunks?.scenarioApplyEpoch, state.activeScenarioChunks?.scenarioApplyRequestId,
      state.renderTransactionDiagnostics?.scenarioApplyEpoch]) };
}
const matchesSelection = (state, selection) => isPopulationRequested(state)
  && !state.scenarioApplyInFlight && captureSelection(state).key === selection.key;

function validateRuntimePayload(state, data, selection) {
  if (!data || data.layerId !== POPULATION_LAYER_ID || data.dataVersion !== POPULATION_DATA_VERSION
    || data.scenarioId !== selection.scenarioId || data.geometryVersion !== selection.geometryVersion
    || data.year !== POPULATION_YEAR || !data.byFeatureId
    || !Number.isInteger(data.counts?.features) || data.counts.features <= 0
    || Object.keys(data.byFeatureId).length !== data.counts.features) {
    throw new Error("Population data does not match the selected scenario, geometry, epoch or full feature count.");
  }
  // Baseline assignments cover the whole political membership even in chunked scenes.
  for (const id of Object.keys(state.scenarioBaselineOwnersByFeatureId || {})) {
    if (!Object.hasOwn(data.byFeatureId, id)) throw new Error(`Population data is missing baseline feature ${id}.`);
  }
  return data;
}

export function ensurePopulationData(state, { onChange = () => {}, retry = false, loadData = loadPopulationData } = {}) {
  if (!state || typeof state !== "object") return Promise.resolve(null);
  const eligible = isPopulationRequested(state) && !state.scenarioApplyInFlight;
  let request = requests.get(state);
  if (!eligible || request && !matchesSelection(state, request.selection)) {
    requests.delete(state);
    heatmapRequests.delete(state);
    request = null;
    if (state.populationRuntime?.status && state.populationRuntime.status !== "idle") {
      resetPopulationRuntimeState(state);
      if (!eligible) onChange(state);
    }
  }
  if (!eligible) return Promise.resolve(null);
  if (request && state.populationRuntime === request.runtime) {
    if (request.runtime.status === "loading") return request.promise;
    if (request.runtime.status === "ready") return Promise.resolve(request.runtime.data);
    if (request.runtime.status === "failed" && !retry) return Promise.resolve(null);
  }
  request = { selection: captureSelection(state), runtime: setPopulationRuntimeState(state, { status: "loading" }), promise: null };
  requests.set(state, request);
  const publish = (patch) => {
    if (requests.get(state) !== request || state.populationRuntime !== request.runtime) return false;
    if (!matchesSelection(state, request.selection)) {
      requests.delete(state);
      heatmapRequests.delete(state);
      resetPopulationRuntimeState(state);
      onChange(state);
      return false;
    }
    request.runtime = setPopulationRuntimeState(state, patch);
    onChange(state);
    return true;
  };
  request.promise = Promise.resolve().then(() => {
    if (!request.selection.geometryVersion) throw new Error("Population statistics require the active scenario geometry version.");
    return loadData({ scenarioId: request.selection.scenarioId, geometryVersion: request.selection.geometryVersion });
  }).then((data) => validateRuntimePayload(state, data, request.selection)).then(
    (data) => publish({ status: "ready", data }) ? data : null,
    (error) => { publish({ status: "failed", error: error?.message || String(error) }); return null; },
  );
  onChange(state);
  return request.promise;
}

export function getPopulationHeatmapSnapshot(state) {
  const request = heatmapRequests.get(state);
  if (!isPopulationActive(state) || !request || request.data !== state.populationRuntime.data
    || !matchesSelection(state, request.selection)) {
    return { status: "idle", version: POPULATION_DATA_VERSION, revision: 0, error: "", overview: null, detail: [],
      detailCatalog: isPopulationActive(state) ? state.populationRuntime.data.raster?.detail_tiles || [] : [],
      requestedDetailTileIds: [], refinementStatus: "idle" };
  }
  return request.snapshot;
}

export function ensurePopulationHeatmapData(state, {
  onChange = () => {}, retry = false, loadTiles = loadPopulationRasterTiles, detailTileIds = [],
} = {}) {
  if (!isPopulationActive(state)) return Promise.resolve(null);
  let request = heatmapRequests.get(state);
  const selectedIds = [...new Set(retry && !detailTileIds.length && request?.snapshot.refinementStatus === "failed"
    ? request.snapshot.requestedDetailTileIds : detailTileIds)].sort();
  if (selectedIds.length > 32) return Promise.reject(new RangeError("At most 32 population viewport detail tiles may be requested."));
  const tileKey = JSON.stringify(selectedIds);
  let previous = null;
  if (request?.data === state.populationRuntime.data && matchesSelection(state, request.selection)) {
    if (request.tileKey === tileKey && request.snapshot.refinementStatus === "loading") return request.promise;
    if (request.snapshot.status === "ready" && !(retry && request.snapshot.refinementStatus === "failed")
      && selectedIds.every((id) => request.snapshot.loadedDetailTileIds.includes(id))) {
      return Promise.resolve(request.snapshot);
    }
    if (request.tileKey === tileKey && request.snapshot.refinementStatus === "failed" && !retry) return Promise.resolve(null);
    previous = request.snapshot;
  }
  request = { selection: captureSelection(state), data: state.populationRuntime.data, tileKey,
    snapshot: Object.freeze({ status: previous?.overview ? "ready" : "loading", version: POPULATION_DATA_VERSION,
      revision: (previous?.revision || 0) + 1, error: "", overview: previous?.overview || null,
      detail: previous?.detail || Object.freeze([]), loadedDetailTileIds: previous?.loadedDetailTileIds || Object.freeze([]),
      detailCatalog: state.populationRuntime.data.raster?.detail_tiles || Object.freeze([]),
      requestedDetailTileIds: Object.freeze(selectedIds), refinementStatus: "loading" }), promise: null };
  heatmapRequests.set(state, request);
  const ownsRequest = () => heatmapRequests.get(state) === request
    && isPopulationActive(state) && state.populationRuntime.data === request.data && matchesSelection(state, request.selection);
  request.promise = Promise.resolve().then(() => loadTiles(request.data.raster, { detailTileIds: selectedIds })).then((tiles) => {
    if (!tiles?.overview || !Array.isArray(tiles.detail)) throw new Error("Population heatmap tiles are incomplete.");
    if (!ownsRequest()) return null;
    request.snapshot = Object.freeze({ ...request.snapshot, ...tiles, status: "ready", refinementStatus: "ready",
      loadedDetailTileIds: Object.freeze(selectedIds), revision: request.snapshot.revision + 1 });
    onChange(state);
    return request.snapshot;
  }).catch((error) => {
    if (!ownsRequest()) return null;
    request.snapshot = Object.freeze({ ...request.snapshot, status: request.snapshot.overview ? "ready" : "failed", refinementStatus: "failed",
      error: error?.message || String(error), revision: request.snapshot.revision + 1 });
    onChange(state);
    return null;
  });
  onChange(state);
  return request.promise;
}
