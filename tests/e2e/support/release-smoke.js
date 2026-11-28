const RELEASE_SMOKE_PHASES = Object.freeze({
  LANDING_PREFLIGHT: "landing-preflight",
  SHELL_READY: "shell-ready",
  SCENARIO_APPLY: "scenario-apply",
  ASSERTIONS: "assertions",
});

const RELEASE_SMOKE_MAX_ATTEMPTS = 2;
const RELEASE_SMOKE_RETRY_DELAY_MS = 30_000;
const RELEASE_SMOKE_PREFLIGHT_TIMEOUT_MS = 15_000;
const EXPECTED_PUBLIC_SAMPLE_PROJECT_IDS = Object.freeze([
  "blank-base-starter",
  "modern-world-japan-corridor",
  "hoi4-1936-europe-briefing",
  "hoi4-1939-europe-switch",
  "tno-1962-atlantropa-briefing",
  "rcw-1919-civil-war-briefing",
]);

const RETRYABLE_PHASES = new Set([
  RELEASE_SMOKE_PHASES.LANDING_PREFLIGHT,
  RELEASE_SMOKE_PHASES.SHELL_READY,
  RELEASE_SMOKE_PHASES.SCENARIO_APPLY,
]);

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createReleaseSmokeError(message, {
  phase = RELEASE_SMOKE_PHASES.ASSERTIONS,
  cause = null,
  details = null,
  retryable = undefined,
} = {}) {
  const error = new Error(message);
  if (cause) {
    error.cause = cause;
  }
  return tagReleaseSmokeError(error, phase, { details, retryable });
}

function tagReleaseSmokeError(error, phase, { details = null, retryable = undefined } = {}) {
  if (!error || typeof error !== "object") {
    return createReleaseSmokeError(String(error), { phase, details, retryable });
  }
  error.releaseSmokePhase = phase;
  if (details !== null && details !== undefined) {
    error.releaseSmokeDetails = details;
  }
  if (retryable !== undefined) {
    error.releaseSmokeRetryable = !!retryable;
  }
  return error;
}

function getReleaseSmokeErrorPhase(error) {
  return String(error?.releaseSmokePhase || "");
}

function isReleaseSmokeRetryableError(error) {
  if (error?.releaseSmokeRetryable === false) {
    return false;
  }
  if (error?.releaseSmokeRetryable === true) {
    return true;
  }
  return RETRYABLE_PHASES.has(getReleaseSmokeErrorPhase(error));
}

function collectReleaseSmokeErrorMessages(error) {
  const messages = [];
  const seen = new Set();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    messages.push(String(current.message || ""));
    current = current.cause;
  }
  return messages;
}

