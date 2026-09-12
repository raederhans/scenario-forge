import {
  normalizeSampleExportRecommendation,
  resolveSampleExportRecommendationContext,
} from "../../core/sample_export_recommendation.js";

const SAMPLE_PROJECT_BANNER_VISIBLE_STATUSES = new Set(["success", "error"]);
const SAMPLE_PROJECT_IN_FLIGHT_STATUSES = new Set(["pending", "loading", "importing"]);

const ERROR_MESSAGE_BY_CODE = Object.freeze({
  "invalid-sample-id": "This sample link is not valid.",
  "unknown-sample-id": "This sample project is not in the public sample list.",
  "private-sample-scenario": "This sample project is not available in the public demo.",
  "unsafe-project-url": "This sample link points outside the public sample project list.",
  "unsafe-project-file": "This sample project file is not available.",
  "fetch-unavailable": "Sample projects cannot be opened in this browser session.",
  "manifest-fetch-failed": "The sample project list could not be loaded.",
  "invalid-manifest": "The sample project list is not valid.",
  "project-fetch-failed": "The selected sample project could not be loaded.",
  "sample-project-import-failed": "The sample project file could not be imported.",
  "sample-project-load-failed": "The selected sample project could not be opened.",
});

function identityT(key) {
  return String(key || "");
}

function localize(t, key) {
  return (typeof t === "function" ? t : identityT)(key, "ui");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeSampleProjectEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      id: normalizeText(entry?.id),
      title: normalizeText(entry?.title),
      scenarioId: normalizeText(entry?.scenarioId || entry?.scenario_id),
      projectUrl: normalizeText(entry?.projectUrl || entry?.project_url),
      appProjectUrl: normalizeText(entry?.appProjectUrl),
      fileName: normalizeText(entry?.fileName),
      recipe: Array.isArray(entry?.recipe)
        ? entry.recipe.map((step) => normalizeText(step)).filter(Boolean)
        : [],
      recommendedExport: normalizeSampleExportRecommendation(entry?.recommendedExport || entry?.recommended_export),
    }))
    .filter((entry) => entry.id);
}

function resolveOriginalDownloadUrl(sampleState) {
  const appProjectUrl = normalizeText(sampleState?.appProjectUrl);
  if (appProjectUrl) return appProjectUrl;
  const projectUrl = normalizeText(sampleState?.projectUrl);
  if (projectUrl.startsWith("./assets/")) {
    return `../${projectUrl.slice(2)}`;
  }
  return projectUrl;
}

function createDismissKey(sampleState) {
  return [
    normalizeText(sampleState?.status),
    normalizeText(sampleState?.sampleId),
    normalizeText(sampleState?.errorCode),
    normalizeText(sampleState?.errorMessage),
  ].join("|");
}

function resolveErrorMessage(sampleState, t) {
  const errorCode = normalizeText(sampleState?.errorCode);
  const catalogMessage = ERROR_MESSAGE_BY_CODE[errorCode];
  if (catalogMessage) return localize(t, catalogMessage);
  return normalizeText(sampleState?.errorMessage)
    || localize(t, "The selected sample project could not be opened.");
}

function resolveCommittedSampleId(sampleState) {
  const status = normalizeText(sampleState?.status);
  if (status === "success") return normalizeText(sampleState?.sampleId);
  return normalizeText(sampleState?.previousSampleId);
}

export function resolveSampleProjectBannerView(sampleState, { t = identityT } = {}) {
  const status = normalizeText(sampleState?.status);
  if (!SAMPLE_PROJECT_BANNER_VISIBLE_STATUSES.has(status)) {
    return null;
  }

  const sampleId = normalizeText(sampleState?.sampleId);
  const sampleTitle = normalizeText(sampleState?.title) || sampleId || localize(t, "selected sample");
  const downloadHref = resolveOriginalDownloadUrl(sampleState);
  if (status === "success") {
    return {
      status,
      tone: "success",
      sampleId,
      dismissKey: createDismissKey(sampleState),
      title: `${localize(t, "Sample loaded")}: ${sampleTitle}`,
      body: localize(
        t,
        "Edit this starter map, then export your own image or download the original sample JSON.",
      ),
      openExportLabel: localize(t, "Open export workbench"),
      downloadOriginalLabel: localize(t, "Download original JSON"),
      dismissLabel: localize(t, "Dismiss sample message"),
      canOpenExport: true,
      canDownloadOriginal: !!downloadHref,
      downloadHref,
      downloadName: normalizeText(sampleState?.fileName),
    };
  }

  return {
    status,
    tone: "error",
    sampleId,
    dismissKey: createDismissKey(sampleState),
    title: localize(t, "Sample unavailable"),
    body: resolveErrorMessage(sampleState, t),
    openExportLabel: localize(t, "Open export workbench"),
    downloadOriginalLabel: localize(t, "Download original JSON"),
    dismissLabel: localize(t, "Dismiss sample message"),
    canOpenExport: false,
    canDownloadOriginal: false,
    downloadHref: "",
    downloadName: "",
  };
}

