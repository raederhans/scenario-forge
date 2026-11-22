import assert from "node:assert/strict";
import test from "node:test";
import { createSelectionMarqueeOwner } from "../js/core/renderer/selection_marquee_owner.js";
import { addFeaturesToDevSelection, fillSelectedParcels, getDevSelectionCountryOptions, toggleFeatureInDevSelection } from "../js/core/map_renderer/public.js";
import { state } from "../js/core/state.js";
import { registerRuntimeHook } from "../js/core/state/index.js";
import { undoHistory } from "../js/core/history_manager.js";

function harness(t, result = ["new"]) {
  const selected = new Set(["old"]);
  const shapes = [];
  const paths = [];
  const frames = new Map();
  let focus, captured, suppressed = false, warnings = 0;
  t.mock.method(globalThis, "requestAnimationFrame", fn => { frames.set(1, fn); return 1; });
  t.mock.method(globalThis, "cancelAnimationFrame", id => frames.delete(id));
  const node = {
    setPointerCapture(id) { captured = id; }, hasPointerCapture: id => captured === id,
    releasePointerCapture() { captured = null; },
  };
  const settings = { currentTool: "select", zoomTransform: { x: 10, y: 20, k: 2 }, startupReadonly: true };
  const owner = createSelectionMarqueeOwner({
    state: settings, isPointPickActive: s => s.mapPointPicker?.active,
    getScreenPoint: e => [e.clientX, e.clientY],
    surfaceHost: {
      getMapContainer: () => ({ focus: options => { focus = options; } }),
      getInteractionRect: () => ({ node: () => node }),
      getSelectionMarqueeGroup: () => ({ append: () => ({
        attr(key, value) { if (key === "d") paths.push(value); return this; }, remove() { paths.length = 0; },
      }) }),
    },
    query: shape => { shapes.push(shape); return result; },
    add: ids => ids.forEach(id => selected.add(id)),
    suppressNextClick: () => { suppressed = true; }, warnIndexUnavailable: () => { warnings++; },
  });
  const event = (clientX, clientY, extra = {}) => ({
    clientX, clientY, type: "pointerup", ctrlKey: true, button: 0, pointerId: 1, pointerType: "mouse",
    preventDefault() { this.prevented = true; }, ...extra,
  });
  return { owner, selected, shapes, paths, frames, settings, event,
    status: () => ({ focus, captured, suppressed, warnings }) };
}

// Node has no animation frame clock.
globalThis.requestAnimationFrame = () => {};
globalThis.cancelAnimationFrame = () => {};

test("Ctrl drag captures and focuses, coalesces the preview and adds a projected rectangle even in startup readonly", t => {
  const h = harness(t);
  const press = h.event(14, 22);
  assert.ok(h.owner.down(press));
  assert.equal(press.prevented, true);
  assert.deepEqual(h.status().focus, { preventScroll: true });
  assert.equal(h.status().captured, 1);
  h.owner.move(h.event(20, 23));
  h.owner.move(h.event(30, 32));
  const wheel = h.event(30, 32, { type: "wheel" });
  assert.equal(h.owner.blocksZoom(wheel), true);
  assert.equal(wheel.prevented, true);
  assert.equal(h.frames.size, 1);
  h.frames.get(1)();
  assert.deepEqual(h.paths, ["M14,22H30V32H14Z"]);
  h.owner.end(h.event(32, 34));
  assert.deepEqual(h.shapes, [{ type: "rect", points: [[2, 1], [11, 7]] }]);
  assert.deepEqual([...h.selected], ["old", "new"]);
  assert.equal(h.status().suppressed, true);
  assert.equal(h.owner.blocksZoom(wheel), false);
  assert.deepEqual(h.paths, []);
});

test("movement of four pixels preserves the click and mode conflicts never capture", t => {
  const h = harness(t);
  for (const modifiers of [{ ctrlKey: false }, { ctrlKey: false, shiftKey: true }, { button: 2 },
    { pointerType: "touch" }, { pointerType: "pen" }]) assert.equal(h.owner.down(h.event(0, 0, modifiers)), false);
  for (const change of [{ currentTool: "fill" }, { mapPointPicker: { active: true } }, { intensityFieldTool: { active: true } },
    ...["mapLabelEditor", "unitCounterEditor", "operationalLineEditor", "operationGraphicsEditor", "specialZoneEditor"]
      .map(key => ({ [key]: { active: true } }))]) {
    Object.assign(h.settings, change);
    assert.equal(h.owner.down(h.event(0, 0)), false);
    delete h.settings[Object.keys(change)[0]];
    h.settings.currentTool = "select";
  }
  h.owner.down(h.event(0, 0));
  h.owner.move(h.event(4, 0));
  assert.ok(h.owner.end(h.event(4, 0)));
  assert.deepEqual(h.shapes, []);
  assert.equal(h.status().suppressed, false);
});

