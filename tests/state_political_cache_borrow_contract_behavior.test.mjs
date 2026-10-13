import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspectStatePoliticalCacheBorrowSources as inspect, POLITICAL_CACHE_RENDERER_PATH as rendererPath,
  POLITICAL_DERIVED_CACHE_PATH as derivedPath, POLITICAL_RASTER_CACHE_PATH as rasterPath,
  resolvePoliticalCacheOperation } from "../tools/state_political_cache_borrow_contract.mjs";
import { createPoliticalDerivedStateCache } from "../js/core/renderer/political_derived_state_cache.js";
import { createPoliticalIdRasterCache } from "../js/core/renderer/political_id_raster_cache.js";
import { registerPoliticalGeometrySnapshot } from "../js/core/political_geometry_store.js";
import { scanStateMutations } from "../tools/state_writer_inventory.mjs";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\r\n?/g, "\n");

test("cache-like names and calls never grant an unproved source a scanner exemption", () => {
  for (const expression of [
    'const politicalDerivedStateCache = runtimeState; politicalDerivedStateCache.colors = {};',
    'const politicalDerivedStateCache = runtimeState.cache; politicalDerivedStateCache.refreshColors({ colors: runtimeState.colors });',
    'const cache = runtimeState.cache; cache.get("a").properties.bad = true;',
    'const index = runtimeState.index; index.get("a").properties.bad = true;',
    'runtimeState.features.map(feature => { feature.properties.bad = true; return feature; });',
  ]) {
    const source = 'import { state as runtimeState } from "./state.js";\n' + expression;
    const findings = scanStateMutations(source, { filePath: rendererPath, derivedAliasTaintMode: "strict",
      bindings: [{ id: "module:runtimeState", kind: "module", name: "runtimeState", importSource: "./state.js", importedName: "state" }] });
    assert.ok(findings.length, expression);
  }
});

test("political cache receipts distinguish private writes, shared diagnostics and returned borrows", () => {
  const { violations, receipt } = inspect();
  assert.deepEqual(violations, []);
  const operations = Object.values(receipt.operationsByKey);
  assert.equal(operations.length, 10);
  assert.deepEqual(operations.filter(operation => operation.admitCall).map(operation => operation.method).sort(),
    ["get", "refreshColors", "refreshColors", "reset"]);
  assert.equal(operations.find(operation => operation.method === "commit").admitCall, false);
  assert.equal(operations.find(operation => operation.method === "describe").admitCall, false);
  assert.deepEqual(receipt.methods.raster.get.borrowedResultPaths, [[]]);
  assert.deepEqual(receipt.methods.raster.entries.borrowedResultPaths, [["*", "1"]]);
  assert.deepEqual(receipt.methods.derived.describe.resultStorage.valueBorrowedPaths, [[]]);
  assert.ok(receipt.diagnosticEffect.actions.includes("commitRenderPerfMetricState"));
  assert.equal(receipt.featureLookup.admitCall, false);
  assert.equal(receipt.featureLookup.consumers.length, 4);
  assert.equal(receipt.featureLookup.storageUses.length, 4);
  assert.equal(read(rendererPath).slice(receipt.featureLookup.allocation.start, receipt.featureLookup.allocation.end), "new Map()");
  assert.deepEqual(receipt.featureLookup.localIndex.map(site => site.method).sort(), ["has", "set"]);
  assert.equal(receipt.geometrySnapshots.consumers.length, 4);
  assert.equal(receipt.geometrySnapshots.producers.length, 3);
  assert.equal(receipt.geometrySnapshots.revisionReadsInvokeGetter, false);
  assert.equal(receipt.geometrySnapshots.otherSnapshotFieldsMayBeBorrowed, true);
  assert.deepEqual(receipt.geometrySnapshots.producers.map(entry => entry.revisionKind).sort(),
    ["allocated-number", "forwarded-data-property", "forwarded-data-property"]);
  for (const operation of operations) {
    assert.ok(read(rendererPath).slice(operation.start, operation.end).includes(`${operation.method}(`));
    assert.ok(Object.isFrozen(operation));
  }
});

