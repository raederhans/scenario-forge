import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "acorn";
import { normalizeCityText } from "../js/core/data_loader.js";
import {
  STATE_LOCALIZATION_BORROW_MODULE_PATH as modulePath,
  inspectStateLocalizationBorrowSources,
} from "../tools/state_localization_borrow_contract.mjs";

const providerPath = "js/core/data_loader.js";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n?/g, "\n");
const source = read(modulePath);
const providerSource = read(providerPath);
const fingerprint = text => createHash("sha256").update(text).digest("hex");
const indexName = "buildScenarioOverrideSourceCityIndex";
const lookupName = "getScenarioOverrideSourceCityFeature";
const inspect = options => inspectStateLocalizationBorrowSources({ readSource: read, ...options });
const deepFreeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};
const replaceOnce = (input, before, after) => {
  assert.equal(input.split(before).length, 2, `Fixture target must occur exactly once: ${before}`);
  return input.replace(before, after);
};

function fixture(runtimeState, selectedSource = source) {
  // Execute the inspected production module, with its actual imported normalizer.
  // Other imports are unused by these two private functions. Nothing is exported
  // or changed in production merely to make the proof testable.
  const executable = selectedSource.replace(/^import[\s\S]*?;\n/gm, "").replace(/^export /gm, "");
  return vm.runInNewContext(`"use strict";\n${executable}\n({ build: ${indexName}, lookup: ${lookupName} })`, {
    runtimeState, normalizeCityText,
  });
}

test("current sources yield exact allocation, entry, helper and provider receipts", () => {
  const { violations, receipt } = inspectStateLocalizationBorrowSources();
  assert.deepEqual(violations, []);
  assert.equal(receipt.modulePath, modulePath);
  assert.equal(receipt.sourceFingerprint, fingerprint(source));
  assert.equal(receipt.coordinateSystem, "LF-normalized-UTF16");
  assert.deepEqual(Object.keys(receipt.functions), [indexName, lookupName]);
  assert.equal(receipt.functions[indexName].declaration.functionName, indexName);
  assert.equal(receipt.functions[indexName].returnProvenance.kind, "private-map-capability");
  assert.equal("borrowedResultPaths" in receipt.functions[indexName].returnProvenance, false,
    "A Map capability is neither a detached result nor a generic root-state alias");
  assert.equal(receipt.functions[indexName].returns[0].expression.source, "matches");
  assert.deepEqual(receipt.functions[lookupName].returnProvenance.borrowedResultPaths, [[]]);
  assert.equal(receipt.functions[lookupName].returns.length, 2);
  assert.equal(receipt.storage.origin.source, "new Map()");
  assert.equal(receipt.storage.allocation, "per-index-invocation");
  assert.equal(receipt.storage.lookupParameter.argumentIndex, 1);
  assert.deepEqual(receipt.storage.entry.borrowedResultPaths, [["feature"]]);
  assert.deepEqual(receipt.storage.entry.scalarResultPaths, [{ path: ["index"], type: "number" }]);
  const feature = receipt.localBindings.find(binding => binding.name === "feature");
  assert.equal(feature.initializer.source, "features[index]");
  assert.equal(feature.provenance.origin.retainsOriginalReference, true);
  assert.deepEqual(feature.provenance.origin.statePath, ["worldCitiesData", "features", "*"]);
  const loopIndex = receipt.localBindings.find(binding => binding.name === "index");
  assert.equal(loopIndex.provenance.type, "number");
  assert.equal(loopIndex.provenance.initialValue, 0);
  assert.equal(loopIndex.provenance.update.source, "index += 1");
  assert.equal(receipt.normalizer.importBinding.source, "normalizeCityText");
  assert.equal(receipt.normalizer.providerSourceFingerprint, fingerprint(providerSource));
  assert.equal(receipt.normalizer.exportBinding.source, "normalizeCityText");
  assert.match(receipt.normalizer.declaration.source, /String\(value \?\? ""\)\.trim\(\)/);
  assert.equal(receipt.normalizer.resultCondition, "returns-normally");
  assert.equal(receipt.normalizer.calls.length, 17);
  assert.equal(receipt.consumerGraph.indexCall.functionName, "buildScenarioCityNameSyncPatch");
  assert.equal(receipt.consumerGraph.indexCall.lexicalFunctionIdentities.length, 2, "The forEach callback has its own lexical identity");
  assert.equal(receipt.consumerGraph.lookupArgument.source, "sourceCityIndex");
  assert.equal(receipt.consumerGraph.lookupParameter.source, "sourceCityIndex");
  assert.match(receipt.consumerGraph.publication.source, /sourceCityIndex \|\|= /);
  const localIndex = receipt.localBindings.find(binding => binding.name === "sourceCityIndex");
  assert.equal(localIndex.initializer, null);
  assert.equal(localIndex.provenance.initialValue, "undefined");
  assert.equal(localIndex.provenance.establishedBy.key, receipt.consumerGraph.publication.key);
});

