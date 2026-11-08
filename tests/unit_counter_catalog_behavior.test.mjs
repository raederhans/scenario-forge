import test from "node:test";
import assert from "node:assert/strict";
import { createUnitCounterCatalog } from "../js/ui/sidebar/strategic_overlay/unit_counter_catalog_helper.js";
import { bindUnitCounterSidebarEvents } from "../js/ui/sidebar/strategic_overlay/unit_counter_bind_events_helper.js";
import { createStrategicOverlayController } from "../js/ui/sidebar/strategic_overlay_controller.js";

class Element {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) };
  }
  appendChild(child) {
    if (child.tag === "fragment") {
      for (const node of [...child.children]) this.appendChild(node);
      return child;
    }
    child.remove();
    child.parent = this;
    this.children.push(child);
    return child;
  }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  replaceChildren(...children) {
    this.children.forEach((child) => { child.parent = null; });
    this.children = [];
    this.append(...children);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  set src(value) { this.setAttribute("src", value); }
  querySelectorAll() { return []; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  closest(selector) { return selector === "[data-hoi4-review-action]" ? this : null; }
  click() { this.clicked = true; this.listeners.get("click")?.({ target: this }); }
}

function buildCatalogView(state) {
  const ui = state.strategicOverlayUi || {};
  return {
    isModalOpen: Boolean(ui.counterEditorModalOpen),
    source: String(ui.counterCatalogSource || "internal"),
    variant: String(ui.hoi4CounterVariant || "small"),
    internalQuery: String(ui.counterCatalogQuery || ""),
    hoi4Query: String(ui.hoi4CounterQuery || ""),
    internalCategory: String(ui.counterCatalogCategory || "all"),
    hoi4Category: String(ui.hoi4CounterCategory || "all"),
  };
}

function fixture(context, { count = 1 } = {}) {
  const originals = Object.fromEntries(["document", "requestAnimationFrame", "cancelAnimationFrame", "HTMLElement", "HTMLButtonElement"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const frames = new Map();
  const canceled = [];
  let nextFrame = 0;
  globalThis.document = { createElement: (tag) => new Element(tag), createDocumentFragment: () => new Element("fragment"), body: new Element("body") };
  globalThis.HTMLElement = Element;
  globalThis.HTMLButtonElement = Element;
  globalThis.requestAnimationFrame = (callback) => { frames.set(++nextFrame, callback); return nextFrame; };
  globalThis.cancelAnimationFrame = (id) => canceled.push(id);
  context.after(() => {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  let resolve, reject;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  let loads = 0, refreshes = 0;
  const saved = [];
  const entries = Array.from({ length: count }, (_, id) => ({
    id: `icon-${id}`, canonicalKey: `infantry-${id}`, label: `Infantry ${id}`,
    domain: "ground", kind: "division_small", spriteName: `sprite-${id}`,
    mappedPresetIds: [], variants: { small: `/icons/${id}.png`, large: null },
  }));
  const catalog = createUnitCounterCatalog({
    t: (label) => label,
    getUnitCounterPresetMeta: (id) => ({ id: String(id).toLowerCase(), label: "Infantry" }),
    showToast: () => {},
    onManifestSettled: () => { refreshes += 1; },
    loadManifest: () => { loads += 1; return pending; },
    loadDraft: () => ({ entryOverrides: {}, presetCandidates: {} }),
    saveDraft: (draft) => { saved.push(structuredClone(draft)); return structuredClone(draft); },
  });
  const grid = new Element();
  const summary = new Element();
  const hint = new Element();
  const state = { strategicOverlayUi: { counterCatalogSource: "hoi4", counterEditorModalOpen: false }, unitCounterEditor: { presetId: "INF" } };
  const render = () => catalog.render({
    elements: { unitCounterCatalogGrid: grid, unitCounterLibraryReviewSummary: summary, unitCounterCatalogHeaderHint: hint }, catalogView: buildCatalogView(state),
    effectivePresetId: "INF", helpers: { getFilteredUnitCounterCatalog: () => [] },
  });
  const ready = async () => { resolve({ entries }); await pending; await Promise.resolve(); };
  return { catalog, state, grid, summary, hint, render, ready, reject, pending, entries, saved, frames, canceled,
    get loads() { return loads; }, get refreshes() { return refreshes; } };
}

test("catalog stays cold while closed and deduplicates loading before refreshing on success", async (context) => {
  const f = fixture(context);
  f.render();
  assert.equal(f.loads, 0);
  f.state.strategicOverlayUi.counterEditorModalOpen = true;
  f.render(); f.render();
  assert.equal(f.loads, 1);
  assert.equal(f.grid.children[0].textContent, "Loading HOI4 unit icon library...");
  await f.ready();
  assert.equal(f.refreshes, 1);
  f.render();
  assert.equal(f.loads, 1);
  assert.equal(f.grid.children[0].dataset.hoi4EntryId, "icon-0");
});

test("manifest failures refresh the catalog and render the failure without retry loops", async (context) => {
  const f = fixture(context);
  const errors = context.mock.method(console, "error", () => {});
  f.state.strategicOverlayUi.counterEditorModalOpen = true;
  f.render();
  f.reject(new Error("fixture unavailable"));
  await f.pending.catch(() => {});
  await Promise.resolve();
  assert.equal(f.refreshes, 1);
  f.render(); f.render();
  assert.equal(f.grid.children[0].textContent, "fixture unavailable");
  assert.equal(f.loads, 1);
  assert.equal(errors.mock.callCount(), 1);
});

test("review candidate and mapping changes persist and update current-preset filtering", async (context) => {
  const f = fixture(context);
  f.state.strategicOverlayUi.counterEditorModalOpen = true;
  f.render(); await f.ready();
  assert.equal(f.catalog.applyReviewAction({ action: "unknown" }), false);
  f.catalog.applyReviewAction({ action: "set-current-candidate", entryId: "icon-0", currentPresetId: "INF" });
  assert.deepEqual(f.saved.at(-1).entryOverrides["icon-0"].mappedPresetIds, ["inf"]);
  assert.equal(f.saved.at(-1).presetCandidates.inf, "icon-0");
  f.state.strategicOverlayUi.hoi4CounterCategory = "current";
  f.render();
  assert.ok(f.grid.children[0].classes.has("is-candidate"));
  assert.match(f.summary.textContent, /Candidate: Infantry 0/);
  f.catalog.applyReviewAction({ action: "toggle-current-mapping", entryId: "icon-0", currentPresetId: "inf" });
  assert.deepEqual(f.saved.at(-1), { entryOverrides: {}, presetCandidates: {} });
  f.render();
  assert.match(f.grid.children[0].textContent, /No HOI4 icons/);
});

test("new catalog renders cancel stale chunks and reuse cards while updating image variants", async (context) => {
  const f = fixture(context, { count: 29 });
  f.state.strategicOverlayUi.counterEditorModalOpen = true;
  f.render(); await f.ready(); f.render();
  assert.equal(f.grid.children.length, 24);
  const oldFrame = f.grid._hoi4RenderHandle;
  const staleCallback = f.frames.get(oldFrame);
  const firstCard = f.grid.children[0];
  f.state.strategicOverlayUi.hoi4CounterVariant = "large";
  f.render();
  assert.ok(f.canceled.includes(oldFrame));
  assert.equal(f.grid.children[0], firstCard);
  const image = firstCard.children[0].children[0];
  assert.equal(image.hidden, true);
  assert.equal(image.getAttribute("src"), null);
  staleCallback();
  assert.equal(f.grid.children.length, 24);
  f.frames.get(f.grid._hoi4RenderHandle)();
  assert.equal(f.grid.children.length, 29);
  assert.equal(f.grid._hoi4RenderHandle, 0);
  f.state.strategicOverlayUi.counterCatalogSource = "internal";
  f.render();
  assert.match(f.grid.children[0].textContent, /No symbols/);
});

test("closing the counter editor cancels pending cards through the controller and closed refresh", async (context) => {
  const f = fixture(context, { count: 29 });
  f.state.strategicOverlayUi.counterEditorModalOpen = true;
  f.render(); await f.ready();
  for (const closeViaController of [true, false]) {
    f.state.strategicOverlayUi.counterEditorModalOpen = true;
    f.render();
    const oldFrame = f.grid._hoi4RenderHandle;
    const staleCallback = f.frames.get(oldFrame);
    assert.equal(f.grid.children.length, 24);
    if (closeViaController) {
      const controller = createStrategicOverlayController({
        state: f.state,
        elements: { unitCounterCatalogGrid: f.grid },
        helpers: {},
      });
      controller.closeCounterEditorModal({ restoreFocus: false });
    } else {
      f.state.strategicOverlayUi.counterEditorModalOpen = false;
      f.render();
    }
    assert.equal(f.state.strategicOverlayUi.counterEditorModalOpen, false);
    assert.ok(f.canceled.includes(oldFrame));
    assert.equal(f.grid._hoi4RenderHandle, 0);
    staleCallback();
    assert.equal(f.grid.children.length, 24);
  }
});

test("bound review events call the catalog owner and schedule only catalog refresh", async (context) => {
  const f = fixture(context);
  f.state.strategicOverlayUi.counterEditorModalOpen = true;
  f.render(); await f.ready();
  const refreshes = [];
  bindUnitCounterSidebarEvents({ state: f.state, elements: { unitCounterCatalogGrid: f.grid, unitCounterStatsPresetButtons: [] }, uiState: {}, helpers: {
    unitCounterCatalog: f.catalog, DEFAULT_UNIT_COUNTER_PRESET_ID: "INF", scheduleStrategicOverlayRefresh: (scope) => refreshes.push(scope),
  } });
  const button = new Element("button");
  button.dataset = { hoi4ReviewAction: "set-current-candidate", hoi4EntryId: "icon-0" };
  f.grid.listeners.get("click")({ target: button });
  assert.equal(f.saved.at(-1).presetCandidates.inf, "icon-0");
  assert.deepEqual(refreshes, ["counterCatalog"]);
});

test("bound export saves the current draft and releases its download URL", async (context) => {
  const f = fixture(context);
  const exportButton = new Element("button");
  let payload, link, release;
  const revoked = [];
  context.mock.method(URL, "createObjectURL", (blob) => { payload = blob; return "blob:fixture"; });
  context.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));
  context.mock.method(globalThis, "setTimeout", (callback, delay) => {
    assert.equal(delay, 100);
    release = callback;
    return 1;
  });
  context.mock.method(document, "createElement", (tag) => {
    const element = new Element(tag);
    if (tag === "a") link = element;
    return element;
  });
  bindUnitCounterSidebarEvents({ state: f.state, elements: { unitCounterLibraryExportBtn: exportButton, unitCounterStatsPresetButtons: [] }, uiState: {}, helpers: {
    unitCounterCatalog: f.catalog,
  } });
  exportButton.click();
  assert.equal(link.download, "hoi4_unit_icon_review.json");
  assert.equal(link.href, "blob:fixture");
  assert.equal(link.clicked, true);
  assert.equal(document.body.children.length, 0);
  assert.deepEqual(JSON.parse(await payload.text()), f.saved.at(-1));
  release();
  assert.deepEqual(revoked, ["blob:fixture"]);
});


test("catalog hints describe browsing and applying presets", (context) => {
  const f = fixture(context);
  f.render();
  assert.equal(f.hint.textContent, "Browse Hearts of Iron IV counter icons.");
  f.state.strategicOverlayUi.counterCatalogSource = "internal";
  f.render();
  assert.equal(f.hint.textContent, "Search counter presets, then apply one to the editor.");
});


test("symbol hints explain the expected code for each renderer", async () => {
  const { refreshUnitCounterIdentitySection } = await import("../js/ui/sidebar/strategic_overlay/unit_counter_render_helpers.js");
  const hint = {};
  for (const [renderer, expected] of [
    ["milstd", "Paste a full SIDC code."],
    ["game", "Enter a short code such as HQ, ARM or INF."],
  ]) {
    refreshUnitCounterIdentitySection({
      documentRef: {}, elements: { unitCounterSymbolHint: hint }, state: {},
      t: value => value, syncSelectOptions: () => {},
      model: { effectiveRenderer: renderer, nationOptions: [], unitEditor: {} },
      getSidebarUnitCounterPresetOptions: () => [],
    });
    assert.equal(hint.textContent, expected);
  }
});
