import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createTransformedFrameCompositorOwner } from "../js/core/map_renderer/transformed_frame_compositor_owner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const OWNER_PATH = path.join(
  REPO_ROOT,
  "js",
  "core",
  "map_renderer",
  "transformed_frame_compositor_owner.js",
);

function createBufferContext(calls) {
  return {
    setTransform(...values) {
      calls.push(["buffer.setTransform", ...values]);
    },
    translate(...values) {
      calls.push(["buffer.translate", ...values]);
    },
    scale(...values) {
      calls.push(["buffer.scale", ...values]);
    },
  };
}

test("interaction label replay failure never blits a partially composed buffer", () => {
  const f = createHarness({ effects: { drawInteractionLabels: () => false } });
  assert.equal(f.owner.composeTransformedFrameToBuffer(f.runtime.currentTransform, []), false);
  assert.ok(!f.calls.some(([name]) => name === "blitCompositeBufferToMain"));
  assert.ok(!f.calls.some(([name, pass]) => name === "drawTransformedPass" && pass === "labels"));
});

test("direct interaction composition uses the same enabled pass subset", () => {
  const f = createHarness({ getters: { getActiveInteractionCompositePassNames: () => ["base"] } });
  f.owner.composeTransformedFrameToBuffer(f.runtime.currentTransform, [], { useInteractionComposite: false });
  assert.deepEqual(f.calls.find(([name]) => name === "composeRenderPassesToTarget")[2], ["base"]);
});

