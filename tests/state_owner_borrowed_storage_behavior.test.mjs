import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parse } from "acorn";
import {
  STATE_MUTATION_DELEGATING_OWNER_CONTRACT,
  inspectStateMutationDelegatingOwnerSources,
} from "../tools/state_action_delegation_contract.mjs";
import { scanStateMutations } from "../tools/state_writer_inventory.mjs";
import {
  STATE_BORROWED_RUNTIME_CONTRACT,
  inspectStateBorrowedRuntimeSources,
} from "../tools/state_borrowed_effect_contract.mjs";

const politicalEntry = STATE_MUTATION_DELEGATING_OWNER_CONTRACT.find(
  (candidate) => candidate.factoryExportName === "createPoliticalPathCacheOwner",
);
assert.ok(politicalEntry);
const politicalCompositionSource = fs.readFileSync(politicalEntry.compositionModulePath, "utf8").replaceAll("\r\n", "\n");
const politicalComposition = parse(politicalCompositionSource, { ecmaVersion: "latest", sourceType: "module" }).body.find(
  (node) => node.type === "FunctionDeclaration" && node.id.name === politicalEntry.compositionExportName,
);
const politicalPrefix = [
  'import { state as runtimeState } from "./state.js";',
  'import { createPoliticalPathCacheOwner } from "./renderer/political_path_cache_owner.js";',
  politicalCompositionSource.slice(politicalComposition.start, politicalComposition.end),
].join("\n") + "\n";

// Existing delegation-edge tests cover direct map/cache/geometry writes and
// method aliases. These cases exercise dynamic paths and defaulted geometry aliases.
for (const [name, statement] of [
  ["dynamic handle field", "const handle = composePoliticalPathCacheOwner().getPoliticalPathCacheHandle(); handle[pickField()].dirty = {};"],
  ["dynamic owner method", "const owner = composePoliticalPathCacheOwner(); owner[pickMethod()]().map.clear();"],
  ["defaulted geometry method alias", "const { getPoliticalFeaturePathEntry: read = () => null } = composePoliticalPathCacheOwner(); read(feature).geometryRef.coordinates = [];"],
  ["geometry result alias", "const read = composePoliticalPathCacheOwner().getPoliticalFeaturePathEntry; const entry = read(feature); const geometry = entry.geometryRef; leak(geometry);"],
]) {
  test(`political public borrow survives ${name}`, () => {
    const findings = scanStateMutations(politicalPrefix + statement, {
      filePath: politicalEntry.compositionModulePath,
      bindings: [{ id: "module:runtimeState", kind: "module", name: "runtimeState", importSource: "./state.js", importedName: "state" }],
      derivedAliasTaintMode: "strict",
    }).filter((finding) => finding.line >= politicalPrefix.split("\n").length);
    assert.ok(findings.length > 0, `${name}: ${JSON.stringify(findings)}`);
  });
}

test("political local parameter analysis still detects direct runtime state writes", () => {
  const source = fs.readFileSync(politicalEntry.factoryModulePath, "utf8");
  const marker = "let warmupTransform = null;";
  assert.ok(source.includes(marker));
  const changed = source.replace(marker, 'runtimeState.bootPhase = "bad";\n  ' + marker);
  const findings = scanStateMutations(changed, {
    filePath: politicalEntry.factoryModulePath,
    bindings: [{ id: "function:createPoliticalPathCacheOwner:runtimeState", kind: "function-parameter", functionName: "createPoliticalPathCacheOwner", parameterName: "runtimeState", parameterIndex: 0, parameterPath: "$" }],
    derivedAliasTaintMode: "strict",
  });
  assert.ok(findings.some((finding) => finding.key === "bootPhase"), JSON.stringify(findings));
});

