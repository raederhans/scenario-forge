import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "acorn";
import { full } from "acorn-walk";
import {
  inspectStateWaterPathResourceSources as inspect,
  resolveStateWaterPathResourceHelper as resolve,
  WATER_PATH_RESOURCE_MODULE_PATH as modulePath,
  WATER_PATH_RESOURCE_FACTORY_NAME as factoryName,
} from "../tools/state_water_path_resource_contract.mjs";
import { GeometryBudgetMap, getGeometryRetentionWeights } from "../js/core/renderer/geometry_cache_budget.js";
import { scanStateMutations } from "../tools/state_writer_inventory.mjs";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\r\n?/g, "\n");
const source = read(modulePath);
const fingerprint = value => createHash("sha256").update(value).digest("hex");
const parseSource = value => parse(value, { ecmaVersion: "latest", sourceType: "module" });
const nodes = value => { const result = []; full(parseSource(value), node => result.push(node)); return result; };
const baseline = inspect({ source });
assert.deepEqual(baseline.violations, []);
const receipt = baseline.receipt;
const isolated = source.slice(receipt.factory.start, receipt.factory.end);
const reject = result => {
  assert.equal(result.receipt, null);
  assert.ok(result.violations.length);
};
const changed = (value, before, after) => {
  assert.ok(value.includes(before), before);
  const result = value.replace(before, after);
  assert.notEqual(result, value);
  return result;
};

test("water resource receipt proves only four exact local helper results", () => {
  assert.equal(receipt.sourceForm, "module");
  assert.equal(receipt.sourceFingerprint, fingerprint(source));
  assert.equal(receipt.offsetEncoding, "LF-normalized-UTF16");
  assert.equal(receipt.factory.functionName, factoryName);
  assert.equal(Object.keys(receipt.functions).length, 4);
  assert.equal(Object.values(receipt.functions).flatMap(helper => helper.returns).length, 11);
  assert.equal(receipt.constructions.length, 2);
  assert.equal(receipt.pathProjections.length, 4);
  assert.equal(receipt.helperCallSites.length, 9);
  assert.equal(receipt.consumerGraph.edges.length, 3);
  assert.equal(receipt.consumerGraph.additionalPathsAreAdditive, true);
  for (const helper of Object.values(receipt.functions)) {
    assert.equal(helper.resultKind, "private-path2d-or-null");
    assert.deepEqual(helper.borrowedResultPaths, []);
    assert.equal(helper.admitCall, false);
    assert.equal(helper.effectsPreserved, true);
    assert.equal(helper.mutableResource, true);
    assert.equal(helper.detachedData, false);
    assert.deepEqual(helper.declaration.lexicalFunctionIdentities, [receipt.factory.functionIdentity]);
    assert.equal(fingerprint(source.slice(helper.declaration.start, helper.declaration.end)), helper.declaration.sourceFingerprint);
    for (const returned of helper.returns) assert.equal(source.slice(returned.expression.start, returned.expression.end), returned.expressionSource);
  }
  const recursiveFrozen = value => {
    if (value && typeof value === "object") {
      assert.ok(Object.isFrozen(value));
      Object.values(value).forEach(recursiveFrozen);
    }
  };
  recursiveFrozen(receipt);
  assert.throws(() => { receipt.functions.getScenarioWaterFeaturePath.borrowedResultPaths.push(["feature"]); }, TypeError);
});

