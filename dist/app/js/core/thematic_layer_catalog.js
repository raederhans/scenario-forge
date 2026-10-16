import defaultThematicLayerIndex from "../../data/thematic_layers/index.json" with { type: "json" };
import defaultWgiManifest from "../../data/thematic_layers/political/wgi_state_capacity_v1/manifest.json" with { type: "json" };
import defaultHdiManifest from "../../data/thematic_layers/social/human_development_v1/manifest.json" with { type: "json" };
import defaultPopulationManifest from "../../data/thematic_layers/population/wdi_population_v1/manifest.json" with { type: "json" };
import {
  resolveThematicLayerCatalogAssetKey,
  resolveThematicLayerManifestAssetKey,
} from "./runtime_asset_registry.js";
import {
  THEMATIC_WGI_LAYER_ID,
  isThematicWgiScenarioSupported,
} from "./thematic_wgi_data.js";
import { THEMATIC_HDI_LAYER_ID } from "./thematic_hdi_data.js";
import { THEMATIC_POPULATION_LAYER_ID } from "./thematic_population_data.js";
import { getThematicIndicator } from "./thematic_indicator_catalog.js";

export const THEMATIC_LAYER_RENDER_DISABLED_REASON = "Runtime rendering disabled";
export const THEMATIC_REAL_SOURCE_NOT_INGESTED_REASON = "Real source not ingested";
export const THEMATIC_REAL_SOURCE_DERIVED_METADATA_REASON = "Real-source derived metadata";
export const THEMATIC_CATALOG_PENDING_SUMMARY = "Preview metadata pending";
export const THEMATIC_CATALOG_READY_SUMMARY = "Preview metadata available";
export const THEMATIC_SOURCE_POLICY_FIXTURE_ONLY = "fixture_only";
export const THEMATIC_SOURCE_POLICY_REAL_SOURCE_CACHE_ONLY = "real_source_cache_only";
export const THEMATIC_WGI_MAIN_MAP_SUPPORT_LABEL = "WGI governance · Scenario reference";
export const THEMATIC_HDI_MAIN_MAP_SUPPORT_LABEL = "UNDP human development · Scenario reference";
export const THEMATIC_POPULATION_MAIN_MAP_SUPPORT_LABEL = "WDI population · Scenario reference";
export const THEMATIC_MAIN_MAP_SUPPORT_LABEL = "Country indicators · Scenario reference";

const MAIN_MAP_PROVIDERS = new Map([
  [THEMATIC_WGI_LAYER_ID, {
    sourceId: "world_bank_wgi_2025_revision", version: "7", year: 2024,
    release: "WGI 2025 Revision: Governance Estimates and Absolute Scores (1996-2024)",
    supportLabel: THEMATIC_WGI_MAIN_MAP_SUPPORT_LABEL,
  }],
  [THEMATIC_HDI_LAYER_ID, {
    sourceId: "undp_hdr_2025", version: "2025", year: 2023,
    release: "Human Development Report 2025",
    supportLabel: THEMATIC_HDI_MAIN_MAP_SUPPORT_LABEL,
  }],
  [THEMATIC_POPULATION_LAYER_ID, {
    sourceId: "world_bank_wdi_population", version: "2026-07-13", year: 2023,
    release: "World Development Indicators",
    supportLabel: THEMATIC_POPULATION_MAIN_MAP_SUPPORT_LABEL,
  }],
]);

function supportsMainMapRender(layerId, sourcePolicy, fixtureOnly, manifest) {
  const consumer = manifest?.runtime_consumer;
  const provider = MAIN_MAP_PROVIDERS.get(layerId);
  if (!provider) return false;
  const source = Array.isArray(manifest?.provenance)
    ? manifest.provenance.find((entry) => entry?.source_id === provider.sourceId) : null;
  return Boolean(manifest?.layer_id === layerId
    && manifest.schema_version === 1 && manifest.status !== "fixture" && !fixtureOnly
    && source?.version === provider.version && source.selected_year === provider.year && manifest.period?.year === provider.year
    && source.release === provider.release
    && sourcePolicy === THEMATIC_SOURCE_POLICY_REAL_SOURCE_CACHE_ONLY
    && manifest.source_policy === THEMATIC_SOURCE_POLICY_REAL_SOURCE_CACHE_ONLY
    && Array.isArray(manifest.metric_ids)
    && consumer?.status === "main_map_ready" && consumer.supports_main_map_render === true
    && Array.isArray(consumer.supported_metrics) && consumer.supported_metrics.length > 0
    && new Set(consumer.supported_metrics).size === consumer.supported_metrics.length
    && consumer.supported_metrics.every((metricId) => {
      const metric = getThematicIndicator(metricId);
      return metric?.layerId === layerId && metric.dataVersion === consumer.data_version
        && manifest.metric_ids.includes(metricId);
    })
    && Array.isArray(consumer.supported_scenarios) && consumer.supported_scenarios.length > 0
    && new Set(consumer.supported_scenarios).size === consumer.supported_scenarios.length
    && consumer.supported_scenarios.includes("modern_world")
    && consumer.supported_scenarios.every(isThematicWgiScenarioSupported));
}

