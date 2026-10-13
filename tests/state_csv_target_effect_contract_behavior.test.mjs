import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CSV_TARGET_ACTION_PATH, inspectStateCsvTargetEffects, filterStateCsvTargetEffectFindings } from "../tools/state_csv_target_effect_contract.mjs";
import { buildStateWriterBindingGrants, discoverStateWriterBindingsForSource, scanStateWriterBindingInventoriesBatch,
  validateStateActionNonTargetParameterMutations } from "../tools/build_state_writer_policy.mjs";
import { buildCanonicalStateKeyAuthorityIndex } from "../tools/state_writer_policy.mjs";
import { STATE_ACTION_DELEGATION_CONTRACT, validateStateActionPolicyBindings } from "../tools/state_action_delegation_contract.mjs";
import { commitSpecialZoneLayersState, patchSpecialZoneLegendFieldsState, restoreSpecialZoneLegendSnapshotState } from "../js/core/state/actions/special_zone_actions.js";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n?/g, "\n");
const source = read(CSV_TARGET_ACTION_PATH);
const names = ["patchSpecialZoneLegendFieldsState", "restoreSpecialZoneLegendSnapshotState"];
let inventoryPromise;
const inventory = () => inventoryPromise ||= (async () => {
  const discovery = await discoverStateWriterBindingsForSource(CSV_TARGET_ACTION_PATH, source, "production", { includeInventories: true });
  // Rescan only this module: integration may already have consumed its receipts.
  // The proof must still be tested against the real, unfiltered scanner evidence.
  return scanStateWriterBindingInventoriesBatch(source, CSV_TARGET_ACTION_PATH, discovery.bindings);
})();
const applyFilter = (row, overrides = {}) => filterStateCsvTargetEffectFindings({ relativePath: CSV_TARGET_ACTION_PATH,
  source, binding: row.binding, findings: row.findings, ...overrides });
const targets = rows => rows.filter(row => names.includes(row.binding.functionName));
const actions = { patch: (target, patch) => patchSpecialZoneLegendFieldsState(target, patch),
  restore: (target, patch) => restoreSpecialZoneLegendSnapshotState(target, JSON.stringify(patch)) };

test("CSV target receipt proves sixteen exact effects and two retained writes per target binding", () => {
  for (const value of [source, source.replaceAll("\n", "\r\n")]) {
    const result = inspectStateCsvTargetEffects({ source: value });
    assert.deepEqual(result.violations, []);
    assert.equal(result.receipt.sites.length, 16);
    assert.equal(result.receipt.writes.length, 2);
    assert.equal(result.receipt.bindings.length, 2);
    assert.equal(new Set(result.receipt.sites.map(site => `${site.line}:${site.column}`)).size, 16);
    assert.ok(result.receipt.sites.every(site => site.count === 1 && site.reason === "state-alias-escape"));
    assert.equal(result.receipt.detached, false);
    assert.equal(result.receipt.pure, false);
    assert.match(result.receipt.effects.layers, /borrowed/);
    assert.match(result.receipt.effects.reads, /getters, Proxy traps/);
    assert.match(result.receipt.effects.publication, /canonical dirty-state/);
    assert.throws(() => result.receipt.sites[0].aliasChain.push("forged"), TypeError);
    assert.throws(() => { result.receipt.effects.reads = "pure"; }, TypeError);
  }
});

test("CSV target real discovery to grants to action validation keeps canonical writes and consumes only exact effects", async () => {
  const rows = await inventory(), authorityIndex = buildCanonicalStateKeyAuthorityIndex();
  const writer = { path: CSV_TARGET_ACTION_PATH, authority: "domain-action", bindings: rows.map(row => {
    const filtered = applyFilter(row);
    if (names.includes(row.binding.functionName)) {
      assert.equal(row.findings.filter(finding => finding.unsupported).length, 16);
      assert.equal(filtered.length, 2);
      assert.deepEqual(filtered.map(finding => [finding.operation, finding.key]), [
        ["assign", "specialZoneLayers"], ["assign", "specialZonesOverlayDirty"],
      ]);
      assert.ok(filtered.every(finding => row.findings.includes(finding)));
      assert.equal(applyFilter(row, { findings: filtered }), filtered);
      assert.equal(applyFilter(row, { findings: [...filtered] }).length, 2);
    }
    return { ...row.binding, authority: "domain-action",
      grants: buildStateWriterBindingGrants(filtered, CSV_TARGET_ACTION_PATH, authorityIndex, "production") };
  }) };
  assert.deepEqual(validateStateActionPolicyBindings([writer], { modulePaths: [CSV_TARGET_ACTION_PATH],
    contractEntries: STATE_ACTION_DELEGATION_CONTRACT.filter(entry => entry.modulePath === CSV_TARGET_ACTION_PATH) }), []);
  for (const binding of writer.bindings.filter(binding => names.includes(binding.functionName))) {
    assert.deepEqual(binding.grants.flatMap(grant => grant.memberships).map(item => [item.operation, item.key]).sort(),
      [["assign", "specialZoneLayers"], ["assign", "specialZonesOverlayDirty"]].sort());
  }
});

