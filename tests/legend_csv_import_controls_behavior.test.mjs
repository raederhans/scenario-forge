import test from "node:test";
import assert from "node:assert/strict";
import { buildLegendCsv, buildLegendExportEntries } from "../js/ui/sidebar/legend_export.js";
import { createLegendCsvImportControls } from "../js/ui/sidebar/legend_csv_import_controls.js";
import { LEGEND_CSV_MAX_BYTES } from "../js/core/legend_csv_import_preview.js";

function element(tagName) {
  return { tagName, children: [], listeners: {}, attributes: {}, textContent: "",
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(key, callback) { this.listeners[key] = callback; },
    set innerHTML(_value) { assert.fail("Imported values must never use HTML"); } };
}
const documentRef = { createElement: element };
const find = (node, predicate) => predicate(node) ? node : node.children.map(child => find(child, predicate)).find(Boolean);
const allText = node => [node.textContent, ...node.children.map(allText)].join(" ");
const byClass = (node, name) => find(node, child => child.className === name);
const inputOf = shell => find(shell, node => node.type === "file");
async function choose(shell, text, name = "legend.csv") {
  const input = inputOf(shell);
  input.files = [{ name, size: new TextEncoder().encode(text).length, text: async () => text }];
  await input.listeners.change();
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const byId = (node, id) => find(node, child => child.id === id);
const rowChoice = (shell, record) => find(shell, node => node.type === "checkbox" && node.attributes["data-record"] === String(record));
const allChoice = shell => find(byClass(shell, "legend-csv-import-select-all"), node => node.type === "checkbox");
function changeChoice(input, checked = true) {
  assert.ok(input, "Expected an available choice");
  assert.equal(input.disabled, false);
  input.checked = checked;
  input.listeners.change();
}
const v2Scope = { schemaVersion: 2, scenarioId: "scenario-a", scenarioBaselineHash: "baseline-a" };
function writableFixture(count = 1, language = "en") {
  const entries = buildLegendExportEntries({ specialZones: Array.from({ length: count }, (_value, index) => ({
    id: `zone-${index + 1}`, name: `Original ${index + 1}`, style: { fill: "#abc", pattern: "dots", strokeWidth: 2 },
  })) });
  const proposed = entries.map((entry, index) => ({ ...entry, label: `Imported ${index + 1}`, strokeWidth: 3 }));
  return { model: { entries, language, ...v2Scope, owners: Object.freeze({ A: "USA" }) }, proposed, csv: buildLegendCsv(proposed, v2Scope) };
}
function applyModelRecords(model, request) {
  const rows = request.preview.rows.filter(row => request.records.includes(row.record));
  const updates = new Map(rows.map(row => [row.entry.entryId, row.entry]));
  return { ...model, entries: model.entries.map(entry => updates.has(entry.entryId) ? { ...entry, ...updates.get(entry.entryId) } : entry) };
}

test("readonly controls show every exported field as plain text without changing labels, styles or ownership", async () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const model = Object.freeze({ colors: Object.freeze(["#abc"]), labels: Object.freeze({ "#aabbcc": hostile }),
    specialZones: Object.freeze([Object.freeze({ id: "zone-id", name: "Zone", style: Object.freeze({ fill: "#def", pattern: "dots" }) })]),
    language: "en", owners: Object.freeze({ A: "USA" }), dirty: false, history: Object.freeze([]) });
  const before = JSON.stringify(model);
  const shell = createLegendCsvImportControls({ documentRef, getModel: () => model });
  const status = shell.children[4];
  assert.equal(status.attributes.role, "status");
  assert.equal(status.attributes["aria-live"], "polite");
  assert.equal(inputOf(shell).attributes["aria-label"], "Choose legend CSV");
  assert.ok(allText(shell).includes("no stable entry IDs"));
  await choose(shell, buildLegendCsv(buildLegendExportEntries(model)), "<script>file</script>.csv");
  assert.ok(allText(shell).includes(hostile));
  assert.ok(allText(shell).includes("<script>file</script>.csv"));
  assert.ok(allText(shell).includes("dots"));
  assert.ok(allText(shell).includes("#ddeeff"));
  assert.ok(allText(shell).includes("0.32 / 0.92 / 0.42"));
  assert.ok(allText(shell).includes("2 matching colors"));
  assert.equal(byClass(shell, "legend-csv-import-rows").children.length, 2);
  assert.equal(inputOf(shell).value, "");
  assert.equal(JSON.stringify(model), before);
  assert.equal(find(shell, node => node.tagName === "button" && /apply|confirm|更新|确认/iu.test(node.textContent)), undefined);
});

