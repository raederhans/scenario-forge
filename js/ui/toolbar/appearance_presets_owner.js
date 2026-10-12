import {
  buildAppearancePresetExportPayload,
  createAppearancePresetFromRuntimeState,
  getSelectedAppearancePreset,
} from "../../core/state/appearance_preset_state.js";
import {
  applyAppearancePresetState,
  deleteAppearancePresetState,
  mergeAppearancePresetImportPayloadState,
  normalizeAppearancePresetsIntoState,
  selectAppearancePresetState,
  upsertAppearancePresetState,
} from "../../core/state/actions/appearance_preset_actions.js";

function getPresetCountLabel(count, t) {
  const label = count === 1 ? "preset" : "presets";
  return `${count} ${typeof t === "function" ? t(label, "ui") : label}`;
}

function sanitizePresetFilename(name = "appearance-preset") {
  const slug = String(name || "appearance-preset")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "appearance-preset";
  return `${slug}.json`;
}

function replaceNodeChildren(node, children = []) {
  if (!node) return;
  if (typeof node.replaceChildren === "function") {
    node.replaceChildren(...children);
    return;
  }
  node.textContent = "";
  children.forEach((child) => node.appendChild?.(child));
}

function createOption(documentRef, value, label) {
  const option = documentRef?.createElement?.("option");
  if (!option) return null;
  option.value = value;
  option.textContent = label;
  return option;
}

