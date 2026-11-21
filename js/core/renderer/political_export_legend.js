import { createRevisionedLegendColorReader, LegendManager } from "../legend_manager.js";
import { getSpecialZoneLayerDisplayName } from "../special_zone_layers.js";
import { isPoliticalDisplayModeActive } from "../political_display_mode.js";
import { isPopulationActive } from "../thematic/population_spatial_view_model.js";
import { isThematicWgiActive } from "../thematic/thematic_wgi_view_model.js";

const readColors = createRevisionedLegendColorReader();
const uiFont = '"Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Noto Sans SC", sans-serif';

export function getPoliticalExportLegend(state) {
  const control = LegendManager.getControlState(state);
  const zh = String(state.currentLanguage || "").toLowerCase().startsWith("zh");
  const labels = state.legendLabels;
  const thematic = isPopulationActive(state) || isThematicWgiActive(state) || isPoliticalDisplayModeActive(state);
  const colors = thematic ? [] : readColors(state).filter(color => labels[color])
    .map(color => ({ color, label: labels[color] }));
  const zones = LegendManager.getSpecialZoneLayers(state).map(layer => ({
    color: layer.style.fill,
    stroke: layer.style.stroke,
    label: getSpecialZoneLayerDisplayName(layer, state.currentLanguage),
  }));
  return { control, colors, zones, title: zh ? "图例" : "Legend", zoneTitle: zh ? "特殊区域图层" : "Special Zone Layers" };
}

export function drawPoliticalExportLegend(canvas, state, pixelRatio = canvas.width / (state.width || canvas.width)) {
  const { control, colors, zones, title, zoneTitle } = getPoliticalExportLegend(state);
  if (!colors.length && !zones.length) return false;
  const width = control.width;
  const height = 34 + (colors.length + zones.length + Number(!!zones.length)) * 20;
  const scale = Math.min(pixelRatio, canvas.width / (width + 16), canvas.height / (height + 16));
  const x = Math.max(8, Math.round((canvas.width / scale - width - 8) * control.xRatio));
  const y = Math.max(8, Math.round((canvas.height / scale - height - 8) * control.yRatio));
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalAlpha = control.opacity;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, width, height);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = "#1f2937";
  ctx.font = `bold 14px ${uiFont}`;
  ctx.fillText(title, x + 10, y + 8);
  ctx.font = `12px ${uiFont}`;
  let rowY = y + 30;
  function drawRow({ color, label, stroke }) {
    ctx.fillStyle = color;
    ctx.fillRect(x + 10, rowY, 14, 14);
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.strokeRect(x + 10, rowY, 14, 14);
    }
    ctx.fillStyle = "#1f2937";
    ctx.fillText(label, x + 30, rowY, width - 40);
    rowY += 20;
  }
  colors.forEach(drawRow);
  if (zones.length) {
    ctx.fillText(zoneTitle, x + 10, rowY);
    rowY += 20;
    zones.forEach(drawRow);
  }
  ctx.restore();
  return true;
}
