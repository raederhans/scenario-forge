// 界面图标统一用内联 SVG（规范见 docs/design/editor-ui-system.zh-CN.md §3），不再用 < > - + v 等字符。
const SVG_NS = "http://www.w3.org/2000/svg";

const ICON_PATHS = Object.freeze({
  "eye": ["M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z", "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"],
  "eye-off": ["m3 3 18 18", "M10 5a12 12 0 0 1 12 7s-1 2-3 4", "M6 6a18 18 0 0 0-4 6s4 7 10 7c2 0 3-1 4-1"],
  "borders": ["M4 3v18M20 3v18", "m9 3 5 5-4 4 4 4-5 5"],
  "special-zones": ["m12 3 9 6-3 11H6L3 9Z", "m9 12 2 2 4-4"],
  "ocean": ["M3 8q3-4 6 0t6 0 6 0M3 13q3-4 6 0t6 0 6 0M3 18q3-4 6 0t6 0 6 0"],
  "physical": ["m2 20 7-15 6 15H2Zm11-8 3-6 6 14h-7", "m6 11 3 2 3-2"],
  "rivers": ["M8 3c12 5-10 10 3 18M15 3c12 5-10 10 3 18"],
  "urban": ["M3 21V9h6v12M9 21V3h6v18M15 21V12h6v9M2 21h20"],
  "citypoints": ["M18 9c0 5-6 12-6 12S6 14 6 9a6 6 0 0 1 12 0Z", "M14 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z"],
  "transport": ["m6 3-3 18M18 3l3 18M12 3v4m0 3v4m0 3v4"],
  "thematic": ["M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7"],
  "annotations": ["m4 16 12-12 4 4L8 20H4Z", "m14 6 4 4"],
  "legend": ["M3 5h4v4H3ZM3 15h4v4H3ZM11 7h10M11 17h10"],
  "presets": ["m12 3 10 5-10 5L2 8Z", "m2 12 10 5 10-5M2 16l10 5 10-5"],
  "daynight": ["M15 3a9 9 0 1 0 6 12A9 9 0 0 1 15 3Z"],
  "texture": ["M3 3h18v18H3Z", "m3 9 6-6M3 15 15 3M3 21 21 3M9 21 21 9M15 21l6-6"],
  "reference": ["m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z", "M9 3v16M15 5v16"],
  "display": ["M3 4h18v13H3ZM8 21h8M12 17v4"],

  "chevron-right": ["m9 6 6 6-6 6"],
  "chevron-left": ["m15 6-6 6 6 6"],
  "chevron-down": ["m6 9 6 6 6-6"],
  "chevron-up": ["m6 15 6-6 6 6"],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  close: ["M6 6l12 12", "M18 6 6 18"],
  // 右栏面板开关：外框 + 右侧竖线。
  "panel-right": ["M5 5h14v14H5z", "M15 5v14"],
  "external-link": ["M14 5h5v5", "M19 5l-8 8", "M17 13v6H5V7h6"],
});

function createUiIcon(name, { size = 16, className = "ui-icon", doc = globalThis.document } = {}) {
  const paths = ICON_PATHS[name];
  if (!paths) throw new Error(`Unknown UI icon: ${name}`);
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", `${className} ui-icon-${name}`);
  for (const d of paths) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
  }
  return svg;
}

// 把元素内容替换成指定图标；名称相同时不重建，避免列表重绘时抖动。
function setUiIcon(element, name, options) {
  if (!element) return;
  if (element.dataset.uiIcon === name && element.firstElementChild) return;
  element.replaceChildren(createUiIcon(name, { doc: element.ownerDocument || globalThis.document, ...options }));
  element.dataset.uiIcon = name;
}

export { ICON_PATHS, createUiIcon, setUiIcon };
