import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createProjectedGeographicPathCache } from "../js/core/renderer/projected_geographic_path_cache.js";
import { markProjectionGeometryChanged } from "../js/core/renderer/projection_geometry_identity.js";

const sandbox = {};
vm.runInNewContext(fs.readFileSync(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8"), sandbox);
const d3 = sandbox.d3;
class RecordingPath {
  commands = [];
  moveTo(...args) { this.commands.push(["moveTo", ...args]); }
  lineTo(...args) { this.commands.push(["lineTo", ...args]); }
  arc(...args) { this.commands.push(["arc", ...args]); }
  closePath() { this.commands.push(["closePath"]); }
}
const geometry = () => ({ type: "LineString", coordinates: [[10.123456789, 20], [12, 24]] });

test("cached paths preserve direct geoPath coordinates and survive feature wrappers", () => {
  const projection = d3.geoMercator();
  const cache = createProjectedGeographicPathCache({ getProjection: () => projection, geoPath: d3.geoPath, Path2DClass: RecordingPath });
  assert.equal(Object.isFrozen(cache), true);
  const feature = { type: "Feature", properties: {}, geometry: geometry() };
  const path = cache.getPath(feature);
  const direct = new RecordingPath();
  d3.geoPath(projection).context(direct)(feature);
  assert.deepEqual(path.commands, direct.commands);
  assert.equal(cache.getPath({ ...feature, properties: { color: "red" } }), path);
  assert.equal(cache.getPath(feature.geometry), path);
  assert.equal(cache.getStats().builds, 1);
  assert.equal(cache.getStats().hits, 2);
});

test("changed geometry, projection replacement and marked projection mutations rebuild", () => {
  let projection = d3.geoMercator();
  const cache = createProjectedGeographicPathCache({ getProjection: () => projection, geoPath: d3.geoPath, Path2DClass: RecordingPath });
  const feature = { type: "Feature", geometry: geometry() };
  const first = cache.getPath(feature);
  feature.geometry = geometry();
  assert.notEqual(cache.getPath(feature), first);
  const second = cache.getPath(feature);
  projection.precision(0.05).clipExtent([[0, 0], [800, 500]]);
  markProjectionGeometryChanged(projection);
  assert.notEqual(cache.getPath(feature), second);
  const third = cache.getPath(feature);
  projection = d3.geoMercator().scale(80);
  assert.notEqual(cache.getPath(feature), third);
  const fourth = cache.getPath(feature);
  cache.reset();
  assert.notEqual(cache.getPath(feature), fourth);
});

test("missing Path2D or projection allows the existing Canvas path fallback", () => {
  const cache = createProjectedGeographicPathCache({ getProjection: () => null, geoPath: d3.geoPath, Path2DClass: RecordingPath });
  assert.equal(cache.getPath(geometry()), null);
  assert.equal(createProjectedGeographicPathCache({ Path2DClass: null }).getPath(geometry()), null);
});