function createHarness(overrides = {}) {
  const calls = [];
  const metrics = [];
  const counters = [];
  const runtimeSnapshot = {
    currentTransform: { x: 12, y: 18, k: 2 },
    renderPhase: "idle",
    deferExactAfterSettle: false,
    activeScenarioId: "tno_1962",
    pendingExactPoliticalFastFrame: false,
    zoomGestureScaleDelta: 0.25,
    zoomGestureEndedAt: 1234,
    dpr: 2,
  };
  const cache = {
    dirty: {},
    interactionComposite: {
      rejectedReason: "",
    },
  };
  const behavior = {
    activePassNames: ["base", "political", "context", "labels"],
    drawablePasses: new Map(),
    drawPassResults: new Map(),
    interactionCompositeResult: true,
    interactionPassComposeResult: { ok: true },
    borderSnapshotResult: true,
    interactionReuseDecision: { ok: true, mode: "strict", reason: "" },
    buildInteractionCompositeResult: false,
    canDrawInteractionCompositeResult: true,
    bufferContextAvailable: true,
    nowValues: [100, 106, 112, 118],
  };
  const bufferContext = createBufferContext(calls);
  const bufferCanvas = {
    id: "composite-buffer",
    width: 1600,
    height: 900,
    getContext(kind) {
      calls.push(["buffer.getContext", kind]);
      return behavior.bufferContextAvailable ? bufferContext : null;
    },
  };

  const dependencies = {
    constants: {
      interactionCompositePassNames: ["base", "political"],
      renderPhaseIdle: "idle",
      renderPhaseInteracting: "interacting",
      renderPhaseSettling: "settling",
    },
    getters: {
      getCurrentTransform: () => runtimeSnapshot.currentTransform,
      getRenderPassCacheSnapshot: () => cache,
      getActiveTransformedFramePassNames: () => behavior.activePassNames,
      getRenderPhase: () => runtimeSnapshot.renderPhase,
      getDeferExactAfterSettle: () => runtimeSnapshot.deferExactAfterSettle,
      getActiveScenarioId: () => runtimeSnapshot.activeScenarioId,
      getPendingExactPoliticalFastFrame: () => runtimeSnapshot.pendingExactPoliticalFastFrame,
      getZoomGestureScaleDelta: () => runtimeSnapshot.zoomGestureScaleDelta,
      getZoomGestureEndedAt: () => runtimeSnapshot.zoomGestureEndedAt,
      getDpr: () => runtimeSnapshot.dpr,

    },
    helpers: {
      nowMs: () => behavior.nowValues.shift() ?? 120,
      canDrawTransformedPass: (passName, snapshot, options) => {
        calls.push(["canDrawTransformedPass", passName, snapshot === cache, options?.allowDirty === true]);
        if (behavior.drawablePasses.has(passName)) return behavior.drawablePasses.get(passName);
        return true;
      },
      getInteractionCompositeReuseDecision: (transform, snapshot, options) => {
        calls.push([
          "getInteractionCompositeReuseDecision",
          transform,
          snapshot === cache,
          options?.allowSelectionTopologyContinuity === true,
        ]);
        return behavior.interactionReuseDecision;
      },
    },
    effects: {
      ensureCompositeBufferCanvas: () => {
        calls.push(["ensureCompositeBufferCanvas"]);
        return bufferCanvas;
      },
      resetCanvasContext: (context, width, height) => {
        calls.push(["resetCanvasContext", context === bufferContext, width, height]);
      },
      withRenderTarget: (context, callback) => {
        calls.push(["withRenderTarget.enter", context === bufferContext]);
        callback();
        calls.push(["withRenderTarget.exit"]);
      },
      drawInteractionComposite: (transform, options) => {
        calls.push([
          "drawInteractionComposite",
          transform,
          options?.allowSelectionTopologyContinuity === true,
        ]);
        return behavior.interactionCompositeResult;
      },
      composeRenderPassesToTarget: (context, passNames, transform, options) => {
        calls.push([
          "composeRenderPassesToTarget",
          context === bufferContext,
          passNames,
          transform,
          options,
        ]);
        return behavior.interactionPassComposeResult;
      },
      drawTransformedPass: (passName, transform) => {
        calls.push(["drawTransformedPass", passName, transform]);
        if (behavior.drawPassResults.has(passName)) return behavior.drawPassResults.get(passName);
        return true;
      },
      drawInteractionBorderSnapshot: (transform) => {
        calls.push(["drawInteractionBorderSnapshot", transform]);
        return behavior.borderSnapshotResult;
      },
      drawBordersPass: (scale, options) => {
        calls.push(["drawBordersPass", scale, options]);
      },
      blitCompositeBufferToMain: (canvas) => {
        calls.push(["blitCompositeBufferToMain", canvas === bufferCanvas]);
      },
      resetMainCanvas: () => {
        calls.push(["resetMainCanvas"]);
      },
      setInteractionCompositeRejectedReason: (reason) => {
        calls.push(["setInteractionCompositeRejectedReason", reason]);
        cache.interactionComposite.rejectedReason = reason;
      },
      invalidateInteractionComposite: (reason) => {
        calls.push(["invalidateInteractionComposite", reason]);
      },
      buildInteractionComposite: (transform, timings) => {
        calls.push(["buildInteractionComposite", transform, timings]);
        return behavior.buildInteractionCompositeResult;
      },
      canDrawInteractionComposite: (transform, snapshot) => {
        calls.push(["canDrawInteractionComposite", transform, snapshot === cache]);
        return behavior.canDrawInteractionCompositeResult;
      },
      setPendingExactPoliticalFastFrame: (value) => {
        calls.push(["setPendingExactPoliticalFastFrame", value]);
        runtimeSnapshot.pendingExactPoliticalFastFrame = value;
      },
      recordRenderPerfMetric: (name, durationMs, details) => {
        calls.push(["recordRenderPerfMetric", name, durationMs, details]);
        metrics.push({ name, durationMs, details });
      },
      recordPassTiming: (timings, name, startedAt) => {
        calls.push(["recordPassTiming", name, startedAt]);
        timings[name] = 7;
      },
      incrementPerfCounter: (name) => {
        calls.push(["incrementPerfCounter", name]);
        counters.push(name);
      },
    },
  };

  for (const namespace of ["constants", "getters", "helpers", "effects"]) {
    Object.assign(dependencies[namespace], overrides[namespace] || {});
  }

  return {
    owner: createTransformedFrameCompositorOwner(dependencies),
    calls,
    metrics,
    counters,
    runtime: runtimeSnapshot,
    cache,
    behavior,
    bufferCanvas,
    bufferContext,
  };
}

function callNames(harness) {
  return harness.calls.map(([name]) => name);
}

