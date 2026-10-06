export const POPULATION_LAYER_ID = "population_ghsl_2020_v1";
export const POPULATION_DATA_VERSION = "ghsl-r2023a-e2020-v1";
export const POPULATION_YEAR = 2020;
export const POPULATION_SCENARIO_IDS = Object.freeze(["modern_world", "hoi4_1936", "hoi4_1939", "tno_1962"]);
export const POPULATION_BASE_PATH = "data/thematic_layers/population/ghsl_population_2020_v1/";
const requestsByFetcher = new WeakMap();
const tilesByFetcher = new WeakMap();
const tileIndexes = new WeakMap();
const detailIndexes = new WeakMap();
const ROW_STATUSES = Object.freeze(["ok", "partial_coverage", "no_data", "invalid_geometry",
  "overlapping_geometry", "unestimated_scenario_land", "water_not_applicable"]);

async function defaultFetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Population data request failed: ${response.status}`);
  return response.json();
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(`Invalid population data: ${message}`);
}
const finiteNonnegative = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function frozenCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy));
  if (value && typeof value === "object") return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, frozenCopy(child)])));
  return value;
}
function assetUrl(value) {
  requireCondition(typeof value === "string" && value.length > 0
    && !value.includes("..") && !/^(?:[a-z]+:|\/|\\)/i.test(value), "relative asset URL");
  return value.startsWith("data/") ? value : `${POPULATION_BASE_PATH}${value}`;
}

function validateManifest(manifest) {
  requireCondition(manifest?.schema_version === 1 && manifest.layer_id === POPULATION_LAYER_ID
    && manifest.data_version === POPULATION_DATA_VERSION, "manifest identity or version");
  requireCondition(manifest.source_policy === "real_source_cache_only" && manifest.status !== "fixture", "real-source policy");
  const source = manifest.source;
  requireCondition(manifest.period?.year === POPULATION_YEAR && source?.dataset === "GHS_POP"
    && source.release === "R2023A" && source.epoch === POPULATION_YEAR
    && source.resolution_m === 1000 && source.unit === "persons"
    && source.product === "GHS_POP_E2020_GLOBE_R2023A_54009_1000_V1_0", "GHSL source identity or epoch");
  requireCondition(manifest.coverage_status === "complete", "global source coverage is incomplete");
  const runtime = manifest.runtime_consumer;
  requireCondition(runtime?.status === "main_map_ready" && runtime.supports_main_map_render === true
    && (!runtime.data_version || runtime.data_version === POPULATION_DATA_VERSION), "runtime is not main-map ready");
  requireCondition(Array.isArray(runtime.supported_scenarios)
    && runtime.supported_scenarios.length === POPULATION_SCENARIO_IDS.length
    && new Set(runtime.supported_scenarios).size === POPULATION_SCENARIO_IDS.length
    && runtime.supported_scenarios.every((id) => POPULATION_SCENARIO_IDS.includes(id)), "full scenario support");
  for (const id of POPULATION_SCENARIO_IDS) {
    const scenario = manifest.scenarios?.[id];
    requireCondition(hash(scenario?.geometry_version) && Number.isInteger(scenario.feature_count)
      && scenario.feature_count > 0 && Number.isInteger(scenario.core_feature_count)
      && scenario.core_feature_count > 0 && Number.isInteger(scenario.extra_feature_count)
      && scenario.extra_feature_count >= 0
      && scenario.core_feature_count + scenario.extra_feature_count === scenario.feature_count, `${id} geometry or feature coverage`);
    assetUrl(scenario.features_url);
  }
  return manifest;
}

function normalizePayload(manifest, document, scenarioId, geometryVersion) {
  const scenario = manifest.scenarios[scenarioId];
  requireCondition(!geometryVersion || scenario.geometry_version === geometryVersion, "requested geometry version mismatch");
  requireCondition(document?.schema_version === 1 && document.layer_id === POPULATION_LAYER_ID
    && document.data_version === POPULATION_DATA_VERSION && document.scenario_id === scenarioId
    && document.source_epoch === POPULATION_YEAR && document.geometry_version === scenario.geometry_version,
  "feature document identity, epoch or geometry");
  requireCondition(document.features && typeof document.features === "object" && !Array.isArray(document.features)
    && document.feature_count === scenario.feature_count
    && Object.keys(document.features).length === scenario.feature_count, "complete feature count");
  const byFeatureId = Object.create(null);
  const counts = { features: scenario.feature_count, observed: 0, partial: 0, missing: 0, unestimated: 0, water: 0 };
  for (const [id, row] of Object.entries(document.features)) {
    requireCondition(id.trim() === id && id.length > 0 && row?.source_epoch === POPULATION_YEAR
      && ROW_STATUSES.includes(row.status), `${id} feature identity, epoch or status`);
    requireCondition(row.coverage_fraction === null || finiteNonnegative(row.coverage_fraction)
      && row.coverage_fraction <= 1, `${id} coverage fraction`);
    requireCondition(row.land_area_km2 === null || finiteNonnegative(row.land_area_km2), `${id} land area`);
    if (row.status === "ok") {
      requireCondition(finiteNonnegative(row.population) && finiteNonnegative(row.land_area_km2)
        && row.land_area_km2 > 0 && finiteNonnegative(row.density) && row.coverage_fraction === 1
        && Math.abs(row.density - row.population / row.land_area_km2)
          <= 1e-6 * Math.max(1, row.density), `${id} population or density consistency`);
      counts.observed += 1;
    } else if (row.status === "partial_coverage") {
      requireCondition(finiteNonnegative(row.population) && row.land_area_km2 > 0
        && row.coverage_fraction > 0 && row.coverage_fraction < 1 && row.density === null, `${id} partial coverage semantics`);
      counts.partial += 1;
    } else {
      requireCondition(row.population === null && row.density === null, `${id} unknown population must be null`);
      if (row.status === "no_data") requireCondition(row.coverage_fraction === 0, `${id} no-data coverage`);
      if (row.status === "water_not_applicable") {
        requireCondition((row.land_area_km2 === 0 || row.land_area_km2 === null)
          && row.coverage_fraction === null, `${id} water semantics`);
        counts.water += 1;
      } else if (row.status === "unestimated_scenario_land") {
        requireCondition(scenarioId === "tno_1962" && row.coverage_fraction === 0, `${id} scenario-land semantics`);
        counts.unestimated += 1;
      } else counts.missing += 1;
    }
    byFeatureId[id] = frozenCopy({ ...row, feature_id: id });
  }
  return Object.freeze({ layerId: POPULATION_LAYER_ID, dataVersion: POPULATION_DATA_VERSION,
    scenarioId, geometryVersion: scenario.geometry_version, year: POPULATION_YEAR,
    byFeatureId: Object.freeze(byFeatureId), counts: Object.freeze(counts),
    source: frozenCopy(manifest.source), raster: frozenCopy(manifest.raster || null),
    areaMethod: String(manifest.provenance?.land_area_method || "Political geometry minus Natural Earth lake geometry"),
    partitionMethod: String(manifest.provenance?.partition_method || ""),
    sourceResolution: manifest.source.resolution_m,
  });
}

export async function loadPopulationData({ scenarioId = "modern_world", geometryVersion = "", fetchJson = defaultFetchJson } = {}) {
  if (!POPULATION_SCENARIO_IDS.includes(scenarioId)) throw new RangeError(`Unsupported population scenario: ${scenarioId}`);
  if (typeof fetchJson !== "function") throw new TypeError("Population fetchJson must be a function");
  let cache = requestsByFetcher.get(fetchJson);
  if (!cache) {
    cache = { manifest: Promise.resolve().then(() => fetchJson(`${POPULATION_BASE_PATH}manifest.json`))
      .then(validateManifest).then(frozenCopy), payloads: new Map() };
    requestsByFetcher.set(fetchJson, cache);
    cache.manifest.catch(() => { if (requestsByFetcher.get(fetchJson) === cache) requestsByFetcher.delete(fetchJson); });
  }
  const key = JSON.stringify([scenarioId, geometryVersion]);
  if (!cache.payloads.has(key)) {
    const request = cache.manifest.then(async (manifest) => normalizePayload(manifest,
      await fetchJson(assetUrl(manifest.scenarios[scenarioId].features_url)), scenarioId, geometryVersion));
    cache.payloads.set(key, request);
    request.catch(() => { if (requestsByFetcher.get(fetchJson) === cache) requestsByFetcher.delete(fetchJson); });
  }
  return cache.payloads.get(key);
}

export function normalizePopulationTile(raw) {
  requireCondition(raw?.schema_version === 1 && raw.layer_id === POPULATION_LAYER_ID && raw.data_version === POPULATION_DATA_VERSION
    && raw.source_epoch === POPULATION_YEAR && raw.crs === "ESRI:54009", "raster tile identity");
  requireCondition(Number.isInteger(raw.width) && raw.width > 0 && raw.width <= 4096
    && Number.isInteger(raw.height) && raw.height > 0 && raw.height <= 4096
    && finiteNonnegative(raw.cell_size_m) && raw.cell_size_m > 0
    && Array.isArray(raw.bounds) && raw.bounds.length === 4 && raw.bounds.every(Number.isFinite)
    && raw.bounds[2] > raw.bounds[0] && raw.bounds[3] > raw.bounds[1]
    && Math.abs(raw.bounds[2] - raw.bounds[0] - raw.width * raw.cell_size_m) < 1e-6
    && Math.abs(raw.bounds[3] - raw.bounds[1] - raw.height * raw.cell_size_m) < 1e-6
    && Array.isArray(raw.cells), "raster tile dimensions");
  const indices = new Set();
  for (const cell of raw.cells) {
    requireCondition(Array.isArray(cell) && cell.length === 3 && Number.isInteger(cell[0])
      && cell[0] >= 0 && cell[0] < raw.width * raw.height && !indices.has(cell[0])
      && finiteNonnegative(cell[1]) && finiteNonnegative(cell[2]) && cell[2] > 0
      && cell[2] <= raw.cell_size_m * raw.cell_size_m / 1e6 + 1e-6, "raster count/covered-area cell");
    indices.add(cell[0]);
  }
  return frozenCopy(raw);
}

export async function loadPopulationRasterTile(url, { fetchJson = defaultFetchJson } = {}) {
  if (typeof fetchJson !== "function") throw new TypeError("Population fetchJson must be a function");
  const path = assetUrl(url);
  let cache = tilesByFetcher.get(fetchJson);
  if (!cache) { cache = new Map(); tilesByFetcher.set(fetchJson, cache); }
  if (!cache.has(path)) {
    const request = Promise.resolve().then(() => fetchJson(path)).then(normalizePopulationTile);
    cache.set(path, request);
    request.catch(() => { if (cache.get(path) === request) cache.delete(path); });
    while (cache.size > 64) cache.delete(cache.keys().next().value);
  }
  const request = cache.get(path);
  cache.delete(path); cache.set(path, request);
  return request;
}

export async function loadPopulationRasterTiles(raster, { detailTileIds = [], ...options } = {}) {
  requireCondition(raster && typeof raster.overview_url === "string"
    && Array.isArray(raster.detail_tiles), "raster descriptor");
  const overview = await loadPopulationRasterTile(raster.overview_url, options);
  const detail = [];
  const selected = new Set(detailTileIds);
  requireCondition(selected.size <= 32, "at most 32 viewport detail tiles");
  const tiles = raster.detail_tiles.filter((tile) => selected.has(tile.id));
  requireCondition(tiles.length === selected.size, "unknown viewport detail tile");
  // Bound concurrent downloads; no unbounded global request fan-out.
  for (let offset = 0; offset < tiles.length; offset += 4) {
    detail.push(...await Promise.all(tiles.slice(offset, offset + 4)
      .map((tile) => loadPopulationRasterTile(tile.url, options))));
  }
  return Object.freeze({ overview, detail: Object.freeze(detail) });
}

export function lonLatToPopulationGrid(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  const phi = lat * Math.PI / 180;
  let theta = phi;
  if (Math.abs(lat) === 90) theta = Math.sign(lat) * Math.PI / 2;
  else for (let index = 0; index < 40; index += 1) {
    const denominator = 2 + 2 * Math.cos(2 * theta);
    if (denominator === 0) { theta = Math.sign(phi) * Math.PI / 2; break; }
    const delta = (2 * theta + Math.sin(2 * theta) - Math.PI * Math.sin(phi)) / denominator;
    theta -= delta;
    if (Math.abs(delta) < 1e-12) break;
  }
  // ESRI:54009 uses the WGS84 semi-major axis for its spherical Mollweide equations.
  const radius = 6378137;
  return [2 * Math.SQRT2 / Math.PI * radius * lon * Math.PI / 180 * Math.cos(theta), Math.SQRT2 * radius * Math.sin(theta)];
}

function sampleTile(tile, x, y) {
  const [left, bottom, right, top] = tile.bounds;
  if (x < left || x >= right || y <= bottom || y > top) return null;
  const column = Math.floor((x - left) / tile.cell_size_m);
  const row = Math.floor((top - y) / tile.cell_size_m);
  let cells = tileIndexes.get(tile);
  if (!cells) { cells = new Map(tile.cells.map((cell) => [cell[0], cell])); tileIndexes.set(tile, cells); }
  const cell = cells.get(row * tile.width + column);
  return cell ? { status: "ok", population: cell[1], coveredAreaKm2: cell[2], density: cell[1] / cell[2] }
    : { status: "no_data", population: null, coveredAreaKm2: null, density: null };
}

export function samplePopulationDensityLonLat(snapshot, lon, lat, { lod = "overview" } = {}) {
  const point = lonLatToPopulationGrid(lon, lat);
  if (snapshot?.status !== "ready" || !point) return { status: "no_data", population: null, coveredAreaKm2: null, density: null };
  if (lod === "detail") {
    let index = detailIndexes.get(snapshot);
    if (!index) {
      const detail = snapshot.detail || [];
      const span = detail.length ? Math.max(...detail.map((tile) => Math.max(
        tile.bounds[2] - tile.bounds[0], tile.bounds[3] - tile.bounds[1]))) : 1;
      const buckets = new Map();
      for (const tile of detail) {
        const [left, bottom, right, top] = tile.bounds;
        for (let x = Math.floor(left / span); x <= Math.floor(right / span); x += 1) {
          for (let y = Math.floor(bottom / span); y <= Math.floor(top / span); y += 1) {
            const key = `${x},${y}`;
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(tile);
          }
        }
      }
      index = { span, buckets }; detailIndexes.set(snapshot, index);
    }
    const candidates = index.buckets.get(`${Math.floor(point[0] / index.span)},${Math.floor(point[1] / index.span)}`) || [];
    for (const tile of candidates) {
      const result = sampleTile(tile, ...point);
      if (result) return result;
    }
  }
  return snapshot.overview && sampleTile(snapshot.overview, ...point)
    || { status: "no_data", population: null, coveredAreaKm2: null, density: null };
}
