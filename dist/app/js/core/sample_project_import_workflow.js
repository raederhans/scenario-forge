import { importProjectTextThroughFunnel } from "./interaction_funnel.js";
import {
  loadSampleProjectText,
  SampleProjectLoadError,
} from "./sample_project_registry.js";
import { replaceSampleProjectDeeplinkState } from "./state/actions/boot_actions.js";
import { callRuntimeHook } from "./state/index.js";

function getNow() {
  return Date.now();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function resolvePreviousSampleState(currentState = {}, patch = {}) {
  // Guide 切换失败时仍要展示上一个已成功导入的样例；success 会提交新样例并清掉 previous* 快照。
  if (String(patch.status || "") === "success") {
    return {
      previousSampleId: "",
      previousScenarioId: "",
      previousTitle: "",
      previousRecommendedExport: null,
    };
  }
  if (String(currentState?.status || "") === "success") {
    return {
      previousSampleId: normalizeText(currentState.sampleId),
      previousScenarioId: normalizeText(currentState.scenarioId),
      previousTitle: normalizeText(currentState.title),
      previousRecommendedExport: currentState.recommendedExport || null,
    };
  }
  return {
    previousSampleId: normalizeText(currentState?.previousSampleId),
    previousScenarioId: normalizeText(currentState?.previousScenarioId),
    previousTitle: normalizeText(currentState?.previousTitle),
    previousRecommendedExport: currentState?.previousRecommendedExport || null,
  };
}

export function writeSampleProjectState(targetState, patch = {}) {
  if (!targetState || typeof targetState !== "object") {
    return null;
  }
  const currentState = targetState?.sampleProjectDeeplink && typeof targetState.sampleProjectDeeplink === "object"
    ? targetState.sampleProjectDeeplink
    : {};
  const nextState = {
    ...currentState,
    ...resolvePreviousSampleState(currentState, patch),
    ...patch,
    updatedAt: getNow(),
  };
  const committedState = replaceSampleProjectDeeplinkState(targetState, nextState);
  // runtime hook 是 Project banner 和 Guide sample card 的共同刷新入口；状态写入后立即广播，避免两个 UI 面板读到不同阶段。
  callRuntimeHook(targetState, "refreshSampleProjectBannerFn", committedState);
  return committedState;
}

export function resolveSampleProjectError(error) {
  if (error instanceof SampleProjectLoadError) {
    return error;
  }
  return new SampleProjectLoadError(
    "sample-project-load-failed",
    String(error?.message || error || "Sample project could not be opened."),
    { userMessage: "The selected sample project could not be opened." },
  );
}

function translateSampleUiText(value, helpers = {}) {
  const translate = typeof helpers.t === "function"
    ? helpers.t
    : (typeof helpers.ui?.t === "function" ? helpers.ui.t : null);
  return typeof translate === "function"
    ? translate(String(value || ""), "ui")
    : String(value || "");
}

export function showSampleProjectError(error, helpers = {}) {
  const resolvedError = resolveSampleProjectError(error);
  if (typeof helpers.showToast === "function") {
    helpers.showToast(
      translateSampleUiText(resolvedError.userMessage, helpers),
      {
        title: translateSampleUiText(resolvedError.toastTitle, helpers),
        tone: resolvedError.toastTone,
        duration: 4200,
      },
    );
  }
  return resolvedError;
}

export async function loadPublicSampleProjectIntoRuntime(sampleId, {
  targetState,
  helpers = {},
} = {}) {
  const requestedSampleId = normalizeText(sampleId).toLowerCase();
  try {
    // 状态顺序是 UI 合同：loading 表示已接管请求，importing 表示项目文本已通过 allowlist 取回并开始进入通用导入漏斗。
    writeSampleProjectState(targetState, {
      status: "loading",
      sampleId: requestedSampleId,
      errorCode: "",
      errorMessage: "",
    });
    const { sampleProject, text } = await loadSampleProjectText(requestedSampleId, {
      fetchImpl: helpers.fetchImpl,
      manifestUrl: helpers.manifestUrl,
      projectBaseUrl: helpers.projectBaseUrl,
    });
    writeSampleProjectState(targetState, {
      status: "importing",
      sampleId: sampleProject.id,
      scenarioId: sampleProject.scenarioId,
      projectUrl: sampleProject.projectUrl,
      appProjectUrl: sampleProject.appProjectUrl,
      fileName: sampleProject.fileName,
      title: sampleProject.title,
      manifestVersion: sampleProject.manifestVersion,
      recipe: sampleProject.recipe,
      recommendedExport: sampleProject.recommendedExport,
    });

    const imported = await importProjectTextThroughFunnel(text, {
      fileName: sampleProject.fileName,
      ui: helpers.ui,
      hooks: helpers.hooks,
      importOptions: {
        successTitle: "Sample opened",
        successMessage: "Sample project loaded in the editor.",
        ...(helpers.importOptions && typeof helpers.importOptions === "object" ? helpers.importOptions : {}),
      },
    });
    if (!imported || (imported !== true && !["committed", "committed-with-warnings"].includes(imported.status))) {
      writeSampleProjectState(targetState, {
        status: "error",
        sampleId: sampleProject.id,
        scenarioId: sampleProject.scenarioId,
        projectUrl: sampleProject.projectUrl,
        appProjectUrl: sampleProject.appProjectUrl,
        fileName: sampleProject.fileName,
        title: sampleProject.title,
        recommendedExport: sampleProject.recommendedExport,
        errorCode: "sample-project-import-failed",
        errorMessage: `Sample project import failed: ${sampleProject.id}`,
      });
      return { ok: false, sampleProject, errorCode: "sample-project-import-failed" };
    }
    writeSampleProjectState(targetState, {
      status: "success",
      sampleId: sampleProject.id,
      scenarioId: sampleProject.scenarioId,
      projectUrl: sampleProject.projectUrl,
      appProjectUrl: sampleProject.appProjectUrl,
      fileName: sampleProject.fileName,
      title: sampleProject.title,
      manifestVersion: sampleProject.manifestVersion,
      recipe: sampleProject.recipe,
      recommendedExport: sampleProject.recommendedExport,
      completedAt: getNow(),
    });
    return { ok: true, sampleProject };
  } catch (error) {
    const resolvedError = showSampleProjectError(error, helpers);
    writeSampleProjectState(targetState, {
      status: "error",
      sampleId: requestedSampleId,
      errorCode: resolvedError.code,
      errorMessage: resolvedError.message,
    });
    return { ok: false, error: resolvedError };
  }
}
