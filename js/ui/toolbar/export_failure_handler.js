// Export workbench failure classifier.
// 这个模块只负责把导出错误归类并转成用户可读 toast，
// 不负责导出流程、状态读写或 workbench UI 编排。

import { t } from "../i18n.js";
import { showToast } from "../toast.js";

const EXPORT_FAILURE_KINDS = Object.freeze({
  ARTIFACT_FAILED: "artifact-failed",
  DOWNLOAD_FAILED: "download-failed",
  INVALID_PARAMS: "invalid-params",
  OUT_OF_MEMORY: "out-of-memory",
  SVG_CORS: "svg-cors",
});

function createExportError(kind, message) {
  const error = new Error(message);
  error.exportKind = kind;
  return error;
}

function classifyExportFailure(error) {
  const kind = String(error?.exportKind || "").trim();
  if (Object.values(EXPORT_FAILURE_KINDS).includes(kind)) return kind;
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("svg overlay export failed") || message.includes("tainted")) return EXPORT_FAILURE_KINDS.SVG_CORS;
  if (message.startsWith("export render budget exceeded (") || message.includes("memory") || message.includes("allocation") || message.includes("out of memory")) return EXPORT_FAILURE_KINDS.OUT_OF_MEMORY;
  const stage = String(error?.exportStage || "").trim();
  if (stage === "download") return EXPORT_FAILURE_KINDS.DOWNLOAD_FAILED;
  if (stage === "artifact") return EXPORT_FAILURE_KINDS.ARTIFACT_FAILED;
  return EXPORT_FAILURE_KINDS.INVALID_PARAMS;
}

function assertRequiredCallableDependency(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`createExportFailureToastHandler requires ${name} to be a function.`);
  }
}

function createExportFailureToastHandler({
  t: translate,
  showToast: presentToast,
} = {}) {
  assertRequiredCallableDependency(translate, "t");
  assertRequiredCallableDependency(presentToast, "showToast");

  return (error) => {
    const failureKind = classifyExportFailure(error);
    if (failureKind === EXPORT_FAILURE_KINDS.OUT_OF_MEMORY) {
      presentToast(
        translate("Export failed: not enough available memory. Reduce export resolution (for example 2× → 1×), close heavy tabs, then retry.", "ui"),
        { title: translate("Export failed · Out of memory", "ui"), tone: "error", duration: 7000 }
      );
      return failureKind;
    }
    if (failureKind === EXPORT_FAILURE_KINDS.SVG_CORS) {
      presentToast(
        translate("Export failed: SVG overlay includes cross-origin assets. Use same-origin assets, remove cross-origin images, or hide SVG overlays before retrying.", "ui"),
        { title: translate("Export failed · Cross-origin SVG", "ui"), tone: "warning", duration: 7600 }
      );
      return failureKind;
    }
    if (failureKind === EXPORT_FAILURE_KINDS.DOWNLOAD_FAILED) {
      presentToast(
        translate("Export is ready, but the download could not start. Check browser download permissions, then retry.", "ui"),
        { title: translate("Export failed · Download unavailable", "ui"), tone: "warning", duration: 6200 }
      );
      return failureKind;
    }
    if (failureKind === EXPORT_FAILURE_KINDS.ARTIFACT_FAILED) {
      presentToast(
        translate("Export artifact could not be created. Check export settings, then retry.", "ui"),
        { title: translate("Export failed · Artifact unavailable", "ui"), tone: "warning", duration: 6200 }
      );
      return failureKind;
    }
    if (/^Export (?:size exceeds 8K cap|pixel budget exceeded) \(\d+x\d+\)\.$/.test(String(error?.message || ""))) {
      presentToast(
        `${translate("Preview rendering and final export resolution are independent. Final export is capped at 8K (7680 × 4320).", "ui")} ${error.message}`,
        { title: translate("Export failed · Invalid parameters", "ui"), tone: "warning", duration: 7000 }
      );
      return failureKind;
    }
    presentToast(
      translate("Export failed: invalid parameters. Check export scale and format, then retry.", "ui"),
      { title: translate("Export failed · Invalid parameters", "ui"), tone: "warning", duration: 6200 }
    );
    return failureKind;
  };
}

function showExportFailureToast(error) {
  return createExportFailureToastHandler({ t, showToast })(error);
}

export {
  EXPORT_FAILURE_KINDS,
  createExportError,
  createExportFailureToastHandler,
  classifyExportFailure,
  showExportFailureToast,
};
