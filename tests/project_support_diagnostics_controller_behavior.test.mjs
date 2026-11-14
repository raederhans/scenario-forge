import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { state } from "../js/core/state.js";
import { registerRuntimeHook } from "../js/core/state/index.js";
import { markDirty, clearDirty } from "../js/core/dirty_state.js";
import { createProjectSupportDiagnosticsController } from "../js/ui/sidebar/project_support_diagnostics_controller.js";
import { strToU8, zipSync } from "../vendor/fflate.browser.js";

class FakeHTMLElement {
  get ownerDocument() { return this.documentRef || globalThis.document; }
  set ownerDocument(value) { Object.defineProperty(this, "documentRef", { value, writable: true, configurable: true }); }
  get parentElement() { return this.parentNode || null; }
  get tabIndex() {
    if (this.hasAttribute("tabindex")) return Number(this.getAttribute("tabindex"));
    return ["button", "input", "select", "textarea", "summary"].includes(this.tagName) || this.hasAttribute("href") ? 0 : -1;
  }
  set tabIndex(value) { this.setAttribute("tabindex", value); }
  hasAttribute(name) { return Object.hasOwn(this.attributes || {}, name); }
  contains(node) { return node === this || (this.children || []).some(child => child.contains?.(node)); }
  querySelectorAll(selector) {
    return (this.children || []).flatMap(child => collectNodes(child, node => {
      if (selector === '[aria-modal="true"]') return node.getAttribute?.("aria-modal") === "true";
      return (!node.disabled && ["button", "input", "select", "textarea"].includes(node.tagName))
        || node.hasAttribute?.("href") || (selector.includes("summary") && node.tagName === "summary")
        || (node.hasAttribute?.("tabindex") && node.getAttribute("tabindex") !== "-1");
    }));
  }
  focus() { this.ownerDocument.activeElement = this; }
}

