// Transport workbench shell owner.
// Owns shell chrome DOM synchronization and skips unchanged writes during repeated refreshes.

import {
  TRANSPORT_WORKBENCH_DENSITY_FAMILY_IDS,
} from "./transport_workbench_descriptor.js";

const toText = (value) => String(value ?? "");

function syncTextContent(node, value) {
  if (!node) return false;
  const nextValue = toText(value);
  if (node.textContent === nextValue) return false;
  node.textContent = nextValue;
  return true;
}

function syncAttribute(node, name, value) {
  if (!node || typeof node.setAttribute !== "function") return false;
  const nextValue = toText(value);
  if (typeof node.getAttribute === "function" && node.getAttribute(name) === nextValue) return false;
  node.setAttribute(name, nextValue);
  return true;
}

function syncClassToggle(node, className, enabled) {
  if (!node || typeof node.classList?.toggle !== "function") return false;
  const nextEnabled = !!enabled;
  if (typeof node.classList.contains === "function" && node.classList.contains(className) === nextEnabled) {
    return false;
  }
  node.classList.toggle(className, nextEnabled);
  return true;
}

function syncProperty(node, key, value) {
  if (!node) return false;
  if (node[key] === value) return false;
  node[key] = value;
  return true;
}

function normalizeQuarterTurns(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return ((numericValue % 4) + 4) % 4;
}

export function getTransportWorkbenchPackOptionsSignature(packOptions) {
  return JSON.stringify((packOptions || []).map((pack) => [pack.packId, pack.label]));
}

export function syncTransportWorkbenchPackSelectOptions({
  selectNode = null,
  packOptions = [],
  activePackId = "",
} = {}) {
  if (!selectNode) return { rebuilt: false, optionCount: 0, updated: 0 };
  const nextSignature = getTransportWorkbenchPackOptionsSignature(packOptions);
  let rebuilt = false;
  let updated = 0;
  if (selectNode.dataset.packOptionsSignature !== nextSignature) {
    selectNode.replaceChildren(...packOptions.map((pack) => {
      const option = document.createElement("option");
      option.value = pack.packId;
      option.textContent = pack.label;
      return option;
    }));
    selectNode.dataset.packOptionsSignature = nextSignature;
    rebuilt = true;
    updated += 1;
  }
  if (syncProperty(selectNode, "disabled", packOptions.length === 0)) updated += 1;
  if (syncProperty(selectNode, "value", activePackId || "")) updated += 1;
  return { rebuilt, optionCount: packOptions.length, updated };
}