const findingMutations = {
  "missing site": findings => findings.splice(0, 1),
  "duplicate site": findings => findings.push(structuredClone(findings[0])),
  "missing canonical write": findings => findings.splice(findings.findIndex(finding => !finding.unsupported), 1),
  "duplicate canonical write": findings => findings.push(structuredClone(findings.find(finding => !finding.unsupported))),
  "source fingerprint": findings => { findings[0].sourceFingerprint = "a".repeat(64); },
  "position": findings => { findings[0].column++; },
  "range": findings => { findings[0].end++; },
  "lexical scope": findings => { findings[0].enclosingFunctionIdentity = "{}"; },
  "reason": findings => { findings[0].reason = "unsupported-call-mutation"; },
  "operation": findings => { findings[0].operation = "assign"; },
  "key": findings => { findings[0].key = "width"; },
  "path": findings => { findings[0].pathSegments.push("width"); },
  "alias": findings => { findings[0].alias = "target"; },
  "alias chain": findings => { findings[0].aliasChain = ["target"]; },
  "root": findings => { findings[0].root = "other"; },
  "evidence": findings => { findings[0].evidenceKind = "unknown-call-argument"; },
  "dynamic flag": findings => { findings[0].dynamic = false; },
  "ambiguous flag": findings => { findings[0].ambiguous = true; },
  "binding identity": findings => { findings[0].bindingId = "forged"; },
  "new write": findings => findings.push({ ...structuredClone(findings.at(-1)), key: "width", pathSegments: ["width"] }),
  "new escape": findings => findings.push({ ...structuredClone(findings[0]), line: 1 }),
};
for (const [name, mutate] of Object.entries(findingMutations)) {
  test(`CSV target receipt refuses the complete inventory after ${name}`, async () => {
    for (const row of targets(await inventory())) {
      const findings = structuredClone(row.findings);
      mutate(findings);
      assert.equal(applyFilter(row, { findings }), findings);
    }
  });
}

test("CSV target receipt cannot apply to other roots, exports, authorities or historical scans", async () => {
  for (const row of targets(await inventory())) {
    for (const patch of [{ parameterIndex: 1 }, { parameterPath: "$/property:target" }, { parameterName: "other" },
      { name: "state" }, { kind: "module" }, { functionName: "other" }, { id: "forged" }, { authority: "legacy" }]) {
      assert.equal(applyFilter(row, { binding: { ...row.binding, ...patch } }), row.findings);
    }
    assert.equal(applyFilter(row, { relativePath: "js/other.js" }), row.findings);
    assert.equal(applyFilter(row, { enforceCurrentContracts: false }), row.findings);
    assert.equal(applyFilter(row, { source: undefined }), row.findings);
  }
});

const sourceDrifts = [
  ["const counts = new Map();", "const counts = target.sharedCounts;"],
  ["const layers = new Array(mapLength);", "const layers = inputLayers;"],
  ["const layers = new Array(mapLength);", "const layers = inputLayers.map(layer => layer);"],
  ["const updatedIds = [];", "const updatedIds = target.sharedIds;"],
  ['typeof layerId === "string" && layerId', "layerId"],
  ['typeof layerId !== "string" || !layerId ||', "!layerId ||"],
  ["Object.hasOwn(patchesById, layerId)", "Object.hasOwn(patchesById, layer.id)"],
  ["updatedIds.push(layerId)", "updatedIds.push(layer.id)"],
  ["target.specialZoneLayers = { ...current, layers };", "target.specialZoneLayers = { ...current, layers }; publishBorrowed(layers);"],
  ["const layer = inputLayers[index];", 'const layer = inputLayers[index]; layer.name = "unexpected";'],
  ["const counts = new Map();", "const counts = new Map(); target.width = 7;"],
  ["const counts = new Map();", "const counts = new Map(); patchesById.width = 7;"],
  ["JSON.parse(snapshotJson)", "JSON.parse(snapshotJson, replacementReviver)"],
];
for (const [before, after] of sourceDrifts) {
  test(`CSV target source proof rejects changed effect: ${after}`, async () => {
    assert.ok(source.includes(before));
    const changed = source.replace(before, after);
    assert.equal(inspectStateCsvTargetEffects({ source: changed }).receipt, null);
    for (const row of targets(await inventory())) assert.equal(applyFilter(row, { source: changed }), row.findings);
  });
}

