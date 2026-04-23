function setAccordionOpen(documentRef, accordionId) {
  const accordion = documentRef.getElementById(accordionId);
  const accordionHeader = accordion?.querySelector?.(".strategic-accordion-header");
  accordion?.classList.add("is-open");
  accordionHeader?.setAttribute("aria-expanded", "true");
}

export function buildUnitCounterSectionViewModel({
  state,
  annotationView,
  unitCounterPresets,
  inferUnitCounterPresetId,
  getUnitCounterPresetMeta,
  clampUnitCounterFixedScaleMultiplier,
  resolveUnitCounterCombatState,
  getUnitCounterNationOptions,
}) {
  const unitEditor = state.unitCounterEditor || {};
  const selectedCounter = (state.unitCounters || []).find(
    (counter) => String(counter?.id || "") === String(unitEditor.selectedId || "")
  ) || null;
  const effectivePresetId = String(
    unitEditor.presetId
    || selectedCounter?.presetId
    || inferUnitCounterPresetId({
      ...(selectedCounter || {}),
      ...(unitEditor || {}),
    })
    || unitCounterPresets[0].id
  ).trim().toUpperCase();
  const effectivePreset = getUnitCounterPresetMeta(effectivePresetId);
  const effectiveRenderer = String(
    unitEditor.renderer
    || selectedCounter?.renderer
    || effectivePreset.defaultRenderer
    || annotationView.unitRendererDefault
    || "game"
  );
  const effectiveUnitCounterFixedScaleMultiplier = clampUnitCounterFixedScaleMultiplier(
    annotationView.unitCounterFixedScaleMultiplier,
    1.5,
  );
  const effectiveSize = String(unitEditor.size || selectedCounter?.size || "medium");
  const effectiveNationSource = String(unitEditor.nationSource || selectedCounter?.nationSource || "display").trim().toLowerCase() || "display";
  const effectiveNationTag = String(unitEditor.nationTag || selectedCounter?.nationTag || "").trim().toUpperCase();
  const effectiveEchelon = String(unitEditor.echelon || selectedCounter?.echelon || effectivePreset.defaultEchelon || "").trim().toUpperCase();
  const effectiveLabel = String(unitEditor.label || selectedCounter?.label || "").trim();
  const effectiveSubLabel = String(unitEditor.subLabel || selectedCounter?.subLabel || "").trim();
  const effectiveStrengthText = String(unitEditor.strengthText || selectedCounter?.strengthText || "").trim();
  const effectiveCombatState = resolveUnitCounterCombatState({
    organizationPct: unitEditor.organizationPct ?? selectedCounter?.organizationPct,
    equipmentPct: unitEditor.equipmentPct ?? selectedCounter?.equipmentPct,
    baseFillColor: unitEditor.baseFillColor ?? selectedCounter?.baseFillColor,
    statsPresetId: unitEditor.statsPresetId || selectedCounter?.statsPresetId || "regular",
    statsSource: unitEditor.statsSource || selectedCounter?.statsSource || "preset",
  });
  const rawEffectiveSymbol = String(
    unitEditor.sidc
    || unitEditor.symbolCode
    || selectedCounter?.sidc
    || selectedCounter?.symbolCode
    || ""
  ).trim().toUpperCase();
  const effectiveSymbol = rawEffectiveSymbol || (
    effectiveRenderer === "milstd"
      ? String(effectivePreset.baseSidc || "").trim().toUpperCase()
      : String(effectivePreset.shortCode || "").trim().toUpperCase()
  );
  return {
    unitEditor,
    selectedCounter,
    effectivePresetId,
    effectiveRenderer,
    effectiveUnitCounterFixedScaleMultiplier,
    effectiveSize,
    effectiveNationSource,
    effectiveNationTag,
    effectiveEchelon,
    effectiveLabel,
    effectiveSubLabel,
    effectiveStrengthText,
    effectiveCombatState,
    effectiveSymbol,
    nationOptions: getUnitCounterNationOptions(),
    selectedAttachmentLineId: String(unitEditor.attachment?.lineId || selectedCounter?.attachment?.lineId || "").trim(),
  };
}

