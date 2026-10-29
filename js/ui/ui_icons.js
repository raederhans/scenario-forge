// 界面图标统一用内联 SVG（规范见 docs/design/editor-ui-system.zh-CN.md §3），不再用 < > - + v 等字符。
const SVG_NS = "http://www.w3.org/2000/svg";

const ICON_PATHS = Object.freeze({
  "chevron-right": ["m9 6 6 6-6 6"],
  "chevron-left": ["m15 6-6 6 6 6"],
  "chevron-down": ["m6 9 6 6 6-6"],
  "chevron-up": ["m6 15 6-6 6 6"],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  close: ["M6 6l12 12", "M18 6 6 18"],
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
