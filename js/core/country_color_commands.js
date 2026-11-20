import { normalizeHexColor } from "./color_hex_utils.js";
import { applyColorReplacement, withCountryColorReplacement } from "./replace_color_command.js";
// Shared map logic helpers (Phase 13)
import { state as runtimeState, countryPalette, defaultCountryPalette } from "./state.js";
import { captureHistoryState, pushHistoryEntry } from "./history_manager.js";
import { syncResolvedDefaultCountryPalette } from "./palette_manager.js";
import { refreshColorState, refreshResolvedColorsForOwners } from "./map_renderer.js";
import { normalizeFeatureCountryCode } from "./feature_identity.js";
import { getScenarioCountryTags, uniquifyScenarioDefaultColors } from "./state/actions/scenario_activation_actions.js";
const state = runtimeState;

function normalizeCountryCode(rawCode) {
  return normalizeFeatureCountryCode(rawCode);
}

function applyCountryColor(code, color, dialog) {
  if (!runtimeState.landData) return;
  const target = normalizeCountryCode(code);
  if (!target) return;
  const oldColor = normalizeHexColor(state.sovereignBaseColors[target] || state.countryPalette[target]);
  const newColor = normalizeHexColor(color);
  return withCountryColorReplacement(state, target, oldColor, newColor, replacement => {
    const scope = { ownerCodes: [target], ...replacement };
    const before = captureHistoryState(scope);
    state.countryPalette[target] = color;
    state.sovereignBaseColors[target] = color;
    if (replacement) {
      applyColorReplacement(state, replacement, oldColor, newColor);
      refreshColorState({ renderNow: true });
    } else {
      refreshResolvedColorsForOwners([target], { renderNow: true });
    }
    pushHistoryEntry({
      kind: replacement ? "replace-color" : "inspector-country-color",
      before, after: captureHistoryState(scope), meta: { affectsSovereignty: false },
    });
  }, dialog);
}

function resetCountryColors() {
  const ownerCodes = Array.from(new Set([
    ...Object.keys(runtimeState.sovereignBaseColors || {}),
    ...Object.keys(defaultCountryPalette || {}),
    ...Object.keys(runtimeState.scenarioFixedOwnerColors || {}),
    ...Object.keys(runtimeState.countryPalette || {}),
  ]));
  const featureIds = Object.keys(runtimeState.visualOverrides || {});
  const before = captureHistoryState({
    featureIds,
    ownerCodes,
  });
  const resolvedDefaults = syncResolvedDefaultCountryPalette({ overwriteCountryPalette: true });
  Object.keys(countryPalette).forEach((code) => {
    delete countryPalette[code];
  });
  Object.keys(defaultCountryPalette).forEach((code) => {
    countryPalette[code] = defaultCountryPalette[code];
  });
  const fixedColors = runtimeState.activeScenarioId ? runtimeState.scenarioFixedOwnerColors || {} : {};
  runtimeState.sovereignBaseColors = uniquifyScenarioDefaultColors({ ...resolvedDefaults, ...fixedColors }, {
    tags: runtimeState.activeScenarioId ? getScenarioCountryTags(runtimeState.scenarioCountriesByTag) : null,
    preferred: Object.keys(fixedColors),
  });
  runtimeState.colors = {};
  runtimeState.visualOverrides = {};

  refreshColorState({ renderNow: true });
  pushHistoryEntry({
    kind: "reset-country-colors",
    before,
    after: captureHistoryState({
      featureIds,
      ownerCodes,
    }),
    meta: {
      affectsSovereignty: false,
    },
  });
}

export { applyCountryColor, resetCountryColors };

