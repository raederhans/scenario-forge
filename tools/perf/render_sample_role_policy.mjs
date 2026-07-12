export const RENDER_SAMPLE_ROLE_POLICY_ID = "render-sample-role-v1";
export const CANONICAL_RENDER_SAMPLE_ROLE_ID = "last-post-promotion-idle-scenario-frame-v1";
export const GOVERNED_RENDER_SAMPLE_SCENARIOS = Object.freeze(["tno_1962", "hoi4_1939"]);

const EXPECTED_SAMPLE_SEQUENCES = Object.freeze([1, 2]);

function finiteNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function median(values) {
  const numbers = values
    .map((value) => finiteNumberOrNull(value))
    .filter((value) => value !== null)
    .sort((left, right) => left - right);
  if (!numbers.length) {
    return null;
  }
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 === 0
    ? (numbers[middle - 1] + numbers[middle]) / 2
    : numbers[middle];
}

export function isGovernedRenderSampleScenario(scenarioId) {
  return GOVERNED_RENDER_SAMPLE_SCENARIOS.includes(String(scenarioId || "").trim());
}

function summarizeSample(sample, index) {
  if (!sample || typeof sample !== "object") {
    return null;
  }
  return Object.freeze({
    index,
    sequence: finiteNumberOrNull(sample.sequence),
    durationMs: finiteNumberOrNull(sample.durationMs),
    recordedAt: finiteNumberOrNull(sample.recordedAt),
    activeScenarioId: String(sample.activeScenarioId || "").trim(),
    phase: String(sample.phase || "").trim(),
    politicalBgProgressive: sample.politicalBgProgressive === true,
    contextScenarioMs: finiteNumberOrNull(sample.contextScenarioMs),
  });
}
export function classifyFirstRenderSampleRole(sample) {
  const summarized = summarizeSample(sample, 0);
  const contextScenarioMs = summarized?.contextScenarioMs;
  const role = contextScenarioMs !== null && contextScenarioMs > 0 ? "scenario" : "blank";
  return Object.freeze({
    role,
    sample: summarized,
  });
}

function roleCheck(id, pass, expected, actual) {
  return Object.freeze({ id, pass: !!pass, expected, actual });
}

function isCanonicalCandidate(sample, scenarioId, promotionRecordedAt) {
  return (
    sample?.activeScenarioId === scenarioId
    && sample?.phase === "idle"
    && sample?.politicalBgProgressive === true
    && sample?.contextScenarioMs !== null
    && sample.contextScenarioMs > 0
    && sample?.recordedAt !== null
    && promotionRecordedAt !== null
    && sample.recordedAt >= promotionRecordedAt
    && sample?.durationMs !== null
    && sample.durationMs > 0
  );
}