function freezeArray(values = []) {
  return Object.freeze([...(Array.isArray(values) ? values : [])]);
}

function normalizeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

async function getAsset(key, options = {}) {
  const dataService = await import("./data_service.js");
  return dataService.getAsset(key, options);
}

function normalizeNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeLegend(value) {
  return Object.freeze({
    ...((value && typeof value === "object" && !Array.isArray(value)) ? value : {}),
  });
}

function normalizeDefaultStyle(value = {}) {
  const style = value && typeof value === "object" ? value : {};
  return Object.freeze({
    renderer: normalizeText(style.renderer, "unknown"),
    palette: normalizeText(style.palette, "unknown"),
    opacity: normalizeNumber(style.opacity, null),
    neutralValue: style.neutral_value ?? null,
  });
}

function normalizeManifestCoverageScope(value = {}) {
  const scope = value && typeof value === "object" ? value : {};
  return Object.freeze({
    geographyLevel: normalizeText(scope.geography_level, "unknown"),
    joinKeyType: normalizeText(scope.join_key_type, "unknown"),
    featureCount: normalizeNumber(scope.feature_count, null),
  });
}

function normalizePaths(value = {}) {
  const paths = value && typeof value === "object" ? value : {};
  return Object.freeze({
    metrics: normalizeText(paths.metrics),
    grid: normalizeText(paths.grid),
    buildAudit: normalizeText(paths.build_audit),
    sourceRecipes: freezeArray(paths.source_recipes),
  });
}

function createPayloadKind(layer = {}, manifest = null) {
  const paths = normalizePaths(manifest?.paths);
  const geometryKind = normalizeText(layer.geometry_kind || manifest?.geometry_kind);
  if (paths.metrics) return "Admin metrics available";
  if (paths.grid) return "Grid payload available";
  if (geometryKind.includes("grid")) return "Grid metadata available";
  return "Manifest metadata available";
}

function createSummaryText({
  statusLabel,
  sourcePolicyLabel,
  payloadKind,
  hiddenByDefault,
  renderSupportLabel = THEMATIC_LAYER_RENDER_DISABLED_REASON,
}) {
  return [
    statusLabel,
    sourcePolicyLabel,
    payloadKind,
    renderSupportLabel,
    hiddenByDefault ? "Hidden by default" : "Visible by default",
  ]
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(" | ");
}

function createRealSourceStatus(sourcePolicy) {
  if (sourcePolicy === THEMATIC_SOURCE_POLICY_REAL_SOURCE_CACHE_ONLY) {
    return THEMATIC_REAL_SOURCE_DERIVED_METADATA_REASON;
  }
  return THEMATIC_REAL_SOURCE_NOT_INGESTED_REASON;
}

function normalizeLayerSummary(layer = {}, {
  manifest = null,
  sourcePolicyLegend = {},
  statusLegend = {},
} = {}) {
  const layerId = normalizeText(layer.layer_id || manifest?.layer_id);
  const sourcePolicy = normalizeText(layer.source_policy || manifest?.source_policy, THEMATIC_SOURCE_POLICY_FIXTURE_ONLY);
  const status = normalizeText(layer.status || manifest?.status, "fixture");
  const defaultStyle = normalizeDefaultStyle(layer.default_style);
  const manifestCoverageScope = normalizeManifestCoverageScope(manifest?.coverage_scope);
  const featureCount = normalizeNumber(
    manifest?.feature_counts?.features ?? manifestCoverageScope.featureCount,
    null,
  );
  const payloadKind = createPayloadKind(layer, manifest);
  const hiddenByDefault = layer.default_visible !== true;
  const statusLabel = normalizeText(statusLegend[status], status);
  const sourcePolicyLabel = normalizeText(sourcePolicyLegend[sourcePolicy], sourcePolicy);
  const fixtureOnly = sourcePolicy === THEMATIC_SOURCE_POLICY_FIXTURE_ONLY || status === "fixture";
  const supportsRendering = supportsMainMapRender(layerId, sourcePolicy, fixtureOnly, manifest);
  const renderSupportLabel = supportsRendering
    ? MAIN_MAP_PROVIDERS.get(layerId).supportLabel
    : THEMATIC_LAYER_RENDER_DISABLED_REASON;
  const summary = createSummaryText({
    statusLabel,
    sourcePolicyLabel,
    payloadKind,
    hiddenByDefault,
    renderSupportLabel,
  });
  return Object.freeze({
    id: layerId,
    layerId,
    theme: normalizeText(layer.theme || manifest?.theme, "thematic"),
    title: supportsRendering ? renderSupportLabel
      : normalizeText(layer.title || manifest?.title, layerId || "Thematic layer"),
    description: normalizeText(layer.description || manifest?.description),
    geometryKind: normalizeText(layer.geometry_kind || manifest?.geometry_kind, "unknown"),
    manifestPath: normalizeText(layer.manifest_path),
    manifestLoaded: !!manifest,
    manifestRuntimeStatus: normalizeText(manifest?.runtime_consumer?.status, "catalog_only"),
    sourcePolicy,
    sourcePolicyLabel,
    status,
    statusLabel,
    coverageScope: normalizeText(layer.coverage_scope),
    manifestCoverageScope,
    featureCount,
    defaultVisible: layer.default_visible === true,
    hiddenByDefault,
    defaultStyle,
    renderer: defaultStyle.renderer,
    palette: defaultStyle.palette,
    opacity: defaultStyle.opacity,
    payloadKind,
    paths: normalizePaths(manifest?.paths),
    metricIds: freezeArray(manifest?.metric_ids),
    limitations: freezeArray(manifest?.limitations),
    fixtureOnly,
    supportsRuntimePreview: true,
    supportsMainMapRender: supportsRendering,
    runtimeMetricIds: freezeArray(supportsRendering ? manifest.runtime_consumer.supported_metrics : []),
    supportedScenarioIds: freezeArray(supportsRendering ? manifest.runtime_consumer.supported_scenarios : []),
    renderSupportLabel,
    disabledReason: supportsRendering ? "" : THEMATIC_LAYER_RENDER_DISABLED_REASON,
    realSourceStatus: createRealSourceStatus(sourcePolicy),
    summary,
  });
}

