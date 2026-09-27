const DEFAULT_RENDER_PHASE_IDLE = "idle";
const DEFAULT_RENDER_PHASE_INTERACTING = "interacting";

const REQUIRED_EFFECT_NAMES = Object.freeze([
  "clearTimeout",
  "setTimeout",
  "setRenderPhaseTimerId",
  "setRenderPhaseValue",
  "setPhaseEnteredAt",
  "setIsInteracting",
  "cancelPoliticalPathWarmup",
  "setHoverOverlayDirty",
  "setPendingDayNightRefresh",
  "invalidateRenderPasses",
  "updateDprStage",
  "setCanvasSize",
  "setAdaptiveSettleProfile",
  "scheduleScenarioChunkRefresh",
  "setDeferExactAfterSettle",
  "render",
  "scheduleExactAfterSettleRefresh",
]);

const REQUIRED_GETTER_NAMES = Object.freeze([
  "getRenderPhase",
  "getRenderPhaseTimerId",
  "nowMs",
  "getAdaptiveSettleProfile",
  "hasPendingDayNightRefresh",
  "shouldStartExactAfterSettleFastPath",
]);

const PROMOTION_ACTIVE_STATUSES = Object.freeze([
  "promotion-committed",
  "promotion-commit-started",
  "promotion-commit-in-flight",
  "promotion-started",
  "promotion-in-flight",
  "promotion-scheduled",
  "refresh-started",
]);

function requireFunction(source, name, label) {
  const candidate = source?.[name];
  if (typeof candidate !== "function") {
    throw new TypeError(`${label}.${name} must be a function.`);
  }
  return candidate;
}

function normalizeReason(reason, defaultReason) {
  const normalized = String(reason || "").trim();
  return normalized || defaultReason;
}

export function createRenderPhaseLifecycleOwner({ state = {}, effects = {}, getters = {} } = {}) {
  const renderPhaseIdle = String(state.renderPhaseIdle || DEFAULT_RENDER_PHASE_IDLE);
  const renderPhaseInteracting = String(state.renderPhaseInteracting || DEFAULT_RENDER_PHASE_INTERACTING);
  const effectApi = Object.fromEntries(
    REQUIRED_EFFECT_NAMES.map((name) => [name, requireFunction(effects, name, "effects")]),
  );
  const getterApi = Object.fromEntries(
    REQUIRED_GETTER_NAMES.map((name) => [name, requireFunction(getters, name, "getters")]),
  );

  function runEffect(name, ...args) {
    return effectApi[name](...args);
  }

  function runGetter(name, ...args) {
    return getterApi[name](...args);
  }

  function clearRenderPhaseTimerCore() {
    const timerId = runGetter("getRenderPhaseTimerId");
    if (!timerId) return false;
    runEffect("clearTimeout", timerId);
    runEffect("setRenderPhaseTimerId", null);
    return true;
  }

  function clearRenderPhaseTimer() {
    clearRenderPhaseTimerCore();
  }

  function setRenderPhase(nextPhase) {
    const phase = String(nextPhase || renderPhaseIdle);
    const previousPhase = String(runGetter("getRenderPhase") || "");
    const enteredAt = runGetter("nowMs");

    runEffect("setRenderPhaseValue", phase);
    runEffect("setPhaseEnteredAt", enteredAt);
    runEffect("setIsInteracting", phase === renderPhaseInteracting);

    if (phase !== renderPhaseIdle) {
      runEffect("cancelPoliticalPathWarmup", `phase-${phase}`);
    }
    if (previousPhase !== phase && (previousPhase === renderPhaseIdle || phase === renderPhaseIdle)) {
      runEffect("setHoverOverlayDirty", true);
    }
    if (phase === renderPhaseIdle && runGetter("hasPendingDayNightRefresh")) {
      runEffect("setPendingDayNightRefresh", false);
      runEffect("invalidateRenderPasses", "dayNight", "day-night-clock-deferred");
    }
    const dprStageChanged = runEffect(
      "updateDprStage",
      phase === renderPhaseInteracting ? "interactive" : "idle",
    );
    if (dprStageChanged) {
      runEffect("setCanvasSize", {
        reason: `phase-${phase}-dpr-stage`,
        targetPassesOnDprChange: ["political", "contextBase", "borders"],
      });
    }
  }

  function scheduleRenderPhaseIdle({ reason = "render-phase-idle" } = {}) {
    const normalizedReason = normalizeReason(reason, "render-phase-idle");
    clearRenderPhaseTimerCore();
    const settleProfile = runGetter("getAdaptiveSettleProfile");

    runEffect("setAdaptiveSettleProfile", settleProfile);
    const timerId = runEffect("setTimeout", () => {
      runEffect("setRenderPhaseTimerId", null);
      setRenderPhase(renderPhaseIdle);
      const pendingChunkRefreshStatus = runEffect("scheduleScenarioChunkRefresh", {
        reason: normalizedReason,
        delayMs: 0,
        flushPending: true,
      });
      const promotionWorkActive = PROMOTION_ACTIVE_STATUSES.includes(String(pendingChunkRefreshStatus || ""));
      if (runGetter("shouldStartExactAfterSettleFastPath")) {
        if (promotionWorkActive) return;
        runEffect("setDeferExactAfterSettle", true);
        runEffect("render");
        runEffect("scheduleExactAfterSettleRefresh", settleProfile);
        return;
      }
      runEffect("render");
    }, Number(settleProfile?.settleDurationMs || 0));
    runEffect("setRenderPhaseTimerId", timerId);
  }

  function resetRenderPhaseState() {
    const timerCleared = clearRenderPhaseTimerCore();
    const enteredAt = runGetter("nowMs");

    runEffect("setRenderPhaseValue", renderPhaseIdle);
    runEffect("setPhaseEnteredAt", enteredAt);
    runEffect("setIsInteracting", false);
    if (!timerCleared) {
      runEffect("setRenderPhaseTimerId", null);
    }
  }

  return Object.freeze({
    clearRenderPhaseTimer,
    setRenderPhase,
    scheduleRenderPhaseIdle,
    resetRenderPhaseState,
  });
}