test("private feature lookup result receipts bind the canonical source and retain helper effects", () => {
  const { receipt } = inspect();
  const binding = { kind: "module", name: "runtimeState", importSource: "./state.js", importedName: "state" };
  const borrows = Object.values(receipt.operationsByKey).filter(operation =>
    ["feature-index-get", "feature-lookup-helper"].includes(operation.kind));
  assert.equal(borrows.length, 5);
  for (const operation of borrows) {
    const node = { type: "CallExpression", start: operation.start, end: operation.end };
    const options = { binding, filePath: rendererPath };
    assert.equal(resolvePoliticalCacheOperation(receipt, node, options), operation);
    assert.deepEqual(operation.borrowedResultPaths, [[]]);
    assert.equal(operation.admitCall, operation.kind === "feature-index-get");
    if (operation.kind === "feature-lookup-helper") assert.ok(operation.inputEffects.length && operation.nestedEffects.length);
    for (const replacement of [
      { ...binding, name: "state" }, { ...binding, importSource: "./other.js" },
      { ...binding, importedName: "default" }, { ...binding, kind: "function-parameter" },
    ]) assert.equal(resolvePoliticalCacheOperation(receipt, node, { ...options, binding: replacement }), null);
    assert.equal(resolvePoliticalCacheOperation(receipt, node, { ...options, filePath: "js/unproved.js" }), null);
    assert.equal(resolvePoliticalCacheOperation(null, node, options), null);
    assert.equal(resolvePoliticalCacheOperation(receipt, { ...node, start: node.start + 1 }, options), null);
  }
});

test("production lookup retains original feature identity, private first-match cache and input hooks", () => {
  const { receipt } = inspect();
  const source = read(rendererPath);
  const lookup = source.slice(receipt.featureLookup.start, receipt.featureLookup.end);
  const first = { id: "same", properties: { color: "old" } };
  const second = { id: "same", properties: {} };
  let features = [first, second], calls = 0;
  const state = { landIndex: new Map(), topologyRevision: 1 };
  const get = new Function("runtimeState", "getResolvedColorSourceFeatures", "getFeatureId", `
    let resolvedColorFeatureLookupCache = { features: null, revision: -1, index: null };
    ${lookup}
    return findResolvedColorFeatureById;
  `)(state, () => features, feature => { calls += 1; return feature.id; });
  assert.equal(get("same"), first);
  assert.equal(get("same"), first);
  assert.equal(calls, 2, "a stable geometry revision reuses the private Map");
  get("same").properties.color = "changed";
  assert.equal(first.properties.color, "changed", "returned values remain original shared features");
  const indexed = Object.freeze({ id: "same", properties: Object.freeze({ color: "indexed" }) });
  state.landIndex.set("same", indexed);
  assert.equal(get("same"), indexed);
  assert.throws(() => { get("same").properties.color = "mutation"; }, TypeError);
  state.landIndex.clear();
  let hooks = 0;
  features = [{ get id() { hooks += 1; state.hookWrites = hooks; return "new"; } }];
  state.topologyRevision += 1;
  assert.equal(get({ toString() { hooks += 1; return "new"; } }), features[0]);
  assert.equal(hooks, 2, "argument coercion and feature getters are real effects");
  assert.equal(state.hookWrites, 2);
});

test("feature lookup proof rejects cache replacement, helper publication and caller writes", () => {
  const source = read(rendererPath);
  for (const [before, after] of [
    ["const index = new Map();", "const index = runtimeState.landIndex;"],
    ["return indexedFeature;", "indexedFeature.properties.bad = true; return indexedFeature;"],
    ["return resolvedColorFeatureLookupCache.index.get(id) || null;", "return replacement(resolvedColorFeatureLookupCache.index.get(id));"],
    ["const feature = findResolvedColorFeatureById(id);", "const feature = findResolvedColorFeatureById(id); feature.properties.bad = true;"],
    ["let resolvedColorFeatureLookupCache =", "globalThis.publishedLookup = findResolvedColorFeatureById; let resolvedColorFeatureLookupCache ="],
    ["return indexedFeature;", "return runtimeState;"],
  ]) {
    assert.ok(source.includes(before));
    const result = inspect({ source: source.replace(before, after) });
    assert.equal(result.receipt, null, after);
    assert.ok(result.violations.length);
  }
});

