import { normalizeHexColor } from "./color_hex_utils.js";
import { markDirty } from "./dirty_state.js";
import { captureHistoryState, pushHistoryEntry } from "./history_manager.js";
import { getCurrentScenarioValidFeatureIds } from "./interaction_funnel/import_trust_projection.js";
import {
  allocateProjectCountryTag, normalizeProjectCountriesPayload, registerProjectCountryState, remapProjectCountryNames,
} from "./project_countries.js";
import { createBorderIdentityResolver } from "./renderer/border_identity.js";
import { getActiveRiverPack, getRiverPartitionIndex } from "./river_paint/partition_model.js";
import { loadFeatureMergeLineage, loadFeatureMigrationMap, migrateScenarioPaintEntries } from "./sovereignty_manager.js";
import { state as runtimeState } from "./state.js";
import { patchLegendState } from "./state/actions/legend_actions.js";
import { restoreRiverPaintOverridesState } from "./state/actions/river_paint_actions.js";
import { commitChange } from "./state/changes.js";
import { callRuntimeHook } from "./state/index.js";

export async function loadScenarioReferenceData(scenarioId) {
  const { loadScenarioBundle } = await import("./scenario/scenario_resources.js");
  const [bundle, lineage, migrationMap] = await Promise.all([
    scenarioId ? loadScenarioBundle(scenarioId, { bundleLevel: "bootstrap" }) : null,
    loadFeatureMergeLineage(), loadFeatureMigrationMap(),
  ]);
  return { countries: bundle?.countriesPayload?.countries || {}, manifest: bundle?.manifest,
    ownersByFeatureId: bundle?.ownersPayload?.owners || {}, lineage, migrationMap };
}

const paintColor = value => typeof value === "string" ? normalizeHexColor(value) : null;

function countryResolver(countries, baseColors) {
  const tags = new Set(Object.keys(countries));
  const colors = Object.fromEntries([...tags].map(tag =>
    [tag, paintColor(baseColors?.[tag] ?? countries[tag].color_hex)]));
  const resolve = createBorderIdentityResolver({ sovereignBaseColors: colors, getCountryTags: () => tags,
    getReferenceOwner: reference => reference, getOverrideColor: (_, color) => color });
  return (color, reference) => {
    const tag = resolve(reference, color);
    return tags.has(tag) ? tag : "";
  };
}

function planCountries(source, current, patch, report) {
  const countries = normalizeProjectCountriesPayload(source.projectCountries);
  const destinations = new Map();
  if (!countries.length) return { countries, destinations };
  const reservedTags = new Set(countries.map(country => country.tag));
  const newTags = new Map();
  const existing = Object.entries(current.scenarioCountriesByTag || {}).map(([tag, entry]) => ({
    tag, name: entry.display_name, names: current.countryNameOverrides?.[tag],
    color: normalizeHexColor(current.sovereignBaseColors?.[tag]),
  }));
  const paintColors = project => [
    ...Object.values(project.visualOverrides || {}), ...Object.values(project.waterRegionOverrides || {}),
    ...Object.values(project.riverPaint?.overrides || {}), ...Object.keys(project.legendLabels || {}),
    ...Object.values(project.sovereignBaseColors || {}),
  ];
  const used = new Set(paintColors(current).map(paintColor));
  const reservedColors = new Set([...used, ...paintColors(source).map(paintColor)]);
  for (const { tag, name } of countries) {
    reservedTags.delete(tag);
    const color = paintColor(source.sovereignBaseColors?.[tag]);
    if (!color) report.invalidColors.push({ field: "projectCountries", id: tag });
    const names = source.countryNameOverrides?.[tag];
    const match = color && existing.find(other => other.color === color && ["en", "zh"].every(lang =>
      (other.names?.[lang] || other.name) === (names?.[lang] || name)));
    if (match) {
      destinations.set(tag, match);
      report.countryChanges.push({ from: tag, to: match.tag, color, name, action: "matched" });
      continue;
    }
    const next = color && current.activeScenarioId && allocateProjectCountryTag(current, { preferredTag: tag, reservedTags });
    if (!next) {
      report.countryChanges.push({ from: tag, to: null, color, name, action: "skipped" });
      continue;
    }
    let nextColor = color;
    if (used.has(color)) {
      const rgb = parseInt(color.slice(1), 16);
      for (let offset = 1; reservedColors.has(nextColor); offset++) {
        nextColor = "#" + (rgb ^ offset).toString(16).padStart(6, "0");
      }
    }
    reservedTags.add(next);
    used.add(nextColor);
    reservedColors.add(nextColor);
    newTags.set(tag, next);
    const country = { tag: next, name, color: nextColor };
    existing.push({ ...country, names });
    destinations.set(tag, country);
    patch.projectCountries.push(country);
    report.countryChanges.push({ from: tag, to: next, color, nextColor, name, action: "registered" });
  }
  patch.countryNameOverrides = remapProjectCountryNames(source.countryNameOverrides, newTags);
  return { countries, destinations };
}