let domGlobals;
beforeEach(() => {
  domGlobals = Object.fromEntries(["HTMLElement", "getComputedStyle"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  globalThis.HTMLElement = FakeHTMLElement;
  globalThis.getComputedStyle = node => ({
    display: node.classList?.contains("hidden") ? "none" : node.style?.display || "block",
    visibility: node.style?.visibility || "visible",
    zIndex: node.style?.zIndex || "auto",
  });
});
afterEach(() => {
  for (const [key, descriptor] of Object.entries(domGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

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
  return Object.assign(new FakeHTMLElement(), {
    ownerDocument: globalThis.document,
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
  });
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
      querySelectorAll: selector => [...nodesById.values()].filter(node => node?.getAttribute?.("aria-modal") === "true" && selector === '[aria-modal="true"]'),
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
      ...overrides.helpers,
    },
  });
}

function createMountDocument() {
  const documentRef = { activeElement: null, listeners: {}, listenerCounts: {} };
  documentRef.addEventListener = (type, handler) => {
    documentRef.listeners[type] = event => {
      event.defaultPrevented ??= false;
      event.preventDefault ??= function () { this.defaultPrevented = true; };
      handler(event);
    };
    documentRef.listenerCounts[type] = (documentRef.listenerCounts[type] || 0) + 1;
  };
  documentRef.createElement = (tagName) => {
    const node = createElementNode(tagName);
    node.ownerDocument = documentRef;
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
  documentRef.querySelectorAll = selector => documentRef.body.querySelectorAll(selector);
  documentRef.getElementById = (id) => findNode(documentRef.body, (node) => node.id === id);
  const hosts = Object.fromEntries([
    "projectManagementStack", "legendEditorStack", "diagnosticStack",
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

test("project support mounts panels with original defaults", () => {
  const fixture = createMountDocument();
  createController(null, fixture);
  const get = fixture.documentRef.getElementById;
  assert.equal(get("projectManagement").parentNode, fixture.hosts.projectManagementStack);
  assert.equal(get("legendEditor").parentNode, fixture.hosts.legendEditorStack);
  assert.equal(get("scenarioAuditPanel").parentNode, fixture.hosts.diagnosticStack);
  assert.equal(get("debugViewControl").parentNode, fixture.hosts.diagnosticStack);
  for (const [id, value] of Object.entries({
    projectDownloadFormat: "json", projectDownloadDestination: "picker",
    projectPackageContents: "minimal", "debug-mode-select": "PROD",
  })) assert.equal(get(id).value, value, id);
  assert.equal(get("projectFileName").textContent, "No file selected");
  assert.equal(get("projectFileName").dataset.projectFileState, "empty");
  assert.equal(get("downloadProjectBtn").getAttribute("data-i18n"), "Download Project");
  assert.equal(get("projectFileInput").getAttribute("data-i18n-aria-label"), "Load Project");
  assert.equal(get("projectSaveStatus").getAttribute("aria-live"), "polite");
});

test("project support reuses mounted markup and preserves user values without duplicate nodes", () => {
  const fixture = createMountDocument();
  createController(null, fixture);
  const { documentRef } = fixture;
  const originalNodes = collectNodes(documentRef.body, (node) => !!node.id);
  documentRef.getElementById("projectDownloadFormat").value = "zip";
  const name = documentRef.getElementById("projectFileName");
  name.textContent = "edited-project.zip";
  name.dataset.projectFileState = "selected";
  createController(null, fixture);
  assert.deepEqual(collectNodes(documentRef.body, (node) => !!node.id), originalNodes);
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
  assert.equal(documentRef.getElementById("legendEditor"), null);
  assert.equal(documentRef.getElementById("scenarioAuditPanel"), null);
  assert.equal(documentRef.getElementById("debugViewControl"), null);
});

test("project save status refreshes when dirty state changes", () => {
  const previousDocument = globalThis.document;
  const previousDirty = state.isDirty;
  const previousLastDirtyReason = state.lastDirtyReason;
  const projectSaveStatus = createStatusNode();
  const controller = createController(projectSaveStatus);

  globalThis.document = {
    getElementById: () => null,
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

test("workspace save shares export options, guards both buttons, and reports cancellation and errors", async () => {
  const downloadProjectBtn = createButtonNode();
  const workspaceSaveBtn = createButtonNode();
  const workspaceSaveStatus = createStatusNode();
  workspaceSaveStatus.dataset.i18n = "Not saved yet";
  const projectState = { isDirty: true, lastDirtyReason: "edit" };
  let settle;
  let calls = 0;
  const controller = createController(createStatusNode(), {
    state: projectState,
    elements: { downloadProjectBtn, workspaceSaveBtn, workspaceSaveStatus },
    helpers: {
      fileManager: {
        exportProject: async (receivedState, options) => {
          calls += 1;
          assert.equal(receivedState, projectState);
          assert.deepEqual(options, { format: "json", destination: "picker", packageContents: "recommended" });
          return new Promise((resolve, reject) => { settle = { resolve, reject }; });
        },
      },
    },
  });
  controller.bindEvents();
  controller.bindEvents();
  assert.equal(workspaceSaveStatus.textContent, "Unsaved changes");
  const pending = workspaceSaveBtn.listeners.click();
  assert.equal(downloadProjectBtn.disabled, true);
  assert.equal(workspaceSaveBtn.disabled, true);
  assert.match(workspaceSaveStatus.textContent, /Exporting project/);
  assert.equal(workspaceSaveStatus.dataset.i18n, undefined);
  await downloadProjectBtn.listeners.click();
  assert.equal(calls, 1);
  settle.resolve(false);
  await pending;
  assert.equal(workspaceSaveStatus.textContent, "Project export cancelled.");
  assert.equal(projectState.isDirty, true);
  assert.equal(downloadProjectBtn.disabled, false);
  assert.equal(workspaceSaveBtn.disabled, false);
  const failing = downloadProjectBtn.listeners.click();
  settle.reject(new Error("Save dialog failed"));
  await failing;
  assert.equal(workspaceSaveStatus.textContent, "Save dialog failed");
  assert.equal(workspaceSaveBtn.disabled, false);
});

test("workspace save status follows dirty contract without requiring the detailed status node", () => {
  const workspaceSaveStatus = createStatusNode();
  const projectState = { isDirty: false, lastDirtyReason: "" };
  const controller = createController(null, { state: projectState, elements: { workspaceSaveStatus } });
  for (const [reason, dirty, expected] of [
    ["", false, "Not saved yet"],
    ["project-export", false, "Project downloaded"],
    ["project-import", false, "Project imported"],
    ["project-export", true, "Unsaved changes"],
  ]) {
    projectState.lastDirtyReason = reason;
    projectState.isDirty = dirty;
    controller.refreshProjectSaveStatus();
    assert.equal(workspaceSaveStatus.textContent, expected);
    assert.equal(workspaceSaveStatus.dataset.i18n, expected);
  }
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

test("malformed diagnostics JSON uses the existing error state instead of displaying zero violations", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const previousConsoleError = console.error;
  const previousActiveScenarioId = state.activeScenarioId;
  const previousScenarioAuditUi = state.scenarioAuditUi;
  const previousScenarioDiagnosticsUi = state.scenarioDiagnosticsUi;
  const previousScenarioAudit = state.scenarioAudit;
  const previousScenarioDiagnostics = state.scenarioDiagnostics;
  const previousScenarioDiagnosticsPreview = state.scenarioDiagnosticsPreview;
  const scenarioAuditSection = createElementNode("section");
  const controller = createController(createStatusNode(), {
    elements: { scenarioAuditSection },
    helpers: {
      createEmptyNote: (message) => Object.assign(createElementNode("div"), { textContent: String(message || "") }),
    },
  });

  try {
    globalThis.document = { createElement: createElementNode };
    globalThis.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError("Invalid JSON"); } });
    console.error = () => {};
    state.activeScenarioId = "hoi4_1936";
    state.scenarioAuditUi = {};
    state.scenarioDiagnosticsUi = {};
    state.scenarioAudit = null;
    state.scenarioDiagnostics = null;
    state.scenarioDiagnosticsPreview = null;

    controller.renderScenarioAuditPanel();
    const button = findNode(scenarioAuditSection, (node) => node.textContent === "Load Diagnostics");
    assert.ok(button);
    await button.listeners.click();

    assert.equal(state.scenarioDiagnostics, null);
    assert.equal(state.scenarioDiagnosticsPreview, null);
    assert.equal(state.scenarioDiagnosticsUi.loading, false);
    assert.equal(state.scenarioDiagnosticsUi.errorMessage, "Invalid JSON");
    assert.match(getNodeText(scenarioAuditSection), /Unable to load diagnostics: Invalid JSON/);
    assert.doesNotMatch(getNodeText(scenarioAuditSection), /Forbidden\s+0/);
  } finally {
    state.activeScenarioId = previousActiveScenarioId;
    state.scenarioAuditUi = previousScenarioAuditUi;
    state.scenarioDiagnosticsUi = previousScenarioDiagnosticsUi;
    state.scenarioAudit = previousScenarioAudit;
    state.scenarioDiagnostics = previousScenarioDiagnostics;
    state.scenarioDiagnosticsPreview = previousScenarioDiagnosticsPreview;
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
    console.error = previousConsoleError;
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

