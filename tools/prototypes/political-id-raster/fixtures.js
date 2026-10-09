import { createReadonlyReferenceAssignments, getMapDataBoundary } from "../../../js/core/map_data_boundary.js";
import { getCountryCode, getFeatureId } from "../../../js/core/feature_identity.js";
import { createPoliticalFeaturePolicy } from "../../../js/core/renderer/political_feature_policy.js";
import { createPoliticalCollectionOwner } from "../../../js/core/renderer/political_collection_owner.js";

const ROOT = new URL("../../../", import.meta.url);
const SAMPLES = Object.freeze({
  hoi4_1936: { label: "HOI4 1936 · Central Europe", bounds: [4, 44, 18, 53] },
  hoi4_1939: { label: "HOI4 1939 · Central Europe", bounds: [4, 44, 18, 53] },
  tno_1962: { label: "TNO 1962 · Mediterranean / Adriatica", bounds: [7, 33, 26, 46] },
});
const text = (value) => String(value ?? "").trim().toLowerCase();
const hex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value.toLowerCase() : fallback;
const fieldDriven = (feature) => !!(text(feature?.properties?.atl_render_layer) || text(feature?.properties?.atl_color_rule));
const isSea = (feature) => text(feature?.properties?.atl_color_rule) === "atlantropa_sea"
  || (getCountryCode(feature) === "ATL" && text(feature?.properties?.atl_surface_kind) === "sea");

async function loadJson(url, loads, role) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Political fixture ${role}: HTTP ${response.status} (${url})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // A server may already decompress .gz via Content-Encoding. Inspect bytes,
  // never the filename, to avoid decompressing a decoded response twice.
  const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  let decoded = bytes;
  if (gzip) {
    if (typeof DecompressionStream !== "function") throw new Error("Fixture gzip requires DecompressionStream.");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    decoded = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  loads[role] = { url: String(url), responseBytes: bytes.byteLength, decodedBytes: decoded.byteLength, gzipDecodedHere: gzip };
  return JSON.parse(new TextDecoder().decode(decoded));
}

function overlapsGeographicBounds(bounds, sample) {
  const [[west, south], [east, north]] = bounds;
  const [sampleWest, sampleSouth, sampleEast, sampleNorth] = sample;
  if (![west, south, east, north].every(Number.isFinite) || north < sampleSouth || south > sampleNorth) return false;
  return west <= east
    ? east >= sampleWest && west <= sampleEast
    : sampleEast >= west || sampleWest <= east;
}

