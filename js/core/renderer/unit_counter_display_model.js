import {
  DEFAULT_UNIT_COUNTER_PRESET_ID,
  getUnitCounterEchelonLabel,
  getUnitCounterPresetById,
  normalizeUnitCounterSizeToken,
  UNIT_COUNTER_SCREEN_SIZE,
} from "../unit_counter_presets.js";

export const DEFAULT_UNIT_COUNTER_ORGANIZATION_PCT = 78;

export const DEFAULT_UNIT_COUNTER_EQUIPMENT_PCT = 74;

export const DEFAULT_UNIT_COUNTER_BASE_FILL = "#f4f0e6";

const UNIT_COUNTER_STATS_PRESETS = Object.freeze({
  elite: Object.freeze({ organizationPct: 94, equipmentPct: 92 }),
  regular: Object.freeze({ organizationPct: 82, equipmentPct: 78 }),
  worn: Object.freeze({ organizationPct: 68, equipmentPct: 62 }),
  understrength: Object.freeze({ organizationPct: 58, equipmentPct: 48 }),
  improvised: Object.freeze({ organizationPct: 47, equipmentPct: 42 }),
});

const UNIT_COUNTER_MILSTD_SIZE_BY_TOKEN = Object.freeze({
  small: 12,
  medium: 14,
  large: 18,
});

export const DEFAULT_UNIT_COUNTER_RENDERER = "game";

export function normalizeUnitCounterStatPercent(value, fallback = DEFAULT_UNIT_COUNTER_ORGANIZATION_PCT) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) {
    return Math.max(0, Math.min(100, Number(fallback) || 0));
  }
  return Math.max(0, Math.min(100, Math.round(nextValue)));
}

export function normalizeUnitCounterStatsPresetId(value, fallback = "regular") {
  const normalizedValue = String(value || "").trim().toLowerCase();
  if (normalizedValue === "random") return "random";
  return Object.prototype.hasOwnProperty.call(UNIT_COUNTER_STATS_PRESETS, normalizedValue)
    ? normalizedValue
    : fallback;
}

export function getUnitCounterStatsPreset(value, fallback = "regular") {
  const presetId = normalizeUnitCounterStatsPresetId(value, fallback);
  return UNIT_COUNTER_STATS_PRESETS[presetId] || UNIT_COUNTER_STATS_PRESETS.regular;
}

export function normalizeUnitCounterBaseFillColor(value) {
  const candidate = String(value || "").trim();
  return /^#(?:[0-9a-f]{6})$/i.test(candidate) ? candidate.toLowerCase() : "";
}

export function getNormalizedUnitCounterCombatState(candidate = {}) {
  const statsPresetId = normalizeUnitCounterStatsPresetId(candidate.statsPresetId || "regular");
  const presetDefaults = getUnitCounterStatsPreset(statsPresetId);
  const statsSource = ["preset", "random", "manual"].includes(String(candidate.statsSource || "").trim().toLowerCase())
    ? String(candidate.statsSource || "").trim().toLowerCase()
    : "preset";
  return {
    baseFillColor: normalizeUnitCounterBaseFillColor(candidate.baseFillColor),
    organizationPct: normalizeUnitCounterStatPercent(candidate.organizationPct, presetDefaults.organizationPct || DEFAULT_UNIT_COUNTER_ORGANIZATION_PCT),
    equipmentPct: normalizeUnitCounterStatPercent(candidate.equipmentPct, presetDefaults.equipmentPct || DEFAULT_UNIT_COUNTER_EQUIPMENT_PCT),
    statsPresetId,
    statsSource,
  };
}

export function normalizeUnitCounterNationSource(value, fallback = "display") {
  const source = String(value || "").trim().toLowerCase();
  return ["display", "controller", "owner", "active", "manual"].includes(source) ? source : fallback;
}

export function getUnitCounterScreenMetrics(size = "medium") {
  const token = normalizeUnitCounterSizeToken(size);
  return UNIT_COUNTER_SCREEN_SIZE[token] || UNIT_COUNTER_SCREEN_SIZE.medium;
}

