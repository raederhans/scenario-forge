import { CHINESE_FONT, ENGLISH_FONT, COUNTRY_LABEL_TRACKING, displayText, fontWeight,
  DARK_LABEL_COLORS, LIGHT_LABEL_COLORS, getVisibilityAlpha } from "./country_label_text_style.js";
import { layoutManualMapLabel, layoutCurvedManualMapLabel } from "./manual_map_label_layout.js";

const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
const shapedText = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Myanmar}\p{Script=Khmer}\p{Script=Syriac}]/u;
const glyphMetrics = new Map();

export function clearManualMapLabelMetrics() {
  glyphMetrics.clear();
}

function measureGlyph(ctx, text) {
  const key = ctx.font + "\n" + text;
  if (!glyphMetrics.has(key)) {
    if (glyphMetrics.size >= 2048) glyphMetrics.delete(glyphMetrics.keys().next().value);
    glyphMetrics.set(key, ctx.measureText(text));
  }
  return { text, metrics: glyphMetrics.get(key) };
}

export function drawManualMapLabels({ state, ctx, projection, k, getCountryName, getCountryLabelColors, requestChineseTextGlyphs, occupiedBoxes }) {
  const drawn = new Map();
  const language = state.currentLanguage || "en";
  const transform = { x: state.zoomTransform?.x || 0, y: state.zoomTransform?.y || 0, k };
  const draggingId = state.mapLabelEditor?.draggingId || "";
  for (const label of state.mapLabels) {
    // 拖动中的文字由 SVG 预览显示，Canvas 暂不绘制。
    if (draggingId && label.id === draggingId) continue;
    const name = label.text || (label.countryCode && getCountryName(label.countryCode, label.fallbackName));
    if (!name) continue;
    const countryStyle = !label.text && label.countryCode ? state.styleConfig?.countryLabels : null;
    const title = label.uppercase === true ? name.toLocaleUpperCase("en")
      : label.uppercase == null && !label.text && countryStyle?.uppercase !== false ? displayText(name, language) : name;
    const size = label.size * (countryStyle?.sizeScale ?? 1);
    const alpha = getVisibilityAlpha(size * k) * (label.opacity ?? countryStyle?.opacity ?? 1);
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
    ctx.font = `${label.italic ? "italic " : ""}${label.weight ?? fontWeight(font)} ${size}px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const curved = label.curve && segmenter && !shapedText.test(title);
    ctx.letterSpacing = curved ? "0px" : `${tracking * size}px`;
    ctx.globalAlpha *= alpha;
    ctx.lineWidth = size * 0.14;
    ctx.lineJoin = "round";
    ctx.fillStyle = label.color || colors.fill;
    ctx.strokeStyle = colors.stroke;
    const lines = title.split(/\r?\n/);
    const geometry = { point, size, rotation: label.rotation, transform };
    let boxes, glyphs = null;
    if (curved) {
      const layout = layoutCurvedManualMapLabel({ ...geometry, curve: label.curve, spacing: tracking * size,
        lines: lines.map(line => Array.from(segmenter.segment(line), ({ segment }) => measureGlyph(ctx, segment))) });
      ctx.translate(...point);
      ctx.rotate(layout.angle);
      for (const paint of ["strokeText", "fillText"]) {
        for (const glyph of layout.glyphs) {
          ctx.save();
          ctx.translate(glyph.x, glyph.y);
          ctx.rotate(glyph.angle);
          ctx[paint](glyph.text, 0, 0);
          ctx.restore();
        }
      }
      ({ boxes, glyphs } = layout);
    } else {
      const layout = layoutManualMapLabel({ ...geometry,
        lines: lines.map(text => ({ text, metrics: ctx.measureText(text) })) });
      ctx.translate(...point);
      ctx.rotate(layout.angle);
      for (const { text, y } of layout.lines) {
        ctx.strokeText(text, 0, y);
        ctx.fillText(text, 0, y);
      }
      boxes = layout.lines.map(line => line.box);
    }
    ctx.restore();
    if (boxes.length) {
      let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
      for (const box of boxes) {
        occupiedBoxes.push(box);
        x = Math.min(x, box.x);
        y = Math.min(y, box.y);
        right = Math.max(right, box.x + box.w);
        bottom = Math.max(bottom, box.y + box.h);
      }
      drawn.set(label.id, { bounds: { x, y, w: right - x, h: bottom - y }, font, fontSize: size, glyphs });
    }
  }
  return drawn;
}