test("water receipt retains original cache entry geometry borrows and all effects", () => {
  assert.equal(receipt.cache.writes.length, 2);
  assert.equal(receipt.cache.reads.length, 3);
  assert.equal(receipt.cache.returnedMapIsDetached, false);
  assert.equal(receipt.cache.keyMayBorrowGeometry, true);
  assert.deepEqual(receipt.cache.entryBorrowedResultPaths, [["parts", "*"]]);
  for (const operation of [...receipt.cache.writes, ...receipt.cache.reads, ...receipt.cache.allOperations, ...receipt.helperCallSites]) {
    assert.equal(operation.admitCall, false);
  }
  for (const operation of receipt.cache.reads) {
    assert.equal(operation.resultIsOriginalEntry, true);
    assert.deepEqual(operation.borrowedResultPaths, [["parts", "*"]]);
    assert.deepEqual(operation.privateMutation, ["LRU.delete", "LRU.set"]);
  }
  assert.equal(receipt.composition.callbackEffectsProvedPure, false);
  assert.equal(receipt.composition.publicResourceConsumer.admitCall, false);
  assert.equal(receipt.caller.admitCall, false);
  assert.equal(source.slice(receipt.caller.argument.start, receipt.caller.argument.end), "waterPath");
  assert.ok(receipt.preservedEffects.some(effect => effect.includes("getters")));
  assert.ok(receipt.preservedEffects.some(effect => effect.includes("canvas fill/stroke")));
  assert.ok(receipt.preservedEffects.some(effect => effect.includes("nested callback")));
});

test("module and exact isolated factory inputs have their own verified offsets", () => {
  for (const value of [isolated, `\n${isolated}\n`, isolated.replaceAll("\n", "\r\n")]) {
    const result = inspect({ source: value });
    assert.deepEqual(result.violations, []);
    assert.equal(result.receipt.sourceForm, "isolated-factory");
    const normalized = value.replace(/\r\n?/g, "\n");
    assert.equal(result.receipt.sourceFingerprint, fingerprint(normalized));
    for (const node of nodes(normalized).filter(node => node.type === "FunctionDeclaration" && Object.hasOwn(receipt.functions, node.id.name))) {
      const entry = resolve(result.receipt, node, { source: value, filePath: modulePath });
      assert.ok(entry, node.id.name);
      assert.equal(entry.declaration.sourceFingerprint, receipt.functions[node.id.name].declaration.sourceFingerprint);
      assert.equal(entry.declaration.start, node.start);
      assert.equal(entry.declaration.end, node.end);
      assert.equal(resolve(receipt, node, { source: value, filePath: modulePath }), null);
    }
  }
  assert.deepEqual(inspect({ source: source.replaceAll("\n", "\r\n") }).violations, []);
});

test("supplied altered fragments never fall back to a clean disk factory", () => {
  for (const value of [
    changed(isolated, "if (borrowed) return borrowed;", "if (borrowed) return feature;"),
    `export ${isolated}`,
    `${isolated}\nfunction extraConsumer() { return runtimeState; }`,
    `function before() {}\n${isolated}`,
    "", null, {},
  ]) reject(inspect({ source: value, readSource: read }));
  reject(inspect({ source: isolated, readSource: file => file === modulePath ? `${source}\n// changed imports or module body\n` : read(file) }));
  reject(inspect({ source: `${source}\n// supplied drift\n`, readSource: read }));
});

test("helper resolver requires an issued receipt, actual source and exact lexical declaration", () => {
  const helper = receipt.functions.getScenarioWaterFeaturePath;
  const node = nodes(source).find(node => node.type === "FunctionDeclaration" && node.id?.name === helper.functionName);
  const options = { source, filePath: modulePath };
  assert.equal(resolve(receipt, node, options), helper);
  for (const replacement of [
    { ...node, start: node.start + 1 }, { ...node, end: node.end - 1 },
    { ...node, type: "FunctionExpression" }, { ...node, id: { name: "findCachedWaterFeaturePath" } },
    { ...node, async: true }, { ...node, generator: true },
    { ...node, params: [{ type: "Identifier", name: "state" }, node.params[1]] },
  ]) assert.equal(resolve(receipt, replacement, options), null);
  for (const replacement of [null, {}, { ...receipt }, structuredClone(receipt)]) assert.equal(resolve(replacement, node, options), null);
  assert.equal(resolve(receipt, node, { ...options, filePath: "js/unproved.js" }), null);
  assert.equal(resolve(receipt, node, { ...options, source: `${source}\n// changed caller` }), null);
  assert.equal(resolve(receipt, node, { filePath: modulePath }), null);
  const other = nodes("function getScenarioWaterFeaturePath(feature, parts) { return feature; }").find(node => node.type === "FunctionDeclaration");
  assert.equal(resolve(receipt, other, options), null);
});