export function getUnitCounterSlotOffset(slotIndex = 0, stackCount = 1, metrics = UNIT_COUNTER_SCREEN_SIZE.medium) {
  const count = Math.max(1, Number(stackCount) || 1);
  const index = Math.max(0, Number(slotIndex) || 0);
  const columns = count <= 2 ? count : count <= 4 ? 2 : 3;
  const rows = Math.max(1, Math.ceil(count / Math.max(1, columns)));
  const row = Math.floor(index / Math.max(1, columns));
  const col = index % Math.max(1, columns);
  const itemsInRow = row === rows - 1 ? Math.min(columns, count - row * columns) : columns;
  const x = (col - (itemsInRow - 1) / 2) * Math.max(metrics.width * 0.76, 18);
  const y = (row - (rows - 1) / 2) * Math.max(metrics.height * 0.84, 14);
  return [x, y];
}

export function compareUnitCounterRenderOrder(left, right) {
  const zDelta = Number(left?.zIndex || 0) - Number(right?.zIndex || 0);
  if (zDelta !== 0) return zDelta;
  const leftId = String(left?.id || "");
  const rightId = String(right?.id || "");
  if (leftId < rightId) return -1;
  if (leftId > rightId) return 1;
  return 0;
}

export function getUnitCounterNodeTransform(entry) {
  const projected = Array.isArray(entry?.projected) ? entry.projected : [0, 0];
  const slotOffset = Array.isArray(entry?.slotOffset) ? entry.slotOffset : [0, 0];
  const localScale = Number(entry?.scaleModel?.localScale || 1);
  return `translate(${projected[0]},${projected[1]}) scale(${localScale}) translate(${slotOffset[0]},${slotOffset[1]})`;
}

