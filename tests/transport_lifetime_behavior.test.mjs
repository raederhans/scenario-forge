import test from "node:test";
import assert from "node:assert/strict";
import { createTransportWorkbenchLinePackRuntime } from "../js/ui/transport_workbench/transport_workbench_line_runtime_shared.js";

const tick = () => new Promise(setImmediate);
function createRuntime(getAsset) {
  return createTransportWorkbenchLinePackRuntime({
    familyId: "fixture", manifestUrl: "manifest.json",
    buildPack: async ({ mode, loadTransportAsset }) => ({ mode, value: await loadTransportAsset(`${mode}.json`) }),
  }, { getAsset, yieldTask: () => Promise.resolve() });
}

test("pack switch keeps the new generation and rejects old results", async () => {
  const held = Promise.withResolvers();
  let first = true;
  const runtime = createRuntime((path) => {
    if (path.endsWith("manifest.json")) return { paths: {} };
    if (first) { first = false; return held.promise; }
    return { newGeneration: true };
  });
  const old = runtime.loadPack(); await tick();
  runtime.setActivePack("new-country", "new-manifest.json");
  const current = await runtime.loadPack();
  held.resolve({ oldGeneration: true });
  assert.equal(await old, null);
  assert.equal(runtime.pickActivePack(), current);
  assert.equal(current.value.newGeneration, true);
  runtime.release();
});
