import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRenderRequestBoundaryOwner } from "../js/core/map_renderer/render_request_boundary_owner.js";

function createHarness({
  requestResult = true,
  flushResult = true,
  hasContext = true,
} = {}) {
  const calls = [];
  const owner = createRenderRequestBoundaryOwner({
    effects: {
      requestRender: (reason) => {
        calls.push(`requestRender:${reason}`);
        return requestResult;
      },
      flushRenderBoundary: (reason) => {
        calls.push(`flushRenderBoundary:${reason}`);
        return flushResult;
      },
      render: () => {
        calls.push("render");
      },
    },
    getters: {
      hasInteractionRenderContext: () => {
        calls.push("hasInteractionRenderContext");
        return hasContext;
      },
    },
  });
  return { owner, calls };
}

test("requestRendererRenderBoundary returns a frozen default request summary", () => {
  const { owner, calls } = createHarness();

  const summary = owner.requestRendererRenderBoundary();

  assert.deepEqual(calls, ["requestRender:renderer"]);
  assert.deepEqual(summary, {
    reason: "renderer",
    options: { flush: false, interaction: false },
    requested: true,
    usedFallback: false,
    completed: true,
    effectOrder: ["requestRender"],
    getterOrder: [],
  });
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.options), true);
  assert.equal(Object.isFrozen(summary.effectOrder), true);
  assert.equal(Object.isFrozen(summary.getterOrder), true);
});

test("requestRendererRenderBoundary uses flush effect when requested", () => {
  const { owner, calls } = createHarness({ requestResult: false });

  const summary = owner.requestRendererRenderBoundary("exact", { flush: true });

  assert.deepEqual(calls, ["flushRenderBoundary:exact"]);
  assert.deepEqual(summary.effectOrder, ["flushRenderBoundary"]);
  assert.equal(summary.requested, true);
  assert.equal(summary.completed, true);
});

test("requestRendererRenderBoundary preserves fallback completion after request miss", () => {
  const { owner, calls } = createHarness({ requestResult: false });

  const summary = owner.requestRendererRenderBoundary("late-frame", {
    fallback: (...args) => {
      assert.equal(args.length, 0);
      calls.push("customFallback");
    },
  });

  assert.deepEqual(calls, ["requestRender:late-frame", "customFallback"]);
  assert.deepEqual(summary.effectOrder, ["requestRender", "fallback"]);
  assert.equal(summary.requested, false);
  assert.equal(summary.usedFallback, true);
  assert.equal(summary.completed, true);
});

test("requestRendererRenderBoundary reports incomplete when request and fallback are absent", () => {
  const { owner, calls } = createHarness({ requestResult: false });

  const summary = owner.requestRendererRenderBoundary("no-boundary");

  assert.deepEqual(calls, ["requestRender:no-boundary"]);
  assert.equal(summary.requested, false);
  assert.equal(summary.usedFallback, false);
  assert.equal(summary.completed, false);
});

test("requestInteractionRenderBoundary keeps request then context render fallback order", () => {
  const { owner, calls } = createHarness({ requestResult: false, hasContext: true });

  const summary = owner.requestInteractionRenderBoundary("interaction-drag");

  assert.deepEqual(calls, [
    "requestRender:interaction-drag",
    "hasInteractionRenderContext",
    "render",
  ]);
  assert.deepEqual(summary.options, { flush: false, interaction: true });
  assert.deepEqual(summary.effectOrder, ["requestRender", "fallback", "render"]);
  assert.deepEqual(summary.getterOrder, ["hasInteractionRenderContext"]);
  assert.equal(summary.completed, true);
});

test("requestInteractionRenderBoundary keeps fallback completion without context render", () => {
  const { owner, calls } = createHarness({ requestResult: false, hasContext: false });

  const summary = owner.requestInteractionRenderBoundary("interaction-hover");

  assert.deepEqual(calls, [
    "requestRender:interaction-hover",
    "hasInteractionRenderContext",
  ]);
  assert.deepEqual(summary.effectOrder, ["requestRender", "fallback"]);
  assert.deepEqual(summary.getterOrder, ["hasInteractionRenderContext"]);
  assert.equal(summary.usedFallback, true);
  assert.equal(summary.completed, true);
});

test("flushInteractionRenderBoundary uses flush boundary effect only", () => {
  const { owner, calls } = createHarness({ flushResult: false });

  const summary = owner.flushInteractionRenderBoundary("interaction-flush");

  assert.deepEqual(calls, ["flushRenderBoundary:interaction-flush"]);
  assert.deepEqual(summary.options, { flush: true, interaction: true });
  assert.deepEqual(summary.effectOrder, ["flushRenderBoundary"]);
  assert.equal(summary.completed, false);
});

test("createRenderRequestBoundaryOwner fails fast for missing dependencies", () => {
  assert.throws(
    () => createRenderRequestBoundaryOwner({
      effects: {
        requestRender() {},
        flushRenderBoundary() {},
      },
      getters: {
        hasInteractionRenderContext() {},
      },
    }),
    /effects\.render must be a function/,
  );
  assert.throws(
    () => createRenderRequestBoundaryOwner({
      effects: {
        requestRender() {},
        flushRenderBoundary() {},
        render() {},
      },
      getters: {},
    }),
    /getters\.hasInteractionRenderContext must be a function/,
  );
});

