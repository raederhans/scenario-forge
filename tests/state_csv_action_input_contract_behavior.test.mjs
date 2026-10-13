import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspectStateCsvActionInputSites, CSV_LEGEND_ACTION_PATH, CSV_ZONE_ACTION_PATH } from "../tools/state_csv_action_input_contract.mjs";
import { validateStateActionNonTargetParameterMutations } from "../tools/build_state_writer_policy.mjs";
import { restoreLegendLabelSnapshotState } from "../js/core/state/actions/legend_actions.js";
import { patchSpecialZoneLegendFieldsState, restoreSpecialZoneLegendSnapshotState } from "../js/core/state/actions/special_zone_actions.js";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n?/g, "\n");
for (const [path, expectedCount] of [[CSV_LEGEND_ACTION_PATH, 1], [CSV_ZONE_ACTION_PATH, 4]]) {
  test(`CSV input receipt admits only ${expectedCount} exact argument sites in ${path}`, async () => {
    const source = read(path);
    for (const value of [source, source.replaceAll("\n", "\r\n")]) {
      const proof = inspectStateCsvActionInputSites(path, value);
      assert.deepEqual(proof.violations, []);
      assert.equal(proof.sites.size, expectedCount);
      assert.equal(proof.receipt.operations.length, expectedCount);
      assert.equal(proof.receipt.decodedStorage, "invocation-local JSON data");
      assert.match(proof.receipt.producerEffects, /getter\/toJSON hooks/);
      assert.deepEqual(await validateStateActionNonTargetParameterMutations(path, value), []);
    }
  });
}

const sourceDrifts = [
  [CSV_LEGEND_ACTION_PATH, 'if (typeof presentKeys !== "string") return false;', 'if (false) return false;'],
  [CSV_LEGEND_ACTION_PATH, 'JSON.parse(presentKeys)', 'JSON.parse(String(presentKeys))'],
  [CSV_LEGEND_ACTION_PATH, 'JSON.parse(presentKeys)', 'JSON.parse(presentKeys, (key, value) => value)'],
  [CSV_LEGEND_ACTION_PATH, 'JSON.parse(presentKeys)', 'replacementProvider(presentKeys)'],
  [CSV_LEGEND_ACTION_PATH, 'keys = JSON.parse(presentKeys)', 'keys = sharedKeys'],
  [CSV_LEGEND_ACTION_PATH, 'if (!Array.isArray(keys) || keys.some(key => typeof key !== "string")) return false;', 'if (!Array.isArray(keys)) return false;'],
  [CSV_LEGEND_ACTION_PATH, 'keys.map(normalizeColor)', 'keys.map(replacementNormalizer)'],
  [CSV_LEGEND_ACTION_PATH, 'let present = null;', 'presentKeys.width = 0; let present = null;'],
  [CSV_ZONE_ACTION_PATH, 'applySpecialZoneLegendFieldsState(target, patchesById, false)', 'applySpecialZoneLegendFieldsState(target, patchesById, true)'],
  [CSV_ZONE_ACTION_PATH, 'restoreMissing && presence &&', 'presence &&'],
  [CSV_ZONE_ACTION_PATH, 'typeof value === "number" && Number.isFinite(value)', 'Number.isFinite(value)'],
  [CSV_ZONE_ACTION_PATH, 'Number.isFinite(value)', 'replacementFinite(value)'],
  [CSV_ZONE_ACTION_PATH, 'if (typeof snapshotJson !== "string") return [];', 'if (false) return [];'],
  [CSV_ZONE_ACTION_PATH, 'JSON.parse(snapshotJson)', 'JSON.parse(snapshotJson, replacementReviver)'],
  [CSV_ZONE_ACTION_PATH, 'snapshotById = JSON.parse(snapshotJson)', 'snapshotById = sharedSnapshot'],
  [CSV_ZONE_ACTION_PATH, 'new Set(presence.styleKeys)', 'new Set(replacementKeys(presence.styleKeys))'],
];
for (const [path, before, after] of sourceDrifts) {
  test(`CSV receipt rejects source drift: ${after}`, () => {
    const source = read(path);
    assert.ok(source.includes(before));
    const proof = inspectStateCsvActionInputSites(path, source.replace(before, after));
    assert.equal(proof.receipt, null);
    assert.equal(proof.sites.size, 0);
    assert.ok(proof.violations.length);
  });
}