function createStarterSampleProjectGuideContext({
  t = identityT,
  tone = "neutral",
  body = "",
  selectedSampleId = "",
  sampleProjects = [],
} = {}) {
  return {
    status: "starter",
    tone,
    sampleId: "",
    scenarioId: "",
    projectUrl: "",
    appProjectUrl: "",
    fileName: "",
    title: localize(t, "Load a starter sample"),
    body: normalizeText(body) || localize(
      t,
      "Choose a checked-in public starter sample to open it in the editor.",
    ),
    openExportLabel: localize(t, "Open export"),
    downloadOriginalLabel: localize(t, "Download original JSON"),
    continueLabel: localize(t, "Continue with default guide"),
    switcherTitle: localize(t, "Load a starter sample"),
    switcherBody: localize(t, "Samples open from the public checked-in project list."),
    canOpenExport: false,
    canDownloadOriginal: false,
    canContinue: false,
    downloadHref: "",
    downloadName: "",
    selectedSampleId,
    sampleProjects: normalizeSampleProjectEntries(sampleProjects),
  };
}

export function resolveSampleProjectGuideContext(runtimeState, { t = identityT, sampleProjects = [] } = {}) {
  const sampleState = runtimeState?.sampleProjectDeeplink;
  const status = normalizeText(sampleState?.status);
  const publicSampleProjects = normalizeSampleProjectEntries(sampleProjects);
  if (!SAMPLE_PROJECT_BANNER_VISIBLE_STATUSES.has(status) && !publicSampleProjects.length) {
    return null;
  }

  const sampleId = normalizeText(sampleState?.sampleId);
  const selectedSampleId = resolveCommittedSampleId(sampleState);
  const sampleTitle = normalizeText(sampleState?.title) || sampleId || localize(t, "selected sample");
  const downloadHref = resolveOriginalDownloadUrl(sampleState);
  const exportRecommendation = resolveSampleExportRecommendationContext(runtimeState, {
    sampleProjects: publicSampleProjects,
  });
  // Guide card 同时服务“已加载样例”“样例不可用”“可选择 starter”三种状态；selectedSampleId 绑定已提交样例，避免失败切换时高亮漂到未导入项目。
  if (status === "success") {
    return {
      status,
      tone: "success",
      sampleId,
      scenarioId: normalizeText(sampleState?.scenarioId),
      projectUrl: normalizeText(sampleState?.projectUrl),
      appProjectUrl: normalizeText(sampleState?.appProjectUrl),
      fileName: normalizeText(sampleState?.fileName),
      title: `${localize(t, "Sample loaded")}: ${sampleTitle}`,
      body: localize(
        t,
        "This is an editable sample project. Export an image or save your own project copy when you are ready.",
      ),
      recommendedExportLabel: exportRecommendation
        ? `${localize(t, "Recommended export")}: ${exportRecommendation.recommendationLabel}`
        : "",
      openExportLabel: localize(t, "Open export"),
      downloadOriginalLabel: localize(t, "Download original JSON"),
      continueLabel: localize(t, "Continue with default guide"),
      switcherTitle: localize(t, "Load another sample"),
      switcherBody: localize(
        t,
        "Switching samples replaces the current workspace after confirmation when unsaved edits exist.",
      ),
      canOpenExport: true,
      canDownloadOriginal: !!downloadHref,
      canContinue: false,
      downloadHref,
      downloadName: normalizeText(sampleState?.fileName),
      selectedSampleId,
      sampleProjects: publicSampleProjects,
    };
  }

  if (!SAMPLE_PROJECT_BANNER_VISIBLE_STATUSES.has(status)) {
    return createStarterSampleProjectGuideContext({
      t,
      selectedSampleId,
      sampleProjects: publicSampleProjects,
    });
  }

  return {
    status,
    tone: "error",
    sampleId,
    scenarioId: normalizeText(sampleState?.scenarioId),
    projectUrl: normalizeText(sampleState?.projectUrl),
    appProjectUrl: normalizeText(sampleState?.appProjectUrl),
    fileName: normalizeText(sampleState?.fileName),
    title: localize(t, "Sample unavailable"),
    body: resolveErrorMessage(sampleState, t),
    recommendedExportLabel: "",
    openExportLabel: localize(t, "Open export"),
    downloadOriginalLabel: localize(t, "Download original JSON"),
    continueLabel: localize(t, "Continue with default guide"),
    switcherTitle: localize(t, "Load another sample"),
    switcherBody: localize(t, "Choose another checked-in public starter sample."),
    canOpenExport: false,
    canDownloadOriginal: false,
    canContinue: true,
    downloadHref: "",
    downloadName: "",
    selectedSampleId,
    sampleProjects: publicSampleProjects,
  };
}