const entry = STATE_MUTATION_DELEGATING_OWNER_CONTRACT.find(
  (candidate) => candidate.factoryExportName === "createBorderMeshOwner",
);
assert.ok(entry, "border ownership proof must be registered");
const compositionSource = fs.readFileSync(entry.compositionModulePath, "utf8").replaceAll("\r\n", "\n");
const factorySource = fs.readFileSync(entry.factoryModulePath, "utf8").replaceAll("\r\n", "\n");
const ast = parse(compositionSource, { ecmaVersion: "latest", sourceType: "module" });
const composition = ast.body.find((node) => node.type === "FunctionDeclaration" && node.id.name === entry.compositionExportName);
assert.ok(composition);
const prefix = [
  'import { state } from "./state.js";',
  'import { createBorderMeshOwner } from "./renderer/border_mesh_owner.js";',
  "let borderMeshOwner = null;",
  compositionSource.slice(composition.start, composition.end),
].join("\n") + "\n";
const tailLine = prefix.split("\n").length;
function findingsFor(statement) {
  return scanStateMutations(prefix + statement, {
    filePath: entry.compositionModulePath,
    bindings: [{ id: "module:state", kind: "module", name: "state", importSource: "./state.js", importedName: "state" }],
    derivedAliasTaintMode: "strict",
  }).filter((finding) => finding.line >= tailLine);
}

const coastlineWrapper = ast.body.find(
  (node) => node.type === "FunctionDeclaration" && node.id.name === "resolveCoastlineTopologySource",
);
assert.ok(coastlineWrapper);
const coastlineWrapperSource = compositionSource.slice(coastlineWrapper.start, coastlineWrapper.end);
const forwardingPrefix = prefix + coastlineWrapperSource + "\n";
function forwardingFindings(statement) {
  return scanStateMutations(forwardingPrefix + statement, {
    filePath: entry.compositionModulePath,
    bindings: [{ id: "module:state", kind: "module", name: "state", importSource: "./state.js", importedName: "state" }],
    derivedAliasTaintMode: "strict",
  }).filter((finding) => finding.line >= forwardingPrefix.split("\n").length);
}

test("coastline forwarding permits caller-owned scalar fields", () => {
  assert.deepEqual(forwardingFindings('const decision = resolveCoastlineTopologySource(); decision.source = "primary";'), []);
});

for (const statement of [
  "resolveCoastlineTopologySource().topology.arcs = [];",
  "const resolve = resolveCoastlineTopologySource; resolve().topology.arcs.push([]);",
  "leak(resolveCoastlineTopologySource().topology);",
  "leak(resolveCoastlineTopologySource());",
  "resolveCoastlineTopologySource = unknown; resolveCoastlineTopologySource(state);",
  "let resolve = resolveCoastlineTopologySource; resolve = unknown; resolve(state);",
  "function invoke(resolveCoastlineTopologySource) { resolveCoastlineTopologySource(state); } invoke(unknown);",
]) {
  test(`coastline forwarding keeps caller borrow: ${statement}`, () => {
    assert.ok(forwardingFindings(statement).length > 0, statement);
  });
}

for (const [name, replacement] of [
  ["root state return", "function resolveCoastlineTopologySource(...args) { return state; }"],
  ["extra side effect", "function resolveCoastlineTopologySource(...args) { leak(state); return getBorderMeshOwner().resolveCoastlineTopologySource(...args); }"],
  ["fake callee", "function resolveCoastlineTopologySource(...args) { return fakeOwner().resolveCoastlineTopologySource(...args); }"],
]) {
  test(`coastline forwarding source proof rejects ${name}`, () => {
    const changed = compositionSource.replace(coastlineWrapperSource, replacement);
    assert.notEqual(changed, compositionSource);
    const result = inspectStateMutationDelegatingOwnerSources({ compositionSource: changed, factorySource, entry });
    assert.ok(result.violations.length > 0, JSON.stringify(result));
  });
}