export function planProjectPaintMerge(source, current, {
  mode = "fill-blanks", colorPolicy = "current-base", sourceReference = {}, fileName = "",
} = {}) {
  const patch = { visualOverrides: {}, riverPaintOverrides: {}, waterRegionOverrides: {}, projectCountries: [],
    legendLabels: {}, countryNameOverrides: {} };
  const report = { writtenCount: 0, skippedCount: 0, migratedCount: 0, invalidColors: [], unmatchedIds: [],
    unmatchedGroups: [], missingColors: [], countryChanges: [], colorChanges: [] };
  const { countries, destinations } = planCountries(source, current, patch, report);
  const srcCountries = { ...sourceReference.countries, ...Object.fromEntries(countries.map(entry => [entry.tag, entry])) };
  const sourceTag = countryResolver(srcCountries, source.sovereignBaseColors);
  const currentTag = countryResolver(current.scenarioCountriesByTag || {}, current.sovereignBaseColors);
  const sourceOwners = sourceReference.ownersByFeatureId || (source.scenario?.id === current.activeScenarioId
    ? current.scenarioBaselineOwnersByFeatureId : {});
  const missing = new Set();
  const changes = new Map();
  const legendDestinations = new Map();
  function resolveColor(color, srcTag, targetId) {
    if (destinations.has(srcTag)) return destinations.get(srcTag).color;
    const owner = current.scenarioBaselineOwnersByFeatureId?.[targetId];
    const hit = currentTag(color, owner);
    const base = normalizeHexColor(current.scenarioCountriesByTag?.[srcTag] && current.sovereignBaseColors?.[srcTag]);
    if (base === color && (!hit || hit === srcTag)) return color;
    if (!base && !hit) {
      missing.add(color);
      return color;
    }
    const reason = hit && hit !== srcTag ? "collision" : "base-changed";
    const replacement = colorPolicy === "keep-original" ? color
      : base || normalizeHexColor(current.sovereignBaseColors?.[owner]) || color;
    const key = [color, srcTag, hit, replacement].join("/");
    if (!changes.has(key)) changes.set(key, { color, srcTag, currentTag: hit, replacement, reason, count: 0 });
    changes.get(key).count++;
    return replacement;
  }
  const unmatched = new Map();
  function discard(id, color, parent = id) {
    unmatched.set(id, { color, srcTag: sourceTag(color, sourceOwners?.[parent]) });
  }
  function normalizeEntries(field, entries) {
    const valid = new Map();
    for (const [id, value] of Object.entries(entries || {})) {
      const color = paintColor(value);
      if (color) valid.set(id, color);
      else {
        report.invalidColors.push({ field, id });
        report.skippedCount++;
      }
    }
    return valid;
  }
  function write(table, id, color, previous, { occupied = previous, originals = [id], targetId = id } = {}) {
    if (mode === "fill-blanks" && occupied) { report.skippedCount++; return; }
    const sourceTags = new Set(originals.map(original => sourceTag(color, sourceOwners?.[original])));
    const replacements = new Set([...sourceTags].map(tag => resolveColor(color, tag, targetId)));
    if (replacements.size > 1) {
      originals.forEach(discardLand);
      return;
    }
    const [next] = replacements;
    if (!legendDestinations.has(color)) legendDestinations.set(color, new Set());
    legendDestinations.get(color).add(next);
    if (normalizeHexColor(previous) === next) { report.skippedCount++; return; }
    table[id] = next;
    report.writtenCount++;
  }
  const land = normalizeEntries("visualOverrides", source.visualOverrides);
  const river = normalizeEntries("riverPaint", source.riverPaint?.overrides);
  const validFeatureIds = getCurrentScenarioValidFeatureIds(current);
  const pack = getActiveRiverPack(current.riverPaint, current.activeScenarioId, current.scenarioBaselineHash || "");
  const targetRiver = getRiverPartitionIndex(pack);
  const srcPack = source.riverPaint?.pack;
  const samePack = pack && srcPack && source.scenario?.id === current.activeScenarioId && pack.sceneId === srcPack.sceneId
    && pack.packId === srcPack.packId && pack.source.baselineHash === srcPack.source.baselineHash
    && source.scenario.baselineHash === current.scenarioBaselineHash;
  const downgraded = new Map();
  if (river.size) {
    const srcRiver = getRiverPartitionIndex(srcPack);
    for (const id of river.keys()) {
      if (!srcRiver?.cells.has(id)) discard(id, river.get(id));
    }
    for (const { parentId, cells } of srcRiver?.parents.values() || []) {
      const painted = cells.filter(cell => river.has(cell.id));
      if (!painted.length) continue;
      if (samePack) {
        for (const { id } of painted) {
          if (!validFeatureIds.has(parentId) || targetRiver.cells.get(id)?.parentId !== parentId) {
            discard(id, river.get(id), parentId);
            continue;
          }
          const previous = current.riverPaint.overrides[id];
          write(patch.riverPaintOverrides, id, river.get(id), previous, {
            occupied: previous || current.visualOverrides?.[parentId], originals: [parentId], targetId: parentId,
          });
        }
      } else if (painted.length === cells.length && painted.every(cell => river.get(cell.id) === river.get(painted[0].id))) {
        land.set(parentId, river.get(painted[0].id));
        downgraded.set(parentId, painted.map(cell => cell.id));
      } else {
        for (const { id } of painted) discard(id, river.get(id), parentId);
      }
    }
  }
  function discardLand(id) {
    for (const saved of downgraded.get(id) || [id]) discard(saved, land.get(id), id);
  }
  const migrated = migrateScenarioPaintEntries(Object.fromEntries(land), {
    sourceScenarioId: source.scenario?.id, lineageScenarioId: current.activeScenarioId,
    sourceManifest: sourceReference.manifest, scenarioManifest: current.activeScenarioManifest,
    lineage: sourceReference.lineage, migrationMap: sourceReference.migrationMap, validFeatureIds,
    onDiscard: discardLand,
  });
  const moved = new Set();
  for (const [id, color] of Object.entries(migrated.visualOverrides)) {
    const originals = migrated.originsOf(id);
    for (const original of originals) {
      if (downgraded.has(original)) downgraded.get(original).forEach(cell => moved.add(cell));
      else if (original !== id) moved.add(original);
    }
    const previous = current.visualOverrides?.[id];
    const occupied = previous || targetRiver?.parents.get(id)?.cells.some(cell => current.riverPaint.overrides[cell.id]);
    write(patch.visualOverrides, id, color, previous, { occupied, originals });
  }
  for (const [id, color] of normalizeEntries("waterRegionOverrides", source.waterRegionOverrides)) {
    if (!current.waterRegionsById?.has(id)) { discard(id, color); continue; }
    const previous = current.waterRegionOverrides?.[id];
    write(patch.waterRegionOverrides, id, color, previous);
  }
  for (const [key, label] of Object.entries(source.legendLabels || {})) {
    const color = normalizeHexColor(key);
    if (!color) { report.invalidColors.push({ field: "legendLabels", id: key }); continue; }
    for (const next of legendDestinations.get(color) || [resolveColor(color, sourceTag(color))]) {
      if (!Object.hasOwn(current.legendLabels || {}, next) && !Object.hasOwn(patch.legendLabels, next)) {
        patch.legendLabels[next] = label;
      }
    }
  }
  const groups = new Map();
  for (const { srcTag, color } of unmatched.values()) {
    const key = [srcTag, color].join("/");
    if (!groups.has(key)) groups.set(key, { srcTag, color, count: 0 });
    groups.get(key).count++;
  }
  report.migratedCount = moved.size;
  report.skippedCount += unmatched.size;
  report.unmatchedIds = [...unmatched.keys()];
  report.unmatchedGroups = [...groups.values()];
  report.missingColors = [...missing];
  report.colorChanges = [...changes.values()];
  return { patch, report, fileName };
}

