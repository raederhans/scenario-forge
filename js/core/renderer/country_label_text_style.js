export const ENGLISH_FONT = '"Map Garamond", "Palatino Linotype", Georgia, serif';
export const CHINESE_FONT = '"Map Noto Serif SC", "Noto Serif SC", "Songti SC", SimSun, serif';
export const fontWeight = (font) => font === CHINESE_FONT ? 400 : 500;
export const displayText = (name, language) => {
  const text = String(name || "").trim();
  // Strategy-map titles are spaced capitals; tracking stretches them along
  // the territory instead of shrinking multiword names to mixed case.
  return language.startsWith("en") ? text.toLocaleUpperCase("en") : text;
};

// 国名标签的基础字距与按路径长度撑开的上限（单位 em）。
// 中文字形本身方正，上限放到 0.9em 会让短名读成逐字拆开，因此收紧到 0.25em。
export const COUNTRY_LABEL_TRACKING = Object.freeze({
  chinese: Object.freeze({ tracking: 0.12, maxTracking: 0.25 }),
  latin: Object.freeze({ tracking: 0.08, maxTracking: 0.6 }),
});

export const FADE_IN_START_PX = 7;
export const FADE_IN_END_PX = 10;
export const MAX_ALPHA = 0.82;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const FADE_OUT_START_PX = 120;
const FADE_OUT_END_PX = 200;

export function getVisibilityAlpha(fontSizePx) {
  const legible = clamp((fontSizePx - FADE_IN_START_PX) / (FADE_IN_END_PX - FADE_IN_START_PX), 0, 1);
  const overview = clamp((FADE_OUT_END_PX - fontSizePx) / (FADE_OUT_END_PX - FADE_OUT_START_PX), 0, 1);
  return legible * overview * MAX_ALPHA;
}

export const DARK_LABEL_COLORS = { fill: "#172b35", stroke: "rgba(255, 252, 241, 0.22)" };
export const LIGHT_LABEL_COLORS = { fill: "#f4f1e7", stroke: "rgba(16, 24, 32, 0.3)" };
