import { createUnitCounterPreview } from "./unit_counter_preview.js";
import { createButton } from "../components/button.js";
import { createTextInput } from "../components/text_input.js";
import { setUiIcon } from "../ui_icons.js";
import { DEFAULT_UNIT_COUNTER_PRESET_ID, getUnitCounterCategoryLabel, getUnitCounterIconPathById } from "../../core/unit_counter_presets.js";

export function createStrategicPanelView({
  frontlineTabStack, runtimeState, countryNames, t, getDirectGeoLabel,
  getScenarioCountryMeta, ensureCountryPaletteColor, getDynamicCountryEntries,
  deleteSelectedOperationGraphicVertex, refreshStrategicOverlayUI,
}) {
  const buildRow = () => {
    const row = document.createElement("div");
    row.className = "mt-2 flex flex-wrap items-center gap-2";
    return row;
  };
  const buildSelect = (id, options) => {
    const select = document.createElement("select");
    select.id = id;
    select.className = "select-input";
    options.forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = t(label, "ui");
      select.appendChild(option);
    });
    return select;
  };
  const buildButton = (id, label, variant = "btn-secondary") => createButton({ id, className: variant, label: t(label, "ui") });
  const buildInput = (id, placeholder, type = "text") => createTextInput({ id, type, placeholder: placeholder ? t(placeholder, "ui") : "" });
  const buildCheckboxLabel = (id, label, className) => {
    const shell = document.createElement("label");
    shell.className = className;
    const input = document.createElement("input");
    input.id = id;
    input.type = "checkbox";
    input.className = "checkbox-input";
    const text = document.createElement("span");
    text.textContent = t(label, "ui");
    shell.append(input, text);
    return shell;
  };
  const buildCombatBar = ({ id, label, className }) => {
    const row = document.createElement("div");
    row.className = className;
    const labelNode = document.createElement("span");
    labelNode.className = "unit-counter-combat-bar-label";
    labelNode.textContent = t(label, "ui");
    const track = document.createElement("span");
    track.className = "unit-counter-combat-bar-track";
    const fill = document.createElement("span");
    fill.id = id;
    fill.className = "unit-counter-combat-bar-fill";
    track.appendChild(fill);
    row.append(labelNode, track);
    return row;
  };
  const buildSegmentedChoiceField = (id, options, {
    groupClassName = "frontline-segmented-field",
    buttonClassName = "frontline-segmented-choice",
  } = {}) => {
    const shell = document.createElement("div");
    shell.className = groupClassName;
    const select = buildSelect(id, options);
    select.classList.add("frontline-segmented-native");
    shell.appendChild(select);
    options.forEach(([value, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = buttonClassName;
      button.dataset.value = value;
      button.dataset.frontlineStyleChoice = "true";
      button.textContent = t(label, "ui");
      shell.appendChild(button);
    });
    return { shell, select };
  };
  const buildDetailGroup = (id, label, { open = false } = {}) => {
    const shell = document.createElement("details");
    shell.id = id;
    shell.className = "unit-counter-detail-group";
    shell.open = !!open;
    const summary = document.createElement("summary");
    summary.className = "unit-counter-detail-group-summary";
    summary.textContent = t(label, "ui");
    const body = document.createElement("div");
    body.className = "unit-counter-detail-group-body";
    shell.appendChild(summary);
    shell.appendChild(body);
    return { shell, body };
  };
  const unitCounterSizeLabels = Object.freeze({
    small: "Small",
    medium: "Medium",
    large: "Large",
  });
  const unitCounterCombatPresets = Object.freeze([
    { id: "elite", label: "Elite", organizationPct: 94, equipmentPct: 92 },
    { id: "regular", label: "Regular", organizationPct: 82, equipmentPct: 78 },
    { id: "worn", label: "Worn", organizationPct: 68, equipmentPct: 62 },
    { id: "understrength", label: "Understrength", organizationPct: 58, equipmentPct: 48 },
    { id: "improvised", label: "Improvised", organizationPct: 47, equipmentPct: 42 },
  ]);
  const clampUnitCounterStatValue = (value, fallback = 78) => {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
      return Math.max(0, Math.min(100, Number(fallback) || 0));
    }
    return Math.max(0, Math.min(100, Math.round(nextValue)));
  };
  const clampUnitCounterFixedScaleMultiplier = (value, fallback = 1.5) => {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
      return Math.max(0.5, Math.min(2.0, Number(fallback) || 1.5));
    }
    return Math.max(0.5, Math.min(2.0, nextValue));
  };
  const normalizeUnitCounterStatsPresetId = (value = "") => {
    const normalizedValue = String(value || "").trim().toLowerCase();
    return unitCounterCombatPresets.some((preset) => preset.id === normalizedValue) ? normalizedValue : "regular";
  };
  const getUnitCounterCombatPreset = (value = "") => {
    const presetId = normalizeUnitCounterStatsPresetId(value);
    return unitCounterCombatPresets.find((preset) => preset.id === presetId) || unitCounterCombatPresets[1];
  };
  const rollBiasedUnitCounterStat = (minimum = 40, maximum = 100) => {
    const span = Math.max(0, Number(maximum) - Number(minimum));
    const biasedRoll = 0.55 * Math.random() + 0.25 * Math.random() + 0.2 * Math.random();
    return clampUnitCounterStatValue(Number(minimum) + span * biasedRoll, minimum);
  };
  const getRandomizedUnitCounterCombatState = () => ({
    organizationPct: rollBiasedUnitCounterStat(44, 100),
    equipmentPct: rollBiasedUnitCounterStat(40, 96),
    statsPresetId: "random",
    statsSource: "random",
  });
  const resolveUnitCounterCombatState = (candidate = {}) => {
    const preset = getUnitCounterCombatPreset(candidate.statsPresetId || "regular");
    const statsSource = ["preset", "random", "manual"].includes(String(candidate.statsSource || "").trim().toLowerCase())
      ? String(candidate.statsSource || "").trim().toLowerCase()
      : "preset";
    return {
      organizationPct: clampUnitCounterStatValue(candidate.organizationPct, preset.organizationPct),
      equipmentPct: clampUnitCounterStatValue(candidate.equipmentPct, preset.equipmentPct),
      statsPresetId: String(candidate.statsPresetId || preset.id || "").trim().toLowerCase() || preset.id,
      statsSource,
      baseFillColor: String(candidate.baseFillColor || "").trim(),
    };
  };
  const {
    unitCounterPresets,
    featuredUnitCounterPresets,
    unitCounterCatalogCategories,
    unitCounterEchelons,
    getUnitCounterPresetMeta,
    getSidebarUnitCounterPresetOptions,
    getFilteredUnitCounterCatalog,
    inferUnitCounterPresetId,
    getUnitCounterNationMeta,
    getUnitCounterNationOptions,
    getUnitCounterEchelonLabel,
    formatUnitCounterListLabel,
    renderUnitCounterPreview,
  } = createUnitCounterPreview({
    runtimeState, countryNames, t, getDirectGeoLabel, getScenarioCountryMeta,
    ensureCountryPaletteColor, getDynamicCountryEntries, resolveUnitCounterCombatState,
  });

  let frontlineOverlaySection = document.getElementById("frontlineOverlayPanel");
  if (!frontlineOverlaySection && frontlineTabStack) {
    frontlineOverlaySection = document.createElement("div");
    frontlineOverlaySection.id = "frontlineOverlayPanel";
    frontlineOverlaySection.className = "inspector-tool-card frontline-tab-card";

    const statusRow = document.createElement("div");
    statusRow.className = "frontline-status-row";

    const statusTitleGroup = document.createElement("div");
    statusTitleGroup.className = "frontline-status-copy";

    const title = document.createElement("div");
    title.className = "section-header sidebar-tool-title";
    title.textContent = t("Derived Frontlines", "ui");

    const statusPill = document.createElement("span");
    statusPill.id = "frontlineEnabledStatus";
    statusPill.className = "frontline-status-pill";
    statusPill.textContent = t("Off", "ui");

    statusTitleGroup.appendChild(title);
    statusTitleGroup.appendChild(statusPill);

    const statusHint = document.createElement("p");
    statusHint.id = "frontlineStatusHint";
    statusHint.className = "sidebar-tool-hint frontline-compact-hint";
    statusHint.hidden = true;

    statusRow.appendChild(statusTitleGroup);

    const enableRow = buildRow();
    const enableToggle = buildCheckboxLabel("frontlineEnabledToggle", "Enable derived frontlines", "toggle-label");
    enableRow.appendChild(enableToggle);

    const emptyState = document.createElement("div");
    emptyState.id = "frontlineEmptyState";
    emptyState.className = "inspector-empty-state frontline-empty-state";

    const settings = document.createElement("div");
    settings.id = "frontlineSettingsPanel";
    settings.className = "frontline-settings-stack hidden";

    const controlsHeader = document.createElement("div");
    controlsHeader.className = "section-header mt-2";
    controlsHeader.textContent = t("View", "ui");

    const controlsRow = buildRow();
    controlsRow.classList.add("frontline-compact-row");
    const frontlineStyleField = buildSegmentedChoiceField("strategicFrontlineStyleSelect", [
      ["clean", "Clean"],
      ["dual-rail", "Dual Rail"],
      ["teeth", "Teeth"],
    ]);
    const frontlineStyleSelect = frontlineStyleField.select;
    const frontlineLabelToggle = buildCheckboxLabel("strategicFrontlineLabelsToggle", "Labels", "checkbox-row");
    const frontlineLabelPlacement = buildSelect("strategicLabelPlacementSelect", [
      ["midpoint", "Midpoint"],
      ["centroid", "Centroid"],
    ]);
    frontlineLabelPlacement.classList.add("frontline-inline-select");
    controlsRow.appendChild(frontlineStyleField.shell);
    controlsRow.appendChild(frontlineLabelToggle);

    const controlsAdvanced = document.createElement("details");
    controlsAdvanced.className = "unit-counter-advanced-shell frontline-advanced-shell";
    const controlsAdvancedSummary = document.createElement("summary");
    controlsAdvancedSummary.className = "unit-counter-advanced-summary";
    controlsAdvancedSummary.textContent = t("Advanced Label Placement", "ui");
    const controlsAdvancedBody = document.createElement("div");
    controlsAdvancedBody.className = "unit-counter-advanced-body";
    controlsAdvancedBody.appendChild(frontlineLabelPlacement);
    controlsAdvanced.appendChild(controlsAdvancedSummary);
    controlsAdvanced.appendChild(controlsAdvancedBody);

    settings.appendChild(controlsHeader);
    settings.appendChild(controlsRow);
    settings.appendChild(controlsAdvanced);

    frontlineOverlaySection.appendChild(statusRow);
    frontlineOverlaySection.appendChild(statusHint);
    frontlineOverlaySection.appendChild(enableRow);
    frontlineOverlaySection.appendChild(emptyState);
    frontlineOverlaySection.appendChild(settings);
    frontlineTabStack.appendChild(frontlineOverlaySection);
  }

  let strategicOverlaySection = document.getElementById("strategicOverlayPanel");
  if (!strategicOverlaySection && frontlineTabStack) {
    strategicOverlaySection = document.createElement("div");
    strategicOverlaySection.id = "strategicOverlayPanel";
    strategicOverlaySection.className = "inspector-tool-card frontline-tab-card";

    const headerRow = document.createElement("div");
    headerRow.className = "strategic-workspace-header";

    const headerCopy = document.createElement("div");
    headerCopy.className = "strategic-workspace-header-copy";

    const title = document.createElement("div");
    title.className = "section-header sidebar-tool-title";
    title.textContent = t("Strategic Annotations", "ui");

    const hint = document.createElement("p");
    hint.className = "sidebar-tool-hint";
    hint.dataset.pageNote = "";
    hint.textContent = t("Lines, graphics and unit counters are saved with the project and included in exports.", "ui");

    const publishStatus = document.createElement("p");
    publishStatus.id = "strategicOverlayPublishStatus";
    publishStatus.className = "sidebar-tool-hint strategic-overlay-publish-status";
    publishStatus.setAttribute("role", "status");
    publishStatus.setAttribute("aria-live", "polite");
    publishStatus.setAttribute("aria-atomic", "true");
    publishStatus.title = t("Project export saves Strategic annotations.", "ui");
    publishStatus.textContent = `0 ${t("lines", "ui")} · 0 ${t("graphics", "ui")} · 0 ${t("counters", "ui")} · ${t("Export as Strategic annotations", "ui")}`;

    const workspaceIconCloseBtn = buildButton("strategicOverlayIconCloseBtn", "Close");
    workspaceIconCloseBtn.classList.add("secondary", "strategic-workspace-icon-close", "hidden");
    headerCopy.appendChild(title);
    headerCopy.appendChild(hint);
    headerCopy.appendChild(publishStatus);
    headerRow.appendChild(headerCopy);
    headerRow.appendChild(workspaceIconCloseBtn);

    const workspaceActions = buildRow();
    workspaceActions.className = "strategic-workspace-actions mt-2";
    const workspaceOpenBtn = buildButton("strategicOverlayOpenWorkspaceBtn", "Open Workspace");
    workspaceOpenBtn.classList.add("secondary");
    const workspaceCloseBtn = buildButton("strategicOverlayCloseWorkspaceBtn", "Close Workspace");
    workspaceCloseBtn.classList.add("secondary", "hidden");
    workspaceActions.appendChild(workspaceOpenBtn);
    workspaceActions.appendChild(workspaceCloseBtn);

    const operationalLineBlock = document.createElement("div");
    operationalLineBlock.className = "frontline-workbench-block strategic-workspace-section strategic-workspace-section-lines";
    const operationalLineHeader = document.createElement("div");
    operationalLineHeader.className = "section-header mt-3";
    operationalLineHeader.textContent = t("Operational Lines", "ui");
    const operationalLineRow = buildRow();
    operationalLineRow.classList.add("frontline-compact-row", "strategic-line-primary-row");
    const operationalLineKindSelect = buildSelect("operationalLineKindSelect", [
      ["frontline", "Frontline"],
      ["offensive_line", "Offensive Line"],
      ["spearhead_line", "Spearhead Line"],
      ["defensive_line", "Defensive Line"],
    ]);
    const operationalLineLabelInput = buildInput("operationalLineLabelInput", "Label");
    operationalLineRow.appendChild(operationalLineKindSelect);
    operationalLineRow.appendChild(operationalLineLabelInput);
    operationalLineRow.appendChild(buildButton("operationalLineStartBtn", "Start Draw"));

    const operationalLineStyleRow = buildRow();
    operationalLineStyleRow.classList.add("frontline-compact-row");
    const operationalLineStrokeInput = buildInput("operationalLineStrokeInput", "", "color");
    operationalLineStrokeInput.value = "#7f1d1d";
    operationalLineStrokeInput.className = "input strategic-inline-color";
    operationalLineStrokeInput.setAttribute("aria-label", t("Operational line stroke", "ui"));
    const operationalLineWidthInput = buildInput("operationalLineWidthInput", "Width", "number");
    operationalLineWidthInput.min = "0";
    operationalLineWidthInput.max = "16";
    operationalLineWidthInput.step = "0.2";
    const operationalLineOpacityInput = buildInput("operationalLineOpacityInput", "Opacity", "number");
    operationalLineOpacityInput.min = "0";
    operationalLineOpacityInput.max = "1";
    operationalLineOpacityInput.step = "0.05";
    operationalLineStyleRow.appendChild(operationalLineStrokeInput);
    operationalLineStyleRow.appendChild(operationalLineWidthInput);
    operationalLineStyleRow.appendChild(operationalLineOpacityInput);

    const operationalLineEditorHint = document.createElement("p");
    operationalLineEditorHint.id = "operationalLineEditorHint";
    operationalLineEditorHint.className = "sidebar-tool-hint mt-2";
    operationalLineEditorHint.textContent = t("Choose type and draw.", "ui");

    const operationalLineActions = buildRow();
    operationalLineActions.className = "sidebar-equal-actions mt-3 strategic-line-management-actions";
    operationalLineActions.appendChild(buildButton("operationalLineUndoBtn", "Undo Vertex"));
    operationalLineActions.appendChild(buildButton("operationalLineFinishBtn", "Finish"));
    operationalLineActions.appendChild(buildButton("operationalLineCancelBtn", "Cancel"));
    operationalLineActions.appendChild(buildButton("operationalLineDeleteBtn", "Delete Selected"));

    const operationalLineList = document.createElement("select");
    operationalLineList.id = "operationalLineList";
    operationalLineList.className = "select-input mt-2 strategic-line-list";
    operationalLineList.size = 4;

    const graphicsBlock = document.createElement("div");
    graphicsBlock.className = "frontline-workbench-block strategic-workspace-section strategic-workspace-section-graphics";
    const graphicsHeader = document.createElement("div");
    graphicsHeader.className = "section-header mt-3";
    graphicsHeader.textContent = t("Operation Graphics", "ui");
    const graphicsRow = buildRow();
    graphicsRow.classList.add("frontline-compact-row", "strategic-graphics-primary-row");
    const graphicsKindSelect = buildSelect("operationGraphicKindSelect", [
      ["attack", "Attack"],
      ["retreat", "Retreat"],
      ["supply", "Supply"],
      ["naval", "Naval"],
      ["encirclement", "Encirclement"],
      ["theater", "Theater"],
    ]);
    const graphicsLabelInput = buildInput("operationGraphicLabelInput", "Label");
    graphicsRow.appendChild(graphicsKindSelect);
    graphicsRow.appendChild(graphicsLabelInput);
    graphicsRow.appendChild(buildButton("operationGraphicStartBtn", "Start Draw"));

    const graphicsStyleRow = buildRow();
    graphicsStyleRow.classList.add("frontline-compact-row");
    const graphicsPresetSelect = buildSelect("operationGraphicPresetSelect", [
      ["attack", "Attack Style"],
      ["retreat", "Retreat Style"],
      ["supply", "Supply Style"],
      ["naval", "Naval Style"],
      ["encirclement", "Encirclement Style"],
      ["theater", "Theater Style"],
    ]);
    const graphicsStrokeInput = buildInput("operationGraphicStrokeInput", "", "color");
    graphicsStrokeInput.value = "#991b1b";
    graphicsStrokeInput.className = "input strategic-inline-color";
    graphicsStrokeInput.setAttribute("aria-label", t("Graphic stroke", "ui"));
    const graphicsWidthInput = buildInput("operationGraphicWidthInput", "Width", "number");
    graphicsWidthInput.min = "0";
    graphicsWidthInput.max = "16";
    graphicsWidthInput.step = "0.2";
    const graphicsOpacityInput = buildInput("operationGraphicOpacityInput", "Opacity", "number");
    graphicsOpacityInput.min = "0";
    graphicsOpacityInput.max = "1";
    graphicsOpacityInput.step = "0.05";
    graphicsStyleRow.appendChild(graphicsPresetSelect);
    graphicsStyleRow.appendChild(graphicsStrokeInput);
    graphicsStyleRow.appendChild(graphicsWidthInput);
    graphicsStyleRow.appendChild(graphicsOpacityInput);

    const graphicsEditorHint = document.createElement("p");
    graphicsEditorHint.id = "operationGraphicEditorHint";
    graphicsEditorHint.className = "sidebar-tool-hint mt-2";
    graphicsEditorHint.textContent = t("Edit vertices and style.", "ui");

    const graphicsActions = buildRow();
    graphicsActions.className = "sidebar-equal-actions mt-3 strategic-graphics-management-actions";
    graphicsActions.appendChild(buildButton("operationGraphicUndoBtn", "Undo Vertex"));
    graphicsActions.appendChild(buildButton("operationGraphicFinishBtn", "Finish"));
    graphicsActions.appendChild(buildButton("operationGraphicCancelBtn", "Cancel"));
    graphicsActions.appendChild(buildButton("operationGraphicDeleteBtn", "Delete Selected"));
    const graphicsDeleteVertexBtn = buildButton("operationGraphicDeleteVertexBtn", "Delete Vertex");
    let skipDeleteGraphicVertexClick = false;
    const handleDeleteGraphicVertex = (event) => {
      event?.preventDefault?.();
      if (event?.type === "click" && skipDeleteGraphicVertexClick) {
        skipDeleteGraphicVertexClick = false;
        return;
      }
      if (event?.type === "pointerdown") {
        skipDeleteGraphicVertexClick = true;
      }
      deleteSelectedOperationGraphicVertex();
      refreshStrategicOverlayUI();
    };
    graphicsDeleteVertexBtn.addEventListener("pointerdown", handleDeleteGraphicVertex);
    graphicsDeleteVertexBtn.addEventListener("click", handleDeleteGraphicVertex);
    graphicsDeleteVertexBtn.dataset.bound = "true";
    graphicsActions.appendChild(graphicsDeleteVertexBtn);

    const graphicsList = document.createElement("select");
    graphicsList.id = "operationGraphicList";
    graphicsList.className = "select-input mt-2 strategic-graphics-list";
    graphicsList.size = 4;

    const graphicsAdvanced = document.createElement("details");
    graphicsAdvanced.className = "unit-counter-advanced-shell frontline-advanced-shell mt-2";
    const graphicsAdvancedSummary = document.createElement("summary");
    graphicsAdvancedSummary.className = "unit-counter-advanced-summary";
    graphicsAdvancedSummary.textContent = t("Graphic Style Controls", "ui");
    const graphicsAdvancedBody = document.createElement("div");
    graphicsAdvancedBody.className = "unit-counter-advanced-body";
    graphicsAdvancedBody.appendChild(graphicsStyleRow);
    graphicsAdvanced.appendChild(graphicsAdvancedSummary);
    graphicsAdvanced.appendChild(graphicsAdvancedBody);

    const countersBlock = document.createElement("div");
    countersBlock.className = "frontline-workbench-block strategic-workspace-section strategic-workspace-section-counters";
    const unitHeader = document.createElement("div");
    unitHeader.className = "section-header mt-4";
    unitHeader.textContent = t("Unit Counters", "ui");
    const unitEditorShell = document.createElement("div");
    unitEditorShell.className = "unit-counter-editor-shell mt-2";
    unitEditorShell.id = "unitCounterEditorShell";

    const unitPreviewFrame = document.createElement("div");
    unitPreviewFrame.className = "unit-counter-preview-frame";

    const unitPreviewCard = document.createElement("div");
    unitPreviewCard.id = "unitCounterPreviewCard";
    unitPreviewCard.className = "unit-counter-preview-shell is-compact";

    const unitPreviewActions = document.createElement("div");
    unitPreviewActions.className = "unit-counter-preview-actions";
    const unitDetailToggleBtn = document.createElement("button");
    unitDetailToggleBtn.type = "button";
    unitDetailToggleBtn.id = "unitCounterDetailToggleBtn";
    unitDetailToggleBtn.className = "btn secondary unit-counter-detail-icon-btn";
    unitDetailToggleBtn.setAttribute("aria-label", t("Toggle details", "ui"));
    unitDetailToggleBtn.setAttribute("aria-haspopup", "dialog");
    unitDetailToggleBtn.textContent = "\u2699";
    unitPreviewActions.appendChild(unitDetailToggleBtn);

    unitPreviewFrame.appendChild(unitPreviewCard);
    unitPreviewFrame.appendChild(unitPreviewActions);

    const unitPlacementStatus = document.createElement("div");
    unitPlacementStatus.id = "unitCounterPlacementStatus";
    unitPlacementStatus.className = "unit-counter-placement-status hidden";

    const unitPresetNationRow = buildRow();
    unitPresetNationRow.className = "unit-counter-grid-row unit-counter-fast-row mt-3 strategic-counter-fast-controls";
    const unitPresetSelect = buildSelect("unitCounterPresetSelect", featuredUnitCounterPresets.map((preset) => [
      preset.id,
      `${preset.label} · ${preset.shortCode}`,
    ]));
    const unitNationModeSelect = buildSelect("unitCounterNationModeSelect", [
      ["display", "Nation: Auto"],
      ["manual", "Nation: Manual"],
    ]);
    const unitNationSelect = buildSelect("unitCounterNationSelect", [["", "Auto from placement"]]);
    const unitAttachmentSelect = buildSelect("unitCounterAttachmentSelect", [["", "Anchor: Province / Free"]]);
    const unitEchelonSelect = buildSelect("unitCounterEchelonSelect", unitCounterEchelons);
    const unitLabelInput = buildInput("unitCounterLabelInput", "Counter Label");
    unitPresetNationRow.appendChild(unitPresetSelect);
    unitPresetNationRow.appendChild(unitNationModeSelect);
    unitPresetNationRow.appendChild(unitNationSelect);
    unitPresetNationRow.appendChild(unitAttachmentSelect);
    unitPresetNationRow.appendChild(unitEchelonSelect);
    unitPresetNationRow.appendChild(unitLabelInput);

    const unitIdentityGroup = buildDetailGroup("unitCounterIdentityGroup", "Identity", { open: true });
    const unitCombatGroup = buildDetailGroup("unitCounterCombatGroup", "Combat State", { open: true });
    const unitFinishGroup = buildDetailGroup("unitCounterFinishGroup", "Finish", { open: false });

    const counterEditorModalOverlay = document.createElement("div");
    counterEditorModalOverlay.id = "unitCounterEditorModalOverlay";
    counterEditorModalOverlay.className = "counter-editor-modal-overlay hidden";
    const counterEditorModal = document.createElement("div");
    counterEditorModal.id = "unitCounterEditorModal";
    counterEditorModal.className = "counter-editor-modal";
    counterEditorModal.setAttribute("role", "dialog");
    counterEditorModal.setAttribute("aria-modal", "true");
    counterEditorModal.setAttribute("aria-labelledby", "unitCounterEditorModalTitle");
    counterEditorModal.tabIndex = -1;
    const counterEditorModalHeader = document.createElement("div");
    counterEditorModalHeader.className = "counter-editor-modal-header";
    const counterEditorModalCopy = document.createElement("div");
    counterEditorModalCopy.className = "counter-editor-modal-copy";
    const counterEditorModalTitle = document.createElement("h2");
    counterEditorModalTitle.id = "unitCounterEditorModalTitle";
    counterEditorModalTitle.className = "counter-editor-modal-title";
    counterEditorModalTitle.textContent = t("Counter Editor", "ui");
    counterEditorModalCopy.append(counterEditorModalTitle);
    const counterEditorModalCloseBtn = document.createElement("button");
    counterEditorModalCloseBtn.type = "button";
    counterEditorModalCloseBtn.id = "unitCounterEditorModalCloseBtn";
    counterEditorModalCloseBtn.className = "counter-editor-modal-close-btn";
    counterEditorModalCloseBtn.setAttribute("aria-label", t("Close counter editor", "ui"));
    counterEditorModalCloseBtn.textContent = "\u00D7";
    counterEditorModalHeader.append(counterEditorModalCopy, counterEditorModalCloseBtn);

    const counterEditorModalBody = document.createElement("div");
    counterEditorModalBody.className = "counter-editor-modal-body";
    const counterEditorModalPreview = document.createElement("div");
    counterEditorModalPreview.className = "counter-editor-modal-preview";
    const unitDetailPreviewCard = document.createElement("div");
    unitDetailPreviewCard.id = "unitCounterDetailPreviewCard";
    unitDetailPreviewCard.className = "unit-counter-preview-shell counter-editor-preview-shell";
    const counterEditorModalStatus = document.createElement("div");
    counterEditorModalStatus.id = "unitCounterEditorModalStatus";
    counterEditorModalStatus.className = "counter-editor-modal-status hidden";
    counterEditorModalPreview.append(unitDetailPreviewCard, counterEditorModalStatus);

    const counterEditorModalControls = document.createElement("div");
    counterEditorModalControls.className = "counter-editor-modal-controls";
    const unitCounterCatalogPanel = document.createElement("div");
    unitCounterCatalogPanel.className = "counter-editor-symbol-panel";
    const unitCounterCatalogHeader = document.createElement("div");
    unitCounterCatalogHeader.className = "counter-editor-symbol-header";
    const unitCounterCatalogHeaderTitle = document.createElement("div");
    unitCounterCatalogHeaderTitle.id = "unitCounterCatalogHeaderTitle";
    unitCounterCatalogHeaderTitle.className = "section-header";
    unitCounterCatalogHeaderTitle.textContent = t("Symbol Browser", "ui");
    const unitCounterCatalogHeaderHint = document.createElement("p");
    unitCounterCatalogHeaderHint.id = "unitCounterCatalogHeaderHint";
    unitCounterCatalogHeaderHint.className = "sidebar-tool-hint";
    unitCounterCatalogHeaderHint.textContent = t("Search symbols.", "ui");
    unitCounterCatalogHeader.append(unitCounterCatalogHeaderTitle, unitCounterCatalogHeaderHint);
    const unitCounterCatalogSourceTabs = document.createElement("div");
    unitCounterCatalogSourceTabs.id = "unitCounterCatalogSourceTabs";
    unitCounterCatalogSourceTabs.className = "counter-editor-source-tabs";
    const unitCounterInternalSourceBtn = document.createElement("button");
    unitCounterInternalSourceBtn.type = "button";
    unitCounterInternalSourceBtn.className = "counter-editor-source-btn";
    unitCounterInternalSourceBtn.dataset.counterCatalogSource = "internal";
    unitCounterInternalSourceBtn.textContent = t("Internal", "ui");
    const unitCounterHoi4SourceBtn = document.createElement("button");
    unitCounterHoi4SourceBtn.type = "button";
    unitCounterHoi4SourceBtn.className = "counter-editor-source-btn";
    unitCounterHoi4SourceBtn.dataset.counterCatalogSource = "hoi4";
    unitCounterHoi4SourceBtn.textContent = t("HOI4 Library", "ui");
    unitCounterCatalogSourceTabs.append(unitCounterInternalSourceBtn, unitCounterHoi4SourceBtn);
    const unitCounterCatalogSearchInput = buildInput("unitCounterCatalogSearchInput", "Search symbols");
    unitCounterCatalogSearchInput.classList.add("counter-editor-symbol-search");
    const unitCounterLibraryVariantRow = document.createElement("div");
    unitCounterLibraryVariantRow.id = "unitCounterLibraryVariantRow";
    unitCounterLibraryVariantRow.className = "counter-editor-category-row hidden";
    const unitCounterLibrarySmallVariantBtn = document.createElement("button");
    unitCounterLibrarySmallVariantBtn.type = "button";
    unitCounterLibrarySmallVariantBtn.className = "counter-editor-category-btn";
    unitCounterLibrarySmallVariantBtn.dataset.counterLibraryVariant = "small";
    unitCounterLibrarySmallVariantBtn.textContent = t("On-map Small", "ui");
    const unitCounterLibraryLargeVariantBtn = document.createElement("button");
    unitCounterLibraryLargeVariantBtn.type = "button";
    unitCounterLibraryLargeVariantBtn.className = "counter-editor-category-btn";
    unitCounterLibraryLargeVariantBtn.dataset.counterLibraryVariant = "large";
    unitCounterLibraryLargeVariantBtn.textContent = t("Large", "ui");
    unitCounterLibraryVariantRow.append(unitCounterLibrarySmallVariantBtn, unitCounterLibraryLargeVariantBtn);
    const unitCounterLibraryReviewBar = document.createElement("div");
    unitCounterLibraryReviewBar.id = "unitCounterLibraryReviewBar";
    unitCounterLibraryReviewBar.className = "counter-editor-library-review-bar hidden";
    const unitCounterLibraryReviewSummary = document.createElement("div");
    unitCounterLibraryReviewSummary.id = "unitCounterLibraryReviewSummary";
    unitCounterLibraryReviewSummary.className = "counter-editor-library-review-summary";
    const unitCounterLibraryExportBtn = buildButton("unitCounterLibraryExportBtn", "Export HOI4 Review JSON");
    unitCounterLibraryExportBtn.classList.add("counter-editor-library-export-btn");
    unitCounterLibraryReviewBar.append(unitCounterLibraryReviewSummary, unitCounterLibraryExportBtn);
    const unitCounterCatalogCategoriesEl = document.createElement("div");
    unitCounterCatalogCategoriesEl.id = "unitCounterCatalogCategories";
    unitCounterCatalogCategoriesEl.className = "counter-editor-category-row";
    const unitCounterCatalogGrid = document.createElement("div");
    unitCounterCatalogGrid.id = "unitCounterCatalogGrid";
    unitCounterCatalogGrid.className = "counter-editor-symbol-grid";
    unitCounterCatalogPanel.append(
      unitCounterCatalogHeader,
      unitCounterCatalogSourceTabs,
      unitCounterCatalogSearchInput,
      unitCounterLibraryVariantRow,
      unitCounterLibraryReviewBar,
      unitCounterCatalogCategoriesEl,
      unitCounterCatalogGrid
    );

    const unitDetailDrawer = document.createElement("div");
    unitDetailDrawer.id = "unitCounterDetailDrawer";
    unitDetailDrawer.className = "unit-counter-detail-drawer";

    const unitIdentityBlock = document.createElement("div");
    unitIdentityBlock.className = "unit-counter-detail-block";

    const unitModeRow = buildRow();
    unitModeRow.className = "unit-counter-grid-row mt-2";
    const unitRendererSelect = buildSelect("unitCounterRendererSelect", [
      ["game", "Game"],
      ["milstd", "MILSTD"],
    ]);
    const unitSizeSelect = buildSelect("unitCounterSizeSelect", [
      ["small", "Small"],
      ["medium", "Medium"],
      ["large", "Large"],
    ]);
    unitModeRow.appendChild(unitRendererSelect);
    unitModeRow.appendChild(unitSizeSelect);

    const unitCopyRow = buildRow();
    unitCopyRow.className = "unit-counter-grid-row mt-2";
    const unitSubLabelInput = buildInput("unitCounterSubLabelInput", "Sub-label");
    const unitStrengthInput = buildInput("unitCounterStrengthInput", "Strength");
    unitCopyRow.appendChild(unitSubLabelInput);
    unitCopyRow.appendChild(unitStrengthInput);

    const unitSymbolInput = buildInput("unitCounterSymbolInput", "SIDC / Symbol Code");
    const unitSymbolHint = document.createElement("p");
    unitSymbolHint.id = "unitCounterSymbolHint";
    unitSymbolHint.className = "sidebar-tool-hint mt-2";
    unitSymbolHint.textContent = t("Short code or SIDC.", "ui");
    unitIdentityBlock.appendChild(unitModeRow);
    unitIdentityBlock.appendChild(unitCopyRow);
    unitIdentityBlock.appendChild(unitSymbolInput);
    unitIdentityBlock.appendChild(unitSymbolHint);

    const unitCombatBlock = document.createElement("div");
    unitCombatBlock.className = "unit-counter-detail-block";

    const unitCombatPresetField = buildSegmentedChoiceField("unitCounterStatsPresetSelect", unitCounterCombatPresets.map((preset) => [
      preset.id,
      preset.label,
    ]), {
      groupClassName: "unit-counter-stat-preset-group",
      buttonClassName: "unit-counter-stat-preset-button",
    });
    unitCombatPresetField.shell.querySelectorAll("button").forEach((button) => {
      button.removeAttribute("data-frontline-style-choice");
      button.dataset.unitCounterStatsPresetChoice = "true";
    });
    const unitRandomizeBtn = buildButton("unitCounterStatsRandomizeBtn", "Randomize");
    unitRandomizeBtn.classList.add("secondary");

    const unitCombatPresetStack = document.createElement("div");
    unitCombatPresetStack.className = "unit-counter-combat-preset-stack mt-2";
    unitCombatPresetStack.appendChild(unitCombatPresetField.shell);
    unitCombatPresetStack.appendChild(unitRandomizeBtn);

    const unitStatInputs = buildRow();
    unitStatInputs.className = "unit-counter-grid-row mt-2";
    const unitOrganizationInput = buildInput("unitCounterOrganizationInput", "Organization", "number");
    unitOrganizationInput.min = "0";
    unitOrganizationInput.max = "100";
    unitOrganizationInput.step = "1";
    const unitEquipmentInput = buildInput("unitCounterEquipmentInput", "Equipment", "number");
    unitEquipmentInput.min = "0";
    unitEquipmentInput.max = "100";
    unitEquipmentInput.step = "1";
    unitStatInputs.appendChild(unitOrganizationInput);
    unitStatInputs.appendChild(unitEquipmentInput);

    const unitCombatBars = document.createElement("div");
    unitCombatBars.className = "unit-counter-combat-bar-stack mt-2";
    unitCombatBars.append(
      buildCombatBar({
        id: "unitCounterOrganizationBar",
        label: "Organization",
        className: "unit-counter-combat-bar is-org",
      }),
      buildCombatBar({
        id: "unitCounterEquipmentBar",
        label: "Equipment",
        className: "unit-counter-combat-bar is-equipment",
      })
    );
    unitCombatBlock.appendChild(unitCombatPresetStack);
    unitCombatBlock.appendChild(unitStatInputs);
    unitCombatBlock.appendChild(unitCombatBars);

    const unitFinishBlock = document.createElement("div");
    unitFinishBlock.className = "unit-counter-detail-block";

    const unitColorPanel = document.createElement("div");
    unitColorPanel.className = "unit-counter-color-panel mt-2";
    const unitColorSwatch = document.createElement("button");
    unitColorSwatch.type = "button";
    unitColorSwatch.id = "unitCounterBaseFillSwatch";
    unitColorSwatch.className = "unit-counter-color-swatch";
    unitColorSwatch.setAttribute("aria-label", t("Counter fill swatch", "ui"));
    const unitColorInput = buildInput("unitCounterBaseFillColorInput", "", "color");
    unitColorInput.classList.add("unit-counter-color-input");
    unitColorInput.setAttribute("aria-label", t("Counter fill color", "ui"));
    const unitColorResetBtn = buildButton("unitCounterBaseFillResetBtn", "Paper");
    unitColorResetBtn.classList.add("secondary");
    const unitColorEyedropperBtn = buildButton("unitCounterBaseFillEyedropperBtn", "Eyedropper");
    unitColorEyedropperBtn.classList.add("secondary");
    unitColorPanel.appendChild(unitColorSwatch);
    unitColorPanel.appendChild(unitColorInput);
    unitColorPanel.appendChild(unitColorResetBtn);
    unitColorPanel.appendChild(unitColorEyedropperBtn);
    unitFinishBlock.appendChild(unitColorPanel);

    unitIdentityGroup.body.appendChild(unitIdentityBlock);
    unitCombatGroup.body.appendChild(unitCombatBlock);
    unitFinishGroup.body.appendChild(unitFinishBlock);
    unitDetailDrawer.appendChild(unitIdentityGroup.shell);
    unitDetailDrawer.appendChild(unitCombatGroup.shell);
    unitDetailDrawer.appendChild(unitFinishGroup.shell);

    counterEditorModalControls.append(unitCounterCatalogPanel, unitDetailDrawer);
    counterEditorModalBody.append(counterEditorModalPreview, counterEditorModalControls);
    counterEditorModal.append(counterEditorModalHeader, counterEditorModalBody);
    counterEditorModalOverlay.appendChild(counterEditorModal);

    const unitOptionsRow = buildRow();
    unitOptionsRow.className = "mt-2 flex flex-wrap items-center justify-between gap-2 strategic-counter-visual-options";
    const unitLabelToggle = buildCheckboxLabel("unitCounterLabelsToggle", "Show Labels", "checkbox-row");
    unitOptionsRow.appendChild(unitLabelToggle);
    const unitScaleShell = document.createElement("div");
    unitScaleShell.className = "strategic-counter-scale-shell";
    const unitScaleRow = document.createElement("div");
    unitScaleRow.className = "range-row";
    const unitScaleLabel = document.createElement("label");
    unitScaleLabel.className = "range-label";
    unitScaleLabel.setAttribute("for", "unitCounterFixedScaleRange");
    unitScaleLabel.textContent = t("Counter Scale", "ui");
    const unitScaleValue = document.createElement("span");
    unitScaleValue.id = "unitCounterFixedScaleValue";
    unitScaleValue.className = "range-value";
    unitScaleValue.textContent = "1.50x";
    unitScaleRow.append(unitScaleLabel, unitScaleValue);
    unitScaleShell.appendChild(unitScaleRow);
    const unitScaleRange = document.createElement("input");
    unitScaleRange.id = "unitCounterFixedScaleRange";
    unitScaleRange.type = "range";
    unitScaleRange.min = "50";
    unitScaleRange.max = "200";
    unitScaleRange.step = "5";
    unitScaleRange.value = "150";
    unitScaleRange.className = "range-input";
    unitScaleShell.appendChild(unitScaleRange);
    unitOptionsRow.appendChild(unitScaleShell);

    const unitActions = buildRow();
    unitActions.className = "sidebar-equal-actions mt-3 strategic-counter-management-actions";
    const createCounterActionButton = (id, label, iconText, fullLabel) => {
      const button = buildButton(id, label);
      button.classList.add("strategic-counter-action-btn");
      button.setAttribute("title", t(fullLabel || label, "ui"));
      button.setAttribute("aria-label", t(fullLabel || label, "ui"));
      const icon = document.createElement("span");
      icon.className = "strategic-counter-action-icon";
      icon.textContent = iconText;
      const copy = document.createElement("span");
      copy.className = "strategic-counter-action-label";
      copy.textContent = t(label, "ui");
      button.replaceChildren(icon, copy);
      return button;
    };
    unitActions.appendChild(createCounterActionButton("unitCounterPlaceBtn", "Place", "+", "Place Counter"));
    unitActions.appendChild(createCounterActionButton("unitCounterCancelBtn", "Cancel", "\u00D7", "Cancel Place"));
    unitActions.appendChild(createCounterActionButton("unitCounterDeleteBtn", "Delete", "\u2212", "Delete Selected"));

    const unitListHeader = document.createElement("div");
    unitListHeader.className = "unit-counter-list-header mt-3 strategic-counter-list-header";
    const unitListTitle = document.createElement("div");
    unitListTitle.className = "section-header";
    unitListTitle.textContent = t("Placed Counters", "ui");
    unitListHeader.appendChild(unitListTitle);

    const unitList = document.createElement("select");
    unitList.id = "unitCounterList";
    unitList.className = "select-input mt-2 unit-counter-list strategic-counter-list";
    unitList.size = 4;

    strategicOverlaySection.appendChild(headerRow);
    strategicOverlaySection.appendChild(workspaceActions);
    operationalLineBlock.appendChild(operationalLineHeader);
    operationalLineBlock.appendChild(operationalLineRow);
    operationalLineBlock.appendChild(operationalLineStyleRow);
    operationalLineBlock.appendChild(operationalLineEditorHint);
    operationalLineBlock.appendChild(operationalLineActions);
    operationalLineBlock.appendChild(operationalLineList);
    graphicsBlock.appendChild(graphicsHeader);
    graphicsBlock.appendChild(graphicsRow);
    graphicsBlock.appendChild(graphicsAdvanced);
    graphicsBlock.appendChild(graphicsEditorHint);
    graphicsBlock.appendChild(graphicsActions);
    graphicsBlock.appendChild(graphicsList);
    countersBlock.appendChild(unitHeader);
    unitEditorShell.appendChild(unitPreviewFrame);
    unitEditorShell.appendChild(unitPlacementStatus);
    unitEditorShell.appendChild(unitPresetNationRow);
    unitEditorShell.appendChild(unitOptionsRow);
    unitEditorShell.appendChild(unitActions);
    unitEditorShell.appendChild(unitListHeader);
    unitEditorShell.appendChild(unitList);
    countersBlock.appendChild(unitEditorShell);
    document.body.appendChild(counterEditorModalOverlay);

    const buildAccordionSection = (id, title, contentBlock, opts = {}) => {
      const wrapper = document.createElement("div");
      wrapper.className = "strategic-accordion-section";
      wrapper.id = id;
      const header = document.createElement("button");
      header.type = "button";
      header.className = "strategic-accordion-header";
      const arrow = document.createElement("span");
      arrow.className = "strategic-accordion-arrow";
      setUiIcon(arrow, "chevron-right", { size: 14 });
      const titleEl = document.createElement("span");
      titleEl.className = "strategic-accordion-title";
      titleEl.textContent = t(title, "ui");
      const badge = document.createElement("span");
      badge.className = "strategic-accordion-badge";
      badge.textContent = "0";
      header.appendChild(arrow);
      header.appendChild(titleEl);
      header.appendChild(badge);
      const body = document.createElement("div");
      body.className = "strategic-accordion-body";
      body.id = `${id}Body`;
      body.appendChild(contentBlock);
      const syncExpandedState = (isOpen) => {
        wrapper.classList.toggle("is-open", !!isOpen);
        header.setAttribute("aria-expanded", isOpen ? "true" : "false");
      };
      header.setAttribute("aria-controls", body.id);
      header.addEventListener("click", () => {
        syncExpandedState(!wrapper.classList.contains("is-open"));
      });
      wrapper.appendChild(header);
      wrapper.appendChild(body);
      syncExpandedState(!!opts.defaultOpen);
      return wrapper;
    };

    const accordionLines = buildAccordionSection("accordionLines", "Operational Lines", operationalLineBlock, { defaultOpen: true });
    const accordionGraphics = buildAccordionSection("accordionGraphics", "Operation Graphics", graphicsBlock);
    const accordionCounters = buildAccordionSection("accordionCounters", "Unit Counters", countersBlock);
    strategicOverlaySection.appendChild(accordionLines);
    strategicOverlaySection.appendChild(accordionGraphics);
    strategicOverlaySection.appendChild(accordionCounters);
    frontlineTabStack.appendChild(strategicOverlaySection);
  }

  if (strategicOverlaySection && frontlineTabStack && strategicOverlaySection.parentElement !== frontlineTabStack) {
    strategicOverlaySection.classList.add("frontline-tab-card");
    frontlineTabStack.appendChild(strategicOverlaySection);
  }

  let strategicWorkspaceBackdrop = document.getElementById("strategicWorkspaceBackdrop");
  if (!strategicWorkspaceBackdrop) {
    strategicWorkspaceBackdrop = document.createElement("div");
    strategicWorkspaceBackdrop.id = "strategicWorkspaceBackdrop";
    strategicWorkspaceBackdrop.className = "strategic-workspace-backdrop hidden";
    document.body.appendChild(strategicWorkspaceBackdrop);
  }

  let strategicCommandBar = document.getElementById("strategicCommandBar");
  if (!strategicCommandBar) {
    strategicCommandBar = document.createElement("div");
    strategicCommandBar.id = "strategicCommandBar";
    strategicCommandBar.className = "strategic-command-bar";
    [
      ["strategicCommandFrontlineBtn", "frontline", "作战前线"],
      ["strategicCommandOffensiveBtn", "offensive_line", "进攻线"],
      ["strategicCommandSpearheadBtn", "spearhead_line", "穿插线"],
      ["strategicCommandDefensiveBtn", "defensive_line", "防守线"],
    ].forEach(([id, lineKind, label]) => {
      const button = document.createElement("button");
      button.id = id;
      button.type = "button";
      button.className = "strategic-command-btn";
      button.dataset.lineKind = lineKind;
      button.textContent = t(label, "ui");
      strategicCommandBar.appendChild(button);
    });
    document.body.appendChild(strategicCommandBar);
  }

  const frontlineEnabledStatus = document.getElementById("frontlineEnabledStatus");
  const frontlineStatusHint = document.getElementById("frontlineStatusHint");
  const frontlineEnabledToggle = document.getElementById("frontlineEnabledToggle");
  const frontlineEmptyState = document.getElementById("frontlineEmptyState");
  const frontlineSettingsPanel = document.getElementById("frontlineSettingsPanel");
  const strategicFrontlineStyleSelect = document.getElementById("strategicFrontlineStyleSelect");
  const frontlineStyleChoiceButtons = Array.from(document.querySelectorAll("[data-frontline-style-choice]"));
  const strategicFrontlineLabelsToggle = document.getElementById("strategicFrontlineLabelsToggle");
  const strategicLabelPlacementSelect = document.getElementById("strategicLabelPlacementSelect");
  const strategicWorkspaceBackdropEl = document.getElementById("strategicWorkspaceBackdrop");
  const strategicCommandButtons = Array.from(document.querySelectorAll("#strategicCommandBar .strategic-command-btn"));
  const strategicOverlayOpenWorkspaceBtn = document.getElementById("strategicOverlayOpenWorkspaceBtn");
  const strategicOverlayCloseWorkspaceBtn = document.getElementById("strategicOverlayCloseWorkspaceBtn");
  const strategicOverlayIconCloseBtn = document.getElementById("strategicOverlayIconCloseBtn");
  const strategicOverlayPublishStatus = document.getElementById("strategicOverlayPublishStatus");
  const operationalLineKindSelect = document.getElementById("operationalLineKindSelect");
  const operationalLineLabelInput = document.getElementById("operationalLineLabelInput");
  const operationalLineStrokeInput = document.getElementById("operationalLineStrokeInput");
  const operationalLineWidthInput = document.getElementById("operationalLineWidthInput");
  const operationalLineOpacityInput = document.getElementById("operationalLineOpacityInput");
  const operationalLineEditorHint = document.getElementById("operationalLineEditorHint");
  const operationalLineStartBtn = document.getElementById("operationalLineStartBtn");
  const operationalLineUndoBtn = document.getElementById("operationalLineUndoBtn");
  const operationalLineFinishBtn = document.getElementById("operationalLineFinishBtn");
  const operationalLineCancelBtn = document.getElementById("operationalLineCancelBtn");
  const operationalLineDeleteBtn = document.getElementById("operationalLineDeleteBtn");
  const operationalLineList = document.getElementById("operationalLineList");
  const operationGraphicKindSelect = document.getElementById("operationGraphicKindSelect");
  const operationGraphicLabelInput = document.getElementById("operationGraphicLabelInput");
  const operationGraphicPresetSelect = document.getElementById("operationGraphicPresetSelect");
  const operationGraphicStrokeInput = document.getElementById("operationGraphicStrokeInput");
  const operationGraphicWidthInput = document.getElementById("operationGraphicWidthInput");
  const operationGraphicOpacityInput = document.getElementById("operationGraphicOpacityInput");
  const operationGraphicEditorHint = document.getElementById("operationGraphicEditorHint");
  const operationGraphicStartBtn = document.getElementById("operationGraphicStartBtn");
  const operationGraphicUndoBtn = document.getElementById("operationGraphicUndoBtn");
  const operationGraphicFinishBtn = document.getElementById("operationGraphicFinishBtn");
  const operationGraphicCancelBtn = document.getElementById("operationGraphicCancelBtn");
  const operationGraphicDeleteBtn = document.getElementById("operationGraphicDeleteBtn");
  const operationGraphicDeleteVertexBtn = document.getElementById("operationGraphicDeleteVertexBtn");
  const operationGraphicList = document.getElementById("operationGraphicList");
  const unitCounterPreviewCard = document.getElementById("unitCounterPreviewCard");
  const unitCounterPlacementStatus = document.getElementById("unitCounterPlacementStatus");
  const unitCounterDetailToggleBtn = document.getElementById("unitCounterDetailToggleBtn");
  const unitCounterEditorModalOverlay = document.getElementById("unitCounterEditorModalOverlay");
  const unitCounterEditorModal = document.getElementById("unitCounterEditorModal");
  const unitCounterEditorModalCloseBtn = document.getElementById("unitCounterEditorModalCloseBtn");
  const unitCounterEditorModalStatus = document.getElementById("unitCounterEditorModalStatus");
  const unitCounterDetailPreviewCard = document.getElementById("unitCounterDetailPreviewCard");
  const unitCounterDetailDrawer = document.getElementById("unitCounterDetailDrawer");
  const unitCounterPresetSelect = document.getElementById("unitCounterPresetSelect");
  const unitCounterNationModeSelect = document.getElementById("unitCounterNationModeSelect");
  const unitCounterNationSelect = document.getElementById("unitCounterNationSelect");
  const unitCounterAttachmentSelect = document.getElementById("unitCounterAttachmentSelect");
  const unitCounterRendererSelect = document.getElementById("unitCounterRendererSelect");
  const unitCounterSizeSelect = document.getElementById("unitCounterSizeSelect");
  const unitCounterEchelonSelect = document.getElementById("unitCounterEchelonSelect");
  const unitCounterLabelInput = document.getElementById("unitCounterLabelInput");
  const unitCounterSubLabelInput = document.getElementById("unitCounterSubLabelInput");
  const unitCounterStrengthInput = document.getElementById("unitCounterStrengthInput");
  const unitCounterSymbolInput = document.getElementById("unitCounterSymbolInput");
  const unitCounterSymbolHint = document.getElementById("unitCounterSymbolHint");
  const unitCounterStatsPresetSelect = document.getElementById("unitCounterStatsPresetSelect");
  const unitCounterStatsPresetButtons = Array.from(document.querySelectorAll("[data-unit-counter-stats-preset-choice]"));
  const unitCounterStatsRandomizeBtn = document.getElementById("unitCounterStatsRandomizeBtn");
  const unitCounterOrganizationInput = document.getElementById("unitCounterOrganizationInput");
  const unitCounterEquipmentInput = document.getElementById("unitCounterEquipmentInput");
  const unitCounterOrganizationBar = document.getElementById("unitCounterOrganizationBar");
  const unitCounterEquipmentBar = document.getElementById("unitCounterEquipmentBar");
  const unitCounterBaseFillSwatch = document.getElementById("unitCounterBaseFillSwatch");
  const unitCounterBaseFillColorInput = document.getElementById("unitCounterBaseFillColorInput");
  const unitCounterBaseFillResetBtn = document.getElementById("unitCounterBaseFillResetBtn");
  const unitCounterBaseFillEyedropperBtn = document.getElementById("unitCounterBaseFillEyedropperBtn");
  const unitCounterLabelsToggle = document.getElementById("unitCounterLabelsToggle");
  const unitCounterFixedScaleRange = document.getElementById("unitCounterFixedScaleRange");
  const unitCounterFixedScaleValue = document.getElementById("unitCounterFixedScaleValue");
  const unitCounterPlaceBtn = document.getElementById("unitCounterPlaceBtn");
  const unitCounterCancelBtn = document.getElementById("unitCounterCancelBtn");
  const unitCounterDeleteBtn = document.getElementById("unitCounterDeleteBtn");
  const unitCounterList = document.getElementById("unitCounterList");
  const unitCounterCatalogHeaderTitle = document.getElementById("unitCounterCatalogHeaderTitle");
  const unitCounterCatalogHeaderHint = document.getElementById("unitCounterCatalogHeaderHint");
  const unitCounterCatalogSourceTabs = document.getElementById("unitCounterCatalogSourceTabs");
  const unitCounterCatalogSearchInput = document.getElementById("unitCounterCatalogSearchInput");
  const unitCounterLibraryVariantRow = document.getElementById("unitCounterLibraryVariantRow");
  const unitCounterLibraryReviewBar = document.getElementById("unitCounterLibraryReviewBar");
  const unitCounterLibraryReviewSummary = document.getElementById("unitCounterLibraryReviewSummary");
  const unitCounterLibraryExportBtn = document.getElementById("unitCounterLibraryExportBtn");
  const unitCounterCatalogCategoriesEl = document.getElementById("unitCounterCatalogCategories");
  const unitCounterCatalogGrid = document.getElementById("unitCounterCatalogGrid");

  return {
    elements: {
      frontlineEnabledStatus,
      frontlineStatusHint,
      frontlineEnabledToggle,
      frontlineEmptyState,
      frontlineSettingsPanel,
      strategicFrontlineStyleSelect,
      frontlineStyleChoiceButtons,
      strategicFrontlineLabelsToggle,
      strategicLabelPlacementSelect,
      strategicOverlaySection,
      strategicWorkspaceBackdropEl,
      strategicOverlayOpenWorkspaceBtn,
      strategicOverlayCloseWorkspaceBtn,
      strategicOverlayIconCloseBtn,
      strategicOverlayPublishStatus,
      unitCounterDetailDrawer,
      unitCounterDetailToggleBtn,
      operationalLineKindSelect,
      operationalLineLabelInput,
      operationalLineStrokeInput,
      operationalLineWidthInput,
      operationalLineOpacityInput,
      operationalLineList,
      operationalLineStartBtn,
      operationalLineUndoBtn,
      operationalLineFinishBtn,
      operationalLineCancelBtn,
      operationalLineDeleteBtn,
      operationalLineEditorHint,
      strategicCommandButtons,
      operationGraphicKindSelect,
      operationGraphicLabelInput,
      operationGraphicPresetSelect,
      operationGraphicStrokeInput,
      operationGraphicWidthInput,
      operationGraphicOpacityInput,
      operationGraphicList,
      operationGraphicStartBtn,
      operationGraphicUndoBtn,
      operationGraphicFinishBtn,
      operationGraphicCancelBtn,
      operationGraphicDeleteBtn,
      operationGraphicDeleteVertexBtn,
      operationGraphicEditorHint,
      unitCounterPreviewCard,
      unitCounterPlacementStatus,
      unitCounterEditorModalOverlay,
      unitCounterEditorModal,
      unitCounterEditorModalCloseBtn,
      unitCounterEditorModalStatus,
      unitCounterDetailPreviewCard,
      unitCounterPresetSelect,
      unitCounterNationModeSelect,
      unitCounterNationSelect,
      unitCounterAttachmentSelect,
      unitCounterRendererSelect,
      unitCounterSizeSelect,
      unitCounterEchelonSelect,
      unitCounterLabelInput,
      unitCounterSubLabelInput,
      unitCounterStrengthInput,
      unitCounterSymbolInput,
      unitCounterSymbolHint,
      unitCounterStatsPresetSelect,
      unitCounterStatsPresetButtons,
      unitCounterStatsRandomizeBtn,
      unitCounterOrganizationInput,
      unitCounterEquipmentInput,
      unitCounterOrganizationBar,
      unitCounterEquipmentBar,
      unitCounterBaseFillSwatch,
      unitCounterBaseFillColorInput,
      unitCounterBaseFillResetBtn,
      unitCounterBaseFillEyedropperBtn,
      unitCounterLabelsToggle,
      unitCounterFixedScaleRange,
      unitCounterFixedScaleValue,
      unitCounterPlaceBtn,
      unitCounterCancelBtn,
      unitCounterDeleteBtn,
      unitCounterList,
      unitCounterCatalogHeaderTitle,
      unitCounterCatalogHeaderHint,
      unitCounterCatalogSourceTabs,
      unitCounterCatalogSearchInput,
      unitCounterLibraryVariantRow,
      unitCounterLibraryReviewBar,
      unitCounterLibraryReviewSummary,
      unitCounterLibraryExportBtn,
      unitCounterCatalogCategoriesEl,
      unitCounterCatalogGrid,
    },
    helpers: {
      resolveUnitCounterCombatState,
      getFilteredUnitCounterCatalog,
      getUnitCounterCategoryLabel,
      getUnitCounterIconPathById,
      getUnitCounterPresetMeta,
      unitCounterCatalogCategories,
      unitCounterPresets,
      getSidebarUnitCounterPresetOptions,
      inferUnitCounterPresetId,
      getUnitCounterNationMeta,
      getUnitCounterNationOptions,
      getUnitCounterEchelonLabel,
      formatUnitCounterListLabel,
      renderUnitCounterPreview,
      clampUnitCounterFixedScaleMultiplier,
      clampUnitCounterStatValue,
      getUnitCounterCombatPreset,
      getRandomizedUnitCounterCombatState,
      DEFAULT_UNIT_COUNTER_PRESET_ID,
    },
  };
}
