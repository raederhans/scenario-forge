import { CHINESE_FONT, ENGLISH_FONT, fontWeight } from "./country_label_text_style.js";

const defaults = {
  title: ["top-center", "large"],
  subtitle: ["top-center", "medium"],
  attribution: ["bottom-right", "small"],
};
const sizes = { small: 14, medium: 20, large: 32 };
const positions = ["top-left", "top-center", "top-right", "bottom-left", "bottom-right"];

export function normalizeMapTitles(raw) {
  return Object.fromEntries(Object.entries(defaults).map(([key, [position, size]]) => {
    const row = raw?.[key];
    return [key, {
      enabled: row?.enabled === true,
      text: typeof row?.text === "string" ? row.text : "",
      position: positions.includes(row?.position) ? row.position : position,
      size: Object.hasOwn(sizes, row?.size) ? row.size : size,
      background: row?.background === "dark" ? "dark" : "light",
    }];
  }));
}

export function hasMapTitles(titles) {
  return Object.values(titles || {}).some(row => row?.enabled && row.text?.trim());
}

export function layoutMapTitles(canvas, titles, ratio) {
  if (!hasMapTitles(titles)) return [];
  const ctx = canvas.getContext("2d");
  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  const rows = [];
  ctx.save();
  for (const row of Object.values(normalizeMapTitles(titles))) {
    const text = row.text.trim();
    if (!row.enabled || !text) continue;
    const size = sizes[row.size];
    const family = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text) ? CHINESE_FONT : ENGLISH_FONT;
    const font = `${fontWeight(family)} ${size}px ${family}`;
    ctx.font = font;
    const w = Math.min(ctx.measureText(text).width + 16, width - 24);
    const h = size + 12;
    if (w <= 16 || h > height - 24) continue;
    const [edge, align] = row.position.split("-");
    const x = align === "left" ? 12 : align === "right" ? width - 12 - w : (width - w) / 2;
    const bottom = edge === "bottom";
    let y = bottom ? height - h - 12 : 12;
    for (const prev of rows) {
      if (x < prev.x + prev.w && prev.x < x + w && y < prev.y + prev.h + 4 && prev.y < y + h + 4) {
        y = bottom ? prev.y - h - 4 : prev.y + prev.h + 4;
      }
    }
    rows.push({ text, font, dark: row.background === "dark", x, y, w, h });
  }
  ctx.restore();
  return rows;
}

export function drawMapTitles(canvas, titles, ratio) {
  const rows = layoutMapTitles(canvas, titles, ratio);
  if (!rows.length) return;
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const { text, font, dark, x, y, w, h } of rows) {
    ctx.fillStyle = dark ? "#25303a" : "#ffffff";
    ctx.fillRect(x, y, w, h);
    ctx.font = font;
    ctx.fillStyle = dark ? "#ffffff" : "#25303a";
    ctx.fillText(text, x + w / 2, y + h / 2, w - 16);
  }
  ctx.restore();
}

export function renderViewportMapTitles(canvas, state) {
  if (!canvas) return;
  const titles = state.exportWorkbenchUi?.mapTitles;
  const visible = hasMapTitles(titles);
  canvas.style.display = visible ? "block" : "none";
  if (!visible) return;
  const ratio = state.dpr || 1;
  const width = Math.round(state.width * ratio);
  const height = Math.round(state.height * ratio);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  canvas.getContext("2d").clearRect(0, 0, width, height);
  drawMapTitles(canvas, titles, ratio);
}

export function positionMapTitleAwareLegend(canvas, state, scale, width, height) {
  const margin = 12;
  const right = canvas.width / scale - width - margin;
  const bottom = canvas.height / scale - height - margin;
  const ratio = canvas.width / (state.width || canvas.width);
  const rows = layoutMapTitles(canvas, state.exportWorkbenchUi?.mapTitles, ratio);
  const factor = ratio / scale;
  const candidates = [[margin, bottom], [right, bottom], [margin, margin], [right, margin]];
  let best = candidates[0];
  let bestArea = Infinity;
  for (const candidate of candidates) {
    const [x, y] = candidate;
    let area = 0;
    for (const row of rows) {
      const w = Math.max(0, Math.min(x + width, (row.x + row.w) * factor) - Math.max(x, row.x * factor));
      const h = Math.max(0, Math.min(y + height, (row.y + row.h) * factor) - Math.max(y, row.y * factor));
      area += w * h;
    }
    if (area === 0) return candidate;
    if (area < bestArea) {
      bestArea = area;
      best = candidate;
    }
  }
  return best;
}
