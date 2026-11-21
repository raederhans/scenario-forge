import { commitFeaturePaint } from "./feature_paint_commands.js";
import { getMapDataBoundary } from "./map_data_boundary.js";
import { resolveCatalogEntryForTag, resolvePresetFeatureIds } from "./releasable_manager.js";
import { getEditedRiverParentIds } from "./river_paint/partition_model.js";
import { state } from "./state.js";
import { callRuntimeHook } from "./state/index.js";

export function getCountryMemberIds(source, code) {
  const { reference } = getMapDataBoundary(source);
  return source.activeScenarioId
    ? reference.getScenarioGroupFeatureIds(code)
    : reference.getGeographicCountryFeatureIds(code);
}

export function getCountryOverrideIds(source, code) {
  const riverParents = new Set(getEditedRiverParentIds(source.riverPaint));
  return getCountryMemberIds(source, code).filter((id) =>
    Object.hasOwn(source.visualOverrides || {}, id) || riverParents.has(id));
}

export function getCountryLocateIds(source, code) {
  const members = getCountryMemberIds(source, code);
  if (!source.activeScenarioId || !source.scenarioCountriesByTag?.[code]?.releasable) return members;
  const entry = resolveCatalogEntryForTag(code, source.activeScenarioId);
  if (!entry) return members;
  const released = resolvePresetFeatureIds(entry).filter(id =>
    callRuntimeHook(source, "resolveBorderIdentityFn", id, source.landIndex?.get(id)) === code);
  return [...new Set([...members, ...released])];
}

export function resetCountryOverrides(ids) {
  commitFeaturePaint([{ ids, color: null }], {
    kind: "reset-country-overrides",
    refresh: (featureIds) => callRuntimeHook(state, "refreshColorStateFn", { featureIds, renderNow: true }),
  });
}