function downloadJson(documentRef, filename, payload) {
  if (!documentRef?.createElement || typeof Blob === "undefined" || !globalThis.URL) {
    return false;
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = globalThis.URL.createObjectURL(blob);
  const link = documentRef.createElement("a");
  link.href = url;
  link.download = filename;
  documentRef.body?.appendChild?.(link);
  link.click?.();
  link.remove?.();
  setTimeout(() => globalThis.URL.revokeObjectURL(url), 100);
  return true;
}

export function createAppearancePresetsOwner({
  runtimeState,
  nodes = {},
  t = (value) => String(value || ""),
  renderDirty = () => {},
  captureHistoryState = () => ({}),
  pushHistoryEntry = () => false,
  documentRef = globalThis.document,
  requestUiRefresh = () => {},
  afterApply = () => {},
  now = () => Date.now(),
} = {}) {
  const ensurePresetState = () => {
    return normalizeAppearancePresetsIntoState(runtimeState);
  };

  const getSelectedPreset = () => getSelectedAppearancePreset(ensurePresetState());

  const renderAppearancePresetsUi = () => {
    const presetState = ensurePresetState();
    const selectedPreset = getSelectedAppearancePreset(presetState);
    if (nodes.select) {
      const options = presetState.order
        .map((presetId) => presetState.byId[presetId])
        .filter(Boolean)
        .map((preset) => createOption(documentRef, preset.id, preset.name))
        .filter(Boolean);
      replaceNodeChildren(nodes.select, options);
      nodes.select.value = presetState.selectedPresetId || "";
      nodes.select.disabled = presetState.order.length === 0;
    }
    if (nodes.nameInput && selectedPreset && !nodes.nameInput.value) {
      nodes.nameInput.placeholder = selectedPreset.name;
    }
    if (nodes.summary) {
      nodes.summary.textContent = getPresetCountLabel(presetState.order.length, t);
    }
    if (nodes.list) {
      const names = presetState.order
        .map((presetId) => presetState.byId[presetId]?.name)
        .filter(Boolean);
      nodes.list.dataset.presetCount = String(names.length);
      nodes.list.textContent = names.length > 0
        ? names.join("\n")
        : (typeof t === "function" ? t("No appearance presets saved", "ui") : "No appearance presets saved");
    }
    [nodes.applyButton, nodes.deleteButton, nodes.exportButton].forEach((button) => {
      if (button) button.disabled = !selectedPreset;
    });
  };

  const pushAppearancePresetHistory = (before, after, kind) => {
    pushHistoryEntry({
      before,
      after,
      meta: {
        kind,
      },
    });
  };

  const saveCurrentAppearancePreset = () => {
    const before = captureHistoryState({ appearancePresets: true });
    const currentState = ensurePresetState();
    const selectedPreset = getSelectedAppearancePreset(currentState);
    const requestedName = String(nodes.nameInput?.value || "").trim();
    // 空名称表示覆盖当前选中预设；输入新名称表示 fork 一个新预设，便于 UI 保留“保存/另存为”单入口。
    const shouldUpdateSelected = !!selectedPreset && (!requestedName || requestedName === selectedPreset.name);
    const timestamp = now();
    const preset = createAppearancePresetFromRuntimeState(runtimeState, {
      id: shouldUpdateSelected ? selectedPreset.id : "",
      name: requestedName || selectedPreset?.name || t("Appearance Preset", "ui"),
      now: timestamp,
    });
    if (shouldUpdateSelected) {
      preset.createdAt = selectedPreset.createdAt;
    }
    upsertAppearancePresetState(runtimeState, preset);
    if (nodes.nameInput) nodes.nameInput.value = "";
    const after = captureHistoryState({ appearancePresets: true });
    pushAppearancePresetHistory(before, after, "appearance-preset-save");
    renderAppearancePresetsUi();
    renderDirty("appearance-preset-save");
    return preset;
  };

  const selectAppearancePreset = (presetId = "") => {
    const before = captureHistoryState({ appearancePresets: true });
    selectAppearancePresetState(runtimeState, presetId);
    const after = captureHistoryState({ appearancePresets: true });
    pushAppearancePresetHistory(before, after, "appearance-preset-select");
    renderAppearancePresetsUi();
    renderDirty("appearance-preset-select");
  };

  const applySelectedAppearancePreset = () => {
    const preset = getSelectedPreset();
    if (!preset) return false;
    const before = captureHistoryState({ appearanceState: true });
    // apply 影响真实渲染态，历史快照只包 appearanceState；预设列表本身保持不变。
    applyAppearancePresetState(runtimeState, preset);
    const after = captureHistoryState({ appearanceState: true });
    pushAppearancePresetHistory(before, after, "appearance-preset-apply");
    afterApply(preset);
    requestUiRefresh();
    renderAppearancePresetsUi();
    renderDirty("appearance-preset-apply");
    return true;
  };

  const deleteSelectedAppearancePreset = () => {
    const preset = getSelectedPreset();
    if (!preset) return false;
    const before = captureHistoryState({ appearancePresets: true });
    deleteAppearancePresetState(runtimeState, preset.id);
    const after = captureHistoryState({ appearancePresets: true });
    pushAppearancePresetHistory(before, after, "appearance-preset-delete");
    renderAppearancePresetsUi();
    renderDirty("appearance-preset-delete");
    return true;
  };

  const exportSelectedAppearancePreset = () => {
    const preset = getSelectedPreset();
    if (!preset) return false;
    return downloadJson(
      documentRef,
      sanitizePresetFilename(preset.name),
      buildAppearancePresetExportPayload(preset),
    );
  };

  const importAppearancePresetPayload = (payload) => {
    const before = captureHistoryState({ appearancePresets: true });
    mergeAppearancePresetImportPayloadState(runtimeState, payload);
    const after = captureHistoryState({ appearancePresets: true });
    pushAppearancePresetHistory(before, after, "appearance-preset-import");
    renderAppearancePresetsUi();
    renderDirty("appearance-preset-import");
    return runtimeState.appearancePresets;
  };

  const bindEvents = () => {
    if (nodes.saveButton && nodes.saveButton.dataset.bound !== "true") {
      nodes.saveButton.addEventListener("click", () => {
        saveCurrentAppearancePreset();
      });
      nodes.saveButton.dataset.bound = "true";
    }
    if (nodes.select && nodes.select.dataset.bound !== "true") {
      nodes.select.addEventListener("change", (event) => {
        selectAppearancePreset(event.target.value);
      });
      nodes.select.dataset.bound = "true";
    }
    if (nodes.applyButton && nodes.applyButton.dataset.bound !== "true") {
      nodes.applyButton.addEventListener("click", () => {
        applySelectedAppearancePreset();
      });
      nodes.applyButton.dataset.bound = "true";
    }
    if (nodes.deleteButton && nodes.deleteButton.dataset.bound !== "true") {
      nodes.deleteButton.addEventListener("click", () => {
        deleteSelectedAppearancePreset();
      });
      nodes.deleteButton.dataset.bound = "true";
    }
    if (nodes.exportButton && nodes.exportButton.dataset.bound !== "true") {
      nodes.exportButton.addEventListener("click", () => {
        exportSelectedAppearancePreset();
      });
      nodes.exportButton.dataset.bound = "true";
    }
    if (nodes.importButton && nodes.importButton.dataset.bound !== "true") {
      nodes.importButton.addEventListener("click", () => {
        nodes.importInput?.click?.();
      });
      nodes.importButton.dataset.bound = "true";
    }
    if (nodes.importInput && nodes.importInput.dataset.bound !== "true") {
      nodes.importInput.addEventListener("change", async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          importAppearancePresetPayload(JSON.parse(text));
        } catch (error) {
          console.error("[appearance-presets] Failed to import preset:", error);
        } finally {
          event.target.value = "";
        }
      });
      nodes.importInput.dataset.bound = "true";
    }
  };

  return {
    applySelectedAppearancePreset,
    bindEvents,
    deleteSelectedAppearancePreset,
    exportSelectedAppearancePreset,
    importAppearancePresetPayload,
    renderAppearancePresetsUi,
    saveCurrentAppearancePreset,
    selectAppearancePreset,
  };
}
