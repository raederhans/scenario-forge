import { normalizeHexColor } from "../../core/color_hex_utils.js";

function textFor(language) {
  return String(language || "en").startsWith("zh") ? {
    search: "搜索图例", placeholder: "名称或 #色号", type: "图例类型", all: "全部类型",
    color: "颜色", zone: "特殊区域", clear: "清空", count: "{matches} / {total} 项",
    none: "没有匹配的图例。请修改关键词或清空筛选。", category: "类别",
    keyboard: "按 Enter 跳到首个结果，按 Esc 清空筛选。",
  } : {
    search: "Search legend", placeholder: "Name or #hex color", type: "Legend entry type", all: "All entries",
    color: "Colors", zone: "Special zones", clear: "Clear", count: "{matches} of {total} entries",
    none: "No matching legend entries. Try another term or clear the filters.", category: "Category",
    keyboard: "Press Enter to focus the first result, or Esc to clear the filters.",
  };
}

function searchable(value) {
  return String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

export function buildLegendSearchItems({ colors = [], labels = {}, specialZones = [], language = "en" } = {}) {
  const text = textFor(language);
  return [
    ...colors.map((color, index) => ({ type: "color", color, index,
      label: String(labels[color] || "").trim() || `${text.category} ${index + 1}` })),
    ...specialZones.filter(layer => layer.visible !== false && layer.legendVisible !== false)
      .map(layer => ({ type: "special-zone", layer, color: layer.style?.fill || "", label: String(layer.name || layer.id || text.zone) })),
  ];
}

export function filterLegendEntries(items, { query = "", kind = "all" } = {}) {
  const tokens = searchable(query).trim().split(/\s+/u).filter(Boolean)
    .map(token => token.startsWith("#") ? normalizeHexColor(token) || token : token);
  return items.filter(item => {
    if (kind !== "all" && item.type !== kind) return false;
    const haystack = searchable(`${item.label} ${normalizeHexColor(item.color) || item.color}`);
    return tokens.every(token => haystack.includes(token));
  });
}

export function createLegendSearchControls({ documentRef, onChange, onEnter }) {
  let query = "";
  let kind = "all";
  let language = "en";
  const element = documentRef.createElement("div");
  element.className = "legend-search-controls";
  const field = documentRef.createElement("div");
  field.className = "legend-search-field";
  const input = documentRef.createElement("input");
  input.type = "search";
  input.id = "legendSearchInput";
  input.className = "legend-search-input";
  input.setAttribute("aria-controls", "legendEditorResults");
  const clear = documentRef.createElement("button");
  clear.id = "legendSearchClearBtn";
  clear.className = "legend-search-clear";
  clear.type = "button";
  const summary = documentRef.createElement("div");
  summary.className = "legend-search-summary";
  const select = documentRef.createElement("select");
  select.id = "legendSearchType";
  select.className = "legend-search-type";
  const options = ["all", "color", "special-zone"].map(value => {
    const option = documentRef.createElement("option");
    option.value = value;
    select.appendChild(option);
    return option;
  });
  const status = documentRef.createElement("span");
  status.id = "legendSearchStatus";
  status.className = "legend-search-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  input.setAttribute("aria-describedby", status.id);
  field.append(input, clear);
  summary.append(select, status);
  element.append(field, summary);

  function getFilters() { return { query, kind }; }
  function changed() {
    clear.disabled = !query && kind === "all";
    onChange(getFilters());
  }
  function reset({ notify = true } = {}) {
    query = "";
    kind = "all";
    input.value = "";
    select.value = "all";
    clear.disabled = true;
    if (notify) changed();
  }
  input.addEventListener("input", () => { query = input.value; changed(); });
  input.addEventListener("keydown", event => {
    if (event.isComposing) return;
    if (event.key === "Escape" && (query || kind !== "all")) { event.preventDefault(); reset(); }
    if (event.key === "Enter") { event.preventDefault(); onEnter?.(); }
  });
  clear.addEventListener("click", () => { reset(); input.focus?.(); });
  select.addEventListener("change", () => { kind = select.value; changed(); });
  function update({ language: nextLanguage, total, matches }) {
    language = nextLanguage || "en";
    const text = textFor(language);
    input.placeholder = text.placeholder;
    input.setAttribute("aria-label", text.search);
    input.title = text.keyboard;
    select.setAttribute("aria-label", text.type);
    options.forEach((option, index) => { option.textContent = [text.all, text.color, text.zone][index]; });
    select.value = kind;
    clear.textContent = text.clear;
    clear.disabled = !query && kind === "all";
    status.textContent = text.count.replace("{matches}", String(matches)).replace("{total}", String(total));
  }
  return { element, getFilters, reset, update, getEmptyText: () => textFor(language).none };
}
