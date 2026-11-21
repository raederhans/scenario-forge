import { createRevisionedLegendColorReader, LegendManager } from "../legend_manager.js";
import { getSpecialZoneLayerDisplayName, getSpecialZonePatternDefinition } from "../special_zone_layers.js";
import { getPoliticalDisplayLegend } from "../political_display_mode.js";
import { isPopulationActive } from "../thematic/population_spatial_view_model.js";
import { isThematicWgiActive } from "../thematic/thematic_wgi_view_model.js";

const readColors = createRevisionedLegendColorReader();
const uiFont = '"Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Noto Sans SC", sans-serif';

export function getPoliticalExportLegend(state) {
  const control = LegendManager.getControlState(state);
  const zh = String(state.currentLanguage || "").toLowerCase().startsWith("zh");
  const labels = state.legendLabels;
  const thematic = isPopulationActive(state) || isThematicWgiActive(state);
  const political = thematic ? null : getPoliticalDisplayLegend(state);
  const colors = political?.entries || (thematic ? [] : readColors(state).filter(color => labels[color])
    .map(color => ({ color, label: labels[color] })));
  const zones = LegendManager.getSpecialZoneLayers(state).map(layer => ({
    color: layer.style.fill,
    style: layer.style,
    label: getSpecialZoneLayerDisplayName(layer, state.currentLanguage),
  }));
  const config = LegendManager.getConfig(state);
  return { control, colors, zones, title: config.title || political?.title || (zh ? "图例" : "Legend"),
    zoneTitle: zh ? "特殊区域图层" : "Special Zone Layers", note: political?.note || "",
    background: config.exportBackground, opaque: config.exportOpaque };
}

const hatchPaths = {
  diagonalHatch: "M-4 14L14 -4 M0 18L18 0",
  crossHatch: "M-4 14L14 -4 M0 18L18 0 M0 -4L18 14 M-4 0L14 18",
  horizontalLines: "M0 4H14 M0 10H14",
  wavyLines: "M0 5C3 2 5 8 8 5S12 2 14 5 M0 11C3 8 5 14 8 11S12 8 14 11",
  chevrons: "M1 9L7 4L13 9 M1 14L7 9L13 14",
};

function drawPattern(ctx, style, x, y) {
  const { pattern, strokeWidth, stroke } = style;
  const definition = getSpecialZonePatternDefinition(pattern);
  const size = definition?.size || (pattern === "denseDots" ? 8 : 14);
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.rect(0, 0, 14, 14);
  ctx.clip();
  ctx.rotate((definition?.rotation || 0) * Math.PI / 180);
  ctx.fillStyle = ctx.strokeStyle = stroke;
  ctx.globalAlpha = style.patternOpacity;
  const circle = (cx, cy, r, outline = false) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    if (outline) ctx.stroke();
    else ctx.fill();
  };
  for (let i = -2; i <= 3; i++) {
    for (let j = -2; j <= 3; j++) {
      ctx.save();
      ctx.translate(i * size, j * size);
      ctx.beginPath();
      ctx.rect(0, 0, size, size);
      ctx.clip();
      if (definition) {
        for (const [tag, attrs] of definition.marks) {
          if (tag === "circle") circle(attrs.cx, attrs.cy, attrs.r);
          if (tag === "rect") ctx.fillRect(0, 0, attrs.width, attrs.height);
          if (tag === "path") {
            ctx.lineWidth = attrs["stroke-width"];
            if (attrs["stroke-dasharray"]) ctx.setLineDash([3, 3]);
            ctx.stroke(new Path2D(attrs.d));
          }
        }
      } else if (hatchPaths[pattern]) {
        ctx.lineWidth = ["crossHatch", "wavyLines"].includes(pattern) ? strokeWidth * 0.75 : strokeWidth;
        ctx.stroke(new Path2D(hatchPaths[pattern]));
      } else if (pattern === "concentric") {
        ctx.lineWidth = strokeWidth * 0.7;
        circle(7, 7, 2.2, true);
        ctx.lineWidth = strokeWidth * 0.55;
        circle(7, 7, 5.4, true);
      } else if (pattern === "denseDots") {
        circle(2, 2, 1.1);
        circle(6, 6, 1.1);
      } else {
        circle(4, 4, 1.35);
        circle(10, 10, 1.35);
      }
      ctx.restore();
    }
  }
  ctx.restore();
}

function fitText(ctx, label, width) {
  if (ctx.measureText(label).width <= width) return label;
  const chars = Array.from(label);
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const end = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(chars.slice(0, end).join("") + "…").width <= width) lo = end;
    else hi = end - 1;
  }
  return chars.slice(0, lo).join("") + "…";
}

export function drawPoliticalExportLegend(canvas, state, pixelRatio = canvas.width / (state.width || canvas.width)) {
  const { control, colors, zones, title, zoneTitle, background, opaque, note } = getPoliticalExportLegend(state);
  if (!colors.length && !zones.length) return false;
  const rows = [...colors];
  if (zones.length) rows.push({ label: zoneTitle }, ...zones);
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.font = `12px ${uiFont}`;
  const maxHeight = Math.min(canvas.height / pixelRatio * 0.45, control.height ?? Infinity);
  const footerHeight = note ? 20 : 0;
  const capacity = Math.max(1, Math.floor((maxHeight - 34 - footerHeight) / 20));
  const columns = Math.min(3, Math.ceil(rows.length / capacity));
  const perColumn = Math.ceil(rows.length / columns);
  const colWidth = control.width;
  const width = Math.max(columns * colWidth, note ? ctx.measureText(note).width + 20 : 0);
  const height = 34 + perColumn * 20 + footerHeight;
  const scale = Math.min(pixelRatio, canvas.width / (width + 16), canvas.height / (height + 16));
  const x = Math.max(8, Math.round((canvas.width / scale - width - 8) * control.xRatio));
  const y = Math.max(8, Math.round((canvas.height / scale - height - 8) * control.yRatio));
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  if (background !== "none") {
    ctx.globalAlpha = opaque ? 1 : control.opacity;
    ctx.fillStyle = background === "dark" ? "#1f2937" : "#ffffff";
    ctx.fillRect(x, y, width, height);
  }
  const ink = background === "dark" ? "#ffffff" : "#1f2937";
  ctx.globalAlpha = 1;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = ink;
  ctx.font = `bold 14px ${uiFont}`;
  ctx.fillText(fitText(ctx, title, width - 20), x + 10, y + 8);
  ctx.font = `12px ${uiFont}`;
  rows.forEach(({ color, label, style }, i) => {
    const left = x + 10 + Math.floor(i / perColumn) * colWidth;
    const top = y + 30 + (i % perColumn) * 20;
    if (color && style?.pattern !== "outlineOnly") {
      ctx.globalAlpha = style?.fillOpacity ?? 1;
      ctx.fillStyle = color;
      ctx.fillRect(left, top, 14, 14);
      if (style && style.pattern !== "solid") drawPattern(ctx, style, left, top);
    }
    ctx.globalAlpha = 1;
    if (style) {
      ctx.globalAlpha = style.strokeOpacity;
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = style.strokeWidth;
      ctx.strokeRect(left, top, 14, 14);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = ink;
    ctx.fillText(fitText(ctx, label, colWidth - (color ? 40 : 20)), left + (color ? 20 : 0), top);
  });
  if (note) ctx.fillText(note, x + 10, y + height - 20);
  ctx.restore();
  return true;
}