test("paging shows all rows and refresh compares against the latest model", async () => {
  let model = { colors: [], labels: {}, language: "en" };
  const colors = Array.from({ length: 21 }, (_value, index) => `#${(index + 1).toString(16).padStart(6, "0")}`);
  const csv = buildLegendCsv(buildLegendExportEntries({ colors }));
  const shell = createLegendCsvImportControls({ documentRef, getModel: () => model });
  await choose(shell, csv);
  const rows = byClass(shell, "legend-csv-import-rows");
  const pager = byClass(shell, "legend-csv-import-pager");
  assert.equal(rows.children.length, 20);
  assert.equal(pager.hidden, false);
  assert.equal(pager.children[0].disabled, true);
  pager.children[2].listeners.click();
  assert.equal(rows.children.length, 1);
  assert.ok(allText(rows).includes("Category 21"));
  assert.equal(pager.children[2].disabled, true);
  pager.children[0].listeners.click();
  assert.equal(rows.children.length, 20);
  model = { ...model, colors, labels: { [colors[0]]: "Changed in the current legend" } };
  shell.children[5].listeners.click();
  assert.ok(shell.children[4].textContent.includes("21 matching colors"));
  assert.ok(allText(rows).includes("Changed in the current legend"));
});

test("file limit is enforced before read and a failed selection clears a previous preview", async () => {
  const shell = createLegendCsvImportControls({ documentRef, getModel: () => ({ language: "en" }) });
  await choose(shell, buildLegendCsv(buildLegendExportEntries({ colors: ["#abc"] })));
  const input = inputOf(shell);
  input.files = [{ name: "large.csv", size: LEGEND_CSV_MAX_BYTES + 1, text: () => assert.fail("oversized file read") }];
  await input.listeners.change();
  assert.match(shell.children[4].textContent, /1 MiB/u);
  assert.equal(byClass(shell, "legend-csv-import-rows").children.length, 0);
  assert.equal(shell.children[5].hidden, true);
  assert.equal(byClass(shell, "legend-csv-import-pager").hidden, true);
  await choose(shell, 'kind,label\n"unterminated');
  assert.match(shell.children[4].textContent, /invalid quoting.*Record 2/u);
  input.files = [{ name: "failed.csv", size: 1, text: async () => { throw new Error("local read failed"); } }];
  await input.listeners.change();
  assert.match(shell.children[4].textContent, /Cannot read/u);
});

test("a late file read or failure cannot overwrite a newer selection", async () => {
  for (const lateFailure of [false, true]) {
    const shell = createLegendCsvImportControls({ documentRef, getModel: () => ({ language: "en" }) });
    const first = deferred();
    const input = inputOf(shell);
    input.files = [{ name: "old.csv", size: 10, text: () => first.promise }];
    const oldRead = input.listeners.change();
    await choose(shell, buildLegendCsv(buildLegendExportEntries({ colors: ["#abc"], labels: { "#aabbcc": "Latest" } })), "new.csv");
    if (lateFailure) first.reject(new Error("old failure"));
    else first.resolve(buildLegendCsv(buildLegendExportEntries({ colors: ["#def"] })));
    await oldRead;
    assert.ok(allText(shell).includes("Latest"));
    assert.equal(shell.children[3].textContent, "new.csv");
    assert.equal(allText(shell).includes("#ddeeff"), false);
  }
});

test("Chinese controls explain readonly limits and empty files produce actionable feedback", async () => {
  const shell = createLegendCsvImportControls({ documentRef, getModel: () => ({ language: "zh" }) });
  assert.match(allText(shell), /没有稳定条目 ID/u);
  await choose(shell, buildLegendCsv([]));
  assert.equal(shell.children[4].textContent, "CSV 只有表头，没有图例条目。");
  assert.equal(byClass(shell, "legend-csv-import-rows").children.length, 0);
  await choose(shell, "unknown,header\n");
  assert.match(shell.children[4].textContent, /八列/u);
});

