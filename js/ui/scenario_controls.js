import { state as runtimeState } from "../core/state.js";
import { callRequiredRuntimeHook, callRuntimeHook, readRuntimeHook, registerOwnedRuntimeHook } from "../core/state/index.js";
import {
  clearActiveScenarioCommand,
  applyScenarioByIdCommand,
  resetScenarioToBaselineCommand,
} from "../core/scenario_dispatcher.js";
import {
  formatScenarioAuditText,
  formatScenarioStatusText,
  getScenarioDisplayName,
  getScenarioRegistryEntries,
  normalizeScenarioId,
} from "../core/scenario_manager.js";
import {
  formatScenarioFatalRecoveryMessage,
  getScenarioFatalRecoveryState,
} from "../core/scenario_recovery.js";
import { loadScenarioRegistry } from "../core/scenario_resources.js";
import { resetZoomToFit } from "../core/map_renderer/public.js";
import { areHgoRuntimePreviewAssetsAvailable } from "../core/hgo_runtime_asset_loader.js";
import { t } from "./i18n.js";
import { showToast } from "./toast.js";
const state = runtimeState;
const HGO_RUNTIME_PREVIEW_OPTION_VALUE = "__hgo_runtime_preview__";

const isHgoRuntimePreviewSelected = (value) => String(value || "").trim() === HGO_RUNTIME_PREVIEW_OPTION_VALUE;

const normalizeScenarioSelectionValue = (value) => (
  isHgoRuntimePreviewSelected(value) ? HGO_RUNTIME_PREVIEW_OPTION_VALUE : normalizeScenarioId(value)
);

const isHgoRuntimePreviewActive = () => !!runtimeState.hgoRuntimePreview?.enabled;

const buildHgoRuntimePreviewOptionPayload = () => ({
  value: HGO_RUNTIME_PREVIEW_OPTION_VALUE,
  label: t("HGO Preview", "ui"),
});

let disposeActiveScenarioControls = null;

