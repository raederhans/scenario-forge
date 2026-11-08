import { createUiIcon, setUiIcon } from "./ui_icons.js";
import { initCommandPalette } from "./command_palette.js";

// The workspace moves existing controls so their business owners keep their
// element references, event handlers, and native form contracts.
export function initEditorWorkspace({ documentRef = document, initialSearch = globalThis.location?.search || "", t, setSidebarTab, setStrategicMode, toggleInspector, revealProperties = () => {}, onNavigate = () => {} } = {}) {
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
  const segments = make("nav", "editor-property-segments", "", "editorPropertySegments");
  segments.setAttribute("role", "tablist");
  const segmentButtons = new Map();
  const segmentProperties = new Map();
  for (const [key, label, id] of [
    ["inspector", "Inspector", "editorSegmentInspector"],
    ["layers", "Layer settings", "editorSegmentLayers"],
  ]) {
    const btn = button(label, id, () => {
      const propertyKey = segmentProperties.get(key);
      const trigger = propertyEntries.get(propertyKey)?.trigger;
      if (trigger) trigger.click();
      else showProperty(propertyKey);
    });
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", "false");
    btn.setAttribute("tabindex", key === "inspector" ? "0" : "-1");
    btn.addEventListener("keydown", (event) => {
      const buttons = [...segmentButtons.values()];
      const index = buttons.indexOf(btn);
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = buttons.length - 1;
      else return;
      event.preventDefault();
      buttons[next].click();
      buttons[next].focus();
    });
    segments.append(btn);
    segmentButtons.set(key, btn);
  }
  const propertyHeading = make("div", "editor-properties-heading");
  propertyHeading.append(backButton, title);
  propertyHeader.append(segments, propertyHeading);
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
    const segment = key === "project" ? null : task === "layers" ? "layers" : "inspector";
    propertyEntries.set(key, { host, label, task, segment });
    if (segment) {
      host.setAttribute("role", "tabpanel");
      host.setAttribute("aria-labelledby", segmentButtons.get(segment).id);
    }
    if (segment && !segmentProperties.has(segment)) {
      segmentProperties.set(segment, key);
      segmentButtons.get(segment).setAttribute("aria-controls", host.id);
    }
    return host;
  };
  const showProperty = (key, { syncTab = true, reveal = false } = {}) => {
    const entry = propertyEntries.get(key);
    if (!entry) return;
    const changed = currentProperty !== key;
    if (changed && workspaceReady && !navigatingBack) propertyHistory.push(currentProperty);
    currentProperty = key;
    if (entry.segment) {
      segmentProperties.set(entry.segment, key);
      setAttribute(segmentButtons.get(entry.segment), "aria-controls", entry.host.id);
    }
    for (const [segment, btn] of segmentButtons) {
      setAttribute(btn, "aria-selected", segment === entry.segment);
      if (entry.segment) setAttribute(btn, "tabindex", segment === entry.segment ? 0 : -1);
    }
    if (entry.task) taskProperties.set(entry.task, key);
    if (syncTab) setSidebarTab(key === "project" ? "project" : "inspector");
    for (const [id, item] of propertyEntries) setHidden(item.host, id !== key);
    for (const item of layerEntries) {
      const selected = item.propertyKey === key;
      if (item.btn.classList.contains("is-active") !== selected) item.btn.classList.toggle("is-active", selected);
      setAttribute(item.btn, "aria-selected", selected);
      if (!item.btn.dataset.appearanceTab && !item.btn.dataset.mapContentTab) setAttribute(item.btn, "aria-pressed", selected);
    }
    filterLayers();
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
    if (key === "layers") refreshLayerVisibility();
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
  for (const [key, label] of [["objects", "Objects"], ["layers", "Layers"], ["palette", "Palette"]]) {
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
  // 筛选分段用短名才能在最窄侧栏里单行放下；右栏属性标题仍用完整名称。
  for (const [key, label, navLabel, sectionId, detailId] of [
    ["countries", "Countries", "Countries", "countryInspectorSection", "countryInspectorDetail"],
    ["water", "Water Regions", "Water", "waterInspectorSection", "waterInspectorDetail"],
    ["special", "Special Regions", "Special", "specialRegionInspectorSection", "specialRegionInspectorDetail"],
  ]) {
    const section = get(sectionId);
    if (!section) continue;
    section.open = true;
    section.classList.add("editor-object-section");
    objectHost.append(section);
    const btn = button(navLabel, `editorObjects-${key}`, () => selectObject(key));
    if (navLabel !== label) {
      btn.setAttribute("aria-label", label);
      btn.dataset.i18nAriaLabel = label;
    }
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
      const hint = make("div", "editor-empty-hint editor-country-empty");
      const searchCountry = button("Search countries", "editorSearchCountriesBtn", () => {
        // 左栏收起或窄屏抽屉关着时，搜索框不可聚焦：先经各自的现有开关把左栏亮出来。
        const body = documentRef.body;
        if (globalThis.matchMedia?.("(max-width: 1023px)").matches) {
          if (!body.classList.contains("left-drawer-open")) get("leftPanelToggle")?.click();
        } else if (body.classList.contains("left-sidebar-collapsed")) {
          get("leftSidebarCollapseBtn")?.click();
        }
        selectObject("countries");
        const focusSearch = () => get("countrySearch")?.focus();
        focusSearch();
        // 抽屉打开时会把焦点交给抽屉起点，下一帧再落到搜索框。
        globalThis.requestAnimationFrame?.(focusSearch);
      });
      searchCountry.className = "btn-secondary";
      hint.append(
        createUiIcon("citypoints", { size: 20, doc: documentRef }),
        make("h3", "", "No country selected"),
        make("p", "", "Click a parcel on the map, or search for a country on the left."),
        searchCountry,
      );
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
  const layerGroups = [];
  // 眼睛开关代理属性页里该图层自己的总开关。按需解析：特殊区域的叠加层开关由工作台运行时创建。
  const visibilityControls = {
    physical: () => get("togglePhysical"), urban: () => get("toggleUrban"), citypoints: () => get("toggleCityPoints"),
    rivers: () => get("toggleRivers"), daynight: () => get("dayNightEnabled"), transport: () => get("transportAppearanceMasterToggle"),
    "special-zones": () => documentRef.querySelector("[data-special-zone-overlay-toggle]"),
  };
  const refreshLayerVisibility = () => {
    for (const { toggle, getCheckbox, row, label } of layerEntries) {
      if (!toggle) continue;
      const checkbox = getCheckbox();
      setHidden(toggle, !checkbox);
      if (!checkbox) continue;
      setAttribute(toggle, "aria-pressed", checkbox.checked);
      setAttribute(toggle, "aria-label", t(checkbox.checked ? "Hide {name}" : "Show {name}", "ui").replace("{name}", t(label, "ui")));
      setUiIcon(toggle, checkbox.checked ? "eye" : "eye-off", { doc: documentRef });
      row.classList.toggle("is-layer-off", !checkbox.checked);
    }
  };
  let visibilityRefreshQueued = false;
  const scheduleVisibilityRefresh = () => {
    if (visibilityRefreshQueued) return;
    visibilityRefreshQueued = true;
    queueMicrotask(() => { visibilityRefreshQueued = false; refreshLayerVisibility(); });
  };
  // 任何 change 都同步一次：只有几个开关，开销可以忽略，也不依赖总开关节点是否被重建。
  documentRef.addEventListener("change", refreshLayerVisibility, true);
  const search = make("input", "input editor-layer-search", "", "editorLayerSearch");
  search.type = "search";
  search.placeholder = t("Search layers", "ui");
  search.dataset.i18nPlaceholder = "Search layers";
  search.setAttribute("aria-label", t("Search layers", "ui"));
  search.dataset.i18nAriaLabel = "Search layers";
  layerHost.append(search);
  const extras = {
    "special-zones": ["Special Zones", "specialZonePopover"],
    legend: ["Legend", "legendProjectSection"],
    annotations: ["Frontlines & Annotations", "frontlineProjectSection"],
    reference: ["Reference map", "dockReferencePopover"],
    display: ["Display & performance"],
  };
  for (const [heading, keys] of [
    ["Political & borders", ["borders", "special-zones"]],
    ["Geography", ["ocean", "physical", "rivers"]],
    ["Settlements & transport", ["urban", "citypoints", "transport"]],
    ["Data & annotations", ["thematic", "annotations", "legend"]],
    ["Map appearance", ["presets", "daynight", "texture", "reference", "display"]],
  ]) {
    const group = make("div", "editor-layer-group");
    group.append(make("h3", "editor-group-heading", heading));
    const tabs = make("div", "editor-layer-list");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-orientation", "vertical");
    tabs.setAttribute("aria-label", t(heading, "ui"));
    tabs.dataset.i18nAriaLabel = heading;
    group.append(tabs);
    layerHost.append(group);
    const entries = [];
    for (const key of keys) {
      let btn = documentRef.querySelector(`[data-appearance-tab="${key}"]`);
      const panelAttribute = btn ? "data-appearance-panel" : "data-map-content-panel";
      btn ||= documentRef.querySelector(`[data-map-content-tab="${key}"]`);
      const panel = extras[key] ? get(extras[key][1]) : documentRef.querySelector(`[${panelAttribute}="${key}"]`);
      if (key !== "display" && !panel) continue;
      const label = extras[key]?.[0] || btn.dataset.i18n || btn.textContent.trim();
      const propertyKey = extras[key] ? key : `${panelAttribute}-${key}`;
      // 显示与性能把两块现有控件整块搬进一个容器：直接挂在属性页下的 details 会被当成外壳隐藏标题。
      const displayStack = key === "display" ? make("section", "editor-display-stack") : null;
      if (displayStack) displayStack.append(...[get("displayQuality")?.closest(".border-control-row")].filter(Boolean));
      const nodes = displayStack ? [displayStack] : [panel];
      const host = addProperty(propertyKey, label, nodes, "layers");
      if (key === "reference") {
        panel.classList.remove("hidden", "sidebar-tool-popover");
        panel.removeAttribute("role");
        panel.removeAttribute("aria-hidden");
      }
      if (!btn) {
        btn = make("button", "editor-nav-button", "", `editorLayer-${key}`);
        btn.type = "button";
      }
      propertyEntries.get(propertyKey).trigger = btn;
      btn.removeAttribute("data-i18n");
      delete btn.dataset.i18n;
      btn.classList.add("editor-layer-trigger");
      btn.setAttribute("role", "tab");
      btn.setAttribute("tabindex", entries.length ? "-1" : "0");
      btn.setAttribute("aria-controls", host.id);
      const name = make("span", "editor-layer-name", label);
      const dot = make("span", "editor-layer-status");
      dot.hidden = true;
      btn.replaceChildren(createUiIcon(key, { doc: documentRef }), name, dot);
      const syncStatus = () => {
        const strip = host.querySelector(".layer-status-strip");
        dot.hidden = !strip;
        if (strip) {
          dot.dataset.statusTone = strip.dataset.statusTone;
          dot.title = strip.textContent.trim();
        }
      };
      // 预设、项目加载等会直接改复选框的 checked 而不派发 change；它们都会刷新属性页里的状态条，借这里同步眼睛开关。
      new MutationObserver(() => { syncStatus(); scheduleVisibilityRefresh(); }).observe(host, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-status-tone"] });
      syncStatus();
      const row = make("div", "editor-layer-row");
      row.dataset.layerKey = key;
      row.append(btn);
      tabs.append(row);
      const getCheckbox = visibilityControls[key] || (() => null);
      let toggle;
      if (visibilityControls[key]) {
        toggle = make("button", "editor-layer-visibility");
        toggle.type = "button";
        toggle.addEventListener("click", () => {
          const checkbox = getCheckbox();
          if (!checkbox) return;
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event("change", { bubbles: true }));
          refreshLayerVisibility();
        });
        row.append(toggle);
      }
      const entry = { key, label, name, row, btn, host, panel, propertyKey, getCheckbox, toggle };
      entries.push(entry);
      layerEntries.push(entry);
      btn.addEventListener("click", () => {
        selectTask("layers");
        if (key === "special-zones") get("appearanceSpecialZoneBtn")?.click();
        if (panel) {
          panel.hidden = false;
          panel.classList.remove("hidden");
          if (panel.tagName === "DETAILS") panel.open = true;
        }
        showProperty(propertyKey, { reveal: true });
      });
    }
    tabs.addEventListener("keydown", (event) => {
      const buttons = entries.filter(({ row, btn }) => !row.hidden && !btn.disabled).map(({ btn }) => btn);
      const index = buttons.indexOf(event.target);
      if (index < 0) return;
      let next;
      if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
      else if (event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = buttons.length - 1;
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
      buttons[next].click();
      buttons[next].focus();
    }, true);
    let secondary;
    if (keys.includes("transport")) {
      secondary = move("transportProjectSection", group);
      if (secondary) {
        secondary.open = true;
        secondary.classList.add("editor-layer-secondary");
      }
    }
    layerGroups.push({ group, entries, secondary });
  }
  const empty = make("p", "editor-empty-hint", "No matching layers", "editorLayersEmpty");
  layerHost.append(empty);
  const filterLayers = () => {
    const query = search.value.trim().toLocaleLowerCase();
    for (const { group, entries, secondary } of layerGroups) {
      for (const entry of entries) entry.row.hidden = !`${entry.name.textContent} ${entry.label} ${entry.key}`.toLocaleLowerCase().includes(query);
      group.hidden = entries.every(({ row }) => row.hidden);
      if (secondary) secondary.hidden = !!query && !entries.some(({ key, row }) => key === "transport" && !row.hidden);
      const visible = entries.filter(({ row }) => !row.hidden);
      const selected = visible.find(({ btn }) => btn.getAttribute("aria-selected") === "true") || visible[0];
      for (const entry of entries) setAttribute(entry.btn, "tabindex", entry === selected ? 0 : -1);
    }
    empty.hidden = layerGroups.some(({ group }) => !group.hidden);
  };
  search.addEventListener("input", filterLayers);
  search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      search.value = "";
      filterLayers();
    }
  });
  new MutationObserver(() => { filterLayers(); refreshLayerVisibility(); }).observe(layerHost, { childList: true, subtree: true, characterData: true });
  filterLayers();
  refreshLayerVisibility();
  const palette = left.querySelector(".color-library-card");
  if (palette) { palette.open = true; tasks.get("palette").host.append(palette); }
  for (const id of ["inspectorUtilitiesSection", "utilitiesGuideBtn", "dockReferenceBtn"]) {
    if (get(id)) get(id).hidden = true;
  }
  get("dockReferenceBtn")?.addEventListener("click", () => get("editorLayer-reference")?.click());

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
  const inspectorToggle = button("Inspector", "editorInspectorToggleBtn", toggleInspector);
  inspectorToggle.setAttribute("aria-controls", "rightSidebar");
  inspectorToggle.setAttribute("aria-expanded", String(
    globalThis.matchMedia("(max-width: 1023px)").matches
      ? documentRef.body.classList.contains("right-drawer-open")
      : !documentRef.body.classList.contains("right-sidebar-collapsed")
  ));
  inspectorToggle.removeAttribute("data-i18n");
  delete inspectorToggle.dataset.i18n;
  inspectorToggle.setAttribute("aria-label", t("Inspector", "ui"));
  inspectorToggle.dataset.i18nAriaLabel = "Inspector";
  setUiIcon(inspectorToggle, "panel-right");
  for (const id of ["workspaceExportBtn", "workspaceSaveBtn"]) move(id, topActions);
  const divider = make("span", "editor-project-divider");
  divider.setAttribute("aria-hidden", "true");
  topActions.append(divider, inspectorToggle);
  const commandPalette = initCommandPalette({ documentRef, t, getCommands: () => [
    ...[...propertyEntries].filter(([, entry]) => entry.task === "layers").map(([key, entry]) => ({ key, label: entry.label, button: entry.trigger, group: "Layers" })),
    ...objectEntries.map((entry) => ({ key: entry.key, label: propertyEntries.get(entry.key).label, button: entry.button, group: "Objects" })),
    ...[
      ["toolSelectBtn", "Select tool", "V"], ["toolFillBtn", "Fill tool", "F"],
      ["toolEraserBtn", "Eraser tool", "E"], ["toolEyedropperBtn", "Eyedropper tool", "I"],
      ["brushModeBtn", "Brush", "B"],
    ].map(([key, label, shortcut]) => ({ key, label, shortcut, button: get(key), group: "Tools" })),
    ...[
      ["workspaceSaveBtn", "Save project"], ["workspaceExportBtn", "Export image"],
      ["btnToggleLang", "Switch language"], ["scenarioGuideBtn", "User guide"],
    ].map(([key, label]) => ({ key, label, button: get(key), group: "Project" })),
  ] });
  const help = make("div", "editor-help");
  const helpMenu = make("div", "editor-help-menu", "", "editorHelpMenu");
  helpMenu.hidden = true;
  helpMenu.setAttribute("role", "menu");
  const closeHelp = (restoreFocus = false) => {
    helpMenu.hidden = true;
    helpButton.setAttribute("aria-expanded", "false");
    if (restoreFocus) helpButton.focus();
  };
  const helpButton = button("", "editorHelpBtn", () => {
    helpMenu.hidden = !helpMenu.hidden;
    helpButton.setAttribute("aria-expanded", String(!helpMenu.hidden));
    if (!helpMenu.hidden) helpItems().at(0)?.focus();
  });
  helpButton.setAttribute("aria-haspopup", "menu");
  helpButton.setAttribute("aria-controls", helpMenu.id);
  helpButton.setAttribute("aria-expanded", "false");
  const helpIcon = documentRef.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", "aria-hidden": "true" })) helpIcon.setAttribute(name, value);
  const helpPath = documentRef.createElementNS("http://www.w3.org/2000/svg", "path");
  for (const [name, value] of Object.entries({ d: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v.1", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round" })) helpPath.setAttribute(name, value);
  helpIcon.append(helpPath);
  helpButton.append(helpIcon);
  // 指南仍是顶栏上可见的独立按钮（指南弹层关闭时焦点要回到它）；帮助菜单只放快捷键、命令面板和 GitHub。
  helpButton.setAttribute("aria-label", t("Help", "ui"));
  helpButton.dataset.i18nAriaLabel = "Help";
  helpButton.title = t("Help", "ui");
  const openPalette = (query) => { closeHelp(true); commandPalette.open(query); };
  helpMenu.append(button("Keyboard shortcuts", "editorKeyboardShortcutsBtn", () => openPalette("?")));
  const paletteButton = button("", "editorCommandPaletteBtn", () => openPalette(""));
  const paletteShortcut = make("kbd", "");
  paletteShortcut.textContent = "Ctrl+K";
  paletteButton.append(make("span", "", "Command palette"), paletteShortcut);
  helpMenu.append(paletteButton);
  const github = move("workspaceGithubLink", helpMenu);
  if (github) {
    github.textContent = "GitHub";
    github.target = "_blank";
    github.rel = "noopener";
  }
  for (const item of helpMenu.children) {
    item.setAttribute("role", "menuitem");
    item.tabIndex = -1;
    item.addEventListener("click", () => closeHelp());
  }
  const helpItems = () => [...helpMenu.children].filter((item) => !item.disabled);
  help.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !helpMenu.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeHelp(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      helpMenu.hidden = false;
      helpButton.setAttribute("aria-expanded", "true");
      const items = helpItems();
      const index = items.indexOf(documentRef.activeElement);
      const next = index === -1
        ? (event.key === "ArrowDown" ? 0 : items.length - 1)
        : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === "Tab") closeHelp();
  });
  documentRef.addEventListener("click", (event) => { if (!help.contains(event.target)) closeHelp(); });
  help.append(helpButton, helpMenu);
  move("scenarioGuideBtn", topActions);
  topActions.append(help);
  for (const id of ["btnToggleLang", "rightSidebarAccountShelf"]) move(id, topActions);
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
    const requestedEntry = [...propertyEntries].find(([key, entry]) => requestedSections.some((id) => {
      if (id === key) return true;
      const section = get(id);
      return section && entry.host.contains(section);
    }));
    if (requestedEntry) {
      const [key, entry] = requestedEntry;
      if (entry.trigger) entry.trigger.click();
      else showProperty(key);
    }
  }
  if (requestedView === "reference") get("editorLayer-reference")?.click();
  workspaceReady = true;
  // Support entry owners can still request Project using the retained button.
  documentRef.addEventListener("editor-sidebar-tab", (event) => {
    if (event.detail === "project" && currentProperty !== "project") showProperty("project", { syncTab: false });
  });
  return { showProperty, selectTask, selectObject };
}
