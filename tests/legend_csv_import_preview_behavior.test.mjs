import test from "node:test";
import assert from "node:assert/strict";
import { buildLegendCsv, buildLegendExportEntries } from "../js/ui/sidebar/legend_export.js";
import { LEGEND_CSV_FIELDS, LEGEND_CSV_MAX_BYTES, LEGEND_CSV_MAX_ROWS,
  parseLegendCsv, buildLegendCsvImportPreview } from "../js/core/legend_csv_import_preview.js";

const entry = (patch = {}) => ({ kind: "color", label: "A", color: "#abcdef", pattern: "solid",
  stroke: "#64748b", fillOpacity: 1, strokeOpacity: 1, patternOpacity: 1, strokeWidth: 1, ...patch });
const errorCode = code => error => error.code === code;

test("project CSV round-trips quoted Unicode, multiline labels and literal formula protection", () => {
  const entries = buildLegendExportEntries({ colors: ["#abc", "#def"],
    labels: { "#aabbcc": '中文, "Legend"\r\nSecond line', "#ddeeff": " =SUM(1,2)" } });
  const csv = buildLegendCsv(entries);
  const frozen = entries.map(value => Object.freeze({ ...value }));
  const preview = buildLegendCsvImportPreview(csv, Object.freeze(frozen));
  assert.equal(preview.rows[0].entry.label, entries[0].label);
  assert.equal(preview.rows[1].entry.label, "'=SUM(1,2)");
  assert.equal(preview.readOnly, true);
  assert.equal(preview.limitation, "missing-stable-id");
  assert.equal(preview.counts.matched, 2);
  assert.equal(preview.counts.invalid, 0);
  assert.deepEqual(frozen, entries);
  assert.deepEqual(parseLegendCsv(csv).records, parseLegendCsv(csv.slice(1).trimEnd()).records);
});

test("preview reports comparison candidates, unknowns, duplicates, ambiguous zones and invalid styles separately", () => {
  const rows = [entry({ label: "Renamed" }), entry({ color: "#ABCDEF", label: "Duplicate" }),
    entry({ color: "#010203", label: "Unknown" }), entry({ color: "red", stroke: "url(x)", pattern: "bogus", fillOpacity: 2 }),
    entry({ kind: "special-zone", color: "#123456", label: "Zone renamed" }),
    entry({ kind: "special-zone", color: "#123456", label: "Another zone" }),
    entry({ kind: "mystery", color: "#abc" })];
  const preview = buildLegendCsvImportPreview(buildLegendCsv(rows), [entry(),
    entry({ kind: "special-zone", color: "#123456", label: "Zone 1" }),
    entry({ kind: "special-zone", color: "#123456", label: "Zone 2" })]);
  assert.deepEqual(preview.counts, { total: 7, matched: 2, unmatched: 3, ambiguous: 2, duplicates: 2, invalid: 2, invalidColors: 1, applicable: 0, noChanges: 0 });
  assert.deepEqual(preview.rows[0].duplicateRecords, [2, 3]);
  assert.deepEqual(preview.rows[4].duplicateRecords, []);
  assert.deepEqual(preview.rows[4].candidates, ["Zone 1", "Zone 2"]);
  assert.deepEqual(preview.rows[3].issues, ["invalid-color", "invalid-stroke", "invalid-pattern", "invalid-fillOpacity"]);
  assert.ok(preview.rows[6].issues.includes("invalid-kind"));
});

const scope = { scenarioId: "scenario-a", scenarioBaselineHash: "baseline-a" };
const v2 = entries => buildLegendCsv(entries, { schemaVersion: 2, ...scope });

test("v2 export round-trips original apostrophes and formula-looking literals without collision", () => {
  for (const label of ["=SUM(1,2)", "'=SUM(1,2)", "'plain", "''plain", " @name", "-42", '<script>alert(1)</script>']) {
    const current = entry({ entryId: "category:#abcdef", label });
    const preview = buildLegendCsvImportPreview(v2([current]), [current], scope);
    assert.equal(preview.rows[0].entry.label, label);
    assert.equal(preview.rows[0].hasChanges, false);
    assert.equal(preview.rows[0].canApply, false);
  }
});

test("v2 permits only changed valid exact IDs in matching nonempty scenario and baseline scope", () => {
  const current = entry({ entryId: "category:#abcdef", label: "Original" });
  const proposed = { ...current, label: "Renamed" };
  const csv = v2([proposed]);
  const safe = buildLegendCsvImportPreview(csv, [current], scope);
  assert.equal(safe.rows[0].canApply, true);
  assert.equal(safe.counts.applicable, 1);
  for (const changedScope of [{}, { ...scope, scenarioId: "other" }, { ...scope, scenarioBaselineHash: "different" }]) {
    const preview = buildLegendCsvImportPreview(csv, [current], changedScope);
    assert.equal(preview.rows[0].canApply, false);
    assert.ok(preview.rows[0].issues.length);
  }
  const duplicateCsv = buildLegendCsvImportPreview(v2([proposed, proposed]), [current], scope);
  assert.equal(duplicateCsv.counts.applicable, 0);
  const duplicateCurrent = buildLegendCsvImportPreview(csv, [current, current], scope);
  assert.equal(duplicateCurrent.rows[0].comparison, "ambiguous");
  assert.equal(duplicateCurrent.rows[0].canApply, false);
  assert.equal(buildLegendCsvImportPreview(v2([{ ...proposed, entryId: "category:#123456" }]), [current], scope).rows[0].canApply, false);
});

