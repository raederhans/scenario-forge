import {
  loadPublicSampleProjectIntoRuntime,
  writeSampleProjectState,
} from "../core/sample_project_import_workflow.js";
import {
  getSampleProjectIdFromUrl,
} from "../core/sample_project_registry.js";

export const STARTUP_SAMPLE_PROJECT_TASK_KEY = "startup-sample-project-import";

export function scheduleStartupSampleProjectDeeplink({
  targetState,
  postReadyScheduler,
  helpers = {},
} = {}) {
  if (!targetState || typeof targetState !== "object" || !postReadyScheduler) {
    return false;
  }
  if (
    String(targetState.uiHydrationStatus || "pending") !== "ready"
    || String(targetState.bootPhase || "") !== "ready"
  ) {
    return false;
  }
  const sampleId = getSampleProjectIdFromUrl({
    search: helpers.search,
    searchParamsCtor: helpers.searchParamsCtor,
  });
  if (!sampleId) return false;

  const existingState = targetState.sampleProjectDeeplink;
  // sample deeplink 只排进 post-ready 阶段；这里挡住同一个样例已排队或正在/已经导入时的重复调度。
  if (
    existingState?.sampleId === sampleId
    && ["pending", "loading", "importing", "success"].includes(String(existingState.status || ""))
  ) {
    return false;
  }

  writeSampleProjectState(targetState, {
    status: "pending",
    sampleId,
    scenarioId: "",
    projectUrl: "",
    appProjectUrl: "",
    fileName: "",
    title: "",
    errorCode: "",
    errorMessage: "",
  });

  const scheduleOptions = helpers.scheduleOptions && typeof helpers.scheduleOptions === "object"
    ? helpers.scheduleOptions
    : {};
  postReadyScheduler.scheduleTask(
    STARTUP_SAMPLE_PROJECT_TASK_KEY,
    async (task) => {
      try {
        await loadPublicSampleProjectIntoRuntime(sampleId, { targetState, helpers });
      } finally {
        if (!task || task.isCurrent()) helpers.onSettled?.();
      }
    },
    {
      ...scheduleOptions,
      allowChunkBacklog: true,
      idleQuietMs: 0,
      minIdleTimeRemainingMs: 0,
    },
  );
  return true;
}

export function tryScheduleStartupSampleProjectDeeplink(options = {}) {
  return scheduleStartupSampleProjectDeeplink(options);
}