test("source drift restores action diagnostics rather than retaining an old receipt", async () => {
  for (const [path, before, after] of [sourceDrifts[0], sourceDrifts[8], sourceDrifts[10], sourceDrifts[12]]) {
    const changed = read(path).replace(before, after);
    assert.ok((await validateStateActionNonTargetParameterMutations(path, changed)).length);
  }
});

test("CSV receipts reject producer, storage, normalizer and schema dependency drift", () => {
  const dependencies = ["js/core/history_manager.js", "js/core/legend_csv_import_transaction.js", "js/core/legend_state_normalizers.js", "js/core/color_hex_utils.js", "js/core/legend_csv_schema.js"];
  for (const dependency of dependencies) {
    for (const path of [CSV_LEGEND_ACTION_PATH, CSV_ZONE_ACTION_PATH]) {
      const proof = inspectStateCsvActionInputSites(path, read(path), {
        readSource: current => read(current) + (current === dependency ? "\n// dependency drift" : ""),
      });
      assert.equal(proof.receipt, null);
      assert.equal(proof.sites.size, 0);
    }
  }
});

test("legend decoder rejects nonprimitive and malformed presence inputs without invoking their hooks", () => {
  let hooks = 0;
  const hook = { toString() { hooks++; return '["#112233"]'; }, toJSON() { hooks++; return ["#112233"]; } };
  const array = [hook];
  Object.defineProperty(array, "map", { get() { hooks++; throw Error("map getter"); } });
  const target = { legendLabels: { "#112233": "Before" } };
  const original = target.legendLabels;
  for (const input of [array, hook, new String('["#112233"]'), null, 4, true, "bad", "null", '{}', '[{}]', '[null]']) {
    assert.equal(restoreLegendLabelSnapshotState(target, { "#112233": "After" }, input), false);
    assert.equal(target.legendLabels, original);
  }
  assert.equal(hooks, 0);
  assert.equal(restoreLegendLabelSnapshotState(target, { "#112233": null, "#445566": "Remove" }, '["#123", "#112233", "#112233"]'), true);
  assert.equal(Object.hasOwn(target.legendLabels, "#112233"), true);
  assert.equal(target.legendLabels["#112233"], null);
  assert.equal(Object.hasOwn(target.legendLabels, "#445566"), false);
});

test("special-zone decoder rejects object hooks and malformed text while retaining target validation", () => {
  let hooks = 0;
  const input = { toJSON() { hooks++; return {}; }, toString() { hooks++; return "{}"; } };
  const target = { specialZoneLayers: { layers: [{ id: "zone", name: "Before", style: {} }] } };
  const original = target.specialZoneLayers;
  for (const value of [input, new String("{}"), [], null, 7, "bad", "[]", "null"]) {
    assert.deepEqual(restoreSpecialZoneLegendSnapshotState(target, value), []);
    assert.equal(target.specialZoneLayers, original);
  }
  assert.equal(hooks, 0);
  assert.throws(() => restoreSpecialZoneLegendSnapshotState(null, "{}"), /target/);
});

test("patch action never traverses restore-only Set or clone hooks, and finite checks do not coerce", () => {
  let hooks = 0;
  const keys = { [Symbol.iterator]() { hooks++; throw Error("iterator"); } };
  const raw = { toJSON() { hooks++; throw Error("toJSON"); }, valueOf() { hooks++; throw Error("coercion"); } };
  const target = { specialZoneLayers: { layers: [{ id: "zone", name: "Before", style: {} }] } };
  const patch = { presence: { name: true, style: true, styleObject: true, styleKeys: keys }, style: { pattern: raw, fillOpacity: raw } };
  assert.deepEqual(patchSpecialZoneLegendFieldsState(target, { zone: patch }), []);
  assert.equal(hooks, 0);
  assert.deepEqual(patchSpecialZoneLegendFieldsState(target, { zone: { style: { fillOpacity: .5 } } }), ["zone"]);
  assert.equal(target.specialZoneLayers.layers[0].style.fillOpacity, .5);
});
