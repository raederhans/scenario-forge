import test from "node:test";
import assert from "node:assert/strict";
import { buildPaletteColorCheckCsv } from "../js/ui/palette_color_check_export.js";
import { findSimilarPaletteColors } from "../js/ui/palette_color_check_model.js";

const country = (id, color, name = id, code = id) => ({ id, kind: "country", color, name, code });
const legend = (id, color, name = id) => ({ id, kind: "legend", color, name });

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// Parse quoted CSV independently of the exporter, preserving multiline fields.
function parseCsv(content) {
  assert.ok(content.startsWith("\uFEFF"), "spreadsheet-friendly UTF-8 BOM");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const csv = content.slice(1);
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (!quoted && character === ",") {
      row.push(cell); cell = "";
    } else if (!quoted && character === "\r" && csv[index + 1] === "\n") {
      row.push(cell); rows.push(row); row = []; cell = ""; index += 1;
    } else cell += character;
  }
  assert.equal(quoted, false, "all quoted cells close");
  assert.deepEqual(row, [], "all records end with CRLF");
  assert.equal(cell, "");
  const [fields, ...values] = rows;
  assert.ok(values.every((value) => value.length === fields.length), "consistent column counts");
  return values.map((value) => Object.fromEntries(fields.map((field, index) => [field, value[index]])));
}

test("CSV exports every pair beyond the UI page and leaves frozen source unchanged", () => {
  const entries = Array.from({ length: 6 }, (_, index) => country(`C${index}`, "#abc", `Country ${index}`));
  const report = deepFreeze(findSimilarPaletteColors(entries));
  const before = JSON.stringify(report);
  const csv = buildPaletteColorCheckCsv(report);
  const [summary, ...pairs] = parseCsv(csv);
  assert.equal(pairs.length, 15, "all 15 pairs, exceeding the eight-row page");
  assert.equal(summary.record_type, "summary");
  assert.match(summary.review_note, /Duplicate pairs: 15; similar pairs: 0/u);
  assert.ok(pairs.every((pair) => pair.record_type === "pair" && pair.first_hex === "#aabbcc"));
  assert.ok(pairs.some((pair) => pair.first_code === "C4" && pair.second_code === "C5"));
  assert.equal(JSON.stringify(report), before);
  assert.equal(buildPaletteColorCheckCsv(report), csv, "deterministic detached export");
});

test("pair records preserve duplicate and similar types, both identities, HEX and RGB distance", () => {
  const report = findSimilarPaletteColors([
    country("A", "#000", "Alpha", "AA"), country("B", "#000000", "Beta", "BB"),
    country("C", "#010101", "Gamma", "CC"),
    legend("LA", "#ff0000", "First legend"), legend("LB", "#ff0100", "Second legend"),
  ]);
  const [, ...pairs] = parseCsv(buildPaletteColorCheckCsv(report));
  const duplicate = pairs.find((pair) => pair.match_type === "Duplicate");
  assert.equal(duplicate.entry_kind, "Country");
  assert.deepEqual([duplicate.first_name, duplicate.first_code, duplicate.first_hex,
    duplicate.second_name, duplicate.second_code, duplicate.second_hex, duplicate.rgb_distance],
  ["Alpha", "AA", "#000000", "Beta", "BB", "#000000", "0.00"]);
  const similar = pairs.find((pair) => pair.first_code === "AA" && pair.second_code === "CC");
  assert.equal(similar.match_type, "Similar");
  assert.equal(similar.rgb_distance, "1.73");
  const legendPair = pairs.find((pair) => pair.entry_kind === "Legend");
  assert.deepEqual([legendPair.first_name, legendPair.second_name, legendPair.first_code,
    legendPair.second_code, legendPair.rgb_distance], ["First legend", "Second legend", "", "", "1.00"]);
  assert.ok(pairs.every((pair) => /Review manually/u.test(pair.review_note)
    && /not automatically changed/u.test(pair.review_note)
    && /not a professional color-vision diagnosis/u.test(pair.review_note)));
});