// State is read when a model is requested so scenario switches and zoom updates stay live.
export function createUnitCounterDisplayModel({
  runtimeState,
  canonicalCountryCode,
  getScenarioCountryDisplayName,
  ColorManager,
  t,
  getUnitCounterEffectiveSidc,
  getMilSymbolDataUri,
  getOperationalLineById,
  getLineMidpointFromCoordinates,
  clamp,
}) {
  function getUnitCounterNationMeta(tag) {
    const normalizedTag = canonicalCountryCode(tag);
    if (!normalizedTag) {
      return {
        tag: "",
        name: "",
        color: "#7c8ba1",
      };
    }
    const scenarioEntry = runtimeState.scenarioCountriesByTag?.[normalizedTag];
    const name = getScenarioCountryDisplayName(
      scenarioEntry,
      runtimeState.countryNames?.[normalizedTag] || normalizedTag
    ) || runtimeState.countryNames?.[normalizedTag] || normalizedTag;
    const color = String(
      scenarioEntry?.color_hex
      || scenarioEntry?.colorHex
      || runtimeState.countryPalette?.[normalizedTag]
      || ColorManager.getPoliticalFallbackColor(normalizedTag, 0)
      || "#7c8ba1"
    ).trim() || "#7c8ba1";
    return {
      tag: normalizedTag,
      name,
      color,
    };
  }

  function getUnitCounterCardModel(counter = {}, { stackCount = 1 } = {}) {
    const preset = getUnitCounterPresetById(counter.presetId || counter.unitType || DEFAULT_UNIT_COUNTER_PRESET_ID);
    const sizeToken = normalizeUnitCounterSizeToken(counter.size);
    const metrics = getUnitCounterScreenMetrics(sizeToken);
    const nation = getUnitCounterNationMeta(counter.nationTag);
    const renderer = String(counter.renderer || preset.defaultRenderer || DEFAULT_UNIT_COUNTER_RENDERER).trim().toLowerCase() === "milstd" ? "milstd" : "game";
    const sidc = getUnitCounterEffectiveSidc({
      ...counter,
      presetId: preset.id,
    });
    const combatState = getNormalizedUnitCounterCombatState(counter);
    return {
      counter,
      preset,
      renderer,
      metrics,
      nation,
      nationTag: nation.tag || "N/A",
      nationName: nation.name || t("Unassigned", "ui"),
      label: String(counter.label || "").trim(),
      subLabel: String(counter.subLabel || "").trim(),
      strengthText: String(counter.strengthText || "").trim(),
      baseFillColor: combatState.baseFillColor || DEFAULT_UNIT_COUNTER_BASE_FILL,
      baseFillColorOverride: combatState.baseFillColor,
      organizationPct: combatState.organizationPct,
      equipmentPct: combatState.equipmentPct,
      statsPresetId: combatState.statsPresetId,
      statsSource: combatState.statsSource,
      echelon: String(counter.echelon || preset.defaultEchelon || "").trim().toLowerCase(),
      echelonLabel: getUnitCounterEchelonLabel(counter.echelon || preset.defaultEchelon || ""),
      shortCode: String(counter.unitType || preset.shortCode || "").trim().toUpperCase() || preset.shortCode,
      iconId: String(counter.iconId || preset.iconId || "infantry").trim().toLowerCase() || "infantry",
      shellVariant: preset.shellVariant || "line",
      sidc,
      stackCount: Math.max(1, Number(stackCount) || 1),
      symbolUri: renderer === "milstd"
        ? getMilSymbolDataUri(sidc, UNIT_COUNTER_MILSTD_SIZE_BY_TOKEN[sizeToken] || UNIT_COUNTER_MILSTD_SIZE_BY_TOKEN.medium)
        : "",
      sizeToken,
    };
  }

  function getOperationalLineAnchorCoord(lineId = "") {
    const line = getOperationalLineById(lineId);
    if (!line || !Array.isArray(line.points) || line.points.length < 2) return null;
    return getLineMidpointFromCoordinates(line.points);
  }

  function getUnitCounterRenderAnchor(counter = {}) {
    const attachedLineId = String(counter?.attachment?.lineId || "").trim();
    if (attachedLineId) {
      const lineCoord = getOperationalLineAnchorCoord(attachedLineId);
      if (lineCoord) {
        return {
          coord: lineCoord,
          key: `line:${attachedLineId}`,
        };
      }
    }
    const lon = Number(counter?.anchor?.lon || 0);
    const lat = Number(counter?.anchor?.lat || 0);
    return {
      coord: [lon, lat],
      key: String(counter?.anchor?.featureId || "").trim() || `${Math.round(lon * 3)}:${Math.round(lat * 3)}`,
    };
  }

  function getUnitCounterRenderEntries() {
    const counters = Array.isArray(runtimeState.unitCounters) ? runtimeState.unitCounters : [];
    const grouped = new Map();
    counters.forEach((counter) => {
      const anchor = getUnitCounterRenderAnchor(counter);
      const key = String(anchor?.key || "");
      if (!grouped.has(key)) {
        grouped.set(key, { anchor, counters: [] });
      }
      grouped.get(key).counters.push(counter);
    });
    return Array.from(grouped.values()).flatMap((bucket) => {
      const sortedBucket = bucket.counters
        .slice()
        .sort(compareUnitCounterRenderOrder);
      return sortedBucket.map((counter, slotIndex) => ({
        counter,
        stackCount: sortedBucket.length,
        slotIndex,
        anchor: bucket.anchor,
      }));
    });
  }

  function getUnitCounterRenderScale(metrics, zoomK) {
    const normalizedZoom = Math.max(0.1, Number(zoomK) || 1);
    const zoomPercent = normalizedZoom * 100;
    const fixedScaleMultiplier = clamp(
      Number(runtimeState.annotationView?.unitCounterFixedScaleMultiplier) || 1.5,
      0.5,
      2.0,
    );
    const desiredScreenScale = 0.5 * fixedScaleMultiplier;

    const effectiveWidth = Number(metrics?.width || 0) * desiredScreenScale;
    const localScale = desiredScreenScale / normalizedZoom;
    const hidden = zoomPercent <= 600;
    const opacity = hidden ? 0 : 1;

    return {
      desiredScreenScale,
      localScale,
      effectiveWidth,
      hidden,
      opacity,
    };
  }

  return {
    getUnitCounterCardModel,
    getUnitCounterRenderEntries,
    getUnitCounterRenderScale,
  };
}