test("every operation is keyed by its exact AST range, lexical scope and fingerprint", () => {
  const { receipt } = inspect();
  const astNodes = new Map();
  function walk(node) {
    if (!node || typeof node !== "object" || !node.type) return;
    astNodes.set(`${node.type}@${node.start}:${node.end}`, node);
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(walk);
      else if (child?.type) walk(child);
    }
  }
  walk(parse(source, { ecmaVersion: "latest", sourceType: "module" }));
  const operations = Object.values(receipt.operationsByKey);
  assert.equal(operations.length, 36);
  for (const [key, { expression }] of Object.entries(receipt.operationsByKey)) {
    assert.equal(key, expression.key);
    assert.ok(astNodes.has(`${expression.nodeType}@${expression.start}:${expression.end}`));
    assert.equal(source.slice(expression.start, expression.end), expression.source);
    assert.equal(fingerprint(expression.source), expression.sourceFingerprint);
    assert.ok(expression.lexicalFunctionIdentities.length);
    for (const identity of expression.lexicalFunctionIdentities) assert.ok(key.includes(identity));
  }
  const gets = operations.filter(item => item.kind === "private-map-get");
  assert.equal(gets.length, 4);
  for (const get of gets) {
    assert.deepEqual(get.result.borrowedResultPaths, [["feature"]]);
    assert.deepEqual(get.result.scalarResultPaths, [{ path: ["index"], type: "number" }]);
    assert.equal(get.storageIdentity, receipt.storage.storageIdentity);
  }
  const sets = operations.filter(item => item.kind === "private-map-set");
  assert.equal(sets.filter(item => item.effects[0].valueKind === "null").length, 2);
  const borrowedSets = sets.filter(item => item.effects[0].valueKind === "borrowed-feature-record");
  assert.equal(borrowedSets.length, 2);
  for (const set of borrowedSets) {
    assert.deepEqual(set.effects[0].borrowedValuePaths, [["feature"]]);
    assert.equal(set.retainedFeature.source, "feature");
    assert.equal(set.numericIndex.source, "index");
    assert.equal(set.result.storageIdentity, receipt.storage.storageIdentity);
  }
  assert.equal(operations.filter(item => item.kind === "numeric-index-projection").length, 2);
  assert.equal(operations.filter(item => item.kind === "normalizer-string-result").every(item =>
    item.result.type === "string" && item.effects[0].mayInvokeUserCode), true);
  assert.throws(() => { receipt.storage.entry.borrowedResultPaths[0].push("properties"); }, TypeError);
  assert.throws(() => { receipt.operationsByKey[gets[0].expression.key].result.borrowedResultPaths = []; }, TypeError);
});

test("line-ending normalization preserves exact receipt coordinates", () => {
  const expected = inspect().receipt;
  const actual = inspect({ source: source.replaceAll("\n", "\r\n"), readSource: path => read(path).replaceAll("\n", "\r\n") });
  assert.deepEqual(actual.violations, []);
  assert.deepEqual(actual.receipt, expected);
});

