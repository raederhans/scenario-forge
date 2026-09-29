import { state as runtimeState } from "../../core/state.js";
import { t } from "../i18n.js";
import { showToast } from "../toast.js";

function ui(key) {
  return t(key, "ui");
}

function bindButtonAction(button, action) {
  if (!button || button.dataset.bound === "true") return;
  button.addEventListener("click", action);
  button.dataset.bound = "true";
}

/**
 * Keeps the quickbar's selection and ownership overview current, and reuses the
 * selection clipboard toggle for removing the selected feature.
 */
export function createSelectionOwnershipController({
  panel,
  quickbar,
  renderWorkspace,
  localizeSelectionSummary,
  resolveSelectedOwnershipSummary,
}) {
  const devQuickSelectionValue = quickbar.querySelector("#devQuickSelectionValue");
  const devQuickTagValue = quickbar.querySelector("#devQuickTagValue");
  const devQuickOwnerValue = quickbar.querySelector("#devQuickOwnerValue");
  const devQuickControllerValue = quickbar.querySelector("#devQuickControllerValue");
  const devQuickRemoveSelectedBtn = quickbar.querySelector("#devQuickRemoveSelectedBtn");
  const devSelectionToggleSelectedBtn = panel.querySelector("#devSelectionToggleSelectedBtn");

  const resolveSelectedSelectionId = () => {
    const selectedId = runtimeState.devSelectedHit?.targetType === "land"
      ? String(runtimeState.devSelectedHit.id || "").trim()
      : "";
    const selectedFeature = selectedId ? runtimeState.landIndex?.get(selectedId) : null;
    return selectedId && selectedFeature && runtimeState.devSelectionFeatureIds instanceof Set && runtimeState.devSelectionFeatureIds.has(selectedId)
      ? selectedId
      : "";
  };

  const render = ({ hasActiveScenario }) => {
    const selection = resolveSelectedOwnershipSummary();
    const selectionCount = selection.selectionCount || 0;
    const tagValue = selectionCount <= 0
      ? ui("No selection")
      : selection.isMixedOwner
        ? selection.ownerCodes.join(", ")
        : (selection.currentOwnerCode || selection.ownerCodes?.[0] || "--");
    const ownerValue = selectionCount <= 0
      ? "--"
      : (selection.isMixedOwner ? selection.ownerCodes.join(", ") : (selection.currentOwnerCode || "--"));
    const controllerValue = ownerValue;

    if (devQuickSelectionValue) {
      devQuickSelectionValue.textContent = localizeSelectionSummary(selectionCount);
    }
    if (devQuickTagValue) {
      devQuickTagValue.textContent = tagValue;
    }
    if (devQuickOwnerValue) {
      devQuickOwnerValue.textContent = ownerValue;
    }
    if (devQuickControllerValue) {
      devQuickControllerValue.textContent = controllerValue;
    }
    if (devQuickRemoveSelectedBtn) {
      devQuickRemoveSelectedBtn.disabled = !hasActiveScenario || !resolveSelectedSelectionId() || !devSelectionToggleSelectedBtn;
    }
  };

  const bindEvents = () => {
    bindButtonAction(devQuickRemoveSelectedBtn, () => {
      if (!resolveSelectedSelectionId()) {
        showToast(ui("No selection"), {
          title: ui("Selection Clipboard"),
          tone: "warning",
        });
        renderWorkspace();
        return;
      }
      if (!devSelectionToggleSelectedBtn) {
        renderWorkspace();
        return;
      }
      devSelectionToggleSelectedBtn.click();
    });
  };

  return {
    bindEvents,
    render,
  };
}
