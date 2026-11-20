import { commitFeaturePaint } from "./feature_paint_commands.js";
import { getMapDataBoundary } from "./map_data_boundary.js";
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

export function resetCountryOverrides(ids) {
  commitFeaturePaint([{ ids, color: null }], {
    kind: "reset-country-overrides",
    refresh: (featureIds) => callRuntimeHook(state, "refreshColorStateFn", { featureIds, renderNow: true }),
  });
}
