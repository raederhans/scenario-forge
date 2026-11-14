import { requireFunction } from "../renderer/require_named_function.js";
const REQUIRED_EFFECT_NAMES = Object.freeze([
  "requestRender",
  "flushRenderBoundary",
  "render",
]);

const REQUIRED_GETTER_NAMES = Object.freeze([
  "hasInteractionRenderContext",
]);

function normalizeReason(reason, defaultReason) {
  const normalized = String(reason || "").trim();
  return normalized || defaultReason;
}

function createSummary({
  reason,
  options,
  requested,
  usedFallback,
  effectOrder,
  getterOrder,
}) {
  return Object.freeze({
    reason,
    options: Object.freeze({ ...options }),
    requested: Boolean(requested),
    usedFallback: Boolean(usedFallback),
    completed: Boolean(requested || usedFallback),
    effectOrder: Object.freeze([...effectOrder]),
    getterOrder: Object.freeze([...getterOrder]),
  });
}

export function createRenderRequestBoundaryOwner({ effects = {}, getters = {} } = {}) {
  const effectApi = Object.fromEntries(
    REQUIRED_EFFECT_NAMES.map((name) => [name, requireFunction(effects, name, "effects")]),
  );
  const getterApi = Object.fromEntries(
    REQUIRED_GETTER_NAMES.map((name) => [name, requireFunction(getters, name, "getters")]),
  );

  function requestRendererRenderBoundary(reason = "renderer", { flush = false, fallback = null } = {}) {
    const normalizedReason = normalizeReason(reason, "renderer");
    const shouldFlush = Boolean(flush);
    const effectOrder = [];
    const getterOrder = [];
    const requestEffectName = shouldFlush ? "flushRenderBoundary" : "requestRender";
    effectOrder.push(requestEffectName);
    const requested = Boolean(effectApi[requestEffectName](normalizedReason));
    let usedFallback = false;

    if (!requested && typeof fallback === "function") {
      effectOrder.push("fallback");
      fallback();
      usedFallback = true;
    }

    return createSummary({
      reason: normalizedReason,
      options: { flush: shouldFlush, interaction: false },
      requested,
      usedFallback,
      effectOrder,
      getterOrder,
    });
  }

  function requestInteractionRenderBoundary(reason = "interaction") {
    const normalizedReason = normalizeReason(reason, "interaction");
    const effectOrder = ["requestRender"];
    const getterOrder = [];
    const requested = Boolean(effectApi.requestRender(normalizedReason));
    let usedFallback = false;

    if (!requested) {
      effectOrder.push("fallback");
      getterOrder.push("hasInteractionRenderContext");
      if (getterApi.hasInteractionRenderContext()) {
        effectOrder.push("render");
        effectApi.render();
      }
      usedFallback = true;
    }

    return createSummary({
      reason: normalizedReason,
      options: { flush: false, interaction: true },
      requested,
      usedFallback,
      effectOrder,
      getterOrder,
    });
  }

  function flushInteractionRenderBoundary(reason = "interaction") {
    const normalizedReason = normalizeReason(reason, "interaction");
    const effectOrder = ["flushRenderBoundary"];
    const requested = Boolean(effectApi.flushRenderBoundary(normalizedReason));
    return createSummary({
      reason: normalizedReason,
      options: { flush: true, interaction: true },
      requested,
      usedFallback: false,
      effectOrder,
      getterOrder: [],
    });
  }

  return Object.freeze({
    requestRendererRenderBoundary,
    requestInteractionRenderBoundary,
    flushInteractionRenderBoundary,
  });
}
