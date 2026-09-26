import test from "node:test";
import assert from "node:assert/strict";
import { createSourceMetricsCache } from "../js/core/renderer/source_metrics_cache.js";

test("unchanged frames do not enumerate colors; revision and replacement invalidate", () => {
  const cache = createSourceMetricsCache();
  let reads = 0;
  const colors = new Proxy({}, { ownKeys(target) { reads += 1; return Reflect.ownKeys(target); } });
  assert.equal(cache.hasResolvedColors(colors, 0), false);
  for (let i = 0; i < 40; i++) assert.equal(cache.hasResolvedColors(colors, 0), false);
  assert.equal(reads, 1);
  colors.a = "#fff";
  assert.equal(cache.hasResolvedColors(colors, 1), true);
  assert.equal(cache.hasResolvedColors({}, 1), false);
});

test("topology counts reuse traversal and invalidate on edits or source replacement", () => {
  const cache = createSourceMetricsCache();
  let reads = 0;
  let arcs = [[1, -2], [3]];
  const object = { geometries: [{ get arcs() { reads += 1; return arcs; } }] };
  const topology = { objects: { urban: object } };
  assert.equal(cache.estimateTopologyObjectArcRefs(topology, "urban", 1), 3);
  for (let i = 0; i < 40; i++) assert.equal(cache.estimateTopologyObjectArcRefs(topology, "urban", 1), 3);
  assert.equal(reads, 1);
  arcs.push([4]);
  assert.equal(cache.estimateTopologyObjectArcRefs(topology, "urban", 2), 4);
  object.geometries = [{ arcs: [[8]] }];
  assert.equal(cache.estimateTopologyObjectArcRefs(topology, "urban", 2), 1);
  topology.objects.urban = { arcs: [[1, 2]] };
  assert.equal(cache.estimateTopologyObjectArcRefs(topology, "urban", 2), 2);
  assert.equal(cache.estimateTopologyObjectArcRefs(topology, "missing", 2), null);
});