test("frozen production inputs preserve first source match and original feature identity", () => {
  const features = deepFreeze([
    { properties: { __city_id: "early", __city_stable_key: " shared " } },
    { properties: { id: " late ", stable_key: "shared" } },
    { id: "shared", properties: {} },
    { id: "fallback", properties: {} },
    { properties: { __city_id: "early", __city_stable_key: "last" } },
  ]);
  const overrides = deepFreeze([
    { city_id: "late", stable_key: "shared" },
    { city_id: " shared " }, { city_id: "fallback" }, { city_id: "early", stable_key: "last" },
    { city_id: "missing" }, {},
  ]);
  const state = deepFreeze({ worldCitiesData: { features } });
  const before = JSON.stringify({ state, overrides });
  const { build, lookup } = fixture(state);
  const index = build(overrides);
  assert.equal(Object.prototype.toString.call(index), "[object Map]");
  assert.equal(index.get("missing"), null, "Unmatched requested keys retain their initial null entry");
  assert.equal(index.get("unrequested"), undefined);
  assert.equal(index.get("shared").feature, features[0], "The later duplicate never overwrites the first source match");
  assert.equal(index.get("shared").index, 0);
  assert.equal(index.get("late").feature, features[1]);
  assert.equal(index.get("late").index, 1);
  assert.equal(lookup(overrides[0], index), features[0], "An earlier alias wins over a later ID");
  assert.equal(lookup(overrides[1], index), features[0]);
  assert.equal(lookup(overrides[2], index), features[3], "Feature.id is the fallback identity");
  assert.equal(lookup(overrides[3], index), features[0], "An earlier ID wins over a later alias");
  assert.equal(lookup(overrides[4], index), null);
  assert.equal(lookup(overrides[5], index), null);
  assert.equal(JSON.stringify({ state, overrides }), before);
  const secondIndex = build(overrides);
  assert.notEqual(secondIndex, index, "Each invocation allocates a new private Map");
  assert.equal(secondIndex.get("shared").feature, index.get("shared").feature);
  assert.notEqual(secondIndex.get("shared"), index.get("shared"));
  assert.throws(() => { index.get("shared").feature.properties.bad = true; }, TypeError);
  assert.throws(() => { lookup(overrides[0], index).properties.bad = true; }, TypeError);
  assert.equal(fixture(deepFreeze({})).build(overrides).get("late"), null);
});

test("source feature mutations remain shared through Map entries and lookup returns", () => {
  const feature = { id: "city", properties: {} };
  const { build, lookup } = fixture({ worldCitiesData: { features: [feature] } });
  const override = { city_id: "city" };
  const index = build([override]);
  index.get("city").feature.properties.fromMap = true;
  assert.equal(feature.properties.fromMap, true);
  lookup(override, index).properties.fromLookup = true;
  assert.equal(feature.properties.fromLookup, true, "Result identity is borrowed, not detached");
  index.get("city").index = 9;
  assert.equal("index" in feature, false, "The numeric entry index is local metadata");
});

test("normalizer receipt retains coercion effects while describing string results", () => {
  for (const [input, expected] of [[undefined, ""], [null, ""], [0, "0"], [false, "false"], [" city ", "city"]]) {
    assert.equal(normalizeCityText(input), expected);
    assert.equal(typeof normalizeCityText(input), "string");
  }
  let coercions = 0;
  assert.equal(normalizeCityText({ toString() { coercions++; return " city "; } }), "city");
  assert.equal(coercions, 1);
  assert.throws(() => normalizeCityText({ toString() { throw new Error("coercion effect"); } }), /coercion effect/);
  assert.equal(inspect().receipt.normalizer.mayInvokeArgumentCoercion, true);
});

test("real localization writes and delegated actions remain outside the operation receipt", () => {
  const { receipt } = inspect();
  assert.deepEqual(receipt.unhandledStateEffects.filter(item => item.kind === "state-write").map(item => item.statePath), [
    ["locales"], ["locales", "geo"], ["geoAliasToStableKey"], ["scenarioGeoLocalePatchData"],
  ]);
  assert.equal(receipt.unhandledStateEffects.filter(item => item.kind === "delegated-state-action").length, 1);
  for (const effect of receipt.unhandledStateEffects) assert.equal(receipt.operationsByKey[effect.expression.key], undefined);
  assert.equal(receipt.requiredRemainingAnalysis.nestedCallbacks, true);
  assert.equal(receipt.requiredRemainingAnalysis.coercionHooks, true);
  assert.equal(receipt.requiredRemainingAnalysis.unlistedOperations, true);
  assert.equal("pure" in receipt, false);
});

