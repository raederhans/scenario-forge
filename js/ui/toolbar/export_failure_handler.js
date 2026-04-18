// Export workbench failure classifier.
// 这个模块只负责把导出错误归类并转成用户可读 toast，
// 不负责导出流程、状态读写或 workbench UI 编排。

import { t } from "../i18n.js";
import { showToast } from "../toast.js";

function createExportError(kind, message) {
  const error = new Error(message);
  error.exportKind = kind;
  return error;
}

function classifyExportFailure(error) {
  const kind = String(error?.exportKind || "").trim();
  if (kind) return kind;
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("svg overlay export failed") || message.includes("tainted")) return "svg-cors";
  if (message.includes("memory") || message.includes("allocation") || message.includes("out of memory")) return "out-of-memory";
  return "invalid-params";
}

function showExportFailureToast(error) {
  const failureKind = classifyExportFailure(error);
  if (failureKind === "out-of-memory") {
    showToast(
      t("Export failed: not enough available memory. Reduce export resolution (for example 2× → 1×), close heavy tabs, then retry.", "ui"),
      { title: t("Export failed · Out of memory", "ui"), tone: "error", duration: 7000 }
    );
    return;
  }
  if (failureKind === "svg-cors") {
    showToast(
      t("Export failed: SVG overlay includes cross-origin assets. Use same-origin assets, remove cross-origin images, or hide SVG overlays before retrying.", "ui"),
      { title: t("Export failed · Cross-origin SVG", "ui"), tone: "warning", duration: 7600 }
    );
    return;
  }
  showToast(
    t("Export failed: invalid parameters. Check export scale and format, then retry.", "ui"),
    { title: t("Export failed · Invalid parameters", "ui"), tone: "warning", duration: 6200 }
  );
}

export {
  createExportError,
  classifyExportFailure,
  showExportFailureToast,
};
