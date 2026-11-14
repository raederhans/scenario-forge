// Transport workbench event owner.
// 这里集中处理 workbench chrome 的事件绑定，controller 继续拥有状态语义和渲染顺序。

import { getActiveModal, trapSurfaceTab } from "../ui_contract.js";

function requireAction(actions, actionName) {
  const action = actions?.[actionName];
  if (typeof action !== "function") {
    throw new TypeError(`transport workbench event owner requires action: ${actionName}`);
  }
  return action;
}

export function bindTransportWorkbenchEventOnce(node, bind) {
  if (!node || node.dataset?.transportWorkbenchEventBound === "true") return false;
  bind(node);
  node.dataset.transportWorkbenchEventBound = "true";
  return true;
}

function getNextTabButton(buttons, currentButton, key) {
  const candidates = buttons.filter((button) => button && !button.disabled && !button.hidden);
  if (!candidates.length) return null;
  const currentIndex = Math.max(0, candidates.indexOf(currentButton));
  if (key === "Home") return candidates[0];
  if (key === "End") return candidates[candidates.length - 1];
  if (key === "ArrowRight") return candidates[(currentIndex + 1) % candidates.length];
  if (key === "ArrowLeft") return candidates[(currentIndex - 1 + candidates.length) % candidates.length];
  return null;
}

export function createTransportWorkbenchEventOwner({
  documentRef = globalThis.document,
  body = documentRef?.body || null,
  scenarioButton = null,
  appearanceButton = null,
  infoButton = null,
  closeButton = null,
  resetButton = null,
  zoomOutButton = null,
  zoomInButton = null,
  rotateButton = null,
  applyButton = null,
  packSelect = null,
  familyTabs = [],
  inspectorTabButtons = [],
  actions = {},
} = {}) {
  const bind = () => {
    bindTransportWorkbenchEventOnce(scenarioButton, (button) => {
      const isOpen = requireAction(actions, "isOpen");
      const setOpen = requireAction(actions, "setOpen");
      button.addEventListener("click", () => {
        if (isOpen()) {
          setOpen(false);
          return;
        }
        setOpen(true, { trigger: button });
      });
    });

    bindTransportWorkbenchEventOnce(appearanceButton, (button) => {
      const setOpen = requireAction(actions, "setOpen");
      button.addEventListener("click", () => {
        setOpen(true, { trigger: button });
      });
    });

    bindTransportWorkbenchEventOnce(infoButton, (button) => {
      const toggleInfoPopover = requireAction(actions, "toggleInfoPopover");
      button.addEventListener("click", () => {
        toggleInfoPopover();
      });
    });

    bindTransportWorkbenchEventOnce(closeButton, (button) => {
      const setOpen = requireAction(actions, "setOpen");
      button.addEventListener("click", () => {
        setOpen(false);
      });
    });

    bindTransportWorkbenchEventOnce(resetButton, (button) => {
      const resetView = requireAction(actions, "resetView");
      button.addEventListener("click", () => {
        resetView();
      });
    });

    bindTransportWorkbenchEventOnce(zoomOutButton, (button) => {
      const stepCarrierZoom = requireAction(actions, "stepCarrierZoom");
      const syncPreviewControls = requireAction(actions, "syncPreviewControls");
      button.addEventListener("click", () => {
        stepCarrierZoom(-1);
        syncPreviewControls();
      });
    });

    bindTransportWorkbenchEventOnce(zoomInButton, (button) => {
      const stepCarrierZoom = requireAction(actions, "stepCarrierZoom");
      const syncPreviewControls = requireAction(actions, "syncPreviewControls");
      button.addEventListener("click", () => {
        stepCarrierZoom(1);
        syncPreviewControls();
      });
    });

    bindTransportWorkbenchEventOnce(rotateButton, (button) => {
      const rotateCarrier = requireAction(actions, "rotateCarrier");
      const syncPreviewControls = requireAction(actions, "syncPreviewControls");
      button.addEventListener("click", () => {
        rotateCarrier();
        syncPreviewControls();
      });
    });

    bindTransportWorkbenchEventOnce(applyButton, (button) => {
      const getRenderContext = requireAction(actions, "getRenderContext");
      const getApplyButtonState = requireAction(actions, "getApplyButtonState");
      const applyFamilyToMainMap = requireAction(actions, "applyFamilyToMainMap");
      const renderShell = requireAction(actions, "renderShell");
      button.addEventListener("click", async () => {
        // Apply 是 workbench -> main map 的单向桥接；点击瞬间重新取 context，确保 pack/family gate 用最新状态。
        const context = getRenderContext();
        const applyState = getApplyButtonState(context.family.id);
        if (!applyState.enabled) return;
        try {
          await applyFamilyToMainMap(context);
        } catch (error) {
          console.error(`[transport-workbench] Failed to apply ${context.family.id} to the main map.`, error);
        }
        renderShell(getRenderContext());
      });
    });

    bindTransportWorkbenchEventOnce(packSelect, (select) => {
      const setActivePackId = requireAction(actions, "setActivePackId");
      select.addEventListener("change", () => {
        setActivePackId(select.value);
      });
    });

    familyTabs.forEach((button) => {
      bindTransportWorkbenchEventOnce(button, (tabButton) => {
        const setActiveFamily = requireAction(actions, "setActiveFamily");
        const renderUi = requireAction(actions, "renderUi");
        const activateFamilyTab = () => {
          setActiveFamily(tabButton.dataset.transportFamily || "road");
          renderUi();
        };
        tabButton.addEventListener("click", activateFamilyTab);
        tabButton.addEventListener("keydown", (event) => {
          const nextButton = getNextTabButton(familyTabs, tabButton, event.key);
          if (!nextButton) return;
          event.preventDefault();
          nextButton.focus?.();
          nextButton.click?.();
        });
      });
    });

    inspectorTabButtons.forEach((button) => {
      bindTransportWorkbenchEventOnce(button, (tabButton) => {
        const setInspectorTab = requireAction(actions, "setInspectorTab");
        const getRenderContext = requireAction(actions, "getRenderContext");
        const renderShell = requireAction(actions, "renderShell");
        const renderInspector = requireAction(actions, "renderInspector");
        const activateInspectorTab = () => {
          setInspectorTab(tabButton.dataset.transportInspectorTab || "inspect");
          const context = getRenderContext();
          renderShell(context);
          renderInspector(context.family, context.config, context.compareHeld);
        };
        tabButton.addEventListener("click", activateInspectorTab);
        tabButton.addEventListener("keydown", (event) => {
          const nextButton = getNextTabButton(inspectorTabButtons, tabButton, event.key);
          if (!nextButton) return;
          event.preventDefault();
          nextButton.focus?.();
          nextButton.click?.();
        });
      });
    });

    if (documentRef && body && !body.dataset.transportWorkbenchEscapeBound) {
      const isOpen = requireAction(actions, "isOpen");
      const handlePopoverEscape = requireAction(actions, "handlePopoverEscape");
      const setOpen = requireAction(actions, "setOpen");
      documentRef.addEventListener("keydown", (event) => {
        if (event.defaultPrevented) return;
        if (!isOpen()) return;
        if (event.key === "Tab") {
          const panel = documentRef.getElementById("transportWorkbenchPanel");
          if (panel && getActiveModal(documentRef) === panel) trapSurfaceTab(event, panel);
          return;
        }
        if (event.key !== "Escape") return;
        if (handlePopoverEscape(event)) return;
        event.preventDefault();
        setOpen(false);
      });
      body.dataset.transportWorkbenchEscapeBound = "true";
    }
  };

  return { bind };
}
