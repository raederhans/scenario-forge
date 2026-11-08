import { getObjectIdentityToken } from "./renderer/object_identity.js";

export const POLITICAL_DISPLAY_MODES = ["country", "alliance", "government"];
export const NO_DATA_COLOR = "#d9d6cc";
const OTHER_COLOR = "#b9b4a6";
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
const payloadCache = new WeakMap();
const getPayload = (state) => state?.scenarioBundleCacheById?.[state.activeScenarioId]?.countriesPayload;

export function normalizePoliticalDisplayMode(raw) {
  return POLITICAL_DISPLAY_MODES.includes(raw) ? raw : "country";
}

function getPayloadData(payload) {
  let data = payloadCache.get(payload);
  if (!data) {
    data = { supported: Object.values(payload.countries || {}).some((country) => !!country.ruling_ideology?.trim()), colors: new Map() };
    payloadCache.set(payload, data);
  }
  return data;
}

export function isPoliticalDisplayModeSupported(state) {
  const payload = getPayload(state);
  return !!payload && getPayloadData(payload).supported;
}

export function isPoliticalDisplayModeActive(state) {
  return normalizePoliticalDisplayMode(state?.politicalDisplayMode) !== "country"
    && !state?.scenarioApplyInFlight && isPoliticalDisplayModeSupported(state);
}

export function getPoliticalDisplayModeSignature(state) {
  return isPoliticalDisplayModeActive(state)
    ? JSON.stringify([state.activeScenarioId, state.politicalDisplayMode, getObjectIdentityToken(getPayload(state))]) : "";
}

function governmentColor(ideology) {
  return ideology ? (IDEOLOGIES[ideology]?.[0] || OTHER_COLOR) : NO_DATA_COLOR;
}

function unalignedColor(ideology) {
  if (!ideology) return NO_DATA_COLOR;
  const color = governmentColor(ideology);
  return "#" + [1, 3, 5].map((offset) => Math.round(
    parseInt(color.slice(offset, offset + 2), 16) * 0.45
    + parseInt(UNALIGNED_BASE_COLOR.slice(offset, offset + 2), 16) * 0.55,
  ).toString(16).padStart(2, "0")).join("");
}

export function resolvePoliticalDisplayColor(state, ownerTag) {
  if (!isPoliticalDisplayModeActive(state)) return null;
  if (!ownerTag || ownerTag.startsWith("color:")) return NO_DATA_COLOR;
  const payload = getPayload(state);
  const data = getPayloadData(payload);
  const mode = state.politicalDisplayMode;
  if (!data.colors.has(mode)) {
    data.colors.set(mode, new Map(Object.entries(payload.countries).map(([tag, country]) => [tag,
      mode === "government" ? governmentColor(country.ruling_ideology)
        : country.alliance ? (ALLIANCE_COLORS[country.alliance] || UNKNOWN_ALLIANCE_COLOR)
          : unalignedColor(country.ruling_ideology),
    ])));
  }
  return data.colors.get(mode).get(ownerTag) || NO_DATA_COLOR;
}

export function getPoliticalDisplayLegend(state) {
  if (!isPoliticalDisplayModeActive(state)) return null;
  const payload = getPayload(state);
  const zh = state.currentLanguage === "zh";
  const alliance = state.politicalDisplayMode === "alliance";
  const categories = new Map();
  for (const country of Object.values(payload.countries)) {
    const raw = alliance ? country.alliance : country.ruling_ideology;
    if (!raw) continue;
    const id = !alliance && !IDEOLOGIES[raw] ? "other" : raw;
    categories.set(id, (categories.get(id) || 0) + 1);
  }
  const entries = [...categories].map(([id, count]) => {
    if (!alliance) return { color: IDEOLOGIES[id]?.[0] || OTHER_COLOR,
      label: IDEOLOGIES[id]?.[zh ? 1 : 2] || (zh ? "其他" : "Other") };
    const metadata = payload.alliances?.[id];
    const name = metadata?.[zh ? "name_zh" : "name_en"] || id;
    const members = metadata?.member_count ?? count;
    return { color: ALLIANCE_COLORS[id] || UNKNOWN_ALLIANCE_COLOR,
      label: zh ? `${name}（${members} 国）` : `${name} (${members} countries)` };
  });
  entries.push({ color: NO_DATA_COLOR, label: zh ? "无数据" : "No data" });
  return { title: alliance ? (zh ? "阵营" : "Alliances") : (zh ? "政体" : "Government type"),
    note: alliance ? (zh ? "未结盟国家按政体浅色显示" : "Unaligned countries use lighter government colors") : "", entries };
}