export function initScenarioControls() {
  disposeActiveScenarioControls?.();
  const events = new AbortController();
  const eventOptions = { signal: events.signal };
  let releaseHook = () => {};
  const dispose = () => {
    events.abort();
    releaseHook();
    if (disposeActiveScenarioControls === dispose) disposeActiveScenarioControls = null;
  };
  disposeActiveScenarioControls = dispose;
  const scenarioSelect = document.getElementById("scenarioSelect");
  const scenarioSelectButton = document.getElementById("scenarioSelectButton");
  const scenarioSelectButtonText = document.getElementById("scenarioSelectButtonText");
  const scenarioSelectMenu = document.getElementById("scenarioSelectMenu");
  const applyScenarioBtn = document.getElementById("applyScenarioBtn");
  const resetScenarioBtn = document.getElementById("resetScenarioBtn");
  const clearScenarioBtn = document.getElementById("clearScenarioBtn");
  const blankFeatureLabelsToggleRow = document.getElementById("blankFeatureLabelsToggleRow");
  const toggleBlankFeatureLabels = document.getElementById("toggleBlankFeatureLabels");
  const scenarioStatus = document.getElementById("scenarioStatus");
  const scenarioAuditHint = document.getElementById("scenarioAuditHint");
  let pendingScenarioId = "";

  const closeScenarioSelectMenu = () => {
    if (!scenarioSelectMenu || !scenarioSelectButton) return;
    scenarioSelectMenu.classList.add("hidden");
    scenarioSelectButton.setAttribute("aria-expanded", "false");
  };

  const syncScenarioSelectSurface = ({ entries, currentValue, disabled }) => {
    if (!scenarioSelectButton || !scenarioSelectButtonText || !scenarioSelectMenu) return;
    const normalizedValue = normalizeScenarioSelectionValue(currentValue);
    const selectedOption = scenarioSelect?.selectedOptions?.[0] || null;
    scenarioSelectButtonText.textContent = selectedOption?.textContent || t("None", "ui");
    scenarioSelectButton.disabled = !!disabled;
    scenarioSelectButton.title = scenarioSelect?.title || "";
    scenarioSelectMenu.replaceChildren();

    const hgoPreviewAvailable = areHgoRuntimePreviewAssetsAvailable() || isHgoRuntimePreviewActive();
    const optionPayloads = [
      { value: "", label: t("None", "ui") },
      ...(hgoPreviewAvailable ? [buildHgoRuntimePreviewOptionPayload()] : []),
      ...entries.map((entry) => ({
        value: normalizeScenarioId(entry.scenario_id),
        label: getScenarioDisplayName(entry, entry.scenario_id),
      })),
    ];
    optionPayloads.forEach(({ value, label }) => {
      const optionButton = document.createElement("button");
      optionButton.type = "button";
      optionButton.className = "scenario-select-option";
      optionButton.setAttribute("role", "option");
      optionButton.setAttribute("aria-selected", normalizeScenarioSelectionValue(value) === normalizedValue ? "true" : "false");
      optionButton.classList.toggle("is-selected", normalizeScenarioSelectionValue(value) === normalizedValue);
      optionButton.dataset.value = value;
      optionButton.textContent = label;
      optionButton.addEventListener("click", () => {
        if (events.signal.aborted || !scenarioSelect || scenarioSelect.disabled) return;
        scenarioSelect.value = value;
        scenarioSelect.dispatchEvent(new Event("change", { bubbles: true }));
        closeScenarioSelectMenu();
        scenarioSelectButton.focus();
      });
      scenarioSelectMenu.appendChild(optionButton);
    });
  };

  const renderScenarioControls = () => {
    if (events.signal.aborted) return;
    const entries = getScenarioRegistryEntries();
    const isApplyInFlight = !!runtimeState.scenarioApplyInFlight;
    const isBootBlocking = runtimeState.bootBlocking !== false;
    const fatalState = getScenarioFatalRecoveryState();
    const isFatalLocked = !!fatalState;
    const fatalMessage = formatScenarioFatalRecoveryMessage(fatalState);
    if (scenarioSelect) {
      const activeValue = normalizeScenarioId(runtimeState.activeScenarioId);
      const hasPendingOption = !!pendingScenarioId
        && (
          (areHgoRuntimePreviewAssetsAvailable() && isHgoRuntimePreviewSelected(pendingScenarioId))
          || entries.some((entry) => normalizeScenarioId(entry.scenario_id) === pendingScenarioId)
        );
      const hgoPreviewActive = isHgoRuntimePreviewActive();
      const currentValue = (hasPendingOption ? pendingScenarioId : "")
        || (hgoPreviewActive ? HGO_RUNTIME_PREVIEW_OPTION_VALUE : activeValue);
      scenarioSelect.replaceChildren();
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = t("None", "ui");
      scenarioSelect.appendChild(emptyOption);
      if (areHgoRuntimePreviewAssetsAvailable() || hgoPreviewActive) {
        const hgoOption = document.createElement("option");
        hgoOption.value = HGO_RUNTIME_PREVIEW_OPTION_VALUE;
        hgoOption.textContent = t("HGO Preview", "ui");
        scenarioSelect.appendChild(hgoOption);
      }
      entries.forEach((entry) => {
        const option = document.createElement("option");
        option.value = normalizeScenarioId(entry.scenario_id);
        option.textContent = getScenarioDisplayName(entry, entry.scenario_id);
        scenarioSelect.appendChild(option);
      });
      scenarioSelect.value = currentValue || "";
      scenarioSelect.disabled = isApplyInFlight || isBootBlocking || isFatalLocked;
      scenarioSelect.title = isFatalLocked ? fatalMessage : "";
      pendingScenarioId = normalizeScenarioSelectionValue(scenarioSelect.value);
      syncScenarioSelectSurface({
        entries,
        currentValue: scenarioSelect.value,
        disabled: scenarioSelect.disabled,
      });
    }

    if (scenarioStatus) {
      scenarioStatus.textContent = formatScenarioStatusText();
    }
    if (scenarioAuditHint) {
      const auditText = formatScenarioAuditText();
      scenarioAuditHint.textContent = auditText;
      scenarioAuditHint.classList.toggle("hidden", !auditText);
    }
    if (resetScenarioBtn) {
      resetScenarioBtn.textContent = t("Reset", "ui");
      resetScenarioBtn.disabled = !runtimeState.activeScenarioId || isHgoRuntimePreviewActive() || isApplyInFlight || isBootBlocking || isFatalLocked;
      resetScenarioBtn.classList.toggle("hidden", !runtimeState.activeScenarioId || isHgoRuntimePreviewActive());
      resetScenarioBtn.title = isFatalLocked ? fatalMessage : "";
    }
    if (clearScenarioBtn) {
      clearScenarioBtn.textContent = t("Exit Scenario", "ui");
      const hasScenarioSurface = !!runtimeState.activeScenarioId || isHgoRuntimePreviewActive();
      clearScenarioBtn.disabled = !hasScenarioSurface || isApplyInFlight || isBootBlocking || isFatalLocked;
      clearScenarioBtn.classList.toggle("hidden", !hasScenarioSurface);
      clearScenarioBtn.title = isFatalLocked ? fatalMessage : "";
    }
    if (applyScenarioBtn) {
      const selectedScenarioId = pendingScenarioId || normalizeScenarioSelectionValue(scenarioSelect?.value);
      const isSelectedScenarioActive =
        isHgoRuntimePreviewSelected(selectedScenarioId)
          ? isHgoRuntimePreviewActive()
          : !!selectedScenarioId && selectedScenarioId === normalizeScenarioId(runtimeState.activeScenarioId);
      applyScenarioBtn.textContent = t("Apply", "ui");
      applyScenarioBtn.disabled = !selectedScenarioId || isSelectedScenarioActive || isApplyInFlight || isBootBlocking || isFatalLocked;
      applyScenarioBtn.classList.toggle("hidden", isSelectedScenarioActive);
      applyScenarioBtn.title = isFatalLocked ? fatalMessage : "";
    }
    if (blankFeatureLabelsToggleRow) {
      const isBlankScenarioActive = normalizeScenarioId(runtimeState.activeScenarioId) === "blank_base";
      blankFeatureLabelsToggleRow.classList.toggle("hidden", !isBlankScenarioActive);
    }
    if (toggleBlankFeatureLabels) {
      toggleBlankFeatureLabels.checked = !!runtimeState.showBlankFeatureLabels;
      toggleBlankFeatureLabels.disabled = normalizeScenarioId(runtimeState.activeScenarioId) !== "blank_base";
    }
  };

  releaseHook = registerOwnedRuntimeHook(state, "updateScenarioUIFn", renderScenarioControls);

  if (scenarioSelect) {
    scenarioSelect.addEventListener("change", () => {
      pendingScenarioId = normalizeScenarioSelectionValue(scenarioSelect.value);
      renderScenarioControls();
    }, eventOptions);
  }

  if (scenarioSelectButton) {
    scenarioSelectButton.addEventListener("click", () => {
      if (!scenarioSelectMenu || scenarioSelectButton.disabled) return;
      const isOpen = !scenarioSelectMenu.classList.contains("hidden");
      scenarioSelectMenu.classList.toggle("hidden", isOpen);
      scenarioSelectButton.setAttribute("aria-expanded", isOpen ? "false" : "true");
    }, eventOptions);
    scenarioSelectButton.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeScenarioSelectMenu();
      }
    }, eventOptions);
  }

  if (scenarioSelectMenu) {
    scenarioSelectMenu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeScenarioSelectMenu();
        scenarioSelectButton?.focus();
      }
    }, eventOptions);
    document.addEventListener("click", (event) => {
      if (!scenarioSelectMenu || !scenarioSelectButton) return;
      if (scenarioSelectMenu.contains(event.target) || scenarioSelectButton.contains(event.target)) return;
      closeScenarioSelectMenu();
    }, eventOptions);
  }

  if (applyScenarioBtn) {
    applyScenarioBtn.addEventListener("click", async () => {
      const scenarioId = pendingScenarioId || normalizeScenarioSelectionValue(scenarioSelect?.value);
      if (!scenarioId) return;
      try {
        if (isHgoRuntimePreviewSelected(scenarioId)) {
          if (!areHgoRuntimePreviewAssetsAvailable()) {
            showToast(t("HGO Preview is available in local developer builds.", "ui"), {
              title: t("Scenario unavailable", "ui"),
              tone: "warning",
              duration: 4200,
            });
            pendingScenarioId = "";
            renderScenarioControls();
            return;
          }
          if (!readRuntimeHook(state, "setHgoRuntimePreviewEnabledFn")) {
            throw new Error("Required runtime hook is not registered: setHgoRuntimePreviewEnabledFn");
          }
          if (runtimeState.activeScenarioId) {
            clearActiveScenarioCommand({
              renderMode: "request",
              markDirtyReason: "",
              showToastOnComplete: false,
            });
          }
          await callRequiredRuntimeHook(state, "setHgoRuntimePreviewEnabledFn", true);
          if (events.signal.aborted) return;
          resetZoomToFit({
            centerContent: true,
            centerX: true,
            centerY: true,
          });
          pendingScenarioId = HGO_RUNTIME_PREVIEW_OPTION_VALUE;
          renderScenarioControls();
          return;
        }
        if (isHgoRuntimePreviewActive()) {
          await callRequiredRuntimeHook(state, "setHgoRuntimePreviewEnabledFn", false);
          if (events.signal.aborted) return;
        }
        await applyScenarioByIdCommand(scenarioId, {
          renderMode: "request",
          markDirtyReason: "scenario-apply",
          showToastOnComplete: true,
        });
        pendingScenarioId = normalizeScenarioId(runtimeState.activeScenarioId);
        renderScenarioControls();
      } catch (error) {
        if (events.signal.aborted) return;
        console.error("Failed to apply scenario:", error);
        const message = String(error?.message || "").trim() || t("Unable to apply scenario.", "ui");
        showToast(message, {
          title: t("Scenario failed", "ui"),
          tone: "error",
          duration: 5200,
        });
      }
    }, eventOptions);
  }

  if (resetScenarioBtn) {
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
    }, eventOptions);
  }

  if (clearScenarioBtn) {
    clearScenarioBtn.addEventListener("click", async () => {
      try {
        if ((!runtimeState.activeScenarioId && !isHgoRuntimePreviewActive()) || runtimeState.scenarioApplyInFlight) return;
        if (isHgoRuntimePreviewActive()) {
          await callRequiredRuntimeHook(state, "setHgoRuntimePreviewEnabledFn", false);
          if (events.signal.aborted) return;
        }
        if (runtimeState.activeScenarioId) {
          clearActiveScenarioCommand({
            renderMode: "request",
            markDirtyReason: "scenario-clear",
            showToastOnComplete: true,
          });
        }
        pendingScenarioId = normalizeScenarioId(runtimeState.activeScenarioId);
        renderScenarioControls();
      } catch (error) {
        if (events.signal.aborted) return;
        console.error("Failed to exit scenario:", error);
        const message = String(error?.message || "").trim() || t("Unable to exit scenario.", "ui");
        showToast(message, {
          title: t("Scenario failed", "ui"),
          tone: "error",
          duration: 5200,
        });
      }
    }, eventOptions);
  }

  if (toggleBlankFeatureLabels) {
    toggleBlankFeatureLabels.addEventListener("change", () => {
      runtimeState.showBlankFeatureLabels = !!toggleBlankFeatureLabels.checked;
      callRuntimeHook(state, "renderNowFn", "blank-feature-labels-toggle");
      renderScenarioControls();
    }, eventOptions);
  }

  loadScenarioRegistry()
    .then(() => {
      renderScenarioControls();
    })
    .catch((error) => {
      if (events.signal.aborted) return;
      console.warn("Unable to load scenario registry:", error);
      renderScenarioControls();
    });
  return dispose;
}
