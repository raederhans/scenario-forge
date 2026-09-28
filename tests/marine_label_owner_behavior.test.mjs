import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseMarineFocusBounds,
  createMarineInteriorAnchorResolver,
  drawMarineLabels,
  findMarineInteriorAnchor,
  getMarineLabelMinScale,
  getMarineLabelName,
  isMarineLabelEligible,
} from "../js/core/renderer/marine_label_owner.js";

test("anchor remains stable under modest pan and zoom while inside visible water", () => {
  const resolve = createMarineInteriorAnchorResolver();
  let calls = 0;
  const pointInWater = ([x, y]) => x >= 10 && x <= 90 && y >= 10 && y <= 90;
  const options = {
    part: {}, generation: 1, centroid: [50, 50],
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: { x: 0, y: 0, k: 1 }, width: 100, height: 100, gridSize: 3,
    contains: (point) => { calls += 1; return pointInWater(point); },
  };
  const first = resolve(options);
  assert.deepEqual(first, [50, 50]);
  assert.equal(resolve({ ...options, transform: { ...options.transform } }), first);
  assert.equal(calls, 1);
  for (const change of [
    { transform: { x: 1, y: 0, k: 1 } },
    { transform: { x: 0, y: 1, k: 1 } },
    { transform: { x: 0, y: 0, k: 1.1 } },
    { width: 110 }, { height: 110 },
  ]) {
    const anchor = resolve({ ...options, ...change });
    assert.equal(anchor, first);
    assert.ok(pointInWater(anchor), "reused anchor remains inside the polygon");
    const { x, y, k } = { ...options.transform, ...change.transform };
    assert.ok(anchor[0] * k + x >= 2 && anchor[0] * k + x <= (change.width ?? options.width) - 2);
    assert.ok(anchor[1] * k + y >= 2 && anchor[1] * k + y <= (change.height ?? options.height) - 2);
  }
  assert.equal(calls, 1, "valid reused anchors skip contains");
});

test("offscreen anchor recomputes, while geometry and search parameter changes invalidate", () => {
  const resolve = createMarineInteriorAnchorResolver();
  let calls = 0;
  const options = {
    part: {}, generation: 1, centroid: [50, 50],
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: { x: 0, y: 0, k: 1 }, width: 100, height: 100, gridSize: 3,
    contains: () => { calls += 1; return true; },
  };
  const first = resolve(options);
  const shifted = resolve({ ...options, transform: { x: -60, y: 0, k: 1 } });
  assert.notDeepEqual(shifted, first);
  assert.ok(calls > 1);
  for (const change of [
    { gridSize: 5 }, { generation: 2 }, { part: {} },
    { bounds: { ...options.bounds, maxX: 101 } }, { centroid: [51, 50] },
  ]) {
    resolve(options);
    const before = calls;
    resolve({ ...options, ...change });
    assert.ok(calls > before, `search must rerun for ${JSON.stringify(change)}`);
  }
});

test("failed prior search is cached only for its own viewport", () => {
  const resolve = createMarineInteriorAnchorResolver();
  let calls = 0;
  const options = {
    part: {}, generation: 1, centroid: [50, 50],
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: { x: 0, y: 0, k: 1 }, width: 100, height: 100,
    contains: () => { calls += 1; return false; },
  };
  assert.equal(resolve(options), null);
  const afterMiss = calls;
  assert.equal(resolve(options), null);
  assert.equal(calls, afterMiss, "cache failed interior searches too");
  assert.equal(resolve({ ...options, transform: { x: 1, y: 0, k: 1 } }), null);
  assert.ok(calls > afterMiss, "new viewport retries a failed search");
});

test("visible anchor reuse honors the two pixel viewport margins", () => {
  const resolve = createMarineInteriorAnchorResolver();
  let calls = 0;
  const options = {
    part: {}, generation: 1, centroid: [2, 50],
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: { x: 0, y: 0, k: 1 }, width: 100, height: 100,
    contains: () => { calls += 1; return true; },
  };
  const first = resolve(options);
  assert.deepEqual(first, [2, 50]);
  assert.equal(resolve({ ...options, transform: { x: 0.5, y: 0, k: 1 } }), first);
  assert.equal(calls, 1);
  const beyondMargin = resolve({ ...options, transform: { x: -0.5, y: 0, k: 1 } });
  assert.notDeepEqual(beyondMargin, first);
  assert.ok(calls > 1);
});

test("failed grid search checks its center once", () => {
  const points = [];
  findMarineInteriorAnchor({
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: { x: 0, y: 0, k: 1 }, width: 100, height: 100,
    contains: (point) => { points.push(point); return false; },
  });
  assert.equal(points.length, 9);
  assert.equal(points.filter(([x, y]) => x === 50 && y === 50).length, 1);
});

const feature = (id, water_type, region_group = "marine_detail", more = {}) => ({
  properties: { id, water_type, region_group, label: id, ...more },
});

