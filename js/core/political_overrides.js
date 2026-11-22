import { normalizeHexColor } from "./color_hex_utils.js";
import { normalizeProjectCountryName } from "./project_countries.js";
import { normalizeCountryCodeAlias as canonicalCountryCode } from "./country_code_aliases.js";

export const NO_DATA_COLOR = "#d9d6cc";
export const OTHER_COLOR = "#b9b4a6";
const IDEOLOGIES = {
  democratic: ["#3b6fb6", "民主", "Democratic"],
  fascism: ["#7a4a26", "法西斯", "Fascism"],
  communism: ["#c0392b", "共产主义", "Communism"],
  neutrality: ["#8f8a6a", "中立·威权", "Non-aligned"],
  communist: ["#a3201c", "共产主义", "Communism"],
  socialist: ["#d9534f", "社会主义", "Socialism"],
  progressivism: ["#e8955a", "进步主义", "Progressivism"],
  liberalism: ["#e3c449", "自由主义", "Liberalism"],
  liberal_conservatism: ["#86b6d8", "自由保守主义", "Liberal conservatism"],
  conservatism: ["#2f6aa3", "保守主义", "Conservatism"],
  paternalism: ["#6f8f58", "家长制", "Paternalism"],
  despotism: ["#8d7b68", "专制", "Despotism"],
  national_socialism: ["#3b3b3b", "国家社会主义", "National Socialism"],
  ultranationalism: ["#5b3324", "极端民族主义", "Ultranationalism"],
};
const ALLIANCE_COLORS = {
  allies: "#1f4e9c", axis: "#2f2f2f", comintern: "#b3261e", chinese_united_front: "#d4a017",
  organization_of_free_nations: "#1f4e9c", einheitspakt: "#2f2f2f",
  japanese_co_prosperity_sphere: "#c8102e", triumvirate: "#2e7d32",
};
const UNKNOWN_ALLIANCE_COLOR = "#7d6b9e";
const UNALIGNED_BASE_COLOR = "#f1eee6";

const reservedKeys = new Set(["__proto__", "constructor", "prototype"]);
const allianceIdPattern = /^[a-z0-9_]{1,64}$/;
const ideologyIdPattern = /^[a-z_]{1,40}$/;
const customIdPattern = /^custom_[1-9]\d?$/;
const hoi4Ideologies = ["democratic", "fascism", "communism", "neutrality"];

function own(table, key) {
  return table && Object.hasOwn(table, key) ? table[key] : undefined;
}

export function getPoliticalPayload(state) {
  return own(state?.scenarioBundleCacheById, state?.activeScenarioId)?.countriesPayload;
}

