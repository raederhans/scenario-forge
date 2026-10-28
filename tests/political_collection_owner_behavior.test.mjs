import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";

import { createPoliticalCollectionOwner } from "../js/core/renderer/political_collection_owner.js";

for (const rewind of [false, true]) {
  test(`normalizeFeatureGeometry records area once for ${rewind ? "rewound" : "unchanged"} geometry`, (t) => {
    const sandbox = {};
    vm.runInNewContext(fs.readFileSync(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8"), sandbox);
    const previousD3 = globalThis.d3;
    globalThis.d3 = sandbox.d3;
    t.after(() => {
      if (previousD3 === undefined) delete globalThis.d3;
      else globalThis.d3 = previousD3;
    });

    const records = [];
    const helpers = { getFeatureId: (feature) => feature.id };
    const owner = createPoliticalCollectionOwner({
      state: {},
      helpers: {
        ...helpers,
        recordSphericalArea: (geometry, area) => records.push({ geometry, area }),
      },
    });
    const ring = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
    const feature = {
      type: "Feature",
      id: "polygon",
      properties: {},
      geometry: { type: "Polygon", coordinates: [rewind ? ring.slice().reverse() : ring] },
    };

    const normalized = owner.normalizeFeatureGeometry(feature);

    assert.equal(records.length, 1);
    assert.equal(records[0].geometry, normalized.geometry);
    assert.equal(records[0].area, sandbox.d3.geoArea(normalized));
    assert.ok(records[0].area <= Math.PI * 2);
    if (rewind) assert.notEqual(normalized.geometry, feature.geometry);
    else assert.equal(normalized, feature);

    const cached = owner.normalizeFeatureGeometry(feature);
    assert.equal(cached.geometry, normalized.geometry);
    assert.equal(records.length, 1, "a cached normalization does not record the area again");

    const withoutRecorder = createPoliticalCollectionOwner({ state: {}, helpers });
    assert.deepEqual(withoutRecorder.normalizeFeatureGeometry(feature), normalized);
  });
}