const sourceDrifts = [
  ["returned feature", "if (borrowed) return borrowed;", "if (borrowed) return feature;"],
  ["returned geometry", "if (borrowed) return borrowed;", "if (borrowed) return parts[0];"],
  ["builder final return", "      return path;\n    } finally", "      return feature;\n    } finally"],
  ["cached geometry projection", "? cached.path : null", "? cached.parts[0] : null"],
  ["cache path replaced by a part", "{ path, parts: [...parts], estimatedBytes }", "{ path: parts[0], parts: [...parts], estimatedBytes }"],
  ["cache path replaced by the feature", "{ path, parts: [...parts], estimatedBytes }", "{ path: feature, parts: [...parts], estimatedBytes }"],
  ["private Map replaced", "new GeometryBudgetMap({ budget: waterPathCacheBudget, weigh: (entry) => entry.estimatedBytes })", "runtimeState.sharedCache"],
  ["new cache writer", "if (borrowed) return borrowed;", "scenarioWaterPathCache.set(feature, { path: feature }); if (borrowed) return borrowed;"],
  ["Path2D provider changed", "new globalThis.Path2D(pathString)", "replacementProvider(part)"],
  ["Path2D global shadow", "  const scenarioWaterPathCache =", "  const globalThis = { Path2D: function () { return runtimeState; } };\n  const scenarioWaterPathCache ="],
  ["helper binding shadow", "      const waterPath =", "      const getScenarioWaterFeaturePath = () => feature;\n      const waterPath ="],
  ["same named nested helper", "      const waterPath =", "      function getScenarioWaterFeaturePath(feature) { return feature; }\n      const waterPath ="],
  ["new callback write", "const partPath = getScenarioWaterPartPath(part);", "part.properties.changed = true; const partPath = getScenarioWaterPartPath(part);"],
  ["draw callback writes state", "fillWaterPath(waterPath);", "runtimeState.width = 0; fillWaterPath(waterPath);"],
  ["caller writes returned result", "fillWaterPath(waterPath);", "waterPath.properties.changed = true; fillWaterPath(waterPath);"],
  ["path cache publication", "  const scenarioWaterFeaturePathKeyByPart =", "  globalThis.publishedCache = scenarioWaterPathCache;\n  const scenarioWaterFeaturePathKeyByPart ="],
  ["helper publication", "  const scenarioWaterFeaturePathKeyByPart =", "  globalThis.publishedHelper = getScenarioWaterFeaturePath;\n  const scenarioWaterFeaturePathKeyByPart ="],
  ["new local consumer", "fillWaterPath(waterPath);", "publish(getScenarioWaterFeaturePath(feature, parts)); fillWaterPath(waterPath);"],
];
for (const [label, before, after] of sourceDrifts) {
  test(`water resource proof rejects ${label}`, () => {
    reject(inspect({ source: changed(source, before, after) }));
    reject(inspect({ source: changed(isolated, before, after) }));
  });
}

test("water proof rejects every pinned dependency drift and unavailable providers", () => {
  for (const file of Object.keys(receipt.dependencies)) {
    reject(inspect({ source: isolated, readSource: path => path === file ? `${read(path)}\n// dependency drift\n` : read(path) }));
  }
  reject(inspect({ source, readSource: () => { throw new Error("unavailable"); } }));
  reject(inspect({ source, readSource: () => null }));
});

test("production factory, SVG and cache providers cannot be substituted", () => {
  for (const [file, before, after] of [
    ["js/core/map_renderer.js", "createScenarioRegionOverlayRenderOwner(runtimeState, {", "replacementOwner(runtimeState, {"],
    ["js/core/map_renderer.js", "surfaceHost: rendererSurfaceHost,", "surfaceHost: runtimeState,"],
    ["js/core/renderer/renderer_projection_path_owner.js", "geoPath: d3.geoPath.bind(d3)", "geoPath: replacementPath"],
    ["js/core/renderer/renderer_surface_host.js", "() => handles[key]", "() => globalThis.sharedState"],
    ["js/core/renderer/geometry_cache_budget.js", "return value;", "return globalThis.sharedState;"],
    ["js/core/renderer/geometry_cache_budget.js", "super.set(key, value);", "value.parts[0].changed = true; super.set(key, value);"],
    ["js/core/renderer/navigation_scene_owner.js", "const cached = h.getCachedWaterPath?.(feature, parts);",
      "const cached = h.getCachedWaterPath?.(feature, parts); cached.feature = feature;"],
  ]) reject(inspect({ source, readSource: path => path === file ? changed(read(file), before, after) : read(path) }));
});

