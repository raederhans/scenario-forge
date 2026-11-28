import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  RELEASE_SMOKE_PHASES,
  EXPECTED_PUBLIC_SAMPLE_PROJECT_IDS,
  tagReleaseSmokeError,
  isRetryableSameOriginModulePropagationFailure,
  isRetryablePublicPagesShellPropagationStall,
  shouldRetryReleaseSmokeAttempt,
  getReleaseSmokeRetryDecision,
  validateReleaseSmokeSampleManifest,
  runReleaseSmokePreflight,
} = require("./e2e/support/release-smoke.js");

function sampleManifest(overrides = {}) {
  return {
    version: 1,
    public_scenario_ids: [
      "blank_base",
      "modern_world",
      "hoi4_1936",
      "hoi4_1939",
      "tno_1962",
    ],
    developer_preview_exclusions: ["hgo_1936"],
    sample_projects: EXPECTED_PUBLIC_SAMPLE_PROJECT_IDS.map((id) => ({ id })),
    ...overrides,
  };
}

function fakeResponse({
  status = 200,
  contentType = "text/html",
  text = "<!DOCTYPE html><html><body>ok</body></html>",
  json = null,
} = {}) {
  return {
    status: () => status,
    ok: () => status >= 200 && status < 300,
    headers: () => ({ "content-type": contentType }),
    text: async () => text,
    json: async () => (typeof json === "function" ? json() : json),
  };
}