function context() {
  const drawn = [];
  return {
    drawn,
    save() {}, restore() {},
    measureText(text) { return { width: text.length * Number(this.font.match(/[\d.]+(?=px)/)?.[0] || 12) * 0.5 }; },
    strokeText() {},
    fillText(text) { drawn.push(text); },
  };
}

const entry = (item, x, y) => ({
  id: item.properties.id, feature: item, anchor: [x, y], screenPoint: [x, y],
});

test("marine label scales keep the world view sparse and reveal detail on zoom", () => {
  const ocean = feature("marine_atlantic_ocean", "ocean", "ocean_macro");
  const sea = feature("marine_baltic_sea", "sea", "marine_macro");
  const bay = feature("marine_test_bay", "bay");
  const strait = feature("marine_test_strait", "strait");
  assert.deepEqual([ocean, sea, bay, strait].map(getMarineLabelMinScale), [1, 1, 4.5, 4.5]);
  assert.equal(getMarineLabelMinScale(feature("aral_sea", "inland_sea")), Infinity);
  assert.equal(getMarineLabelMinScale(feature("ATLSEA_FILL", "sea", "mediterranean")), Infinity);
  assert.equal(getMarineLabelMinScale(feature("tno_bo_hai", "sea", "marine_detail")), 2.2);
  assert.equal(getMarineLabelMinScale(feature("tno_sea_of_marmara", "sea", "marine_macro")), Infinity);
  assert.equal(getMarineLabelMinScale(feature("tno_congo_lake", "lake", "tno_congo_basin")), Infinity);
  const items = [entry(ocean, 100, 80), entry(sea, 230, 80), entry(bay, 100, 180), entry(strait, 230, 180)];
  const ctx = context();
  assert.equal(drawMarineLabels(items, { context: ctx, scale: 1, width: 400, height: 300 }), 2);
  assert.deepEqual(ctx.drawn, [ocean.properties.id, sea.properties.id]);
  ctx.drawn.length = 0;
  assert.equal(drawMarineLabels(items, { context: ctx, scale: 4.5, width: 400, height: 300 }), 4);
});

test("selected detail label is visible below its normal threshold and collision is bounded", () => {
  const bay = feature("marine_test_bay", "bay");
  const other = feature("marine_other_bay", "bay");
  const ctx = context();
  const occupiedBoxes = [];
  assert.equal(drawMarineLabels([entry(other, 100, 80), entry(bay, 100, 80)], {
    context: ctx, scale: 1, width: 400, height: 300,
    selectedId: bay.properties.id, occupiedBoxes,
  }), 1);
  assert.deepEqual(ctx.drawn, [bay.properties.id]);
  assert.equal(occupiedBoxes.length, 1);
  ctx.drawn.length = 0;
  assert.equal(drawMarineLabels([entry(bay, 4, 4)], {
    context: ctx, scale: 5, width: 400, height: 300,
  }), 0);
});

test("ocean visibility follows its opt-in while named seas remain available", () => {
  const ocean = feature("marine_pacific_ocean", "ocean", "ocean_macro");
  const sea = feature("marine_baltic_sea", "sea", "marine_macro", { name_zh: "波罗的海" });
  assert.equal(isMarineLabelEligible(ocean, { showWaterRegions: true }), false);
  assert.equal(isMarineLabelEligible(ocean, { showWaterRegions: true, openOceanRenderable: true }), true);
  assert.equal(isMarineLabelEligible(sea, { showWaterRegions: true }), true);
  assert.equal(isMarineLabelEligible(sea, { showWaterRegions: false }), false);
  assert.equal(getMarineLabelName(sea, "zh-CN"), "波罗的海");
  assert.equal(getMarineLabelName(sea, "en"), "marine_baltic_sea");
});

test("focus chooses one safe part instead of a date-line-spanning union", () => {
  const west = { minX: -180, maxX: -178, minY: 0, maxY: 2 };
  const east = { minX: 178, maxX: 179, minY: 0, maxY: 2 };
  assert.equal(chooseMarineFocusBounds([east, west]), west);
});

test("label anchor avoids a polygon hole and stays in the visible water", () => {
  const common = {
    centroid: [50, 50], bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: { k: 1, x: 0, y: 0 }, width: 100, height: 100,
  };
  const aroundHole = findMarineInteriorAnchor({
    ...common,
    contains: ([x, y]) => x > 10 && x < 90 && y > 10 && y < 90
      && !(x > 35 && x < 65 && y > 35 && y < 65),
  });
  assert.deepEqual(aroundHole, [18, 18]);
  const concave = findMarineInteriorAnchor({
    ...common,
    contains: ([x, y]) => x < 30 && y < 30,
  });
  assert.deepEqual(concave, [18, 18]);
  assert.equal(findMarineInteriorAnchor({ ...common, contains: () => false }), null);
  assert.equal(findMarineInteriorAnchor({
    ...common, transform: { k: 1, x: -80, y: 0 },
    contains: ([x, y]) => x < 30 && y < 30,
  }), null, "offscreen water does not receive a label");
});
