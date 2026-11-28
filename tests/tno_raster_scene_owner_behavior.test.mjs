import { createDeferredPromise } from "./helpers/deferred_promise.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createTnoRasterSceneOwner } from "../js/core/renderer/tno_raster_scene_owner.js";

function coverageHarness(dpr = 2) {
  const h = harness(), transform = { x: 0, y: 0, k: 1 };
  h.setDpr(dpr);
  h.map.width = 100 * dpr; h.map.height = 50 * dpr;
  const tile = { originX: 0, originY: 0, width: h.map.width, height: h.map.height };
  Object.assign(h.currentFrame, { transform, dpr, layout: { offsetX: 0, offsetY: 0 },
    plan: { ...tile, scale: 1, outputX: 0, outputY: 0, outputWidth: tile.width, outputHeight: tile.height, tiles: [tile] } });
  for (const pass of h.passes.values()) Object.assign(pass, {
    reference: transform, layout: { offsetX: 0, offsetY: 0 }, canvas: { width: tile.width, height: tile.height },
  });
  return { ...h, transform };
}

test("failed candidate preparation preserves the published frame", async () => {
  const h = coverageHarness();
  const pending = createDeferredPromise();
  h.helpers.getPreparationIdentity = () => "candidate";
  h.helpers.getSceneIdentity = () => "scene";
  h.helpers.getCurrentTransform = () => h.transform;
  h.compositor.prepareLayers = () => pending.promise;
  assert.equal(h.owner.present(h.transform), true);
  assert.equal(h.owner.preparePublication(h.transform), false);
  pending.reject(new Error("original asynchronous failure"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.owner.getDiagnostics().preparationError, "original asynchronous failure");
  assert.equal(h.owner.present(h.transform, { refresh: false }), true);
  h.owner.dispose();
});

test("partial gesture coverage follows device-pixel geometry and unions shared pass gaps", () => {
  for (const dpr of [1, 1.25, 2]) {
    const h = coverageHarness(dpr);
    h.map.height = 100 * dpr;
    h.currentFrame.plan.height = h.currentFrame.plan.outputHeight = 100 * dpr;
    h.currentFrame.plan.tiles[0].height = 100 * dpr;
    for (const pass of h.passes.values()) pass.canvas.height = 100 * dpr;
    assert.equal(h.owner.present(h.transform), true);
    assert.equal(h.owner.present({ ...h.transform, x: 25, y: 10 }, { refresh: false, allowPartialPasses: true }), true);
    const diagnostics = h.owner.getDiagnostics();
    const expected = (100 * 100 - 75 * 90) / (100 * 100);
    assert.equal(diagnostics.politicalUncoveredRatio, expected);
    assert.deepEqual(diagnostics.passUncoveredRatios, { base: expected, political: expected, labels: expected });
    assert.ok(Math.abs(diagnostics.sceneIncompleteRatio - expected) < 1e-12);
    assert.equal(h.owner.present({ ...h.transform, x: 25, y: 10 }, { refresh: false, holdPartialUntilExact: true }), false);
    assert.equal(h.owner.getDiagnostics().politicalUncoveredRatio, expected);
    h.owner.dispose();
  }
});

test("committed tile holes remain missing while transparent valid tiles count as covered", () => {
  const h = coverageHarness();
  h.currentFrame.plan.tiles = [
    { originX: 0, originY: 0, width: 200, height: 20 },
    { originX: 0, originY: 80, width: 200, height: 20 },
    { originX: 0, originY: 20, width: 20, height: 60 },
    { originX: 180, originY: 20, width: 20, height: 60 },
  ];
  assert.equal(h.owner.present(h.transform), true);
  assert.equal(h.owner.getDiagnostics().politicalUncoveredRatio, 0.48);
  assert.equal(h.owner.getDiagnostics().sceneIncompleteRatio, 0.48);
  h.currentFrame.plan.tiles.push({ originX: 20, originY: 20, width: 160, height: 60, codes: new Uint32Array(160 * 60) });
  assert.equal(h.owner.present(h.transform), true);
  assert.equal(h.owner.getDiagnostics().politicalUncoveredRatio, 0);
  assert.equal(h.owner.getDiagnostics().sceneIncompleteRatio, 0);
  h.owner.dispose();
});

function harness() {
  const parent = { children: [], insertBefore(child, next) {
    const index = next ? this.children.indexOf(next) : this.children.length;
    this.children.splice(index, 0, child); child.parentNode = this;
  } };
  const doc = { defaultView: { getComputedStyle: () => ({ zIndex: "3" }) }, createElement() {
    return { width: 0, height: 0, style: {}, setAttribute() {}, remove() {
      const index = parent.children.indexOf(this);
      if (index >= 0) parent.children.splice(index, 1);
    } };
  } };
  const overlay = { style: { visibility: "visible" } };
  const map = { width: 200, height: 100, ownerDocument: doc, parentNode: parent, style: { visibility: "visible", zIndex: "" }, nextSibling: overlay };
  parent.children.push(map, overlay);
  const reference = { k: 2, x: 10, y: 20 };
  const passes = new Map(["base", "labels"].map(name => [name, { canvas: { width: 240, height: 180 }, reference, layout: { offsetX: 10, offsetY: 20 } }]));
  let currentFrame, dpr = 2;
  const helpers = {
    getActivePassNames: () => ["base", "political", "labels"],
    getPassCanvas: name => passes.get(name)?.canvas,
    getPassReferenceTransform: name => passes.get(name)?.reference,
    getPassLayout: name => passes.get(name)?.layout,
    getDirectFrame: () => currentFrame, getDpr: () => dpr,
  };
  const compositor = {
    gl: {}, isAvailable: () => true, setTextureBudget() {},
    render: () => true, getStats: () => ({}), dispose() {},
  };
  const owner = createTnoRasterSceneOwner({
    surface: { getMapCanvas: () => map },
    helpers,
    createCompositor: () => compositor,
    createGpu: () => ({ isAvailable: () => true, getStats: () => ({}), drawLayer() {} }),
  });
  const gpu = owner.ensureGpu({ onContextLost() {} });
  currentFrame = { gpu, transform: reference, dpr: 2, layout: { offsetX: 10, offsetY: 20 },
    plan: { originX: -100, originY: -100, width: 400, height: 300, scale: 1,
      outputX: -40, outputY: -20, outputWidth: 400, outputHeight: 300 } };
  return { owner, helpers, compositor, map, passes, currentFrame, setDpr: value => dpr = value };
}