function fakeRequest(responseByPath) {
  return {
    get: async (url) => {
      const path = String(url).replace(/^https:\/\/example\.test\//, "");
      const response = responseByPath[path];
      if (!response) {
        throw new Error(`missing fake response for ${path}`);
      }
      return response;
    },
  };
}

function publicUrl(path) {
  return `https://example.test/${path}`;
}

test("release smoke retries first-attempt shell readiness and scenario apply phases", () => {
  const shellError = tagReleaseSmokeError(
    new Error("[playwright-app] waitForShellReady timed out after 120000ms"),
    RELEASE_SMOKE_PHASES.SHELL_READY,
  );
  const scenarioApplyError = tagReleaseSmokeError(
    new Error("[playwright-app] waitForScenarioApplyIdle timed out after 120000ms"),
    RELEASE_SMOKE_PHASES.SCENARIO_APPLY,
  );

  assert.equal(shouldRetryReleaseSmokeAttempt({ error: shellError, attempt: 1 }), true);
  assert.equal(shouldRetryReleaseSmokeAttempt({ error: scenarioApplyError, attempt: 1 }), true);
  assert.equal(getReleaseSmokeRetryDecision({ error: shellError, attempt: 1 }).shouldRetry, true);
});

test("release smoke retry budget stops after one retryable failure", () => {
  const shellError = tagReleaseSmokeError(
    new Error("[playwright-app] waitForShellReady timed out after 120000ms"),
    RELEASE_SMOKE_PHASES.SHELL_READY,
  );

  assert.equal(shouldRetryReleaseSmokeAttempt({ error: shellError, attempt: 2 }), false);
  assert.equal(getReleaseSmokeRetryDecision({ error: shellError, attempt: 2 }).shouldRetry, false);
});

test("release smoke retries one same-origin dynamic module propagation failure", () => {
  const moduleFailure = tagReleaseSmokeError(
    new Error("[playwright-app] waitForShellReady timed out", {
      cause: new Error(
        "bootError=Failed to fetch dynamically imported module: "
        + "https://example.test/scenario-forge/app/js/ui/toolbar.js",
      ),
    }),
    RELEASE_SMOKE_PHASES.SHELL_READY,
  );

  assert.equal(isRetryableSameOriginModulePropagationFailure(moduleFailure, {
    publicBaseUrl: "https://example.test/scenario-forge/",
  }), true);
  assert.equal(getReleaseSmokeRetryDecision({ error: moduleFailure, attempt: 1 }).shouldRetry, true);
});

test("release smoke keeps cross-origin and non-JavaScript module failures final", () => {
  for (const moduleUrl of [
    "https://cdn.example.test/scenario-forge/app/js/ui/toolbar.js",
    "https://example.test/scenario-forge/app/js/ui/toolbar.css",
  ]) {
    const moduleFailure = tagReleaseSmokeError(
      new Error(`Failed to fetch dynamically imported module: ${moduleUrl}`),
      RELEASE_SMOKE_PHASES.SHELL_READY,
    );
    assert.equal(isRetryableSameOriginModulePropagationFailure(moduleFailure, {
      publicBaseUrl: "https://example.test/scenario-forge/",
    }), false);
  }
});

test("release smoke retries the observed GitHub Pages shell propagation stall", () => {
  const shellStall = tagReleaseSmokeError(
    new Error(
      '[playwright-app] waitForShellReady timed out after 120000ms. Snapshot: '
      + '{"boot":{"bootPhase":"shell","bootBlocking":true,"bodyAppBooting":true,'
      + '"overlayHidden":false,"bootError":""}}',
    ),
    RELEASE_SMOKE_PHASES.SHELL_READY,
  );

  assert.equal(isRetryablePublicPagesShellPropagationStall(shellStall, {
    publicBaseUrl: "https://raederhans.github.io/scenario-forge/",
  }), true);
  assert.equal(isRetryablePublicPagesShellPropagationStall(shellStall, {
    publicBaseUrl: "https://example.test/scenario-forge/",
  }), false);
});

test("release smoke does not classify shell stalls with a boot error as propagation stalls", () => {
  const bootFailure = tagReleaseSmokeError(
    new Error(
      '[playwright-app] waitForShellReady timed out after 120000ms. Snapshot: '
      + '{"boot":{"bootPhase":"shell","bootBlocking":true,"bodyAppBooting":true,'
      + '"overlayHidden":false,"bootError":"initialization failed"}}',
    ),
    RELEASE_SMOKE_PHASES.SHELL_READY,
  );

  assert.equal(isRetryablePublicPagesShellPropagationStall(bootFailure, {
    publicBaseUrl: "https://raederhans.github.io/scenario-forge/",
  }), false);
});

test("release smoke preflight treats entrypoint fetch and status failures as retryable", async () => {
  const request = fakeRequest({
    "": fakeResponse(),
    "assets/sample-runs.json": fakeResponse({
      status: 503,
      contentType: "application/json",
      json: sampleManifest(),
    }),
    "app/": fakeResponse(),
  });

  await assert.rejects(
    () => runReleaseSmokePreflight({ request, publicUrl }),
    (error) => {
      assert.equal(error.releaseSmokePhase, RELEASE_SMOKE_PHASES.LANDING_PREFLIGHT);
      assert.equal(getReleaseSmokeRetryDecision({ error, attempt: 1 }).shouldRetry, true);
      assert.equal(Array.isArray(error.releaseSmokeDetails?.probes), true);
      return true;
    },
  );
});

test("release smoke preflight keeps content policy failures final", async () => {
  const request = fakeRequest({
    "": fakeResponse({ text: "not html" }),
    "assets/sample-runs.json": fakeResponse({
      contentType: "application/json",
      json: sampleManifest(),
    }),
    "app/": fakeResponse(),
  });

  await assert.rejects(
    () => runReleaseSmokePreflight({ request, publicUrl }),
    (error) => {
      assert.equal(error.releaseSmokePhase, RELEASE_SMOKE_PHASES.ASSERTIONS);
      assert.equal(getReleaseSmokeRetryDecision({ error, attempt: 1 }).shouldRetry, false);
      return true;
    },
  );
});

test("release smoke preflight keeps malformed sample manifest JSON final", async () => {
  const request = fakeRequest({
    "": fakeResponse(),
    "assets/sample-runs.json": fakeResponse({
      contentType: "application/json",
      json: () => {
        throw new Error("bad json");
      },
    }),
    "app/": fakeResponse(),
  });

  await assert.rejects(
    () => runReleaseSmokePreflight({ request, publicUrl }),
    (error) => {
      assert.equal(error.releaseSmokePhase, RELEASE_SMOKE_PHASES.ASSERTIONS);
      assert.equal(getReleaseSmokeRetryDecision({ error, attempt: 1 }).shouldRetry, false);
      assert.match(error.releaseSmokeDetails?.probes?.[1]?.parseError || "", /bad json/);
      return true;
    },
  );
});

test("release smoke keeps product and telemetry failures final", () => {
  const productError = tagReleaseSmokeError(
    new Error("HGO sample choice became visible"),
    RELEASE_SMOKE_PHASES.ASSERTIONS,
    { retryable: false },
  );
  const consoleError = new Error("unexpected console error");
  const networkError = tagReleaseSmokeError(
    new Error("unexpected network failure"),
    RELEASE_SMOKE_PHASES.ASSERTIONS,
  );

  assert.equal(shouldRetryReleaseSmokeAttempt({ error: productError, attempt: 1 }), false);
  assert.equal(shouldRetryReleaseSmokeAttempt({ error: consoleError, attempt: 1 }), false);
  assert.equal(shouldRetryReleaseSmokeAttempt({ error: networkError, attempt: 1 }), false);
});

test("release smoke validates the public sample manifest baseline", () => {
  const valid = validateReleaseSmokeSampleManifest(sampleManifest());

  assert.equal(valid.ok, true);
  assert.deepEqual(valid.summary.sampleProjectIds, EXPECTED_PUBLIC_SAMPLE_PROJECT_IDS);
  assert.equal(valid.summary.hgoExclusionListed, true);
});

test("release smoke treats sample manifest count and HGO exposure as final failures", () => {
  const wrongCount = validateReleaseSmokeSampleManifest(sampleManifest({
    sample_projects: EXPECTED_PUBLIC_SAMPLE_PROJECT_IDS.slice(0, -1).map((id) => ({ id })),
  }));
  const hgoExposed = validateReleaseSmokeSampleManifest(sampleManifest({
    public_scenario_ids: ["blank_base", "hgo_1936"],
    sample_projects: [
      ...EXPECTED_PUBLIC_SAMPLE_PROJECT_IDS.slice(0, -1).map((id) => ({ id })),
      { id: "hgo-1936-preview" },
    ],
  }));

  assert.equal(wrongCount.ok, false);
  assert.match(wrongCount.reason, /expected 6 public sample projects/);
  assert.equal(hgoExposed.ok, false);
  assert.match(hgoExposed.reason, /HGO preview content/);
});