test("factory validates its bounded dependencies and freezes the API", () => {
  const harness = createHarness();
  assert.equal(Object.isFrozen(harness.owner), true);
  assert.deepEqual(Object.keys(harness.owner), [
    "composeTransformedFrameToBuffer",
    "drawTransformedFrameFromCaches",
  ]);

  for (const [namespace, name] of [
    ["getters", "getCurrentTransform"],
    ["getters", "getRenderPassCacheSnapshot"],
    ["getters", "getActiveTransformedFramePassNames"],
    ["getters", "getRenderPhase"],
    ["getters", "getDeferExactAfterSettle"],
    ["getters", "getActiveScenarioId"],
    ["getters", "getPendingExactPoliticalFastFrame"],
    ["getters", "getZoomGestureScaleDelta"],
    ["getters", "getZoomGestureEndedAt"],
    ["getters", "getDpr"],
    ["helpers", "nowMs"],
    ["helpers", "canDrawTransformedPass"],
    ["helpers", "getInteractionCompositeReuseDecision"],
    ["effects", "ensureCompositeBufferCanvas"],
    ["effects", "resetCanvasContext"],
    ["effects", "withRenderTarget"],
    ["effects", "drawInteractionComposite"],
    ["effects", "composeRenderPassesToTarget"],
    ["effects", "drawTransformedPass"],
    ["effects", "drawInteractionBorderSnapshot"],
    ["effects", "drawBordersPass"],
    ["effects", "blitCompositeBufferToMain"],
    ["effects", "setInteractionCompositeRejectedReason"],
    ["effects", "invalidateInteractionComposite"],
    ["effects", "buildInteractionComposite"],
    ["effects", "canDrawInteractionComposite"],
    ["effects", "setPendingExactPoliticalFastFrame"],
    ["effects", "recordRenderPerfMetric"],
    ["effects", "recordPassTiming"],
    ["effects", "incrementPerfCounter"],
  ]) {
    assert.throws(
      () => createHarness({ [namespace]: { [name]: null } }),
      new RegExp(`${namespace}\\.${name} must be a function`),
    );
  }

  assert.throws(
    () => createHarness({ constants: { interactionCompositePassNames: [] } }),
    /constants\.interactionCompositePassNames must be a non-empty array/,
  );
  assert.throws(
    () => createHarness({ constants: { renderPhaseIdle: "" } }),
    /constants\.renderPhaseIdle must be a non-empty string/,
  );
});

test("buffer composition keeps target scope, border fallback math, labels-last, and post-scope blit", () => {
  const harness = createHarness();
  harness.behavior.borderSnapshotResult = false;

  assert.equal(
    harness.owner.composeTransformedFrameToBuffer(
      harness.runtime.currentTransform,
      ["context", "effects"],
      { interactiveBorders: true },
    ),
    true,
  );

  assert.deepEqual(callNames(harness), [
    "ensureCompositeBufferCanvas",
    "buffer.getContext",
    "resetCanvasContext",
    "withRenderTarget.enter",
    "drawInteractionComposite",
    "drawTransformedPass",
    "drawTransformedPass",
    "drawInteractionBorderSnapshot",
    "buffer.setTransform",
    "buffer.translate",
    "buffer.scale",
    "drawBordersPass",
    "buffer.setTransform",
    "drawTransformedPass",
    "withRenderTarget.exit",
    "blitCompositeBufferToMain",
  ]);
  assert.deepEqual(harness.calls[8], ["buffer.setTransform", 2, 0, 0, 2, 0, 0]);
  assert.deepEqual(harness.calls[9], ["buffer.translate", 12, 18]);
  assert.deepEqual(harness.calls[10], ["buffer.scale", 2, 2]);
  assert.deepEqual(harness.calls[11], ["drawBordersPass", 2, { interactive: true }]);
  assert.deepEqual(harness.calls[13], ["drawTransformedPass", "labels", harness.runtime.currentTransform]);
});

test("successful border snapshot skips fallback and still draws labels before blit", () => {
  const harness = createHarness();

  assert.equal(
    harness.owner.composeTransformedFrameToBuffer(
      harness.runtime.currentTransform,
      ["context", "effects"],
      { interactiveBorders: true },
    ),
    true,
  );

  assert.deepEqual(callNames(harness), [
    "ensureCompositeBufferCanvas",
    "buffer.getContext",
    "resetCanvasContext",
    "withRenderTarget.enter",
    "drawInteractionComposite",
    "drawTransformedPass",
    "drawTransformedPass",
    "drawInteractionBorderSnapshot",
    "drawTransformedPass",
    "withRenderTarget.exit",
    "blitCompositeBufferToMain",
  ]);
  assert.equal(callNames(harness).includes("drawBordersPass"), false);
  assert.deepEqual(harness.calls[8], ["drawTransformedPass", "labels", harness.runtime.currentTransform]);
});