function setElementHidden(element, hidden) {
  if (!element) return;
  element.hidden = !!hidden;
  element.classList.toggle("hidden", !!hidden);
  element.setAttribute("aria-hidden", hidden ? "true" : "false");
}

function setActionHidden(element, hidden) {
  if (!element) return;
  element.hidden = !!hidden;
  element.classList.toggle("hidden", !!hidden);
}

export function createSampleProjectBannerController(runtimeState, {
  root,
  titleNode,
  bodyNode,
  openExportButton,
  downloadOriginalLink,
  dismissButton,
  t = identityT,
  openExportWorkbench = null,
} = {}) {
  let dismissedKey = "";
  let bound = false;

  const controller = {
    render() {
      const view = resolveSampleProjectBannerView(runtimeState?.sampleProjectDeeplink, { t });
      if (!root || !view || dismissedKey === view.dismissKey) {
        setElementHidden(root, true);
        return null;
      }

      root.dataset.sampleProjectBannerTone = view.tone;
      root.dataset.sampleProjectStatus = view.status;
      root.setAttribute("role", view.tone === "error" ? "alert" : "status");
      root.setAttribute("aria-live", view.tone === "error" ? "assertive" : "polite");
      if (titleNode) titleNode.textContent = view.title;
      if (bodyNode) bodyNode.textContent = view.body;

      if (openExportButton) {
        openExportButton.textContent = view.openExportLabel;
      }
      setActionHidden(openExportButton, !view.canOpenExport);

      if (downloadOriginalLink) {
        downloadOriginalLink.textContent = view.downloadOriginalLabel;
        if (view.canDownloadOriginal) {
          downloadOriginalLink.setAttribute("href", view.downloadHref);
          if (view.downloadName) {
            downloadOriginalLink.setAttribute("download", view.downloadName);
          } else {
            downloadOriginalLink.setAttribute("download", "");
          }
        } else {
          downloadOriginalLink.removeAttribute("href");
        }
      }
      setActionHidden(downloadOriginalLink, !view.canDownloadOriginal);

      if (dismissButton) {
        dismissButton.setAttribute("aria-label", view.dismissLabel);
        dismissButton.setAttribute("title", view.dismissLabel);
      }
      setElementHidden(root, false);
      return view;
    },

    bindEvents() {
      if (bound) return;
      bound = true;
      openExportButton?.addEventListener("click", () => {
        if (typeof openExportWorkbench === "function") {
          openExportWorkbench(openExportButton);
        }
      });
      dismissButton?.addEventListener("click", () => {
        const view = resolveSampleProjectBannerView(runtimeState?.sampleProjectDeeplink, { t });
        dismissedKey = view?.dismissKey || "";
        setElementHidden(root, true);
      });
    },
  };

  return controller;
}

