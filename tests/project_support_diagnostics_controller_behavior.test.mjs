import test from "node:test";
import assert from "node:assert/strict";

import { state } from "../js/core/state.js";
import { registerRuntimeHook } from "../js/core/state/index.js";
import { markDirty, clearDirty } from "../js/core/dirty_state.js";
import { createProjectSupportDiagnosticsController } from "../js/ui/sidebar/project_support_diagnostics_controller.js";
import { strToU8, zipSync } from "../vendor/fflate.browser.js";

function createStatusNode() {
  const node = {
    textContent: "",
    dataset: {},
    classes: new Set(),
    classList: {
      add(className) {
        this.owner.classes.add(className);
      },
      toggle(className, force) {
        const shouldAdd = force === undefined ? !this.owner.classes.has(className) : !!force;
        if (shouldAdd) {
          this.owner.classes.add(className);
        } else {
          this.owner.classes.delete(className);
        }
      },
      contains(className) {
        return this.owner.classes.has(className);
      },
    },
  };
  node.classList.owner = node;
  return node;
}

function createButtonNode() {
  return {
    dataset: {},
    disabled: false,
    listeners: {},
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
  };
}

function createAccountPopoverControls() {
  const backendAccountToggleBtn = {
    ...createButtonNode(),
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    focus() {},
  };
  const backendAccountPopover = {
    dataset: {},
    hiddenClass: true,
    classList: {
      contains: () => backendAccountPopover.hiddenClass,
      toggle: (_name, hidden) => {
        backendAccountPopover.hiddenClass = hidden;
      },
    },
  };
  return { backendAccountToggleBtn, backendAccountPopover };
}

function createListNode() {
  return {
    children: [],
    replaceChildren(...children) {
      this.children = children;
    },
    appendChild(child) {
      this.children.push(child);
    },
  };
}

function createElementNode(tagName = "div") {
  const style = {
    values: new Map(),
    setProperty(name, value) {
      this.values.set(name, value);
      this[name] = value;
    },
    removeProperty(name) {
      this.values.delete(name);
      delete this[name];
    },
    getPropertyValue(name) {
      return this.values.get(name) || "";
    },
  };
  return {
    tagName,
    children: [],
    className: "",
    textContent: "",
    type: "",
    value: "",
    dataset: {},
    style,
    disabled: false,
    hidden: false,
    addEventListener(type, handler) {
      this.listeners = this.listeners || {};
      this.listeners[type] = handler;
    },
    append(...children) {
      children.forEach((child) => this.appendChild(child));
    },
    appendChild(child) {
      this.children.push(child);
      if (this.tagName === "select" && child?.selected) {
        this.value = child.value;
      }
    },
    replaceChildren(...children) {
      this.children = [];
      this.append(...children);
    },
    setAttribute(name, value) {
      this.attributes = this.attributes || {};
      this.attributes[name] = String(value);
      if (name === "open") {
        this.open = true;
      }
    },
    getAttribute(name) {
      return this.attributes?.[name] || null;
    },
    closest() {
      return null;
    },
  };
}