test("export reflects current scoped threshold, checked counts and skipped invalid colors", () => {
  const entries = [country("A", "#000000"), country("B", "#120000"),
    legend("LA", "#112233"), legend("LB", "#112233"), legend("INVALID", "invalid")];
  const report = findSimilarPaletteColors(entries, { scope: "legend", threshold: 30 });
  const rows = parseCsv(buildPaletteColorCheckCsv(report, { scope: "legend" }));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.scope, "Legend");
    assert.equal(row.rgb_threshold, "30");
    assert.equal(row.checked_countries, "0");
    assert.equal(row.checked_legend_entries, "2");
    assert.equal(row.skipped_invalid_colors, "1");
  }
  const countryReport = findSimilarPaletteColors(entries, { scope: "country", threshold: 0 });
  const [countrySummary] = parseCsv(buildPaletteColorCheckCsv(countryReport, { scope: "country" }));
  assert.equal(countrySummary.scope, "Countries");
  assert.equal(countrySummary.rgb_threshold, "0");
  assert.equal(countrySummary.checked_countries, "2");
  assert.equal(countrySummary.checked_legend_entries, "0");
  assert.equal(countrySummary.skipped_invalid_colors, "0");
});

test("no matches and an empty report still export useful summary records", () => {
  const report = findSimilarPaletteColors([country("A", "#000000"), country("B", "#ffffff")]);
  const rows = parseCsv(buildPaletteColorCheckCsv(report));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].scope, "Countries and legend");
  assert.equal(rows[0].rgb_threshold, "18");
  assert.equal(rows[0].checked_countries, "2");
  assert.equal(rows[0].entry_kind, "");
  assert.match(rows[0].review_note, /No duplicate or similar color pairs/u);
  assert.match(rows[0].review_note, /Review manually/u);
  const [empty] = parseCsv(buildPaletteColorCheckCsv(findSimilarPaletteColors([])));
  assert.equal(empty.checked_countries, "0");
  assert.equal(empty.checked_legend_entries, "0");
  assert.equal(empty.skipped_invalid_colors, "0");
});

test("Chinese human labels and notes keep stable column identifiers and original names", () => {
  const report = findSimilarPaletteColors([country("A", "#abc", "第一国"), country("B", "#abc", "第二国")]);
  const [summary, pair] = parseCsv(buildPaletteColorCheckCsv(report, { scope: "country", language: "zh-CN" }));
  assert.equal(summary.scope, "国家");
  assert.match(summary.review_note, /重复配对：1；相近配对：0/u);
  assert.equal(pair.entry_kind, "国家");
  assert.equal(pair.match_type, "重复");
  assert.equal(pair.first_name, "第一国");
  assert.match(pair.review_note, /建议人工检查；不会自动改色/u);
  assert.match(pair.review_note, /不是专业色觉诊断/u);
  const [, similar] = parseCsv(buildPaletteColorCheckCsv(findSimilarPaletteColors([
    legend("A", "#000000"), legend("B", "#000001"),
  ]), { scope: "legend", language: "zh" }));
  assert.equal(similar.entry_kind, "图例");
  assert.equal(similar.match_type, "相近");
});

test("CSV round-trips Unicode, commas, quotes, embedded newlines and formula-looking cells", () => {
  const report = findSimilarPaletteColors([
    country("A", "#112233", '中文, "国家"\nSecond line', "AA"),
    country("B", "#112233", "Safe label", "BB"),
  ]);
  const [, pair] = parseCsv(buildPaletteColorCheckCsv(report));
  assert.equal(pair.first_name, '中文, "国家"\nSecond line');
  for (const value of ["=SUM(1,2)", "+external", "@external", "-42", "\t=SUM(1,2)",
    "\r@external", " \t\r+external", "\u0000-external"]) {
    const guardedReport = deepFreeze({ ...report, pairs: [
      { ...report.pairs[0], left: { ...report.pairs[0].left, name: value, code: value },
        right: { ...report.pairs[0].right, name: value, code: value } },
    ] });
    const [, guarded] = parseCsv(buildPaletteColorCheckCsv(guardedReport));
    for (const field of ["first_name", "first_code", "second_name", "second_code"]) {
      assert.equal(guarded[field], `'${value}`, `${field} protects ${JSON.stringify(value)}`);
    }
  }
});
