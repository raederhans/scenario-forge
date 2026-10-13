import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "acorn";
import { inspectStateEditorUiSourceRefresh, inspectStateEditorUiSourceRefreshEvidence } from "../tools/state_editor_ui_source_contract.mjs";
import { STATE_CAPABILITY_RETIREMENT_CONTRACT, matchesStateCapabilityRetirementSource } from "../tools/state_action_delegation_contract.mjs";
import { inspectStateCapabilityRetirementEvidence } from "../tools/build_state_writer_policy.mjs";

const REVISION = "52427d3a2b5e786f30ffcfb3491b6733be339f79";
const normalize = source => source.replace(/\r\n?/g, "\n");
const hash = source => createHash("sha256").update(source).digest("hex");
const read = path => normalize(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const cache = new Map();
const historical = (revision, path) => {
  const key = `${revision}:${path}`;
  if (!cache.has(key)) cache.set(key, normalize(execFileSync("git", ["show", key], {
    cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  })));
  return cache.get(key);
};
const definitions = [
  { path: "js/ui/sidebar.js", anchor: "1f4ac3fea7a46572daf9bfd3fc6852b1c18bb04532d3638da8e54c2a2849d112",
    old: 2221, kept: 2219, added: 4, transforms: 6, providers: 14, retirements: 7 },
  { path: "js/ui/toolbar.js", anchor: "a580f7b8b9029454b668eefd794419c1fffe23a5d4c43923ad9fbb2109eea22e",
    old: 1553, kept: 1552, added: 7, transforms: 7, providers: 10, retirements: 2 },
];
const context = definition => ({ modulePath: definition.path, sourceFingerprint: definition.anchor,
  source: read(definition.path), readCurrentSource: read, readHistoricalSource: historical });
const contracts = STATE_CAPABILITY_RETIREMENT_CONTRACT.filter(entry => definitions.some(item => entry.modulePath === item.path));
const previousPolicy = () => JSON.parse(historical(contracts[0].previousSourceRevision, "tools/state_writer_policy.json"));
const validate = patch => inspectStateCapabilityRetirementEvidence({ previousPolicy: previousPolicy(), contractEntries: contracts,
  readCurrentSource: read, readHistoricalSource: historical, ...patch });
function nodesOf(source) {
  const nodes = [];
  const visit = node => {
    if (!node?.type) return;
    nodes.push(node);
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child?.type) visit(child);
    }
  };
  visit(parse(source, { ecmaVersion: "latest", sourceType: "module" }));
  return nodes;
}
const replace = (source, before, after) => {
  assert.ok(source.includes(before), `fixture anchor exists: ${before}`);
  return source.replace(before, after);
};