test("CSV target receipts reject every pinned dependency drift and unavailable evidence", async () => {
  for (const dependency of ["js/core/legend_csv_schema.js", "js/core/history_manager.js", "js/core/legend_csv_import_transaction.js"]) {
    const readSource = path => read(path) + (path === dependency ? "\n// changed dependency" : "");
    const proof = inspectStateCsvTargetEffects({ source, readSource });
    assert.equal(proof.receipt, null);
    assert.ok(proof.violations.some(violation => violation.modulePath === dependency));
    for (const row of targets(await inventory())) assert.equal(applyFilter(row, { readSource }), row.findings);
  }
  assert.equal(inspectStateCsvTargetEffects({ source, readSource() { throw Error("unavailable"); } }).receipt, null);
});

test("CSV target proof preserves new callback writes and publications in real raw scanner evidence", async () => {
  const bindings = targets(await inventory()).map(row => row.binding);
  for (const [before, after, predicate] of [
    ["const counts = new Map();", "const counts = new Map(); target.width = 7;", finding => finding.operation === "assign" && finding.key === "width"],
    ["const layer = inputLayers[index];", 'const layer = inputLayers[index]; layer.name = "unexpected";', finding => finding.operation === "assign" && finding.alias === "layer"],
    ["const inputLayers = current.layers;", 'const inputLayers = current.layers; inputLayers.forEach(layer => { layer.name = "unexpected"; });', finding => finding.line === 469 && finding.reason === "unsupported-call-mutation"],
    ["const inputLayers = current.layers;", "const inputLayers = current.layers; publishBorrowed(inputLayers);", finding => finding.line === 469 && finding.unsupported && finding.evidenceKind === "unknown-call-argument"],
  ]) {
    const changed = source.replace(before, after);
    const rows = scanStateWriterBindingInventoriesBatch(changed, CSV_TARGET_ACTION_PATH, bindings);
    for (const row of rows) {
      assert.ok(row.findings.some(predicate));
      assert.equal(applyFilter(row, { source: changed }), row.findings);
    }
  }
  const inputWrite = source.replace("const counts = new Map();", "const counts = new Map(); patchesById.width = 7;");
  assert.ok((await validateStateActionNonTargetParameterMutations(CSV_TARGET_ACTION_PATH, inputWrite)).length);
});