test("v2 defaults to no selection and only imports exact selected records after review and confirmation", async () => {
  const fixture = writableFixture(2);
  const literalLabel = '=HYPERLINK("https://example.invalid", "<img onerror=alert(1)>")';
  fixture.proposed[1].label = literalLabel;
  fixture.csv = buildLegendCsv(fixture.proposed, v2Scope);
  let model = fixture.model;
  const requests = [];
  const shell = createLegendCsvImportControls({ documentRef, getModel: () => model, onApply: request => {
    requests.push(request);
    model = applyModelRecords(model, request);
    return { appliedCount: request.records.length, skippedCount: 0 };
  } });
  await choose(shell, fixture.csv);
  assert.equal(requests.length, 0, "Choosing a file must never import or request confirmation");
  assert.equal(rowChoice(shell, 2).checked, false);
  assert.equal(rowChoice(shell, 3).checked, false);
  assert.equal(allChoice(shell).checked, false);
  assert.equal(byId(shell, "legendCsvImportReviewBtn").disabled, true);
  byId(shell, "legendCsvImportReviewBtn").listeners.click();
  assert.equal(byId(shell, "legendCsvImportConfirmBtn"), undefined);
  assert.ok(allText(shell).includes(literalLabel), "Decoded formula and HTML-looking cells stay literal text");
  assert.ok(allText(shell).includes("Current: Original 2"));
  assert.ok(allText(shell).includes("stroke width 2"));
  assert.ok(allText(shell).includes("stroke width 3"));

  changeChoice(rowChoice(shell, 3));
  assert.equal(allChoice(shell).indeterminate, true);
  byId(shell, "legendCsvImportReviewBtn").listeners.click();
  const confirmation = byClass(shell, "legend-csv-import-confirmation");
  assert.match(allText(confirmation), /1 selected legend entries/u);
  assert.ok(allText(confirmation).includes("special-zone:zone-2"));
  assert.ok(allText(confirmation).includes(literalLabel));
  assert.equal(requests.length, 0);
  await byId(shell, "legendCsvImportConfirmBtn").listeners.click();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].source, fixture.csv);
  assert.equal(requests[0].preview.sourceText, fixture.csv);
  assert.deepEqual(requests[0].preview.scope, { scenarioId: "scenario-a", scenarioBaselineHash: "baseline-a" });
  assert.deepEqual(requests[0].records, [3]);
  assert.equal(model.entries[0].label, "Original 1");
  assert.equal(model.entries[1].label, literalLabel);
  assert.deepEqual(model.owners, { A: "USA" });
  assert.equal(rowChoice(shell, 2).checked, false, "Success clears unconfirmed selection");
  assert.equal(rowChoice(shell, 3), undefined, "Fresh preview excludes an already applied change");
  assert.equal(byId(shell, "legendCsvImportConfirmBtn"), undefined);
  assert.match(shell.children[4].textContent, /Imported 1 changes\. Undo is available/u);
});

test("byte-backed File reads reject damaged UTF-8 and a second BOM without replacing names", async () => {
  const shell = createLegendCsvImportControls({ documentRef, getModel: () => ({ language: "en" }) });
  const input = inputOf(shell);
  const csv = buildLegendCsv(buildLegendExportEntries({ colors: ["#abc"], labels: { "#aabbcc": "Valid 中文" } }));
  for (const [bytes, expected] of [[new TextEncoder().encode(csv), "Valid 中文"],
    [Uint8Array.of(0xff), "valid UTF-8"], [new TextEncoder().encode(`\uFEFF${csv}`), "header"]]) {
    input.files = [{ name: "bytes.csv", size: bytes.length, arrayBuffer: async () => bytes.buffer,
      text: () => assert.fail("Real byte-backed Files must not use replacement decoding") }];
    await input.listeners.change();
    assert.ok(allText(shell).includes(expected));
    if (expected !== "Valid 中文") assert.equal(byClass(shell, "legend-csv-import-rows").children.length, 0);
  }
});

test("a committed import still reports success if the caller could not refresh its UI", async () => {
  const fixture = writableFixture(1);
  let model = fixture.model;
  const shell = createLegendCsvImportControls({ documentRef, getModel: () => model, onApply: request => {
    model = applyModelRecords(model, request);
    return { appliedCount: 1, refreshFailed: true };
  } });
  await choose(shell, fixture.csv);
  changeChoice(rowChoice(shell, 2));
  byId(shell, "legendCsvImportReviewBtn").listeners.click();
  await byId(shell, "legendCsvImportConfirmBtn").listeners.click();
  assert.match(shell.children[4].textContent, /Imported 1 changes.*Could not refresh/u);
  assert.equal(allText(shell).includes("Import did not complete"), false);
});