test("Cmd+Shift lasso samples spaced points and remains bounded during long drags", t => {
  const h = harness(t);
  h.owner.down(h.event(10, 20, { ctrlKey: false, metaKey: true, shiftKey: true }));
  for (let i = 1; i <= 6500; i++) h.owner.move(h.event(10 + i, 20));
  h.owner.end(h.event(6510, 28));
  const [{ type, points }] = h.shapes;
  assert.equal(type, "lasso");
  assert.ok(points.length <= 2000);
  assert.deepEqual(points[0], [0, 0]);
  assert.deepEqual(points.at(-1), [3250, 4]);
  assert.ok(points.slice(1).every(([x, y], i) => Math.hypot(x - points[i][0], y - points[i][1]) >= 1.5));
});

test("cancellation discards a drag and a missing index warns without changing selection", t => {
  const h = harness(t, null);
  for (const type of ["pointercancel", "lostpointercapture", "blur"]) {
    h.owner.down(h.event(0, 0));
    h.owner.move(h.event(12, 8));
    assert.equal(h.owner.cancel(h.event(12, 8, { pointerId: 2 })), false);
    assert.ok(type === "blur" ? h.owner.cancel() : h.owner.end(h.event(12, 8, { type })));
    assert.deepEqual(h.shapes, []);
    assert.equal(h.frames.size, 0);
    assert.equal(h.status().captured, null);
    assert.deepEqual([...h.selected], ["old"]);
  }
  h.owner.down(h.event(0, 0));
  h.owner.end(h.event(8, 9));
  assert.equal(h.status().warnings, 1);
  assert.deepEqual([...h.selected], ["old"]);
});

test("batch and single selection share one limit, notification and renderable selection order", () => {
  const ids = Array.from({ length: 2002 }, (_, i) => String(i));
  state.landIndex = new Map(ids.map(id => [id, { properties: { id, cntr_code: "FR" } }]));
  assert.equal(state.devSelectionLimit, 2000);
  const toasts = [];
  let updates = 0;
  registerRuntimeHook(state, "showToastFn", message => toasts.push(message));
  registerRuntimeHook(state, "refreshCountryListRowsFn", () => { updates++; });
  assert.equal(toggleFeatureInDevSelection("0"), true);
  assert.equal(addFeaturesToDevSelection(["0", "1", "1", ...ids]), 1999);
  assert.equal(updates, 2);
  assert.equal(toasts.length, 1);
  assert.deepEqual(state.devSelectionOrder, ids.slice(0, 2000));
  assert.equal(toggleFeatureInDevSelection("2000"), false);
  assert.equal(toasts.length, 2);
  assert.equal(updates, 2);
  assert.equal(toggleFeatureInDevSelection("1"), true);
  assert.equal(addFeaturesToDevSelection(["2001"]), 1);
  assert.equal(state.devSelectionOrder.at(-1), "2001");
});

test("parcel fill accepts click events or explicit colors, reports skipped parcels and uses one undo", () => {
  globalThis.document = { getElementById: () => null };
  Object.assign(state, {
    devSelectionOrder: ["a", "b", "unloaded"], devSelectionFeatureIds: new Set(["a", "b", "unloaded"]),
    landIndex: new Map(["a", "b"].map(id => [id, { properties: { id, cntr_code: "FR" } }])),
    selectedColor: "#123456", visualOverrides: {}, startupReadonly: false, onlyUnpainted: false,
    detailPromotionInFlight: true, historyPast: [], historyFuture: [],
  });
  const toasts = [];
  registerRuntimeHook(state, "showToastFn", message => toasts.push(message));
  const click = Object.assign(new Event("click"), { color: "#ff0000" });
  assert.deepEqual(fillSelectedParcels(click), { changed: 2, skipped: 1 });
  assert.deepEqual(state.visualOverrides, { a: "#123456", b: "#123456" });
  assert.ok(toasts[0].includes("loading"));
  assert.equal(state.historyPast.length, 1);
  undoHistory();
  assert.deepEqual(fillSelectedParcels(), { changed: 2, skipped: 0 });
  assert.deepEqual(state.visualOverrides, { a: "#123456", b: "#123456" });
  state.onlyUnpainted = true;
  assert.deepEqual(fillSelectedParcels({ color: "#abcdef" }), { changed: 0, skipped: 2 });
  assert.ok(toasts.at(-1).includes("skipped"));
  state.onlyUnpainted = false;
  state.startupReadonly = true;
  assert.deepEqual(fillSelectedParcels({ color: "#abcdef" }), { changed: 0, skipped: 2 });
  state.startupReadonly = false;
  assert.deepEqual(fillSelectedParcels({ color: "#abcdef" }), { changed: 2, skipped: 0 });
  assert.deepEqual(state.visualOverrides, { a: "#abcdef", b: "#abcdef" });
  assert.deepEqual(fillSelectedParcels({ color: "#abcdef" }), { changed: 0, skipped: 2 });
});

test("country options include registered project countries and only scenario tags with base colors", () => {
  state.scenarioCountriesByTag = { FR: {}, ZZ: {}, P01: { project_country: true, display_name: "My country" } };
  state.sovereignBaseColors = { FR: "#123456", P01: "#123456", FRA: "#987654" };
  assert.deepEqual(getDevSelectionCountryOptions().map(({ tag, color }) => [tag, color]),
    [["FR", "#123456"], ["P01", "#123456"]]);
});
