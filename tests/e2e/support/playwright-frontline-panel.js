async function openProjectFrontlineSection(page, { timeout = 30_000 } = {}) {
  await page.evaluate(async () => {
    const sidebarModule = await import("/js/ui/sidebar.js");
    const mapRendererModule = await import("/js/core/map_renderer.js");
    if (
      !document.querySelector("#frontlineProjectSection")
      || !document.querySelector("#frontlineOverlayPanel")
      || !document.querySelector("#strategicOverlayPanel")
    ) {
      sidebarModule.initSidebar({ render: mapRendererModule.render });
    }
    const projectTab = document.querySelector("#inspectorSidebarTabProject");
    if (projectTab instanceof HTMLElement) {
      projectTab.click();
    }
    const section = document.querySelector("#frontlineProjectSection");
    if (section instanceof HTMLDetailsElement) {
      section.open = true;
    }
    const stateModuleUrl = new URL("./js/core/state.js", globalThis.location.href).toString();
    const stateModule = await import(stateModuleUrl);
    const state = stateModule?.state || null;
    if (state && (!state.ui || typeof state.ui !== "object")) {
      state.ui = {};
    }
    if (state) {
      state.ui.rightSidebarTab = "project";
      state.updateScenarioUIFn?.();
      state.updateStrategicOverlayUIFn?.();
    }
  });
  await page.waitForFunction(() => {
    const projectPanel = document.querySelector("#projectSidebarPanel");
    const section = document.querySelector("#frontlineProjectSection");
    return !!projectPanel
      && !projectPanel.hidden
      && !!section
      && !!section.open
      && !!document.querySelector("#frontlineOverlayPanel")
      && !!document.querySelector("#strategicOverlayPanel");
  }, { timeout });
}

module.exports = {
  openProjectFrontlineSection,
};
