import {
  THEMATIC_WGI_LAYER_ID, THEMATIC_WGI_DATA_VERSION, THEMATIC_WGI_METRICS,
  loadThematicWgiData,
} from "./thematic_wgi_data.js";
import {
  THEMATIC_HDI_LAYER_ID, THEMATIC_HDI_DATA_VERSION, THEMATIC_HDI_METRICS,
  loadThematicHdiData,
} from "./thematic_hdi_data.js";
import {
  THEMATIC_POPULATION_LAYER_ID, THEMATIC_POPULATION_DATA_VERSION, THEMATIC_POPULATION_METRICS,
  loadThematicPopulationData,
} from "./thematic_population_data.js";

const WGI_COLORS = Object.freeze(["#edf8fb", "#b2e2e2", "#66c2a4", "#2ca25f", "#006d2c"]);
const HDI_COLORS = Object.freeze(["#f2f0f7", "#cbc9e2", "#9e9ac8", "#6a51a3"]);
const COMPONENT_COLORS = Object.freeze(["#f2f0f7", "#dadaeb", "#bcbddc", "#9e9ac8", "#6a51a3"]);
const POPULATION_COLORS = Object.freeze(["#ffffd4", "#fed98e", "#fe9929", "#d95f0e", "#993404"]);
const POPULATION_SCALES = {
  wdi_population_total: { thresholds: [1e6, 1e7, 5e7, 1e8], labels: ["<1M", "1M–<10M", "10M–<50M", "50M–<100M", "≥100M"] },
  wdi_population_density: { thresholds: [25, 100, 250, 1000], labels: ["<25", "25–<100", "100–<250", "250–<1k", "≥1k"] },
  wdi_urban_population_share: { thresholds: [20, 40, 60, 80], labels: ["<20%", "20–<40%", "40–<60%", "60–<80%", "80–100%"] },
  wdi_population_65_plus_share: { thresholds: [5, 10, 15, 20], labels: ["<5%", "5–<10%", "10–<15%", "15–<20%", "≥20%"] },
  wdi_total_fertility_rate: { thresholds: [1.5, 2.1, 3, 5], labels: ["<1.5", "1.5–<2.1", "2.1–<3", "3–<5", "≥5"] },
};
// Component cutoffs are fixed cartographic intervals, not UNDP development categories.
const HDI_SCALES = {
  undp_hdi: { thresholds: [0.55, 0.7, 0.8], labels: ["<0.550", "0.550–<0.700", "0.700–<0.800", "0.800–1.000"], colors: HDI_COLORS },
  undp_life_expectancy: { thresholds: [60, 65, 70, 75], labels: ["<60", "60–<65", "65–<70", "70–<75", "≥75"] },
  undp_expected_schooling: { thresholds: [8, 12, 16, 20], labels: ["<8", "8–<12", "12–<16", "16–<20", "≥20"] },
  undp_mean_schooling: { thresholds: [4, 6, 8, 10], labels: ["<4", "4–<6", "6–<8", "8–<10", "≥10"] },
  undp_gni_per_capita: { thresholds: [2500, 10000, 25000, 50000], labels: ["<2.5k", "2.5k–<10k", "10k–<25k", "25k–<50k", "≥50k"] },
};

