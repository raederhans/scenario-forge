// Scenario guide popover controller.
// 这个模块只负责 guide 面板自己的 section/status 渲染、按钮同步和事件绑定。
// toolbar.js 继续保留跨 surface 仲裁、URL 恢复和打开关闭的 facade 壳。

function createScenarioGuidePopoverController({
  state,
  scenarioGuideBtn = null,
  utilitiesGuideBtn = null,
  scenarioGuideBackdrop = null,
  scenarioGuidePopover = null,
  scenarioGuideCloseBtn = null,
  scenarioGuideStatus = null,
  scenarioGuideStatusChips = null,
  scenarioGuideNavButtons = [],
  scenarioGuidePanels = [],
  t,
} = {}) {
  let scenarioGuideActiveSection = "quick";

  const normalizeScenarioGuideSection = (value = "") => {
    const normalizedValue = String(value || "").trim().toLowerCase();
    return ["quick", "prepare", "tools", "checks"].includes(normalizedValue) ? normalizedValue : "quick";
  };

  const renderScenarioGuideSection = (section = "quick") => {
    scenarioGuideActiveSection = normalizeScenarioGuideSection(section);
    scenarioGuideNavButtons.forEach((button) => {
      const isActive = String(button.dataset.guideSection || "").trim().toLowerCase() === scenarioGuideActiveSection;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
      button.tabIndex = isActive ? 0 : -1;
    });
    scenarioGuidePanels.forEach((panel) => {
      const isActive = String(panel.dataset.guidePanel || "").trim().toLowerCase() === scenarioGuideActiveSection;
      panel.classList.toggle("hidden", !isActive);
      panel.hidden = !isActive;
    });
  };

  const focusScenarioGuideSectionButton = (section = "quick") => {
    const normalizedSection = normalizeScenarioGuideSection(section);
    const button = scenarioGuideNavButtons.find(
      (candidate) => String(candidate.dataset.guideSection || "").trim().toLowerCase() === normalizedSection
    );
    if (button && typeof button.focus === "function") {
      button.focus({ preventScroll: true });
    }
  };

  const renderScenarioGuideStatus = ({
    activeScenario = "",
    modeLabel = "",
    scenarioViewLabel = "",
    splitCount = 0,
  } = {}) => {
    if (!scenarioGuideStatusChips) return;
    const statusChips = [
      { label: t("Mode", "ui"), value: modeLabel },
    ];
    if (activeScenario) {
      statusChips.push(
        { label: t("View", "ui"), value: scenarioViewLabel },
        { label: t("Split", "ui"), value: String(splitCount) }
      );
    }
    scenarioGuideStatusChips.replaceChildren();
    statusChips
      .filter((chip) => String(chip.value || "").trim())
      .forEach((chip) => {
        const pill = document.createElement("span");
        pill.className = "scenario-guide-status-pill";

        const label = document.createElement("span");
        label.className = "scenario-guide-status-pill-label";
        label.textContent = `${chip.label}:`;

        const value = document.createElement("span");
        value.textContent = chip.value;

        pill.appendChild(label);
        pill.appendChild(value);
        scenarioGuideStatusChips.appendChild(pill);
      });
    scenarioGuideStatus?.classList.toggle("hidden", !scenarioGuideStatusChips.childElementCount);
  };

  const syncScenarioGuideTriggerButtons = ({
    isOpen = false,
    tutorialEntryVisible = state.ui?.tutorialEntryVisible !== false,
  } = {}) => {
    if (scenarioGuideBtn) {
      scenarioGuideBtn.classList.toggle("hidden", !tutorialEntryVisible);
      scenarioGuideBtn.classList.toggle("is-active", isOpen);
      scenarioGuideBtn.textContent = t("Guide", "ui");
      scenarioGuideBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
      scenarioGuideBtn.setAttribute("title", isOpen ? t("Hide guide", "ui") : t("Show guide", "ui"));
    }
    if (utilitiesGuideBtn) {
      utilitiesGuideBtn.classList.toggle("is-active", isOpen);
      utilitiesGuideBtn.textContent = t("Guide", "ui");
      utilitiesGuideBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
      utilitiesGuideBtn.setAttribute("title", isOpen ? t("Hide guide", "ui") : t("Show guide", "ui"));
    }
  };

  const openScenarioGuideSurface = ({ focusOverlaySurface = null } = {}) => {
    if (!scenarioGuidePopover) return;
    document.body.classList.add("scenario-guide-open");
    scenarioGuideBackdrop?.classList.remove("hidden");
    scenarioGuideBackdrop?.setAttribute("aria-hidden", "false");
    scenarioGuidePopover.classList.remove("hidden");
    scenarioGuidePopover.setAttribute("aria-hidden", "false");
    syncScenarioGuideTriggerButtons({ isOpen: true });
    renderScenarioGuideSection("quick");
    if (typeof focusOverlaySurface === "function") {
      focusOverlaySurface(scenarioGuidePopover);
    }
  };

  const closeScenarioGuideSurface = ({
    restoreFocus = false,
    restoreOverlayTriggerFocus = null,
  } = {}) => {
    if (!scenarioGuidePopover) return;
    document.body.classList.remove("scenario-guide-open");
    scenarioGuideBackdrop?.classList.add("hidden");
    scenarioGuideBackdrop?.setAttribute("aria-hidden", "true");
    scenarioGuidePopover.classList.add("hidden");
    scenarioGuidePopover.setAttribute("aria-hidden", "true");
    syncScenarioGuideTriggerButtons({ isOpen: false });
    if (restoreFocus && typeof restoreOverlayTriggerFocus === "function") {
      restoreOverlayTriggerFocus(scenarioGuidePopover);
    }
  };

  const bindScenarioGuideEvents = ({
    onToggle = null,
    onClose = null,
  } = {}) => {
    if (scenarioGuideBtn && !scenarioGuideBtn.dataset.bound) {
      scenarioGuideBtn.setAttribute("aria-haspopup", "dialog");
      scenarioGuideBtn.setAttribute("aria-controls", "scenarioGuidePopover");
      scenarioGuideBtn.addEventListener("click", () => {
        onToggle?.(scenarioGuideBtn);
      });
      scenarioGuideBtn.dataset.bound = "true";
    }

    if (utilitiesGuideBtn && !utilitiesGuideBtn.dataset.bound) {
      utilitiesGuideBtn.setAttribute("aria-haspopup", "dialog");
      utilitiesGuideBtn.setAttribute("aria-controls", "scenarioGuidePopover");
      utilitiesGuideBtn.addEventListener("click", () => {
        onToggle?.(utilitiesGuideBtn);
      });
      utilitiesGuideBtn.dataset.bound = "true";
    }

    scenarioGuideNavButtons.forEach((button) => {
      if (button.dataset.bound) return;
      button.addEventListener("click", () => {
        renderScenarioGuideSection(button.dataset.guideSection || "quick");
      });
      button.addEventListener("keydown", (event) => {
        const currentIndex = scenarioGuideNavButtons.indexOf(button);
        if (currentIndex < 0) return;
        let nextIndex = currentIndex;
        if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % scenarioGuideNavButtons.length;
        if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + scenarioGuideNavButtons.length) % scenarioGuideNavButtons.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = scenarioGuideNavButtons.length - 1;
        if (nextIndex === currentIndex) return;
        event.preventDefault();
        const nextButton = scenarioGuideNavButtons[nextIndex];
        const nextSection = nextButton?.dataset.guideSection || "quick";
        renderScenarioGuideSection(nextSection);
        focusScenarioGuideSectionButton(nextSection);
      });
      button.dataset.bound = "true";
    });

    if (scenarioGuideCloseBtn && !scenarioGuideCloseBtn.dataset.bound) {
      scenarioGuideCloseBtn.addEventListener("click", () => {
        onClose?.();
      });
      scenarioGuideCloseBtn.dataset.bound = "true";
    }

    if (scenarioGuideBackdrop && !scenarioGuideBackdrop.dataset.bound) {
      scenarioGuideBackdrop.addEventListener("click", () => {
        onClose?.();
      });
      scenarioGuideBackdrop.dataset.bound = "true";
    }
  };

  return {
    bindScenarioGuideEvents,
    closeScenarioGuideSurface,
    focusScenarioGuideSectionButton,
    openScenarioGuideSurface,
    renderScenarioGuideSection,
    renderScenarioGuideStatus,
    syncScenarioGuideTriggerButtons,
  };
}

export { createScenarioGuidePopoverController };
