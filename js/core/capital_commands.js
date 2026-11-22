import {
  addProjectCity, clearCapitalOverride, findCapitalCityFeature,
  removeProjectCity as removeProjectCityState, setCapitalOverride,
} from "./capital_overrides.js";
import { markDirty } from "./dirty_state.js";
import { captureHistoryState, pushHistoryEntry } from "./history_manager.js";
import { getPreferredGeoLabel, getStrictGeoLabel } from "./i18n.js";
import { flushRenderBoundary } from "./render_boundary.js";
import { createCityLabelTextModel } from "./renderer/city_label_text_model.js";
import { state } from "./state.js";
import { commitChange } from "./state/changes.js";

const cityLabels = createCityLabelTextModel(state, { getPreferredGeoLabel, getStrictGeoLabel });

function finishEdit(kind, scope, before, name) {
  pushHistoryEntry({ kind, before, after: captureHistoryState(scope), meta: { scenarioId: state.activeScenarioId, name } });
  markDirty(kind);
  commitChange({ domains: ["inspector", "strategicOverlays"], reason: kind });
  flushRenderBoundary(kind);
}

export function setCountryCapital(tag, cityId) {
  const scope = { capitalOverrides: true, cityNameOverrides: true };
  const before = captureHistoryState(scope);
  const city = cityId && findCapitalCityFeature(state, cityId);
  if (!setCapitalOverride(state, tag, cityId)) return false;
  finishEdit(city ? "set-country-capital" : "hide-country-capital", scope, before, city && cityLabels.getCityDisplayLabel(city));
  return true;
}

export function resetCountryCapital(tag) {
  const scope = { capitalOverrides: true };
  const before = captureHistoryState(scope);
  if (!clearCapitalOverride(state, tag)) return false;
  finishEdit("reset-country-capital", scope, before);
  return true;
}

export function placeProjectCapital(tag, { name, lon, lat, hostFeatureId }) {
  const scope = { projectCities: true, capitalOverrides: true, cityNameOverrides: true };
  const before = captureHistoryState(scope);
  const previousCities = state.projectCities;
  const id = addProjectCity(state, { name, lon, lat, hostFeatureId });
  if (!id) return false;
  if (!setCapitalOverride(state, tag, id)) {
    state.projectCities = previousCities;
    return false;
  }
  finishEdit("place-project-capital", scope, before);
  return id;
}

export function removeProjectCity(id) {
  const scope = { projectCities: true, capitalOverrides: true, cityNameOverrides: true };
  const before = captureHistoryState(scope);
  if (!removeProjectCityState(state, id)) return false;
  finishEdit("remove-project-city", scope, before);
  return true;
}
