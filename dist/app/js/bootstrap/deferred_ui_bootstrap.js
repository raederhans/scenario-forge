import { initTranslations } from "../ui/i18n.js";

const DEFERRED_UI_MODULE_PATHS = Object.freeze([
  "../ui/toolbar.js",
  "../ui/sidebar.js",
  "../ui/scenario_controls.js",
  "../ui/styled_selects.js",
  "../ui/shortcuts.js",
]);

const UI_INTERACTION_ROOT_IDS = Object.freeze([
  "editorProjectBar",
  "leftSidebar",
  "rightSidebar",
  "bottomDock",
  "scenarioContextBar",
  "zoomControls",
]);
const UI_INTERACTION_ROOT_SELECTORS = Object.freeze([".map-overlay-controls"]);

function normalizeUiHydrationStatus(status) {
  const normalized = String(status || "pending").trim().toLowerCase();
  return normalized === "ready" || normalized === "failed" ? normalized : "pending";
}

function getTimeoutFn(globalScope) {
  return typeof globalScope?.setTimeout === "function"
    ? globalScope.setTimeout.bind(globalScope)
    : globalThis.setTimeout.bind(globalThis);
}

export async function yieldToMain({ globalScope = globalThis } = {}) {
  if (typeof globalScope?.scheduler?.yield === "function") {
    await globalScope.scheduler.yield();
    return;
  }
  await new Promise((resolve) => {
    getTimeoutFn(globalScope)(resolve, 0);
  });
}

export function attachDeferredUiBootstrapRejectionObserver(promise) {
  if (!promise || typeof promise.then !== "function") {
    return promise;
  }
  void Promise.resolve(promise).catch(() => {});
  return promise;
}

export function createDeferredUiBootstrapper({
  globalScope = globalThis,
  documentRef = globalThis.document,
  importModule = (path) => import(path),
  initTranslationsFn = initTranslations,
} = {}) {
  let deferredUiBootstrapPromise = null;

  function setInteractionState(status = "pending") {
    const normalizedStatus = normalizeUiHydrationStatus(status);
    const ready = normalizedStatus === "ready";
    if (documentRef?.body?.dataset) {
      documentRef.body.dataset.uiHydrationState = normalizedStatus;
    }
    const interactionRoots = new Set(
      UI_INTERACTION_ROOT_IDS
        .map((rootId) => documentRef?.getElementById?.(rootId))
        .filter(Boolean),
    );
    for (const selector of UI_INTERACTION_ROOT_SELECTORS) {
      documentRef?.querySelectorAll?.(selector)?.forEach((root) => interactionRoots.add(root));
    }
    for (const root of interactionRoots) {
      root.inert = !ready;
      root.setAttribute?.("aria-disabled", ready ? "false" : "true");
      if (normalizedStatus === "pending") {
        root.setAttribute?.("aria-busy", "true");
      } else {
        root.removeAttribute?.("aria-busy");
      }
    }
    return normalizedStatus;
  }

  function bootstrapDeferredUi(renderApp) {
    if (deferredUiBootstrapPromise) {
      return deferredUiBootstrapPromise;
    }
    deferredUiBootstrapPromise = (async () => {
      const [
        { initToolbar },
        { initSidebar },
        { initScenarioControls },
        { initStyledSelects },
        { initShortcuts },
      ] = await Promise.all(DEFERRED_UI_MODULE_PATHS.map((path) => importModule(path)));
      await yieldToMain({ globalScope });
      initToolbar({ render: renderApp });
      await yieldToMain({ globalScope });
      initSidebar({ render: renderApp });
      await yieldToMain({ globalScope });
      initStyledSelects();
      await yieldToMain({ globalScope });
      initScenarioControls();
      initTranslationsFn();
      initShortcuts();
      return true;
    })();
    attachDeferredUiBootstrapRejectionObserver(deferredUiBootstrapPromise);
    return deferredUiBootstrapPromise;
  }

  function reset() {
    deferredUiBootstrapPromise = null;
  }

  function getPromise() {
    return deferredUiBootstrapPromise;
  }

  return {
    bootstrapDeferredUi,
    setInteractionState,
    reset,
    getPromise,
  };
}
