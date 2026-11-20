import { CHINESE_FONT, ENGLISH_FONT, COUNTRY_LABEL_TRACKING, displayText, fontWeight,
  DARK_LABEL_COLORS, LIGHT_LABEL_COLORS, FADE_IN_START_PX, FADE_IN_END_PX, MAX_ALPHA } from "./country_label_text_style.js";
import { layoutManualMapLabel } from "./manual_map_label_layout.js";

export function drawManualMapLabels({ state, ctx, projection, k, getCountryName, getCountryLabelColors, requestChineseTextGlyphs, occupiedBoxes }) {
  const drawn = new Map();
  const language = state.currentLanguage || "en";
  const transform = { x: state.zoomTransform?.x || 0, y: state.zoomTransform?.y || 0, k };
  const draggingId = state.mapLabelEditor?.draggingId || "";
  for (const label of state.mapLabels) {
    // 拖动中的文字由 SVG 预览显示，Canvas 暂不绘制。
    if (draggingId && label.id === draggingId) continue;
    const name = label.text || (label.countryCode && (state.scenarioCountriesByTag?.[label.countryCode]
      ? getCountryName(label.countryCode) : label.fallbackName));
    const title = label.uppercase == null ? displayText(name, language)
      : label.uppercase ? name.toLocaleUpperCase("en") : name;
    const alpha = MAX_ALPHA * Math.min(1, (label.size * k - FADE_IN_START_PX) / (FADE_IN_END_PX - FADE_IN_START_PX));
    if (!title || alpha <= 0) continue;
    const point = projection([label.lon, label.lat]);
    if (!point || !point.every(Number.isFinite)) continue;
    const chinese = label.text ? /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(name) : language.startsWith("zh");
    if (chinese) requestChineseTextGlyphs([title]);
    const font = chinese ? CHINESE_FONT : ENGLISH_FONT;
    const tracking = label.tracking ?? COUNTRY_LABEL_TRACKING[chinese ? "chinese" : "latin"].tracking;
    const colors = label.colorMode === "auto" && label.countryCode ? getCountryLabelColors(label.countryCode)
      : label.colorMode === "light" ? LIGHT_LABEL_COLORS : DARK_LABEL_COLORS;
    ctx.save();
    ctx.font = `${fontWeight(font)} ${label.size}px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.letterSpacing = `${tracking * label.size}px`;
    ctx.globalAlpha *= alpha;
    ctx.lineWidth = label.size * 0.14;
    ctx.lineJoin = "round";
    ctx.fillStyle = colors.fill;
    ctx.strokeStyle = colors.stroke;
    const layout = layoutManualMapLabel({
      lines: title.split(/\r?\n/).map(text => ({ text, metrics: ctx.measureText(text) })),
      point, size: label.size, rotation: label.rotation, transform,
    });
    ctx.translate(...point);
    ctx.rotate(layout.angle);
    for (const { text, y, box } of layout.lines) {
      ctx.strokeText(text, 0, y);
      ctx.fillText(text, 0, y);
      occupiedBoxes.push(box);
    }
    ctx.restore();
    if (layout.lines.length) {
      const boxes = layout.lines.map(line => line.box);
      const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
      drawn.set(label.id, { x, y, w: Math.max(...boxes.map(box => box.x + box.w)) - x,
        h: Math.max(...boxes.map(box => box.y + box.h)) - y });
    }
  }
  return drawn;
}