test("buffer composition supports direct interaction passes and fails before blit", () => {
  const harness = createHarness();
  harness.behavior.interactionPassComposeResult = { ok: false, reason: "missing-pass-canvas" };

  assert.equal(
    harness.owner.composeTransformedFrameToBuffer(
      harness.runtime.currentTransform,
      ["context"],
      { useInteractionComposite: false },
    ),
    false,
  );

  assert.equal(callNames(harness).includes("drawInteractionComposite"), false);
  assert.equal(callNames(harness).includes("drawTransformedPass"), false);
  assert.equal(callNames(harness).includes("blitCompositeBufferToMain"), false);
  assert.throws(
    () => harness.owner.composeTransformedFrameToBuffer(harness.runtime.currentTransform, [], null),
    TypeError,
  );
});

test("buffer composition stops when the composite canvas has no 2D context", () => {
  const harness = createHarness();
  harness.behavior.bufferContextAvailable = false;

  assert.equal(
    harness.owner.composeTransformedFrameToBuffer(
      harness.runtime.currentTransform,
      ["context"],
    ),
    false,
  );
  assert.deepEqual(callNames(harness), ["ensureCompositeBufferCanvas", "buffer.getContext"]);
});

test("transformed preflight failure preserves the visible canvas", () => {
  const harness = createHarness();
  harness.behavior.drawablePasses.set("political", false);

  assert.equal(harness.owner.drawTransformedFrameFromCaches({}), false);
  assert.equal(callNames(harness).includes("resetMainCanvas"), false);
  assert.equal(callNames(harness).includes("drawTransformedPass"), false);
  assert.deepEqual(harness.counters, []);
});

test("rejected reuse writes the reason before invalidation and permits a copy-only composite build during input", () => {
  const harness = createHarness();
  harness.runtime.renderPhase = "interacting";
  harness.behavior.interactionReuseDecision = {
    ok: false,
    mode: "reject",
    reason: "selection-version-mismatch",
  };

  assert.equal(harness.owner.drawTransformedFrameFromCaches({}), false);
  const names = callNames(harness);
  assert.ok(
    names.indexOf("setInteractionCompositeRejectedReason")
      < names.indexOf("invalidateInteractionComposite"),
  );
  assert.equal(names.includes("buildInteractionComposite"), true);
  assert.equal(harness.metrics.at(-1).name, "interactionCompositeUnavailable");
  assert.equal(harness.metrics.at(-1).details.deferredBuild, false);
});

test("invalid reuse reason is recorded without redundant invalidation", () => {
  const harness = createHarness();
  harness.behavior.interactionReuseDecision = { ok: false, mode: "reject", reason: "invalid" };

  assert.equal(harness.owner.drawTransformedFrameFromCaches({}), false);
  assert.equal(harness.cache.interactionComposite.rejectedReason, "invalid");
  assert.equal(callNames(harness).includes("invalidateInteractionComposite"), false);
});

test("successful composite build still requires a drawable interaction composite", () => {
  const harness = createHarness();
  harness.behavior.interactionReuseDecision = { ok: false, mode: "reject", reason: "expired" };
  harness.behavior.buildInteractionCompositeResult = true;
  harness.behavior.canDrawInteractionCompositeResult = false;

  assert.equal(harness.owner.drawTransformedFrameFromCaches({}), false);
  assert.equal(callNames(harness).includes("buildInteractionComposite"), true);
  assert.equal(callNames(harness).includes("canDrawInteractionComposite"), true);
  assert.equal(callNames(harness).includes("ensureCompositeBufferCanvas"), false);
});

