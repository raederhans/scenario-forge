import { readFileSync } from "node:fs";
import vm from "node:vm";
import { getThematicWgiFeatureInspection, getThematicReferenceNote } from "../../js/core/thematic_wgi_view_model.js";
import { getPopulationTooltipLines } from "../../js/core/population_spatial_presentation.js";
import { getThematicIndicator, formatThematicIndicatorValue } from "../../js/core/thematic_indicator_catalog.js";
import { getStrategicFeatureInspection, STRATEGIC_METRIC_NAMES } from "../../js/core/strategic_values_view_model.js";
import { UI_COPY_CATALOG } from "../../js/core/i18n_catalog.js";
import { normalizeCountryCodeAlias } from "../../js/core/country_code_aliases.js";
import { getCountryCode, getFeatureId } from "../../js/core/feature_identity.js";
import { getScenarioCountryDisplayName } from "../../js/core/scenario_country_display.js";

const moduleUrl = new URL("../../js/core/i18n.js", import.meta.url);
const source = readFileSync(moduleUrl, "utf8")
  .replace(/^import\s+[\s\S]*?\s+from\s+"[^"\n]+";[ \t]*\r?\n/gm, "")
  .replace(/^export \{[\s\S]*?\};?[ \t]*$/m, "");

// Execute the complete production tooltip/translation module in a fresh realm.
// Only its state import is replaced; all feature, indicator and label helpers
// remain the real production implementations. No application singleton is read
// or patched, and each call owns its localization audit and tooltip functions.
export function createTooltipFixture(fixtureState) {
  const context = vm.createContext({
    runtimeState: fixtureState,
    getThematicWgiFeatureInspection, getThematicReferenceNote, getPopulationTooltipLines,
    getThematicIndicator, formatThematicIndicatorValue, getStrategicFeatureInspection, STRATEGIC_METRIC_NAMES,
    UI_COPY_CATALOG, normalizeCountryCodeAlias, getScenarioCountryDisplayName,
    getSharedFeatureCountryCode: getCountryCode, getSharedFeatureId: getFeatureId,
  });
  vm.runInContext(`${source}\nthis.tooltip = getTooltipText;`, context, { filename: moduleUrl.pathname });
  return { getTooltipText: context.tooltip };
}
