import {
  STATE_BUS_EVENTS,
  callRuntimeHook,
  emitStateBusEvent,
} from "../core/state/index.js";
import { state as runtimeState } from "../core/state.js";
import { FileManager } from "../core/file_manager.js";
import { redoHistory, undoHistory } from "../core/history_manager.js";
import { flushRenderBoundary } from "../core/render_boundary.js";
import {
  cancelActiveStrategicInteractionModes,
  cancelSpecialZoneDraw,
  resetZoomToFit,
  undoSpecialZoneVertex,
  zoomByStep,
} from "../core/map_renderer/public.js";
const state = runtimeState;

function isEditableTarget(target) {
  const node = target instanceof Element ? target : null;
  if (!node) return false;
  if (node.closest('input, textarea, select, [contenteditable="true"]')) {
    return true;
  }
  return false;
}

function flushShortcutRender(reason = "shortcut") {
  return flushRenderBoundary(reason);
}

function setCurrentTool(tool) {
  if (callRuntimeHook(runtimeState, "runToolSelectionFn", tool, { dismissHint: true }) !== undefined) {
    return;
  }
  runtimeState.currentTool = tool;
  if (tool === "eyedropper") {
    runtimeState.brushModeEnabled = false;
    runtimeState.brushPanModifierActive = false;
  }
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_TOOL_UI);
}

function refreshAfterSpecialZoneShortcut() {
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_SPECIAL_ZONE_EDITOR_UI);
  flushShortcutRender("shortcut-special-zone-cancel");
}

function syncToolUi() {
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_TOOL_UI);
}

function toggleBrushMode() {
  if (
    callRuntimeHook(
      runtimeState,
      "runBrushModeToggleFn",
      !runtimeState.brushModeEnabled,
      { dismissHint: true },
    ) !== undefined
  ) {
    return;
  }
  runtimeState.brushModeEnabled = !runtimeState.brushModeEnabled;
  if (runtimeState.brushModeEnabled && runtimeState.currentTool === "eyedropper") {
    runtimeState.currentTool = "fill";
  }
  syncToolUi();
}

function setBrushPanModifier(active) {
  if (runtimeState.brushPanModifierActive === active) return;
  runtimeState.brushPanModifierActive = active;
  syncToolUi();
}

function pickQuickSwatch(index) {
  const swatches = Array.from(document.querySelectorAll("#paletteGrid .color-swatch"));
  const button = swatches[index];
  const color = String(button?.dataset?.color || "").trim();
  if (!color) return false;
  runtimeState.selectedColor = color;
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_SWATCH_UI);
  return true;
}

