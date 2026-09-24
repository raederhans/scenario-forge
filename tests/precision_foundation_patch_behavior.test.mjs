import test from "node:test";
import assert from "node:assert/strict";
import { planPoliticalRasterPatch } from "../js/core/renderer/political_raster_patch_plan.js";

function fixture() {
  const entries = Array.from({ length: 1000 }, (_, index) => ({ id: String(index), feature: { geometry: {} },
    fillColor: "red", strokeColor: "red", lineWidth: 1, geometryIdentity: index,
    bounds: { minX: index % 40 * 10, maxX: index % 40 * 10 + 10,
      minY: Math.floor(index / 40) * 10, maxY: Math.floor(index / 40) * 10 + 10 } }));
  const previous = { patchKey: "stable", entries };
  const current = entries.map((entry, index) => index < 93 ? { ...entry, fillColor: "blue", strokeColor: "blue" } : entry);
  const description = { patchKey: "stable", width: 400, height: 250 };
  return { previous, current, description, bounds: entry => entry.bounds };
}
test("93-feature update admits a bounded patch without raising the synchronous threshold", () => {
  const f = fixture(), plan = planPoliticalRasterPatch(f.previous, f.current, f.description, f.bounds);
  assert.equal(plan.changedCount, 93); assert.ok(plan.drawEntryIds.length < 1000);
  assert.ok(plan.coverage <= 0.18); assert.deepEqual(plan.region, { x: 0, y: 0, width: 400, height: 30 });
  assert.ok(plan.drawEntryIds.includes("120"), "unchanged boundary contributors retain painter order");
  assert.deepEqual(plan.drawEntryIds, [...plan.drawEntryIds].sort((a, b) => Number(a) - Number(b)));
});
test("no partial geometry, order, transform, layout or revision reuse", () => {
  for (const change of [
    f => f.description.patchKey = "new-view",
    f => f.current[0] = { ...f.current[0], feature: { geometry: {} } },
    f => f.current[0] = { ...f.current[0], geometryIdentity: 99999 },
    f => f.current.reverse(),
    f => f.current.pop(),
    f => f.current[0] = { ...f.current[0], lineWidth: 2 },
  ]) {
    const f = fixture(); change(f);
    assert.equal(planPoliticalRasterPatch(f.previous, f.current, f.description, f.bounds), null);
  }
});
test("unknown bounds, excessive area and transient memory fail back to full rendering", () => {
  const f = fixture();
  assert.equal(planPoliticalRasterPatch(f.previous, f.current, f.description, () => null), null);
  assert.equal(planPoliticalRasterPatch(f.previous, f.current, f.description, f.bounds, { maxCoverage: 0.01 }), null);
  assert.equal(planPoliticalRasterPatch(f.previous, f.current, f.description, f.bounds, { maxTransientBytes: 1 }), null);
});
test("patch rectangle is clamped and snapped to physical pixels", () => {
  const f = fixture();
  f.current[0] = { ...f.current[0], bounds: { minX: -2.2, minY: -3.1, maxX: 10.2, maxY: 10.1 } };
  const plan = planPoliticalRasterPatch(f.previous, f.current, f.description, f.bounds);
  assert.equal(plan.region.x, 0); assert.equal(plan.region.y, 0);
});
