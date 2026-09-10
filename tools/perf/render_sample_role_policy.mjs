export const RENDER_SAMPLE_ROLE_POLICY_ID = "render-sample-role-v2";
export const CANONICAL_RENDER_SAMPLE_ROLE_ID = "last-post-promotion-idle-scenario-frame-v1";
export const GOVERNED_RENDER_SAMPLE_SCENARIOS = Object.freeze(["tno_1962", "hoi4_1939"]);
export const STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID = "standard-perf-5-run-v1";
export const SETTLED_STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID = "standard-perf-5-run-v2";
export const SETTLED_RENDER_SAMPLE_ROLE_POLICY_ID = "render-sample-role-v3";
export const SETTLED_CANONICAL_RENDER_SAMPLE_ROLE_ID = "initial-scenario-frame-through-startup-settlement-v1";
export const WILLIAMS_CROSSOVER_RENDER_SAMPLE_RUN_PROFILE_ID = "p2-williams-crossover-v7";

const RENDER_SAMPLE_RUN_PROFILES = Object.freeze({
  [SETTLED_STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID]: Object.freeze({
    id: SETTLED_STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID,
    measuredRunsPerScenario: 5,
    reportSchemaVersion: 3,
    modes: Object.freeze(["baseline", "gate"]),
  }),
  [STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID]: Object.freeze({
    id: STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID,
    measuredRunsPerScenario: 5,
    reportSchemaVersion: 3,
    modes: Object.freeze(["baseline", "gate"]),
  }),
  [WILLIAMS_CROSSOVER_RENDER_SAMPLE_RUN_PROFILE_ID]: Object.freeze({
    id: WILLIAMS_CROSSOVER_RENDER_SAMPLE_RUN_PROFILE_ID,
    measuredRunsPerScenario: 2,
    reportSchemaVersion: 2,
    modes: Object.freeze(["baseline"]),
  }),
});

export function resolveRenderSampleRolePolicyIdentity(profileId) {
  const settled = resolveRenderSampleRunProfile(profileId).id === SETTLED_STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID;
  return {
    policyId: settled ? SETTLED_RENDER_SAMPLE_ROLE_POLICY_ID : RENDER_SAMPLE_ROLE_POLICY_ID,
    canonicalRoleId: settled ? SETTLED_CANONICAL_RENDER_SAMPLE_ROLE_ID : CANONICAL_RENDER_SAMPLE_ROLE_ID,
  };
}

export function resolveRenderSampleRunProfile(
  profileId = STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID,
) {
  const normalizedProfileId = primitiveText(profileId)
    || STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID;
  const profile = RENDER_SAMPLE_RUN_PROFILES[normalizedProfileId];
  if (!profile) {
    throw new Error(`Unsupported render sample run profile: ${JSON.stringify(profileId)}.`);
  }
  return profile;
}

function finiteNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function primitiveText(value) {
  return typeof value === "string" ? value.trim() : "";
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
  return GOVERNED_RENDER_SAMPLE_SCENARIOS.includes(primitiveText(scenarioId));
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
    activeScenarioId: primitiveText(sample.activeScenarioId),
    phase: primitiveText(sample.phase),
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
  const freezeEvidenceValue = (value) => (
    Array.isArray(value) ? Object.freeze([...value]) : value
  );
  return Object.freeze({
    id,
    pass: !!pass,
    expected: freezeEvidenceValue(expected),
    actual: freezeEvidenceValue(actual),
  });
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

export function analyzeRenderSampleRole({ scenarioId, snapshot, summary = null, runProfileId = STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID } = {}) {
  if (resolveRenderSampleRunProfile(runProfileId).id === SETTLED_STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID) {
    return analyzeSettledRenderSampleRole({ scenarioId, snapshot, summary });
  }
  const requestedScenarioId = primitiveText(scenarioId);
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
  const expectedSequences = samples.map((_, index) => index + 1);
  const lastSample = samples.at(-1) || null;
  const canonicalCandidates = samples.filter((sample) => (
    isCanonicalCandidate(sample, requestedScenarioId, promotionRecordedAt)
  ));
  // canonical 角色只允许出现在最后一帧；promotion 前的额外样本保留为启动成本证据。
  const preCanonicalSamples = samples.slice(0, -1);
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
    roleCheck(
      "promotion-recorded-at-nonnegative",
      promotionRecordedAt !== null && promotionRecordedAt >= 0,
      ">= 0",
      promotionRecordedAt,
    ),
    roleCheck(
      "sample-recorded-at-nonnegative",
      samples.every((sample) => sample?.recordedAt !== null && sample.recordedAt >= 0),
      "all >= 0",
      samples.map((sample) => sample?.recordedAt ?? null),
    ),
    roleCheck("declared-sample-count", declaredCount === samples.length, samples.length, declaredCount),
    roleCheck("sample-array-count", samples.length >= 2, ">= 2", samples.length),
    roleCheck(
      "sample-sequence",
      sequences.every((sequence, index) => sequence === expectedSequences[index]),
      expectedSequences,
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
    roleCheck(
      "all-pre-canonical-samples-before-promotion",
      promotionRecordedAt !== null
        && preCanonicalSamples.every((sample) => (
          sample?.recordedAt !== null && sample.recordedAt < promotionRecordedAt
        )),
      `< ${promotionRecordedAt ?? "missing"}`,
      preCanonicalSamples.map((sample) => sample?.recordedAt ?? null)
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

export function findInitialScenarioRenderSample(snapshot, scenarioId, initialPromotion) {
  const samples = Array.isArray(snapshot?.renderSamples?.samples) ? snapshot.renderSamples.samples : [];
  return samples.map(summarizeSample).find((sample) => isCanonicalCandidate(sample, scenarioId, finiteNumberOrNull(initialPromotion?.recordedAt))) || null;
}

function analyzeSettledRenderSampleRole({ scenarioId, snapshot, summary }) {
  // Historical/Williams evidence keeps the last-frame rule. Standard v2 binds
  // a completed observation window and charges every commit after the anchored
  // first full scenario frame, so asynchronous follow-up work cannot disappear from
  // the comparison by selecting only the first or the cheapest frame.
  const legacy = analyzeRenderSampleRole({ scenarioId, snapshot, summary });
  const identity = resolveRenderSampleRolePolicyIdentity(SETTLED_STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID);
  if (!legacy.governed) return Object.freeze({ ...legacy, ...identity });
  const completion = snapshot?.standardPerfSettlement;
  const initialPromotion = completion?.initialPromotion;
  const initialPromotionAt = finiteNumberOrNull(initialPromotion?.recordedAt);
  const samples = (Array.isArray(snapshot?.renderSamples?.samples) ? snapshot.renderSamples.samples : []).map(summarizeSample);
  const candidate = findInitialScenarioRenderSample(snapshot, legacy.requestedScenarioId, initialPromotion);
  const before = candidate ? samples.slice(0, candidate.index) : [];
  const after = candidate ? samples.slice(candidate.index + 1) : [];
  const last = samples.at(-1);
  const promotions = completion?.promotionObservations;
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const retainedChecks = new Set(["sample-recorded-at-nonnegative", "declared-sample-count", "sample-sequence"]);
  const checks = [
    ...legacy.checks.filter((check) => retainedChecks.has(check.id)),
    roleCheck("sample-array-count", samples.length >= 1, ">= 1", samples.length),
    roleCheck("sample-time-order", samples.every((sample, index) => sample && (!index || sample.recordedAt >= samples[index - 1]?.recordedAt)), "nondecreasing", samples.map((s) => s?.recordedAt)),
    roleCheck("initial-promotion-bound", initialPromotionAt !== null && initialPromotionAt >= 0 && initialPromotion?.activeScenarioId === legacy.requestedScenarioId && initialPromotion?.reason === "startup-initial-visual", "observed initial startup promotion", initialPromotion || null),
    roleCheck("initial-frame-anchor", !!candidate && completion?.initialFrameSequence === candidate.sequence, "first full frame after initial promotion", completion?.initialFrameSequence ?? null),
    roleCheck("initial-sample-prefix-unchanged", !!candidate && Array.isArray(completion?.initialSamplePrefix) && completion.initialSamplePrefix.length === candidate.index + 1 && same(completion.initialSamplePrefix, snapshot.renderSamples.samples.slice(0, candidate.index + 1)), "captured prefix unchanged", completion?.initialSamplePrefix?.length ?? null),
    roleCheck("promotion-observation-history", Array.isArray(promotions) && promotions.length > 0
      && same(promotions[0].metric, initialPromotion)
      && same(promotions.at(-1).metric, snapshot?.renderPerfMetrics?.scenarioChunkPromotionVisualStage)
      && promotions.every((entry, index) => entry?.metric?.activeScenarioId === legacy.requestedScenarioId
        && finiteNumberOrNull(entry.observedAt) !== null && entry.observedAt >= entry.metric.recordedAt
        && (!index || entry.metric.recordedAt >= promotions[index - 1].metric.recordedAt)), "initial through final observed promotions", promotions || null),
    roleCheck("all-pre-canonical-samples-before-promotion", before.every((sample) => sample?.recordedAt < initialPromotionAt), `< ${initialPromotionAt}`, before.map((s) => s?.recordedAt)),
    roleCheck("post-canonical-same-scenario-idle", after.every((sample) => sample?.activeScenarioId === legacy.requestedScenarioId && sample.phase === "idle" && sample.durationMs !== null && sample.durationMs >= 0), "same scenario, idle, finite nonnegative CPU", after),
    roleCheck("settlement-complete", completion?.complete === true && completion?.activeScenarioId === legacy.requestedScenarioId, "completed requested scenario", completion || null),
    roleCheck("settlement-binds-samples", completion?.sampleCount === samples.length && completion?.lastSampleSequence === last?.sequence, "exact count and last sequence", [completion?.sampleCount ?? null, completion?.lastSampleSequence ?? null]),
    roleCheck("settlement-after-last-frame", finiteNumberOrNull(completion?.observedAt) !== null && completion.observedAt >= last?.recordedAt, ">= last frame", completion?.observedAt ?? null),
  ];
  const roleMismatches = checks.filter((check) => !check.pass).map((check) => check.id);
  const roleMatched = roleMismatches.length === 0;
  const subsequentRenderCpuMs = roleMatched ? after.reduce((sum, sample) => sum + sample.durationMs, 0) : null;
  return Object.freeze({
    ...legacy, ...identity, checks: Object.freeze(checks), roleMatched,
    promotionRecordedAt: initialPromotionAt,
    preScenarioSampleCount: before.length,
    status: roleMatched ? "matched" : "role-mismatch", roleMismatches: Object.freeze(roleMismatches),
    canonicalSample: roleMatched ? candidate : null,
    canonicalCandidateRenderMs: roleMatched ? candidate.durationMs : null,
    subsequentRenderCpuMs,
    subsequentRenderCount: roleMatched ? after.length : null,
    lastRenderCompletedAt: roleMatched ? last.recordedAt : null,
    settlementObservedAt: roleMatched ? completion.observedAt : null,
    canonicalRenderSampleMs: roleMatched ? candidate.durationMs + subsequentRenderCpuMs : null,
  });
}

export function summarizeRenderSampleRoleAnalyses(analyses = [], runProfileId = STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID) {
  const normalized = Array.isArray(analyses) ? analyses.filter(Boolean) : [];
  const governed = normalized.filter((analysis) => analysis.governed);
  const roleMismatches = governed.flatMap((analysis, index) => (
    analysis.roleMismatches.map((mismatch) => ({ runIndex: index, mismatch }))
  ));
  const canonicalValues = governed
    .map((analysis) => analysis.canonicalRenderSampleMs)
    .filter((value) => Number.isFinite(value));
  // legacy median 与 canonical median 分开汇总，避免旧指标掩盖样本角色不一致。
  const firstRoleComposition = normalized.reduce((composition, analysis) => {
    const role = analysis?.firstRole?.role === "scenario" ? "scenario" : "blank";
    composition[role] += 1;
    return composition;
  }, { blank: 0, scenario: 0 });

  return Object.freeze({
    ...resolveRenderSampleRolePolicyIdentity(runProfileId),
    ...(runProfileId === SETTLED_STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID ? {
      canonicalCandidateRenderMs: median(governed.map((analysis) => analysis.canonicalCandidateRenderMs)),
      subsequentRenderCpuMs: median(governed.map((analysis) => analysis.subsequentRenderCpuMs)),
      subsequentRenderCount: median(governed.map((analysis) => analysis.subsequentRenderCount)),
      lastRenderCompletedAt: median(governed.map((analysis) => analysis.lastRenderCompletedAt)),
      settlementObservedAt: median(governed.map((analysis) => analysis.settlementObservedAt)),
    } : {}),
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
