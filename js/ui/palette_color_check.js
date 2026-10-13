import { findSimilarPaletteColors, DEFAULT_COLOR_CHECK_THRESHOLD } from "./palette_color_check_model.js";

/** A read-only, on-demand review surface. Entry lookup and editor navigation stay with their owners. */
export function createPaletteColorCheck({ state, host, getEntries, locateEntry }) {
  if (!host) return { refresh() {}, refreshIfOpen() {} };
  const doc = host.ownerDocument;
  const make = (tag, className = "", id = "") => {
    const node = doc.createElement(tag);
    node.className = className;
    if (id) node.id = id;
    return node;
  };
  const panel = make("details", "palette-color-check", "paletteColorCheck");
  const toggle = make("summary", "", "paletteColorCheckToggle");
  const body = make("div", "palette-color-check-body");
  const hint = make("p", "palette-color-check-hint", "paletteColorCheckHint");
  const controls = make("div", "palette-color-check-controls");
  const scopeLabel = make("label");
  scopeLabel.htmlFor = "paletteColorCheckScope";
  const scope = make("select", "select-input", "paletteColorCheckScope");
  const thresholdLabel = make("label");
  thresholdLabel.htmlFor = "paletteColorCheckThreshold";
  const threshold = make("select", "select-input", "paletteColorCheckThreshold");
  const refreshButton = make("button", "btn-secondary", "paletteColorCheckRefresh");
  refreshButton.type = "button";
  for (const value of ["all", "country", "legend"]) {
    const option = make("option");
    option.value = value;
    scope.append(option);
  }
  for (const value of [0, 18, 30]) {
    const option = make("option");
    option.value = String(value);
    threshold.append(option);
  }
  threshold.value = String(DEFAULT_COLOR_CHECK_THRESHOLD);
  const status = make("p", "palette-color-check-status", "paletteColorCheckStatus");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const results = make("ol", "palette-color-check-results", "paletteColorCheckResults");
  const pager = make("div", "palette-color-check-pager");
  const previous = make("button", "btn-secondary", "paletteColorCheckPrevious");
  const next = make("button", "btn-secondary", "paletteColorCheckNext");
  previous.type = next.type = "button";
  previous.textContent = "‹";
  next.textContent = "›";
  const pageStatus = make("span", "", "paletteColorCheckPage");
  pager.append(previous, pageStatus, next);
  controls.append(scopeLabel, scope, thresholdLabel, threshold, refreshButton);
  body.append(hint, controls, status, results, pager);
  panel.append(toggle, body);
  host.prepend(panel);

  const pageSize = 8;
  let pageIndex = 0;
  let report = null;
  let fingerprint = "";
  let language = "";
  const zh = () => state.currentLanguage === "zh";
  const text = (chinese, english) => zh() ? chinese : english;

  function localize() {
    language = state.currentLanguage;
    toggle.textContent = text("颜色相似性检查", "Color similarity check");
    hint.textContent = text(
      "检查国家基础色和当前纯色图例。局部涂色、图案不在此范围。RGB 相近提示不是色觉诊断；不会自动改色。",
      "Reviews country base colors and the current solid-color legend. Local paint and patterns are outside this check. RGB similarity is a review hint, not a color-vision diagnosis. Colors stay unchanged."
    );
    scopeLabel.textContent = text("检查范围", "Scope");
    ["全部", "国家", "图例"].forEach((label, index) => {
      scope.options[index].textContent = zh() ? label : ["All", "Countries", "Legend"][index];
    });
    thresholdLabel.textContent = text("相近程度", "Similarity");
    ["仅重复", "非常相近 (RGB ≤ 18)", "相近 (RGB ≤ 30)"].forEach((label, index) => {
      threshold.options[index].textContent = zh() ? label : ["Exact duplicates", "Very close (RGB ≤ 18)", "Close (RGB ≤ 30)"][index];
    });
    refreshButton.textContent = text("重新检查", "Refresh check");
    previous.setAttribute("aria-label", text("上一页颜色检查结果", "Previous color-check results"));
    next.setAttribute("aria-label", text("下一页颜色检查结果", "Next color-check results"));
    results.setAttribute("aria-label", text("重复或相近的颜色对", "Duplicate or similar color pairs"));
  }

  function entryButton(entry) {
    const button = make("button", "palette-color-check-entry");
    button.type = "button";
    button.dataset.colorCheckKind = entry.kind;
    button.dataset.colorCheckId = entry.id;
    button.setAttribute("aria-label", `${text("定位", "Locate")} ${entry.name}${entry.code ? ` (${entry.code})` : ""}`);
    const swatch = make("span", "palette-color-check-swatch");
    swatch.style.backgroundColor = entry.color;
    swatch.setAttribute("aria-hidden", "true");
    const caption = make("span", "palette-color-check-caption");
    const name = make("span", "palette-color-check-name");
    name.textContent = entry.name;
    const detail = make("span", "palette-color-check-detail");
    detail.textContent = `${entry.code ? `${entry.code} · ` : ""}${entry.color.toUpperCase()}`;
    const action = make("span", "palette-color-check-locate");
    action.textContent = text("定位 →", "Locate →");
    caption.append(name, detail);
    button.append(swatch, caption, action);
    button.addEventListener("click", () => {
      // Resolve again in the owner: a scenario/color may have changed since this snapshot.
      if (locateEntry(entry) === false) {
        refresh();
        status.textContent = text("该项已变化，请查看最新检查结果。", "That item changed. Review the refreshed results.");
      }
    });
    return button;
  }

  function renderResults() {
    if (!report) return;
    const count = report.pairs.length;
    const pageCount = Math.max(1, Math.ceil(count / pageSize));
    pageIndex = Math.min(pageIndex, pageCount - 1);
    const start = pageIndex * pageSize;
    const checked = text(
      `已检查 ${report.countryCount} 个国家、${report.legendCount} 项图例`,
      `Checked ${report.countryCount} countries and ${report.legendCount} legend entries`
    );
    const skipped = report.skippedCount ? text(`；${report.skippedCount} 项颜色无效，已跳过`, `; skipped ${report.skippedCount} invalid colors`) : "";
    const outcome = count
      ? text(`：${report.duplicateCount} 对重复、${report.similarCount} 对相近`, `: ${report.duplicateCount} duplicate and ${report.similarCount} similar pairs`)
      : text("：当前范围和阈值下未发现重复或相近色", ": no duplicate or similar pairs at this scope and threshold");
    status.textContent = `${checked}${outcome}${skipped}。`.replace(/。$/, zh() ? "。" : ".");
    const rows = report.pairs.slice(start, start + pageSize).map((pair) => {
      const row = make("li", `palette-color-check-pair is-${pair.type}`);
      const label = make("p", "palette-color-check-pair-label");
      label.textContent = `${pair.left.kind === "country" ? text("国家", "Countries") : text("图例", "Legend")} · ${pair.type === "duplicate" ? text("重复", "Duplicate") : text("相近", "Similar")}`;
      row.append(label, entryButton(pair.left), entryButton(pair.right));
      return row;
    });
    results.replaceChildren(...rows);
    pager.hidden = count <= pageSize;
    previous.disabled = pageIndex === 0;
    next.disabled = pageIndex >= pageCount - 1;
    pageStatus.textContent = text(
      `${start + 1}–${Math.min(start + pageSize, count)} / ${count} 对`,
      `${start + 1}–${Math.min(start + pageSize, count)} / ${count} pairs`
    );
  }

  function refresh({ force = true } = {}) {
    const entries = getEntries();
    const nextFingerprint = JSON.stringify([state.currentLanguage, scope.value, threshold.value, entries]);
    if (!force && nextFingerprint === fingerprint) return;
    fingerprint = nextFingerprint;
    pageIndex = 0;
    localize();
    report = findSimilarPaletteColors(entries, { threshold: Number(threshold.value), scope: scope.value });
    renderResults();
  }
  function refreshIfOpen() {
    if (panel.open) refresh({ force: false });
    else if (language !== state.currentLanguage) localize();
  }
  panel.addEventListener("toggle", () => { if (panel.open) refresh(); });
  refreshButton.addEventListener("click", () => refresh());
  scope.addEventListener("change", () => refresh());
  threshold.addEventListener("change", () => refresh());
  previous.addEventListener("click", () => { pageIndex = Math.max(0, pageIndex - 1); renderResults(); });
  next.addEventListener("click", () => { pageIndex += 1; renderResults(); });
  localize();
  return { refresh, refreshIfOpen };
}
