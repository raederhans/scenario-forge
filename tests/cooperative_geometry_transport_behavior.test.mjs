import assert from "node:assert/strict";
import test from "node:test";
import { packGeometryCooperatively } from "../js/core/cooperative_geometry_transport.js";

const feature = (x) => ({ type: "Feature", geometry: { type: "Point", coordinates: [x, x] } });

test("cooperative batches preserve update coordinates and order", async () => {
  const updates = Array.from({ length: 65 }, (_, index) => ({ id: String(index), feature: feature(index) }));
  const codec = globalThis.__scenarioForgeGeometryTransferCodecShared;
  const result = await packGeometryCooperatively(updates, {
    pack: batch => codec.pack(batch, { minCoordinateCount: 0 }),
  });
  assert.equal(result.payload.encoding, "geo-f64-batches-v1");
  assert.deepEqual(result.payload.batches.flatMap((batch) => codec.unpack(batch)), updates);
});