test("individual selections persist across pages and bulk selection confirms only all safe changes", async () => {
  const fixture = writableFixture(21);
  const requests = [];
  const shell = createLegendCsvImportControls({ documentRef, getModel: () => fixture.model, onApply: request => {
    requests.push(request); return { appliedCount: 21 };
  } });
  await choose(shell, fixture.csv);
  changeChoice(rowChoice(shell, 2));
  const pager = byClass(shell, "legend-csv-import-pager");
  pager.children[2].listeners.click();
  assert.equal(rowChoice(shell, 22).checked, false);
  changeChoice(rowChoice(shell, 22));
  pager.children[0].listeners.click();
  assert.equal(rowChoice(shell, 2).checked, true);
  assert.match(allText(byClass(shell, "legend-csv-import-actions")), /2 safe changes selected/u);
  byId(shell, "legendCsvImportReviewBtn").listeners.click();
  assert.equal(byClass(shell, "legend-csv-import-confirmed-rows").children.length, 2);
  changeChoice(rowChoice(shell, 2), false);
  assert.equal(byId(shell, "legendCsvImportConfirmBtn"), undefined, "Editing selection cancels an earlier confirmation");
  changeChoice(allChoice(shell));
  assert.equal(rowChoice(shell, 2).checked, true);
  pager.children[2].listeners.click();
  assert.equal(rowChoice(shell, 22).checked, true, "Bulk selection includes other pages");
  byId(shell, "legendCsvImportReviewBtn").listeners.click();
  assert.equal(byClass(shell, "legend-csv-import-confirmed-rows").children.length, 21);
  assert.match(allText(byClass(shell, "legend-csv-import-confirmation")), /21 selected legend entries/u);
  assert.equal(requests.length, 0);
  await byId(shell, "legendCsvImportConfirmBtn").listeners.click();
  assert.deepEqual(requests[0].records, Array.from({ length: 21 }, (_value, index) => index + 2));
  assert.equal(allChoice(shell).checked, false);
});

test("unchanged, unknown, invalid and duplicate v2 records cannot be selected or included by bulk selection", async () => {
  const fixture = writableFixture(4);
  const incoming = [fixture.proposed[0], fixture.model.entries[1], { ...fixture.proposed[2], stroke: "bad-color" },
    fixture.proposed[3], fixture.proposed[3], { ...fixture.proposed[0], entryId: "special-zone:unknown" }];
  let request;
  const shell = createLegendCsvImportControls({ documentRef, getModel: () => fixture.model, onApply: value => {
    request = value; return { appliedCount: 1 };
  } });
  await choose(shell, buildLegendCsv(incoming, v2Scope));
  assert.ok(rowChoice(shell, 2));
  for (const record of [3, 4, 5, 6, 7]) assert.equal(rowChoice(shell, record), undefined);
  assert.match(allText(shell), /no import needed/u);
  assert.match(allText(shell), /Invalid fields: stroke color/u);
  assert.match(allText(shell), /Duplicate records: 5, 6/u);
  changeChoice(allChoice(shell));
  byId(shell, "legendCsvImportReviewBtn").listeners.click();
  await byId(shell, "legendCsvImportConfirmBtn").listeners.click();
  assert.deepEqual(request.records, [2]);
});

test("legacy files and absent callbacks remain readonly even when v2 has safe changes", async () => {
  const fixture = writableFixture();
  let calls = 0;
  const legacy = createLegendCsvImportControls({ documentRef, getModel: () => fixture.model, onApply: () => { calls += 1; } });
  await choose(legacy, buildLegendCsv(fixture.proposed));
  assert.equal(find(legacy, node => node.type === "checkbox"), undefined);
  assert.equal(byId(legacy, "legendCsvImportReviewBtn"), undefined);
  assert.match(legacy.children[4].textContent, /Read-only comparison/u);
  const readonly = createLegendCsvImportControls({ documentRef, getModel: () => fixture.model });
  await choose(readonly, fixture.csv);
  assert.equal(find(readonly, node => node.type === "checkbox"), undefined);
  assert.equal(byId(readonly, "legendCsvImportConfirmBtn"), undefined);
  assert.match(readonly.children[4].textContent, /read-only comparison/u);
  assert.equal(calls, 0);

  const wrongScope = createLegendCsvImportControls({ documentRef, getModel: () => ({ ...fixture.model, scenarioId: "other-scenario" }), onApply: () => { calls += 1; } });
  await choose(wrongScope, fixture.csv);
  assert.equal(find(wrongScope, node => node.type === "checkbox"), undefined);
  assert.match(allText(wrongScope), /scenario mismatch/u);
  assert.equal(calls, 0);
});