export function refreshUnitCounterIdentitySection({
  documentRef = document,
  elements,
  state,
  t,
  syncSelectOptions,
  model,
  getSidebarUnitCounterPresetOptions,
  getUnitCounterNationMeta,
}) {
  const {
    unitCounterAttachmentSelect,
    unitCounterCancelBtn,
    unitCounterDeleteBtn,
    unitCounterEchelonSelect,
    unitCounterFixedScaleRange,
    unitCounterFixedScaleValue,
    unitCounterLabelInput,
    unitCounterLabelsToggle,
    unitCounterNationModeSelect,
    unitCounterNationSelect,
    unitCounterPlaceBtn,
    unitCounterPresetSelect,
    unitCounterRendererSelect,
    unitCounterSizeSelect,
    unitCounterStrengthInput,
    unitCounterSubLabelInput,
    unitCounterSymbolHint,
    unitCounterSymbolInput,
  } = elements;
  syncSelectOptions(unitCounterPresetSelect, getSidebarUnitCounterPresetOptions(model.effectivePresetId).map((preset) => ({
    value: preset.id,
    label: `${preset.label} · ${preset.shortCode}`,
  })), {
    value: model.effectivePresetId,
    signatureKey: "presetOptionsSignature",
  });
  unitCounterNationModeSelect && (unitCounterNationModeSelect.value = model.effectiveNationSource === "manual" ? "manual" : "display");
  const selectedNationValue = model.effectiveNationTag;
  const knownNationValues = new Set(["", ...model.nationOptions.map((entry) => entry.value)]);
  const nextNationOptions = model.nationOptions.slice();
  if (selectedNationValue && !knownNationValues.has(selectedNationValue)) {
    const fallbackMeta = getUnitCounterNationMeta(selectedNationValue);
    nextNationOptions.unshift({
      value: selectedNationValue,
      label: `${selectedNationValue} · ${fallbackMeta.displayName}`,
    });
  }
  syncSelectOptions(unitCounterNationSelect, [
    { value: "", label: t("Auto from placement", "ui") },
    ...nextNationOptions,
  ], {
    value: selectedNationValue,
    disabled: model.effectiveNationSource !== "manual",
    signatureKey: "nationOptionsSignature",
  });
  syncSelectOptions(unitCounterAttachmentSelect, [
    { value: "", label: t("Anchor: Province / Free", "ui") },
    ...(state.operationalLines || []).map((line) => ({
      value: String(line.id || ""),
      label: `${line.label || line.kind || line.id} (${line.kind})`,
    })),
  ], {
    value: model.selectedAttachmentLineId,
    signatureKey: "attachmentOptionsSignature",
  });
  unitCounterRendererSelect && (unitCounterRendererSelect.value = model.effectiveRenderer);
  unitCounterSizeSelect && (unitCounterSizeSelect.value = model.effectiveSize);
  unitCounterEchelonSelect && (unitCounterEchelonSelect.value = model.effectiveEchelon);
  unitCounterLabelInput && (unitCounterLabelInput.value = model.effectiveLabel);
  unitCounterSubLabelInput && (unitCounterSubLabelInput.value = model.effectiveSubLabel);
  unitCounterStrengthInput && (unitCounterStrengthInput.value = model.effectiveStrengthText);
  if (unitCounterSymbolInput) {
    unitCounterSymbolInput.value = model.effectiveSymbol;
    unitCounterSymbolInput.placeholder = model.effectiveRenderer === "milstd"
      ? t("SIDC (e.g. 130310001412110000000000000000)", "ui")
      : t("Short code (e.g. HQ / ARM / INF)", "ui");
  }
  if (unitCounterSymbolHint) {
    unitCounterSymbolHint.textContent = model.effectiveRenderer === "milstd"
      ? t("MILSTD uses the browser-loaded milsymbol renderer. Paste a full SIDC for the symbol body.", "ui")
      : t("Game renderer keeps the lighter counter style and uses a short internal code or abbreviation.", "ui");
  }
  if (state.unitCounterEditor?.selectedId || state.unitCounterEditor?.active || state.strategicOverlayUi?.counterEditorModalOpen) {
    setAccordionOpen(documentRef, "accordionCounters");
  }
  unitCounterPlaceBtn && (unitCounterPlaceBtn.disabled = !!model.unitEditor.active);
  unitCounterCancelBtn && (unitCounterCancelBtn.disabled = !model.unitEditor.active);
  unitCounterDeleteBtn && (unitCounterDeleteBtn.disabled = !String(model.unitEditor.selectedId || "").trim());
  if (unitCounterLabelsToggle) {
    unitCounterLabelsToggle.checked = state.annotationView?.showUnitLabels !== false;
  }
  if (unitCounterFixedScaleRange) {
    unitCounterFixedScaleRange.value = String(Math.round(model.effectiveUnitCounterFixedScaleMultiplier * 100));
  }
  if (unitCounterFixedScaleValue) {
    unitCounterFixedScaleValue.textContent = `${model.effectiveUnitCounterFixedScaleMultiplier.toFixed(2)}x`;
  }
}