for (const [mode, action] of Object.entries(actions)) {
  for (const hookKind of ["forEach", "map", "species"]) {
    test(`CSV ${mode} production action never dispatches borrowed-array ${hookKind} hooks`, () => {
      const target = {};
      let hooks = 0, layers;
      const hook = () => { hooks++; target.unauthorized = true; throw Error("borrowed-array hook"); };
      if (hookKind === "species") {
        class BorrowedLayers extends Array { static get [Symbol.species]() { return hook(); } }
        layers = new BorrowedLayers({ id: "zone", name: "before" });
      } else {
        layers = [{ id: "zone", name: "before" }];
        Object.defineProperty(layers, hookKind, { get: hook });
      }
      commitSpecialZoneLayersState(target, { layers }, {}, { preserveIdentity: true, markDirty: false });
      assert.equal(target.specialZoneLayers.layers, layers);
      assert.deepEqual(action(target, { zone: { name: "after" } }), ["zone"]);
      assert.equal(target.specialZoneLayers.layers[0].name, "after");
      assert.equal(Object.getPrototypeOf(target.specialZoneLayers.layers), Array.prototype);
      assert.equal(hooks, 0);
      assert.equal(target.unauthorized, undefined);
    });
  }

  for (const objectRead of [1, 2, 3, 6]) {
    test(`CSV ${mode} snapshots id before key conversion even when getter read ${objectRead} changes type`, () => {
      const target = {};
      let reads = 0, coercions = 0;
      const key = { [Symbol.toPrimitive]() { coercions++; target.unauthorized = true; return "zone"; } };
      const layer = { get id() { reads++; target.getterReads = reads; return reads === objectRead ? key : "zone"; }, name: "before" };
      target.specialZoneLayers = { layers: [layer] };
      const result = action(target, { zone: { name: "after" } });
      assert.equal(coercions, 0);
      assert.equal(target.unauthorized, undefined);
      assert.ok(target.getterReads >= 2, "getters are still reads with observable effects");
      assert.ok(result.every(id => typeof id === "string"));
      assert.deepEqual(result, objectRead < 3 ? [] : ["zone"]);
    });
  }

  test(`CSV ${mode} preserves sparse/inherited slots, duplicates and original borrowed references`, () => {
    const memberFeatureIds = ["feature"], metadata = { keep: true }, styleMetadata = { keep: true };
    const layer = { id: "zone", name: "before", memberFeatureIds, metadata, style: { unknown: styleMetadata } };
    const untouched = { id: "untouched", name: "stay" }, duplicate1 = { id: "duplicate", name: "one" }, duplicate2 = { id: "duplicate", name: "two" };
    const prototype = Object.create(Array.prototype); prototype[2] = untouched;
    const input = new Array(7); input[1] = layer; input[4] = duplicate1; input[5] = duplicate2;
    Object.setPrototypeOf(input, prototype);
    const containerMetadata = { borrowed: true }, target = { specialZoneLayers: { layers: input, containerMetadata } };
    assert.deepEqual(action(target, { zone: { name: "after", style: { fill: "#abcdef" } }, duplicate: { name: "ignored" } }), ["zone"]);
    const output = target.specialZoneLayers.layers;
    assert.equal(output.length, 7);
    for (const index of [0, 3, 6]) assert.equal(index in output, false);
    assert.equal(Object.hasOwn(output, 2), true);
    assert.equal(output[2], untouched);
    assert.equal(output[4], duplicate1);
    assert.equal(output[5], duplicate2);
    assert.notEqual(output[1], layer);
    assert.equal(output[1].memberFeatureIds, memberFeatureIds);
    assert.equal(output[1].metadata, metadata);
    assert.equal(output[1].style.unknown, styleMetadata);
    assert.equal(target.specialZoneLayers.containerMetadata, containerMetadata);
    assert.equal(layer.name, "before");
    output[1].memberFeatureIds.push("still-borrowed");
    assert.deepEqual(memberFeatureIds, ["feature", "still-borrowed"]);
  });

  test(`CSV ${mode} retains observable Proxy reads without invoking receiver methods`, () => {
    let reads = 0, hasChecks = 0;
    const input = new Proxy([{ id: "zone", name: "before" }], {
      get(target, key, receiver) {
        if (["map", "forEach", "constructor"].includes(key)) throw Error("receiver method read");
        reads++;
        return Reflect.get(target, key, receiver);
      },
      has(target, key) { hasChecks++; return Reflect.has(target, key); },
    });
    const target = { specialZoneLayers: { layers: input } };
    assert.deepEqual(action(target, { zone: { name: "after" } }), ["zone"]);
    assert.ok(reads > 0 && hasChecks > 0);
  });
}

test("CSV target restore retains raw presence and unknown metadata without normalizing the shared collection", () => {
  const unknown = { retained: true }, members = ["feature"];
  const target = { specialZoneLayers: { layers: [{ id: "zone", name: "later", memberFeatureIds: members,
    style: { fill: "#abcdef", unknown } }] } };
  const snapshot = { zone: { name: null, style: { fill: { raw: true } },
    presence: { name: true, style: true, styleObject: true, styleKeys: ["fill", "stroke"] } } };
  assert.deepEqual(restoreSpecialZoneLegendSnapshotState(target, JSON.stringify(snapshot)), ["zone"]);
  const layer = target.specialZoneLayers.layers[0];
  assert.equal(layer.name, null);
  assert.deepEqual(layer.style.fill, { raw: true });
  assert.equal(Object.hasOwn(layer.style, "stroke"), true);
  assert.equal(layer.style.stroke, undefined);
  assert.equal(layer.style.unknown, unknown);
  assert.equal(layer.memberFeatureIds, members);
});
