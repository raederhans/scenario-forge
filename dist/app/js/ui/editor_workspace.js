// The workspace moves existing controls so their business owners keep their
// element references, event handlers, and native form contracts.
export function initEditorWorkspace({ documentRef = document, t, setSidebarTab, setStrategicMode, onNavigate = () => {} } = {}) {
  const get = (id) => documentRef.getElementById(id);
  const left = get("leftSidebarContent");
  const right = get("rightSidebarContent");
  const top = get("editorProjectBar");
  if (!left || !right || !top || top.dataset.ready) return;
  top.dataset.ready = "true";
  const requestedProject = new URLSearchParams(globalThis.location?.search || "").get("scope") === "current-project";
  const requestedView = new URLSearchParams(globalThis.location?.search || "").get("view");
  documentRef.body.classList.add("editor-workspace");
  const make = (tag, className, key = "", id = "") => {
    const node = documentRef.createElement(tag);
    node.className = className;
    if (id) node.id = id;
    if (key) {
      node.dataset.i18n = key;
      node.textContent = t(key, "ui");
    }
    return node;
  };
  const move = (id, target) => { const node = get(id); if (node) target.append(node); return node; };
  const button = (key, id, action) => {
    const node = make("button", "editor-nav-button", key, id);
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  };
  const title = make("h2", "editor-properties-title", "Properties", "editorPropertiesTitle");
  const propertyHeader = make("div", "editor-properties-header");
  propertyHeader.append(title);
  right.prepend(propertyHeader);
  const properties = make("div", "editor-properties-body", "", "editorPropertiesBody");
  right.append(properties);
  const propertyEntries = new Map();
  const layerEntries = [];
  let currentProperty = "countries";
  const addProperty = (key, label, nodes) => {
    const host = make("section", "editor-property-panel", "", `editorProperty-${key}`);
    host.setAttribute("aria-label", t(label, "ui"));
    host.dataset.i18nAriaLabel = label;
    for (const node of nodes.filter(Boolean)) host.append(node);
    properties.append(host);
    propertyEntries.set(key, { host, label });
    return host;
  };
  const showProperty = (key, { syncTab = true } = {}) => {
    const entry = propertyEntries.get(key);
    if (!entry) return;
    currentProperty = key;
    if (syncTab) setSidebarTab(key === "project" ? "project" : "inspector");
    for (const [id, item] of propertyEntries) item.host.hidden = id !== key;
    for (const item of layerEntries) {
      const selected = item.propertyKey === key;
      item.btn.classList.toggle("is-active", selected);
      item.btn.setAttribute("aria-selected", String(selected));
    }
    title.dataset.i18n = entry.label;
    title.textContent = t(entry.label, "ui");
    right.dataset.editorContext = key;
    right.scrollTop = 0;
    onNavigate(key);
  };

  const nav = make("nav", "editor-task-nav", "", "editorTaskNav");
  nav.setAttribute("aria-label", t("Workspace", "ui"));
  nav.dataset.i18nAriaLabel = "Workspace";
  const taskBody = make("div", "editor-task-body");
  left.prepend(nav, taskBody);
  const tasks = new Map();
  const selectTask = (key) => {
    for (const [id, task] of tasks) {
      task.host.hidden = id !== key;
      task.button.setAttribute("aria-pressed", String(id === key));
    }
    left.dataset.editorTask = key;
  };
  for (const [key, label] of [["objects", "Objects"], ["layers", "Layers"], ["palette", "Palette"], ["assets", "Assets"]]) {
    const host = make("section", "editor-task-panel", "", `editorTask-${key}`);
    const btn = button(label, `editorTask${key[0].toUpperCase()}${key.slice(1)}Btn`, () => selectTask(key));
    btn.setAttribute("aria-controls", host.id);
    nav.append(btn);
    taskBody.append(host);
    tasks.set(key, { host, button: btn });
  }

  const objectNav = make("div", "editor-object-nav");
  const objectHost = tasks.get("objects").host;
  objectHost.append(objectNav);
  const objectEntries = [];
  const selectObject = (key, { syncTab = true } = {}) => {
    selectTask("objects");
    for (const item of objectEntries) {
      item.section.hidden = item.key !== key;
      item.button.setAttribute("aria-pressed", String(item.key === key));
    }
    showProperty(key, { syncTab });
  };
  for (const [key, label, sectionId, detailId] of [
    ["countries", "Countries", "countryInspectorSection", "countryInspectorDetail"],
    ["water", "Water Regions", "waterInspectorSection", "waterInspectorDetail"],
    ["special", "Special Regions", "specialRegionInspectorSection", "specialRegionInspectorDetail"],
  ]) {
    const section = get(sectionId);
    if (!section) continue;
    section.open = true;
    section.classList.add("editor-object-section");
    objectHost.append(section);
    const btn = button(label, `editorObjects-${key}`, () => selectObject(key));
    objectNav.append(btn);
    objectEntries.push({ key, section, button: btn });
    const detail = get(detailId);
    const extras = key === "countries" ? [get("selectedCountryActionsSection")] : [];
    const property = addProperty(key, label, [detail, ...extras]);
    // The detail owner hides its whole card without a selection. Keep its
    // existing empty-state message outside that card in the property pane.
    if (key === "water") move("waterInspectorEmpty", property);
    if (key === "countries") {
      const hint = make("p", "editor-empty-hint", "Select a country to view its properties.");
      const selectionName = make("h3", "editor-selected-name");
      property.prepend(hint, selectionName);
      const syncEmpty = () => {
        const empty = detail?.classList.contains("hidden");
        hint.hidden = !empty;
        selectionName.hidden = empty;
        selectionName.textContent = get("countryList")?.querySelector(".country-select-row.is-selected .country-select-title")?.textContent || "";
        if (extras[0]) { extras[0].hidden = empty; extras[0].open = true; }
      };
      new MutationObserver(syncEmpty).observe(detail, { attributes: true, attributeFilter: ["class"] });
      new MutationObserver(syncEmpty).observe(get("countryList"), { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-pressed"] });
      syncEmpty();
      const identity = section.querySelector(".hgo-identity-controls");
      if (identity) {
        const options = make("details", "editor-disclosure", "", "editorCountryDisplayOptions");
        options.append(make("summary", "", "Names & display"), identity);
        get("countryList")?.before(options);
      }
    }
    section.addEventListener("click", (event) => {
      if (event.target.closest(".country-list button")) showProperty(key);
    });
  }
  // The water search is always available; infrequent filters/interaction
  // preferences take one disclosure rather than pushing the list offscreen.
  const waterBody = get("waterInspectorSection")?.querySelector(".inspector-panel-body");
  if (waterBody) {
    const filters = make("details", "editor-disclosure", "", "editorWaterFilters");
    filters.append(make("summary", "", "Filters & interaction"));
    const search = get("waterRegionSearch")?.closest(".inspector-search-block");
    const interaction = get("lblWaterInteraction")?.closest(".inspector-detail-section");
    const filterCard = get("lblWaterFilters")?.closest(".water-filter-card");
    if (interaction) filters.append(interaction);
    if (filterCard) filters.append(filterCard);
    waterBody.prepend(filters);
    if (search) waterBody.prepend(search);
  }

  const layerHost = tasks.get("layers").host;
  for (const [selector, panelAttribute, heading] of [
    ["[data-appearance-tab]", "data-appearance-panel", "Map style"],
    ["[data-map-content-tab]", "data-map-content-panel", "Map content"],
  ]) {
    const group = make("div", "editor-layer-group");
    group.append(make("h3", "editor-group-heading", heading));
    const tabs = make("div", "editor-layer-list");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", t(heading, "ui"));
    tabs.dataset.i18nAriaLabel = heading;
    group.append(tabs);
    layerHost.append(group);
    for (const btn of documentRef.querySelectorAll(selector)) {
      const key = btn.getAttribute(selector.slice(1, -1));
      const panel = documentRef.querySelector(`[${panelAttribute}="${key}"]`);
      if (!panel) continue;
      const label = btn.dataset.i18n || btn.textContent.trim();
      const propertyKey = `${panelAttribute}-${key}`;
      const host = addProperty(propertyKey, label, [panel]);
      tabs.append(btn);
      layerEntries.push({ btn, host, panel, propertyKey });
      const activate = () => {
        showProperty(propertyKey);
        // Native owners update the selected panel's contents and state.
        panel.hidden = false;
        panel.classList.remove("hidden");
        if (panel.tagName === "DETAILS") panel.open = true;
      };
      btn.addEventListener("click", activate);
      btn.addEventListener("keyup", (event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          const active = layerEntries.find((item) => item.btn === documentRef.activeElement);
          if (active) showProperty(active.propertyKey);
        }
      });
    }
  }
  const extraLayers = make("div", "editor-layer-list");
  layerHost.append(extraLayers);
  for (const [key, label, id] of [
    ["special-zones", "Special Zones", "specialZonePopover"],
    ["legend", "Legend", "legendProjectSection"],
    ["annotations", "Frontlines & Annotations", "frontlineProjectSection"],
  ]) {
    const node = get(id);
    if (!node) continue;
    addProperty(key, label, [node]);
    const btn = button(label, `editorLayer-${key}`, () => {
      showProperty(key);
      if (key === "special-zones") get("appearanceSpecialZoneBtn")?.click();
      node.classList.remove("hidden");
      node.hidden = false;
      if (node.tagName === "DETAILS") node.open = true;
    });
    extraLayers.append(btn);
  }
  const palette = left.querySelector(".color-library-card");
  if (palette) { palette.open = true; tasks.get("palette").host.append(palette); }
  const utilities = move("inspectorUtilitiesSection", tasks.get("assets").host);
  if (utilities) utilities.open = true;
  const transportEntry = move("transportProjectSection", layerHost);
  if (transportEntry) transportEntry.open = true;

  const projectPanel = get("projectSidebarPanel");
  addProperty("project", "Project", [projectPanel]);
  projectPanel?.querySelectorAll("details").forEach((details) => { details.open = true; });
  const projectBtn = move("inspectorSidebarTabProject", top);
  if (projectBtn) {
    projectBtn.removeAttribute("role");
    projectBtn.removeAttribute("aria-selected");
    projectBtn.addEventListener("click", () => showProperty("project", { syncTab: false }));
  }
  top.prepend(make("a", "editor-brand", "Scenario Forge"));
  top.querySelector("a").href = "../";
  const scenario = get("lblScenario")?.closest("details");
  if (scenario) {
    scenario.classList.add("editor-scenario-menu");
    top.append(scenario);
    documentRef.addEventListener("click", (event) => {
      // Choosing a scenario replaces the option DOM synchronously. Its
      // original event path still identifies the click as inside this menu.
      if (!event.composedPath().includes(scenario)) scenario.open = false;
    });
  }
  move("workspaceSaveStatus", top);
  const topActions = make("div", "editor-project-actions");
  top.append(topActions);
  for (const id of ["workspaceSaveBtn", "workspaceExportBtn", "scenarioGuideBtn", "btnToggleLang", "rightSidebarAccountShelf"]) move(id, topActions);
  const strategyBtn = button("Edit annotations", "editorStrategicModeBtn", () => {
    const active = !documentRef.body.classList.contains("frontline-mode-active");
    setStrategicMode(active);
    strategyBtn.setAttribute("aria-pressed", String(active));
    strategyBtn.dataset.i18n = active ? "Finish annotations" : "Edit annotations";
    strategyBtn.textContent = t(strategyBtn.dataset.i18n, "ui");
    if (active) showProperty("annotations");
  });
  strategyBtn.setAttribute("aria-pressed", "false");
  propertyEntries.get("annotations")?.host.prepend(strategyBtn);
  const exitStrategy = button("Finish annotations", "editorFinishAnnotationsBtn", () => strategyBtn.click());
  get("strategicCommandBar")?.append(exitStrategy);

  // Old wrappers remain as noninteractive identity anchors for their owners.
  for (const node of [...left.children]) {
    if (node !== nav && node !== taskBody) node.classList.add("editor-retired-shell");
  }
  for (const node of [...right.children]) {
    if (node !== propertyHeader && node !== properties) node.classList.add("editor-retired-shell");
  }
  selectTask("objects");
  selectObject("countries", { syncTab: false });
  if (requestedProject) showProperty("project", { syncTab: false });
  if (requestedView === "reference") selectTask("assets");
  // Support entry owners can still request Project using the retained button.
  documentRef.addEventListener("editor-sidebar-tab", (event) => {
    if (event.detail === "project" && currentProperty !== "project") showProperty("project", { syncTab: false });
  });
  return { showProperty, selectTask, selectObject };
}
