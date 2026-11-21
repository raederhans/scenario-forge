import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { createClickSelectionTransactionOwner } from "../js/core/map_renderer/click_selection_transaction_owner.js";
import { createStrategicOverlayRuntimeOwner } from "../js/core/renderer/strategic_overlay_runtime_owner.js";
import { createBorderIdentityResolver } from "../js/core/renderer/border_identity.js";
import { placeMapLabel } from "../js/core/renderer/strategic_overlay_runtime/map_label_runtime_domain.js";
import { renderMapLabelHandles, syncMapLabelHandles } from "../js/core/renderer/map_label_handles_owner.js";
import { bindRenderBoundary, markRenderBoundaryFlushed } from "../js/core/render_boundary.js";
import { createRenderPassSignaturePolicy } from "../js/core/renderer/render_pass_signature_policy.js";
import { CHINESE_FONT } from "../js/core/renderer/country_label_text_style.js";
import { bindMapLabelPanel } from "../js/ui/sidebar/strategic_overlay_controller.js";

test("placement consumes the map click, leaves notes unbound and respects readonly and cancellation", async () => {
  state.landData = { features: [] };
  state.landIndex = new Map([["land", {}]]);
  state.sovereignBaseColors = { GER: "#123456" };
  state.scenarioCountriesByTag = { GER: { display_name_en: "Germany" } };
  state.activeScenarioId = "example";
  state.mapLabels = [];
  state.zoomTransform = { x: 0, y: 0, k: 2 };
  state.visualOverrides = { land: "#123456" };
  let hit = { targetType: "land", id: "land" };
  const runtime = createStrategicOverlayRuntimeOwner({ state, helpers: {
    getMapLonLatFromEvent: () => [2, 3], getHitFromEvent: () => hit,
    resolveBorderIdentity: createBorderIdentityResolver({
      sovereignBaseColors: state.sovereignBaseColors, getReferenceOwner: () => "OTH",
      getOverrideColor: id => state.visualOverrides[id],
    }),
  } });
  const noop = () => {};
  const ports = obj => new Proxy(obj, { get: (target, key) => target[key] || noop });
  const click = createClickSelectionTransactionOwner({
    constants: { clickSnapRadiusPx: 0 }, getters: { getClickState: () => state, getSelectedFacilityEntry: noop },
    effects: ports({}), services: ports({
      getIntensityFieldTool: () => ({ active: false }), placeMapLabelFromEvent: runtime.placeMapLabelFromEvent,
      commitVisualFeaturePaint: () => assert.fail("placement reached fill"),
    }),
  });
  state.mapLabelEditor.active = true;
  state.currentTool = "select";
  state.startupReadonly = true;
  await click.handleClick({});
  assert.equal(state.mapLabels.length, 0);
  assert.equal(runtime.cancelActiveStrategicInteractionModes(), true);
  assert.equal(state.mapLabelEditor.active, false);
  state.startupReadonly = false;
  state.currentTool = "fill";
  for (const [scenario, color, targetType] of [
    ["example", "#123456", "land"], ["example", "#fedcba", "land"],
    ["example", "#123456", "water"], ["", "#123456", "land"], ["", "#fedcba", "land"],
  ]) {
    state.activeScenarioId = scenario;
    if (!scenario) state.scenarioCountriesByTag = {};
    state.visualOverrides = { land: color };
    hit = { id: "land", targetType };
    state.mapLabelEditor.active = true;
    const count = state.mapLabels.length;
    await click.handleClick({});
    assert.equal(state.mapLabels.length, count + 1);
    const label = state.mapLabels.at(-1);
    assert.equal(label.countryCode, "");
    assert.equal(label.text, "");
    assert.equal(label.size, 9);
    assert.deepEqual(state.visualOverrides, { land: color });
    assert.deepEqual([state.mapLabelEditor.selectedId, state.mapLabelEditor.active], [label.id, false]);
  }
});

test("panel edits commit once per field and Delete removes the selection", () => {
  state.strategicOverlayUi.modalOpen = true;
  state.strategicOverlayUi.modalSection = "label";
  const id = placeMapLabel({ lon: 1, lat: 2 });
  const fields = Object.entries({ text: "textarea", countryCode: "select", size: "range",
    rotation: "range", tracking: "range", colorMode: "select" }).map(([key, type]) =>
    Object.assign(new EventTarget(), { dataset: { labelField: key }, type }));
  const doc = new EventTarget();
  bindMapLabelPanel({
    section: { ownerDocument: doc, querySelector: () => new EventTarget(), querySelectorAll: () => fields },
    state, countryName: () => "Germany", startPlacement() {}, refresh() {},
  });
  const values = ["First\nSecond", "GER", 24, -30, 0.2, "light"];
  fields.forEach((field, index) => {
    const before = state.historyPast.length;
    field.value = String(values[index]);
    field.dispatchEvent(new Event("input"));
    assert.equal(state.historyPast.length, before);
    field.dispatchEvent(new Event(index === 0 ? "blur" : "change"));
    assert.equal(state.mapLabels.find(label => label.id === id)[field.dataset.labelField], values[index]);
    assert.equal(state.historyPast.length, before + 1);
  });
  doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "Delete" }));
  assert.equal(state.mapLabels.some(label => label.id === id), false);
  assert.equal(state.historyPast.at(-1).kind, "delete-map-label");
});

