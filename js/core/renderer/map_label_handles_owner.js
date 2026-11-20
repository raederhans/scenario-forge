import { getCountryNameOverride } from "../country_name_overrides.js";
import { patchStrategicOverlayEditorState } from "../state/actions/strategic_overlay_actions.js";
import { requestRender } from "../render_boundary.js";
import { t } from "../i18n.js";
import { getLocalizedScenarioCountryName } from "../scenario/scenario_country_display.js";
import { CHINESE_FONT, ENGLISH_FONT, COUNTRY_LABEL_TRACKING, DARK_LABEL_COLORS, LIGHT_LABEL_COLORS,
  displayText, fontWeight } from "./country_label_text_style.js";
import { commitMapLabelMove } from "./strategic_overlay_runtime/map_label_runtime_domain.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function makePreview(doc, label, state) {
  const language = state.currentLanguage || "en";
  const country = state.scenarioCountriesByTag?.[label.countryCode];
  const name = label.text || getCountryNameOverride(state, label.countryCode) || (country ? getLocalizedScenarioCountryName(country,
    state.countryNames?.[label.countryCode] || label.countryCode, name => t(name, "geo")) : label.fallbackName);
  const title = label.uppercase == null ? displayText(name, language)
    : label.uppercase ? name.toLocaleUpperCase("en") : name;
  const chinese = label.text ? /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(name) : language.startsWith("zh");
  const font = chinese ? CHINESE_FONT : ENGLISH_FONT;
  const preview = doc.createElementNS(SVG_NS, "text");
  preview.setAttribute("font-family", font);
  preview.setAttribute("font-weight", fontWeight(font));
  preview.setAttribute("font-size", label.size);
  preview.setAttribute("letter-spacing", (label.tracking ?? COUNTRY_LABEL_TRACKING[chinese ? "chinese" : "latin"].tracking) * label.size);
  preview.setAttribute("text-anchor", "middle");
  preview.setAttribute("dominant-baseline", "central");
  preview.setAttribute("pointer-events", "none");
  preview.setAttribute("fill", label.colorMode === "light" ? LIGHT_LABEL_COLORS.fill : DARK_LABEL_COLORS.fill);
  const lines = (title || t("Enter name", "ui")).split(/\r?\n/);
  lines.forEach((line, index) => {
    const span = doc.createElementNS(SVG_NS, "tspan");
    span.setAttribute("x", 0);
    span.setAttribute("y", (index - (lines.length - 1) / 2) * label.size * 1.2);
    span.textContent = line;
    preview.appendChild(span);
  });
  return preview;
}

function beginLabelDrag(event, { rect, group, state, label, projection, pointer }) {
  if (event.button !== 0 || state.mapLabelEditor.active || state.mapLabelEditor.draggingId) return;
  event.stopPropagation();
  const { pointerId, clientX, clientY } = event;
  const doc = group.ownerDocument;
  if (doc.activeElement?.matches("#mapLabelSection textarea")) doc.activeElement.blur();
  const preview = makePreview(doc, label, state);
  const position = ([x, y]) => preview.setAttribute("transform", `translate(${x} ${y}) rotate(${label.rotation})`);
  position(projection([label.lon, label.lat]));
  group.appendChild(preview);
  rect.setPointerCapture(pointerId);
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  function finish(endEvent) {
    listeners.abort();
    preview.remove();
    if (rect.hasPointerCapture(pointerId)) rect.releasePointerCapture(pointerId);
    if (endEvent && (endEvent.clientX !== clientX || endEvent.clientY !== clientY)) {
      const coords = projection.invert(pointer(endEvent, group));
      if (coords?.every(Number.isFinite)) commitMapLabelMove(label.id, ...coords);
    }
    patchStrategicOverlayEditorState(state, "mapLabelEditor", { draggingId: null });
    requestRender("map-label-drag-end");
  }
  rect.addEventListener("pointermove", move => {
    if (move.pointerId === pointerId) position(pointer(move, group));
  }, options);
  rect.addEventListener("pointerup", up => {
    if (up.pointerId === pointerId) finish(up);
  }, options);
  const cancel = e => { if (e.pointerId === pointerId) finish(); };
  rect.addEventListener("pointercancel", cancel, options);
  rect.addEventListener("lostpointercapture", cancel, options);
  doc.addEventListener("keydown", key => {
    if (key.key === "Escape") {
      key.preventDefault();
      key.stopImmediatePropagation();
      finish();
    }
  }, { ...options, capture: true });
  patchStrategicOverlayEditorState(state, "mapLabelEditor", { selectedId: label.id, draggingId: label.id });
  state.updateStrategicOverlayUIFn?.();
  requestRender("map-label-drag-start");
}

export function syncMapLabelHandles(group, state) {
  if (!group) return;
  const editing = state.strategicOverlayUi?.modalOpen && state.strategicOverlayUi.modalSection === "label";
  group.style.pointerEvents = editing || state.mapLabelEditor.active ? "all" : "none";
  for (const rect of group.children) {
    if (!rect.dataset.labelId) continue;
    const selected = editing && rect.dataset.labelId === state.mapLabelEditor.selectedId;
    rect.setAttribute("stroke", selected && !state.mapLabelEditor.draggingId ? "currentColor" : "none");
  }
}

export function renderMapLabelHandles({ group, state, placed, k, projection, handleClick, pointer = globalThis.d3?.pointer }) {
  if (!group || state.mapLabelEditor.draggingId) return;
  const doc = group.ownerDocument;
  const remaining = new Map(Array.from(group.children, rect => [rect.dataset.labelId, rect]));
  for (const [index, { id, bounds, text, countryCode }] of placed.entries()) {
    const label = state.mapLabels[index];
    let box;
    if (bounds) {
      const { x, y } = state.zoomTransform;
      box = [(bounds.x - x) / k, (bounds.y - y) / k, bounds.w / k, bounds.h / k];
    } else if (!text && !countryCode && state.annotationView?.showMapLabels !== false) {
      const [x, y] = projection([label.lon, label.lat]);
      box = [x - 8 / k, y - 8 / k, 16 / k, 16 / k];
    } else {
      continue;
    }
    const rect = remaining.get(id) || doc.createElementNS(SVG_NS, "rect");
    remaining.delete(id);
    rect.dataset.labelId = id;
    ["x", "y", "width", "height"].forEach((key, i) => rect.setAttribute(key, box[i]));
    rect.setAttribute("fill", "transparent");
    rect.setAttribute("stroke-dasharray", "4 3");
    rect.setAttribute("vector-effect", "non-scaling-stroke");
    rect.style.touchAction = "none";
    rect.onpointerdown = event => beginLabelDrag(event, { rect, group, state, label, projection, pointer });
    rect.onclick = event => {
      event.stopPropagation();
      if (state.mapLabelEditor.active) return handleClick(event);
      if (state.mapLabelEditor.selectedId !== id) {
        patchStrategicOverlayEditorState(state, "mapLabelEditor", { selectedId: id });
        state.updateStrategicOverlayUIFn?.();
      }
    };
    rect.ondblclick = event => {
      event.stopPropagation();
      doc.querySelector("#mapLabelSection textarea")?.focus();
    };
    if (!rect.parentNode) group.appendChild(rect);
  }
  for (const rect of remaining.values()) rect.remove();
  syncMapLabelHandles(group, state);
}
