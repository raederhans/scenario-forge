import { state } from "../core/state.js";
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
  if (typeof state.runToolSelectionFn === "function") {
    state.runToolSelectionFn(tool, { dismissHint: true });
    return;
  }
  state.currentTool = tool;
  if (tool === "eyedropper") {
    state.brushModeEnabled = false;
    state.brushPanModifierActive = false;
  }
  if (typeof state.updateToolUIFn === "function") {
    state.updateToolUIFn();
  }
}

function refreshAfterSpecialZoneShortcut() {
  if (typeof state.updateSpecialZoneEditorUIFn === "function") {
    state.updateSpecialZoneEditorUIFn();
  }
  flushShortcutRender("shortcut-special-zone-cancel");
}

function syncToolUi() {
  if (typeof state.updateToolUIFn === "function") {
    state.updateToolUIFn();
  }
}

function toggleBrushMode() {
  if (typeof state.runBrushModeToggleFn === "function") {
    state.runBrushModeToggleFn(!state.brushModeEnabled, { dismissHint: true });
    return;
  }
  state.brushModeEnabled = !state.brushModeEnabled;
  if (state.brushModeEnabled && state.currentTool === "eyedropper") {
    state.currentTool = "fill";
  }
  syncToolUi();
}

function setBrushPanModifier(active) {
  if (state.brushPanModifierActive === active) return;
  state.brushPanModifierActive = active;
  syncToolUi();
}

function pickQuickSwatch(index) {
  const swatches = Array.from(document.querySelectorAll("#paletteGrid .color-swatch"));
  const button = swatches[index];
  const color = String(button?.dataset?.color || "").trim();
  if (!color) return false;
  state.selectedColor = color;
  if (typeof state.updateSwatchUIFn === "function") {
    state.updateSwatchUIFn();
  }
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

    if (state.bootBlocking) {
      return;
    }

    if (state.startupReadonly && !allowShortcutDuringStartupReadonly({ key, modifier })) {
      return;
    }

    if (modifier && event.shiftKey && lower === "d") {
      if (typeof state.toggleDeveloperModeFn === "function") {
        event.preventDefault();
        state.toggleDeveloperModeFn();
      }
      return;
    }

    if (modifier && key === "\\") {
      if (typeof state.toggleRightPanelFn === "function") {
        event.preventDefault();
        state.toggleRightPanelFn();
      }
      return;
    }

    if (!modifier && key === "\\") {
      if (typeof state.toggleLeftPanelFn === "function") {
        event.preventDefault();
        state.toggleLeftPanelFn();
      }
      return;
    }

    if (!modifier && key === "`") {
      if (typeof state.toggleDockFn === "function") {
        event.preventDefault();
        state.toggleDockFn();
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
      FileManager.exportProject(state);
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
        if (typeof state.runHistoryActionFn === "function") {
          state.runHistoryActionFn("redo");
        } else {
          redoHistory();
        }
      } else {
        if (typeof state.runHistoryActionFn === "function") {
          state.runHistoryActionFn("undo");
        } else {
          undoHistory();
        }
      }
      return;
    }

    if (modifier && lower === "y") {
      event.preventDefault();
      if (typeof state.runHistoryActionFn === "function") {
        state.runHistoryActionFn("redo");
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
      if (typeof state.runZoomStepFn === "function") {
        state.runZoomStepFn(1);
      } else {
        zoomByStep(1);
      }
      return;
    }
    if (!modifier && (key === "-" || key === "_")) {
      event.preventDefault();
      if (typeof state.runZoomStepFn === "function") {
        state.runZoomStepFn(-1);
      } else {
        zoomByStep(-1);
      }
      return;
    }
    if (!modifier && key === "0") {
      event.preventDefault();
      if (typeof state.runZoomResetFn === "function") {
        state.runZoomResetFn();
      } else {
        resetZoomToFit();
      }
      return;
    }
    if (!modifier && key === "Escape") {
      if (cancelActiveStrategicInteractionModes()) {
        event.preventDefault();
        if (typeof state.updateStrategicOverlayUIFn === "function") {
          state.updateStrategicOverlayUIFn();
        }
        flushShortcutRender("shortcut-strategic-overlay-cancel");
        return;
      }
      if (state.specialZoneEditor?.active) {
        event.preventDefault();
        cancelSpecialZoneDraw();
        refreshAfterSpecialZoneShortcut();
        return;
      }
      if (state.brushModeEnabled) {
        event.preventDefault();
        state.brushModeEnabled = false;
        setBrushPanModifier(false);
        syncToolUi();
      }
    }
  });

  window.addEventListener("keyup", (event) => {
    if (state.bootBlocking || state.startupReadonly) return;
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

