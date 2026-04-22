import { state as runtimeState } from "../core/state.js";
import {
  clearActiveScenarioCommand,
  applyScenarioByIdCommand,
  resetScenarioToBaselineCommand,
  setScenarioViewModeCommand,
} from "../core/scenario_dispatcher.js";
import {
  formatScenarioAuditText,
  formatScenarioStatusText,
  getScenarioDisplayName,
  getScenarioRegistryEntries,
  normalizeScenarioId,
  normalizeScenarioViewMode,
} from "../core/scenario_manager.js";
import {
  formatScenarioFatalRecoveryMessage,
  getScenarioFatalRecoveryState,
} from "../core/scenario_recovery.js";
import { loadScenarioRegistry } from "../core/scenario_resources.js";
import { t } from "./i18n.js";
import { showToast } from "./toast.js";
const state = runtimeState;

export function initScenarioControls() {
  const scenarioSelect = document.getElementById("scenarioSelect");
  const applyScenarioBtn = document.getElementById("applyScenarioBtn");
  const resetScenarioBtn = document.getElementById("resetScenarioBtn");
  const clearScenarioBtn = document.getElementById("clearScenarioBtn");
  const scenarioStatus = document.getElementById("scenarioStatus");
  const scenarioAuditHint = document.getElementById("scenarioAuditHint");
  const scenarioViewModeLabel = document.getElementById("lblScenarioViewMode");
  const scenarioViewModeSelect = document.getElementById("scenarioViewModeSelect");
  let pendingScenarioId = "";

  const renderScenarioControls = () => {
    const entries = getScenarioRegistryEntries();
    const isApplyInFlight = !!runtimeState.scenarioApplyInFlight;
    const isBootBlocking = runtimeState.bootBlocking !== false;
    const fatalState = getScenarioFatalRecoveryState();
    const isFatalLocked = !!fatalState;
    const fatalMessage = formatScenarioFatalRecoveryMessage(fatalState);
    if (scenarioSelect) {
      const activeValue = normalizeScenarioId(runtimeState.activeScenarioId);
      const hasPendingOption = !!pendingScenarioId
        && entries.some((entry) => normalizeScenarioId(entry.scenario_id) === pendingScenarioId);
      const currentValue = (hasPendingOption ? pendingScenarioId : "") || activeValue;
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
      scenarioSelect.disabled = isApplyInFlight || isBootBlocking || isFatalLocked;
      scenarioSelect.title = isFatalLocked ? fatalMessage : "";
      pendingScenarioId = normalizeScenarioId(scenarioSelect.value);
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
      const hasScenario = !!runtimeState.activeScenarioId;
      const hasControllerData = Object.keys(runtimeState.scenarioControllersByFeatureId || {}).length > 0;
      const hasSplit = Number(runtimeState.activeScenarioManifest?.summary?.owner_controller_split_feature_count || 0) > 0;
      scenarioViewModeSelect.value = normalizeScenarioViewMode(runtimeState.scenarioViewMode);
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
      resetScenarioBtn.disabled = !runtimeState.activeScenarioId || isApplyInFlight || isBootBlocking || isFatalLocked;
      resetScenarioBtn.classList.toggle("hidden", !runtimeState.activeScenarioId);
      resetScenarioBtn.title = isFatalLocked ? fatalMessage : "";
    }
    if (clearScenarioBtn) {
      clearScenarioBtn.textContent = t("Exit Scenario", "ui");
      clearScenarioBtn.disabled = !runtimeState.activeScenarioId || isApplyInFlight || isBootBlocking || isFatalLocked;
      clearScenarioBtn.classList.toggle("hidden", !runtimeState.activeScenarioId);
      clearScenarioBtn.title = isFatalLocked ? fatalMessage : "";
    }
    if (applyScenarioBtn) {
      const selectedScenarioId = pendingScenarioId || normalizeScenarioId(scenarioSelect?.value);
      const isSelectedScenarioActive =
        !!selectedScenarioId && selectedScenarioId === normalizeScenarioId(runtimeState.activeScenarioId);
      applyScenarioBtn.textContent = t("Apply", "ui");
      applyScenarioBtn.disabled = !selectedScenarioId || isSelectedScenarioActive || isApplyInFlight || isBootBlocking || isFatalLocked;
      applyScenarioBtn.classList.toggle("hidden", isSelectedScenarioActive);
      applyScenarioBtn.title = isFatalLocked ? fatalMessage : "";
    }
  };

  runtimeState.updateScenarioUIFn = renderScenarioControls;

  if (scenarioSelect && !scenarioSelect.dataset.bound) {
    scenarioSelect.addEventListener("change", () => {
      pendingScenarioId = normalizeScenarioId(scenarioSelect.value);
      renderScenarioControls();
    });
    scenarioSelect.dataset.bound = "true";
  }

  if (scenarioViewModeSelect && !scenarioViewModeSelect.dataset.bound) {
    scenarioViewModeSelect.addEventListener("change", (event) => {
      const changed = setScenarioViewModeCommand(event?.target?.value, {
        renderMode: "request",
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
      const scenarioId = pendingScenarioId || normalizeScenarioId(scenarioSelect?.value);
      if (!scenarioId) return;
      try {
        await applyScenarioByIdCommand(scenarioId, {
          renderMode: "request",
          markDirtyReason: "scenario-apply",
          showToastOnComplete: true,
        });
        pendingScenarioId = normalizeScenarioId(runtimeState.activeScenarioId);
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
      if (!runtimeState.activeScenarioId || runtimeState.scenarioApplyInFlight) return;
      const changed = resetScenarioToBaselineCommand({
        renderMode: "request",
        markDirtyReason: "scenario-reset",
        showToastOnComplete: true,
      });
      if (changed) {
        pendingScenarioId = normalizeScenarioId(runtimeState.activeScenarioId);
        renderScenarioControls();
      }
    });
    resetScenarioBtn.dataset.bound = "true";
  }

  if (clearScenarioBtn && !clearScenarioBtn.dataset.bound) {
    clearScenarioBtn.addEventListener("click", () => {
      if (!runtimeState.activeScenarioId || runtimeState.scenarioApplyInFlight) return;
      clearActiveScenarioCommand({
        renderMode: "request",
        markDirtyReason: "scenario-clear",
        showToastOnComplete: true,
      });
      pendingScenarioId = normalizeScenarioId(runtimeState.activeScenarioId);
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

