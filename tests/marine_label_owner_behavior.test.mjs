import assert from "node:assert/strict";
import test from "node:test";
import { chooseMarineFocusBounds, createMarineInteriorAnchorResolver, findMarineInteriorAnchor } from "../js/core/renderer/marine_label_owner.js";

test("anchor remains stable under modest pan and zoom while inside visible water", () => {
  const resolve = createMarineInteriorAnchorResolver();
  const pointInWater = ([x, y]) => x >= 10 && x <= 90 && y >= 10 && y <= 90;
  const options = {
    part: {}, generation: 1, centroid: [50, 50],
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: { x: 0, y: 0, k: 1 }, width: 100, height: 100, gridSize: 3,
    contains: pointInWater,
  };
  const first = resolve(options);
  assert.deepEqual(first, [50, 50]);
  assert.equal(resolve({ ...options, transform: { ...options.transform } }), first);
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