export const THEMATIC_INDICATORS = Object.freeze([
  ...THEMATIC_WGI_METRICS.map((metric) => Object.freeze({ ...metric,
    family: "wgi", layerId: THEMATIC_WGI_LAYER_ID, dataVersion: THEMATIC_WGI_DATA_VERSION,
    year: 2024, unit: "score_0_100", source: "World Bank WGI",
    attribution: "World Bank WGI · 2025 revision · CC BY 4.0",
    thresholds: Object.freeze([20, 40, 60, 80]), colors: WGI_COLORS,
    labels: Object.freeze(["0–<20", "20–<40", "40–<60", "60–<80", "80–100"]),
  })),
  ...THEMATIC_HDI_METRICS.map((metric) => Object.freeze({ ...metric,
    family: "undp", layerId: THEMATIC_HDI_LAYER_ID, dataVersion: THEMATIC_HDI_DATA_VERSION,
    year: 2023, source: "UNDP HDR 2025", attribution: "UNDP HDR 2025 · CC BY 3.0 IGO",
    thresholds: Object.freeze(HDI_SCALES[metric.id].thresholds),
    labels: Object.freeze(HDI_SCALES[metric.id].labels),
    colors: HDI_SCALES[metric.id].colors || COMPONENT_COLORS,
  })),
  ...THEMATIC_POPULATION_METRICS.map((metric) => Object.freeze({ ...metric,
    family: "wdi-population", layerId: THEMATIC_POPULATION_LAYER_ID, dataVersion: THEMATIC_POPULATION_DATA_VERSION,
    year: 2023, source: "World Bank WDI", attribution: "World Bank WDI · 2026-07-13 · CC BY 4.0",
    thresholds: Object.freeze(POPULATION_SCALES[metric.id].thresholds),
    labels: Object.freeze(POPULATION_SCALES[metric.id].labels), colors: POPULATION_COLORS,
  })),
]);

const BY_ID = new Map(THEMATIC_INDICATORS.map((metric) => [metric.id, metric]));
export function getThematicIndicator(metricId) { return BY_ID.get(metricId); }

export function loadThematicIndicatorData(options) {
  const metric = getThematicIndicator(options?.metricId);
  if (!metric) return Promise.reject(new RangeError(`Unsupported thematic indicator: ${options?.metricId}`));
  if (metric.family === "wdi-population") return loadThematicPopulationData(options);
  return metric.family === "undp" ? loadThematicHdiData(options) : loadThematicWgiData(options);
}

export function formatThematicIndicatorValue(metric, value, language = "en") {
  const locale = language === "zh" ? "zh-CN" : "en-US";
  if (metric.unit === "persons") return `${value.toLocaleString(locale, { maximumFractionDigits: 0 })} ${language === "zh" ? "人" : "people"}`;
  if (metric.unit === "persons_per_km2") return `${value.toLocaleString(locale, { maximumFractionDigits: 1 })} ${language === "zh" ? "人/平方公里" : "people/km²"}`;
  if (metric.unit === "percent") return `${value.toFixed(1)}%`;
  if (metric.unit === "births_per_woman") return `${value.toFixed(2)} ${language === "zh" ? "出生数/妇女" : "births/woman"}`;
  if (metric.unit === "index_0_1") return value.toFixed(3);
  if (metric.unit === "years") return `${value.toFixed(1)} ${language === "zh" ? "年" : "years"}`;
  if (metric.unit === "usd_2021_ppp") {
    return `${value.toLocaleString(language === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 0 })} (2021 PPP $)`;
  }
  return `${value.toFixed(1)} / 100`;
}

export function getThematicIndicatorNote(metric, language = "en") {
  const zh = language === "zh";
  if (metric.family === "wgi") return zh ? "国家／经济体指标 · 0–100 分，越高越强" : "Country/economy score · 0–100, higher is stronger";
  if (metric.family === "wdi-population") {
    if (metric.unit === "persons") return zh ? "国家／经济体总人口 · M = 百万人" : "Country/economy total · M = million people";
    if (metric.unit === "persons_per_km2") return zh ? "国家平均值 · 人/平方公里陆地面积" : "National average · People/km² of land area";
    if (metric.unit === "births_per_woman") return zh ? "出生数/妇女 · 固定制图区间" : "Births/woman · Fixed cartographic intervals";
    return zh ? "占总人口比例 · 固定制图区间" : "Share of total population · Fixed cartographic intervals";
  }
  if (metric.unit === "index_0_1") return zh ? "HDI · 0–1，越高越好 · UNDP 官方分级" : "HDI · 0–1, higher is better · UNDP categories";
  return metric.unit === "years"
    ? (zh ? "单位：年 · 固定制图区间" : "Years · Fixed cartographic intervals")
    : (zh ? "2021 PPP 美元 · 固定制图区间" : "2021 PPP $ · Fixed cartographic intervals");
}
