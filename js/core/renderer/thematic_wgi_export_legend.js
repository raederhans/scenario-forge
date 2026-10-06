import { getThematicWgiLegend } from "../thematic_wgi_view_model.js";

function wrapText(ctx, text, width) {
  const lines = [];
  let remaining = text;
  while (remaining) {
    let end = 1;
    while (end < remaining.length && ctx.measureText(remaining.slice(0, end + 1)).width <= width) end += 1;
    if (end < remaining.length) {
      const space = remaining.lastIndexOf(" ", end);
      if (space > 0) end = space;
    }
    lines.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
  return lines;
}

// The exported key is drawn from the same fixed bins as the map and UI.
export function drawThematicWgiExportLegend(canvas, state) {
  const legend = getThematicWgiLegend(state);
  if (!legend) return false;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Thematic legend canvas context unavailable");
  ctx.save();
  const width = 316;
  ctx.font = "bold 14px system-ui, sans-serif";
  const titleLines = wrapText(ctx, legend.title, width - 24);
  const titleExtraHeight = (titleLines.length - 1) * 18;
  ctx.font = "11px system-ui, sans-serif";
  const referenceLines = legend.referenceNote ? wrapText(ctx, legend.referenceNote, width - 24) : [];
  const referenceHeight = referenceLines.length ? referenceLines.length * 14 + 8 : 0;
  const height = 160 + titleExtraHeight + referenceHeight;
  const scale = Math.min(canvas.width / Math.max(1, state.width || canvas.width), canvas.width / 340, canvas.height / (height + 30));
  const x = 12, y = canvas.height / scale - height - 12;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#172b35";
  ctx.font = "bold 14px system-ui, sans-serif";
  titleLines.forEach((line, index) => ctx.fillText(line, x + 12, y + 12 + index * 18));
  const contentY = y + titleExtraHeight;
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText(legend.note, x + 12, contentY + 35, width - 24);
  referenceLines.forEach((line, index) => ctx.fillText(line, x + 12, contentY + 51 + index * 14));
  const binWidth = (width - 24) / legend.binCount;
  legend.entries.slice(0, legend.binCount).forEach((entry, index) => {
    const left = x + 12 + index * binWidth;
    ctx.fillStyle = entry.color;
    ctx.fillRect(left, contentY + 57 + referenceHeight, binWidth - 3, 15);
    ctx.fillStyle = "#172b35";
    ctx.fillText(entry.label, left, contentY + 77 + referenceHeight, binWidth - 2);
  });
  legend.entries.slice(legend.binCount).forEach((entry, index) => {
    const left = x + 12 + index * 143;
    ctx.fillStyle = entry.color;
    ctx.fillRect(left, contentY + 102 + referenceHeight, 12, 12);
    ctx.fillStyle = "#172b35";
    ctx.fillText(entry.label, left + 17, contentY + 102 + referenceHeight, 122);
  });
  ctx.fillStyle = "#475569";
  ctx.font = "10px system-ui, sans-serif";
  ctx.fillText(legend.source, x + 12, contentY + 130 + referenceHeight, width - 24);
  ctx.restore();
  return true;
}
