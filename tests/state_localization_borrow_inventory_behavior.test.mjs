import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { scanStateMutationInventory } from "../tools/state_writer_inventory.mjs";
import { inspectStateLocalizationBorrowSources, STATE_LOCALIZATION_BORROW_MODULE_PATH as filePath } from "../tools/state_localization_borrow_contract.mjs";

const source = readFileSync(new URL(`../${filePath}`, import.meta.url), "utf8").replace(/\r\n?/g, "\n");
const binding = { id: "module:runtimeState", kind: "module", name: "runtimeState", importSource: "./state.js", importedName: "state" };
const scan = text => scanStateMutationInventory(text, { filePath, bindings: [binding], derivedAliasTaintMode: "strict" });
const at = (finding, text, snippet) => text.slice(finding.start, finding.end) === snippet;

test("localization scanner discharges only private storage and follows the feature into existing downstream consumers", () => {
  const { receipt, violations } = inspectStateLocalizationBorrowSources();
  assert.deepEqual(violations, []);
  const inventory = scan(source);
  const mapSets = Object.values(receipt.operationsByKey).filter(operation => operation.kind === "private-map-set");
  for (const operation of mapSets) {
    assert.ok(!inventory.findings.some(finding => finding.start >= operation.expression.start && finding.end <= operation.expression.end), operation.expression.source);
  }
  // Successful String results are scalars; invoking coercion on a borrowed
  // input is still unproved. These actual arguments retain their diagnostics.
  for (const expression of [
    "props.__city_id || props.id || feature?.id",
    "props.__city_stable_key || props.stable_key",
    "sourceProps.__city_host_feature_id || sourceProps.host_feature_id",
  ]) {
    assert.ok(inventory.findings.some(finding => finding.reason === "state-alias-escape" && at(finding, source, expression)), expression);
  }
  // The coordinate return is accounted for by an exact receipt. The consumer
  // still receives a borrowed array, so the unknown D3 callback stays visible.
  for (const expression of ["geometry.coordinates", "geometry.coordinates[0]"]) {
    assert.ok(!inventory.findings.some(finding => finding.reason === "state-alias-escape" && at(finding, source, expression)), expression);
  }
  assert.ok(inventory.findings.some(finding => finding.reason === "state-alias-escape" && at(finding, source, "point") && finding.line === 107));
  assert.ok(inventory.findings.some(finding => finding.reason === "state-alias-escape" && at(finding, source, "feature") && finding.line === 103));
  assert.equal(inventory.findings.filter(finding => !finding.unsupported).length, 4);
  assert.ok(inventory.actionDelegations.some(edge => edge.actionExportName === "applyScenarioChunkCityExternalEffectState"));
});

test("localization receipt drift restores conservative escapes for Map, helper-return and callback mutations", () => {
  const variants = [
    ["const byAlias = sourceCityIndex.get", 'byId.feature.properties.changed = true; const byAlias = sourceCityIndex.get'],
    ["if (!sourceFeature) return;", 'if (!sourceFeature) return; sourceFeature.properties.changed = true;'],
    ["const props = feature?.properties || {};", '(() => { feature.properties.changed = true; })(); const props = feature?.properties || {};'],
    ["const matches = new Map();", 'const matches = runtimeState.landIndex;'],
    ["return matches;", 'publish(matches); return matches;'],
    ['normalizeCityText(props.__city_id || props.id || feature?.id)', 'replacementNormalizer(props.__city_id || props.id || feature?.id)'],
    ['const point = getFeaturePointCoordinates(cityFeature);', 'const point = getFeaturePointCoordinates(cityFeature); point[0] = 9;'],
    ['const point = getFeaturePointCoordinates(cityFeature);', 'const point = getFeaturePointCoordinates(cityFeature); [point].forEach((item) => { item[0] = 9; });'],
  ];
  for (const [before, after] of variants) {
    assert.ok(source.includes(before), before);
    const changed = source.replace(before, after);
    assert.equal(inspectStateLocalizationBorrowSources({ source: changed }).receipt, null);
    const findings = scan(changed).findings;
    assert.ok(findings.some(finding => finding.unsupported && finding.reason === "state-alias-escape"), after);
    if (!after.includes("const matches = runtimeState")) {
      assert.ok(findings.some(finding => finding.reason === "state-alias-escape" && at(finding, changed, "feature")), after);
    }
  }
});

test("a canonical state write stays visible when the localization receipt no longer applies", () => {
  const changed = source.replace("const matches = new Map();", "runtimeState.width = 3; const matches = new Map();");
  const findings = scan(changed).findings;
  assert.ok(findings.some(finding => finding.key === "width" && !finding.unsupported));
  assert.ok(findings.some(finding => finding.reason === "state-alias-escape" && at(finding, changed, "feature")));
});
