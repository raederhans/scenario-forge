import { exitSpecialZoneMembershipToolState } from "../core/state/actions/special_zone_actions.js";
import {
  STATE_BUS_EVENTS,
  callRuntimeHook,
  readRuntimeHook,
  emitStateBusEvent,
} from "../core/state/index.js";
import { state as runtimeState } from "../core/state.js";
import { setSelectedColorState } from "../core/state/actions/appearance_selection_actions.js";
import { FileManager } from "../core/file_manager.js";
import { redoHistory, undoHistory } from "../core/history_manager.js";
import { flushRenderBoundary } from "../core/render_boundary.js";
import { showToast } from "./components/toast.js";
import { t } from "./i18n.js";
import { shortcuts, keyboardChord } from "./command_palette.js";
import { getActiveModal } from "./ui_contract.js";
import {
  cancelMapPointPick,
  cancelSelectionMarquee,
  clearDevSelection,
  cancelActiveStrategicInteractionModes,
  cancelSpecialZoneDraw,
  panMapByPixels,
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

function shouldPreventSpaceScroll(target) {
  return target === document.body || (target instanceof Element
    && target.closest("#mapContainer")
    && !target.closest('button, summary, a, [role="button"]')
    && !isEditableTarget(target));
}

function flushShortcutRender(reason = "shortcut") {
  return flushRenderBoundary(reason);
}

function setCurrentTool(tool) {
  if (callRuntimeHook(runtimeState, "runToolSelectionFn", tool, { dismissHint: true }) !== undefined) {
    return;
  }
  runtimeState.currentTool = tool;
  if (tool === "eyedropper" || tool === "select") {
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
  if (runtimeState.brushModeEnabled && (runtimeState.currentTool === "eyedropper" || runtimeState.currentTool === "select")) {
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
  setSelectedColorState(runtimeState, color);
  if (runtimeState.currentTool === "select") {
    callRuntimeHook(runtimeState, "runToolSelectionFn", "fill", { feedbackLabel: t("Switched to fill tool", "ui") });
  }
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_SWATCH_UI);
  return true;
}

const toolButtons = {
  toolSelectBtn: "select", toolFillBtn: "fill", toolEraserBtn: "eraser", toolEyedropperBtn: "eyedropper",
};
const panDirections = {
  up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0],
};

async function saveProject(saveAs) {
  try {
    const save = readRuntimeHook(runtimeState, saveAs ? "runProjectSaveAsFn" : "runProjectSaveFn");
    if (save) await save();
    else await FileManager.exportProject(runtimeState, { saveAs });
  } catch (error) {
    showToast(String(error?.message || error || t("Unknown error", "ui")), {
      title: t("Project save failed", "ui"),
      tone: "error",
    });
  }
}

function initShortcuts({ pan = panMapByPixels, cancelMarquee = cancelSelectionMarquee } = {}) {
  if (document.body?.dataset.shortcutsBound === "true") return;

  let spaceHeld = false;
  let altCursorMap;
  function releaseAltCursor() {
    if (altCursorMap && runtimeState.currentTool !== "eyedropper") altCursorMap.classList.remove("tool-eyedropper");
    altCursorMap = null;
  }

  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape" && (cancelMarquee() || cancelMapPointPick())) {
      event.preventDefault();
      return;
    }
    if (getActiveModal()) return;
    const key = String(event.key || "");
    const modifier = event.metaKey || event.ctrlKey;
    const editableTarget = isEditableTarget(event.target);

    if (editableTarget) {
      return;
    }
    if (!modifier && !event.altKey && /^[a-z0-9]$/i.test(key)
      && event.target instanceof Element
      // 只在带输入联想的列表里让出字母键；普通按钮被点击后仍保持焦点，快捷键必须照常可用。
      && event.target.closest('[role="option"], [role="listbox"]')) {
      return;
    }

    if (runtimeState.bootBlocking) {
      return;
    }

    if (key === "Alt" && !runtimeState.startupReadonly && ["fill", "eraser"].includes(runtimeState.currentTool)) {
      altCursorMap = document.getElementById("mapContainer");
      altCursorMap?.classList.add("tool-eyedropper");
      return;
    }
    const chord = keyboardChord(event);
    const onMap = event.target?.id === "mapContainer";
    const matches = shortcuts.filter(row => row.keys.includes(chord));
    const { action } = (onMap && matches.find(row => panDirections[row.action]))
      || matches.find(row => !panDirections[row.action]) || {};
    if (!action || event.altKey) return;
    if (runtimeState.startupReadonly && !panDirections[action]
      && !["zoomIn", "zoomOut", "zoomReset", "brushPan", "escape", "help"].includes(action)) return;

    if (panDirections[action]) {
      const [x, y] = panDirections[action];
      const step = event.shiftKey ? 240 : 60;
      event.preventDefault();
      pan(x * step, y * step);
      return;
    }
    if (toolButtons[action]) {
      event.preventDefault();
      setCurrentTool(toolButtons[action]);
      return;
    }
    switch (action) {
    case "toggleDeveloperModeFn":
    case "toggleRightPanelFn":
    case "toggleLeftPanelFn":
    case "toggleDockFn":
    case "runQuickReexportFn":
    case "text": {
      const hook = readRuntimeHook(runtimeState, action === "text" ? "runMapTextToolFn" : action);
      if (hook) {
        event.preventDefault();
        return hook();
      }
      return;
    }
    case "cycleQuickFillLevelFn":
      if (!event.repeat && !event.shiftKey && callRuntimeHook(runtimeState, action)) event.preventDefault();
      return;
    case "brushPan":
      if (key === " ") {
        if (shouldPreventSpaceScroll(event.target)) event.preventDefault();
        spaceHeld = true;
      }
      setBrushPanModifier(true);
      return;
    case "open":
    case "help": {
      const button = document.getElementById(action === "open" ? "uploadProjectBtn" : "editorKeyboardShortcutsBtn");
      if (button) {
        event.preventDefault();
        button.click();
      }
      return;
    }
    case "save":
    case "saveAs":
      event.preventDefault();
      return saveProject(action === "saveAs");
    case "undo":
    case "redo":
      event.preventDefault();
      if (runtimeState.specialZoneEditor?.active && chord !== "Mod+Y") {
        undoSpecialZoneVertex();
        refreshAfterSpecialZoneShortcut();
      } else if (runtimeState.runHistoryActionFn) {
        callRuntimeHook(runtimeState, "runHistoryActionFn", action);
      } else if (action === "redo") redoHistory();
      else undoHistory();
      return;
    case "brushModeBtn":
      event.preventDefault();
      toggleBrushMode();
      return;
    case "swatch":
      event.preventDefault();
      pickQuickSwatch(Number(key) - 1);
      return;
    case "zoomIn":
    case "zoomOut": {
      event.preventDefault();
      const direction = action === "zoomIn" ? 1 : -1;
      if (runtimeState.runZoomStepFn) callRuntimeHook(runtimeState, "runZoomStepFn", direction);
      else zoomByStep(direction);
      return;
    }
    case "zoomReset":
      event.preventDefault();
      if (runtimeState.runZoomResetFn) callRuntimeHook(runtimeState, "runZoomResetFn");
      else resetZoomToFit({ animate: true });
      return;
    case "escape":
      if (runtimeState.brushModeEnabled && callRuntimeHook(runtimeState, "cancelBrushStrokeFn")) {
        event.preventDefault();
        return;
      }
      if (cancelActiveStrategicInteractionModes()) {
        event.preventDefault();
        emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_STRATEGIC_OVERLAY_UI);
        flushShortcutRender("shortcut-strategic-overlay-cancel");
        return;
      }
      if (runtimeState.currentTool === "special-zone-membership") {
        event.preventDefault();
        exitSpecialZoneMembershipToolState(runtimeState);
        syncToolUi();
        callRuntimeHook(runtimeState, "updateSpecialZonesWorkbenchUIFn");
        flushShortcutRender("shortcut-special-zone-membership-exit");
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
        return;
      }
      if (runtimeState.devSelectionOrder?.length && clearDevSelection()) {
        event.preventDefault();
        return;
      }
      if (runtimeState.selectedInspectorCountryCode && callRuntimeHook(runtimeState, "stepUpInspectorSelectionFn")) {
        event.preventDefault();
      }
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.key === "Alt") releaseAltCursor();
    if (event.key !== "Shift" && event.key !== " ") return;
    if (event.key === " ") {
      if (!spaceHeld) return;
      if (shouldPreventSpaceScroll(event.target)) event.preventDefault();
      spaceHeld = false;
    }
    setBrushPanModifier(spaceHeld || !!event.shiftKey);
  });

  window.addEventListener("blur", () => {
    cancelMarquee();
    releaseAltCursor();
    spaceHeld = false;
    setBrushPanModifier(false);
  });

  if (document.body) {
    document.body.dataset.shortcutsBound = "true";
  }
}

export { initShortcuts };

