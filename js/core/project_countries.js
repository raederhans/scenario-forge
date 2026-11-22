import { normalizeHexColor } from "./color_hex_utils.js";
import { COUNTRY_CODE_ALIASES } from "./country_code_aliases.js";

const referenceTables = ["countryNameOverrides", "parentBorderEnabledByCountry", "customPresets", "capitalOverrides", "politicalOverrides"];
const selectionFields = ["selectedInspectorCountryCode", "inspectorHighlightCountryCode", "activeSovereignCode"];

export function isProjectCountry(state, tag) {
  return state.scenarioCountriesByTag?.[tag]?.project_country === true;
}

function reservedCountryTags(state, reservedTags) {
  const tags = new Set([...reservedTags, "ZZ", "XX", ...Object.keys(COUNTRY_CODE_ALIASES),
    ...Object.values(COUNTRY_CODE_ALIASES), ...Object.keys(state.scenarioCountriesByTag || {}),
    ...Object.keys(state.scenarioReleasableIndex?.byTag || {})]);
  for (const entry of state.releasableCatalog?.entries || []) {
    if (!entry.scenario_ids?.length || entry.scenario_ids.includes(state.activeScenarioId)) tags.add(entry.tag);
  }
  return tags;
}

export function allocateProjectCountryTag(state, { reservedTags = [] } = {}) {
  const used = reservedCountryTags(state, reservedTags);
  for (const key of ["sovereignBaseColors", "countryPalette", "countryNames", ...referenceTables]) {
    for (const tag of Object.keys(state[key] || {})) used.add(tag);
  }
  for (const label of state.mapLabels || []) used.add(label.countryCode);
  for (const entry of state.historyPast || []) {
    if (entry.meta?.scenarioId === state.activeScenarioId) {
      for (const tag of Object.keys(entry.before?.projectCountries || {})) used.add(tag);
    }
  }
  for (const prefix of ["P", "Q"]) {
    for (let n = 1; n <= 99; n++) {
      const tag = prefix + String(n).padStart(2, "0");
      if (!used.has(tag)) return tag;
    }
  }
  return "";
}

export function buildProjectCountryEntry(tag, name) {
  return { tag, code: tag, display_name: name, display_name_en: name, display_name_zh: name,
    entry_kind: "project_country", project_country: true, scenario_only: true, feature_count: 0,
    inspector_group_id: "project_countries", inspector_group_label: "Project countries" };
}

export function registerProjectCountryState(state, { tag, color, name }) {
  state.scenarioCountriesByTag = { ...state.scenarioCountriesByTag, [tag]: buildProjectCountryEntry(tag, name) };
  state.sovereignBaseColors = { ...state.sovereignBaseColors, [tag]: color };
  state.countryPalette = { ...state.countryPalette, [tag]: color };
}

export function clearProjectCountrySelection(state, tag) {
  for (const key of selectionFields) {
    if (state[key] === tag) state[key] = "";
  }
}

export function unregisterProjectCountryState(state, tag) {
  if (!isProjectCountry(state, tag)) return false;
  for (const key of ["scenarioCountriesByTag", "sovereignBaseColors", "countryPalette"]) {
    const { [tag]: removed, ...rest } = state[key];
    state[key] = rest;
  }
  clearProjectCountrySelection(state, tag);
  return true;
}

export function serializeProjectCountries(state) {
  if (!state.activeScenarioId) return [];
  return Object.values(state.scenarioCountriesByTag || {}).filter(entry => entry.project_country)
    .map(({ tag, display_name: name }) => ({ tag, name }));
}

export function getProjectCountryBaseColors(state) {
  const colors = {};
  for (const { tag } of serializeProjectCountries(state)) {
    const color = normalizeHexColor(state.sovereignBaseColors?.[tag]);
    if (color) colors[tag] = color;
  }
  return colors;
}

export function normalizeProjectCountryName(name) {
  return Array.from(name.trim()).slice(0, 120).join("").trimEnd();
}

export function normalizeProjectCountriesPayload(raw) {
  const result = [];
  const seen = new Set();
  for (const entry of Array.isArray(raw) ? raw : []) {
    const tag = String(entry?.tag || "").trim().toUpperCase();
    const name = typeof entry?.name === "string" ? normalizeProjectCountryName(entry.name) : "";
    if (!/^[PQ](?:0[1-9]|[1-9]\d)$/.test(tag) || !name || seen.has(tag)) continue;
    seen.add(tag);
    result.push({ tag, name });
  }
  return result;
}

export function restoreProjectCountries(draft, list, { reservedTags = [], scenarioBaseColors = {}, savedBaseColors = draft.sovereignBaseColors } = {}) {
  const tagMap = {};
  const dropped = [];
  if (!draft.activeScenarioId) return { tagMap, dropped };
  const entries = normalizeProjectCountriesPayload(list);
  const reserved = reservedCountryTags(draft, reservedTags);
  const incoming = entries.map(entry => entry.tag);
  for (const { tag, name } of entries) {
    const color = normalizeHexColor(savedBaseColors?.[tag]);
    const next = reserved.has(tag) ? allocateProjectCountryTag(draft, { reservedTags: [...reserved, ...incoming] }) : tag;
    if (next !== tag) {
      for (const key of ["sovereignBaseColors", "countryPalette"]) {
        const { [tag]: removed, ...rest } = draft[key] || {};
        if (scenarioBaseColors[tag]) rest[tag] = scenarioBaseColors[tag];
        draft[key] = rest;
      }
    }
    if (!color || !next) {
      dropped.push(tag);
      continue;
    }
    if (next !== tag) {
      tagMap[tag] = next;
      for (const key of referenceTables) {
        if (!Object.hasOwn(draft[key] || {}, tag)) continue;
        const { [tag]: value, ...rest } = draft[key];
        draft[key] = { ...rest, [next]: value };
      }
      if (draft.mapLabels) draft.mapLabels = draft.mapLabels.map(label =>
        label.countryCode === tag ? { ...label, countryCode: next } : label);
      if (draft.activeSovereignCode === tag) draft.activeSovereignCode = next;
    }
    registerProjectCountryState(draft, { tag: next, name, color });
  }
  return { tagMap, dropped };
}