export function createEmptyThematicLayerCatalogPreview({
  status = "idle",
  error = "",
} = {}) {
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: "",
    assetKey: "",
    status: normalizeText(status, "idle"),
    error: normalizeText(error),
    layerCount: 0,
    loadedManifestCount: 0,
    sourcePolicyLegend: Object.freeze({}),
    statusLegend: Object.freeze({}),
    layers: Object.freeze([]),
    summary: normalizeText(error, THEMATIC_CATALOG_PENDING_SUMMARY),
  });
}

export function normalizeThematicLayerCatalogPayload(payload = defaultThematicLayerIndex, {
  assetKey = "",
  manifestByLayerId = {},
  status = "ready",
} = {}) {
  const catalog = payload && typeof payload === "object" ? payload : {};
  const sourcePolicyLegend = normalizeLegend(catalog.source_policy_legend);
  const statusLegend = normalizeLegend(catalog.status_legend);
  const manifestLookup = manifestByLayerId && typeof manifestByLayerId === "object" ? manifestByLayerId : {};
  const layers = (Array.isArray(catalog.layers) ? catalog.layers : [])
    .map((layer) => normalizeLayerSummary(layer, {
      manifest: manifestLookup[normalizeText(layer?.layer_id)] || null,
      sourcePolicyLegend,
      statusLegend,
    }))
    .filter((layer) => !!layer.layerId);
  const loadedManifestCount = layers.filter((layer) => layer.manifestLoaded).length;
  const supportsMainMapRender = layers.some((layer) => layer.supportsMainMapRender);
  return Object.freeze({
    schemaVersion: normalizeNumber(catalog.schema_version, 1),
    generatedAt: normalizeText(catalog.generated_at),
    assetKey: normalizeText(assetKey),
    status: normalizeText(status, "ready"),
    error: "",
    layerCount: layers.length,
    loadedManifestCount,
    sourcePolicyLegend,
    statusLegend,
    layers: Object.freeze(layers),
    supportsMainMapRender,
    summary: `${THEMATIC_CATALOG_READY_SUMMARY} | ${layers.length} layers | ${supportsMainMapRender ? THEMATIC_MAIN_MAP_SUPPORT_LABEL : THEMATIC_LAYER_RENDER_DISABLED_REASON}`,
  });
}

export function listDefaultThematicLayerSummaries() {
  // Synchronous panel contracts need a generated snapshot; runtime loading below still uses registry asset keys.
  return normalizeThematicLayerCatalogPayload(defaultThematicLayerIndex, {
    manifestByLayerId: {
      [THEMATIC_WGI_LAYER_ID]: defaultWgiManifest,
      [THEMATIC_HDI_LAYER_ID]: defaultHdiManifest,
      [THEMATIC_POPULATION_LAYER_ID]: defaultPopulationManifest,
    },
  }).layers;
}

export async function loadThematicLayerCatalogPreview({
  loadAsset = null,
} = {}) {
  const assetLoader = typeof loadAsset === "function" ? loadAsset : getAsset;
  const assetKey = resolveThematicLayerCatalogAssetKey();
  const catalog = await assetLoader(assetKey);
  const layers = Array.isArray(catalog?.layers) ? catalog.layers : [];
  const manifestEntries = await Promise.all(layers.map(async (layer) => {
    const layerId = normalizeText(layer?.layer_id);
    const manifestAssetKey = resolveThematicLayerManifestAssetKey(layerId);
    const manifest = await assetLoader(manifestAssetKey);
    return [layerId, manifest];
  }));
  return normalizeThematicLayerCatalogPayload(catalog, {
    assetKey,
    manifestByLayerId: Object.fromEntries(manifestEntries),
    status: "ready",
  });
}