/** Standalone local sample, not the application's chunk/startup compositor. */
export async function loadPoliticalFixture(scenarioId, { width = 720, height = 480, dpr = 1 } = {}) {
  const startedAt = performance.now();
  const sample = SAMPLES[scenarioId];
  if (!sample) throw new RangeError(`Unsupported political fixture: ${scenarioId}`);
  if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0)
    || !Number.isFinite(dpr) || dpr <= 0 || Math.min(width, height) <= 16) {
    throw new RangeError("Fixture needs positive physical pixel dimensions and DPR.");
  }
  const { d3, topojson } = globalThis;
  if (!d3?.geoEqualEarth || !topojson?.feature) throw new Error("Load vendor D3 and TopoJSON before political fixtures.");
  const loads = {};
  const manifestUrl = new URL(`data/scenarios/${scenarioId}/manifest.json`, ROOT);
  const manifest = await loadJson(manifestUrl, loads, "manifest");
  for (const field of ["runtime_topology_url", "countries_url", "owners_url"]) {
    if (!manifest[field]) throw new Error(`Fixture manifest is missing ${field}.`);
  }
  const [topology, countries, ownerPayload] = await Promise.all([
    loadJson(new URL(manifest.runtime_topology_url, ROOT), loads, "topology"),
    loadJson(new URL(manifest.countries_url, ROOT), loads, "countries"),
    loadJson(new URL(manifest.owners_url, ROOT), loads, "owners"),
  ]);
  if (!topology.objects?.political) throw new Error("Fixture topology has no political object.");
  if (!countries.countries || !ownerPayload.owners) throw new Error("Fixture countries/owners payload is incomplete.");
  const state = {
    activeScenarioId: scenarioId,
    activeScenarioManifest: manifest,
    mapSemanticMode: "political",
    showScenarioAtlantropa: true,
    scenarioBaselineOwnersByFeatureId: createReadonlyReferenceAssignments(ownerPayload.owners),
    sovereignBaseColors: Object.fromEntries(Object.entries(countries.countries)
      .map(([tag, country]) => [tag.toUpperCase(), hex(country.color_hex, "#f0f0f0")])),
    visualOverrides: {},
    styleConfig: { ocean: { fillColor: hex(manifest.style_defaults?.ocean?.fillColor, "#aadaff") } },
  };
  const boundary = getMapDataBoundary(state);
  const policy = createPoliticalFeaturePolicy(state, {
    getSafeCanvasColor: hex,
    hasPendingPoliticalColorEdit: () => false,
    getRenderPassCacheState: () => ({}),
    getFeatureId,
    getFeatureCountryCodeNormalized: getCountryCode,
    isAtlantropaFieldDrivenFeature: fieldDriven,
    isInteractiveAtlantropaBooleanWeldIslandFeature: (feature, id) => String(id || getFeatureId(feature)).toUpperCase().startsWith("ATLISL_")
      && text(feature?.properties?.atl_geometry_role) === "donor_island"
      && text(feature?.properties?.atl_join_mode) === "boolean_weld",
    isScenarioAtlantropaVisible: () => state.showScenarioAtlantropa !== false,
    isBaseGeographyScenarioFeature: (feature) => feature?.properties?.render_as_base_geography === true,
    isStablePaintOrderEnabled: () => false,
  });
  const geometryOwner = createPoliticalCollectionOwner({ state, helpers: { getFeatureId, getFeatureCountryCodeNormalized: getCountryCode } });
  const political = topojson.feature(topology, topology.objects.political).features;
  const atlantropa = topology.objects.scenario_atlantropa
    ? topojson.feature(topology, topology.objects.scenario_atlantropa).features : [];
  // Match buildAtlantropaLandLikeFeatureCollection's bucket order. Water-layer
  // overlays are separate production passes and intentionally absent here.
  const extras = ["land", "shoal", "relief"].flatMap((layer) => atlantropa.filter((feature) => text(feature.properties?.atl_render_layer) === layer));
  const [west, south, east, north] = sample.bounds;
  const viewportRegion = { type: "Polygon", coordinates: [[
    [west, south], [west, north], [east, north], [east, south], [west, south],
  ]] };
  const projection = d3.geoEqualEarth().precision(0.1)
    .fitExtent([[8, 8], [width - 8, height - 8]], viewportRegion)
    .clipExtent([[0, 0], [width, height]]);
  const path = d3.geoPath(projection);
  const boundsCache = new WeakMap();
  function getBounds(feature) {
    if (boundsCache.has(feature)) return boundsCache.get(feature);
    const [[minX, minY], [maxX, maxY]] = path.bounds(feature);
    const result = { minX, minY, maxX, maxY };
    boundsCache.set(feature, result);
    return result;
  }
  const counts = {
    politicalSource: political.length, atlantropaSource: atlantropa.length, atlantropaLandLike: extras.length,
    ownersSource: Object.keys(ownerPayload.owners).length, countriesSource: Object.keys(countries.countries).length,
    duplicates: 0, invisible: 0, outsideGeographicSample: 0, outsideProjection: 0, normalizedWinding: 0,
    selected: 0, selectedAtlantropa: 0,
  };
  const seen = new Set();
  const features = [];
  for (const source of [...political, ...extras]) {
    const id = getFeatureId(source);
    if (!id) throw new Error("Fixture encountered a feature without a stable ID.");
    if (seen.has(id)) { counts.duplicates++; continue; }
    seen.add(id);
    if (policy.shouldExcludePoliticalVisualFeature(source, id)) { counts.invisible++; continue; }
    const feature = geometryOwner.normalizeFeatureGeometry(source, { sourceLabel: "political-id-fixture" });
    if (feature !== source) counts.normalizedWinding++;
    if (!overlapsGeographicBounds(d3.geoBounds(feature), sample.bounds)) { counts.outsideGeographicSample++; continue; }
    const projected = getBounds(feature);
    if (!Object.values(projected).every(Number.isFinite) || projected.maxX < 0 || projected.maxY < 0
      || projected.minX > width || projected.minY > height) { counts.outsideProjection++; continue; }
    features.push(feature);
    if (fieldDriven(feature)) counts.selectedAtlantropa++;
  }
  if (!features.length) throw new Error("Fixture selected no visible political features.");
  const collection = { type: "FeatureCollection", features };
  counts.selected = features.length;
  state.landData = collection;
  state.landIndex = new Map(features.map((feature) => [getFeatureId(feature), feature]));
  function resolveColor(feature, id = getFeatureId(feature)) {
    const rule = text(feature?.properties?.atl_color_rule);
    if (isSea(feature)) return hex(state.styleConfig.ocean.fillColor, "#aadaff");
    if (rule === "salt_flat") return hex(manifest.style_defaults?.atlantropa_salt_flat?.fillColor, "#7c6f53");
    if (rule === "shoal_pattern") return hex(manifest.style_defaults?.atlantropa_shoal?.fillColor, "#3a5d70");
    if (rule && rule !== "owner") throw new Error(`Unsupported fixture ATL color rule: ${rule}`);
    return boundary.paint.resolveFeatureColor(id, { getBaseGroupCode: () => boundary.reference.getBaseGroupCode(feature) }).color || "#f0f0f0";
  }
  // Validate rules now, before a harness starts a long build.
  features.forEach((feature) => resolveColor(feature));
  const metadata = {
    geographicSample: { name: sample.label, bounds: sample.bounds.slice(), order: "west,south,east,north" },
    source: "manifest.runtime_topology_url political + deduplicated scenario_atlantropa land/shoal/relief",
    manifestUrl: String(manifestUrl), loads, counts, width, height, dpr, strokeWidth: 0.75 * dpr,
    projection: { factory: "geoEqualEarth", scale: projection.scale(), translate: projection.translate(), precision: projection.precision(), clipExtent: projection.clipExtent() },
    paintOrder: "Stable topology feature array, followed by ATL land/shoal/relief; no runtime index sorting or river partition ranks.",
    stablePaintOrderDefault: "Production stable ranks activate with visible river partitions; this fixture has no partitions.",
    colorPolicy: "paint boundary owners/country palette; production ATL sea, salt_flat, shoal_pattern overrides; opaque fills only",
    limitations: ["No app startup, chunk promotion, shell replacement, or fragment camouflage integration.",
      "No rivers, water-layer overlays, relief textures, shoal patterns, borders, or full overlay integration.",
      "Native topology sample only; preserved array order does not reproduce a runtime spatial-index visible subset."],
    loadMs: performance.now() - startedAt,
  };
  console.info("Political ID fixture", { id: scenarioId, ...metadata });
  return {
    id: scenarioId, label: sample.label, collection, projection, getBounds, resolveColor, state, metadata,
    strokeCodeForEntry: (entry) => isSea(entry.feature) ? 0 : entry.code,
  };
}