for (const definition of definitions) {
  test(`editor UI reconstructs ${definition.path} and accounts for every preserved and changed effect site`, () => {
    const options = context(definition), result = inspectStateEditorUiSourceRefreshEvidence(options), receipt = result.receipt;
    assert.equal(result.matched, true);
    assert.deepEqual(result.violations, []);
    assert.equal(inspectStateEditorUiSourceRefresh(options), true);
    assert.equal(receipt.previousSourceFingerprint, definition.anchor);
    assert.equal(receipt.sourceFingerprint, hash(options.source));
    assert.equal(receipt.hookIntermediateFingerprint, hash(historical("311e5dfe8f335ec11817aabd7e2fda4f49c1ba52", definition.path)));
    assert.equal(receipt.transforms.length, definition.transforms);
    assert.equal(receipt.historicalSiteCount, definition.old);
    assert.equal(receipt.preservedSites.length, definition.kept);
    assert.equal(receipt.effectDeltas.length, definition.old - definition.kept);
    assert.equal(receipt.addedSites.length, definition.added);
    const oldSource = historical(REVISION, definition.path), oldNodes = new Map(nodesOf(oldSource).map(node => [`${node.start}:${node.end}:${node.type}`, node]));
    const currentNodes = new Map(nodesOf(options.source).map(node => [`${node.start}:${node.end}:${node.type}`, node]));
    const previousSites = new Set(), currentSites = new Set();
    for (const site of receipt.preservedSites) {
      assert.ok(oldNodes.has(`${site.previous.start}:${site.previous.end}:${site.nodeType}`));
      assert.ok(currentNodes.has(`${site.current.start}:${site.current.end}:${site.nodeType}`));
      const text = oldSource.slice(site.previous.start, site.previous.end);
      assert.equal(text, options.source.slice(site.current.start, site.current.end));
      assert.equal(hash(text), site.sourceFingerprint);
      previousSites.add(`${site.previous.start}:${site.previous.end}`);
      currentSites.add(`${site.current.start}:${site.current.end}`);
    }
    for (const delta of receipt.effectDeltas) {
      assert.equal(hash(oldSource.slice(delta.previousSite.start, delta.previousSite.end)), delta.previous);
      previousSites.add(`${delta.previousSite.start}:${delta.previousSite.end}`);
      if (delta.currentSite) {
        assert.equal(hash(options.source.slice(delta.currentSite.start, delta.currentSite.end)), delta.current);
        currentSites.add(`${delta.currentSite.start}:${delta.currentSite.end}`);
      }
    }
    for (const site of receipt.addedSites) currentSites.add(`${site.current.start}:${site.current.end}`);
    assert.equal(previousSites.size, definition.old);
    assert.equal(currentSites.size, receipt.currentSiteCount);
    for (const key of ["grantsWriterAuthority", "grantsDiagnosticCredit", "grantsPureReaderPermission", "refreshesRetirementIdentity"]) assert.equal(receipt[key], false);
    assert.throws(() => { receipt.preservedSites[0].lexicalAncestry.push("forged"); }, TypeError);
    assert.throws(() => { receipt.effectDeltas[0].effect = "pure"; }, TypeError);
  });

  test(`editor UI ${definition.path} checks historical evidence and normalizes line endings only`, () => {
    const options = context(definition);
    assert.equal(inspectStateEditorUiSourceRefresh({ ...options, source: options.source.replaceAll("\n", "\r\n"),
      readHistoricalSource: (revision, path) => historical(revision, path).replaceAll("\n", "\r\n"),
      readCurrentSource: path => read(path).replaceAll("\n", "\r\n") }), true);
    for (const source of [null, `${options.source}\n// changed`, historical(REVISION, definition.path),
      historical("311e5dfe8f335ec11817aabd7e2fda4f49c1ba52", definition.path)]) {
      assert.equal(inspectStateEditorUiSourceRefresh({ ...options, source }), false);
    }
    assert.equal(inspectStateEditorUiSourceRefresh({ ...options, readHistoricalSource: () => `${historical(REVISION, definition.path)}\n// drift` }), false);
    assert.equal(inspectStateEditorUiSourceRefresh({ ...options, readHistoricalSource: () => options.source }), false);
    assert.equal(inspectStateEditorUiSourceRefresh({ ...options, readHistoricalSource: () => { throw Error("missing"); } }), false);
  });

  test(`editor UI ${definition.path} refuses drift and missing text for every pinned provider`, () => {
    const options = context(definition), receipt = inspectStateEditorUiSourceRefreshEvidence(options).receipt;
    assert.equal(Object.keys(receipt.providerFingerprints).length, definition.providers);
    for (const path of Object.keys(receipt.providerFingerprints)) {
      for (const value of [null, `${read(path)}\n// changed provider`]) {
        assert.equal(inspectStateEditorUiSourceRefresh({ ...options, readCurrentSource: requested => requested === path ? value : read(requested) }), false, path);
      }
    }
  });
}

test("editor UI source refresh defers unknown identity pairs without reading files", () => {
  const forbidden = () => { throw Error("unknown receipt must not read"); };
  for (const definition of definitions) for (const patch of [{ modulePath: "js/ui/unrelated.js" }, { sourceFingerprint: "unregistered" }, { sourceFingerprint: hash(read(definition.path)) }]) {
    assert.equal(inspectStateEditorUiSourceRefresh({ ...context(definition), ...patch, readCurrentSource: forbidden, readHistoricalSource: forbidden }), null);
  }
});