test("new static, escaped, re-exported and unresolved dynamic consumers reject", () => {
  const consumer = "js/core/unproved_water_resource_consumer.js";
  for (const value of [
    'import { createScenarioRegionOverlayRenderOwner } from "./renderer/scenario_region_overlay_render_owner.js";',
    'import { createScenarioRegionOverlayRenderOwner as renamed } from "./renderer/scenario_region_overlay_render_owner.js";',
    'import * as owner from "./renderer/scenario_region_overlay_render_owner.js";',
    'export * from "./renderer/scenario_region_overlay_render_owner.js";',
    'export { createScenarioRegionOverlayRenderOwner } from "./renderer/scenario_region_overlay_render_owner.js";',
    'import { createScenarioRegionOverlayRenderOwner } from "/JS/CORE/RENDERER/SCENARIO_REGION_OVERLAY_RENDER_OWNER.JS";',
    'import { createScenarioRegionOverlayRenderOwner } from "./renderer/scenario_region_overlay_render_own\\u0065r.js";',
    'import { createScenarioRegionOverlayRenderOwner } from "./renderer/scenario_region_overlay_render_own%65r.js";',
    'import { createScenarioRegionOverlayRenderOwner } from "./renderer/scenario_region_overlay_render_owner.js?copy";',
    'import { createScenarioRegionOverlayRenderOwner } from "./renderer/scenario_region_overlay_render_owner.js#copy";',
    'import { createRendererProjectionPathOwner } from "./renderer/renderer_projection_path_owner.js";',
    'import { createNavigationSceneOwner } from "./renderer/navigation_scene_owner.js";',
    'import("./renderer/scenario_region_overlay_render_owner.js");',
    'import(`./renderer/scenario_region_overlay_render_owner.js`);',
    'import(globalThis.provider);',
    'import("https://example.invalid/js/core/renderer/scenario_region_overlay_render_owner.js");',
    'import("./renderer/scenario_region_overlay_render_owner%ZZ.js");',
  ]) {
    const result = inspect({ source, sourcePaths: [consumer], readSource: file => file === consumer ? value : read(file) });
    reject(result);
    assert.ok(result.violations.some(violation => violation.modulePath === consumer), value);
  }
});

test("source path fixtures cannot hide live imports or reuse a stale consumer graph", () => {
  const existing = "js/core/color_hex_utils.js";
  reject(inspect({ source, sourcePaths: [], readSource: file => file === existing
    ? `${read(file)}\nimport { createScenarioRegionOverlayRenderOwner } from './renderer/scenario_region_overlay_render_owner.js';` : read(file) }));
  const consumer = "js/core/unproved_water_resource_consumer.js";
  let injected = "export {};";
  const readSource = file => file === consumer ? injected : read(file);
  assert.deepEqual(inspect({ source, sourcePaths: [consumer], readSource }).violations, []);
  injected = 'import { createScenarioRegionOverlayRenderOwner } from "./renderer/scenario_region_overlay_render_owner.js";';
  reject(inspect({ source, sourcePaths: [consumer], readSource }));
});