function isRetryableSameOriginModulePropagationFailure(error, { publicBaseUrl } = {}) {
  if (!RETRYABLE_PHASES.has(getReleaseSmokeErrorPhase(error))) {
    return false;
  }

  let baseUrl;
  try {
    baseUrl = new URL(String(publicBaseUrl || ""));
  } catch {
    return false;
  }

  const moduleUrlMatch = collectReleaseSmokeErrorMessages(error)
    .join("\n")
    .match(/Failed to fetch dynamically imported module:\s*(https?:\/\/[^\s"'`]+)/i);
  if (!moduleUrlMatch) {
    return false;
  }

  try {
    const moduleUrl = new URL(moduleUrlMatch[1]);
    const basePath = baseUrl.pathname.endsWith("/") ? baseUrl.pathname : `${baseUrl.pathname}/`;
    return moduleUrl.origin === baseUrl.origin
      && moduleUrl.pathname.startsWith(basePath)
      && moduleUrl.pathname.endsWith(".js");
  } catch {
    return false;
  }
}

function isRetryablePublicPagesShellPropagationStall(error, { publicBaseUrl } = {}) {
  if (getReleaseSmokeErrorPhase(error) !== RELEASE_SMOKE_PHASES.SHELL_READY) {
    return false;
  }

  let baseUrl;
  try {
    baseUrl = new URL(String(publicBaseUrl || ""));
  } catch {
    return false;
  }
  if (baseUrl.protocol !== "https:" || !baseUrl.hostname.endsWith(".github.io")) {
    return false;
  }

  const message = collectReleaseSmokeErrorMessages(error).join("\n");
  return message.includes("[playwright-app] waitForShellReady timed out")
    && message.includes('"bootPhase":"shell"')
    && message.includes('"bootBlocking":true')
    && message.includes('"bodyAppBooting":true')
    && message.includes('"overlayHidden":false')
    && message.includes('"bootError":""');
}

function shouldRetryReleaseSmokeAttempt({
  error,
  attempt,
  maxAttempts = RELEASE_SMOKE_MAX_ATTEMPTS,
} = {}) {
  const currentAttempt = Number(attempt || 0);
  return currentAttempt > 0
    && currentAttempt < maxAttempts
    && isReleaseSmokeRetryableError(error);
}

function getReleaseSmokeRetryDecision({
  error,
  attempt,
  maxAttempts = RELEASE_SMOKE_MAX_ATTEMPTS,
  retryDelayMs = RELEASE_SMOKE_RETRY_DELAY_MS,
} = {}) {
  const retryable = isReleaseSmokeRetryableError(error);
  const shouldRetry = shouldRetryReleaseSmokeAttempt({ error, attempt, maxAttempts });
  return {
    phase: getReleaseSmokeErrorPhase(error) || RELEASE_SMOKE_PHASES.ASSERTIONS,
    retryable,
    shouldRetry,
    retryDelayMs: shouldRetry ? retryDelayMs : 0,
    attempt,
    maxAttempts,
  };
}

function normalizeSampleProjectIds(payload) {
  return (Array.isArray(payload?.sample_projects) ? payload.sample_projects : [])
    .map((entry) => String(entry?.id || "").trim())
    .filter(Boolean);
}

function validateReleaseSmokeSampleManifest(payload, {
  expectedSampleProjectIds = EXPECTED_PUBLIC_SAMPLE_PROJECT_IDS,
} = {}) {
  const sampleProjectIds = normalizeSampleProjectIds(payload);
  const publicScenarioIds = Array.isArray(payload?.public_scenario_ids)
    ? payload.public_scenario_ids.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const developerPreviewExclusions = Array.isArray(payload?.developer_preview_exclusions)
    ? payload.developer_preview_exclusions.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const hgoSampleProjectIds = sampleProjectIds.filter((sampleId) => /hgo/i.test(sampleId));
  const mismatchedExpectedIds = expectedSampleProjectIds.filter((sampleId, index) => sampleProjectIds[index] !== sampleId);
  const unexpectedIds = sampleProjectIds.filter((sampleId) => !expectedSampleProjectIds.includes(sampleId));
  const missingIds = expectedSampleProjectIds.filter((sampleId) => !sampleProjectIds.includes(sampleId));
  const summary = {
    sampleProjectIds,
    sampleProjectCount: sampleProjectIds.length,
    publicScenarioIds,
    developerPreviewExclusions,
    expectedSampleProjectIds: [...expectedSampleProjectIds],
    hgoSampleProjectIds,
    hgoExclusionListed: developerPreviewExclusions.includes("hgo_1936"),
    mismatchedExpectedIds,
    unexpectedIds,
    missingIds,
  };

  if (hgoSampleProjectIds.length > 0 || publicScenarioIds.includes("hgo_1936")) {
    return {
      ok: false,
      reason: "HGO preview content is exposed in public sample manifest",
      summary,
    };
  }
  if (sampleProjectIds.length !== expectedSampleProjectIds.length) {
    return {
      ok: false,
      reason: `expected ${expectedSampleProjectIds.length} public sample projects, found ${sampleProjectIds.length}`,
      summary,
    };
  }
  if (mismatchedExpectedIds.length > 0 || unexpectedIds.length > 0 || missingIds.length > 0) {
    return {
      ok: false,
      reason: "public sample project ids differ from the release baseline",
      summary,
    };
  }
  return {
    ok: true,
    reason: "ok",
    summary,
  };
}

async function probeReleaseSmokeUrl({
  request,
  id,
  url,
  timeout = RELEASE_SMOKE_PREFLIGHT_TIMEOUT_MS,
  responseKind = "text",
}) {
  const startedAt = Date.now();
  try {
    const response = await request.get(url, { timeout });
    const status = response.status();
    const headers = response.headers();
    const contentType = String(headers["content-type"] || headers["Content-Type"] || "");
    const result = {
      id,
      url,
      status,
      ok: response.ok(),
      contentType,
      durationMs: Date.now() - startedAt,
    };
    if (responseKind === "json" && response.ok()) {
      try {
        result.json = await response.json();
      } catch (error) {
        result.parseError = String(error?.message || error);
      }
    } else if (responseKind === "html" && response.ok()) {
      const body = await response.text();
      result.bodyPreview = body.slice(0, 160);
      result.looksLikeHtml = /<html[\s>]/i.test(body) || /<!doctype html/i.test(body);
    }
    return result;
  } catch (error) {
    return {
      id,
      url,
      status: "failed",
      ok: false,
      errorText: String(error?.message || error),
      durationMs: Date.now() - startedAt,
    };
  }
}

async function runReleaseSmokePreflight({
  request,
  publicUrl,
  timeout = RELEASE_SMOKE_PREFLIGHT_TIMEOUT_MS,
  expectedSampleProjectIds = EXPECTED_PUBLIC_SAMPLE_PROJECT_IDS,
} = {}) {
  if (!request || typeof request.get !== "function") {
    throw createReleaseSmokeError("release smoke preflight requires a Playwright APIRequestContext", {
      phase: RELEASE_SMOKE_PHASES.ASSERTIONS,
      retryable: false,
    });
  }
  if (typeof publicUrl !== "function") {
    throw createReleaseSmokeError("release smoke preflight requires a publicUrl(path) function", {
      phase: RELEASE_SMOKE_PHASES.ASSERTIONS,
      retryable: false,
    });
  }

  const probes = [
    await probeReleaseSmokeUrl({
      request,
      id: "landing-root",
      url: publicUrl(""),
      timeout,
      responseKind: "html",
    }),
    await probeReleaseSmokeUrl({
      request,
      id: "sample-runs",
      url: publicUrl("assets/sample-runs.json"),
      timeout,
      responseKind: "json",
    }),
    await probeReleaseSmokeUrl({
      request,
      id: "app-shell",
      url: publicUrl("app/"),
      timeout,
      responseKind: "html",
    }),
  ];

  const unavailableProbes = probes.filter((probe) => probe.ok !== true);
  if (unavailableProbes.length > 0) {
    throw createReleaseSmokeError("release smoke preflight could not fetch all public Pages entrypoints", {
      phase: RELEASE_SMOKE_PHASES.LANDING_PREFLIGHT,
      retryable: true,
      details: { probes },
    });
  }

  const parseFailures = probes.filter((probe) => probe.parseError);
  if (parseFailures.length > 0) {
    throw createReleaseSmokeError("release smoke preflight received invalid JSON from a public manifest", {
      phase: RELEASE_SMOKE_PHASES.ASSERTIONS,
      retryable: false,
      details: { probes },
    });
  }

  const htmlProbeFailures = probes.filter((probe) => (
    (probe.id === "landing-root" || probe.id === "app-shell")
    && probe.looksLikeHtml !== true
  ));
  if (htmlProbeFailures.length > 0) {
    throw createReleaseSmokeError("release smoke preflight received a non-HTML landing or app shell response", {
      phase: RELEASE_SMOKE_PHASES.ASSERTIONS,
      retryable: false,
      details: { probes },
    });
  }

  const sampleRunsProbe = probes.find((probe) => probe.id === "sample-runs");
  const manifestValidation = validateReleaseSmokeSampleManifest(sampleRunsProbe?.json, {
    expectedSampleProjectIds,
  });
  sampleRunsProbe.sampleManifest = manifestValidation.summary;
  if (!manifestValidation.ok) {
    throw createReleaseSmokeError(`release smoke preflight sample manifest failed: ${manifestValidation.reason}`, {
      phase: RELEASE_SMOKE_PHASES.ASSERTIONS,
      retryable: false,
      details: { probes, manifestValidation },
    });
  }

  return probes.map((probe) => {
    const { json, ...publicProbe } = probe;
    return publicProbe;
  });
}

module.exports = {
  RELEASE_SMOKE_PHASES,
  RELEASE_SMOKE_MAX_ATTEMPTS,
  RELEASE_SMOKE_RETRY_DELAY_MS,
  RELEASE_SMOKE_PREFLIGHT_TIMEOUT_MS,
  EXPECTED_PUBLIC_SAMPLE_PROJECT_IDS,
  createReleaseSmokeError,
  tagReleaseSmokeError,
  getReleaseSmokeErrorPhase,
  isReleaseSmokeRetryableError,
  isRetryableSameOriginModulePropagationFailure,
  isRetryablePublicPagesShellPropagationStall,
  shouldRetryReleaseSmokeAttempt,
  getReleaseSmokeRetryDecision,
  validateReleaseSmokeSampleManifest,
  runReleaseSmokePreflight,
  sleep,
};