function findNode(root, predicate) {
  if (!root) return null;
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function collectNodes(root, predicate, results = []) {
  if (!root) return results;
  if (predicate(root)) results.push(root);
  for (const child of root.children || []) {
    collectNodes(child, predicate, results);
  }
  return results;
}

function getNodeText(node) {
  return [node?.textContent || "", ...(node?.children || []).map(getNodeText)].join(" ");
}

function createDirtyIndicator() {
  return {
    classList: {
      toggle() {},
    },
    setAttribute() {},
  };
}

function createController(projectSaveStatus, overrides = {}) {
  const elements = { projectSaveStatus, ...overrides.elements };
  const elementIds = {
    scenarioAuditSection: "scenarioAuditPanel",
    legendList: "legendEditorList",
    debugModeSelect: "debug-mode-select",
  };
  const nodesById = new Map(Object.entries(elements).map(([name, node]) => [elementIds[name] || name, node]));
  return createProjectSupportDiagnosticsController({
    state: overrides.state || state,
    hosts: overrides.hosts,
    documentRef: overrides.documentRef || {
      getElementById: (id) => nodesById.get(id) || null,
      createElement: (...args) => globalThis.document.createElement(...args),
      addEventListener: (...args) => globalThis.document.addEventListener(...args),
      get body() { return globalThis.document.body; },
    },
    helpers: {
      t: (value) => value,
      createEmptyNote: () => null,
      resolveAuditNumber: (value) => Number(value || 0),
      incrementSidebarCounter: () => {},
      loadScenarioAuditPayload: async () => null,
      releaseScenarioAuditPayload: () => {},
      legendManager: {
        getSpecialZoneLayers: () => [],
        getSpecialZoneSignature: () => "",
        getSignature: () => "",
        getLabels: () => ({}),
      },
      mapRenderer: {},
      fileManager: {},
      showAppDialog: async () => true,
      showToast: () => {},
      importProjectThroughFunnel: () => false,
      invalidateFrontlineOverlayState: () => {},
      ...overrides.helpers,
    },
  });
}

function createMountDocument() {
  const documentRef = { activeElement: null, listeners: {}, listenerCounts: {} };
  documentRef.addEventListener = (type, handler) => {
    documentRef.listeners[type] = handler;
    documentRef.listenerCounts[type] = (documentRef.listenerCounts[type] || 0) + 1;
  };
  documentRef.createElement = (tagName) => {
    const node = createElementNode(tagName);
    node.listenerCounts = {};
    const addEventListener = node.addEventListener;
    node.addEventListener = function (type, handler) {
      this.listenerCounts[type] = (this.listenerCounts[type] || 0) + 1;
      addEventListener.call(this, type, handler);
    };
    const appendChild = node.appendChild;
    node.appendChild = function (child) {
      child.parentNode = this;
      appendChild.call(this, child);
      if (tagName === "select" && this.children.length === 1) this.value = child.value;
    };
    node.classList = {
      contains: (name) => node.className.split(/\s+/).includes(name),
      toggle(name, force) {
        const classes = new Set(node.className.split(/\s+/).filter(Boolean));
        const enabled = force === undefined ? !classes.has(name) : !!force;
        if (enabled) classes.add(name);
        else classes.delete(name);
        node.className = [...classes].join(" ");
        return enabled;
      },
      add(name) { this.toggle(name, true); },
    };
    node.focus = () => { documentRef.activeElement = node; };
    return node;
  };
  documentRef.body = documentRef.createElement("body");
  documentRef.getElementById = (id) => findNode(documentRef.body, (node) => node.id === id);
  const hosts = Object.fromEntries([
    "projectManagementStack", "legendEditorStack", "diagnosticStack", "rightSidebarContent",
  ].map((id) => {
    const host = documentRef.createElement("div");
    host.id = id;
    documentRef.body.appendChild(host);
    return [id, host];
  }));
  return {
    documentRef,
    hosts,
    helpers: {
      createEmptyNote: (message) => Object.assign(documentRef.createElement("p"), { textContent: message }),
    },
  };
}

test("project support mounts panels with original defaults and body-owned account dialog", () => {
  const fixture = createMountDocument();
  createController(null, fixture);
  const get = fixture.documentRef.getElementById;
  assert.equal(get("projectManagement").parentNode, fixture.hosts.projectManagementStack);
  assert.equal(get("legendEditor").parentNode, fixture.hosts.legendEditorStack);
  assert.equal(get("scenarioAuditPanel").parentNode, fixture.hosts.diagnosticStack);
  assert.equal(get("debugViewControl").parentNode, fixture.hosts.diagnosticStack);
  assert.equal(get("rightSidebarAccountShelf").parentNode, fixture.hosts.rightSidebarContent);
  for (const id of ["backendAccountBackdrop", "backendAccountPopover"]) {
    assert.equal(get(id).parentNode, fixture.documentRef.body);
    assert.equal(get(id).classList.contains("hidden"), true);
  }
  for (const [id, value] of Object.entries({
    projectDownloadFormat: "json", projectDownloadDestination: "picker",
    projectPackageContents: "minimal", projectLoadSource: "local", "debug-mode-select": "PROD",
  })) assert.equal(get(id).value, value, id);
  assert.equal(get("projectFileName").textContent, "No file selected");
  assert.equal(get("projectFileName").dataset.projectFileState, "empty");
  assert.equal(get("backendCloudSection").hidden, true);
  assert.equal(get("backendAccountPopover").getAttribute("role"), "dialog");
  assert.equal(get("backendAccountPopover").getAttribute("aria-modal"), "true");
  assert.equal(get("backendAccountPopover").getAttribute("aria-labelledby"), "backendAccountPopoverTitle");
  assert.equal(get("backendAccountToggleBtn").getAttribute("aria-controls"), "backendAccountPopover");
  assert.match(get("backendAccountToggleBtn").innerHTML, /<svg[\s\S]*aria-hidden="true"/);
  assert.equal(get("downloadProjectBtn").getAttribute("data-i18n"), "Download Project");
  assert.equal(get("projectFileInput").getAttribute("data-i18n-aria-label"), "Load Project");
  assert.equal(get("projectSaveStatus").getAttribute("aria-live"), "polite");
});

test("project support reuses mounted markup and preserves user values without duplicate nodes", () => {
  const fixture = createMountDocument();
  createController(null, fixture);
  const { documentRef } = fixture;
  const originalNodes = collectNodes(documentRef.body, (node) => !!node.id);
  documentRef.getElementById("backendCloudUsername").value = "existing-user";
  documentRef.getElementById("backendCloudSaveTitle").value = "existing-title";
  documentRef.getElementById("projectDownloadFormat").value = "zip";
  const name = documentRef.getElementById("projectFileName");
  name.textContent = "edited-project.zip";
  name.dataset.projectFileState = "selected";
  createController(null, fixture);
  assert.deepEqual(collectNodes(documentRef.body, (node) => !!node.id), originalNodes);
  assert.equal(documentRef.getElementById("backendCloudUsername").value, "existing-user");
  assert.equal(documentRef.getElementById("backendCloudSaveTitle").value, "existing-title");
  assert.equal(documentRef.getElementById("projectDownloadFormat").value, "zip");
  assert.equal(name.textContent, "edited-project.zip");
  name.textContent = "";
  createController(null, fixture);
  assert.equal(name.textContent, "No file selected");
  assert.equal(name.dataset.projectFileState, "empty");
});

test("project support tolerates absent hosts and reuses an existing project section", () => {
  const { documentRef, hosts } = createMountDocument();
  const project = documentRef.createElement("div");
  project.id = "projectManagement";
  hosts.projectManagementStack.appendChild(project);
  createController(null, { documentRef, hosts: { projectManagementStack: hosts.projectManagementStack } });
  assert.equal(documentRef.getElementById("projectManagement"), project);
  assert.equal(documentRef.getElementById("backendAccountPopover"), null);
  assert.equal(documentRef.getElementById("legendEditor"), null);
  assert.equal(documentRef.getElementById("scenarioAuditPanel"), null);
  assert.equal(documentRef.getElementById("debugViewControl"), null);
});

test("mounted project account binds once and preserves close focus and ARIA behavior", async () => {
  const fixture = createMountDocument();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  globalThis.document = fixture.documentRef;
  globalThis.window = { requestAnimationFrame: (callback) => callback() };
  let sessionProbes = 0;
  globalThis.fetch = async () => {
    sessionProbes += 1;
    return { ok: true, json: async () => ({ user: { username: "existing-user" } }) };
  };
  try {
    const controller = createController(null, fixture);
    controller.bindEvents();
    controller.bindEvents();
    createController(null, fixture).bindEvents();
    const get = fixture.documentRef.getElementById;
    for (const node of collectNodes(fixture.documentRef.body, (node) => !!node.listeners)) {
      for (const count of Object.values(node.listenerCounts)) assert.equal(count, 1, node.id);
    }
    assert.equal(fixture.documentRef.listenerCounts.keydown, 1);
    const trigger = get("backendAccountToggleBtn");
    const popover = get("backendAccountPopover");
    for (const close of [
      () => get("backendAccountCloseBtn").listeners.click(),
      () => get("backendAccountBackdrop").listeners.click(),
      () => fixture.documentRef.listeners.keydown({ key: "Escape" }),
    ]) {
      trigger.listeners.click();
      assert.equal(popover.classList.contains("hidden"), false);
      assert.equal(trigger.getAttribute("aria-expanded"), "true");
      assert.equal(fixture.documentRef.activeElement, get("backendCloudUsername"));
      close();
      assert.equal(popover.classList.contains("hidden"), true);
      assert.equal(get("backendAccountBackdrop").classList.contains("hidden"), true);
      assert.equal(trigger.getAttribute("aria-expanded"), "false");
      assert.equal(fixture.documentRef.activeElement, trigger);
      assert.equal(fixture.documentRef.body.classList.contains("project-account-dialog-open"), false);
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sessionProbes, 1);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});

test("project save status refreshes when dirty state changes", () => {
  const previousDocument = globalThis.document;
  const previousDirty = state.isDirty;
  const previousLastDirtyReason = state.lastDirtyReason;
  const projectSaveStatus = createStatusNode();
  const controller = createController(projectSaveStatus);

  globalThis.document = {
    getElementById: (id) => (id === "appDirtyIndicator" ? createDirtyIndicator() : null),
  };

  try {
    state.isDirty = false;
    state.lastDirtyReason = "";
    registerRuntimeHook(state, "updateProjectSaveStatusFn", controller.refreshProjectSaveStatus);
    controller.bindEvents();

    assert.equal(projectSaveStatus.textContent, "");
    assert.equal(projectSaveStatus.classList.contains("hidden"), true);

    markDirty("transport-workbench-config");
    assert.match(projectSaveStatus.textContent, /Unsaved project changes/);
    assert.equal(projectSaveStatus.classList.contains("hidden"), false);

    clearDirty("project-export");
    assert.equal(projectSaveStatus.textContent, "Project exported. Appearance and transport settings are saved in the selected project file.");
    assert.equal(projectSaveStatus.classList.contains("hidden"), false);
  } finally {
    registerRuntimeHook(state, "updateProjectSaveStatusFn", null);
    state.isDirty = previousDirty;
    state.lastDirtyReason = previousLastDirtyReason;
    globalThis.document = previousDocument;
  }
});

test("project download passes selected file format and destination", async () => {
  const projectSaveStatus = createStatusNode();
  const downloadProjectBtn = createButtonNode();
  const calls = [];
  const controller = createController(projectSaveStatus, {
    elements: {
      downloadProjectBtn,
      projectDownloadFormat: { value: "zip" },
      projectDownloadDestination: { value: "browser" },
      projectPackageContents: { value: "diagnostic", disabled: false, setAttribute() {} },
    },
    helpers: {
      fileManager: {
        exportProject: async (_state, options) => {
          calls.push(options);
        },
      },
    },
  });

  controller.bindEvents();
  await downloadProjectBtn.listeners.click();

  assert.deepEqual(calls, [{ format: "zip", destination: "browser", packageContents: "diagnostic" }]);
  assert.equal(projectSaveStatus.textContent, "");
  assert.equal(projectSaveStatus.classList.contains("hidden"), true);
});

test("project download defaults to save dialog destination", async () => {
  const projectSaveStatus = createStatusNode();
  const downloadProjectBtn = createButtonNode();
  const calls = [];
  const controller = createController(projectSaveStatus, {
    elements: {
      downloadProjectBtn,
      projectDownloadFormat: { value: "json" },
    },
    helpers: {
      fileManager: {
        exportProject: async (_state, options) => {
          calls.push(options);
        },
      },
    },
  });

  controller.bindEvents();
  await downloadProjectBtn.listeners.click();

  assert.deepEqual(calls, [{ format: "json", destination: "picker", packageContents: "recommended" }]);
});

test("scenario audit panel renders special zone runtime diagnostics in the right diagnostics area", () => {
  const previousDocument = globalThis.document;
  const previousActiveScenarioId = state.activeScenarioId;
  const previousSpecialZoneLayers = state.specialZoneLayers;
  const previousScenarioAuditUi = state.scenarioAuditUi;
  const previousScenarioDiagnosticsUi = state.scenarioDiagnosticsUi;
  const previousScenarioAudit = state.scenarioAudit;
  const previousScenarioDiagnostics = state.scenarioDiagnostics;
  const scenarioAuditSection = createElementNode("section");
  const diagnosticsDetails = {
    open: false,
    setAttribute(name) {
      if (name === "open") {
        this.open = true;
      }
    },
  };
  scenarioAuditSection.closest = (selector) => (selector === "details" ? diagnosticsDetails : null);
  const controller = createController(createStatusNode(), {
    elements: {
      scenarioAuditSection,
    },
    helpers: {
      createEmptyNote: (message) => Object.assign(createElementNode("div"), { textContent: String(message || "") }),
    },
  });

  try {
    globalThis.document = {
      createElement: createElementNode,
    };
    state.activeScenarioId = "hoi4_1936";
    state.specialZoneLayers = {
      diagnostics: [
        {
          code: "topology_fingerprint_mismatch",
          expected: "027d74242b91",
          actual: "8bc3944a1541",
        },
      ],
    };
    state.scenarioAuditUi = {};
    state.scenarioDiagnosticsUi = {};
    state.scenarioAudit = null;
    state.scenarioDiagnostics = null;

    controller.renderScenarioAuditPanel();

    const diagnostics = findNode(scenarioAuditSection, (node) =>
      String(node.className || "").includes("special-zone-runtime-diagnostics")
    );
    assert.ok(diagnostics);
    assert.match(getNodeText(diagnostics), /topology_fingerprint_mismatch/);
    assert.match(getNodeText(diagnostics), /expected 027d74242b91/);
    assert.match(getNodeText(diagnostics), /got 8bc3944a1541/);
    assert.equal(diagnosticsDetails.open, true);
    diagnosticsDetails.open = false;
    controller.renderScenarioAuditPanel();
    assert.equal(diagnosticsDetails.open, false);
  } finally {
    state.activeScenarioId = previousActiveScenarioId;
    state.specialZoneLayers = previousSpecialZoneLayers;
    state.scenarioAuditUi = previousScenarioAuditUi;
    state.scenarioDiagnosticsUi = previousScenarioDiagnosticsUi;
    state.scenarioAudit = previousScenarioAudit;
    state.scenarioDiagnostics = previousScenarioDiagnostics;
    globalThis.document = previousDocument;
  }
});

test("legend generator config changes mark the project dirty", () => {
  const previousDocument = globalThis.document;
  const previousDirty = state.isDirty;
  const previousDirtyRevision = state.dirtyRevision;
  const previousLastDirtyReason = state.lastDirtyReason;
  const legendList = createElementNode("div");
  let config = {
    mode: "weighted-random",
    continent: "all",
    useModernMajorOrder: false,
    maxItems: 15,
  };
  const controller = createController(createStatusNode(), {
    elements: {
      legendList,
    },
    helpers: {
      legendManager: {
        getConfig: () => ({ ...config }),
        updateConfig: (_state, patch = {}) => {
          config = {
            ...config,
            ...patch,
          };
          return { ...config };
        },
        getContinentOptions: () => [
          { id: "all", label: "All" },
          { id: "asia", label: "Asia" },
        ],
        getUniqueColors: () => [],
        getSpecialZoneLayers: () => [],
        getSpecialZoneSignature: () => "",
        getSignature: () => "",
        getLabels: () => ({}),
      },
    },
  });

  try {
    globalThis.document = {
      createElement: createElementNode,
      getElementById: () => null,
    };
    state.isDirty = false;
    state.dirtyRevision = 0;
    state.lastDirtyReason = "";
    controller.refreshLegendEditor();

    assert.equal(state.isDirty, false);
    assert.equal(state.lastDirtyReason, "");

    const modeSelect = findNode(legendList, (node) =>
      node.tagName === "select" && node.className === "legend-generator-select"
    );
    assert.ok(modeSelect);
    modeSelect.value = "direct-area";
    modeSelect.listeners.change();

    assert.equal(config.mode, "direct-area");
    assert.equal(state.isDirty, true);
    assert.equal(state.lastDirtyReason, "legend-generator-config");
  } finally {
    state.isDirty = previousDirty;
    state.dirtyRevision = previousDirtyRevision;
    state.lastDirtyReason = previousLastDirtyReason;
    globalThis.document = previousDocument;
  }
});

test("legend label edits render with current project labels", () => {
  const previousDocument = globalThis.document;
  const previousColors = state.colors;
  const previousLegendLabels = state.legendLabels;
  const legendList = createElementNode("div");
  const renderCalls = [];
  const controller = createController(createStatusNode(), {
    elements: {
      legendList,
    },
    helpers: {
      legendManager: {
        getConfig: () => ({
          mode: "weighted-random",
          continent: "all",
          useModernMajorOrder: false,
          maxItems: 15,
        }),
        updateConfig: (_state, patch = {}) => ({
          mode: patch.mode || "weighted-random",
          continent: patch.continent || "all",
          useModernMajorOrder: !!patch.useModernMajorOrder,
          maxItems: 15,
        }),
        getContinentOptions: () => [{ id: "all", label: "All" }],
        getUniqueColors: () => ["#abcdef"],
        getSpecialZoneLayers: () => [],
        getSpecialZoneSignature: () => "",
        getSignature: () => "",
        getLabel: (color, appState) => appState.legendLabels?.[color] || "",
        getLabels: (appState) => appState.legendLabels || {},
        setLabel: (color, text, appState) => {
          appState.legendLabels = {
            ...(appState.legendLabels || {}),
            [color]: String(text || "").trim(),
          };
        },
      },
      mapRenderer: {
        renderLegend: (...args) => renderCalls.push(args),
      },
    },
  });

  try {
    globalThis.document = {
      createElement: createElementNode,
      getElementById: () => null,
    };
    state.colors = { GER: "#abcdef" };
    state.legendLabels = {};
    controller.refreshLegendEditor();

    const labelInput = findNode(legendList, (node) =>
      node.tagName === "input" && node.className === "legend-input"
    );
    assert.ok(labelInput);
    assert.equal(labelInput.getAttribute("aria-label"), "Legend 1: #abcdef");
    labelInput.value = "Germany";
    labelInput.listeners.input({ target: labelInput });

    assert.deepEqual(renderCalls, [[["#abcdef"], { "#abcdef": "Germany" }]]);
  } finally {
    state.colors = previousColors;
    state.legendLabels = previousLegendLabels;
    globalThis.document = previousDocument;
  }
});

test("legend editor paginates sidebar rows at ten items and caps at thirty", () => {
  const previousDocument = globalThis.document;
  const legendList = createElementNode("div");
  const colors = Array.from({ length: 35 }, (_, index) => (
    `#${String(index + 1).padStart(6, "0")}`
  ));
  const controller = createController(createStatusNode(), {
    elements: {
      legendList,
    },
    helpers: {
      legendManager: {
        getConfig: () => ({
          mode: "weighted-random",
          continent: "all",
          useModernMajorOrder: false,
          maxItems: 15,
        }),
        updateConfig: (_state, patch = {}) => ({
          mode: patch.mode || "weighted-random",
          continent: patch.continent || "all",
          useModernMajorOrder: !!patch.useModernMajorOrder,
          maxItems: 15,
        }),
        getContinentOptions: () => [{ id: "all", label: "All" }],
        getUniqueColors: () => colors,
        getSpecialZoneLayers: () => [],
        getSpecialZoneSignature: () => "",
        getSignature: () => "",
        getLabel: () => "",
        getLabels: () => ({}),
        setLabel: () => {},
      },
    },
  });

  try {
    globalThis.document = {
      createElement: createElementNode,
      getElementById: () => null,
    };

    controller.refreshLegendEditor();

    const firstPageRows = collectNodes(legendList, (node) => node.className === "legend-row");
    assert.equal(firstPageRows.length, 10);
    assert.equal(legendList.dataset.pageCount, "3");
    assert.equal(legendList.dataset.paged, "true");
    assert.equal(firstPageRows[0].children[1].placeholder, "Category 1");
    assert.equal(firstPageRows[9].children[1].placeholder, "Category 10");

    const nextButton = collectNodes(legendList, (node) =>
      node.className === "legend-editor-page-btn" && node.textContent === "›"
    )[0];
    assert.ok(nextButton);
    nextButton.listeners.click();

    const secondPageRows = collectNodes(legendList, (node) => node.className === "legend-row");
    assert.equal(secondPageRows.length, 10);
    assert.equal(secondPageRows[0].children[1].placeholder, "Category 11");
    assert.equal(secondPageRows[9].children[1].placeholder, "Category 20");

    const secondNextButton = collectNodes(legendList, (node) =>
      node.className === "legend-editor-page-btn" && node.textContent === "›"
    )[0];
    secondNextButton.listeners.click();

    const thirdPageRows = collectNodes(legendList, (node) => node.className === "legend-row");
    const disabledNextButton = collectNodes(legendList, (node) =>
      node.className === "legend-editor-page-btn" && node.textContent === "›"
    )[0];
    assert.equal(thirdPageRows.length, 10);
    assert.equal(thirdPageRows[0].children[1].placeholder, "Category 21");
    assert.equal(thirdPageRows[9].children[1].placeholder, "Category 30");
    assert.equal(disabledNextButton.disabled, true);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("project download failure is shown in project status", async () => {
  const projectSaveStatus = createStatusNode();
  const downloadProjectBtn = createButtonNode();
  const controller = createController(projectSaveStatus, {
    elements: {
      downloadProjectBtn,
      projectDownloadFormat: { value: "zip" },
      projectDownloadDestination: { value: "picker" },
    },
    helpers: {
      fileManager: {
        exportProject: async () => {
          throw new Error("Save dialog failed");
        },
      },
    },
  });

  controller.bindEvents();
  await downloadProjectBtn.listeners.click();

  assert.equal(projectSaveStatus.textContent, "Save dialog failed");
});

test("local project zip load unwraps editable project before import funnel", async () => {
  const projectSaveStatus = createStatusNode();
  const projectFileName = createStatusNode();
  const projectZipBytes = zipSync({
    "map_project.json": strToU8(JSON.stringify({ schemaVersion: 21, activePaletteId: "hoi4_vanilla" })),
    "map_project_manifest.json": strToU8(JSON.stringify({ artifactKind: "project-zip" })),
  });
  const projectZip = new Blob([projectZipBytes], { type: "application/zip" });
  Object.defineProperty(projectZip, "name", { value: "map_project.zip" });
  const projectFileInput = {
    ...createButtonNode(),
    files: [projectZip],
    value: "map_project.zip",
  };
  let importedFile = null;
  let importedOptions;
  const dialogs = [];
  const controller = createController(projectSaveStatus, {
    elements: {
      projectFileInput,
      projectFileName,
    },
    helpers: {
      importProjectThroughFunnel: (file, options) => {
        importedFile = file;
        importedOptions = options;
        return true;
      },
      showAppDialog: async (options) => {
        dialogs.push(options);
        return true;
      },
      mapRenderer: { refreshColorState: () => {} },
    },
  });

  controller.bindEvents();
  await projectFileInput.listeners.change();

  assert.equal(projectFileName.textContent, "map_project.zip");
  assert.equal(projectFileName.dataset.projectFileState, "selected");
  assert.equal(dialogs[0].title, "Load Project Package");
  assert.match(dialogs[0].details, /Package: map_project\.zip/);
  assert.equal(importedFile, null, "preview does not serialize a second JSON File");
  assert.deepEqual(importedOptions.projectPayload, { schemaVersion: 21, activePaletteId: "hoi4_vanilla" });
  assert.equal(importedOptions.fileName, "map_project.zip");
  assert.equal(importedOptions.signal.aborted, false);
  assert.equal(projectFileInput.value, "");
});

test("local project import reports restored entries and keeps cancellation distinct", async () => {
  const projectSaveStatus = createStatusNode();
  const projectFileInput = { ...createButtonNode(), files: [{ name: "saved.json" }], value: "saved.json" };
  const runtime = { isDirty: true, lastDirtyReason: "paint" };
  let hooks;
  const controller = createController(projectSaveStatus, {
    state: runtime,
    elements: { projectFileInput },
    helpers: { importProjectThroughFunnel: (_file, options) => { hooks = options.hooks; } },
  });
  controller.bindEvents();
  await projectFileInput.listeners.change();
  hooks.onProjectImportError({ code: "IMPORT_ABORTED" });
  assert.equal(projectSaveStatus.textContent, "Project import cancelled.");
  assert.equal(runtime.isDirty, true);
  hooks.onProjectImportError(new Error("apply failed"));
  assert.match(projectSaveStatus.textContent, /failed before completion/);
  assert.doesNotMatch(projectSaveStatus.textContent, /Project imported:/);
  assert.equal(runtime.isDirty, true);
  runtime.isDirty = false;
  runtime.lastDirtyReason = "project-import";
  hooks.onProjectImportComplete({
    scenarioId: "hoi4_1936", scenarioName: "HOI4 1936",
    restoredColorEntries: 2, restoredOwnershipEntries: 1, ignoredEntries: 3, migratedEntries: 0,
  });
  assert.equal(projectSaveStatus.textContent,
    "Project imported: HOI4 1936. Restored 2 color entries and 1 ownership entries. Ignored 3 entries that are not valid for this map.");
  controller.refreshProjectSaveStatus();
  assert.match(projectSaveStatus.textContent, /Ignored 3 entries/);
  hooks.onProjectImportComplete({
    scenarioId: "tno_1962", scenarioName: "TNO 1962",
    restoredColorEntries: 1, restoredOwnershipEntries: 0, ignoredEntries: 0, migratedEntries: 0,
  });
  assert.match(projectSaveStatus.textContent, /TNO 1962/);
  assert.doesNotMatch(projectSaveStatus.textContent, /Ignored/);
});

test("local project zip preview cancel clears selected file input", async () => {
  const projectSaveStatus = createStatusNode();
  const projectFileName = createStatusNode();
  const projectZipBytes = zipSync({
    "map_project.json": strToU8(JSON.stringify({ schemaVersion: 21, activePaletteId: "hoi4_vanilla" })),
    "map_project_manifest.json": strToU8(JSON.stringify({ artifactKind: "project-zip" })),
  });
  const projectZip = new Blob([projectZipBytes], { type: "application/zip" });
  Object.defineProperty(projectZip, "name", { value: "map_project.zip" });
  const projectFileInput = {
    ...createButtonNode(),
    files: [projectZip],
    value: "map_project.zip",
  };
  let importCalled = false;
  const controller = createController(projectSaveStatus, {
    elements: {
      projectFileInput,
      projectFileName,
    },
    helpers: {
      importProjectThroughFunnel: () => {
        importCalled = true;
      },
      showAppDialog: async () => false,
      mapRenderer: { refreshColorState: () => {} },
    },
  });

  controller.bindEvents();
  await projectFileInput.listeners.change();

  assert.equal(importCalled, false);
  assert.equal(projectSaveStatus.textContent, "Project import cancelled.");
  assert.equal(projectFileInput.value, "");
});

test("local project zip load reports missing editable project", async () => {
  const projectSaveStatus = createStatusNode();
  const projectZipBytes = zipSync({
    "map_project_manifest.json": strToU8(JSON.stringify({ artifactKind: "project-zip" })),
  });
  const projectZip = new Blob([projectZipBytes], { type: "application/zip" });
  Object.defineProperty(projectZip, "name", { value: "map_project.zip" });
  const projectFileInput = {
    ...createButtonNode(),
    files: [projectZip],
    value: "map_project.zip",
  };
  const toasts = [];
  const controller = createController(projectSaveStatus, {
    elements: {
      projectFileInput,
    },
    helpers: {
      importProjectThroughFunnel: () => {
        throw new Error("should not import an invalid zip");
      },
      showToast: (message, options) => toasts.push({ message, options }),
    },
  });

  controller.bindEvents();
  await projectFileInput.listeners.change();

  assert.equal(projectSaveStatus.textContent, "Project ZIP must include project/map_project.json or map_project.json.");
  assert.deepEqual(toasts, [{
    message: "Project ZIP must include project/map_project.json or map_project.json.",
    options: {
      title: "Project import failed",
      tone: "error",
    },
  }]);
  assert.equal(projectFileInput.value, "");
});

test("community load source opens account popover and refreshes community saves", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const backendCloudStatus = createStatusNode();
  const uploadProjectBtn = createButtonNode();
  const projectFileInput = createButtonNode();
  const backendAccountToggleBtn = {
    dataset: {},
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener(type, handler) {
      this.listeners = this.listeners || {};
      this.listeners[type] = handler;
    },
  };
  const backendAccountPopover = {
    dataset: {},
    hiddenClass: true,
    classList: {
      contains: () => backendAccountPopover.hiddenClass,
      toggle: (_name, hidden) => {
        backendAccountPopover.hiddenClass = hidden;
      },
    },
  };
  const backendCommunityList = createListNode();

  globalThis.document = {
    body: { classList: { toggle: () => {} } },
    createElement: createElementNode,
    addEventListener: () => {},
    getElementById: () => null,
  };
  globalThis.window = { requestAnimationFrame: (callback) => callback() };
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => (String(url).endsWith("/community/saves") ? { saves: [] } : {}),
  });

  try {
    const controller = createController(createStatusNode(), {
      elements: {
        backendCloudStatus,
        uploadProjectBtn,
        projectFileInput,
        projectLoadSource: { value: "community" },
        backendAccountToggleBtn,
        backendAccountPopover,
        backendCommunityList,
      },
    });
    controller.bindEvents();
    await uploadProjectBtn.listeners.click();

    assert.equal(backendAccountPopover.hiddenClass, false);
    assert.equal(backendAccountToggleBtn.attributes["aria-expanded"], "true");
    assert.equal(backendCloudStatus.textContent, "Community saves refreshed.");
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }
});

test("backend auth session probe waits for first account popover open and runs once", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const backendCloudSection = { hidden: true };
  const backendCloudStatus = createStatusNode();
  const backendCloudUsername = { value: "", disabled: false, focus() {} };
  const backendCloudPassword = { value: "", disabled: false };
  const backendCloudSaveTitle = { value: "", disabled: false };
  const backendCloudRegisterBtn = createButtonNode();
  const backendCloudLoginBtn = createButtonNode();
  const backendCloudLogoutBtn = createButtonNode();
  const backendCloudSaveBtn = createButtonNode();
  const backendCloudPublishBtn = createButtonNode();
  const backendCommunityRefreshBtn = createButtonNode();
  const { backendAccountToggleBtn, backendAccountPopover } = createAccountPopoverControls();
  let authProbeCount = 0;

  globalThis.document = {
    body: { classList: { toggle: () => {} } },
    createElement: createElementNode,
    addEventListener: () => {},
    getElementById: () => null,
  };
  globalThis.window = { requestAnimationFrame: (callback) => callback() };
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/auth/me")) {
      authProbeCount += 1;
      return {
        ok: false,
        status: 401,
        json: async () => ({ code: "auth_required", message: "Login is required." }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  try {
    const controller = createController(createStatusNode(), {
      elements: {
        backendCloudSection,
        backendCloudStatus,
        backendCloudUsername,
        backendCloudPassword,
        backendCloudSaveTitle,
        backendCloudRegisterBtn,
        backendCloudLoginBtn,
        backendCloudLogoutBtn,
        backendCloudSaveBtn,
        backendCloudPublishBtn,
        backendCommunityRefreshBtn,
        backendAccountToggleBtn,
        backendAccountPopover,
      },
    });
    controller.bindEvents();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(authProbeCount, 0);

    backendAccountToggleBtn.listeners.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(authProbeCount, 1);
    assert.equal(backendCloudSection.hidden, false);
    assert.equal(backendCloudUsername.disabled, false);
    assert.equal(backendCloudPassword.disabled, false);
    assert.equal(backendCloudRegisterBtn.disabled, false);
    assert.equal(backendCloudLoginBtn.disabled, false);
    assert.equal(backendCommunityRefreshBtn.disabled, false);
    assert.equal(backendCloudSaveTitle.disabled, true);
    assert.equal(backendCloudLogoutBtn.disabled, true);
    assert.equal(backendCloudSaveBtn.disabled, true);
    assert.equal(backendCloudPublishBtn.disabled, true);

    backendAccountToggleBtn.listeners.click();
    backendAccountToggleBtn.listeners.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(authProbeCount, 1);
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }
});

test("community load waits for import callback before showing loaded status", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const backendCloudStatus = createStatusNode();
  const backendCommunityRefreshBtn = createButtonNode();
  const backendCommunityList = createListNode();
  let imported = false;

  globalThis.document = {
    createElement: createElementNode,
    getElementById: () => null,
  };
  globalThis.fetch = async (url) => ({
    ok: !String(url).includes("/auth/me"),
    json: async () => {
      if (String(url).endsWith("/community/saves")) {
        return { saves: [{ id: "save-1", title: "Shared Save", owner: { displayName: "Alice" } }] };
      }
      if (String(url).endsWith("/community/saves/save-1/download")) {
        return { filename: "shared.json", save: { project: { schemaVersion: 21 } } };
      }
      return {};
    },
  });

  try {
    const controller = createController(createStatusNode(), {
      elements: {
        backendCloudStatus,
        backendCommunityRefreshBtn,
        backendCommunityList,
      },
      helpers: {
        importProjectThroughFunnel: (_file, options) => {
          imported = true;
          assert.equal(typeof options.hooks.onProjectImportComplete, "function");
          return true;
        },
        mapRenderer: { refreshColorState: () => {} },
      },
    });
    controller.bindEvents();

    await backendCommunityRefreshBtn.listeners.click();
    const row = backendCommunityList.children[0];
    const loadButton = row.children.find((child) => child.textContent === "Load");
    await loadButton.listeners.click();

    assert.equal(imported, true);
    assert.equal(backendCloudStatus.textContent, "Community save import started.");
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("community load respects unsaved project confirmation", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const previousDirty = state.isDirty;
  const previousLastDirtyReason = state.lastDirtyReason;
  const backendCloudStatus = createStatusNode();
  const backendCommunityRefreshBtn = createButtonNode();
  const backendCommunityList = createListNode();
  let downloaded = false;
  let imported = false;
  let dialogCount = 0;

  globalThis.document = {
    createElement: createElementNode,
    getElementById: () => null,
  };
  globalThis.fetch = async (url) => ({
    ok: !String(url).includes("/auth/me"),
    json: async () => {
      if (String(url).endsWith("/community/saves")) {
        return { saves: [{ id: "save-1", title: "Shared Save", owner: { displayName: "Alice" } }] };
      }
      if (String(url).endsWith("/community/saves/save-1/download")) {
        downloaded = true;
        return { filename: "shared.json", save: { project: { schemaVersion: 21 } } };
      }
      return {};
    },
  });

  try {
    state.isDirty = true;
    state.lastDirtyReason = "paint";
    const controller = createController(createStatusNode(), {
      elements: {
        backendCloudStatus,
        backendCommunityRefreshBtn,
        backendCommunityList,
      },
      helpers: {
        showAppDialog: async () => {
          dialogCount += 1;
          return false;
        },
        importProjectThroughFunnel: () => {
          imported = true;
          return true;
        },
      },
    });
    controller.bindEvents();

    await backendCommunityRefreshBtn.listeners.click();
    const row = backendCommunityList.children[0];
    const loadButton = row.children.find((child) => child.textContent === "Load");
    await loadButton.listeners.click();

    assert.equal(dialogCount, 1);
    assert.equal(downloaded, false);
    assert.equal(imported, false);
  } finally {
    state.isDirty = previousDirty;
    state.lastDirtyReason = previousLastDirtyReason;
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("publish latest recovers newest cloud save after session refresh", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const backendCloudStatus = createStatusNode();
  const backendCloudPublishBtn = createButtonNode();
  const backendCommunityList = createListNode();
  const requested = [];

  globalThis.document = {
    createElement: createElementNode,
    getElementById: () => null,
  };
  globalThis.fetch = async (url, options = {}) => {
    requested.push([String(url), options.method || "GET"]);
    return {
      ok: true,
      json: async () => {
        if (String(url).endsWith("/auth/me")) {
          return { user: { displayName: "Alice" }, csrfToken: "csrf-token" };
        }
        if (String(url).endsWith("/api/backend/saves")) {
          return { saves: [{ id: "save-2", title: "Newest Save" }] };
        }
        if (String(url).endsWith("/publish")) {
          return { save: { id: "save-2", visibility: "public" } };
        }
        if (String(url).endsWith("/community/saves")) {
          return { saves: [] };
        }
        return {};
      },
    };
  };

  try {
    const controller = createController(createStatusNode(), {
      elements: {
        backendCloudStatus,
        backendCloudPublishBtn,
        backendCommunityList,
      },
    });
    controller.bindEvents();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await backendCloudPublishBtn.listeners.click();

    assert.deepEqual(requested.some(([url]) => url.endsWith("/api/backend/saves")), true);
    assert.deepEqual(requested.some(([url, method]) => url.endsWith("/api/backend/saves/save-2/publish") && method === "POST"), true);
    assert.equal(backendCloudStatus.textContent, "Latest cloud save published.");
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("cloud save button ignores duplicate clicks while save is in flight", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const backendCloudStatus = createStatusNode();
  const backendCloudSaveTitle = { value: "Race save" };
  const backendCloudSaveBtn = createButtonNode();
  const backendCommunityList = createListNode();
  let savePostCount = 0;
  let releaseSave = null;

  globalThis.document = {
    createElement: createElementNode,
    getElementById: () => null,
  };
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/auth/me")) {
      return {
        ok: true,
        json: async () => ({ user: { displayName: "Alice" }, csrfToken: "csrf-token" }),
      };
    }
    if (String(url).endsWith("/api/backend/saves") && (options.method || "GET") === "POST") {
      savePostCount += 1;
      await new Promise((resolve) => {
        releaseSave = resolve;
      });
      return {
        ok: true,
        json: async () => ({ save: { id: "save-1" } }),
      };
    }
    return {
      ok: true,
      json: async () => ({}),
    };
  };

  try {
    const controller = createController(createStatusNode(), {
      elements: {
        backendCloudStatus,
        backendCloudSaveTitle,
        backendCloudSaveBtn,
        backendCommunityList,
      },
      helpers: {
        fileManager: {
          buildProjectPayload: () => ({ schemaVersion: 21, paintMode: "visual" }),
        },
      },
    });
    controller.bindEvents();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const first = backendCloudSaveBtn.listeners.click();
    const second = backendCloudSaveBtn.listeners.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(savePostCount, 1);
    releaseSave();
    await Promise.all([first, second]);

    assert.equal(savePostCount, 1);
    assert.equal(backendCloudStatus.textContent, "Cloud save created.");
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("publish button ignores duplicate clicks while publish is in flight", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const backendCloudStatus = createStatusNode();
  const backendCloudPublishBtn = createButtonNode();
  const backendCommunityList = createListNode();
  let publishPostCount = 0;
  let releasePublish = null;

  globalThis.document = {
    createElement: createElementNode,
    getElementById: () => null,
  };
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/auth/me")) {
      return {
        ok: true,
        json: async () => ({ user: { displayName: "Alice" }, csrfToken: "csrf-token" }),
      };
    }
    if (String(url).endsWith("/api/backend/saves")) {
      return {
        ok: true,
        json: async () => ({ saves: [{ id: "save-2", title: "Newest Save" }] }),
      };
    }
    if (String(url).endsWith("/publish") && (options.method || "GET") === "POST") {
      publishPostCount += 1;
      await new Promise((resolve) => {
        releasePublish = resolve;
      });
      return {
        ok: true,
        json: async () => ({ save: { id: "save-2", visibility: "public" } }),
      };
    }
    if (String(url).endsWith("/community/saves")) {
      return {
        ok: true,
        json: async () => ({ saves: [] }),
      };
    }
    return {
      ok: true,
      json: async () => ({}),
    };
  };

  try {
    const controller = createController(createStatusNode(), {
      elements: {
        backendCloudStatus,
        backendCloudPublishBtn,
        backendCommunityList,
      },
    });
    controller.bindEvents();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const first = backendCloudPublishBtn.listeners.click();
    const second = backendCloudPublishBtn.listeners.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(publishPostCount, 1);
    releasePublish();
    await Promise.all([first, second]);

    assert.equal(publishPostCount, 1);
    assert.equal(backendCloudStatus.textContent, "Latest cloud save published.");
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("login clears previous cloud save before publishing", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const backendCloudStatus = createStatusNode();
  const backendCloudUsername = { value: "bob" };
  const backendCloudPassword = { value: "correct horse" };
  const backendCloudSaveTitle = { value: "First save" };
  const backendCloudSaveBtn = createButtonNode();
  const backendCloudLoginBtn = createButtonNode();
  const backendCloudPublishBtn = createButtonNode();
  const backendCommunityList = createListNode();
  const requested = [];

  globalThis.document = {
    createElement: createElementNode,
    getElementById: () => null,
  };
  globalThis.fetch = async (url, options = {}) => {
    requested.push([String(url), options.method || "GET", options.body ? JSON.parse(String(options.body)) : null]);
    return {
      ok: true,
      json: async () => {
        if (String(url).endsWith("/auth/me")) {
          return { user: { displayName: "Alice" }, csrfToken: "initial-csrf" };
        }
        if (String(url).endsWith("/api/backend/saves") && (options.method || "GET") === "POST") {
          return { save: { id: "save-1" } };
        }
        if (String(url).endsWith("/auth/login")) {
          return { user: { displayName: "Bob" }, csrfToken: "bob-csrf" };
        }
        if (String(url).endsWith("/api/backend/saves")) {
          return { saves: [{ id: "save-2", title: "Bob save" }] };
        }
        if (String(url).endsWith("/publish")) {
          return { save: { id: "save-2", visibility: "public" } };
        }
        if (String(url).endsWith("/community/saves")) {
          return { saves: [] };
        }
        return {};
      },
    };
  };

  try {
    const controller = createController(createStatusNode(), {
      elements: {
        backendCloudStatus,
        backendCloudUsername,
        backendCloudPassword,
        backendCloudSaveTitle,
        backendCloudSaveBtn,
        backendCloudLoginBtn,
        backendCloudPublishBtn,
        backendCommunityList,
      },
      helpers: {
        fileManager: {
          buildProjectPayload: () => ({ schemaVersion: 21, paintMode: "visual" }),
        },
      },
    });
    controller.bindEvents();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await backendCloudSaveBtn.listeners.click();
    await backendCloudLoginBtn.listeners.click();
    await backendCloudPublishBtn.listeners.click();

    assert.deepEqual(
      requested.some(([url, method]) => url.endsWith("/api/backend/saves/save-2/publish") && method === "POST"),
      true
    );
    assert.deepEqual(
      requested.some(([url]) => url.endsWith("/api/backend/saves/save-1/publish")),
      false
    );
    assert.equal(backendCloudStatus.textContent, "Latest cloud save published.");
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("register clears previous cloud save before publishing", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const backendCloudStatus = createStatusNode();
  const backendCloudUsername = { value: "bob" };
  const backendCloudPassword = { value: "correct horse" };
  const backendCloudSaveTitle = { value: "First save" };
  const backendCloudSaveBtn = createButtonNode();
  const backendCloudRegisterBtn = createButtonNode();
  const backendCloudPublishBtn = createButtonNode();
  const backendCommunityList = createListNode();
  const requested = [];

  globalThis.document = {
    createElement: createElementNode,
    getElementById: () => null,
  };
  globalThis.fetch = async (url, options = {}) => {
    requested.push([String(url), options.method || "GET"]);
    return {
      ok: true,
      json: async () => {
        if (String(url).endsWith("/auth/me")) {
          return { user: { username: "alice" }, csrfToken: "initial-csrf" };
        }
        if (String(url).endsWith("/api/backend/saves") && (options.method || "GET") === "POST") {
          return { save: { id: "save-1" } };
        }
        if (String(url).endsWith("/auth/register")) {
          return { user: { username: "bob" }, csrfToken: "bob-csrf" };
        }
        if (String(url).endsWith("/api/backend/saves")) {
          return { saves: [{ id: "save-2", title: "Bob save" }] };
        }
        if (String(url).endsWith("/publish")) {
          return { save: { id: "save-2", visibility: "public" } };
        }
        if (String(url).endsWith("/community/saves")) {
          return { saves: [] };
        }
        return {};
      },
    };
  };

  try {
    const controller = createController(createStatusNode(), {
      elements: {
        backendCloudStatus,
        backendCloudUsername,
        backendCloudPassword,
        backendCloudSaveTitle,
        backendCloudSaveBtn,
        backendCloudRegisterBtn,
        backendCloudPublishBtn,
        backendCommunityList,
      },
      helpers: {
        fileManager: {
          buildProjectPayload: () => ({ schemaVersion: 21, paintMode: "visual" }),
        },
      },
    });
    controller.bindEvents();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await backendCloudSaveBtn.listeners.click();
    await backendCloudRegisterBtn.listeners.click();
    await backendCloudPublishBtn.listeners.click();

    assert.deepEqual(
      requested.some(([url, method]) => url.endsWith("/api/backend/saves/save-2/publish") && method === "POST"),
      true
    );
    assert.deepEqual(
      requested.some(([url]) => url.endsWith("/api/backend/saves/save-1/publish")),
      false
    );
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("anonymous backend probe enables only public cloud actions", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const backendCloudSection = { hidden: true };
  const backendCloudStatus = createStatusNode();
  const backendCloudUsername = { value: "", disabled: false };
  const backendCloudPassword = { value: "", disabled: false };
  const backendCloudSaveTitle = { value: "", disabled: false };
  const backendCloudRegisterBtn = createButtonNode();
  const backendCloudLoginBtn = createButtonNode();
  const backendCloudLogoutBtn = createButtonNode();
  const backendCloudSaveBtn = createButtonNode();
  const backendCloudPublishBtn = createButtonNode();
  const backendCommunityRefreshBtn = createButtonNode();
  const backendCommunityList = createListNode();
  const { backendAccountToggleBtn, backendAccountPopover } = createAccountPopoverControls();

  globalThis.document = {
    body: { classList: { toggle: () => {} } },
    createElement: createElementNode,
    addEventListener: () => {},
    getElementById: () => null,
  };
  globalThis.window = { requestAnimationFrame: (callback) => callback() };
  globalThis.fetch = async (url) => ({
    ok: !String(url).endsWith("/auth/me"),
    status: String(url).endsWith("/auth/me") ? 401 : 200,
    json: async () => {
      if (String(url).endsWith("/auth/me")) {
        return { code: "auth_required", message: "Login is required." };
      }
      if (String(url).endsWith("/community/saves")) {
        return { saves: [{ id: "save-1", title: "Shared Save", owner: { displayName: "Alice" } }] };
      }
      return {};
    },
  });

  try {
    const controller = createController(createStatusNode(), {
      elements: {
        backendCloudSection,
        backendCloudStatus,
        backendCloudUsername,
        backendCloudPassword,
        backendCloudSaveTitle,
        backendCloudRegisterBtn,
        backendCloudLoginBtn,
        backendCloudLogoutBtn,
        backendCloudSaveBtn,
        backendCloudPublishBtn,
        backendCommunityRefreshBtn,
        backendCommunityList,
        backendAccountToggleBtn,
        backendAccountPopover,
      },
    });
    controller.bindEvents();
    backendAccountToggleBtn.listeners.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(backendCloudSection.hidden, false);
    assert.equal(backendCloudUsername.disabled, false);
    assert.equal(backendCloudPassword.disabled, false);
    assert.equal(backendCloudRegisterBtn.disabled, false);
    assert.equal(backendCloudLoginBtn.disabled, false);
    assert.equal(backendCommunityRefreshBtn.disabled, false);
    assert.equal(backendCloudSaveTitle.disabled, true);
    assert.equal(backendCloudLogoutBtn.disabled, true);
    assert.equal(backendCloudSaveBtn.disabled, true);
    assert.equal(backendCloudPublishBtn.disabled, true);

    await backendCommunityRefreshBtn.listeners.click();
    const row = backendCommunityList.children[0];
    assert.equal(row.children.find((child) => child.textContent === "Load").disabled, false);
    assert.equal(row.children.find((child) => child.textContent === "Comment").disabled, true);
    assert.equal(row.children.find((child) => child.textContent === "Report").disabled, true);
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }
});

test("community action buttons refresh after anonymous user logs in", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const backendCloudSection = { hidden: true };
  const backendCloudStatus = createStatusNode();
  const backendCloudUsername = { value: "alice", disabled: false };
  const backendCloudPassword = { value: "correct horse", disabled: false };
  const backendCloudRegisterBtn = createButtonNode();
  const backendCloudLoginBtn = createButtonNode();
  const backendCommunityRefreshBtn = createButtonNode();
  const backendCommunityList = createListNode();

  globalThis.document = {
    createElement: createElementNode,
    getElementById: () => null,
  };
  globalThis.fetch = async (url) => ({
    ok: !String(url).endsWith("/auth/me"),
    status: String(url).endsWith("/auth/me") ? 401 : 200,
    json: async () => {
      if (String(url).endsWith("/auth/me")) {
        return { code: "auth_required", message: "Login is required." };
      }
      if (String(url).endsWith("/auth/login")) {
        return { user: { username: "alice" }, csrfToken: "csrf-token" };
      }
      if (String(url).endsWith("/community/saves")) {
        return { saves: [{ id: "save-1", title: "Shared Save", owner: { displayName: "Alice" } }] };
      }
      return {};
    },
  });

  try {
    const controller = createController(createStatusNode(), {
      elements: {
        backendCloudSection,
        backendCloudStatus,
        backendCloudUsername,
        backendCloudPassword,
        backendCloudRegisterBtn,
        backendCloudLoginBtn,
        backendCommunityRefreshBtn,
        backendCommunityList,
      },
    });
    controller.bindEvents();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await backendCommunityRefreshBtn.listeners.click();
    const anonymousRow = backendCommunityList.children[0];
    assert.equal(anonymousRow.children.find((child) => child.textContent === "Comment").disabled, true);
    assert.equal(anonymousRow.children.find((child) => child.textContent === "Report").disabled, true);

    await backendCloudLoginBtn.listeners.click();
    const authenticatedRow = backendCommunityList.children[0];
    assert.equal(authenticatedRow.children.find((child) => child.textContent === "Comment").disabled, false);
    assert.equal(authenticatedRow.children.find((child) => child.textContent === "Report").disabled, false);
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("backend session probe disables cloud controls when local backend fails unexpectedly", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const backendCloudSection = { hidden: true };
  const backendCloudStatus = createStatusNode();
  const backendCloudUsername = { value: "" };
  const backendCloudPassword = { value: "" };
  const backendCloudSaveTitle = { value: "" };
  const backendCloudRegisterBtn = createButtonNode();
  const backendCloudLoginBtn = createButtonNode();
  const backendCloudLogoutBtn = createButtonNode();
  const backendCloudSaveBtn = createButtonNode();
  const backendCloudPublishBtn = createButtonNode();
  const backendCommunityRefreshBtn = createButtonNode();
  const { backendAccountToggleBtn, backendAccountPopover } = createAccountPopoverControls();

  globalThis.document = {
    body: { classList: { toggle: () => {} } },
    createElement: createElementNode,
    addEventListener: () => {},
    getElementById: () => null,
  };
  globalThis.window = { requestAnimationFrame: (callback) => callback() };
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ code: "internal_error", message: "Unexpected backend failure." }),
  });

  try {
    const controller = createController(createStatusNode(), {
      elements: {
        backendCloudSection,
        backendCloudStatus,
        backendCloudUsername,
        backendCloudPassword,
        backendCloudSaveTitle,
        backendCloudRegisterBtn,
        backendCloudLoginBtn,
        backendCloudLogoutBtn,
        backendCloudSaveBtn,
        backendCloudPublishBtn,
        backendCommunityRefreshBtn,
        backendAccountToggleBtn,
        backendAccountPopover,
      },
    });
    controller.bindEvents();
    backendAccountToggleBtn.listeners.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(backendCloudStatus.textContent, "Local backend unavailable. Start the local dev server to use Cloud Saves.");
    assert.equal(backendCloudSection.hidden, false);
    assert.equal(backendCloudSaveBtn.disabled, true);
    assert.equal(backendCommunityRefreshBtn.disabled, true);
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }
});

test("backend session probe hides cloud section for non backend success payloads", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const backendCloudSection = { hidden: true };
  const backendCloudStatus = createStatusNode();
  const backendCloudRegisterBtn = createButtonNode();
  const backendCommunityRefreshBtn = createButtonNode();
  const { backendAccountToggleBtn, backendAccountPopover } = createAccountPopoverControls();

  globalThis.document = {
    body: { classList: { toggle: () => {} } },
    createElement: createElementNode,
    addEventListener: () => {},
    getElementById: () => null,
  };
  globalThis.window = { requestAnimationFrame: (callback) => callback() };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
  });

  try {
    const controller = createController(createStatusNode(), {
      elements: {
        backendCloudSection,
        backendCloudStatus,
        backendCloudRegisterBtn,
        backendCommunityRefreshBtn,
        backendAccountToggleBtn,
        backendAccountPopover,
      },
    });
    controller.bindEvents();
    backendAccountToggleBtn.listeners.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(backendCloudSection.hidden, true);
    assert.equal(backendCloudRegisterBtn.disabled, true);
    assert.equal(backendCommunityRefreshBtn.disabled, true);
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }
});
