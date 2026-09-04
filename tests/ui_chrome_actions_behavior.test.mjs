import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureUiChromeState,
  patchUiChromeState,
  setActiveDockPopoverState,
  setRestoredSupportSurfaceViewState,
} from "../js/core/state/actions/ui_chrome_actions.js";

test("ui chrome actions preserve the ui root and write only admitted fields", () => {
  const ui = {
    dockCollapsed: 1,
    tutorialEntryVisible: 0,
    paletteLibrarySections: { recent: 1 },
    retained: "owner-private",
  };
  const target = { ui };

  assert.equal(ensureUiChromeState(target), ui);
  assert.equal(target.ui.dockCollapsed, true);
  assert.equal(target.ui.tutorialEntryVisible, false);

  const sections = { regional: true };
  assert.equal(patchUiChromeState(target, {
    scenarioBarCollapsed: 1,
    responsiveChromeTier: " compact ",
    paletteLibrarySections: sections,
    unownedField: "drop",
  }), ui);
  assert.equal(target.ui.scenarioBarCollapsed, true);
  assert.equal(target.ui.responsiveChromeTier, "compact");
  assert.deepEqual(target.ui.paletteLibrarySections, { regional: true });
  assert.notEqual(target.ui.paletteLibrarySections, sections);
  assert.equal(Object.hasOwn(target.ui, "unownedField"), false);
  assert.equal(target.ui.retained, "owner-private");
});

test("ui chrome scalar actions normalize support-surface and popover values", () => {
  const target = {};

  assert.equal(setActiveDockPopoverState(target, " reference "), "reference");
  assert.equal(setRestoredSupportSurfaceViewState(target, " export "), "export");
  assert.equal(target.activeDockPopover, "reference");
  assert.equal(target.ui.restoredSupportSurfaceViewFromUrl, "export");
});

test("ui chrome actions install owner-local ui containers", () => {
  const sharedSections = { recent: true };
  const sharedUi = { paletteLibrarySections: sharedSections };
  const prototypeState = { ui: sharedUi };
  const first = Object.create(prototypeState);
  const second = Object.create(prototypeState);

  patchUiChromeState(first, { dockCollapsed: true });
  patchUiChromeState(second, {
    paletteLibrarySections: { regional: true },
  });

  assert.equal(Object.hasOwn(first, "ui"), true);
  assert.equal(Object.hasOwn(second, "ui"), true);
  assert.notEqual(first.ui, sharedUi);
  assert.notEqual(second.ui, sharedUi);
  assert.notEqual(first.ui, second.ui);
  assert.notEqual(first.ui.paletteLibrarySections, sharedSections);
  assert.equal(first.ui.dockCollapsed, true);
  assert.deepEqual(second.ui.paletteLibrarySections, { regional: true });
  assert.deepEqual(sharedUi, { paletteLibrarySections: { recent: true } });
});

test("ui chrome actions bypass inherited ui and field setters", () => {
  const setterCalls = { dockCollapsed: 0, ui: 0 };
  const uiPrototype = {};
  Object.defineProperty(uiPrototype, "dockCollapsed", {
    configurable: true,
    get: () => false,
    set: () => { setterCalls.dockCollapsed += 1; },
  });
  const inheritedUi = Object.create(uiPrototype);
  const targetPrototype = {};
  Object.defineProperty(targetPrototype, "ui", {
    configurable: true,
    get: () => inheritedUi,
    set: () => { setterCalls.ui += 1; },
  });
  const target = Object.create(targetPrototype);

  patchUiChromeState(target, { dockCollapsed: true });

  assert.deepEqual(setterCalls, { dockCollapsed: 0, ui: 0 });
  assert.equal(Object.hasOwn(target, "ui"), true);
  assert.equal(Object.hasOwn(target.ui, "dockCollapsed"), true);
  assert.equal(target.ui.dockCollapsed, true);
});
