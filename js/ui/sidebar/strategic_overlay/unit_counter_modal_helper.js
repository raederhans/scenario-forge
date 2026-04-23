function isFocusableElementVisible(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  if (typeof element.checkVisibility === "function") {
    return element.checkVisibility({
      visibilityProperty: true,
      opacityProperty: true,
      contentVisibilityAuto: true,
    });
  }
  return !element.hidden && element.getAttribute("aria-hidden") !== "true";
}

export function getCounterEditorModalFocusableElements(modalElement) {
  if (!(modalElement instanceof HTMLElement)) {
    return [];
  }
  return Array.from(modalElement.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => (
    element instanceof HTMLElement
    && isFocusableElementVisible(element)
    && element.tabIndex >= 0
  ));
}

export function focusUnitCounterDetailToggle(toggleButton, { documentRef = document } = {}) {
  if (!(toggleButton instanceof HTMLElement)) {
    return false;
  }
  if (!documentRef.contains(toggleButton) || toggleButton.disabled || toggleButton.tabIndex < 0) {
    return false;
  }
  if (!isFocusableElementVisible(toggleButton)) {
    return false;
  }
  toggleButton.focus({ preventScroll: true });
  return documentRef.activeElement === toggleButton;
}

export function setUnitCounterEditorModalState({
  nextOpen,
  state,
  uiState,
  elements,
  ensureStrategicOverlayUiState,
  setStrategicWorkspaceModalState,
  restoreFocus = true,
  documentRef = document,
  requestAnimationFrameRef = globalThis.requestAnimationFrame?.bind(globalThis),
}) {
  const {
    unitCounterCatalogSearchInput,
    unitCounterDetailDrawer,
    unitCounterDetailToggleBtn,
    unitCounterEditorModal,
    unitCounterEditorModalOverlay,
  } = elements;
  ensureStrategicOverlayUiState();
  const isOpen = !!nextOpen;
  state.strategicOverlayUi.counterEditorModalOpen = isOpen;
  unitCounterEditorModalOverlay?.classList.toggle("hidden", !isOpen);
  unitCounterDetailDrawer?.classList.toggle("hidden", !isOpen);
  documentRef.body.classList.toggle("counter-editor-modal-open", isOpen);
  if (isOpen) {
    uiState.counterEditorModalPreviouslyFocused = documentRef.activeElement instanceof HTMLElement
      ? documentRef.activeElement
      : null;
    if (state.strategicOverlayUi?.modalOpen) {
      setStrategicWorkspaceModalState(false, String(state.strategicOverlayUi?.modalSection || "line"));
    }
    const scheduleFocus = typeof requestAnimationFrameRef === "function"
      ? requestAnimationFrameRef
      : (callback) => globalThis.setTimeout(callback, 0);
    scheduleFocus(() => {
      (unitCounterCatalogSearchInput || unitCounterEditorModal)?.focus?.({ preventScroll: true });
    });
    return;
  }
  const previousFocused = uiState.counterEditorModalPreviouslyFocused;
  uiState.counterEditorModalPreviouslyFocused = null;
  if (!restoreFocus) {
    return;
  }
  if (focusUnitCounterDetailToggle(unitCounterDetailToggleBtn, { documentRef })) {
    return;
  }
  if (previousFocused instanceof HTMLElement && documentRef.contains(previousFocused)) {
    previousFocused.focus({ preventScroll: true });
  }
}
