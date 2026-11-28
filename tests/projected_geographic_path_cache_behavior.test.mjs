import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import { createProjectedGeographicPathCache } from "../js/core/renderer/projected_geographic_path_cache.js";

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

test("cached paths preserve direct geoPath coordinates", () => {
  const projection = d3.geoMercator();
  const cache = createProjectedGeographicPathCache({ getProjection: () => projection, geoPath: d3.geoPath, Path2DClass: RecordingPath });
  const feature = { type: "Feature", properties: {}, geometry: geometry() };
  const path = cache.getPath(feature);
  const direct = new RecordingPath();
  d3.geoPath(projection).context(direct)(feature);
  assert.deepEqual(path.commands, direct.commands);
});

test("replacing the projection rebuilds the path", () => {
  let projection = d3.geoMercator();
  const cache = createProjectedGeographicPathCache({ getProjection: () => projection, geoPath: d3.geoPath, Path2DClass: RecordingPath });
  const feature = { type: "Feature", geometry: geometry() };
  const first = cache.getPath(feature);
  projection = d3.geoMercator().scale(80);
  assert.notEqual(cache.getPath(feature), first);
});
