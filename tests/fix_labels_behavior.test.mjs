import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createCountryLabelRenderOwner } from "../js/core/renderer/country_label_render_owner.js";

const { geoStream } = createRequire(import.meta.url)("../vendor/d3.v7.min.js");

test("country size scales a multiline title's glyph origins and collision boxes around its center", () => {
  const name = "中华人民共和国";
  const geometry = { type: "Polygon", coordinates: [[[50, 50], [150, 50], [150, 130], [50, 130], [50, 50]]] };
  const source = { status: "ready", countries: [{ countryCode: "CHN", name, geometry }] };
  const projection = { stream: sink => sink };
  const style = { sizeScale: 1 };
  const origins = [];
  let origin;
  const ctx = { save() {}, restore() {}, rotate() {}, strokeText() {},
    measureText: () => ({ width: 100 }), translate(x, y) { origin = [x, y]; },
    fillText() { origins.push(origin); } };
  const owner = createCountryLabelRenderOwner({
    state: { currentLanguage: "zh", styleConfig: { countryLabels: style } }, helpers: { geoStream },
    getters: { getContext: () => ctx, getCountryLabelSource: () => source,
      getProjection: () => projection, getViewportSize: () => ({ width: 400, height: 300 }) },
  });
  function draw(sizeScale) {
    style.sizeScale = sizeScale;
    origins.length = 0;
    const boxes = [];
    assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: boxes }), 1);
    const label = owner.getDiagnostics().lastLabels[0];
    assert.equal(label.lineCount, 2);
    assert.equal(origins.length, name.length);
    return { origins: [...origins], boxes, ...label };
  }
  const original = draw(1);
  const { x, y, w, h } = original.bounds;
  const cx = x + w / 2, cy = y + h / 2;
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
  for (const scale of [1.6, 0.6]) {
    const scaled = draw(scale);
    near(scaled.fontSizePx, original.fontSizePx * scale);
    for (const [i, [gx, gy]] of original.origins.entries()) {
      near(scaled.origins[i][0], cx + (gx - cx) * scale);
      near(scaled.origins[i][1], cy + (gy - cy) * scale);
      const before = original.boxes[i], after = scaled.boxes[i];
      near(after.x + after.w / 2, cx + (before.x + before.w / 2 - cx) * scale);
      near(after.y + after.h / 2, cy + (before.y + before.h / 2 - cy) * scale);
    }
  }
});