export function createSampleProjectGuideCardController(runtimeState, {
  root,
  titleNode,
  bodyNode,
  recommendationNode,
  openExportButton,
  downloadOriginalLink,
  continueButton,
  sampleListNode,
  sampleListStatusNode,
  t = identityT,
  openExportWorkbench = null,
  continueWithDefaultGuide = null,
  onSampleChoice = null,
} = {}) {
  let bound = false;
  let sampleProjects = [];
  let switcherStatus = "idle";
  let switcherMessage = "";
  let activeChoiceId = "";

  const setStatusMessage = (message = "") => {
    if (!sampleListStatusNode) return;
    const normalizedMessage = normalizeText(message);
    sampleListStatusNode.textContent = normalizedMessage;
    setElementHidden(sampleListStatusNode, !normalizedMessage);
  };

  const renderSampleChoices = (view) => {
    if (!sampleListNode) return;
    const choices = normalizeSampleProjectEntries(view?.sampleProjects);
    const sampleState = runtimeState?.sampleProjectDeeplink || {};
    const stateStatus = normalizeText(sampleState.status);
    // pending/loading/importing 都算同一条切换事务，列表在事务内整体禁用，只用 aria-busy 标出当前请求项。
    const busy = SAMPLE_PROJECT_IN_FLIGHT_STATUSES.has(stateStatus) || switcherStatus === "loading";
    const activeBusyId = normalizeText(activeChoiceId || sampleState.sampleId);
    if (typeof sampleListNode.replaceChildren === "function") {
      sampleListNode.replaceChildren();
    } else {
      sampleListNode.children = [];
    }
    setElementHidden(sampleListNode, !choices.length);
    choices.forEach((entry) => {
      const selected = entry.id === view.selectedSampleId;
      const choiceBusy = busy && entry.id === activeBusyId;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "scenario-guide-sample-choice";
      button.dataset.sampleGuideChoice = entry.id;
      button.disabled = busy;
      button.setAttribute("aria-current", selected ? "true" : "false");
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      if (choiceBusy) {
        button.setAttribute("aria-busy", "true");
      } else {
        button.removeAttribute("aria-busy");
      }

      const title = document.createElement("span");
      title.className = "scenario-guide-sample-choice__title";
      title.textContent = entry.title || entry.id;
      const scenario = document.createElement("span");
      scenario.className = "scenario-guide-sample-choice__scenario";
      scenario.textContent = entry.scenarioId;
      button.append(title, scenario);
      button.addEventListener("click", () => {
        if (button.disabled) return;
        if (typeof onSampleChoice === "function") {
          onSampleChoice(entry.id, button);
        }
      });
      if (typeof sampleListNode.appendChild === "function") {
        sampleListNode.appendChild(button);
      } else if (Array.isArray(sampleListNode.children)) {
        sampleListNode.children.push(button);
      }
    });

    if (switcherStatus === "error") {
      setStatusMessage(switcherMessage || localize(t, "The selected sample project could not be opened."));
    } else if (busy) {
      setStatusMessage(localize(t, "Loading selected sample..."));
    } else {
      setStatusMessage("");
    }
  };

  const controller = {
    setSampleProjects(nextSampleProjects = []) {
      sampleProjects = normalizeSampleProjectEntries(nextSampleProjects);
      return controller.render();
    },

    setSwitcherState({
      status = "idle",
      message = "",
      activeSampleId = "",
    } = {}) {
      switcherStatus = normalizeText(status) || "idle";
      switcherMessage = normalizeText(message);
      activeChoiceId = normalizeText(activeSampleId);
      return controller.render();
    },

    render() {
      let view = resolveSampleProjectGuideContext(runtimeState, { t, sampleProjects });
      if (!view && switcherStatus === "error") {
        view = createStarterSampleProjectGuideContext({
          t,
          tone: "error",
          body: switcherMessage || localize(t, "The sample project list could not be loaded."),
        });
      }
      if (!root || !view) {
        setElementHidden(root, true);
        return null;
      }

      root.dataset.sampleGuideStatus = view.status;
      root.dataset.sampleGuideTone = view.tone;
      root.setAttribute("role", view.tone === "error" ? "alert" : "status");
      root.setAttribute("aria-live", view.tone === "error" ? "assertive" : "polite");
      if (titleNode) titleNode.textContent = view.title;
      if (bodyNode) bodyNode.textContent = view.body;
      if (recommendationNode) {
        recommendationNode.textContent = view.recommendedExportLabel || "";
      }
      setElementHidden(recommendationNode, !view.recommendedExportLabel);

      if (openExportButton) {
        openExportButton.textContent = view.openExportLabel;
      }
      setActionHidden(openExportButton, !view.canOpenExport);

      if (downloadOriginalLink) {
        downloadOriginalLink.textContent = view.downloadOriginalLabel;
        if (view.canDownloadOriginal) {
          downloadOriginalLink.setAttribute("href", view.downloadHref);
          if (view.downloadName) {
            downloadOriginalLink.setAttribute("download", view.downloadName);
          } else {
            downloadOriginalLink.setAttribute("download", "");
          }
        } else {
          downloadOriginalLink.removeAttribute("href");
        }
      }
      setActionHidden(downloadOriginalLink, !view.canDownloadOriginal);

      if (continueButton) {
        continueButton.textContent = view.continueLabel;
      }
      setActionHidden(continueButton, !view.canContinue);

      renderSampleChoices(view);
      setElementHidden(root, false);
      return view;
    },

    bindEvents() {
      if (bound) return;
      bound = true;
      openExportButton?.addEventListener("click", () => {
        if (typeof openExportWorkbench === "function") {
          openExportWorkbench(openExportButton);
        }
      });
      continueButton?.addEventListener("click", () => {
        if (typeof continueWithDefaultGuide === "function") {
          continueWithDefaultGuide(continueButton);
        }
      });
    },
  };

  return controller;
}