function validId(value, pattern) {
  return typeof value === "string" && !reservedKeys.has(value) && pattern.test(value);
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function normalizePoliticalOverrides(raw) {
  const result = {};
  if (!isRecord(raw)) return result;
  for (const [key, entry] of Object.entries(raw)) {
    const tag = canonicalCountryCode(key);
    if (!tag || reservedKeys.has(key.trim().toLowerCase()) || !isRecord(entry)) continue;
    const alliance = own(entry, "alliance");
    const ideology = own(entry, "ideology");
    const clean = {};
    if (alliance === null || validId(alliance, allianceIdPattern)) clean.alliance = alliance;
    if (validId(ideology, ideologyIdPattern)) clean.ideology = ideology;
    if (Object.keys(clean).length) result[tag] = clean;
  }
  return result;
}

export function getIdeologyOption(id, zh) {
  const metadata = own(IDEOLOGIES, id);
  return { id, label: metadata?.[zh ? 1 : 2] || id, color: metadata?.[0] || OTHER_COLOR };
}

export function governmentColor(ideology) {
  return ideology ? own(IDEOLOGIES, ideology)?.[0] || OTHER_COLOR : NO_DATA_COLOR;
}

export function unalignedColor(ideology) {
  if (!ideology) return NO_DATA_COLOR;
  const color = governmentColor(ideology);
  return "#" + [1, 3, 5].map((offset) => Math.round(
    parseInt(color.slice(offset, offset + 2), 16) * 0.45
    + parseInt(UNALIGNED_BASE_COLOR.slice(offset, offset + 2), 16) * 0.55,
  ).toString(16).padStart(2, "0")).join("");
}

const reservedColors = new Set([
  NO_DATA_COLOR, OTHER_COLOR, UNKNOWN_ALLIANCE_COLOR, unalignedColor("other"), ...Object.values(ALLIANCE_COLORS),
  ...Object.keys(IDEOLOGIES).flatMap(id => [governmentColor(id), unalignedColor(id)]),
]);

export function normalizeCustomAlliance(entry, existing) {
  const rawName = own(entry, "name");
  const rawColor = own(entry, "color");
  if (typeof rawName !== "string" || typeof rawColor !== "string") return null;
  const name = normalizeProjectCountryName(rawName);
  const color = normalizeHexColor(rawColor);
  if (!name || !color || reservedColors.has(color) || Object.values(existing).some(item => item.color === color)) return null;
  return { name, color };
}

export const MAX_CUSTOM_ALLIANCES = 16;

export function normalizePoliticalAlliances(raw) {
  const result = {};
  if (!isRecord(raw)) return result;
  for (const [id, entry] of Object.entries(raw)) {
    if (!customIdPattern.test(id)) continue;
    const alliance = normalizeCustomAlliance(entry, result);
    if (alliance) result[id] = alliance;
    if (Object.keys(result).length === MAX_CUSTOM_ALLIANCES) break;
  }
  return result;
}

export function getPoliticalIdentity(state, rawTag) {
  let tag = canonicalCountryCode(rawTag);
  const countries = getPoliticalPayload(state)?.countries;
  let country = own(countries, tag);
  let override = own(state.politicalOverrides, tag);
  const hasAlliance = override && Object.hasOwn(override, "alliance");
  const alliance = hasAlliance ? override.alliance : country?.alliance || null;
  const allianceSource = hasAlliance ? "override" : alliance ? "scenario" : "none";

  let ideology = override?.ideology || country?.ruling_ideology || null;
  let ideologySource = override?.ideology ? "override" : ideology ? "scenario" : "none";
  const visited = new Set();
  while (!ideology && tag && !visited.has(tag)) {
    visited.add(tag);
    const record = own(state.scenarioCountriesByTag, tag);
    if (!record?.releasable && record?.entry_kind !== "releasable") break;
    tag = canonicalCountryCode(record.parent_owner_tag || record.parent_owner_tags?.[0]);
    country = own(countries, tag);
    override = own(state.politicalOverrides, tag);
    ideology = override?.ideology || country?.ruling_ideology || null;
    if (ideology) ideologySource = "inherited";
  }
  return { alliance, ideology, allianceSource, ideologySource };
}

export function getAllianceOption(state, id) {
  const metadata = own(getPoliticalPayload(state)?.alliances, id);
  const custom = !metadata && own(state.politicalAlliances, id);
  const label = custom?.name || metadata?.[state.currentLanguage === "zh" ? "name_zh" : "name_en"] || id;
  return { id, label, color: custom?.color || own(ALLIANCE_COLORS, id) || UNKNOWN_ALLIANCE_COLOR, custom: !!custom };
}

export function listAllianceOptions(state) {
  const payload = getPoliticalPayload(state);
  const ids = new Set([...Object.keys(payload?.alliances || {}),
    ...Object.values(payload?.countries || {}).map(country => country.alliance),
    ...Object.keys(state.politicalAlliances || {})]);
  return [...ids].filter(id => validId(id, allianceIdPattern)).map(id => getAllianceOption(state, id));
}

export function listIdeologyOptions(state, rawTag) {
  const ids = new Set(Object.values(getPoliticalPayload(state)?.countries || {})
    .map(country => country.ruling_ideology).filter(id => validId(id, ideologyIdPattern)));
  if (!ids.size) hoi4Ideologies.forEach(id => ids.add(id));
  const current = own(state.politicalOverrides, canonicalCountryCode(rawTag))?.ideology;
  if (current) ids.add(current);
  return [...ids].map(id => getIdeologyOption(id, state.currentLanguage === "zh"));
}