test("dirty settling path keeps continuity options, root-owned writes, timings, and metric order", () => {
  const harness = createHarness();
  harness.runtime.renderPhase = "settling";
  harness.runtime.deferExactAfterSettle = true;
  harness.runtime.pendingExactPoliticalFastFrame = true;
  harness.cache.dirty = { base: true, political: false, context: true, labels: false };
  harness.behavior.interactionReuseDecision = {
    ok: false,
    mode: "continuity",
    reason: "selection-version-mismatch",
  };
  harness.behavior.buildInteractionCompositeResult = false;
  const timings = { contextBase: 3, contextScenario: 4 };

  assert.equal(harness.owner.drawTransformedFrameFromCaches(timings, { interactiveBorders: true }), true);
  assert.equal(harness.runtime.pendingExactPoliticalFastFrame, false);
  assert.equal(timings.usedDirtyInteractionPasses, true);
  assert.equal(timings.usedDirtyFastFramePasses, "base,context");
  assert.equal(timings.context, 7);
  assert.equal(harness.counters.includes("transformedFrames"), true);
  assert.equal(harness.metrics.some(({ name }) => name === "settlePoliticalFastExactSkipped"), true);
  assert.equal(harness.metrics.some(({ name }) => name === "dirtyInteractionPassFastFrame"), true);
  assert.equal(harness.metrics.some(({ name }) => name === "settleFastFrame"), true);
  const composeCall = harness.calls.find(([name]) => name === "composeRenderPassesToTarget");
  assert.equal(composeCall?.[4]?.requireAllPasses, true);
  const orderedIndexes = [
    harness.calls.findIndex(([name]) => name === "setPendingExactPoliticalFastFrame"),
    harness.calls.findIndex(([name, metric]) => (
      name === "recordRenderPerfMetric" && metric === "settlePoliticalFastExactSkipped"
    )),
    harness.calls.findIndex(([name, metric]) => (
      name === "recordRenderPerfMetric" && metric === "dirtyInteractionPassFastFrame"
    )),
    harness.calls.findIndex(([name]) => name === "composeRenderPassesToTarget"),
    harness.calls.findIndex(([name, timing]) => (
      name === "recordPassTiming" && timing === "interactiveComposite"
    )),
    harness.calls.findIndex(([name, counter]) => (
      name === "incrementPerfCounter" && counter === "transformedFrames"
    )),
    harness.calls.findIndex(([name, metric]) => (
      name === "recordRenderPerfMetric" && metric === "settleFastFrame"
    )),
  ];
  assert.equal(orderedIndexes.every((index) => index >= 0), true);
  assert.deepEqual(orderedIndexes, orderedIndexes.slice().sort((left, right) => left - right));
});

test("idle deferred exact mode admits dirty cached passes", () => {
  const harness = createHarness();
  harness.runtime.renderPhase = "idle";
  harness.runtime.deferExactAfterSettle = true;
  harness.cache.dirty.context = true;
  const timings = {};

  assert.equal(harness.owner.drawTransformedFrameFromCaches(timings), true);
  assert.equal(timings.usedDirtyFastFramePasses, "context");
  const contextPreflight = harness.calls.find((entry) => (
    entry[0] === "canDrawTransformedPass" && entry[1] === "context"
  ));
  assert.equal(contextPreflight?.[3], true);
  assert.equal(harness.metrics.some(({ name }) => name === "settleFastFrame"), true);
});

test("post-effect settle metrics use the current render phase", () => {
  const harness = createHarness({
    effects: {
      buildInteractionComposite: () => {
        harness.runtime.renderPhase = "idle";
        harness.runtime.deferExactAfterSettle = false;
        return true;
      },
    },
  });
  harness.runtime.renderPhase = "settling";
  harness.behavior.interactionReuseDecision = { ok: false, mode: "reject", reason: "invalid" };

  assert.equal(harness.owner.drawTransformedFrameFromCaches({}), true);
  assert.equal(harness.metrics.some(({ name }) => name === "settleFastFrame"), false);
});

test("strict reuse skips build, verifies the composite, and reports buffer failure", () => {
  const harness = createHarness();
  harness.behavior.interactionReuseDecision = { ok: true, mode: "strict", reason: "" };
  harness.behavior.interactionCompositeResult = false;

  assert.equal(harness.owner.drawTransformedFrameFromCaches({}), false);
  assert.equal(callNames(harness).includes("buildInteractionComposite"), false);
  assert.equal(callNames(harness).includes("canDrawInteractionComposite"), false);
  assert.equal(harness.metrics.at(-1).name, "transformedFrameBufferComposeFailure");
});

test("owner source stays import-free and avoids global state, DOM, and generic dispatch layers", () => {
  const source = fs.readFileSync(OWNER_PATH, "utf8");
  assert.doesNotMatch(source, /^\s*import\s/m);
  for (const token of [
    "map_renderer.js",
    "RendererRuntimeContext",
    "runtimeState",
    "globalThis",
    "document",
    "window",
    "runGetter",
    "runEffect",
    "createTrace",
  ]) {
    assert.equal(source.includes(token), false, token);
  }
});
