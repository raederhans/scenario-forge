import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "acorn";
import {
  STATE_TARGET_PURE_READER_CONTRACT,
  inspectStateTargetPureReaderFunctionSource,
} from "../tools/state_action_delegation_contract.mjs";
import {
  discoverStateWriterBindingsForSource,
  scanStateWriterBindingInventoriesBatch,
} from "../tools/build_state_writer_policy.mjs";

const modulePath = "js/ui/toolbar/export_workbench_controller.js";
const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const source = readSource(modulePath);
const entry = STATE_TARGET_PURE_READER_CONTRACT.find((candidate) => candidate.modulePath === modulePath
  && candidate.functionName === "getExportPreviewSourceKey");
const declaration = (text, name) => parse(text, { ecmaVersion: "latest", sourceType: "module" }).body
  .map((statement) => statement.declaration || statement)
  .find((node) => node.type === "FunctionDeclaration" && node.id.name === name);
const replaceReader = (transform) => {
  const node = declaration(source, entry.functionName);
  return source.slice(0, node.start) + transform(source.slice(node.start, node.end)) + source.slice(node.end);
};
const options = { scanAllParameters: true, derivedAliasTaintMode: "strict", includeInventories: true };

test("self-module receipts bind the supplied source, preserve line endings and require no reader", () => {
  assert.ok(entry);
  assert.deepEqual(entry.acceptedEscapes, []);
  assert.equal(entry.conservativeFindings.reduce((sum, finding) => sum + finding.count, 0), 19);
  assert.deepEqual(inspectStateTargetPureReaderFunctionSource(source, entry).violations, []);
  const unavailableReader = () => assert.fail("A self-module proof must use the supplied source");
  assert.deepEqual(inspectStateTargetPureReaderFunctionSource(source, entry, { readSource: unavailableReader }).violations, []);
  assert.deepEqual(inspectStateTargetPureReaderFunctionSource(source.replace(/\r\n?/g, "\n"), entry, {
    readSource: unavailableReader,
  }).violations, []);
  for (const [marker, replacement] of [
    ['name: "Background"', 'name: "Changed background"'],
    ["EXPORT_MAIN_LAYER_VIEW_MODELS.map((layer) => layer.id)", "EXPORT_MAIN_LAYER_VIEW_MODELS.map((layer) => layer.name)"],
    ["const EXPORT_MAIN_LAYER_MODEL_BY_ID = new Map", "const EXPORT_MAIN_LAYER_MODEL_BY_ID = new EvilMap"],
  ]) {
    assert.ok(source.includes(marker));
    const changed = source.replace(marker, replacement);
    const violations = inspectStateTargetPureReaderFunctionSource(changed, entry, {
      // Reproduce the former gap: the reader supplies the original source.
      readSource: () => source,
    }).violations;
    assert.ok(violations.some((violation) => violation.code === "state-target-pure-reader-dependency-source-drift"
      && violation.dependencyName === modulePath), marker);
  }
});

test("external dependency receipts still use the reader and reject drift", () => {
  const quickFillPath = "js/ui/toolbar/quick_fill_level_controls.js";
  const quickFillEntry = STATE_TARGET_PURE_READER_CONTRACT.find((candidate) => candidate.modulePath === quickFillPath
    && candidate.functionName === "getQuickFillLevelModel");
  const reads = [];
  const result = inspectStateTargetPureReaderFunctionSource(readSource(quickFillPath), quickFillEntry, {
    readSource: (path) => {
      reads.push(path);
      return `${readSource(path)}\n// changed external dependency\n`;
    },
  });
  assert.deepEqual(reads.sort(), Object.keys(quickFillEntry.dependencyFingerprints).sort());
  for (const path of reads) assert.ok(result.violations.some((violation) =>
    violation.code === "state-target-pure-reader-dependency-source-drift" && violation.dependencyName === path));
});

