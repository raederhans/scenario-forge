import { buildLegendCsvImportPreview, LEGEND_CSV_MAX_BYTES } from "../../core/legend_csv_import_preview.js";
import { buildLegendExportEntries } from "./legend_export.js";

const PAGE_SIZE = 20;

function getText(language) {
  return String(language || "en").startsWith("zh") ? {
    title: "CSV 导入预览（只读）", choose: "选择图例 CSV", refresh: "重新比较当前图例", previous: "上一页", next: "下一页",
    editableTitle: "CSV 导入预览与确认",
    hint: "当前 CSV 没有稳定条目 ID，且未保存描边宽度。本预览不写入名称或样式。同类型同颜色仅作比较，不能确认条目身份。支持 UTF-8 CSV，最多 1 MiB、2,000 条。",
    editableHint: "新版 CSV 仅允许更新同一剧本和版本中唯一匹配的 ID。颜色类别只改名称，特殊区域可改名称与样式。先选择变更，再查看并确认。旧版仅供只读比较。支持 UTF-8 CSV，最多 1 MiB、2,000 条。",
    idle: "选择本项目导出的 CSV，查看匹配、未匹配、重复和无效颜色。", loading: "正在读取 CSV…", empty: "CSV 只有表头，没有图例条目。",
    summary: "{total} 条：同色匹配 {matched}，未匹配 {unmatched}，多候选 {ambiguous}，重复 {duplicates}，无效 {invalid}（含无效颜色 {invalidColors}）。只读比较。",
    scopedSummary: "{total} 条：ID 匹配 {matched}，未匹配 {unmatched}，多候选 {ambiguous}，重复 {duplicates}，无效 {invalid}（含无效颜色 {invalidColors}）；安全变更 {applicable}，无变更 {noChanges}。",
    page: "第 {page}/{pages} 页", row: "记录", color: "颜色类别", "special-zone": "特殊区域",
    matched: "同类型同颜色匹配（仅比较）", unmatched: "当前无同类型同颜色条目", ambiguous: "多个同类型同颜色候选，身份不确定",
    current: "当前候选名称", duplicates: "重复记录", issues: "无效字段", style: "样式", pattern: "图案", stroke: "描边",
    opacity: "填充 / 描边 / 图案透明度", failed: "无法读取 CSV，请重新选择文件。",
    width: "描边宽度", proposed: "拟导入", existing: "当前", entryId: "条目 ID",
    idMatched: "稳定 ID 唯一匹配", idUnmatched: "当前无此稳定 ID", idAmbiguous: "稳定 ID 有多个候选，无法导入",
    select: "选择此安全变更", selectAll: "选择全部安全变更（包括其他页）", selected: "已选择 {count} 条安全变更。",
    review: "查看所选变更", confirm: "确认导入", cancel: "返回选择", confirmation: "确认更新所选 {count} 条图例的名称与样式。此操作不更改领土或所有权，完成后可撤销。",
    applying: "正在导入所选变更…", applied: "已导入 {count} 条变更。可使用撤销恢复。", applyFailed: "导入未完成，请重新比较当前图例后重试。", refreshFailed: "无法刷新预览，请重新比较当前图例。",
    stale: "预览后当前图例已变更。未导入；请重新比较并选择变更。", readonly: "当前文件或剧本无法安全写回，仅供只读比较。",
    callbackAbsent: "当前界面仅提供只读比较。", noChanges: "当前名称与样式已相同，无需导入。", notApplicable: "此记录无法安全导入。",
    errors: { "file-too-large": "CSV 超过 1 MiB 上限。", "too-many-rows": "CSV 超过 2,000 条上限。",
      "invalid-header": "表头必须包含本项目导出的旧版八列或新版十三列，不能缺列、重复或加入未知列。", "invalid-quotes": "CSV 引号结构无效。",
      "invalid-line-ending": "CSV 行分隔须为 CRLF 或 LF。", "invalid-input": "CSV 内容无效。", "invalid-encoding": "CSV 必须使用有效的 UTF-8 编码。" },
    issueNames: { "field-count": "列数", "invalid-kind": "类型", "invalid-color": "填充颜色", "invalid-stroke": "描边颜色",
      "invalid-pattern": "图案", "invalid-fillOpacity": "填充透明度", "invalid-strokeOpacity": "描边透明度", "invalid-patternOpacity": "图案透明度",
      "invalid-strokeWidth": "描边宽度", "invalid-schemaVersion": "格式版本", "invalid-entryId": "条目 ID", "scope-mismatch": "剧本范围不匹配",
      "unsupported-version": "不支持的格式版本", "missing-scenario-scope": "缺少剧本范围", "scenario-mismatch": "剧本不匹配",
      "missing-baseline-hash": "缺少剧本版本", "baseline-mismatch": "剧本版本不匹配", "invalid-entry-id": "条目 ID",
      "category-style-unsupported": "颜色类别仅支持名称变更", "empty-zone-name": "特殊区域名称为空" },
  } : {
    title: "CSV import preview (read-only)", choose: "Choose legend CSV", refresh: "Compare with current legend", previous: "Previous", next: "Next",
    editableTitle: "CSV import preview and confirmation",
    hint: "This CSV has no stable entry IDs and omits stroke width. This preview cannot update names or styles. Matching type and color is a comparison only, not proof of identity. UTF-8 CSV, up to 1 MiB and 2,000 entries.",
    editableHint: "New CSV files permit updates only to unique IDs in the same scenario and version. Color categories support names only; special zones support names and styles. Select changes, review, then confirm. Legacy CSV remains read-only. UTF-8 CSV, up to 1 MiB and 2,000 entries.",
    idle: "Choose a CSV exported by this project to review matches, unknowns, duplicates and invalid colors.", loading: "Reading CSV…", empty: "The CSV has a header but no legend entries.",
    summary: "{total} entries: {matched} matching colors, {unmatched} unmatched, {ambiguous} ambiguous, {duplicates} duplicate, {invalid} invalid ({invalidColors} with invalid colors). Read-only comparison.",
    scopedSummary: "{total} entries: {matched} matching IDs, {unmatched} unmatched, {ambiguous} ambiguous, {duplicates} duplicate, {invalid} invalid ({invalidColors} with invalid colors); {applicable} safe changes, {noChanges} unchanged.",
    page: "Page {page}/{pages}", row: "Record", color: "Color category", "special-zone": "Special zone",
    matched: "Matching type and color (comparison only)", unmatched: "No current entry with this type and color", ambiguous: "Multiple matching colors; identity is uncertain",
    current: "Current candidate labels", duplicates: "Duplicate records", issues: "Invalid fields", style: "Style", pattern: "pattern", stroke: "stroke",
    opacity: "fill / stroke / pattern opacity", failed: "Cannot read the CSV. Please choose the file again.",
    width: "stroke width", proposed: "Proposed", existing: "Current", entryId: "Entry ID",
    idMatched: "Unique stable ID match", idUnmatched: "No current entry with this stable ID", idAmbiguous: "Multiple stable ID candidates; cannot import",
    select: "Select this safe change", selectAll: "Select all safe changes (including other pages)", selected: "{count} safe changes selected.",
    review: "Review selected changes", confirm: "Confirm import", cancel: "Back to selection", confirmation: "Confirm updating the names and styles of {count} selected legend entries. This does not change territory or ownership. You can undo the import.",
    applying: "Importing selected changes…", applied: "Imported {count} changes. Undo is available.", applyFailed: "Import did not complete. Compare with the current legend again before retrying.", refreshFailed: "Could not refresh the preview. Compare with the current legend again.",
    stale: "The current legend changed after this preview. Nothing was imported; compare again and select changes.", readonly: "This file or scenario cannot be safely updated. Read-only comparison.",
    callbackAbsent: "This panel provides a read-only comparison.", noChanges: "The current name and style already match; no import needed.", notApplicable: "This record cannot be safely imported.",
    errors: { "file-too-large": "CSV exceeds the 1 MiB limit.", "too-many-rows": "CSV exceeds the 2,000-entry limit.",
      "invalid-header": "The header must contain the eight legacy or thirteen new exported columns, with no missing, duplicate or unknown columns.", "invalid-quotes": "The CSV has invalid quoting.",
      "invalid-line-ending": "CSV rows must use CRLF or LF line endings.", "invalid-input": "Invalid CSV content.", "invalid-encoding": "CSV must use valid UTF-8 encoding." },
    issueNames: { "field-count": "column count", "invalid-kind": "type", "invalid-color": "fill color", "invalid-stroke": "stroke color",
      "invalid-pattern": "pattern", "invalid-fillOpacity": "fill opacity", "invalid-strokeOpacity": "stroke opacity", "invalid-patternOpacity": "pattern opacity",
      "invalid-strokeWidth": "stroke width", "invalid-schemaVersion": "format version", "invalid-entryId": "entry ID", "scope-mismatch": "scenario mismatch",
      "unsupported-version": "unsupported format version", "missing-scenario-scope": "missing scenario scope", "scenario-mismatch": "scenario mismatch",
      "missing-baseline-hash": "missing scenario version", "baseline-mismatch": "scenario version mismatch", "invalid-entry-id": "entry ID",
      "category-style-unsupported": "color categories support name changes only", "empty-zone-name": "empty special zone name" },
  };
}

