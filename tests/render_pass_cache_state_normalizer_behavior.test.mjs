import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRenderPassCacheState,
} from "../js/core/renderer/render_pass_cache_state_normalizer.js";

function createDefaults() {
  return {
    compositeBuffer: { canvas: null },
    borderSnapshot: { canvas: null, valid: false, reason: "init" },
    lastGoodFrame: { capturedAt: 0, metadata: null },
    interactionComposite: { capturedAt: 0 },
    partialPoliticalDirtyIds: new Set(),
    politicalPathCache: new Map(),
    politicalPathCacheTransform: null,
    politicalPathWarmupQueue: [],
    politicalPathWarmupHandle: null,
    dirty: { background: true },
    reasons: { background: "init" },
    counters: { frames: 0 },
    lastAction: "",
    lastActionDurationMs: 0,
    perfOverlayEnabled: false,
  };
}

function deepFreeze(value, visited = new Set()) {
  if (!value || typeof value !== "object" || visited.has(value)) return value;
  visited.add(value);
  if (value instanceof Map) {
    for (const [key, entryValue] of value) {
      deepFreeze(key, visited);
      deepFreeze(entryValue, visited);
    }
  } else if (value instanceof Set) {
    for (const entryValue of value) deepFreeze(entryValue, visited);
  }
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(value[key], visited);
  }
  return Object.freeze(value);
}

test("normalized fast path preserves identity and performs zero transform clones", () => {
  const defaults = createDefaults();
  const cache = createDefaults();
  cache.politicalPathCacheTransform = { x: 4, y: 5, k: 2 };
  const cacheSnapshot = structuredClone(cache);
  const defaultsSnapshot = structuredClone(defaults);
  deepFreeze(cache);
  deepFreeze(defaults);
  let cloneCalls = 0;

  const normalized = normalizeRenderPassCacheState(cache, {
    defaults,
    renderPassNames: ["background"],
    cloneZoomTransform(value) {
      cloneCalls += 1;
      return { ...value };
    },
  });

  assert.equal(normalized, cache);
  assert.equal(cloneCalls, 0);
  assert.deepEqual(cache, cacheSnapshot);
  assert.deepEqual(defaults, defaultsSnapshot);
});

test("malformed partial cache yields a detached repaired holder", () => {
  const defaults = createDefaults();
  const customOpaqueValue = { owner: "custom" };
  const original = {
    customField: customOpaqueValue,
    compositeBuffer: { customCanvasState: "kept" },
    borderSnapshot: { reason: "custom-reason" },
    lastGoodFrame: { capturedAt: "7", customFrameState: true },
    interactionComposite: { capturedAt: "8" },
    partialPoliticalDirtyIds: "malformed",
    politicalPathCache: new Map([["A", 1]]),
    politicalPathCacheTransform: { x: 1, y: 2, k: 3 },
    politicalPathWarmupQueue: [],
    politicalPathWarmupHandle: null,
    dirty: { political: false },
    reasons: { political: "custom" },
    counters: { frames: "3", customCounter: 9 },
    lastAction: "draw",
    lastActionDurationMs: "4.5",
    perfOverlayEnabled: false,
  };
  const originalSnapshot = structuredClone(original);
  const defaultsSnapshot = structuredClone(defaults);
  deepFreeze(original);
  deepFreeze(defaults);

  const repaired = normalizeRenderPassCacheState(original, {
    defaults,
    renderPassNames: ["background", "political"],
    cloneZoomTransform: (value) => ({ ...value }),
  });

  assert.notEqual(repaired, original);
  assert.equal(repaired.customField, customOpaqueValue);
  assert.equal(repaired.compositeBuffer.customCanvasState, "kept");
  assert.equal(repaired.compositeBuffer.canvas, null);
  assert.equal(repaired.borderSnapshot.reason, "custom-reason");
  assert.equal(repaired.borderSnapshot.canvas, null);
  assert.equal(repaired.borderSnapshot.valid, false);
  assert.equal(repaired.lastGoodFrame.capturedAt, 7);
  assert.equal(repaired.lastGoodFrame.customFrameState, true);
  assert.equal(repaired.interactionComposite.capturedAt, 8);
  assert.equal(repaired.counters.frames, 3);
  assert.equal(repaired.counters.customCounter, 9);
  assert.equal(repaired.dirty.background, true);
  assert.equal(repaired.dirty.political, false);
  assert.equal(repaired.reasons.background, "init");
  assert.equal(repaired.reasons.political, "custom");
  assert.ok(repaired.partialPoliticalDirtyIds instanceof Set);
  assert.equal(repaired.politicalPathCache, original.politicalPathCache);
  assert.notEqual(repaired.compositeBuffer, original.compositeBuffer);
  assert.notEqual(repaired.borderSnapshot, original.borderSnapshot);
  assert.notEqual(repaired.lastGoodFrame, original.lastGoodFrame);
  assert.notEqual(repaired.interactionComposite, original.interactionComposite);
  assert.notEqual(repaired.dirty, original.dirty);
  assert.notEqual(repaired.reasons, original.reasons);
  assert.notEqual(repaired.counters, original.counters);
  assert.notEqual(repaired.politicalPathCacheTransform, original.politicalPathCacheTransform);
  assert.deepEqual(original, originalSnapshot);
  assert.deepEqual(defaults, defaultsSnapshot);
});

