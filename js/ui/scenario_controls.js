import { state } from "../core/state.js";
import {
  clearActiveScenarioCommand,
  applyScenarioByIdCommand,
  resetScenarioToBaselineCommand,
  setScenarioViewModeCommand,
} from "../core/scenario_dispatcher.js";
import {
  formatScenarioAuditText,
  formatScenarioFatalRecoveryMessage,
  formatScenarioStatusText,
  getScenarioDisplayName,
  getScenarioFatalRecoveryState,
  getScenarioRegistryEntries,
  loadScenarioRegistry,
  normalizeScenarioId,
  normalizeScenarioViewMode,
} from "../core/scenario_manager.js";
import { t } from "./i18n.js";
import { showToast } from "./toast.js";

export function initScenarioControls() {
  const scenarioSelect = document.getElementById("scenarioSelect");
  const applyScenarioBtn = document.getElementById("applyScenarioBtn");
  const resetScenarioBtn = document.getElementById("resetScenarioBtn");
  const clearScenarioBtn = document.getElementById("clearScenarioBtn");
  const scenarioStatus = document.getElementById("scenarioStatus");
  const scenarioAuditHint = document.getElementById("scenarioAuditHint");
  const scenarioViewModeLabel = document.getElementById("lblScenarioViewMode");
  const scenarioViewModeSelect = document.getElementById("scenarioViewModeSelect");

  const renderScenarioControls = () => {
    const entries = getScenarioRegistryEntries();
    const isApplyInFlight = !!state.scenarioApplyInFlight;
    const fatalState = getScenarioFatalRecoveryState();
    const isFatalLocked = !!fatalState;
    const fatalMessage = formatScenarioFatalRecoveryMessage(fatalState);
    if (scenarioSelect) {
      const pendingValue = normalizeScenarioId(scenarioSelect.value);
      const activeValue = normalizeScenarioId(state.activeScenarioId);
      const currentValue = pendingValue || activeValue;
      scenarioSelect.replaceChildren();
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = t("None", "ui");
      scenarioSelect.appendChild(emptyOption);
      entries.forEach((entry) => {
        const option = document.createElement("option");
        option.value = normalizeScenarioId(entry.scenario_id);
        option.textContent = getScenarioDisplayName(entry, entry.scenario_id);
        scenarioSelect.appendChild(option);
      });
      scenarioSelect.value = currentValue || "";
      scenarioSelect.disabled = isApplyInFlight || isFatalLocked;
      scenarioSelect.title = isFatalLocked ? fatalMessage : "";
    }

    if (scenarioStatus) {
      scenarioStatus.textContent = formatScenarioStatusText();
    }
    if (scenarioAuditHint) {
      const auditText = formatScenarioAuditText();
      scenarioAuditHint.textContent = auditText;
      scenarioAuditHint.classList.toggle("hidden", !auditText);
    }
    if (scenarioViewModeSelect) {
      const hasScenario = !!state.activeScenarioId;
      const hasControllerData = Object.keys(state.scenarioControllersByFeatureId || {}).length > 0;
      const hasSplit = Number(state.activeScenarioManifest?.summary?.owner_controller_split_feature_count || 0) > 0;
      scenarioViewModeSelect.value = normalizeScenarioViewMode(state.scenarioViewMode);
      scenarioViewModeSelect.disabled = isFatalLocked || !hasScenario || !hasControllerData || !hasSplit;
      scenarioViewModeSelect.classList.toggle("hidden", !hasScenario);
      scenarioViewModeLabel?.classList.toggle("hidden", !hasScenario);
      scenarioViewModeSelect.title = isFatalLocked
        ? fatalMessage
        : hasSplit
        ? t("Toggle legal ownership vs frontline control.", "ui")
        : t("No frontline control split in current scenario.", "ui");
    }
    if (resetScenarioBtn) {
      resetScenarioBtn.textContent = t("Reset", "ui");
      resetScenarioBtn.disabled = !state.activeScenarioId || isApplyInFlight || isFatalLocked;
      resetScenarioBtn.classList.toggle("hidden", !state.activeScenarioId);
      resetScenarioBtn.title = isFatalLocked ? fatalMessage : "";
    }
    if (clearScenarioBtn) {
      clearScenarioBtn.textContent = t("Exit Scenario", "ui");
      clearScenarioBtn.disabled = !state.activeScenarioId || isApplyInFlight || isFatalLocked;
      clearScenarioBtn.classList.toggle("hidden", !state.activeScenarioId);
      clearScenarioBtn.title = isFatalLocked ? fatalMessage : "";
    }
    if (applyScenarioBtn) {
      const selectedScenarioId = normalizeScenarioId(scenarioSelect?.value);
      const isSelectedScenarioActive =
        !!selectedScenarioId && selectedScenarioId === normalizeScenarioId(state.activeScenarioId);
      applyScenarioBtn.textContent = t("Apply", "ui");
      applyScenarioBtn.disabled = !selectedScenarioId || isSelectedScenarioActive || isApplyInFlight || isFatalLocked;
      applyScenarioBtn.classList.toggle("hidden", isSelectedScenarioActive);
      applyScenarioBtn.title = isFatalLocked ? fatalMessage : "";
    }
  };

  state.updateScenarioUIFn = renderScenarioControls;

  if (scenarioSelect && !scenarioSelect.dataset.bound) {
    scenarioSelect.addEventListener("change", () => {
      renderScenarioControls();
    });
    scenarioSelect.dataset.bound = "true";
  }

  if (scenarioViewModeSelect && !scenarioViewModeSelect.dataset.bound) {
    scenarioViewModeSelect.addEventListener("change", (event) => {
      const changed = setScenarioViewModeCommand(event?.target?.value, {
        renderMode: "flush",
        markDirtyReason: "",
      });
      if (changed) {
        renderScenarioControls();
      }
    });
    scenarioViewModeSelect.dataset.bound = "true";
  }

  if (applyScenarioBtn && !applyScenarioBtn.dataset.bound) {
    applyScenarioBtn.addEventListener("click", async () => {
      const scenarioId = normalizeScenarioId(scenarioSelect?.value);
      if (!scenarioId) return;
      try {
        await applyScenarioByIdCommand(scenarioId, {
          renderMode: "flush",
          markDirtyReason: "scenario-apply",
          showToastOnComplete: true,
        });
        renderScenarioControls();
      } catch (error) {
        console.error("Failed to apply scenario:", error);
        const message = String(error?.message || "").trim() || t("Unable to apply scenario.", "ui");
        showToast(message, {
          title: t("Scenario failed", "ui"),
          tone: "error",
          duration: 5200,
        });
      }
    });
    applyScenarioBtn.dataset.bound = "true";
  }

  if (resetScenarioBtn && !resetScenarioBtn.dataset.bound) {
    resetScenarioBtn.addEventListener("click", () => {
      if (!state.activeScenarioId || state.scenarioApplyInFlight) return;
      const changed = resetScenarioToBaselineCommand({
        renderMode: "flush",
        markDirtyReason: "scenario-reset",
        showToastOnComplete: true,
      });
      if (changed) {
        renderScenarioControls();
      }
    });
    resetScenarioBtn.dataset.bound = "true";
  }

  if (clearScenarioBtn && !clearScenarioBtn.dataset.bound) {
    clearScenarioBtn.addEventListener("click", () => {
      if (!state.activeScenarioId || state.scenarioApplyInFlight) return;
      clearActiveScenarioCommand({
        renderMode: "flush",
        markDirtyReason: "scenario-clear",
        showToastOnComplete: true,
      });
      renderScenarioControls();
    });
    clearScenarioBtn.dataset.bound = "true";
  }

  loadScenarioRegistry()
    .then(() => {
      renderScenarioControls();
    })
    .catch((error) => {
      console.warn("Unable to load scenario registry:", error);
      renderScenarioControls();
    });
}