function format(template, values) {
  return template.replace(/\{(\w+)\}/gu, (_match, key) => String(values[key]));
}

async function readCsvFileText(file) {
  // Actual File objects provide bytes. Keep the BOM for the parser to strip
  // exactly once, and reject encoding damage before it can become a new name.
  if (typeof file.arrayBuffer !== "function") return file.text();
  const bytes = await file.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw Object.assign(new Error("invalid-encoding"), { code: "invalid-encoding" }); }
}

/**
 * Selection and confirmation belong to this panel; imported cells are plain text.
 * Optional onApply receives { source, records: number[], preview } after two
 * explicit clicks. The caller owns exact-ID revalidation and undoable writes,
 * and must throw an error with code "stale-preview" if the targets changed.
 * Without onApply the panel remains read-only, including new-format files.
 */
export function createLegendCsvImportControls({ documentRef, getModel, onApply }) {
  const text = getText(getModel().language);
  const hasApply = typeof onApply === "function";
  const create = (tag, className, content) => {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  };
  const shell = create("details", "legend-csv-import-controls");
  shell.id = "legendCsvImportPreview";
  const heading = create("summary", "legend-csv-import-heading", hasApply ? text.editableTitle : text.title);
  const hint = create("p", "legend-export-status", hasApply ? text.editableHint : text.hint);
  const label = create("label", "legend-csv-import-file", text.choose);
  const input = create("input");
  input.id = "legendCsvImportFile";
  input.type = "file";
  input.accept = ".csv,text/csv";
  input.setAttribute("aria-label", text.choose);
  label.appendChild(input);
  const status = create("p", "legend-export-status", text.idle);
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const filename = create("p", "legend-export-status");
  const refresh = create("button", "legend-export-btn", text.refresh);
  refresh.type = "button";
  refresh.hidden = true;
  const rows = create("ol", "legend-csv-import-rows");
  const pager = create("div", "legend-csv-import-pager");
  pager.hidden = true;
  const previous = create("button", "legend-export-btn", text.previous);
  const pageStatus = create("span", "legend-export-status");
  const next = create("button", "legend-export-btn", text.next);
  previous.type = next.type = "button";
  pager.append(previous, pageStatus, next);
  const actions = create("div", "legend-csv-import-actions");
  actions.hidden = true;
  shell.append(heading, hint, label, filename, status, refresh, rows, pager, actions);
  let source = null;
  let preview = null;
  let page = 0;
  let revision = 0;
  let applying = false;
  let confirmation = null;
  let selectionButton = null;
  let confirmationPanelRef = null;
  let selectAllRef = null;
  const selected = new Set();

  const isNewFormat = () => Number(preview?.formatVersion) === 2;
  const isWritable = () => hasApply && isNewFormat() && preview?.readOnly === false;
  const applicableRows = () => isWritable() ? preview.rows.filter(row => row.canApply === true) : [];
  const selectedRecords = () => applicableRows().filter(row => selected.has(row.record)).map(row => row.record).sort((a, b) => a - b);
  const resetSelection = () => { selected.clear(); confirmation = null; };
  const styleText = entry => `${text.style}: ${entry.color}; ${text.pattern} ${entry.pattern}; ${text.stroke} ${entry.stroke}; ${text.opacity} ${entry.fillOpacity} / ${entry.strokeOpacity} / ${entry.patternOpacity}${entry.strokeWidth === undefined ? "" : `; ${text.width} ${entry.strokeWidth}`}`;
  const appendValues = (node, row) => {
    node.appendChild(create("p", "", `${text.proposed}: ${row.entry.label}`));
    node.appendChild(create("p", "", styleText(row.entry)));
    if (row.currentEntry) {
      node.appendChild(create("p", "", `${text.existing}: ${row.currentEntry.label}`));
      node.appendChild(create("p", "", styleText(row.currentEntry)));
    }
  };

  const renderActions = () => {
    selectionButton = confirmationPanelRef = selectAllRef = null;
    actions.replaceChildren();
    actions.hidden = !isWritable();
    if (!isWritable()) return;
    const safeRows = applicableRows();
    const records = selectedRecords();
    const selectAllLabel = create("label", "legend-csv-import-select-all", text.selectAll);
    const selectAll = create("input");
    selectAllRef = selectAll;
    selectAll.type = "checkbox";
    selectAll.checked = safeRows.length > 0 && records.length === safeRows.length;
    selectAll.indeterminate = records.length > 0 && records.length < safeRows.length;
    selectAll.disabled = applying || safeRows.length === 0;
    selectAll.setAttribute("aria-label", text.selectAll);
    selectAll.addEventListener("change", () => {
      if (applying) return;
      resetSelection();
      if (selectAll.checked) safeRows.forEach(row => selected.add(row.record));
      renderPage();
      renderActions();
      selectAllRef?.focus?.();
    });
    selectAllLabel.appendChild(selectAll);
    const selectedStatus = create("p", "legend-export-status", format(text.selected, { count: records.length }));
    selectedStatus.setAttribute("role", "status");
    selectedStatus.setAttribute("aria-live", "polite");
    const review = create("button", "legend-export-btn", text.review);
    selectionButton = review;
    review.id = "legendCsvImportReviewBtn";
    review.type = "button";
    review.disabled = applying || records.length === 0;
    review.addEventListener("click", () => {
      if (applying || !isWritable() || !selectedRecords().length) return;
      confirmation = { source, preview, records: selectedRecords() };
      renderActions();
      confirmationPanelRef?.focus?.();
    });
    actions.append(selectAllLabel, selectedStatus, review);
    if (!confirmation) return;
    const confirmationPanel = create("div", "legend-csv-import-confirmation");
    confirmationPanelRef = confirmationPanel;
    confirmationPanel.tabIndex = -1;
    confirmationPanel.setAttribute("role", "group");
    confirmationPanel.setAttribute("aria-label", text.review);
    confirmationPanel.appendChild(create("p", "", format(text.confirmation, { count: confirmation.records.length })));
    const confirmedRows = create("ol", "legend-csv-import-confirmed-rows");
    for (const row of preview.rows.filter(row => confirmation.records.includes(row.record))) {
      const item = create("li");
      item.appendChild(create("strong", "", `${text.row} ${row.record} · ${text.entryId}: ${row.entry.entryId}`));
      appendValues(item, row);
      confirmedRows.appendChild(item);
    }
    const confirm = create("button", "legend-export-btn", text.confirm);
    confirm.id = "legendCsvImportConfirmBtn";
    confirm.type = "button";
    confirm.disabled = applying;
    confirm.addEventListener("click", applyConfirmed);
    const cancel = create("button", "legend-export-btn", text.cancel);
    cancel.type = "button";
    cancel.disabled = applying;
    cancel.addEventListener("click", () => { if (!applying) { confirmation = null; renderActions(); selectionButton?.focus?.(); } });
    confirmationPanel.append(confirmedRows, confirm, cancel);
    actions.appendChild(confirmationPanel);
  };

  const renderPage = () => {
    rows.replaceChildren();
    if (!preview) { pager.hidden = true; return; }
    const pages = Math.max(1, Math.ceil(preview.rows.length / PAGE_SIZE));
    page = Math.min(page, pages - 1);
    for (const row of preview.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const item = create("li", "legend-csv-import-row");
      const { entry } = row;
      item.appendChild(create("strong", "", `${text.row} ${row.record}: ${entry.label}`));
      const comparisonText = isNewFormat() ? text[{ matched: "idMatched", unmatched: "idUnmatched", ambiguous: "idAmbiguous" }[row.comparison]] : text[row.comparison];
      item.appendChild(create("p", "", `${text[entry.kind] || entry.kind} · ${entry.color} · ${comparisonText}`));
      if (isNewFormat()) item.appendChild(create("p", "", `${text.entryId}: ${entry.entryId}`));
      appendValues(item, row);
      if (row.candidates.length) item.appendChild(create("p", "", `${text.current}: ${row.candidates.join("; ")}`));
      if (row.duplicateRecords.length) item.appendChild(create("p", "", `${text.duplicates}: ${row.duplicateRecords.join(", ")}`));
      if (row.issues.length) item.appendChild(create("p", "legend-csv-import-invalid", `${text.issues}: ${row.issues.map(issue => text.issueNames[issue] || issue).join(", ")}`));
      if (isWritable() && row.canApply === true) {
        const choiceLabel = create("label", "legend-csv-import-select-row", text.select);
        const choice = create("input");
        choice.type = "checkbox";
        choice.checked = selected.has(row.record);
        choice.disabled = applying;
        choice.setAttribute("data-record", String(row.record));
        choice.setAttribute("aria-label", `${text.select}: ${text.row} ${row.record}, ${entry.label}`);
        choice.addEventListener("change", () => {
          if (applying || !isWritable()) return;
          if (choice.checked) selected.add(row.record);
          else selected.delete(row.record);
          confirmation = null;
          renderActions();
        });
        choiceLabel.appendChild(choice);
        item.appendChild(choiceLabel);
      } else if (isNewFormat()) {
        item.appendChild(create("p", "", row.comparison === "matched" && row.hasChanges === false && !row.issues.length && !row.duplicateRecords.length ? text.noChanges : text.notApplicable));
      }
      rows.appendChild(item);
    }
    pager.hidden = pages < 2;
    previous.disabled = applying || page === 0;
    next.disabled = applying || page === pages - 1;
    pageStatus.textContent = format(text.page, { page: page + 1, pages });
  };
  const compare = () => {
    const model = getModel();
    preview = buildLegendCsvImportPreview(source, model.entries || buildLegendExportEntries(model), {
      scenarioId: model.scenarioId, scenarioBaselineHash: model.scenarioBaselineHash,
    });
    resetSelection();
    hint.textContent = isNewFormat() ? (hasApply ? text.editableHint : text.callbackAbsent) : text.hint;
    status.textContent = preview.counts.total ? format(isNewFormat() ? text.scopedSummary : text.summary, preview.counts) : text.empty;
    if (isNewFormat() && !isWritable()) status.textContent += ` ${!hasApply ? text.callbackAbsent : preview.counts.noChanges === preview.counts.total && preview.counts.total ? text.noChanges : text.readonly}`;
    refresh.hidden = false;
    renderPage();
    renderActions();
  };
  const applyConfirmed = async () => {
    if (applying || !isWritable() || !confirmation || confirmation.preview !== preview || confirmation.source !== source) return;
    const request = confirmation;
    applying = true;
    input.disabled = refresh.disabled = true;
    status.textContent = text.applying;
    renderPage();
    renderActions();
    try {
      const result = await onApply({ source: request.source, records: [...request.records], preview: request.preview });
      applying = false;
      const count = Number.isInteger(result?.appliedCount) && result.appliedCount >= 0 ? result.appliedCount : request.records.length;
      try {
        compare();
        status.textContent = `${format(text.applied, { count })} ${status.textContent}`;
        if (result?.refreshFailed) status.textContent += ` ${text.refreshFailed}`;
      } catch (_error) {
        resetSelection();
        preview = null;
        status.textContent = `${format(text.applied, { count })} ${text.refreshFailed}`;
        renderPage();
        renderActions();
      }
    } catch (error) {
      applying = false;
      resetSelection();
      preview = null;
      refresh.hidden = false;
      status.textContent = error?.code === "stale-preview" ? text.stale : text.applyFailed;
      renderPage();
      renderActions();
    } finally {
      input.disabled = refresh.disabled = false;
    }
  };
  const fail = error => {
    source = null;
    preview = null;
    resetSelection();
    refresh.hidden = true;
    status.textContent = text.errors[error?.code] || text.failed;
    if (error?.record) status.textContent += ` (${text.row} ${error.record})`;
    renderPage();
    renderActions();
  };
  input.addEventListener("change", async () => {
    if (applying) return;
    const file = input.files?.[0];
    input.value = ""; // Allows choosing the same file after editing it externally.
    if (!file) return;
    const request = ++revision;
    source = preview = null;
    resetSelection();
    page = 0;
    refresh.hidden = true;
    filename.textContent = String(file.name || "");
    status.textContent = text.loading;
    renderPage();
    renderActions();
    try {
      if (file.size > LEGEND_CSV_MAX_BYTES) { fail({ code: "file-too-large" }); return; }
      const content = await readCsvFileText(file);
      if (request !== revision) return;
      source = content;
      compare();
    } catch (error) {
      if (request === revision) fail(error);
    }
  });
  refresh.addEventListener("click", () => { if (!applying && source !== null) { try { compare(); } catch (error) { fail(error); } } });
  previous.addEventListener("click", () => { if (!applying && page > 0) { page -= 1; renderPage(); } });
  next.addEventListener("click", () => {
    if (!applying && preview && (page + 1) * PAGE_SIZE < preview.rows.length) { page += 1; renderPage(); }
  });
  return shell;
}
