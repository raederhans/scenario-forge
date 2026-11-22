import { t } from "../core/i18n.js";
import { callRuntimeHook } from "../core/state/index.js";
import { setSharedProjectLinkState } from "../core/state/actions/boot_actions.js";
import {
  clearSharedProjectUrlState, getSharedProjectLinkFromUrl, SHARED_PROJECT_ERRORS, validateSharedProjectUrl,
} from "../core/shared_project_url.js";

export function initializeSharedProjectLink(state) {
  const raw = getSharedProjectLinkFromUrl();
  if (raw !== null) {
    clearSharedProjectUrlState(["sample", "sample_project"]);
    setSharedProjectLinkState(state, { status: "pending" });
  }
  return raw;
}

export async function openStartupSharedProject(state, raw, options = {}) {
  if (state.sharedProjectLink?.status !== "pending" || state.bootPhase !== "ready"
    || state.uiHydrationStatus !== "ready") return;
  const updateState = patch => {
    const next = setSharedProjectLinkState(state, patch);
    callRuntimeHook(state, "refreshSampleProjectBannerFn", next);
    return next;
  };
  const showAppDialog = options.showAppDialog ?? (dialog => callRuntimeHook(state, "showAppDialogFn", dialog));
  try {
    const url = validateSharedProjectUrl(raw);
    updateState({ host: url.host, status: "confirming" });
    const { importSharedProject } = await import("../core/shared_project_import_workflow.js");
    const warning = t("This replaces the current map. Nothing of yours is uploaded. Only open links you trust.", "ui");
    const confirmed = await showAppDialog({
      title: t("Open shared project?", "ui"),
      message: t("Source: {host}", "ui").replace("{host}", () => url.host),
      details: state.isDirty ? warning + "\n" + t("Unsaved changes will be discarded.", "ui") : warning,
      confirmLabel: t("Open", "ui"), cancelLabel: t("Don't open", "ui"), tone: "warning",
    });
    if (!confirmed) return updateState({ status: "cancelled" });
    return await importSharedProject(url.href, {
      ...options, state, updateState,
      ui: { t, showAppDialog, showToast: (...args) => callRuntimeHook(state, "showToastFn", ...args) },
      hooks: { refreshColorState: patch => callRuntimeHook(state, "refreshColorStateFn", patch) },
    });
  } catch (error) {
    const errorCode = Object.hasOwn(SHARED_PROJECT_ERRORS, error.code) ? error.code
      : state.sharedProjectLink.status === "loading" ? "fetch-failed" : "import-failed";
    return updateState({ status: "error", errorCode });
  } finally {
    clearSharedProjectUrlState();
  }
}
