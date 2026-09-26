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
    const editorWorkspace = document.body.classList.contains("editor-workspace");
    if (editorWorkspace) {
      document.querySelector("#editorTaskLayersBtn")?.click();
      document.querySelector("#editorLayer-annotations")?.click();
      if (!document.body.classList.contains("frontline-mode-active")) {
        document.querySelector("#editorStrategicModeBtn")?.click();
      }
    } else {
      const projectTab = document.querySelector("#inspectorSidebarTabProject");
      if (projectTab instanceof HTMLElement) {
        projectTab.click();
      }
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
      if (!editorWorkspace) state.ui.rightSidebarTab = "project";
      state.updateScenarioUIFn?.();
      state.updateStrategicOverlayUIFn?.();
    }
  });
  await page.waitForFunction(() => {
    const editorWorkspace = document.body.classList.contains("editor-workspace");
    const projectPanel = document.querySelector(editorWorkspace ? "#editorProperty-annotations" : "#projectSidebarPanel");
    const section = document.querySelector("#frontlineProjectSection");
    return !!projectPanel
      && !projectPanel.hidden
      && !!section
      && !!section.open
      && (!editorWorkspace || document.body.classList.contains("frontline-mode-active"))
      && !!document.querySelector("#frontlineOverlayPanel")
      && !!document.querySelector("#strategicOverlayPanel");
  }, { timeout });
}

module.exports = {
  openProjectFrontlineSection,
};