test("stale apply failures clear confirmation and selection, preserve the source and require a fresh comparison", async () => {
  const fixture = writableFixture();
  let model = fixture.model;
  let reads = 0;
  let calls = 0;
  const pending = deferred();
  const shell = createLegendCsvImportControls({ documentRef, getModel: () => model, onApply: () => { calls += 1; return pending.promise; } });
  inputOf(shell).files = [{ name: "editable.csv", size: fixture.csv.length, text: async () => { reads += 1; return fixture.csv; } }];
  await inputOf(shell).listeners.change();
  changeChoice(rowChoice(shell, 2));
  byId(shell, "legendCsvImportReviewBtn").listeners.click();
  const confirm = byId(shell, "legendCsvImportConfirmBtn");
  const importing = confirm.listeners.click();
  await confirm.listeners.click();
  assert.equal(calls, 1, "Repeated confirmation is ignored while import is pending");
  assert.equal(inputOf(shell).disabled, true);
  assert.equal(shell.children[5].disabled, true);
  model = { ...model, entries: model.entries.map(entry => ({ ...entry, label: "Changed since preview" })) };
  pending.reject(Object.assign(new Error("Target changed"), { code: "stale-preview" }));
  await importing;
  assert.match(shell.children[4].textContent, /Nothing was imported; compare again/u);
  assert.equal(/Imported \d/u.test(shell.children[4].textContent), false);
  assert.equal(byId(shell, "legendCsvImportConfirmBtn"), undefined);
  assert.equal(byClass(shell, "legend-csv-import-rows").children.length, 0);
  assert.equal(shell.children[5].hidden, false);
  assert.equal(inputOf(shell).disabled, false);
  shell.children[5].listeners.click();
  assert.equal(reads, 1, "Fresh comparison uses the loaded source without rereading the file");
  assert.equal(rowChoice(shell, 2).checked, false);
  assert.ok(allText(shell).includes("Current: Changed since preview"));
  assert.equal(calls, 1);
});

test("refresh and new file selection clear confirmation and bilingual v2 controls show literal proposed values", async () => {
  const fixture = writableFixture(1, "zh");
  fixture.proposed[0].label = "'本地 <script>CSV</script>";
  fixture.csv = buildLegendCsv(fixture.proposed, v2Scope);
  const shell = createLegendCsvImportControls({ documentRef, getModel: () => fixture.model, onApply: () => assert.fail("Unconfirmed import") });
  await choose(shell, fixture.csv);
  assert.ok(allText(shell).includes("'本地 <script>CSV</script>"));
  changeChoice(rowChoice(shell, 2));
  byId(shell, "legendCsvImportReviewBtn").listeners.click();
  assert.match(allText(byClass(shell, "legend-csv-import-confirmation")), /所选 1 条图例/u);
  assert.equal(byId(shell, "legendCsvImportConfirmBtn").textContent, "确认导入");
  shell.children[5].listeners.click();
  assert.equal(rowChoice(shell, 2).checked, false);
  assert.equal(byId(shell, "legendCsvImportConfirmBtn"), undefined);
  changeChoice(rowChoice(shell, 2));
  byId(shell, "legendCsvImportReviewBtn").listeners.click();
  await choose(shell, buildLegendCsv(fixture.proposed), "legacy.csv");
  assert.equal(byId(shell, "legendCsvImportConfirmBtn"), undefined);
  assert.equal(find(shell, node => node.type === "checkbox"), undefined);
});

test("generic apply failures report failure without an applied message and allow comparison again", async () => {
  const fixture = writableFixture();
  const shell = createLegendCsvImportControls({ documentRef, getModel: () => fixture.model, onApply: () => {
    throw Object.assign(new Error("No trusted transaction"), { code: "confirmation-required" });
  } });
  await choose(shell, fixture.csv);
  changeChoice(rowChoice(shell, 2));
  byId(shell, "legendCsvImportReviewBtn").listeners.click();
  await byId(shell, "legendCsvImportConfirmBtn").listeners.click();
  assert.match(shell.children[4].textContent, /Import did not complete/u);
  assert.equal(/Imported \d/u.test(shell.children[4].textContent), false);
  assert.equal(byId(shell, "legendCsvImportConfirmBtn"), undefined);
  shell.children[5].listeners.click();
  assert.equal(rowChoice(shell, 2).checked, false);
});