test("cache receipt rejects input writes, provider substitution, publication and newly nested callback effects", () => {
  for (const [file, before, after] of [
    [derivedPath, "baseline.colors = colors;", 'colors.bad = true; baseline.colors = colors;'],
    [derivedPath, "baseline.colors = colors;", 'globalThis.publishedColors = colors; baseline.colors = colors;'],
    [rasterPath, "return entry.tile;", 'entry.tile.bad = true; return entry.tile;'],
    [rendererPath, "const politicalDerivedStateCache = createPoliticalDerivedStateCache({", "const politicalDerivedStateCache = replacementProvider({"],
    [rendererPath, "politicalDerivedStateCache.refreshColors({", 'publish(politicalDerivedStateCache); politicalDerivedStateCache.refreshColors({'],
    [rendererPath, "previousColors, previousColorRevision,", 'previousColors: (() => { runtimeState.colors.bad = true; return previousColors; })(), previousColorRevision,'],
    [rendererPath, "return resolvedColorFeatureLookupCache.index.get(id) || null;", 'resolvedColorFeatureLookupCache.index.get(id).bad = true; return resolvedColorFeatureLookupCache.index.get(id) || null;'],
  ]) {
    const source = read(file);
    assert.ok(source.includes(before), before);
    const result = inspect({ readSource: path => path === file ? source.replace(before, after) : read(path) });
    assert.equal(result.receipt, null, after);
    assert.ok(result.violations.length);
  }
});

test("cache source receipts bind geometry lookup, feature reader and the complete diagnostic effect chain", () => {
  for (const file of [
    "js/core/political_geometry_store.js", "js/core/feature_identity.js", "js/core/feature_identity_shared.js",
    "js/core/country_code_aliases.js", "js/core/renderer/render_perf_metrics_runtime_owner.js",
    "js/core/state/actions/renderer_diagnostics_actions.js",
    "js/core/renderer/political_collection_owner.js", "js/core/scenario/chunk_layer_payloads.js",
    "js/bootstrap/deferred_ui_bootstrap.js", "js/core/data_service.js",
  ]) {
    const result = inspect({ readSource: path => path === file ? `${read(path)}\n// dependency drift\n` : read(path) });
    assert.equal(result.receipt, null, file);
    assert.ok(result.violations.some(violation => violation.modulePath === file), file);
  }
});

test("cache proof rejects new static, escaped, re-exported and computed geometry consumers", () => {
  const { receipt } = inspect();
  assert.ok(receipt);
  const consumerPath = "js/core/unproved_geometry_consumer.js";
  const sourcePaths = [...Object.keys(receipt.dependencies), consumerPath];
  for (const source of [
    'import { registerPoliticalGeometrySnapshot } from "./political_geometry_store.js";',
    'import * as sidecar from "./political_geometry_store.js";',
    'import { getPoliticalGeometrySnapshot as readSnapshot } from "./political_geometry_store.js";',
    'export * from "./political_geometry_store.js";',
    'export { registerPoliticalGeometrySnapshot } from "./political_geometry_store.js";',
    'import { getPoliticalGeometrySnapshot } from "/js/core/political_geometry_store.js";',
    'import { getPoliticalGeometrySnapshot } from "./political_geometry_\\u0073tore.js";',
    'import { getPoliticalGeometrySnapshot } from "./political_geometry_%73tore.js";',
    'import { getPoliticalGeometrySnapshot } from "./POLITICAL_GEOMETRY_STORE.JS";',
    'import { getPoliticalGeometrySnapshot } from "./POLITICAL_GEOMETRY_STORE.js";',
    'export * from "./POLITICAL_GEOMETRY_%53TORE.JS";',
    'import("/JS/CORE/POLITICAL_GEOMETRY_STORE.JS");',
    'import("https://example.invalid/js/core/POLITICAL_GEOMETRY_STORE.JS");',
    'import("./political_geometry_store.js");',
    'import(`./political_geometry_store.js`);',
    'import(globalThis.unprovedModule);',
    'import { getPoliticalGeometrySnapshot } from "./political_geometry_store.js?unproved";',
    'import { getPoliticalGeometrySnapshot } from "./political_geometry_store.js#unproved";',
  ]) {
    const result = inspect({ sourcePaths, readSource: file => file === consumerPath ? source : read(file) });
    assert.equal(result.receipt, null, source);
    assert.ok(result.violations.some(item => item.modulePath === consumerPath), source);
  }
  const missing = inspect({ sourcePaths: sourcePaths.filter(file => !file.endsWith("political_collection_owner.js") && file !== consumerPath) });
  assert.equal(missing.receipt, null);
  assert.ok(missing.violations.some(item => item.code === "political-cache-geometry-consumer-set-drift"));
});

