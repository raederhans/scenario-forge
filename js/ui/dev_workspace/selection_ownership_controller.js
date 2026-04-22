import { state as runtimeState } from "../../core/state.js";
import {
  applyOwnerToFeatureIds,
  buildScenarioOwnershipSavePayload,
  resetOwnersToScenarioBaselineForFeatureIds,
} from "../../core/scenario_ownership_editor.js";
import { t } from "../i18n.js";
import { showToast } from "../toast.js";
const state = runtimeState;

function ui(key) {
  return t(key, "ui");
}

function bindButtonAction(button, action) {
  if (!button || button.dataset.bound === "true") return;
  button.addEventListener("click", action);
  button.dataset.bound = "true";
}

/**
 * Selection ownership owner.
 * 这个 controller 只负责 ownership panel 和 quick ownership controls。
 * dev_workspace.js 继续保留 workspace facade、selection shared helper 和整体宿主编排。
 */
export function createSelectionOwnershipController({
  panel,
  quickbar,
  renderWorkspace,
  renderMetaRows,
  normalizeOwnerInput,
  localizeSelectionSummary,
  resolveOwnershipTargetIds,
  resolveOwnershipEditorModel,
  resolveOwnershipEditorHint,
  buildOwnershipMetaRows,
}) {
  const scenarioOwnershipPanel = panel.querySelector("#devScenarioOwnershipPanel");
  const scenarioOwnershipTitle = panel.querySelector("#devScenarioOwnershipTitle");
  const scenarioOwnershipHint = panel.querySelector("#devScenarioOwnershipHint");
  const scenarioOwnershipMeta = panel.querySelector("#devScenarioOwnershipMeta");
  const scenarioOwnerInput = panel.querySelector("#devScenarioOwnerInput");
  const scenarioOwnershipStatus = panel.querySelector("#devScenarioOwnershipStatus");
  const applyOwnerBtn = panel.querySelector("#devScenarioApplyOwnerBtn");
  const resetOwnerBtn = panel.querySelector("#devScenarioResetOwnerBtn");
  const saveOwnersBtn = panel.querySelector("#devScenarioSaveOwnersBtn");

  const devQuickSelectionValue = quickbar.querySelector("#devQuickSelectionValue");
  const devQuickTagValue = quickbar.querySelector("#devQuickTagValue");
  const devQuickOwnerValue = quickbar.querySelector("#devQuickOwnerValue");
  const devQuickControllerValue = quickbar.querySelector("#devQuickControllerValue");
  const devQuickOwnerInput = quickbar.querySelector("#devQuickOwnerInput");
  const devQuickUseTagBtn = quickbar.querySelector("#devQuickUseTagBtn");
  const devQuickApplyOwnerBtn = quickbar.querySelector("#devQuickApplyOwnerBtn");
  const devQuickResetOwnerBtn = quickbar.querySelector("#devQuickResetOwnerBtn");
  const devQuickSaveOwnersBtn = quickbar.querySelector("#devQuickSaveOwnersBtn");

  const render = ({ hasActiveScenario }) => {
    const ownershipModel = resolveOwnershipEditorModel();
    const editorState = runtimeState.devScenarioEditor || {};
    const requestedOwnerCode = normalizeOwnerInput(editorState.targetOwnerCode);
    const fallbackOwnerCode = normalizeOwnerInput(runtimeState.activeSovereignCode);
    const effectiveOwnerCode = requestedOwnerCode || fallbackOwnerCode;

    scenarioOwnershipPanel?.classList.toggle("hidden", !hasActiveScenario);
    if (scenarioOwnershipTitle) {
      scenarioOwnershipTitle.textContent = hasActiveScenario
        ? String(runtimeState.activeScenarioManifest?.display_name || runtimeState.activeScenarioId || "")
        : ui("No active scenario");
    }
    if (scenarioOwnershipHint) {
      scenarioOwnershipHint.textContent = resolveOwnershipEditorHint(ownershipModel);
    }
    renderMetaRows(scenarioOwnershipMeta, buildOwnershipMetaRows(ownershipModel));

    if (scenarioOwnerInput && scenarioOwnerInput.value !== requestedOwnerCode) {
      scenarioOwnerInput.value = requestedOwnerCode;
    }
    if (scenarioOwnerInput) {
      scenarioOwnerInput.placeholder = fallbackOwnerCode || "GER";
      scenarioOwnerInput.disabled = !hasActiveScenario || !!editorState.isSaving;
    }

    const statusBits = [];
    if (fallbackOwnerCode && !requestedOwnerCode) {
      statusBits.push(`${ui("Active Owner")}: ${fallbackOwnerCode}`);
    }
    if (editorState.lastSaveMessage) {
      statusBits.push(editorState.lastSaveMessage);
    } else if (editorState.lastSavedAt) {
      statusBits.push(`${ui("Last Saved")}: ${editorState.lastSavedAt}`);
    }
    if (scenarioOwnershipStatus) {
      scenarioOwnershipStatus.textContent = statusBits.join(" | ");
    }

    const canApplyOwner = hasActiveScenario && ownershipModel.selectionCount > 0 && !!effectiveOwnerCode && !editorState.isSaving;
    const canResetOwner = hasActiveScenario && ownershipModel.selectionCount > 0 && !editorState.isSaving;
    const canSaveOwners = hasActiveScenario && !editorState.isSaving;

    const selectionTagValue = ownershipModel.selectionCount <= 0
      ? ui("No selection")
      : ownershipModel.isMixedOwner
        ? ownershipModel.ownerCodes.join(", ")
        : (ownershipModel.currentOwnerCode || ownershipModel.ownerCodes?.[0] || "--");
    const ownerValue = ownershipModel.selectionCount <= 0
      ? "--"
      : (ownershipModel.isMixedOwner ? ownershipModel.ownerCodes.join(", ") : (ownershipModel.currentOwnerCode || "--"));
    const controllerValue = ownershipModel.selectionCount <= 0
      ? "--"
      : (ownershipModel.currentControllerCode || ownerValue || "--");

    if (applyOwnerBtn) {
      applyOwnerBtn.textContent = ui("Apply to Selection");
      applyOwnerBtn.disabled = !canApplyOwner;
    }
    if (resetOwnerBtn) {
      resetOwnerBtn.textContent = ui("Reset Selection");
      resetOwnerBtn.disabled = !canResetOwner;
    }
    if (saveOwnersBtn) {
      const savingNow = !!editorState.isSaving;
      if (saveOwnersBtn.dataset.saving !== String(savingNow)) {
        saveOwnersBtn.dataset.saving = savingNow;
        saveOwnersBtn.textContent = savingNow ? ui("Saving...") : ui("Save Owners File");
      }
      saveOwnersBtn.disabled = !canSaveOwners;
    }

    if (devQuickSelectionValue) {
      devQuickSelectionValue.textContent = localizeSelectionSummary(ownershipModel.selectionCount || 0);
    }
    if (devQuickTagValue) {
      devQuickTagValue.textContent = selectionTagValue;
    }
    if (devQuickOwnerValue) {
      devQuickOwnerValue.textContent = ownerValue;
    }
    if (devQuickControllerValue) {
      devQuickControllerValue.textContent = controllerValue;
    }
    if (devQuickOwnerInput && devQuickOwnerInput.value !== requestedOwnerCode) {
      devQuickOwnerInput.value = requestedOwnerCode;
    }
    if (devQuickOwnerInput) {
      devQuickOwnerInput.placeholder = fallbackOwnerCode || "GER";
      devQuickOwnerInput.disabled = !hasActiveScenario || !!editorState.isSaving;
    }
    if (devQuickUseTagBtn) {
      devQuickUseTagBtn.disabled = !hasActiveScenario || ownershipModel.selectionCount <= 0;
    }
    if (devQuickApplyOwnerBtn) {
      devQuickApplyOwnerBtn.disabled = !canApplyOwner;
    }
    if (devQuickResetOwnerBtn) {
      devQuickResetOwnerBtn.disabled = !canResetOwner;
    }
    if (devQuickSaveOwnersBtn) {
      const savingNow = !!editorState.isSaving;
      if (devQuickSaveOwnersBtn.dataset.saving !== String(savingNow)) {
        devQuickSaveOwnersBtn.dataset.saving = savingNow;
        devQuickSaveOwnersBtn.textContent = savingNow ? ui("Saving...") : ui("Save Owners File");
      }
      devQuickSaveOwnersBtn.disabled = !canSaveOwners;
    }
  };

  const bindEvents = () => {
    bindButtonAction(applyOwnerBtn, () => {
      const targetIds = resolveOwnershipTargetIds();
      const requestedOwnerCode = normalizeOwnerInput(runtimeState.devScenarioEditor?.targetOwnerCode);
      const ownerCode = requestedOwnerCode || normalizeOwnerInput(runtimeState.activeSovereignCode);
      const result = applyOwnerToFeatureIds(targetIds, ownerCode, {
        historyKind: "dev-workspace-ownership-apply",
        dirtyReason: "dev-workspace-ownership-apply",
        recomputeReason: "dev-workspace-ownership-apply",
      });
      if (!result.applied) {
        const message = result.reason === "missing-owner"
          ? ui("Enter a target owner tag or choose an active owner first.")
          : ui("Select one or more land features before applying ownership.");
        showToast(message, {
          title: ui("Scenario Ownership Editor"),
          tone: "warning",
        });
        renderWorkspace();
        return;
      }
      const changedLabel = result.changed === 1 ? ui("feature") : ui("features");
      showToast(`${ui("Applied ownership to")} ${result.changed} ${changedLabel}.`, {
        title: ui("Scenario Ownership Editor"),
        tone: result.changed > 0 ? "success" : "info",
      });
      renderWorkspace();
    });

    bindButtonAction(devQuickApplyOwnerBtn, () => {
      applyOwnerBtn?.click();
    });

    bindButtonAction(resetOwnerBtn, () => {
      const result = resetOwnersToScenarioBaselineForFeatureIds(resolveOwnershipTargetIds(), {
        historyKind: "dev-workspace-ownership-reset",
        dirtyReason: "dev-workspace-ownership-reset",
        recomputeReason: "dev-workspace-ownership-reset",
      });
      if (!result.applied) {
        showToast(ui("Select one or more land features with scenario ownership before resetting."), {
          title: ui("Scenario Ownership Editor"),
          tone: "warning",
        });
        renderWorkspace();
        return;
      }
      showToast(
        result.changed > 0
          ? `${ui("Reset ownership for")} ${result.changed} ${result.changed === 1 ? ui("feature") : ui("features")}.`
          : ui("Selected features already match the active scenario baseline."),
        {
          title: ui("Scenario Ownership Editor"),
          tone: result.changed > 0 ? "success" : "info",
        }
      );
      renderWorkspace();
    });

    bindButtonAction(devQuickResetOwnerBtn, () => {
      resetOwnerBtn?.click();
    });

    bindButtonAction(saveOwnersBtn, async () => {
      if (!runtimeState.activeScenarioId || runtimeState.devScenarioEditor?.isSaving) return;
      const payload = buildScenarioOwnershipSavePayload();
      runtimeState.devScenarioEditor = {
        ...(runtimeState.devScenarioEditor || {}),
        isSaving: true,
        lastSaveMessage: "",
        lastSaveTone: "",
      };
      renderWorkspace();
      try {
        const response = await fetch("/__dev/scenario/ownership/save", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            scenarioId: payload.scenarioId,
            baselineHash: payload.baselineHash,
            owners: payload.owners,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result?.ok) {
          throw new Error(String(result?.message || `HTTP ${response.status}`));
        }
        runtimeState.devScenarioEditor = {
          ...(runtimeState.devScenarioEditor || {}),
          isSaving: false,
          lastSavedAt: String(result.savedAt || ""),
          lastSavedPath: String(result.filePath || ""),
          lastSaveMessage: `${ui("Saved")}: ${String(result.filePath || "")}`,
          lastSaveTone: "success",
        };
        showToast(ui("Scenario ownership file saved."), {
          title: ui("Scenario Ownership Editor"),
          tone: "success",
        });
      } catch (error) {
        runtimeState.devScenarioEditor = {
          ...(runtimeState.devScenarioEditor || {}),
          isSaving: false,
          lastSaveMessage: String(error?.message || ui("Unable to save ownership file.")),
          lastSaveTone: "critical",
        };
        showToast(String(error?.message || ui("Unable to save ownership file.")), {
          title: ui("Scenario Ownership Editor"),
          tone: "critical",
          duration: 4200,
        });
      }
      renderWorkspace();
    });

    bindButtonAction(devQuickSaveOwnersBtn, () => {
      saveOwnersBtn?.click();
    });

    bindButtonAction(devQuickUseTagBtn, () => {
      const ownershipModel = resolveOwnershipEditorModel();
      const inferredTag = ownershipModel.isMixedOwner
        ? ""
        : normalizeOwnerInput(ownershipModel.currentOwnerCode || ownershipModel.ownerCodes?.[0] || "");
      runtimeState.devScenarioEditor = {
        ...(runtimeState.devScenarioEditor || {}),
        targetOwnerCode: inferredTag,
      };
      renderWorkspace();
    });

    if (scenarioOwnerInput && scenarioOwnerInput.dataset.bound !== "true") {
      scenarioOwnerInput.addEventListener("input", (event) => {
        runtimeState.devScenarioEditor = {
          ...(runtimeState.devScenarioEditor || {}),
          targetOwnerCode: normalizeOwnerInput(event.target.value),
        };
        renderWorkspace();
      });
      scenarioOwnerInput.dataset.bound = "true";
    }

    if (devQuickOwnerInput && devQuickOwnerInput.dataset.bound !== "true") {
      devQuickOwnerInput.addEventListener("input", (event) => {
        runtimeState.devScenarioEditor = {
          ...(runtimeState.devScenarioEditor || {}),
          targetOwnerCode: normalizeOwnerInput(event.target.value),
        };
        renderWorkspace();
      });
      devQuickOwnerInput.dataset.bound = "true";
    }
  };

  return {
    bindEvents,
    render,
  };
}

