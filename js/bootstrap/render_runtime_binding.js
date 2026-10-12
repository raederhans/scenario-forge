import { createRenderDispatcher } from "./startup_bootstrap_support.js";
import { render } from "../core/map_renderer/public.js";
import {
  bindRenderBoundary,
  flushRenderBoundary,
  markRenderBoundaryFlushed,
} from "../core/render_boundary.js";
import { registerRuntimeHook } from "../core/state/runtime_hooks.js";
import { initPresetState } from "../core/preset_state.js";
import { initToast, showToast } from "../ui/toast.js";

function normalizeFlushReason(flushReason) {
  const normalized = String(flushReason || "").trim();
  return normalized || "legacy-render-now";
}

function assertObjectRecord(value, name) {
  if (value === null || typeof value !== "object") {
    throw new TypeError(`createStartupRenderRuntimeBinding requires ${name} to be an object.`);
  }
}

function assertFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`createStartupRenderRuntimeBinding requires ${name} to be a function.`);
  }
}

export function createStartupRenderRuntimeBinding({
  targetState,
  setBootPreviewVisible,
  ensureDetailTopologyReady,
  flushReason = "legacy-render-now",
  globalScope = globalThis,
  renderFn = render,
  createDispatcher = createRenderDispatcher,
  bindBoundary = bindRenderBoundary,
  flushBoundary = flushRenderBoundary,
  markBoundaryFlushed = markRenderBoundaryFlushed,
  registerHook = registerRuntimeHook,
  initToastFn = initToast,
  showToastFn = showToast,
  initPresetStateFn = initPresetState,
} = {}) {
  assertObjectRecord(targetState, "targetState");
  assertFunction(setBootPreviewVisible, "setBootPreviewVisible");
  assertFunction(ensureDetailTopologyReady, "ensureDetailTopologyReady");
  assertObjectRecord(globalScope, "globalScope");
  assertFunction(renderFn, "renderFn");
  assertFunction(createDispatcher, "createDispatcher");
  assertFunction(bindBoundary, "bindBoundary");
  assertFunction(flushBoundary, "flushBoundary");
  assertFunction(markBoundaryFlushed, "markBoundaryFlushed");
  assertFunction(registerHook, "registerHook");
  assertFunction(initToastFn, "initToastFn");
  assertFunction(showToastFn, "showToastFn");
  assertFunction(initPresetStateFn, "initPresetStateFn");

  const normalizedFlushReason = normalizeFlushReason(flushReason);
  const renderDispatcher = createDispatcher(() => {
    try {
      renderFn();
    } finally {
      markBoundaryFlushed();
    }
  });
  const renderApp = () => {
    renderDispatcher.schedule();
  };
  const ensureDetailTopology = (options = {}) =>
    ensureDetailTopologyReady({
      renderDispatcher,
      ...options,
    });
  const flushRenderNow = () => flushBoundary(normalizedFlushReason);

  globalScope.renderApp = renderApp;
  bindBoundary({
    scheduleRender: () => renderDispatcher.schedule(),
    flushRender: () => renderDispatcher.flush(),
    ensureDetailTopology,
  });
  globalScope.renderNow = flushRenderNow;
  registerHook(targetState, "renderNowFn", flushRenderNow);
  registerHook(targetState, "ensureDetailTopologyFn", ensureDetailTopology);

  initToastFn();
  registerHook(targetState, "showToastFn", showToastFn);
  setBootPreviewVisible(false);
  initPresetStateFn();

  return {
    renderDispatcher,
    renderApp,
    flushRenderNow,
  };
}