// These are proof-rejection tests. They intentionally do not import the shared
// scanner or claim that rejecting a receipt establishes downstream detection.
const sourceMutations = [
  ["write through get(...).feature.properties", "const byId = sourceCityIndex.get(normalizeCityText(overrideEntry?.city_id));",
    "sourceCityIndex.get(normalizeCityText(overrideEntry?.city_id)).feature.properties.bad = true;\n  const byId = sourceCityIndex.get(normalizeCityText(overrideEntry?.city_id));"],
  ["write through lookup helper return", "const sourceFeature = getScenarioOverrideSourceCityFeature(overrideEntry, sourceCityIndex);",
    "getScenarioOverrideSourceCityFeature(overrideEntry, sourceCityIndex).properties.bad = true;\n    const sourceFeature = getScenarioOverrideSourceCityFeature(overrideEntry, sourceCityIndex);"],
  ["nested callback writes borrowed feature", "const feature = features[index];",
    "const feature = features[index];\n    [feature].forEach((item) => { item.properties.bad = true; });"],
  ["replace local Map with state container", "const matches = new Map();", "const matches = runtimeState.sharedCityIndex;"],
  ["publish the Map to unknown callback", "return matches;", "unknownConsumer(matches);\n  return matches;"],
  ["publish the Map into state", "return matches;", "runtimeState.sharedCityIndex = matches;\n  return matches;"],
  ["add a new helper consumer", "return matches;", "getScenarioOverrideSourceCityFeature(overrideEntries[0], matches);\n  return matches;"],
  ["substitute lookup capability", "const sourceFeature = getScenarioOverrideSourceCityFeature(overrideEntry, sourceCityIndex);",
    "const sourceFeature = getScenarioOverrideSourceCityFeature(overrideEntry, runtimeState.sharedCityIndex);"],
  ["replace Map constructor binding", "const matches = new Map();", "const Map = UnreviewedMap;\n  const matches = new Map();"],
  ["override Map get implementation", "return matches;", "matches.get = (key) => runtimeState;\n  return matches;"],
  ["copy rather than retain feature", "const feature = features[index];", "const feature = structuredClone(features[index]);"],
  ["replace numeric loop index", "let index = 0;", "let index = runtimeState.borrowedIndex;"],
  ["change first source ordering", "byId.index <= byAlias.index", "byId.index >= byAlias.index"],
  ["replace normalizer import provider", 'from "./data_loader.js";', 'from "./other_data_loader.js";'],
  ["replace imported normalizer binding", "  normalizeCityText,", "  substitutedNormalizer as normalizeCityText,"],
  ["shadow the normalizer in the helper", "const matches = new Map();",
    "const normalizeCityText = (value) => { runtimeState.normalizerEffect = value; return value; };\n  const matches = new Map();"],
  ["export the private index helper", `function ${indexName}(`, `export function ${indexName}(`],
];
for (const [name, before, after] of sourceMutations) {
  test(`receipt rejection: ${name}`, () => {
    const changed = replaceOnce(source, before, after);
    assert.doesNotThrow(() => parse(changed, { ecmaVersion: "latest", sourceType: "module" }), "A valid mutation fixture must exercise proof rejection");
    const result = inspect({ source: changed });
    assert.equal(result.receipt, null);
    assert.ok(result.violations.some(item => item.code === "localization-borrow-source-drift" && item.modulePath === modulePath));
  });
}

for (const [name, before, after] of [
  ["normalizer returns borrowed input", 'const text = String(value ?? "").trim();\n  return text || "";', "return value;"],
  ["normalizer writes its input", 'const text = String(value ?? "").trim();', 'if (value && typeof value === "object") value.bad = true;\n  const text = String(value ?? "").trim();'],
  ["provider export is substituted", "  normalizeCityText,", "  parseCityAliases as normalizeCityText,"],
  ["provider intrinsic is shadowed", "function normalizeCityText(value) {", "const String = (value) => value;\nfunction normalizeCityText(value) {"],
]) {
  test(`dependency rejection: ${name}`, () => {
    const changed = replaceOnce(providerSource, before, after);
    assert.doesNotThrow(() => parse(changed, { ecmaVersion: "latest", sourceType: "module" }));
    const result = inspect({ readSource: path => path === providerPath ? changed : read(path) });
    assert.equal(result.receipt, null);
    assert.ok(result.violations.some(item => item.code === "localization-borrow-source-drift" && item.modulePath === providerPath));
  });
}

test("missing dependencies, invalid source and extra consumers never yield partial receipts", () => {
  const missing = inspect({ readSource: path => { if (path === providerPath) throw new Error("provider missing"); return read(path); } });
  assert.equal(missing.receipt, null);
  assert.ok(missing.violations.some(item => item.code === "localization-borrow-source-unavailable" && item.modulePath === providerPath));
  for (const changed of [null, "broken syntax {", `${source}\nunknownConsumer(buildScenarioOverrideSourceCityIndex([]));\n`]) {
    const result = inspect({ source: changed });
    assert.equal(result.receipt, null);
    assert.ok(result.violations.length > 0);
  }
});