test("coastline borrowed storage proof matches the real composition and factory", () => {
  assert.deepEqual(inspectStateMutationDelegatingOwnerSources({ compositionSource, factorySource, entry }).violations, []);
  assert.deepEqual(findingsFor('const decision = getBorderMeshOwner().resolveCoastlineTopologySource(); decision.source = "primary";'), []);
});

for (const [name, statement] of [
  ["direct topology mutation", 'getBorderMeshOwner().resolveCoastlineTopologySource().topology.arcs.push([]);'],
  ["returned holder alias", 'const decision = getBorderMeshOwner().resolveCoastlineTopologySource(); const topology = decision.topology; topology.objects.political = {};'],
  ["destructured topology alias", 'const { topology: borrowed } = getBorderMeshOwner().resolveCoastlineTopologySource(); borrowed.arcs = [];'],
  ["borrow passed to unknown function", 'const decision = getBorderMeshOwner().resolveCoastlineTopologySource(); leak(decision.topology);'],
  ["whole result passed to unknown function", 'leak(getBorderMeshOwner().resolveCoastlineTopologySource());'],
  ["method alias", 'const owner = getBorderMeshOwner(); const resolve = owner.resolveCoastlineTopologySource; resolve().topology.arcs = [];'],
  ["method destructuring with fallback", 'const { resolveCoastlineTopologySource: resolve = () => null } = getBorderMeshOwner(); resolve().topology.arcs = [];'],
  ["literal computed borrowed path", 'const decision = getBorderMeshOwner().resolveCoastlineTopologySource(); decision["topology"].arcs = [];'],
  ["dynamic borrowed path", 'const decision = getBorderMeshOwner().resolveCoastlineTopologySource(); const key = pickField(); decision[key].arcs = [];'],
]) {
  test(`coastline public return preserves taint through ${name}`, () => {
    const findings = findingsFor(statement);
    assert.ok(findings.length > 0, `${name}: ${JSON.stringify(findings)}`);
  });
}

function chunkFindingsFor(statement) {
  const prefix = [
    'import { state } from "../core/state.js";',
    'import { preloadScenarioCoarseChunks } from "../core/scenario_resources.js";',
  ].join("\n") + "\n";
  return scanStateMutations(prefix + statement, {
    filePath: "js/ui/borrowed_chunk_result_fixture.js",
    bindings: [{ id: "module:state", kind: "module", name: "state", importSource: "../core/state.js", importedName: "state" }],
    derivedAliasTaintMode: "strict",
  }).filter((finding) => finding.line >= 3);
}

test("public chunk prewarm result allows boolean observation without mutation", () => {
  assert.deepEqual(chunkFindingsFor("const result = await preloadScenarioCoarseChunks(bundle); const ready = Boolean(result);"), []);
});

for (const [name, statement] of [
  ["direct public result", "preloadScenarioCoarseChunks(bundle).political.features[0].properties.name = 'bad';"],
  ["awaited payload result", "const payloads = await preloadScenarioCoarseChunks(bundle); payloads.political.features.push({});"],
  ["payload alias", "const payloads = await preloadScenarioCoarseChunks(bundle); const features = payloads.political.features; features[0].geometry.coordinates = [];"],
  ["destructured payload", "const { political: borrowed } = await preloadScenarioCoarseChunks(bundle); borrowed.features = [];"],
  ["public function alias", "const preload = preloadScenarioCoarseChunks; const payloads = await preload(bundle); payloads.political.features = [];"],
  ["dynamic payload layer", "const payloads = await preloadScenarioCoarseChunks(bundle); payloads[pickLayer()].features = [];"],
  ["unknown payload call", "const payloads = await preloadScenarioCoarseChunks(bundle); leak(payloads.political);"],
  ["unknown result call", "leak(await preloadScenarioCoarseChunks(bundle));"],
]) {
  test(`public chunk prewarm preserves borrowed results through ${name}`, () => {
    const findings = chunkFindingsFor(statement);
    assert.ok(findings.length > 0, `${name}: ${JSON.stringify(findings)}`);
  });
}

