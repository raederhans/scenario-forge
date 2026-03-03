import { state } from "../core/state.js";
import { FileManager } from "../core/file_manager.js";
import { redoHistory, undoHistory } from "../core/history_manager.js";
import { resetZoomToFit, undoSpecialZoneVertex, zoomByStep } from "../core/map_renderer.js";

function isEditableTarget(target) {
  const node = target instanceof Element ? target : null;
  if (!node) return false;
  if (node.closest('input, textarea, select, [contenteditable="true"]')) {
    return true;
  }
  return false;
}

function setCurrentTool(tool) {
  state.currentTool = tool;
  if (typeof state.updateToolUIFn === "function") {
    state.updateToolUIFn();
  }
}

function refreshAfterSpecialZoneShortcut() {
  if (typeof state.updateSpecialZoneEditorUIFn === "function") {
    state.updateSpecialZoneEditorUIFn();
  }
  if (typeof state.renderNowFn === "function") {
    state.renderNowFn();
  }
}

function initShortcuts() {
  if (document.body?.dataset.shortcutsBound === "true") return;

  window.addEventListener("keydown", (event) => {
    const key = String(event.key || "");
    const lower = key.toLowerCase();
    const modifier = event.metaKey || event.ctrlKey;

    if (modifier && lower === "s") {
      event.preventDefault();
      FileManager.exportProject(state);
      return;
    }

    if (isEditableTarget(event.target)) {
      return;
    }

    if (modifier && lower === "z") {
      event.preventDefault();
      if (state.specialZoneEditor?.active) {
        undoSpecialZoneVertex();
        refreshAfterSpecialZoneShortcut();
        return;
      }
      if (event.shiftKey) {
        redoHistory();
      } else {
        undoHistory();
      }
      return;
    }

    if (modifier && lower === "y") {
      event.preventDefault();
      redoHistory();
      return;
    }

    if (!modifier && lower === "f") {
      event.preventDefault();
      setCurrentTool("fill");
      return;
    }
    if (!modifier && lower === "e") {
      event.preventDefault();
      setCurrentTool("eraser");
      return;
    }
    if (!modifier && lower === "i") {
      event.preventDefault();
      setCurrentTool("eyedropper");
      return;
    }
    if (!modifier && (key === "+" || key === "=")) {
      event.preventDefault();
      zoomByStep(1);
      return;
    }
    if (!modifier && (key === "-" || key === "_")) {
      event.preventDefault();
      zoomByStep(-1);
      return;
    }
    if (!modifier && key === "0") {
      event.preventDefault();
      resetZoomToFit();
    }
  });

  if (document.body) {
    document.body.dataset.shortcutsBound = "true";
  }
}

export { initShortcuts };
