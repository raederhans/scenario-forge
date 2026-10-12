import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  STATE_TARGET_PURE_READER_CONTRACT,
  inspectStateTargetPureReaderFunctionSource,
} from "../tools/state_action_delegation_contract.mjs";
import {
  discoverStateWriterBindingsForSource,
  shouldRetainScannedWriterCandidate,
} from "../tools/build_state_writer_policy.mjs";

const readerPath = "js/ui/toolbar/quick_fill_level_controls.js";
const workspacePath = "js/ui/toolbar/workspace_chrome_support_surface_controller.js";
const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readerSource = readSource(readerPath);
const entries = STATE_TARGET_PURE_READER_CONTRACT.filter((entry) => entry.modulePath === readerPath);
const discoveryOptions = {
  scanAllParameters: true,
  derivedAliasTaintMode: "strict",
  includeInventories: true,
};

test("quick-fill reader proofs keep the retired workspace state binding retired", async () => {
  assert.deepEqual(entries.map((entry) => entry.functionName), ["getQuickFillUiCountry", "getQuickFillLevelModel"]);
  assert.deepEqual(entries.map((entry) => entry.conservativeFindings.reduce((sum, finding) => sum + finding.count, 0)), [2, 3]);
  for (const entry of entries) {
    assert.deepEqual(entry.acceptedEscapes, []);
    assert.deepEqual(inspectStateTargetPureReaderFunctionSource(readerSource, entry).violations, []);
  }
  const headPolicy = JSON.parse(execFileSync("git", ["show", "HEAD:tools/state_writer_policy.json"], {
    cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  }));
  // Retired writers may have no remaining policy entry. Preserve that exact
  // HEAD state as null instead of fabricating a binding to carry forward.
  const previousWriter = headPolicy.writers.find((writer) => writer.path === workspacePath) || null;
  const workspace = await discoverStateWriterBindingsForSource(workspacePath, readSource(workspacePath), "production", {
    ...discoveryOptions, previousWriter,
  });
  // Discovery retains default-named state candidates. Empty findings prevent
  // policy construction from reviving their retired legacy mutation binding.
  const stateInventory = workspace.bindingInventories.find((inventory) =>
    inventory.binding.functionName === "createWorkspaceChromeSupportSurfaceController"
    && inventory.binding.parameterName === "state");
  assert.ok(stateInventory);
  assert.deepEqual(stateInventory.findings, []);
  assert.equal(shouldRetainScannedWriterCandidate({
    relativePath: workspacePath, surface: "production", ...stateInventory,
  }), false);
  assert.equal(workspace.bindingInventories.flatMap((inventory) => inventory.findings).length, 0);
  const reader = await discoverStateWriterBindingsForSource(readerPath, readerSource, "production", discoveryOptions);
  assert.equal(reader.bindings.some((binding) => entries.some((entry) => binding.functionName === entry.functionName
    && binding.parameterName === entry.targetParameterName)), false);
  assert.equal(reader.bindingInventories.flatMap((inventory) => inventory.findings)
    .some((finding) => finding.root === "state"), false);
});

test("quick-fill exact proofs reject drift, target writes and live-reference results", async () => {
  const cases = [
    ["scalar source drift", 'const zh = String(state.currentLanguage || "en").startsWith("zh");',
      'const zh = String(state.currentLanguage || "en").startsWith("zh-CN");', "state-target-pure-reader-source-drift"],
    ["target assignment", "export function getQuickFillLevelModel(state) {",
      "export function getQuickFillLevelModel(state) {\n  state.batchFillScope = 'country';", "state-target-pure-reader-mutation"],
    ["Map write", "state.landIndex?.get(hit.id)", "state.landIndex?.set(hit.id, {})", "state-target-pure-reader-mutation"],
    ["country reader publishes a live hit", "return selected || geographical;",
      "return state.devSelectedHit;", "state-target-pure-reader-conservative-finding-unregistered"],
    ["model publishes hierarchy", "return { countryCode, selected, options, explicitLevel:",
      "return { hierarchy: state.hierarchyData, countryCode, selected, options, explicitLevel:", "state-target-pure-reader-conservative-finding-unregistered"],
  ];
  for (const [label, marker, replacement, expectedCode] of cases) {
    assert.ok(readerSource.includes(marker), label);
    const changed = readerSource.replace(marker, replacement);
    await assert.rejects(() => discoverStateWriterBindingsForSource(readerPath, changed, "production", discoveryOptions),
      (error) => error.code === "state-target-pure-reader-contract-violation"
        && error.violations.some((violation) => violation.code === expectedCode), label);
  }
});

test("quick-fill dependency receipts reject changed identity, hierarchy and private-cache helpers", () => {
  for (const entry of entries) {
    for (const dependencyPath of Object.keys(entry.dependencyFingerprints)) {
      const result = inspectStateTargetPureReaderFunctionSource(readerSource, entry, {
        readSource: (path) => path === dependencyPath ? `${readSource(path)}\n// changed dependency\n` : readSource(path),
      });
      assert.ok(result.violations.some((violation) => violation.code === "state-target-pure-reader-dependency-source-drift"
        && violation.dependencyName === dependencyPath), `${entry.functionName}: ${dependencyPath}`);
    }
    assert.deepEqual(inspectStateTargetPureReaderFunctionSource(readerSource.replace(/\r\n?/g, "\n"), entry, {
      readSource: (path) => readSource(path).replace(/\r\n?/g, "\n"),
    }).violations, [], "Line-ending normalization preserves the reviewed receipt");
  }
  const model = entries.find((entry) => entry.functionName === "getQuickFillLevelModel");
  const changedLocal = readerSource.replace("return selected || geographical;", "return state.devSelectedHit;");
  assert.ok(inspectStateTargetPureReaderFunctionSource(changedLocal, model).violations.some((violation) =>
    violation.code === "state-target-pure-reader-dependency-source-drift" && violation.dependencyName === "getQuickFillUiCountry"));
});