test("unproved snapshot revision getters can have effects during refreshColors", () => {
  // The general sidecar API accepts this shape. Only the closed production
  // producer/reader proof permits the scanner's refreshColors admission.
  const state = { revisionReads: 0 };
  const collection = { features: [] };
  const colors = {};
  const features = new Map();
  registerPoliticalGeometrySnapshot(collection, {
    get featuresById() { return features; },
    get revision() { state.revisionReads++; return 7; },
  });
  const cache = createPoliticalDerivedStateCache({ getFeatureId: feature => feature.id });
  cache.commit({ collection, colors, identity: ["scene"], colorRevision: 1 });
  const before = state.revisionReads;
  assert.equal(cache.refreshColors({ collection, identity: ["scene"], previousColors: colors,
    previousColorRevision: 1, colors: {}, colorRevision: 2 }), true);
  assert.equal(state.revisionReads, before + 1);
});

test("raster get updates LRU but peek and entries retain original tile aliases", () => {
  const cache = createPoliticalIdRasterCache({ maxBytes: 24 });
  const tile = () => ({ codes: new Uint32Array(1), edgeIds: new Uint32Array(1), edgeWeights: new Float32Array(1) });
  const a = tile(), b = tile(), c = tile();
  const descriptor = { originX: 0, originY: 0, width: 1, height: 1, density: 1 };
  assert.equal(cache.set("a", a, descriptor), true);
  assert.equal(cache.set("b", b, descriptor), true);
  assert.equal(cache.peek("a"), a);
  assert.deepEqual(cache.entries().map(([key]) => key), ["a", "b"]);
  assert.equal(cache.get("a"), a);
  assert.deepEqual(cache.entries().map(([key]) => key), ["b", "a"]);
  cache.entries()[1][1].codes[0] = 71;
  assert.equal(a.codes[0], 71);
  cache.set("c", c, descriptor);
  assert.equal(cache.peek("b"), undefined);
  assert.equal(cache.peek("a"), a);
});

test("derived baseline retains inputs and snapshot features while misses invoke the production-shaped effect", () => {
  const events = [];
  const cache = createPoliticalDerivedStateCache({ getFeatureId: feature => feature.id,
    onMiss: details => events.push({ name: "politicalDerivedStateCacheMiss", duration: 0, details }) });
  const feature = Object.freeze({ id: "a", properties: Object.freeze({ name: "a" }) });
  const collection = Object.freeze({ features: Object.freeze([feature]) });
  const colors = Object.freeze({ a: "red" });
  const nextColors = { a: "blue" };
  const identity = Object.freeze(["scene", new Map()]);
  cache.commit({ collection, colors, identity, colorRevision: 1 });
  assert.equal(cache.refreshColors({ collection, identity, previousColors: colors, previousColorRevision: 1,
    colors: nextColors, colorRevision: 2 }), true);
  const nextFeature = { id: "a", properties: {} };
  const nextCollection = { features: [nextFeature] };
  const featuresById = new Map([["a", nextFeature]]);
  registerPoliticalGeometrySnapshot(nextCollection, { featuresById, revision: 1 });
  const delta = cache.describe({ previousCollection: collection, collection: nextCollection, colors: nextColors, colorRevision: 2, identity });
  assert.equal(delta.features, featuresById);
  assert.equal(delta.features.get("a"), nextFeature);
  delta.features.get("a").properties.changed = true;
  assert.equal(nextFeature.properties.changed, true);
  assert.equal(cache.describe({ previousCollection: collection, collection: nextCollection, colors: { ...nextColors }, colorRevision: 2, identity }), null);
  assert.equal(events.at(-1).details.reason, "colors-reference");
  cache.reset();
  assert.equal(cache.describe({ identity }), null);
  assert.equal(events.at(-1).details.reason, "missing-baseline");
});