test("label handles intercept input only while editing or placing", () => {
  const group = { style: {}, children: [] };
  for (const [modalOpen, modalSection, active, expected] of [
    [false, "label", false, "none"], [true, "line", false, "none"],
    [true, "label", false, "all"], [false, "line", true, "all"],
  ]) {
    syncMapLabelHandles(group, { strategicOverlayUi: { modalOpen, modalSection }, mapLabelEditor: { active } });
    assert.equal(group.style.pointerEvents, expected);
  }
});

class SvgNode extends EventTarget {
  children = [];
  dataset = {};
  style = {};
  attrs = {};
  constructor(doc, tag) { super(); this.ownerDocument = doc; this.tag = tag; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  appendChild(child) { child.parentNode = this; this.children.push(child); }
  remove() { this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
  setPointerCapture(id) { this.captured = id; }
  hasPointerCapture(id) { return this.captured === id; }
  releasePointerCapture() { this.captured = null; }
}

for (const gesture of ["drop", "escape", "click"]) {
  test(`map label drag: ${gesture}`, context => {
    const doc = new EventTarget();
    doc.createElementNS = (_, tag) => new SvgNode(doc, tag);
    const group = new SvgNode(doc, "g");
    state.mapLabels = [];
    state.mapLabelEditor.active = false;
    state.zoomTransform = { k: 3, x: 10, y: 20 };
    const id = placeMapLabel({ lon: 2, lat: 4, text: "北\n南", size: 5, rotation: -24 });
    state.mapLabelEditor.selectedId = null;
    const original = state.mapLabels;
    const before = state.historyPast.length;
    const projection = ([lon, lat]) => [lon * 2, lat * 2];
    projection.invert = ([x, y]) => [x / 2, y / 2];
    const draw = () => renderMapLabelHandles({ group, state, k: 3, projection,
      placed: [{ id, bounds: state.mapLabelEditor.draggingId ? null : { x: 22, y: 44, w: 30, h: 30 } }],
      pointer: e => [(e.clientX - 10) / 3, (e.clientY - 20) / 3],
    });
    const policy = createRenderPassSignaturePolicy(state, {
      stableJson: JSON.stringify, getTransformSignature: JSON.stringify, shouldEnableContextBaseTransformReuse: () => false,
    });
    const signature = () => policy.getRenderPassSignature("labels");
    let lastSignature = signature(), invalidations = 0, scheduled = 0;
    bindRenderBoundary({ scheduleRender() { scheduled++; } });
    context.after(() => bindRenderBoundary());
    const frame = () => {
      const next = signature();
      if (next !== lastSignature) { invalidations++; lastSignature = next; draw(); }
      markRenderBoundaryFlushed();
    };
    const event = (type, x, y) => Object.assign(new Event(type), { pointerId: 1, button: 0, clientX: x, clientY: y });
    draw();
    const rect = group.children[0];
    rect.onpointerdown(event("pointerdown", 22, 44));
    frame();
    assert.equal(state.mapLabelEditor.draggingId, id);
    assert.equal(state.mapLabelEditor.selectedId, id);
    const preview = group.children[1];
    assert.equal(preview.tag, "text");
    assert.equal(preview.attrs["font-family"], CHINESE_FONT);
    assert.equal(Number(preview.attrs["font-size"]) * state.zoomTransform.k, 15);
    assert.deepEqual(preview.children.map(span => span.textContent), ["北", "南"]);
    assert.equal(preview.attrs.transform, "translate(4 8) rotate(-24)");
    if (gesture !== "click") {
      for (const x of [37, 55, 70]) {
        rect.dispatchEvent(event("pointermove", x, 80));
        frame();
        assert.equal(preview.attrs.transform, `translate(${(x - 10) / 3} 20) rotate(-24)`);
        assert.equal(state.mapLabels, original);
        assert.deepEqual([original[0].lon, original[0].lat], [2, 4]);
        assert.equal(state.historyPast.length, before);
        assert.deepEqual([invalidations, scheduled], [1, 1]);
      }
    }
    if (gesture === "escape") doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    rect.dispatchEvent(gesture === "click" ? event("pointerup", 22, 44) : event("pointerup", 70, 80));
    frame();
    assert.deepEqual([invalidations, scheduled], [2, 2]);
    assert.equal(state.mapLabelEditor.draggingId, null);
    assert.deepEqual(group.children, [rect]);
    assert.equal(rect.hasPointerCapture(1), false);
    if (gesture === "drop") {
      assert.deepEqual([state.mapLabels[0].lon, state.mapLabels[0].lat], [10, 10]);
      assert.deepEqual(state.historyPast.slice(before).map(entry => entry.kind), ["move-map-label"]);
    } else {
      assert.equal(state.mapLabels, original);
      assert.equal(state.historyPast.length, before);
    }
  });
}
