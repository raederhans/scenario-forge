import assert from "node:assert/strict";
import test from "node:test";

import { createRenderPassCacheHostOwner } from "../js/core/map_renderer/render_pass_cache_host_owner.js";

function createOwner({
  canvasContext = {},
  layout = { width: 100, height: 80 },
  prepareK = 2,
  events = [],
} = {}) {
  const canvas = {
    getContext(type) {
      events.push(`getContext:${type}`);
      return canvasContext;
    },
  };
  const owner = createRenderPassCacheHostOwner({
    effects: {
      ensureRenderPassCanvas(passName) {
        events.push(`ensure:${passName}`);
        return canvas;
      },
      prepareTargetContext(passContext, transform, passLayout) {
        events.push(`prepare:${passContext === canvasContext}:${transform?.k}:${passLayout === layout}`);
        return prepareK;
      },
      withRenderTarget(passContext, callback) {
        events.push(`with:start:${passContext === canvasContext}`);
        const result = callback();
        events.push("with:end");
        return result;
      },
    },
    getters: {
      getRenderPassLayout(passName) {
        events.push(`layout:${passName}`);
        return layout;
      },
    },
  });

  return { owner, events };
}

test("skips without a pass canvas before context layout or draw", () => {
  const owner = createRenderPassCacheHostOwner({
    effects: {
      ensureRenderPassCanvas: () => null,
      prepareTargetContext: () => {
        throw new Error("prepareTargetContext must not run");
      },
      withRenderTarget: () => {
        throw new Error("withRenderTarget must not run");
      },
    },
    getters: {
      getRenderPassLayout: () => {
        throw new Error("getRenderPassLayout must not run");
      },
    },
  });
  let drawCount = 0;

  const summary = owner.prepareRenderPassHost({
    passName: "political",
    transform: { k: 1 },
    drawFn: () => {
      drawCount += 1;
    },
  });

  assert.deepEqual(summary, {
    passName: "political",
    k: null,
    hasPassCanvas: false,
    hasPassContext: false,
    drawInvoked: false,
    drawResult: undefined,
    skipped: true,
    skipReason: "missing-pass-canvas",
    effectOrder: ["ensureRenderPassCanvas"],
    getterOrder: [],
  });
  assert.equal(drawCount, 0);
});

test("skips without a 2d context before layout or draw", () => {
  const events = [];
  const owner = createRenderPassCacheHostOwner({
    effects: {
      ensureRenderPassCanvas: () => ({
        getContext(type) {
          events.push(`getContext:${type}`);
          return null;
        },
      }),
      prepareTargetContext: () => {
        throw new Error("prepareTargetContext must not run");
      },
      withRenderTarget: () => {
        throw new Error("withRenderTarget must not run");
      },
    },
    getters: {
      getRenderPassLayout: () => {
        throw new Error("getRenderPassLayout must not run");
      },
    },
  });

  const summary = owner.prepareRenderPassHost({
    passName: "contextBase",
    transform: { k: 1 },
    drawFn: () => {
      throw new Error("drawFn must not run");
    },
  });

  assert.equal(summary.skipped, true);
  assert.equal(summary.skipReason, "missing-pass-context");
  assert.equal(summary.hasPassCanvas, true);
  assert.equal(summary.hasPassContext, false);
  assert.equal(summary.drawInvoked, false);
  assert.deepEqual(summary.effectOrder, ["ensureRenderPassCanvas", "getContext2D"]);
  assert.deepEqual(summary.getterOrder, []);
  assert.deepEqual(events, ["getContext:2d"]);
});

test("prepares target inside render target and returns draw result unchanged", () => {
  const drawResult = { committed: true, politicalDataStage: "fine" };
  const { owner, events } = createOwner({ prepareK: 3.5 });

  const summary = owner.prepareRenderPassHost({
    passName: "political",
    transform: { k: 1.5 },
    onHostReady: () => {
      events.push("ready");
    },
    drawFn: (k) => {
      events.push(`draw:${k}`);
      return drawResult;
    },
  });

  assert.equal(summary.passName, "political");
  assert.equal(summary.k, 3.5);
  assert.equal(summary.hasPassCanvas, true);
  assert.equal(summary.hasPassContext, true);
  assert.equal(summary.drawInvoked, true);
  assert.equal(summary.drawResult, drawResult);
  assert.equal(summary.skipped, false);
  assert.deepEqual(summary.effectOrder, [
    "ensureRenderPassCanvas",
    "getContext2D",
    "onHostReady",
    "withRenderTarget",
    "prepareTargetContext",
    "drawFn",
  ]);
  assert.deepEqual(summary.getterOrder, ["getRenderPassLayout"]);
  assert.deepEqual(events, [
    "ensure:political",
    "getContext:2d",
    "ready",
    "layout:political",
    "with:start:true",
    "prepare:true:1.5:true",
    "draw:3.5",
    "with:end",
  ]);
});

test("requires declared dependencies and draw callback", () => {
  assert.throws(
    () => createRenderPassCacheHostOwner({
      effects: {
        ensureRenderPassCanvas: () => ({}),
        withRenderTarget: () => {},
      },
      getters: {
        getRenderPassLayout: () => ({}),
      },
    }),
    /effects\.prepareTargetContext must be a function/,
  );

  const { owner } = createOwner();
  assert.throws(
    () => owner.prepareRenderPassHost({ passName: "political", drawFn: null }),
    /drawFn must be a function/,
  );
});

test("freezes returned summary and trace arrays", () => {
  const { owner } = createOwner();

  const summary = owner.prepareRenderPassHost({
    passName: "contextScenario",
    transform: { k: 2 },
    drawFn: () => undefined,
  });

  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.effectOrder), true);
  assert.equal(Object.isFrozen(summary.getterOrder), true);
});

test("direct host avoids allocation and native continuation retains full host semantics", () => {
  const events = [];
  const context = { canvas: { width: 400, height: 200 } };
  const owner = createRenderPassCacheHostOwner({ effects: {
    ensureRenderPassCanvas: () => { events.push("allocate"); return { getContext: () => context }; },
    prepareTargetContext: () => { events.push("prepare"); return 3; },
    withRenderTarget: (_context, draw) => { events.push("enter"); try { return draw(); } finally { events.push("restore"); } },
  }, getters: { getRenderPassLayout: () => ({ pixelWidth: 400, pixelHeight: 200 }) } });
  const direct = { staged: true };
  const args = { passName: "political", transform: { k: 3 }, drawFn: () => assert.fail("ordinary draw") };
  const result = owner.prepareRenderPassHost({ ...args, drawWithoutCanvas: () => direct });
  assert.equal(result.hasPassCanvas, false);
  assert.equal(result.drawResult, direct);
  assert.deepEqual(events, []);
  const fallback = owner.prepareRenderPassHost({ ...args, drawWithoutCanvas: runNative => runNative(k => ({ k })) });
  assert.equal(fallback.hasPassCanvas, true);
  assert.deepEqual(fallback.drawResult, { k: 3 });
  assert.deepEqual(events, ["allocate", "enter", "prepare", "restore"]);
  events.length = 0;
  assert.throws(() => owner.prepareRenderPassHost({ ...args,
    drawWithoutCanvas: runNative => runNative(() => { throw new Error("paint failed"); }) }), /paint failed/);
  assert.equal(events.at(-1), "restore");
});
