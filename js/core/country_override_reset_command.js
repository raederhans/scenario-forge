import { isProjectCountry } from "./project_countries.js";
import { commitFeaturePaint } from "./feature_paint_commands.js";
import { markDirty } from "./dirty_state.js";
import { captureHistoryState, pushHistoryEntry } from "./history_manager.js";
import { getMapDataBoundary } from "./map_data_boundary.js";
import { resolveCatalogEntryForTag, resolvePresetFeatureIds } from "./releasable_manager.js";
import { getEditedRiverParentIds } from "./river_paint/partition_model.js";
import { getRiverPaintRuntime } from "./river_paint/runtime.js";
import { restoreRiverPaintOverridesState } from "./state/actions/river_paint_actions.js";
import { state } from "./state.js";
import { callRuntimeHook } from "./state/index.js";

export function getCountryMemberIds(source, code) {
  const { reference } = getMapDataBoundary(source);
  return source.activeScenarioId
    ? reference.getScenarioGroupFeatureIds(code)
    : reference.getGeographicCountryFeatureIds(code);
}

function projectCountryPaint(source, code, confirmed = null) {
  const belongs = (id, feature) => callRuntimeHook(source, "resolveBorderIdentityFn", id, feature) === code;
  const featureIds = Object.keys(source.visualOverrides || {}).filter(id =>
    (!confirmed || confirmed.has(id)) && belongs(id, source.landIndex?.get(id)));
  const parents = new Set(featureIds);
  const riverCellIds = [];
  for (const id of Object.keys(source.riverPaint?.overrides || {})) {
    const cell = getRiverPaintRuntime(source).getCellFeature(id);
    if (cell && (!confirmed || confirmed.has(cell.properties.__riverParentId)) && belongs(id, cell)) {
      riverCellIds.push(id);
      parents.add(cell.properties.__riverParentId);
    }
  }
  return { parents: [...parents], featureIds, riverCellIds };
}

export function getCountryOverrideIds(source, code) {
  if (isProjectCountry(source, code)) return projectCountryPaint(source, code).parents;
  const riverParents = new Set(getEditedRiverParentIds(source.riverPaint));
  return getCountryMemberIds(source, code).filter((id) =>
    Object.hasOwn(source.visualOverrides || {}, id) || riverParents.has(id));
}

export function getCountryLocateIds(source, code) {
  if (isProjectCountry(source, code)) return projectCountryPaint(source, code).parents;
  const members = getCountryMemberIds(source, code);
  if (!source.activeScenarioId || !source.scenarioCountriesByTag?.[code]?.releasable) return members;
  const entry = resolveCatalogEntryForTag(code, source.activeScenarioId);
  if (!entry) return members;
  const released = resolvePresetFeatureIds(entry).filter(id =>
    callRuntimeHook(source, "resolveBorderIdentityFn", id, source.landIndex?.get(id)) === code);
  return [...new Set([...members, ...released])];
}

export function resetCountryOverrides(ids, code) {
  const kind = "reset-country-overrides";
  const refresh = featureIds => callRuntimeHook(state, "refreshColorStateFn", { featureIds, renderNow: true });
  if (!isProjectCountry(state, code)) {
    commitFeaturePaint([{ ids, color: null }], { kind, refresh });
    return;
  }
  const { parents, featureIds, riverCellIds } = projectCountryPaint(state, code, new Set(ids));
  if (!parents.length) return;
  const scope = { featureIds, riverCellIds };
  const before = captureHistoryState(scope);
  for (const id of featureIds) delete state.visualOverrides[id];
  restoreRiverPaintOverridesState(state, Object.fromEntries(riverCellIds.map(id => [id, null])));
  refresh(parents);
  markDirty(kind);
  pushHistoryEntry({ kind, before, after: captureHistoryState(scope), meta: { affectsSovereignty: false } });
}
