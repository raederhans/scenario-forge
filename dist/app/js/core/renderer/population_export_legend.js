import { getPopulationLegend } from "../population_spatial_view_model.js";

export function drawPopulationExportLegend(canvas, state) {
  const legend = getPopulationLegend(state);
  if (!legend) return false;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Population legend canvas context unavailable");
  const zh = state.currentLanguage === "zh";
  const width = 340;
  const height = 108 + legend.entries.length * 18 + (legend.referenceNote ? 32 : 0);
  const scale = Math.min(canvas.width / Math.max(1, state.width || canvas.width), canvas.width / (width + 24), canvas.height / (height + 24));
  const x = 12, y = canvas.height / scale - height - 12;
  ctx.save(); ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 1; ctx.strokeRect(x, y, width, height);
  ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillStyle = "#172b35";
  ctx.font = "bold 14px system-ui, sans-serif"; ctx.fillText(legend.title, x + 12, y + 12, width - 24);
  ctx.font = "11px system-ui, sans-serif";
  const heatmap = state.styleConfig?.population?.mode === "heatmap";
  ctx.fillText(heatmap
    ? (zh ? "人／平方公里有效栅格面积 · 1 公里源栅格" : "Persons/km² valid raster area · 1 km source grid")
    : (zh ? "人／平方公里建模陆地 · 1 公里源栅格" : "Persons/km² modelled land · 1 km source grid"), x + 12, y + 34, width - 24);
  legend.entries.forEach((entry, index) => {
    const top = y + 56 + index * 18;
    ctx.fillStyle = entry.color; ctx.fillRect(x + 12, top, 14, 12);
    ctx.fillStyle = "#172b35"; ctx.fillText(entry.label, x + 34, top, width - 46);
  });
  let top = y + 64 + legend.entries.length * 18;
  if (legend.referenceNote) {
    ctx.fillText(zh ? "2020 年人口映射到剧本疆域" : "2020 population mapped to scenario boundaries", x + 12, top, width - 24);
    ctx.fillText(zh ? "不代表剧本年代人口" : "Not a scenario-year estimate", x + 12, top + 14, width - 24);
    top += 32;
  }
  ctx.font = "10px system-ui, sans-serif"; ctx.fillStyle = "#475569";
  ctx.fillText("European Commission, JRC · GHSL GHS-POP R2023A", x + 12, top, width - 24);
  ctx.fillText("Epoch 2020 · CC BY 4.0", x + 12, top + 14, width - 24);
  ctx.restore(); return true;
}