test("editor UI receipts explicitly retain effect changes instead of calling them equivalent or pure", () => {
  const sidebar = inspectStateEditorUiSourceRefreshEvidence(context(definitions[0])).receipt;
  assert.deepEqual(sidebar.effectDeltas.map(delta => delta.kind), ["removed-palette-initialization-call", "extended-controller-result-assignment"]);
  assert.equal(sidebar.effectDeltas[0].currentSite, null);
  assert.match(sidebar.effectDeltas[0].effect, /Other callers and the mutating helper are unchanged/);
  const toolbar = inspectStateEditorUiSourceRefreshEvidence(context(definitions[1])).receipt;
  assert.equal(toolbar.effectDeltas[0].kind, "replaced-workspace-hook-callback");
  assert.match(toolbar.effectDeltas[0].effect, /arguments and return values are not forwarded/);
  assert.match(toolbar.boundary, /UI\/hook\/storage\/viewport effects/);
});

const sidebarDrifts = [
  ['import { initPaletteColorCheckEditor } from "./palette_color_check_editor.js";', 'import { initPaletteColorCheckEditor } from "./unreviewed_palette.js";'],
  ['from "../core/state/runtime_hooks.js"', 'from "../core/state/index.js"'],
  ["defaultCountryPalette[countryState.code] ||", "ensureCountryPaletteColor(countryState.code) ||"],
  ["    focusLegendColor,\n    refreshProjectSaveStatus,", "    focusLegendColor,\n    runtimeState,\n    refreshProjectSaveStatus,"],
  ["getCountries: () => [...latestCountryStatesByCode.values()]", "getCountries: () => { runtimeState.featureOverrides = {}; return [...latestCountryStatesByCode.values()]; }"],
  ["  initPaletteColorCheckEditor({", "  runtimeState.visualOverrides = {}; initPaletteColorCheckEditor({"],
  ["    selectCountry: selectInspectorCountry,", "    selectCountry: unreviewedSelection,"],
  ["    workspace: editorWorkspace,", "    workspace: runtimeState,"],
];
const toolbarDrifts = [
  ['from "./view_bookmarks.js"', 'from "./unreviewed_bookmarks.js"'],
  ["    refreshWorkspaceStatus();", "    refreshWorkspaceStatus(); runtimeState.countryBaseColors = {};"],
  ["    viewBookmarks?.refresh();", "    viewBookmarks?.refresh(); publish(runtimeState);"],
  ["    viewBookmarks?.refresh();", "    // hook refresh removed"],
  ["    captureView: captureViewportView,", "    captureView: () => runtimeState,"],
  ["    restoreView: restoreViewportView,", "    restoreView: unreviewedRestore,"],
  ['runtimeState.bootPhase === "ready" && !runtimeState.startupReadonly && !runtimeState.scenarioApplyInFlight', "true"],
  ["scope: getViewBookmarkScope({ scenarioId: runtimeState.activeScenarioId, mapMode: runtimeState.mapSemanticMode })", 'scope: "shared"'],
];
for (const [definition, cases] of [[definitions[0], sidebarDrifts], [definitions[1], toolbarDrifts]]) {
  for (const [before, after] of cases) test(`editor UI refuses unregistered wiring change in ${definition.path}: ${after}`, () => {
    const options = context(definition), source = replace(options.source, before, after);
    assert.equal(inspectStateEditorUiSourceRefresh({ ...options, source }), false);
    assert.equal(inspectStateEditorUiSourceRefreshEvidence({ ...options, source }).receipt, null);
  });
}