function cyclePaintGranularity(direction = 1) {
  const select = document.getElementById("paintGranularitySelect");
  if (!select || !select.options?.length) return false;
  const currentIndex = Math.max(0, select.selectedIndex);
  const nextIndex = (currentIndex + direction + select.options.length) % select.options.length;
  select.selectedIndex = nextIndex;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function allowShortcutDuringStartupReadonly({ key = "", modifier = false } = {}) {
  if (modifier) return false;
  return key === "+" || key === "=" || key === "-" || key === "_" || key === "0";
}

function initShortcuts() {
  if (document.body?.dataset.shortcutsBound === "true") return;

  window.addEventListener("keydown", (event) => {
    const key = String(event.key || "");
    const lower = key.toLowerCase();
    const modifier = event.metaKey || event.ctrlKey;
    const editableTarget = isEditableTarget(event.target);

    if (editableTarget) {
      return;
    }

    if (runtimeState.bootBlocking) {
      return;
    }

    if (runtimeState.startupReadonly && !allowShortcutDuringStartupReadonly({ key, modifier })) {
      return;
    }

    if (modifier && event.shiftKey && lower === "d") {
      if (runtimeState.toggleDeveloperModeFn) {
        event.preventDefault();
        callRuntimeHook(runtimeState, "toggleDeveloperModeFn");
      }
      return;
    }

    if (modifier && key === "\\") {
      if (runtimeState.toggleRightPanelFn) {
        event.preventDefault();
        callRuntimeHook(runtimeState, "toggleRightPanelFn");
      }
      return;
    }

    if (!modifier && key === "\\") {
      if (runtimeState.toggleLeftPanelFn) {
        event.preventDefault();
        callRuntimeHook(runtimeState, "toggleLeftPanelFn");
      }
      return;
    }

    if (!modifier && key === "`") {
      if (runtimeState.toggleDockFn) {
        event.preventDefault();
        callRuntimeHook(runtimeState, "toggleDockFn");
      }
      return;
    }

    if (key === "Shift") {
      setBrushPanModifier(true);
    }

    if (key === " ") {
      setBrushPanModifier(true);
    }

    if (modifier && lower === "s") {
      event.preventDefault();
      FileManager.exportProject(runtimeState);
      return;
    }

    if (modifier && lower === "z") {
      event.preventDefault();
      if (runtimeState.specialZoneEditor?.active) {
        undoSpecialZoneVertex();
        refreshAfterSpecialZoneShortcut();
        return;
      }
      if (event.shiftKey) {
        if (runtimeState.runHistoryActionFn) {
          callRuntimeHook(runtimeState, "runHistoryActionFn", "redo");
        } else {
          redoHistory();
        }
      } else {
        if (runtimeState.runHistoryActionFn) {
          callRuntimeHook(runtimeState, "runHistoryActionFn", "undo");
        } else {
          undoHistory();
        }
      }
      return;
    }

    if (modifier && lower === "y") {
      event.preventDefault();
      if (runtimeState.runHistoryActionFn) {
        callRuntimeHook(runtimeState, "runHistoryActionFn", "redo");
      } else {
        redoHistory();
      }
      return;
    }

    if (!modifier && lower === "f") {
      event.preventDefault();
      setCurrentTool("fill");
      return;
    }
    if (!modifier && lower === "q") {
      event.preventDefault();
      setCurrentTool("fill");
      return;
    }
    if (!modifier && lower === "w") {
      event.preventDefault();
      setCurrentTool("eraser");
      return;
    }
    if (!modifier && lower === "e") {
      event.preventDefault();
      setCurrentTool("eraser");
      return;
    }
    if (!modifier && lower === "b") {
      event.preventDefault();
      toggleBrushMode();
      return;
    }
    if (!modifier && lower === "g") {
      event.preventDefault();
      cyclePaintGranularity(1);
      return;
    }
    if (!modifier && lower === "i") {
      event.preventDefault();
      setCurrentTool("eyedropper");
      return;
    }
    if (!modifier && key === "[") {
      event.preventDefault();
      cyclePaintGranularity(-1);
      return;
    }
    if (!modifier && key === "]") {
      event.preventDefault();
      cyclePaintGranularity(1);
      return;
    }
    if (!modifier && /^[1-6]$/.test(key)) {
      event.preventDefault();
      pickQuickSwatch(Number(key) - 1);
      return;
    }
    if (!modifier && (key === "+" || key === "=")) {
      event.preventDefault();
      if (runtimeState.runZoomStepFn) {
        callRuntimeHook(runtimeState, "runZoomStepFn", 1);
      } else {
        zoomByStep(1);
      }
      return;
    }
    if (!modifier && (key === "-" || key === "_")) {
      event.preventDefault();
      if (runtimeState.runZoomStepFn) {
        callRuntimeHook(runtimeState, "runZoomStepFn", -1);
      } else {
        zoomByStep(-1);
      }
      return;
    }
    if (!modifier && key === "0") {
      event.preventDefault();
      if (runtimeState.runZoomResetFn) {
        callRuntimeHook(runtimeState, "runZoomResetFn");
      } else {
        resetZoomToFit();
      }
      return;
    }
    if (!modifier && key === "Escape") {
      if (cancelActiveStrategicInteractionModes()) {
        event.preventDefault();
        emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_STRATEGIC_OVERLAY_UI);
        flushShortcutRender("shortcut-strategic-overlay-cancel");
        return;
      }
      if (runtimeState.specialZoneEditor?.active) {
        event.preventDefault();
        cancelSpecialZoneDraw();
        refreshAfterSpecialZoneShortcut();
        return;
      }
      if (runtimeState.brushModeEnabled) {
        event.preventDefault();
        runtimeState.brushModeEnabled = false;
        setBrushPanModifier(false);
        syncToolUi();
      }
    }
  });

  window.addEventListener("keyup", (event) => {
    if (runtimeState.bootBlocking || runtimeState.startupReadonly) return;
    if (event.key !== "Shift" && event.key !== " ") return;
    setBrushPanModifier(false);
  });

  window.addEventListener("blur", () => {
    setBrushPanModifier(false);
  });

  if (document.body) {
    document.body.dataset.shortcutsBound = "true";
  }
}

export { initShortcuts };