test("v2 rejects category style changes but allows zone name/style edits without matching by name or color", () => {
  const category = entry({ entryId: "category:#abcdef" });
  const rejected = buildLegendCsvImportPreview(v2([{ ...category, color: "#123456", label: "Renamed" }]), [category], scope);
  assert.ok(rejected.rows[0].issues.includes("category-style-unsupported"));
  const zone = entry({ kind: "special-zone", entryId: "special-zone:zone-a" });
  const allowed = buildLegendCsvImportPreview(v2([{ ...zone, label: "New zone", color: "#123456", pattern: "dots", strokeWidth: 2 }]), [zone], scope);
  assert.equal(allowed.rows[0].canApply, true);
  const unknown = buildLegendCsvImportPreview(v2([{ ...zone, entryId: "special-zone:unknown" }]), [zone], scope);
  assert.equal(unknown.rows[0].comparison, "unmatched");
  assert.equal(unknown.rows[0].canApply, false);
  for (const patch of [{ strokeWidth: "" }, { strokeWidth: 9 }, { schemaVersion: 3 }]) {
    const csv = patch.schemaVersion ? v2([{ ...zone, label: "New" }]).replace('"2",', '"3",') : v2([{ ...zone, label: "New", ...patch }]);
    assert.equal(buildLegendCsvImportPreview(csv, [zone], scope).rows[0].canApply, false);
  }
});

test("identical exported special-zone rows are duplicates, never inferred safe targets", () => {
  const zone = entry({ kind: "special-zone" });
  const preview = buildLegendCsvImportPreview(buildLegendCsv([zone, zone]), [zone]);
  assert.equal(preview.counts.duplicates, 2);
  assert.equal(preview.counts.matched, 2);
  assert.equal(preview.readOnly, true);
});

test("strict parser accepts LF and reordered known headers but rejects damaged quoting and unsupported headers", () => {
  const csv = buildLegendCsv([entry()]);
  assert.equal(parseLegendCsv(csv.replaceAll("\r\n", "\n")).records.length, 1);
  const reversed = [...LEGEND_CSV_FIELDS].reverse();
  const reordered = `${reversed.join(",")}\n${reversed.map(field => entry()[field]).join(",")}`;
  assert.equal(buildLegendCsvImportPreview(reordered).rows[0].entry.label, "A");
  for (const body of ['"unterminated', 'un"quoted', '"closed"oops', "a\rb"]) {
    assert.throws(() => parseLegendCsv(`${LEGEND_CSV_FIELDS.join(",")}\n${body}`), errorCode(body.includes("\r") ? "invalid-line-ending" : "invalid-quotes"));
  }
  for (const header of ["kind,label,color", [...LEGEND_CSV_FIELDS.slice(0, -1), "id"].join(","),
    [...LEGEND_CSV_FIELDS.slice(0, -1), "color"].join(","), `\uFEFF${LEGEND_CSV_FIELDS.join(",")}`]) {
    assert.throws(() => parseLegendCsv(`\uFEFF${header}\n`), errorCode("invalid-header"));
  }
});

test("wrong field counts remain visible and numeric styles reject empty, nonfinite and out-of-range values", () => {
  const header = LEGEND_CSV_FIELDS.join(",");
  const preview = buildLegendCsvImportPreview(`${header}\ncolor,short,#abc\ncolor,A,#abc,solid,#def,,NaN,1.1,extra`);
  assert.equal(preview.counts.invalid, 2);
  assert.ok(preview.rows.every(row => row.issues.includes("field-count")));
  assert.ok(preview.rows[1].issues.includes("invalid-fillOpacity"));
  assert.ok(preview.rows[1].issues.includes("invalid-strokeOpacity"));
  assert.ok(preview.rows[1].issues.includes("invalid-patternOpacity"));
});

test("bounded parser rejects oversized UTF-8 and too many records without returning a partial preview", () => {
  assert.throws(() => parseLegendCsv("a".repeat(LEGEND_CSV_MAX_BYTES + 1)), errorCode("file-too-large"));
  assert.throws(() => parseLegendCsv("中".repeat(Math.ceil(LEGEND_CSV_MAX_BYTES / 3))), errorCode("file-too-large"));
  const header = `${LEGEND_CSV_FIELDS.join(",")}\n`;
  const row = "color,A,#abc,solid,#def,1,1,1\n";
  assert.equal(parseLegendCsv(header + row.repeat(LEGEND_CSV_MAX_ROWS)).records.length, LEGEND_CSV_MAX_ROWS);
  assert.throws(() => parseLegendCsv(header + row.repeat(LEGEND_CSV_MAX_ROWS + 1)), errorCode("too-many-rows"));
});