test("editor UI source bridge preserves all nine original retirement contracts including their identities and counts", () => {
  // Interpret literal historical contract data only; never execute the old module.
  const ast = parse(historical(REVISION, "tools/state_action_delegation_contract.mjs"), { ecmaVersion: "latest", sourceType: "module" });
  const declarations = new Map(ast.body.flatMap(node => (node.declaration || node).declarations || []).map(node => [node.id.name, node.init]));
  const valueOf = node => {
    if (node.type === "Literal") return node.value;
    if (node.type === "ArrayExpression") return node.elements.map(valueOf);
    if (node.type === "ObjectExpression") return Object.fromEntries(node.properties.map(property => [property.key.name || property.key.value, valueOf(property.value)]));
    if (node.type === "Identifier" && declarations.has(node.name)) return valueOf(declarations.get(node.name));
    if (node.type === "CallExpression" && node.arguments.length === 1 && node.callee.type === "MemberExpression" && !node.callee.computed) {
      if (node.callee.object.name === "Object" && node.callee.property.name === "freeze") return valueOf(node.arguments[0]);
      if (node.callee.object.name === "JSON" && node.callee.property.name === "stringify") return JSON.stringify(valueOf(node.arguments[0]));
    }
    throw Error(`unexpected historical data: ${node.type}`);
  };
  const selected = entry => definitions.some(definition => entry.modulePath === definition.path);
  const sourceProofs = valueOf(declarations.get("STATE_CAPABILITY_RETIREMENT_SOURCE_PROOFS"));
  const originals = valueOf(declarations.get("retiredCapabilityModules")).filter(selected).flatMap(module => module.memberships.map(
    ([domain, migrationPhase, operation, key, retiredMutationSiteCount, retiredMutationSiteFingerprint]) => ({
      modulePath: module.modulePath, bindingIdentity: module.bindingIdentity || valueOf(declarations.get("RETIRED_DEV_WORKSPACE_BINDING_IDENTITY")),
      domain, migrationPhase, operation, key, retiredMutationSiteCount, retiredMutationSiteFingerprint,
      previousSourceRevision: valueOf(declarations.get("RETIRED_DEV_WORKSPACE_SOURCE_REVISION")),
      previousSourceFingerprint: module.previousSourceFingerprint, currentSourceFingerprint: module.currentSourceFingerprint,
    }))).map(entry => ({ ...entry, retiredMembershipIdentity: [entry.modulePath, entry.bindingIdentity, entry.domain, entry.migrationPhase, entry.operation, entry.key].join("|"),
    contractIdentity: hash(JSON.stringify({ ...entry, sourceProofs })),
  })).concat(valueOf(declarations.get("additionalRetiredAuthorityEntries")).filter(selected).map(entry => ({ ...entry,
    contractIdentity: hash(JSON.stringify({ ...entry, sourceProofs })),
  })));
  assert.equal(originals.length, 9);
  assert.deepEqual(contracts, originals);
});

test("editor UI refresh passes the real scoped retirement gate and rejects new or restored writer authority", () => {
  for (const definition of definitions) assert.equal(matchesStateCapabilityRetirementSource(context(definition)), true);
  assert.deepEqual(validate(), []);
  for (const definition of definitions) assert.equal(contracts.filter(entry => entry.modulePath === definition.path).length, definition.retirements);
  for (const entry of contracts) {
    const statement = entry.operation === "delete" ? `delete runtimeState.${entry.key}.restored;` : `runtimeState.${entry.key} = {};`;
    const changed = `${read(entry.modulePath)}\n${statement}\n`;
    assert.ok(validate({ contractEntries: [entry], readCurrentSource: path => path === entry.modulePath ? changed : read(path) })
      .some(item => item.reason === "current-source-drift" && item.identity === entry.retiredMembershipIdentity));
  }
  const entry = contracts[0];
  assert.ok(validate({ contractEntries: [{ ...entry, retiredMutationSiteCount: entry.retiredMutationSiteCount + 1 }] })
    .some(item => item.reason === "historical-membership-drift"));
  assert.ok(validate({ contractEntries: [entry], currentWriters: [{ path: entry.modulePath, bindings: [{ grants: [{ domain: entry.domain,
    migrationPhase: entry.migrationPhase, memberships: [{ operation: entry.operation, key: entry.key }] }] }] }] })
    .some(item => item.reason === "current-membership-still-present"));
});