export function analyzeRenderSampleRole({ scenarioId, snapshot, summary = null } = {}) {
  const requestedScenarioId = String(scenarioId || "").trim();
  const governed = isGovernedRenderSampleScenario(requestedScenarioId);
  const renderSamples = snapshot?.renderSamples && typeof snapshot.renderSamples === "object"
    ? snapshot.renderSamples
    : {};
  const rawSamples = Array.isArray(renderSamples.samples) ? renderSamples.samples : [];
  const samples = rawSamples.map((sample, index) => summarizeSample(sample, index));
  const promotionRecordedAt = finiteNumberOrNull(
    snapshot?.renderPerfMetrics?.scenarioChunkPromotionVisualStage?.recordedAt
  );
  const declaredCount = finiteNumberOrNull(renderSamples.count);
  const sequences = samples.map((sample) => sample?.sequence);
  const lastSample = samples.at(-1) || null;
  const canonicalCandidates = samples.filter((sample) => (
    isCanonicalCandidate(sample, requestedScenarioId, promotionRecordedAt)
  ));
  const firstRole = classifyFirstRenderSampleRole(rawSamples[0]);
  const scenarioFirstSample = samples.find((sample) => (
    sample?.contextScenarioMs !== null && sample.contextScenarioMs > 0
  )) || null;
  const preScenarioSampleCount = samples.filter((sample) => (
    sample?.recordedAt !== null
    && promotionRecordedAt !== null
    && sample.recordedAt < promotionRecordedAt
  )).length;
  const legacyRenderSampleMedianMs = finiteNumberOrNull(
    renderSamples.medianMs ?? summary?.renderSampleMedianMs
  );

  if (!governed) {
    return Object.freeze({
      policyId: RENDER_SAMPLE_ROLE_POLICY_ID,
      canonicalRoleId: CANONICAL_RENDER_SAMPLE_ROLE_ID,
      governed: false,
      status: "compatible-non-governed-scenario",
      requestedScenarioId,
      roleMatched: true,
      roleMismatches: Object.freeze([]),
      legacyRenderSampleMedianMs,
      canonicalRenderSampleMs: null,
      preScenarioSampleCount,
      firstRole,
      scenarioFirstSample,
      checks: Object.freeze([]),
    });
  }

  const checks = [
    roleCheck("declared-sample-count", declaredCount === 2, 2, declaredCount),
    roleCheck("sample-array-count", samples.length === 2, 2, samples.length),
    roleCheck(
      "sample-sequence",
      sequences.length === 2 && sequences.every((sequence, index) => sequence === EXPECTED_SAMPLE_SEQUENCES[index]),
      EXPECTED_SAMPLE_SEQUENCES,
      sequences
    ),
    roleCheck(
      "canonical-candidate-unique",
      canonicalCandidates.length === 1,
      1,
      canonicalCandidates.length
    ),
    roleCheck(
      "canonical-candidate-is-last",
      canonicalCandidates.length === 1 && canonicalCandidates[0] === lastSample,
      "samples.at(-1)",
      canonicalCandidates[0]?.index ?? null
    ),
    roleCheck("last-active-scenario", lastSample?.activeScenarioId === requestedScenarioId, requestedScenarioId, lastSample?.activeScenarioId ?? null),
    roleCheck("last-phase-idle", lastSample?.phase === "idle", "idle", lastSample?.phase ?? null),
    roleCheck("last-political-bg-progressive", lastSample?.politicalBgProgressive === true, true, lastSample?.politicalBgProgressive ?? null),
    roleCheck("last-context-scenario-positive", (lastSample?.contextScenarioMs ?? 0) > 0, "> 0", lastSample?.contextScenarioMs ?? null),
    roleCheck(
      "last-recorded-after-promotion",
      lastSample?.recordedAt !== null
        && promotionRecordedAt !== null
        && lastSample.recordedAt >= promotionRecordedAt,
      `>= ${promotionRecordedAt ?? "missing"}`,
      lastSample?.recordedAt ?? null
    ),
    roleCheck("last-duration-positive", (lastSample?.durationMs ?? 0) > 0, "> 0", lastSample?.durationMs ?? null),
  ];
  const roleMismatches = checks.filter((check) => !check.pass).map((check) => check.id);
  const roleMatched = roleMismatches.length === 0;

  return Object.freeze({
    policyId: RENDER_SAMPLE_ROLE_POLICY_ID,
    canonicalRoleId: CANONICAL_RENDER_SAMPLE_ROLE_ID,
    governed: true,
    status: roleMatched ? "matched" : "role-mismatch",
    requestedScenarioId,
    roleMatched,
    roleMismatches: Object.freeze(roleMismatches),
    legacyRenderSampleMedianMs,
    canonicalRenderSampleMs: roleMatched ? lastSample.durationMs : null,
    preScenarioSampleCount,
    firstRole,
    scenarioFirstSample,
    promotionRecordedAt,
    canonicalSample: roleMatched ? lastSample : null,
    checks: Object.freeze(checks),
  });
}

export function summarizeRenderSampleRoleAnalyses(analyses = []) {
  const normalized = Array.isArray(analyses) ? analyses.filter(Boolean) : [];
  const governed = normalized.filter((analysis) => analysis.governed);
  const roleMismatches = governed.flatMap((analysis, index) => (
    analysis.roleMismatches.map((mismatch) => ({ runIndex: index, mismatch }))
  ));
  const canonicalValues = governed
    .map((analysis) => analysis.canonicalRenderSampleMs)
    .filter((value) => Number.isFinite(value));
  const firstRoleComposition = normalized.reduce((composition, analysis) => {
    const role = analysis?.firstRole?.role === "scenario" ? "scenario" : "blank";
    composition[role] += 1;
    return composition;
  }, { blank: 0, scenario: 0 });

  return Object.freeze({
    policyId: RENDER_SAMPLE_ROLE_POLICY_ID,
    canonicalRoleId: CANONICAL_RENDER_SAMPLE_ROLE_ID,
    governedRunCount: governed.length,
    matchedRunCount: governed.filter((analysis) => analysis.roleMatched).length,
    mismatchCount: roleMismatches.length,
    roleMismatches: Object.freeze(roleMismatches),
    canonicalRenderSampleMs: median(canonicalValues),
    canonicalValues: Object.freeze(canonicalValues),
    firstRoleComposition: Object.freeze(firstRoleComposition),
    preScenarioSampleCount: normalized.reduce((total, analysis) => total + Number(analysis.preScenarioSampleCount || 0), 0),
  });
}
