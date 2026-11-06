import assert from "node:assert/strict";
import test from "node:test";

import { commitRenderPerfMetricState } from "../js/core/state/actions/renderer_diagnostics_actions.js";
import "../js/core/map_renderer.js";
import { state as runtimeState } from "../js/core/state.js";

const mirrorAccessor = Object.getOwnPropertyDescriptor(globalThis, "__renderPerfMetrics");

test("metric mirror exposes live state and assignment replaces the accessor", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "__renderPerfMetrics");
  const originalMetrics = runtimeState.renderPerfMetrics;
  try {
    Object.defineProperty(globalThis, "__renderPerfMetrics", mirrorAccessor);
    runtimeState.renderPerfMetrics = undefined;
    assert.deepEqual(globalThis.__renderPerfMetrics, {});

    const metrics = { first: { durationMs: 3 } };
    runtimeState.renderPerfMetrics = metrics;
    assert.equal(globalThis.__renderPerfMetrics, metrics);
    metrics.second = { durationMs: 5 };
    assert.equal(globalThis.__renderPerfMetrics.second, metrics.second);

    const injected = { injected: { durationMs: 7 } };
    globalThis.__renderPerfMetrics = injected;
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "__renderPerfMetrics"), {
      configurable: true,
      enumerable: true,
      writable: true,
      value: injected,
    });
    assert.equal(globalThis.__renderPerfMetrics, injected);
    assert.equal(runtimeState.renderPerfMetrics, metrics);
  } finally {
    runtimeState.renderPerfMetrics = originalMetrics;
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "__renderPerfMetrics", originalDescriptor);
    } else {
      delete globalThis.__renderPerfMetrics;
    }
  }
});

test("consecutive metric commits retain both entries and advance the sequence", () => {
  const state = {};
  const first = { durationMs: 3, sequence: 1 };
  const second = { durationMs: 5, sequence: 2 };

  assert.equal(commitRenderPerfMetricState(state, {
    name: "first", entry: first, sequence: 1,
  }), 1);
  assert.equal(state.renderPerfMetricSequence, 1);
  assert.equal(commitRenderPerfMetricState(state, {
    name: "second", entry: second, sequence: 2,
  }), 2);
  assert.deepEqual(state.renderPerfMetrics, { first, second });
  assert.equal(state.renderPerfMetrics.first, first);
  assert.equal(state.renderPerfMetrics.second, second);
  assert.equal(state.renderPerfMetricSequence, 2);
});

test("non-writable metrics reject commits without advancing the sequence", () => {
  const original = { durationMs: 3 };
  const state = { renderPerfMetrics: {}, renderPerfMetricSequence: 1 };
  Object.defineProperty(state.renderPerfMetrics, "first", {
    value: original, writable: false,
  });

  assert.throws(() => commitRenderPerfMetricState(state, {
    name: "first", entry: { durationMs: 5 }, sequence: 2,
  }), /renderPerfMetrics\.first must be writable/);
  assert.equal(state.renderPerfMetrics.first, original);
  assert.equal(state.renderPerfMetricSequence, 1);
});

test("non-writable sequence rejects commits before changing metrics", () => {
  const state = { renderPerfMetrics: {} };
  Object.defineProperty(state, "renderPerfMetricSequence", { value: 1, writable: false });

  assert.throws(() => commitRenderPerfMetricState(state, {
    name: "first", entry: { durationMs: 3 }, sequence: 2,
  }), /renderPerfMetricSequence must be writable/);
  assert.deepEqual(state.renderPerfMetrics, {});
  assert.equal(state.renderPerfMetricSequence, 1);
});
