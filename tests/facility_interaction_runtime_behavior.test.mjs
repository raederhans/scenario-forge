import assert from "node:assert/strict";
import test from "node:test";
import { createFacilityInteractionRuntime } from "../js/core/renderer/facility_interaction_runtime.js";

function createHarness(t) {
  const nodes = new Map([
    "facilityInfoCard", "facilityInfoCardTitle", "facilityInfoCardBody",
    "facilityInfoCardZoomBtn", "facilityInfoCardCloseBtn", "facilityInfoCardMoreBtn",
  ].map(id => [id, {
    dataset: {},
    listeners: [],
    addEventListener(type, callback) { this.listeners.push({ type, callback }); },
    click() { this.listeners.filter(listener => listener.type === "click").forEach(listener => listener.callback()); },
  }]));
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = { getElementById: id => nodes.get(id) || null };
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
  });
  let hovered = null;
  const dirty = [];
  const cards = [];
  const overlays = [];
  const runtimeState = {};
  const hoverOwner = {
    getHoveredFacilityEntry: () => hovered,
    setHoveredFacilityEntry: entry => { hovered = entry; },
    setHoverOverlayDirty: value => dirty.push(value),
  };
  const runtime = createFacilityInteractionRuntime({
    runtimeState,
    getScenarioProjectMarkerEntries: () => [],
    getMapHoverInteractionOwner: () => hoverOwner,
    getFacilitySurfaceOwner: () => ({
      applyFacilityInfoCardState: (entry, options) => {
        cards.push({ entry, ...options });
        return { anchor: options.previousAnchor };
      },
    }),
    renderHoverOverlayIfNeeded: options => overlays.push(options),
  });
  runtime.resolveDomHandles();
  return { runtime, runtimeState, hoverOwner, nodes, dirty, cards, overlays };
}

test("refresh rebinds selected and hovered facilities to the new entry with the same identity", t => {
  const h = createHarness(t);
  const first = { familyId: "airport", stableId: "airport-1", packId: "regional", name: "old" };
  h.runtime.setVisibleFacilityHoverEntries("airport", [first]);
  const oldEntry = h.runtime.listVisibleFacilityHoverEntries()[0];
  h.runtime.applyFacilityInfoCardState(oldEntry, { x: 70, y: 90 });
  h.hoverOwner.setHoveredFacilityEntry(oldEntry);
  h.runtime.setVisibleFacilityHoverEntries("airport", [{ ...first, name: "new" }]);
  const refreshed = h.runtime.listVisibleFacilityHoverEntries()[0];
  assert.notStrictEqual(refreshed, oldEntry);
  assert.equal(refreshed.name, "new");
  assert.strictEqual(h.runtime.getSelectedFacilityEntry(), refreshed);
  assert.strictEqual(h.hoverOwner.getHoveredFacilityEntry(), refreshed);
  assert.strictEqual(h.runtime.getActiveFacilityHighlightEntry(), refreshed);
  assert.strictEqual(h.cards.at(-1).entry, refreshed);
  assert.deepEqual(h.cards.at(-1).previousAnchor, { x: 70, y: 90 });
  assert.deepEqual(h.dirty, [true, true]);
});

test("refresh clears selected and hovered identities when their pack disappears", t => {
  const h = createHarness(t);
  const entry = { familyId: "port", stableId: "port-1", packId: "regional" };
  h.runtime.setVisibleFacilityHoverEntries("port", [entry]);
  h.runtime.applyFacilityInfoCardState(entry);
  h.hoverOwner.setHoveredFacilityEntry(entry);
  h.runtime.setVisibleFacilityHoverEntries("port", [{ ...entry, packId: "global" }]);
  assert.equal(h.runtime.getSelectedFacilityEntry(), null);
  assert.equal(h.hoverOwner.getHoveredFacilityEntry(), null);
  assert.equal(h.runtime.getActiveFacilityHighlightEntry(), null);
  assert.equal(h.cards.at(-1).entry, null);
  assert.equal(h.cards.at(-1).previousAnchor, null);
  assert.equal(h.cards.at(-1).expanded, false);
});

test("visible entries deduplicate semantic identities and prefer regional packs", t => {
  const h = createHarness(t);
  const base = { familyId: "airport", stableId: "same", packId: "global" };
  h.runtime.setVisibleFacilityHoverEntries("airport", [base, { ...base, name: "latest global" }]);
  assert.equal(h.runtime.listVisibleFacilityHoverEntries().length, 1);
  assert.equal(h.runtime.listVisibleFacilityHoverEntries()[0].name, "latest global");
  h.runtime.setVisibleFacilityHoverEntries("airport", [{ ...base, packId: " Regional ", name: "regional" }], { append: true });
  h.runtime.setVisibleFacilityHoverEntries("airport", [base], { append: true });
  assert.deepEqual(h.runtime.listVisibleFacilityHoverEntries(), [{ ...base, packId: "regional", name: "regional" }]);
  h.runtime.setVisibleFacilityHoverEntries("rail", [
    { familyId: "rail", coordinates: [1, 2], packId: "global" },
    { familyId: "rail", coordinates: [1, 2], packId: "regional" },
  ]);
  assert.equal(h.runtime.listVisibleFacilityHoverEntries().length, 2);
  assert.equal(h.runtime.listVisibleFacilityHoverEntries()[1].packId, "regional");
});

test("card bindings retain expansion and anchor until close, without duplicate listeners", t => {
  const h = createHarness(t);
  h.runtime.bindInfoCard();
  h.runtime.bindInfoCard();
  assert.equal(h.nodes.get("facilityInfoCardMoreBtn").listeners.length, 1);
  assert.equal(h.nodes.get("facilityInfoCardCloseBtn").listeners.length, 1);
  const entry = { familyId: "airport", stableId: "airport-1" };
  h.runtime.applyFacilityInfoCardState(entry, { x: 50, y: 60 });
  h.nodes.get("facilityInfoCardMoreBtn").click();
  assert.equal(h.cards.at(-1).expanded, true);
  h.runtimeState.updateFacilityInfoCardUiFn();
  assert.equal(h.cards.at(-1).expanded, true);
  assert.deepEqual(h.cards.at(-1).previousAnchor, { x: 50, y: 60 });
  h.nodes.get("facilityInfoCardCloseBtn").click();
  assert.equal(h.runtime.getSelectedFacilityEntry(), null);
  assert.equal(h.cards.at(-1).expanded, false);
  assert.equal(h.cards.at(-1).previousAnchor, null);
  assert.deepEqual(h.overlays, [{ eventType: "facility-card-close" }]);
  h.runtime.applyFacilityInfoCardState(entry);
  assert.deepEqual(h.cards.at(-1).previousAnchor, { x: 24, y: 24 });
});
