import test from "node:test";
import assert from "node:assert/strict";

import {
  clearRenderSamples,
  perfEnable,
  recordRenderSample,
  snapshot,
} from "../js/core/perf_probe.js";

test("snapshot metrics stay isolated from external nested mutations", () => {
  const originalBootMetrics = globalThis.__bootMetrics;
  const originalRenderPerfMetrics = globalThis.__renderPerfMetrics;
  const originalScenarioPerfMetrics = globalThis.__scenarioPerfMetrics;

  globalThis.__bootMetrics = {
    startup: {
      durationMs: 42,
      phases: {
        hydrate: 12,
      },
    },
  };
  globalThis.__renderPerfMetrics = {
    passA: {
      durationMs: 8,
      breakdown: {
        labels: 3,
      },
    },
  };
  globalThis.__scenarioPerfMetrics = {
    apply: {
      durationMs: 21,
      counters: {
        chunks: 4,
      },
    },
  };

  try {
    const firstSnapshot = snapshot();
    firstSnapshot.bootMetrics.startup.phases.hydrate = 999;
    firstSnapshot.renderPerfMetrics.passA.breakdown.labels = 777;
    firstSnapshot.scenarioPerfMetrics.apply.counters.chunks = 555;

    const secondSnapshot = snapshot();

    assert.equal(secondSnapshot.bootMetrics.startup.phases.hydrate, 12);
    assert.equal(secondSnapshot.renderPerfMetrics.passA.breakdown.labels, 3);
    assert.equal(secondSnapshot.scenarioPerfMetrics.apply.counters.chunks, 4);
  } finally {
    globalThis.__bootMetrics = originalBootMetrics;
    globalThis.__renderPerfMetrics = originalRenderPerfMetrics;
    globalThis.__scenarioPerfMetrics = originalScenarioPerfMetrics;
  }
});

test("snapshot returns safe empty metric objects when structuredClone is unavailable and globals are unset", () => {
  const originalStructuredClone = globalThis.structuredClone;
  const originalBootMetrics = globalThis.__bootMetrics;
  const originalRenderPerfMetrics = globalThis.__renderPerfMetrics;
  const originalScenarioPerfMetrics = globalThis.__scenarioPerfMetrics;

  globalThis.structuredClone = undefined;
  globalThis.__bootMetrics = undefined;
  globalThis.__renderPerfMetrics = undefined;
  globalThis.__scenarioPerfMetrics = undefined;

  try {
    const result = snapshot();
    assert.deepEqual(result.bootMetrics, {});
    assert.deepEqual(result.renderPerfMetrics, {});
    assert.deepEqual(result.scenarioPerfMetrics, {});
  } finally {
    globalThis.structuredClone = originalStructuredClone;
    globalThis.__bootMetrics = originalBootMetrics;
    globalThis.__renderPerfMetrics = originalRenderPerfMetrics;
    globalThis.__scenarioPerfMetrics = originalScenarioPerfMetrics;
  }
});

test("snapshot render sample median uses the mean of the two middle values for even counts", () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalLocation = globalThis.location;
  const originalBootMetrics = globalThis.__bootMetrics;
  const originalRenderPerfMetrics = globalThis.__renderPerfMetrics;
  const originalScenarioPerfMetrics = globalThis.__scenarioPerfMetrics;

  globalThis.localStorage = {
    getItem(key) {
      return key === "mc_perf_enabled" ? "1" : null;
    },
    setItem() {},
    removeItem() {},
  };
  globalThis.location = { search: "?perf=1" };
  globalThis.__bootMetrics = undefined;
  globalThis.__renderPerfMetrics = undefined;
  globalThis.__scenarioPerfMetrics = undefined;

  try {
    perfEnable();
    clearRenderSamples();
    recordRenderSample(10);
    recordRenderSample(20);
    recordRenderSample(30);
    recordRenderSample(40);

    const result = snapshot();
    assert.equal(result.renderSamples.count, 4);
    assert.equal(result.renderSamples.medianMs, 25);
  } finally {
    clearRenderSamples();
    globalThis.localStorage = originalLocalStorage;
    globalThis.location = originalLocation;
    globalThis.__bootMetrics = originalBootMetrics;
    globalThis.__renderPerfMetrics = originalRenderPerfMetrics;
    globalThis.__scenarioPerfMetrics = originalScenarioPerfMetrics;
  }
});
