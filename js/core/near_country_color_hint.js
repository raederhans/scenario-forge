import { ColorManager } from "./color_manager.js";
import { t } from "./i18n.js";
import { getLocalizedScenarioCountryName } from "./scenario/scenario_country_display.js";

export function findNearCountryColor(state, rawColor, excludedCode) {
  const selected = ColorManager.normalizeHexColor(rawColor);
  if (!state.activeScenarioId || !selected) return null;
  let closest = null;
  let minDistance = 3;
  for (const code of Object.keys(state.scenarioCountriesByTag || {})) {
    if (code === excludedCode) continue;
    const color = ColorManager.normalizeHexColor(state.sovereignBaseColors?.[code]);
    if (!color) continue;
    if (color === selected) return { code, color, exact: true };
    const distance = ColorManager.deltaE(selected, color);
    if (distance < minDistance) {
      minDistance = distance;
      closest = { code, color, exact: false };
    }
  }
  return closest;
}

export function getCountryColorHintText(state, match) {
  const country = getLocalizedScenarioCountryName(state.scenarioCountriesByTag[match.code], state.countryNames?.[match.code] || match.code, t);
  return {
    message: t(match.exact ? "Will merge into {country}" : "Close to {country}'s color. Painting will create a border.", "ui", { country }),
    actionLabel: match.exact ? "" : t("Use {country}'s color", "ui", { country }),
  };
}
