// The workspace moves existing controls so their business owners keep their
// element references, event handlers, and native form contracts.
export function initEditorWorkspace({ documentRef = document, initialSearch = globalThis.location?.search || "", t, setSidebarTab, setStrategicMode, revealProperties = () => {}, onNavigate = () => {} } = {}) {
  const get = (id) => documentRef.getElementById(id);
  const left = get("leftSidebarContent");
  const right = get("rightSidebarContent");
  const top = get("editorProjectBar");
  if (!left || !right || !top || top.dataset.ready) return;
  top.dataset.ready = "true";
  const requestedParams = new URLSearchParams(initialSearch);
  const requestedProject = requestedParams.get("scope") === "current-project";
  const requestedView = requestedParams.get("view");
  const requestedSections = (requestedParams.get("section") || "").split(",").map((id) => id.trim()).filter(Boolean);
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
  const setAttribute = (node, name, value) => {
    const text = String(value);
    if (node.getAttribute(name) !== text) node.setAttribute(name, text);
  };
  const setHidden = (node, hidden) => {
    if (node.hidden !== hidden) node.hidden = hidden;
  };
  const button = (key, id, action) => {
    const node = make("button", "editor-nav-button", key, id);
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  };
  const title = make("h2", "editor-properties-title", "Properties", "editorPropertiesTitle");
  title.tabIndex = -1;
  const propertyHeader = make("div", "editor-properties-header");
  const backButton = button("Back", "editorPropertiesBackBtn", () => {
    const key = propertyHistory.pop();
    if (!key) return;
    navigatingBack = true;
    try {
      const trigger = propertyEntries.get(key)?.trigger;
      if (trigger) trigger.click();
      else showProperty(key);
      revealProperties();
    } finally {
      navigatingBack = false;
    }
    title.focus({ preventScroll: true });
  });
  backButton.hidden = true;
  backButton.setAttribute("aria-label", t("Back", "ui"));
  backButton.dataset.i18nAriaLabel = "Back";
  propertyHeader.append(backButton, title);
  right.prepend(propertyHeader);
  const properties = make("div", "editor-properties-body", "", "editorPropertiesBody");
  right.append(properties);
  const propertyEntries = new Map();
  const layerEntries = [];
  const propertyHistory = [];
  const propertyScroll = new Map();
  const taskProperties = new Map();
  let navigatingBack = false;
  let restoringTaskProperty = false;
  let workspaceReady = false;
  let currentProperty = "countries";
  // Native layer owners may hide their old panel before our click listener runs.
  // Remember user scrolling as it happens, before that layout can collapse.
  right.addEventListener("scroll", () => propertyScroll.set(currentProperty, right.scrollTop), { passive: true });
  const addProperty = (key, label, nodes, task = "") => {
    const host = make("section", "editor-property-panel", "", `editorProperty-${key}`);
    host.setAttribute("aria-label", t(label, "ui"));
    host.dataset.i18nAriaLabel = label;
    for (const node of nodes.filter(Boolean)) host.append(node);
    properties.append(host);
    propertyEntries.set(key, { host, label, task });
    return host;
  };
  const showProperty = (key, { syncTab = true, reveal = false } = {}) => {
    const entry = propertyEntries.get(key);
    if (!entry) return;
    const changed = currentProperty !== key;
    if (changed && workspaceReady && !navigatingBack) propertyHistory.push(currentProperty);
    currentProperty = key;
    if (entry.task) taskProperties.set(entry.task, key);
    if (syncTab) setSidebarTab(key === "project" ? "project" : "inspector");
    for (const [id, item] of propertyEntries) setHidden(item.host, id !== key);
    for (const item of layerEntries) {
      const selected = item.propertyKey === key;
      if (item.btn.classList.contains("is-active") !== selected) item.btn.classList.toggle("is-active", selected);
      setAttribute(item.btn, "aria-selected", selected);
    }
    for (const group of layerHost?.querySelectorAll('[role="tablist"]') || []) {
      const selected = group.querySelector('[aria-selected="true"]');
      if (selected) {
        for (const btn of group.querySelectorAll('[role="tab"]')) setAttribute(btn, "tabindex", btn === selected ? 0 : -1);
      }
    }
    for (const [id, item] of propertyEntries) {
      if (item.trigger && item.trigger.getAttribute("role") !== "tab" && !objectEntries.some((object) => object.button === item.trigger)) {
        setAttribute(item.trigger, "aria-pressed", id === key);
      }
    }
    setHidden(backButton, propertyHistory.length === 0);
    setAttribute(title, "data-i18n", entry.label);
    const translatedTitle = t(entry.label, "ui");
    if (title.textContent !== translatedTitle) title.textContent = translatedTitle;
    setAttribute(right, "data-editor-context", key);
    if (changed) right.scrollTop = propertyScroll.get(key) || 0;
    if (reveal && !restoringTaskProperty) revealProperties();
    onNavigate(key);
  };

  const nav = make("nav", "editor-task-nav", "", "editorTaskNav");
  nav.setAttribute("aria-label", t("Workspace", "ui"));
  nav.dataset.i18nAriaLabel = "Workspace";
  const taskBody = make("div", "editor-task-body");
  left.prepend(nav, taskBody);
  const tasks = new Map();
  const taskScroll = new Map();
  let currentTask = "";
  const selectTask = (key, { restoreProperty = false } = {}) => {
    if (!tasks.has(key)) return;
    if (key !== currentTask) {
      taskScroll.set(currentTask, taskBody.scrollTop);
      for (const [id, task] of tasks) {
        setHidden(task.host, id !== key);
        setAttribute(task.button, "aria-pressed", id === key);
      }
      left.dataset.editorTask = key;
      currentTask = key;
      taskBody.scrollTop = taskScroll.get(key) || 0;
    }
    // Internal selection only changes the task surface. User task clicks also
    // restore its context, while keeping a narrow-screen task drawer open.
    if (!restoreProperty) return;
    const propertyKey = taskProperties.get(key) || [...propertyEntries].find(([, entry]) =>
      entry.task === key && !entry.trigger?.disabled && !entry.trigger?.hidden
    )?.[0];
    if (!propertyKey || propertyKey === currentProperty) return;
    restoringTaskProperty = true;
    try {
      const trigger = propertyEntries.get(propertyKey).trigger;
      if (trigger) trigger.click();
      else showProperty(propertyKey);
    } finally {
      restoringTaskProperty = false;
    }
  };
  for (const [key, label] of [["objects", "Objects"], ["layers", "Layers"], ["palette", "Palette"], ["assets", "Assets"]]) {
    const host = make("section", "editor-task-panel", "", `editorTask-${key}`);
    const btn = button(label, `editorTask${key[0].toUpperCase()}${key.slice(1)}Btn`, () => selectTask(key, { restoreProperty: true }));
    btn.setAttribute("aria-controls", host.id);
    nav.append(btn);
    taskBody.append(host);
    tasks.set(key, { host, button: btn });
  }

  const objectNav = make("div", "editor-object-nav");
  const objectHost = tasks.get("objects").host;
  objectHost.append(objectNav);
  const objectEntries = [];
  const selectObject = (key, { syncTab = true, reveal = false } = {}) => {
    selectTask("objects");
    for (const item of objectEntries) {
      setHidden(item.section, item.key !== key);
      setAttribute(item.button, "aria-pressed", item.key === key);
    }
    showProperty(key, { syncTab, reveal });
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
    const property = addProperty(key, label, [detail, ...extras], "objects");
    propertyEntries.get(key).trigger = btn;
    // The detail owner hides its whole card without a selection. Keep its
    // existing empty-state message outside that card in the property pane.
    if (key === "water") move("waterInspectorEmpty", property);
    if (key === "countries") {
      const hint = make("p", "editor-empty-hint", "Select a country to view its properties.");
      const selectionName = make("h3", "editor-selected-name");
      property.prepend(hint, selectionName);
      const syncEmpty = () => {
        const empty = detail?.classList.contains("hidden");
        setHidden(hint, !empty);
        setHidden(selectionName, empty);
        const name = get("countryList")?.querySelector(".country-select-row.is-selected .country-select-title")?.textContent || "";
        if (selectionName.textContent !== name) selectionName.textContent = name;
        if (extras[0]) { setHidden(extras[0], empty); if (!extras[0].open) extras[0].open = true; }
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
      // Selection owners can rebuild the list before this event bubbles here.
      // The original path still distinguishes a selection from group toggles.
      const selectedItem = event.composedPath().find((node) => node.matches?.(
        ".country-select-main-btn, .inspector-item-btn[data-region-id]"
      ));
      if (selectedItem) showProperty(key, { reveal: true });
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
  for (const [selector, panelAttribute, heading, headingId] of [
    ["[data-appearance-tab]", "data-appearance-panel", "Map style", "appearanceSectionHeading"],
    ["[data-map-content-tab]", "data-map-content-panel", "Map content", "mapContentSectionHeading"],
  ]) {
    const group = make("div", "editor-layer-group");
    const groupHeading = get(headingId) || make("h3", "editor-group-heading");
    groupHeading.className = "editor-group-heading";
    groupHeading.dataset.i18n = heading;
    groupHeading.textContent = t(heading, "ui");
    group.append(groupHeading);
    const tabs = make("div", "editor-layer-list");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-orientation", "vertical");
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
      const host = addProperty(propertyKey, label, [panel], "layers");
      propertyEntries.get(propertyKey).trigger = btn;
      tabs.append(btn);
      layerEntries.push({ btn, host, panel, propertyKey });
      const activate = () => {
        selectTask("layers");
        // Native owners update the selected panel's contents and state.
        panel.hidden = false;
        panel.classList.remove("hidden");
        if (panel.tagName === "DETAILS") panel.open = true;
        showProperty(propertyKey, { reveal: true });
      };
      btn.addEventListener("click", activate);
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
    addProperty(key, label, [node], "layers");
    const btn = button(label, `editorLayer-${key}`, () => {
      selectTask("layers");
      if (key === "special-zones") get("appearanceSpecialZoneBtn")?.click();
      node.classList.remove("hidden");
      node.hidden = false;
      if (node.tagName === "DETAILS") node.open = true;
      showProperty(key, { reveal: true });
    });
    propertyEntries.get(key).trigger = btn;
    btn.setAttribute("aria-controls", `editorProperty-${key}`);
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
    propertyEntries.get("project").trigger = projectBtn;
    projectBtn.removeAttribute("role");
    projectBtn.removeAttribute("aria-selected");
    projectBtn.setAttribute("aria-controls", "editorProperty-project");
    projectBtn.addEventListener("click", () => showProperty("project", { syncTab: false, reveal: true }));
  }
  top.prepend(make("a", "editor-brand", "Scenario Forge"));
  top.querySelector("a").href = "../";
  const scenario = get("lblScenario")?.closest("details");
  if (scenario) {
    scenario.classList.add("editor-scenario-menu");
    top.append(scenario);
    const closeScenarioMenu = ({ restoreFocus = false } = {}) => {
      if (get("scenarioSelectButton")?.getAttribute("aria-expanded") === "true") get("scenarioSelectButton").click();
      scenario.open = false;
      if (restoreFocus) scenario.querySelector("summary")?.focus({ preventScroll: true });
    };
    scenario.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !scenario.open) return;
      event.preventDefault();
      event.stopPropagation();
      const selectButton = get("scenarioSelectButton");
      if (selectButton?.getAttribute("aria-expanded") === "true") {
        selectButton.click();
        selectButton.focus({ preventScroll: true });
      } else {
        closeScenarioMenu({ restoreFocus: true });
      }
    }, true);
    scenario.addEventListener("focusout", (event) => {
      // Native focus transitions can run microtasks between blur and focus.
      if (event.relatedTarget && scenario.contains(event.relatedTarget)) return;
      // Selecting an option replaces its DOM and then restores trigger focus.
      // Wait for that synchronous handoff before deciding focus left the menu.
      queueMicrotask(() => {
        if (scenario.open && !scenario.contains(documentRef.activeElement)) closeScenarioMenu();
      });
    });
    documentRef.addEventListener("click", (event) => {
      // Choosing a scenario replaces the option DOM synchronously. Its
      // original event path still identifies the click as inside this menu.
      if (!event.composedPath().includes(scenario)) closeScenarioMenu();
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

  // Move only known section labels with their content; retained identity
  // wrappers must not expose headings for controls they no longer contain.
  for (const [headingId, sectionId] of [
    ["countryInspectorHeading", "countryInspectorSection"],
    ["selectedCountryActionsHeading", "selectedCountryActionsSection"],
    ["specialRegionInspectorHeading", "specialRegionInspectorSection"],
    ["waterInspectorHeading", "waterInspectorSection"],
    ["projectLegendHeading", "projectLegendSection"],
    ["legendProjectHeading", "legendProjectSection"],
    ["frontlineProjectHeading", "frontlineProjectSection"],
    ["transportProjectHeading", "transportProjectSection"],
    ["exportProjectHeading", "exportProjectSection"],
    ["inspectorUtilitiesHeading", "inspectorUtilitiesSection"],
    ["diagnosticsHeading", "diagnosticsSection"],
  ]) {
    const section = get(sectionId);
    if (section) move(headingId, section);
  }

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
  if (!requestedView) {
    const requestedEntry = [...propertyEntries.values()].find((entry) => requestedSections.some((id) => {
      const section = get(id);
      return section && entry.host.contains(section);
    }));
    requestedEntry?.trigger?.click();
  }
  if (requestedView === "reference") selectTask("assets");
  workspaceReady = true;
  // Support entry owners can still request Project using the retained button.
  documentRef.addEventListener("editor-sidebar-tab", (event) => {
    if (event.detail === "project" && currentProperty !== "project") showProperty("project", { syncTab: false });
  });
  return { showProperty, selectTask, selectObject };
}