test("initialization detaches mutable defaults", () => {
  const defaults = createDefaults();
  const initialized = normalizeRenderPassCacheState(null, {
    defaults,
    renderPassNames: ["background"],
  });

  assert.notEqual(initialized, defaults);
  assert.notEqual(initialized.dirty, defaults.dirty);
  assert.notEqual(initialized.reasons, defaults.reasons);
  assert.notEqual(initialized.counters, defaults.counters);
  assert.notEqual(initialized.partialPoliticalDirtyIds, defaults.partialPoliticalDirtyIds);
  assert.notEqual(initialized.politicalPathCache, defaults.politicalPathCache);
  assert.notEqual(initialized.politicalPathWarmupQueue, defaults.politicalPathWarmupQueue);
});

test("inherited cache fields are repaired into isolated own state", () => {
  const defaults = createDefaults();
  const inherited = createDefaults();
  inherited.dirty.background = false;
  inherited.reasons.background = "shared-prototype";
  inherited.politicalPathCache.set("shared", 1);
  const cache = Object.create(inherited);

  const repaired = normalizeRenderPassCacheState(cache, {
    defaults,
    renderPassNames: ["background"],
  });

  assert.notEqual(repaired, cache);
  assert.equal(Object.hasOwn(repaired, "dirty"), true);
  assert.equal(Object.hasOwn(repaired, "reasons"), true);
  assert.equal(Object.hasOwn(repaired, "politicalPathCache"), true);
  assert.notEqual(repaired.dirty, inherited.dirty);
  assert.notEqual(repaired.reasons, inherited.reasons);
  assert.notEqual(repaired.politicalPathCache, inherited.politicalPathCache);
  assert.equal(repaired.dirty.background, true);
  assert.equal(repaired.reasons.background, "init");
  assert.equal(repaired.politicalPathCache.size, 0);

  repaired.dirty.background = false;
  repaired.politicalPathCache.set("isolated", 2);
  assert.equal(inherited.dirty.background, false);
  assert.deepEqual([...inherited.politicalPathCache], [["shared", 1]]);
});

test("normalizer validates preparation options", () => {
  assert.throws(
    () => normalizeRenderPassCacheState({}, { defaults: [] }),
    /defaults must be an object/,
  );
  assert.throws(
    () => normalizeRenderPassCacheState({}, { cloneZoomTransform: null }),
    /cloneZoomTransform must be a function/,
  );
  assert.throws(
    () => normalizeRenderPassCacheState({}, { renderPassNames: "background" }),
    /renderPassNames must be an array/,
  );
});