export function refreshUnitCounterPreviewSection({
  elements,
  t,
  renderUnitCounterPreview,
  model,
}) {
  const {
    unitCounterDetailPreviewCard,
    unitCounterEditorModalStatus,
    unitCounterPlacementStatus,
    unitCounterPreviewCard,
  } = elements;
  const placementStatusText = model.unitEditor.active
    ? t("Placing on map", "ui")
    : "";
  const previewPayload = {
    renderer: model.effectiveRenderer,
    size: model.effectiveSize,
    nationTag: model.effectiveNationTag,
    nationSource: model.effectiveNationSource,
    label: model.effectiveLabel,
    subLabel: model.effectiveSubLabel,
    strengthText: model.effectiveStrengthText,
    sidc: model.effectiveSymbol,
    symbolCode: model.effectiveSymbol,
    presetId: model.effectivePresetId,
    echelon: model.effectiveEchelon,
    organizationPct: model.effectiveCombatState.organizationPct,
    equipmentPct: model.effectiveCombatState.equipmentPct,
    baseFillColor: model.effectiveCombatState.baseFillColor,
    statusText: placementStatusText,
  };
  renderUnitCounterPreview(unitCounterPreviewCard, {
    ...previewPayload,
    compactMode: true,
  });
  renderUnitCounterPreview(unitCounterDetailPreviewCard, {
    ...previewPayload,
    detailMode: true,
  });
  if (unitCounterPlacementStatus) {
    unitCounterPlacementStatus.textContent = placementStatusText || t("Use the gear button for the full counter editor.", "ui");
    unitCounterPlacementStatus.classList.toggle("hidden", !placementStatusText);
  }
  if (unitCounterEditorModalStatus) {
    unitCounterEditorModalStatus.textContent = placementStatusText || t("Apply a symbol, then return to the map to continue placement or edit the selected counter live.", "ui");
    unitCounterEditorModalStatus.classList.toggle("hidden", false);
    unitCounterEditorModalStatus.dataset.mode = placementStatusText ? "placing" : "idle";
  }
}

export function refreshUnitCounterCombatSection({
  elements,
  model,
}) {
  const {
    unitCounterBaseFillColorInput,
    unitCounterBaseFillEyedropperBtn,
    unitCounterBaseFillResetBtn,
    unitCounterBaseFillSwatch,
    unitCounterEquipmentBar,
    unitCounterEquipmentInput,
    unitCounterOrganizationBar,
    unitCounterOrganizationInput,
    unitCounterStatsPresetButtons,
    unitCounterStatsPresetSelect,
  } = elements;
  if (unitCounterStatsPresetSelect) {
    unitCounterStatsPresetSelect.value = model.effectiveCombatState.statsPresetId === "random"
      ? "regular"
      : model.effectiveCombatState.statsPresetId;
  }
  unitCounterStatsPresetButtons.forEach((button) => {
    const value = String(button.dataset.value || "").trim().toLowerCase();
    const active = model.effectiveCombatState.statsPresetId !== "random" && value === model.effectiveCombatState.statsPresetId;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  unitCounterOrganizationInput && (unitCounterOrganizationInput.value = String(model.effectiveCombatState.organizationPct));
  unitCounterEquipmentInput && (unitCounterEquipmentInput.value = String(model.effectiveCombatState.equipmentPct));
  unitCounterOrganizationBar && (unitCounterOrganizationBar.style.width = `${model.effectiveCombatState.organizationPct}%`);
  unitCounterEquipmentBar && (unitCounterEquipmentBar.style.width = `${model.effectiveCombatState.equipmentPct}%`);
  const effectiveFillColor = model.effectiveCombatState.baseFillColor || "#f4f0e6";
  if (unitCounterBaseFillSwatch) {
    unitCounterBaseFillSwatch.style.setProperty("--unit-counter-fill-preview", effectiveFillColor);
    unitCounterBaseFillSwatch.dataset.active = model.effectiveCombatState.baseFillColor ? "true" : "false";
  }
  if (unitCounterBaseFillColorInput) {
    unitCounterBaseFillColorInput.value = /^#(?:[0-9a-f]{6})$/i.test(effectiveFillColor) ? effectiveFillColor : "#f4f0e6";
  }
  unitCounterBaseFillResetBtn && (unitCounterBaseFillResetBtn.disabled = !model.effectiveCombatState.baseFillColor);
  unitCounterBaseFillEyedropperBtn && (unitCounterBaseFillEyedropperBtn.disabled = !("EyeDropper" in globalThis));
}

export function refreshUnitCounterListSection({
  elements,
  t,
  syncSelectOptions,
  formatUnitCounterListLabel,
  state,
  model,
  uiState,
}) {
  uiState.suppressListChange = true;
  try {
    syncSelectOptions(elements.unitCounterList, [
      { value: "", label: t("No unit counters", "ui") },
      ...(state.unitCounters || []).map((counter) => ({
        value: String(counter.id || ""),
        label: formatUnitCounterListLabel(counter),
      })),
    ], {
      value: String(model.unitEditor.selectedId || ""),
      signatureKey: "counterListOptionsSignature",
    });
  } finally {
    uiState.suppressListChange = false;
  }
}