export function applyProjectPaintMerge(state, { patch, fileName }) {
  if (state !== runtimeState) throw new TypeError("Project merge history requires the active document");
  const tags = patch.projectCountries.map(country => country.tag);
  const scope = {
    featureIds: Object.keys(patch.visualOverrides), riverCellIds: Object.keys(patch.riverPaintOverrides),
    waterRegionIds: Object.keys(patch.waterRegionOverrides), ownerCodes: tags, projectCountries: tags,
    countryNameOverrides: true, legend: true,
  };
  if (!scope.featureIds.length && !scope.riverCellIds.length && !scope.waterRegionIds.length
    && !tags.length && !Object.keys(patch.legendLabels).length) return false;
  const before = captureHistoryState(scope);
  restoreRiverPaintOverridesState(state, patch.riverPaintOverrides);
  state.visualOverrides = { ...state.visualOverrides, ...patch.visualOverrides };
  state.waterRegionOverrides = { ...state.waterRegionOverrides, ...patch.waterRegionOverrides };
  for (const country of patch.projectCountries) registerProjectCountryState(state, country);
  state.countryNameOverrides = { ...state.countryNameOverrides, ...patch.countryNameOverrides };
  patchLegendState(state, { legendLabels: { ...state.legendLabels, ...patch.legendLabels } });
  callRuntimeHook(state, "refreshColorStateFn", { renderNow: true });
  const kind = "merge-project-paint";
  markDirty(kind);
  const pushed = pushHistoryEntry({ kind, before, after: captureHistoryState(scope),
    meta: { scenarioId: state.activeScenarioId, name: fileName } });
  commitChange({ domains: ["countryList", "inspector", "legend", "waterRegionList", "presetTree", "activeSovereign"], reason: kind });
  return pushed;
}