test("preview key serializes borrowed inputs and returns null while unsettled", () => {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const constants = ["EXPORT_MAIN_LAYER_VIEW_MODELS", "EXPORT_MAIN_LAYER_IDS", "EXPORT_MAIN_LAYER_MODEL_BY_ID"];
  const functions = [...Object.keys(entry.localFunctionFingerprints), entry.functionName];
  const nodes = ast.body.filter((node) => node.type === "VariableDeclaration"
    && constants.includes(node.declarations[0].id.name)
    || node.type === "FunctionDeclaration" && functions.includes(node.id.name));
  const read = new Function(`${nodes.map((node) => source.slice(node.start, node.end)).join("\n")}\nreturn getExportPreviewSourceKey;`)();
  const state = {
    renderPassCache: { dirty: { background: false }, signatures: { background: "ready" }, referenceTransforms: { background: { k: 1 } } },
    renderPhase: "idle", styleConfig: { ocean: { color: "blue" } }, zoomTransform: { k: 1, x: 0, y: 0 },
  };
  const ui = { previewMode: "main", layerOrder: ["background"], visibility: {
    background: true, political: false, context: false, effects: false, labels: false,
  }, textVisibility: { "render-labels": true } };
  const before = structuredClone({ state, ui });
  const key = read(state, ui, ["background"], "<svg />");
  assert.equal(typeof key, "string");
  assert.ok(JSON.parse(key).some((value) => value === "<svg />"));
  assert.deepEqual({ state, ui }, before);
  state.styleConfig.ocean.color = "red";
  assert.notEqual(read(state, ui, ["background"], "<svg />"), key);
  state.renderPassCache.dirty.background = true;
  assert.equal(read(state, ui, ["background"]), null);
});

test("strict discovery rejects source drift, writes, unknown calls, live returns and local dependency changes", async () => {
  const cases = [
    ["source drift", replaceReader((text) => text.replace('"idle"', '"settled"')), "state-target-pure-reader-source-drift"],
    ["target write", replaceReader((text) => text.replace("  const cache =", "  state.colorRevision = 99;\n  const cache =")), "state-target-pure-reader-mutation"],
    ["unknown call", replaceReader((text) => text.replace("  const cache =", "  unknownReader(state.renderPassCache);\n  const cache =")), "state-target-pure-reader-conservative-finding-unregistered"],
    ["live return", replaceReader((text) => text.replace("return JSON.stringify([", "return [").replace("  ]);", "  ];")), "state-target-pure-reader-conservative-finding-unregistered"],
    ["local helper drift", source.replace("const deduped = Array.from(new Set(selectedPasses));", "const deduped = Array.from(selectedPasses);"), "state-target-pure-reader-dependency-source-drift"],
    ["constant drift", source.replace("const EXPORT_MAIN_LAYER_MODEL_BY_ID = new Map", "const EXPORT_MAIN_LAYER_MODEL_BY_ID = new EvilMap"), "state-target-pure-reader-dependency-source-drift"],
  ];
  for (const [label, changed, code] of cases) {
    assert.notEqual(changed, source, label);
    await assert.rejects(() => discoverStateWriterBindingsForSource(modulePath, changed, "production", options),
      (error) => error.code === "state-target-pure-reader-contract-violation"
        && error.violations.some((violation) => violation.code === code), label);
  }
});

test("scoped strict discovery removes only the preview reader binding and retains caller findings and actions", async () => {
  const policy = JSON.parse(execFileSync("git", ["show", "HEAD:tools/state_writer_policy.json"], {
    cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  }));
  const result = await discoverStateWriterBindingsForSource(modulePath, source, "production", {
    ...options, previousWriter: policy.writers.find((writer) => writer.path === modulePath) || null,
  });
  assert.equal(result.bindings.some((binding) => binding.functionName === entry.functionName), false);
  const controller = result.bindingInventories.find((inventory) => inventory.binding.functionName === "createExportWorkbenchController");
  assert.equal(controller.findings.length, 30);
  // A private reader receipt retires its own binding. Existing local-call
  // traversal still reports its conservative reads under the caller binding.
  assert.equal(controller.findings.filter((finding) => finding.enclosingFunctionIdentity
    .includes('"name":"getExportPreviewSourceKey"')).length, 19);
  assert.equal(result.bindingInventories.flatMap((inventory) => inventory.findings).length, 31);
  const rawInventories = scanStateWriterBindingInventoriesBatch(source, modulePath, result.bindings, "strict");
  for (const raw of rawInventories) {
    const current = result.bindingInventories.find((inventory) => inventory.binding.id === raw.binding.id);
    assert.deepEqual(current.findings, raw.findings);
    assert.deepEqual(current.actionDelegations, raw.actionDelegations);
  }
});