test("a same-named prewarm export from another module cannot inherit the public source receipt", () => {
  const runtimeEntry = STATE_BORROWED_RUNTIME_CONTRACT.find((candidate) => candidate.borrowedPublicExports.some(
    (published) => published.modulePath === "js/core/scenario_resources.js" && published.exportName === "preloadScenarioCoarseChunks",
  ));
  assert.ok(runtimeEntry);
  const forged = {
    ...runtimeEntry,
    borrowedPublicExports: [{ modulePath: "js/core/fake_scenario_resources.js", exportName: "preloadScenarioCoarseChunks", paths: [[]] }],
  };
  assert.ok(inspectStateBorrowedRuntimeSources(forged).violations.some((violation) => violation.code === "borrowed-runtime-unknown-contract"));
});

const cityEntry = STATE_MUTATION_DELEGATING_OWNER_CONTRACT.find(
  (candidate) => candidate.factoryExportName === "createCityLightsRenderOwner",
);
assert.ok(cityEntry, "city ownership proof must be registered");
const cityFactorySource = fs.readFileSync(cityEntry.factoryModulePath, "utf8").replaceAll("\r\n", "\n");
const cityComposition = ast.body.find((node) => node.type === "FunctionDeclaration" && node.id.name === cityEntry.compositionExportName);
assert.ok(cityComposition);
const cityPrefix = [
  'import { state } from "./state.js";',
  'import { createCityLightsRenderOwner } from "./renderer/city_lights_render_owner.js";',
  "let cityLightsRenderOwner = null;",
  compositionSource.slice(cityComposition.start, cityComposition.end),
].join("\n") + "\n";
const cityTailLine = cityPrefix.split("\n").length;
function cityFindingsFor(statement) {
  return scanStateMutations(cityPrefix + statement, {
    filePath: cityEntry.compositionModulePath,
    bindings: [{ id: "module:state", kind: "module", name: "state", importSource: "./state.js", importedName: "state" }],
    derivedAliasTaintMode: "strict",
  }).filter((finding) => finding.line >= cityTailLine);
}

test("city borrowed returns retain owned scalar fields without tainting every entry", () => {
  assert.deepEqual(inspectStateMutationDelegatingOwnerSources({ compositionSource, factorySource: cityFactorySource, entry: cityEntry }).violations, []);
  assert.deepEqual(cityFindingsFor("const entries = getCityLightsRenderOwner().collectModernUrbanCoreEntries(); entries[0].weight = 1;"), []);
  assert.deepEqual(cityFindingsFor("const data = getCityLightsRenderOwner().getModernCityLightsPopulationBoostData(); data.cityLayerRevision = 1;"), []);
});

