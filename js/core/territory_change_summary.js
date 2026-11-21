import { getMapDataBoundary } from "./map_data_boundary.js";
import { createBorderIdentityResolver } from "./renderer/border_identity.js";
import { getRiverPaintRuntime } from "./river_paint/runtime.js";
import { getRiverParentCompatibility } from "./river_paint/partition_model.js";
import { getScenarioCountryTags } from "./state/actions/scenario_activation_actions.js";
import { getLocalizedScenarioCountryName } from "./scenario/scenario_country_display.js";
import { getCountryNameOverride } from "./country_name_overrides.js";
import { getGeoFeatureDisplayLabel, t } from "./i18n.js";

export function getTerritoryChanges(state) {
  const { reference } = getMapDataBoundary(state);
  const tags = getScenarioCountryTags(state.scenarioCountriesByTag);
  const pack = getRiverPaintRuntime(state).getActivePack();
  const resolveOwner = createBorderIdentityResolver({
    sovereignBaseColors: state.sovereignBaseColors,
    getCountryTags: () => tags,
    getReferenceOwner: (_, parentId) => reference.getBaseGroupCode(parentId),
    getOverrideColor: (id, parentId) => (id !== parentId && state.riverPaint.overrides[id]) || state.visualOverrides?.[parentId],
  });
  const rows = [];
  for (const parentId of reference.getScenarioFeatureIds()) {
    const from = reference.getScenarioGroupCode(parentId);
    const feature = state.landIndex?.get(parentId);
    const partition = pack && getRiverParentCompatibility(pack, feature, parentId);
    const ids = partition?.status === "ready" ? partition.parent.cells.map(cell => cell.id) : [parentId];
    for (const id of ids) {
      const to = resolveOwner(id, parentId);
      if (from !== to) {
        const name = getGeoFeatureDisplayLabel(feature || { id: parentId }, parentId);
        rows.push({ id, name, from, to });
      }
    }
  }
  return rows;
}

export function formatTerritorySummary(rows, state) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.to, row.from]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const country = code => getCountryNameOverride(state, code) ||
    getLocalizedScenarioCountryName(state.scenarioCountriesByTag?.[code], state.countryNames?.[code] || code, t) ||
    t("Unassigned", "ui");
  return Array.from(groups.values(), group => t("{to} gained {count} parcels from {from} ({examples}).", "ui", {
    from: country(group[0].from), to: country(group[0].to), count: group.length,
    examples: group.slice(0, 3).map(row => row.name).join(state.currentLanguage === "zh" ? "、" : ", "),
  })).join("\n") || t("No territory changes.", "ui");
}

export function buildTerritoryChangesCsv(rows) {
  const quote = value => {
    const safe = /^[=+@\-\t\r]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return "\ufeff" + ["feature_id,name,original_owner,current_owner", ...rows.map(({ id, name, from, to }) =>
    [id, name, from, to].map(quote).join(","))].join("\r\n");
}
