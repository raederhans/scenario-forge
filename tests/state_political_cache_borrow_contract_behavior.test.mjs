import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspectStatePoliticalCacheBorrowSources as inspect, POLITICAL_CACHE_RENDERER_PATH as rendererPath,
  POLITICAL_DERIVED_CACHE_PATH as derivedPath, POLITICAL_RASTER_CACHE_PATH as rasterPath } from "../tools/state_political_cache_borrow_contract.mjs";
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
  assert.equal(operations.length, 5);
  assert.deepEqual(operations.filter(operation => operation.admitCall).map(operation => operation.method).sort(),
    ["refreshColors", "refreshColors", "reset"]);
  assert.equal(operations.find(operation => operation.method === "commit").admitCall, false);
  assert.equal(operations.find(operation => operation.method === "describe").admitCall, false);
  assert.deepEqual(receipt.methods.raster.get.borrowedResultPaths, [[]]);
  assert.deepEqual(receipt.methods.raster.entries.borrowedResultPaths, [["*", "1"]]);
  assert.deepEqual(receipt.methods.derived.describe.resultStorage.valueBorrowedPaths, [[]]);
  assert.ok(receipt.diagnosticEffect.actions.includes("commitRenderPerfMetricState"));
  assert.equal(receipt.featureLookup.admitCall, false);
  for (const operation of operations) {
    assert.ok(read(rendererPath).slice(operation.start, operation.end).startsWith(`politicalDerivedStateCache.${operation.method}(`));
    assert.ok(Object.isFrozen(operation));
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
  ]) {
    const result = inspect({ readSource: path => path === file ? `${read(path)}\n// dependency drift\n` : read(path) });
    assert.equal(result.receipt, null, file);
    assert.ok(result.violations.some(violation => violation.modulePath === file), file);
  }
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
