import test from "node:test";
import assert from "node:assert/strict";
import { createPhysicalContourVisibleSetOwner } from "../js/core/renderer/physical_contour_visible_set_owner.js";

const viewport = Object.freeze({
  width: 1000, height: 600, topologyRevision: 1, zoomBucket: "near",
  transformSignature: "0|0|2|1000|600|1", viewportSignature: "1000|600|1",
});
const box = (span = 20, x = 0, y = 0) => ({
  minX: x, minY: y, maxX: x + span, maxY: y + span, width: span, height: span,
});
const feature = (id, elevation = 200, type = "LineString") => Object.freeze({
  id, properties: Object.freeze({ elevation_m: elevation }), geometry: Object.freeze({ type }),
});
const collection = (...features) => Object.freeze({ features: Object.freeze(features) });

function harness(bounds = () => box()) {
  const owner = createPhysicalContourVisibleSetOwner({
    overscanPx: 96,
    getFeatureScreenBounds: bounds,
  });
  return { owner };
}

test("selection preserves source identities/order and filters before querying bounds", () => {
  const low = feature("low", 50), major = feature("major", 1000);
  const a = feature("a", 200), b = feature("b", 400), offInterval = feature("off-interval", 300);
  const outside = feature("outside", 600), tiny = feature("tiny", 800);
  const source = collection(low, a, major, b, offInterval, outside, tiny);
  const { owner } = harness((item) => item === outside ? box(20, 1100) : box(item === tiny ? 2 : 20));
  const selected = owner.select(source, { lowReliefCutoff: 100, intervalM: 200, excludeIntervalM: 1000, minScreenSpanPx: 10 }, viewport);
  assert.deepEqual(selected, [a, b]);
  assert.equal(selected[0], a);
});

test("failed projection does not publish partial selections or poison later attempts", () => {
  let fail = true;
  const source = collection(feature("a"), feature("b"));
  const { owner } = harness((item) => {
    if (item.id === "b" && fail) throw new Error("projection failure");
    return box();
  });
  assert.throws(() => owner.select(source, {}, viewport), /projection failure/);
  fail = false;
  assert.deepEqual(owner.select(source, {}, viewport), source.features);
});