export function createTransportWorkbenchShellOwner({
  body = null,
  scenarioButton = null,
  overlay = null,
  title = null,
  lensTitle = null,
  familyStatus = null,
  countryStatus = null,
  packSelect = null,
  previewMode = null,
  previewTitle = null,
  previewCanvas = null,
  previewControls = null,
  carrierMount = null,
  layerOrderPanel = null,
  zoomOutButton = null,
  zoomInButton = null,
  rotateButton = null,
  inspectorTitle = null,
  inspectorEmptyTitle = null,
  inspectorEmptyBody = null,
  familyTabs = [],
  applyButton = null,
  translate = (label) => label,
  listPackOptions = () => [],
  getApplyButtonState = () => ({ enabled: false, label: "", reason: "" }),
  getCarrierViewState = () => ({}),
  setCarrierFamily = () => {},
  isInfoPopoverOpen = () => false,
  renderInfoContent = () => {},
} = {}) {
  const syncPreviewControls = () => {
    let updated = 0;
    const carrierViewState = getCarrierViewState() || {};
    const currentQuarterTurns = normalizeQuarterTurns(carrierViewState.quarterTurns);
    const defaultQuarterTurns = normalizeQuarterTurns(carrierViewState.defaultQuarterTurns);
    const isAlternateTurn = currentQuarterTurns !== defaultQuarterTurns;
    if (syncTextContent(zoomOutButton, "-")) updated += 1;
    if (syncTextContent(zoomInButton, "+")) updated += 1;
    if (syncTextContent(rotateButton, "90°")) updated += 1;
    if (syncClassToggle(rotateButton, "is-active", isAlternateTurn)) updated += 1;
    if (syncAttribute(rotateButton, "aria-pressed", isAlternateTurn ? "true" : "false")) updated += 1;
    return { updated };
  };

  const syncFamilyTabs = (familyId) => {
    let updated = 0;
    familyTabs.forEach((button) => {
      const isActive = String(button?.dataset?.transportFamily || "") === familyId;
      if (syncClassToggle(button, "is-active", isActive)) updated += 1;
      if (syncAttribute(button, "aria-selected", isActive ? "true" : "false")) updated += 1;
      if (syncAttribute(button, "tabindex", isActive ? "0" : "-1")) updated += 1;
    });
    return updated;
  };

  const render = (context = {}) => {
    const { uiState = {}, family = {}, isOpen = false } = context;
    let updated = 0;
    if (syncClassToggle(body, "transport-workbench-open", isOpen)) updated += 1;
    if (syncClassToggle(overlay, "hidden", !isOpen)) updated += 1;
    if (syncAttribute(overlay, "aria-hidden", isOpen ? "false" : "true")) updated += 1;
    if (syncAttribute(scenarioButton, "aria-expanded", isOpen ? "true" : "false")) updated += 1;
    if (syncAttribute(scenarioButton, "title", isOpen ? translate("Close transport workbench") : translate("Open transport workbench"))) updated += 1;
    if (syncTextContent(title, translate(family.title))) updated += 1;
    if (syncTextContent(lensTitle, translate(family.lensTitle))) updated += 1;
    if (syncTextContent(familyStatus, translate(family.label))) updated += 1;
    if (syncTextContent(countryStatus, context.activePackMeta?.country || uiState.sampleCountry)) updated += 1;
    updated += syncTransportWorkbenchPackSelectOptions({
      selectNode: packSelect,
      packOptions: listPackOptions({ familyId: family.id }),
      activePackId: context.activePackId,
    }).updated;
    const modeLabel = family.id === "layers"
      ? translate("Layer order")
      : TRANSPORT_WORKBENCH_DENSITY_FAMILY_IDS.has(family.id)
        ? `${String(context.config?.displayMode || "inspect").replace(/_/g, " ")} · ${String(context.config?.displayPreset || "balanced").replace(/_/g, " ")}`
        : uiState.previewMode === "bounded_zoom_pan"
          ? translate("Zoom / pan / quarter-turn")
          : uiState.previewMode;
    if (syncTextContent(previewMode, modeLabel)) updated += 1;
    const previewTitleLabel = family.id === "layers"
      ? translate(family.previewTitle)
      : (uiState.sampleCountry === "Japan" ? translate("Japan preview") : `${uiState.sampleCountry} preview`);
    if (syncTextContent(previewTitle, previewTitleLabel)) updated += 1;
    const applyButtonState = getApplyButtonState(family.id) || {};
    if (isInfoPopoverOpen()) {
      renderInfoContent(family);
    }
    if (syncTextContent(inspectorTitle, `${translate(family.label)} ${translate("inspector")}`)) updated += 1;
    if (syncTextContent(inspectorEmptyTitle, translate(family.inspectorEmptyTitle))) updated += 1;
    if (syncTextContent(inspectorEmptyBody, translate(family.inspectorEmptyBody))) updated += 1;
    const isLayerMode = family.id === "layers";
    if (syncClassToggle(previewCanvas, "is-layer-order-mode", isLayerMode)) updated += 1;
    if (syncClassToggle(previewControls, "hidden", isLayerMode)) updated += 1;
    if (syncClassToggle(carrierMount, "hidden", isLayerMode)) updated += 1;
    if (syncClassToggle(layerOrderPanel, "hidden", !isLayerMode)) updated += 1;
    setCarrierFamily(family.id);
    updated += syncPreviewControls().updated;
    updated += syncFamilyTabs(family.id);
    if (applyButton) {
      const applyAriaLabel = applyButtonState.reason
        ? `${applyButtonState.label}: ${applyButtonState.reason}`
        : applyButtonState.label;
      if (syncProperty(applyButton, "disabled", !applyButtonState.enabled)) updated += 1;
      if (syncAttribute(applyButton, "aria-disabled", applyButtonState.enabled ? "false" : "true")) updated += 1;
      if (syncAttribute(applyButton, "aria-label", applyAriaLabel || "")) updated += 1;
      if (syncTextContent(applyButton, applyButtonState.label)) updated += 1;
      if (syncProperty(applyButton, "title", applyButtonState.reason || applyButtonState.label || "")) updated += 1;
    }
    return { updated };
  };

  return {
    render,
    syncPreviewControls,
  };
}
