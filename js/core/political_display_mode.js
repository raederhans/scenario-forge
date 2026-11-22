import { collectPresentOwnerTags } from "./legend_manager.js";
import {
  getAllianceOption, getIdeologyOption, getPoliticalIdentity, getPoliticalPayload,
  governmentColor, NO_DATA_COLOR, OTHER_COLOR, unalignedColor,
} from "./political_overrides.js";
import { getObjectIdentityToken } from "./renderer/object_identity.js";

export { NO_DATA_COLOR };
export const POLITICAL_DISPLAY_MODES = ["country", "alliance", "government"];
const payloadSupport = new WeakMap();
const nonemptyTables = new WeakMap();
const displayCache = new WeakMap();

export function normalizePoliticalDisplayMode(raw) {
  return POLITICAL_DISPLAY_MODES.includes(raw) ? raw : "country";
}

function hasEntries(table) {
  if (!table) return false;
  if (!nonemptyTables.has(table)) nonemptyTables.set(table, Object.keys(table).length > 0);
  return nonemptyTables.get(table);
}

export function isPoliticalDisplayModeSupported(state) {
  const payload = getPoliticalPayload(state);
  if (!state?.activeScenarioId || !payload) return false;
  if (!payloadSupport.has(payload)) {
    payloadSupport.set(payload, Object.values(payload.countries || {}).some(country => !!country.ruling_ideology?.trim()));
  }
  return payloadSupport.get(payload) || hasEntries(state.politicalOverrides) || hasEntries(state.politicalAlliances);
}

export function isPoliticalDisplayModeActive(state) {
  return normalizePoliticalDisplayMode(state?.politicalDisplayMode) !== "country"
    && !state?.scenarioApplyInFlight && isPoliticalDisplayModeSupported(state);
}

export function getPoliticalDisplayModeSignature(state) {
  return isPoliticalDisplayModeActive(state)
    ? JSON.stringify([state.activeScenarioId, state.politicalDisplayMode, getObjectIdentityToken(getPoliticalPayload(state)),
      getObjectIdentityToken(state.politicalOverrides), getObjectIdentityToken(state.politicalAlliances)]) : "";
}

function getDisplayCache(state) {
  const payload = getPoliticalPayload(state);
  const { politicalDisplayMode: mode, politicalOverrides, politicalAlliances, scenarioCountriesByTag } = state;
  let cache = displayCache.get(state);
  if (!cache || cache.payload !== payload || cache.mode !== mode || cache.politicalOverrides !== politicalOverrides
    || cache.politicalAlliances !== politicalAlliances || cache.scenarioCountriesByTag !== scenarioCountriesByTag) {
    cache = { payload, mode, politicalOverrides, politicalAlliances, scenarioCountriesByTag, colors: new Map() };
    displayCache.set(state, cache);
  }
  return cache;
}

function getDisplayAlliance(state, id) {
  const option = getAllianceOption(state, id);
  const color = getPoliticalPayload(state)?.alliances?.[id]?.color_hex;
  return color ? { ...option, color } : option;
}

export function resolvePoliticalDisplayColor(state, ownerTag) {
  if (!isPoliticalDisplayModeActive(state)) return null;
  if (!ownerTag || ownerTag.startsWith("color:")) return NO_DATA_COLOR;
  const { colors } = getDisplayCache(state);
  if (!colors.has(ownerTag)) {
    const { alliance, ideology } = getPoliticalIdentity(state, ownerTag);
    const color = state.politicalDisplayMode === "government" ? governmentColor(ideology)
      : alliance ? getDisplayAlliance(state, alliance).color : unalignedColor(ideology);
    colors.set(ownerTag, color);
  }
  return colors.get(ownerTag);
}

function buildPoliticalDisplayLegend(state, owners, zh) {
  const alliance = state.politicalDisplayMode === "alliance";
  const categories = new Map();
  for (const tag of owners) {
    const identity = getPoliticalIdentity(state, tag);
    const raw = alliance ? identity.alliance : identity.ideology;
    if (!raw) continue;
    const id = !alliance && governmentColor(raw) === OTHER_COLOR ? "other" : raw;
    categories.set(id, (categories.get(id) || 0) + 1);
  }
  const entries = [...categories].map(([id, count]) => {
    if (!alliance) {
      const { color, label } = getIdeologyOption(id, zh);
      return { color, label: id === "other" ? (zh ? "其他" : "Other") : label };
    }
    const { color, label } = getDisplayAlliance(state, id);
    return { color, label: zh ? `${label}（${count} 国）` : `${label} (${count} countries)` };
  });
  entries.push({ color: NO_DATA_COLOR, label: zh ? "无数据" : "No data" });
  return { title: alliance ? (zh ? "阵营" : "Alliances") : (zh ? "政体" : "Government type"),
    note: alliance ? (zh ? "未结盟国家按政体浅色显示" : "Unaligned countries use lighter government colors") : "", entries };
}

export function getPoliticalDisplayLegend(state, { presentOwners } = {}) {
  if (!isPoliticalDisplayModeActive(state)) return null;
  const zh = state.currentLanguage === "zh";
  if (presentOwners) return buildPoliticalDisplayLegend(state, presentOwners, zh);
  const owners = collectPresentOwnerTags(state);
  const cache = getDisplayCache(state);
  if (cache.owners !== owners || cache.zh !== zh) {
    cache.legend = buildPoliticalDisplayLegend(state, owners, zh);
    cache.owners = owners;
    cache.zh = zh;
  }
  return cache.legend;
}