for (const [name, statement] of [
  ["numeric array index", "getCityLightsRenderOwner().collectModernUrbanCoreEntries()[0].feature.properties.name = 'bad';"],
  ["entry alias", "const entries = getCityLightsRenderOwner().collectModernUrbanCoreEntries(); const first = entries[0]; first.feature.geometry.coordinates.push([]);"],
  ["array destructuring", "const [first] = getCityLightsRenderOwner().collectModernUrbanCoreEntries(); first.feature.properties.name = 'bad';"],
  ["nested feature destructuring", "const entries = getCityLightsRenderOwner().collectModernUrbanCoreEntries(); const { feature: borrowed } = entries[0]; borrowed.properties.name = 'bad';"],
  ["dynamic array index", "const entries = getCityLightsRenderOwner().collectModernUrbanCoreEntries(); entries[pickIndex()].feature.properties.name = 'bad';"],
  ["unknown-call feature escape", "const entries = getCityLightsRenderOwner().collectModernUrbanCoreEntries(); leak(entries[0].feature);"],
  ["method alias", "const owner = getCityLightsRenderOwner(); const collect = owner.collectModernUrbanCoreEntries; collect()[0].feature.properties.name = 'bad';"],
  ["population collection", "const data = getCityLightsRenderOwner().getModernCityLightsPopulationBoostData(); data.urbanCollection.features[0].properties.name = 'bad';"],
  ["population urban entry", "const data = getCityLightsRenderOwner().getModernCityLightsPopulationBoostData(); data.urbanEntries[0].urbanFeature.properties.name = 'bad';"],
  ["population city entry", "const data = getCityLightsRenderOwner().getModernCityLightsPopulationBoostData(); data.cityEntries[0].feature.properties.name = 'bad';"],
  ["Map.get value", "const data = getCityLightsRenderOwner().getModernCityLightsPopulationBoostData(); const value = data.urbanByFeature.get(id); value.urbanFeature.properties.name = 'bad';"],
  ["Map.keys iteration", "const data = getCityLightsRenderOwner().getModernCityLightsPopulationBoostData(); for (const feature of data.cityByFeature.keys()) feature.properties.name = 'bad';"],
  ["Map.values conversion", "const data = getCityLightsRenderOwner().getModernCityLightsPopulationBoostData(); const values = Array.from(data.urbanByFeature.values()); values[0].urbanFeature.properties.name = 'bad';"],
  ["forEach callback mutation", "const entries = getCityLightsRenderOwner().collectModernUrbanCoreEntries(); entries.forEach(entry => { entry.feature.properties.name = 'bad'; });"],
  ["map result mutation", "const entries = getCityLightsRenderOwner().collectModernUrbanCoreEntries(); const features = entries.map(entry => entry.feature); features[0].properties.name = 'bad';"],
  ["filter result mutation", "const entries = getCityLightsRenderOwner().collectModernUrbanCoreEntries(); const selected = entries.filter(entry => entry.weight > 0); selected[0].feature.properties.name = 'bad';"],
  ["flatMap result mutation", "const entries = getCityLightsRenderOwner().collectModernUrbanCoreEntries(); const features = entries.flatMap(entry => [entry.feature]); features[0].geometry.coordinates.push([]);"],
  ["some callback escape", "const entries = getCityLightsRenderOwner().collectModernUrbanCoreEntries(); entries.some(entry => leak(entry.feature));"],
  ["public iterator replacement", "const entries = getCityLightsRenderOwner().collectModernUrbanCoreEntries(); entries.map = unknownIterator; entries.map(entry => entry.feature);"],
]) {
  test(`city public returns preserve borrowed paths through ${name}`, () => {
    const findings = cityFindingsFor(statement);
    assert.ok(findings.length > 0, `${name}: ${JSON.stringify(findings)}`);
  });
}

function injectIntoFunction(source, name, statement) {
  let target;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "FunctionDeclaration" && node.id?.name === name) target = node;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(parse(source, { ecmaVersion: "latest", sourceType: "module" }));
  assert.ok(target, name);
  const at = target.body.start + 1;
  return source.slice(0, at) + "\n" + statement + "\n" + source.slice(at);
}

for (const [name, statement] of [
  ["new undeclared borrowed storage", "const extraBorrow = { topology: state.topology }; leak(extraBorrow);"],
  ["borrowed input mutation", "state.topology.arcs.push([]);"],
  ["side effect during storage construction", "const extraBorrow = { topology: (leak(state.topology), state.topology) };"],
  ["same-name storage in a different scope", "function otherScope() { const publishedDecision = { topology: state.topology }; leak(publishedDecision); }"],
]) {
  test(`coastline storage authorization fails closed after ${name}`, () => {
    const changed = injectIntoFunction(factorySource, "resolveCoastlineTopologySource", statement);
    assert.notEqual(changed, factorySource);
    const violations = inspectStateMutationDelegatingOwnerSources({ compositionSource, factorySource: changed, entry }).violations;
    assert.ok(violations.some((violation) => violation.code === "state-mutation-owner-factory-source-drift"), JSON.stringify(violations));
  });
}
