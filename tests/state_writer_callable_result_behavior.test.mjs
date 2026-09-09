import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverFunctionParameterBindings,
  scanStateMutationInventory,
} from "../tools/state_writer_inventory.mjs";

function scanLoaderResult(resultExpression, helper = "", {
  iife = false, bodyPrelude = "",
} = {}) {
  const source = `
import { completeScenarioChunkLoadState } from "../state/actions/scenario_chunk_runtime_actions.js";
export function createLoader({ runtimeState, fetchPayload }) {
  ${helper}
  async function entries(chunks) {
    return Promise.all(chunks.map(async (chunk) => ({
      chunkId: chunk.id,
      payload: await loadPayload(chunk),
    })));
  }
  async function loadPayload(chunk) {
    ${iife ? "const loadPromise = (async () => {" : ""}
    ${bodyPrelude}
    const generation = Math.max(0, Number(runtimeState.runtimeChunkLoadState?.generation || 0));
    const payload = await fetchPayload(chunk);
    completeScenarioChunkLoadState(runtimeState, String(chunk.id), { expectedLoadStateGeneration: generation });
    return ${resultExpression};
    ${iife ? "})(); return loadPromise;" : ""}
  }
  return Object.freeze({ loadPayload, entries });
}
`;
  const candidate = discoverFunctionParameterBindings(source, { parameterNames: null })
    .bindings.find((binding) => binding.functionName === "createLoader"
      && binding.parameterName === "runtimeState");
  assert.ok(candidate);
  const inventory = scanStateMutationInventory(source, {
    filePath: "js/core/scenario/chunk_payload_loader.js",
    derivedAliasTaintMode: "strict",
    bindings: [{
      id: "parameter:createLoader:runtimeState",
      kind: "function-parameter",
      name: candidate.parameterName,
      functionName: candidate.functionName,
      parameterName: candidate.parameterName,
      parameterIndex: candidate.parameterIndex,
      parameterPath: candidate.parameterPath,
      locator: { line: candidate.line, column: candidate.column },
    }],
  });
  assert.ok(inventory.actionDelegations.some((edge) =>
    edge.actionExportName === "completeScenarioChunkLoadState"));
  return inventory.findings;
}

test("stateful loader action capture does not taint its external payload result", () => {
  assert.deepEqual(scanLoaderResult("payload"), []);
});

test("stateful async IIFE action capture does not taint its external payload result", () => {
  assert.deepEqual(scanLoaderResult("payload", "", { iife: true }), []);
});

for (const [label, expression, helper, bodyPrelude = ""] of [
  ["direct state", "runtimeState", ""],
  ["borrowed state field", "runtimeState.activeScenarioChunks", ""],
  ["local helper state result", "readState()", "function readState() { return runtimeState; }"],
  ["local state alias", "alias", "", "const alias = runtimeState;"],
  ["local borrowed field alias", "alias", "", "const alias = runtimeState.activeScenarioChunks;"],
]) {
  test(`stateful loader returning ${label} retains an escape finding`, () => {
    assert.ok(scanLoaderResult(expression, helper, { bodyPrelude }).some((finding) =>
      finding.reason === "state-alias-escape" && finding.evidenceKind === "return-value"
      && finding.enclosingFunctionIdentity.includes(`"name":"${helper ? "readState" : "loadPayload"}"`)));
  });
  test(`stateful async IIFE returning ${label} retains an escape finding`, () => {
    assert.ok(scanLoaderResult(expression, helper, { iife: true, bodyPrelude }).some((finding) =>
      finding.reason === "state-alias-escape" && finding.evidenceKind === "return-value"
      && finding.enclosingFunctionIdentity.includes(`"name":"${helper ? "readState" : "loadPayload"}"`)));
  });
}