function productionHelpers({ onSvg = () => {}, budget = 1e6 } = {}) {
  const snippets = [...Object.values(receipt.functions).map(helper => helper.declaration), receipt.cache.partsIdentityCheck]
    .map(site => source.slice(site.start, site.end)).join("\n");
  class TestPath2D {
    constructor(svg) { this.svg = svg; this.paths = []; }
    addPath(path) { this.paths.push(path); }
  }
  const projection = {};
  const surface = { getProjection: () => projection, getPathSvg: () => part => { onSvg(part); return "M0,0L1,1Z"; } };
  const helpers = new Function("GeometryBudgetMap", "getGeometryRetentionWeights", "getProjectionGeometryGeneration", "rendererSurfaceHost", "globalThis", "waterPathCacheBudget", `
    const scenarioWaterPathCache = new GeometryBudgetMap({ budget: waterPathCacheBudget, weigh: entry => entry.estimatedBytes });
    const scenarioWaterFeaturePathKeyByPart = new WeakMap();
    let waterPathBuildDepth = 0, waterPathBuildCount = 0, waterPathBuildMs = 0;
    const nowMs = () => 1;
    ${snippets}
    return { getScenarioWaterPartPath, getScenarioWaterFeaturePath, getCachedWaterFeaturePath, scenarioWaterPathCache };
  `)(GeometryBudgetMap, getGeometryRetentionWeights, () => 1, surface, { Path2D: TestPath2D }, budget);
  return { ...helpers, TestPath2D };
}

test("actual helpers return resources while retained cache parts remain original geometry", () => {
  let calls = 0;
  const h = productionHelpers({ onSvg: () => { calls++; } });
  const part = Object.freeze({ type: "Polygon", coordinates: Object.freeze([]) });
  const feature = Object.freeze({ geometry: part });
  const parts = Object.freeze([part]);
  const path = h.getScenarioWaterFeaturePath(feature, parts);
  assert.ok(path instanceof h.TestPath2D);
  assert.notEqual(path, feature);
  assert.notEqual(path, part);
  assert.equal(h.getCachedWaterFeaturePath({ geometry: part }, parts), path);
  assert.equal(h.getScenarioWaterFeaturePath(feature, parts), path);
  assert.equal(calls, 1);
  const entry = [...h.scenarioWaterPathCache.values()][0];
  assert.equal(entry.path, path);
  assert.notEqual(entry.parts, parts);
  assert.equal(entry.parts[0], part);
  assert.throws(() => { entry.parts[0].changed = true; }, TypeError);
  const second = Object.freeze({ type: "Polygon", coordinates: Object.freeze([]) });
  const combined = h.getScenarioWaterFeaturePath(feature, [part, second]);
  assert.ok(combined instanceof h.TestPath2D);
  assert.equal(combined.paths.length, 2);
  assert.equal(h.getCachedWaterFeaturePath(feature, [part]), null);
});

test("geometry getters and path callbacks keep observable effects", () => {
  const effects = { callback: 0, getter: 0 };
  const geometry = Object.freeze({ type: "Polygon", coordinates: Object.freeze([]) });
  const part = Object.freeze({ get geometry() { effects.getter++; return geometry; } });
  const h = productionHelpers({ onSvg: () => { effects.callback++; } });
  const path = h.getScenarioWaterFeaturePath(Object.freeze({ geometry: part }), Object.freeze([part]));
  assert.ok(path instanceof h.TestPath2D);
  assert.equal(effects.callback, 1);
  assert.ok(effects.getter > 0);
  assert.equal(receipt.admitCall, false);
  assert.equal(receipt.functions.getScenarioWaterFeaturePath.admitCall, false);
});

test("resource-like helper names cannot hide a write at the caller", () => {
  for (const helperName of Object.keys(receipt.functions)) {
    const fixture = [
      'import { state as runtimeState } from "./state.js";',
      `function ${helperName}(feature) { return feature; }`,
      `const result = ${helperName}(runtimeState.feature);`,
      "result.properties.changed = true;",
    ].join("\n");
    reject(inspect({ source: fixture }));
    const findings = scanStateMutations(fixture, { filePath: modulePath, derivedAliasTaintMode: "strict",
      bindings: [{ id: "module:runtimeState", kind: "module", name: "runtimeState", importSource: "./state.js", importedName: "state" }] });
    assert.ok(findings.some(finding => finding.line === 4 && fixture.slice(finding.start, finding.end).includes("result.properties.changed")),
      `${helperName}: caller write must remain visible, not merely an earlier escape`);
  }
});
