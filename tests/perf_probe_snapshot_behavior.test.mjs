import test from "node:test";
import assert from "node:assert/strict";

import {
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
