import test from "node:test";
import assert from "node:assert/strict";
import { createPhysicalViewportCacheOwner } from "../js/core/renderer/physical_viewport_cache_owner.js";

test("a source change prevents pending work for the same viewport from publishing", async () => {
  let snapshot = { key: "a", sourceKey: "source", layout: { pixelWidth: 20, pixelHeight: 10 },
    reference: { x: 1, y: 2, k: 2.5 } };
  const cache = { dirty: { physicalBase: true }, canvases: {} };
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const owner = createPhysicalViewportCacheOwner({
    readSnapshot: () => snapshot, readCache: () => cache,
    createCanvas: () => ({ getContext: () => ({}) }),
    yieldControl: () => gate, draw() {},
  });
  const pending = owner.prepare();
  snapshot = { ...snapshot, sourceKey: "new-source" };
  owner.prepare();
  finish();
  await pending;
  assert.equal(owner.takeReady(), null);
  await owner.prepare();
  assert.equal(owner.takeReady().sourceKey, "new-source");
});
