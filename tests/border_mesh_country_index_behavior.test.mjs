import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { buildSourceBorderMeshes } from "../js/core/renderer/border_mesh_source_selection.js";

const topojson = createRequire(import.meta.url)("../vendor/topojson-client.min.js");

function fixture() {
  const arcs = [], arcIds = new Map();
  const edge = (a, b) => {
    const forward = JSON.stringify([a, b]), reverse = JSON.stringify([b, a]);
    if (arcIds.has(forward)) return arcIds.get(forward);
    if (arcIds.has(reverse)) return ~arcIds.get(reverse);
    const id = arcs.length;
    arcs.push([a, b]);
    arcIds.set(forward, id);
    return id;
  };
  const geometries = ["A", "A", "A", "B", "C", "D"].map((country, x) => {
    const ring = [edge([x, 0], [x + 1, 0]), edge([x + 1, 0], [x + 1, 1]),
      edge([x + 1, 1], [x, 1]), edge([x, 1], [x, 0])];
    return { type: x === 2 ? "MultiPolygon" : "Polygon", id: x,
      properties: { country, group: x === 0 ? "first" : "second" },
      arcs: x === 2 ? [[ring]] : [ring] };
  });
  const topology = { type: "Topology", arcs, objects: { political: {
    type: "GeometryCollection", geometries,
  } } };
  return { topology };
}

const country = (geometry) => geometry.properties.country;
const group = (geometry) => geometry.properties.group;
const usable = (mesh) => !!mesh?.coordinates?.length;
const segments = (mesh) => (mesh?.coordinates || []).flatMap((line) => line.slice(1).map((point, i) =>
  [JSON.stringify(line[i]), JSON.stringify(point)].sort().join("/"))).sort();

function originalMesh(topology, code, province, exclude = () => false) {
  return topojson.mesh(topology, topology.objects.political, (a, b) => {
    if (!a || !b || exclude(a) || exclude(b)) return false;
    if (!country(a) || !country(b) || country(a) !== code || country(b) !== code) return false;
    const different = !!(group(a) && group(b) && group(a) !== group(b));
    return province ? different : !different;
  });
}

test("indexed real topojson mesh preserves province/local, coast and international borders", () => {
  const { topology } = fixture();
  const previous = globalThis.topojson;
  globalThis.topojson = topojson;
  try {
    for (const exclude of [() => false, (geometry) => geometry.id === 1]) {
      const result = buildSourceBorderMeshes({ topology, includedCountries: new Set(["A", "B", "C", "D"]),
        getFeatureCountryCodeNormalized: country, getAdmin1Group: group,
        shouldExcludePoliticalInteractionFeature: exclude, isUsableMesh: usable });
      for (const code of ["A", "B", "C", "D"]) {
        assert.deepEqual(segments(result.provinceMeshesByCountry.get(code)?.[0]), segments(originalMesh(topology, code, true, exclude)));
        assert.deepEqual(segments(result.localMeshesByCountry.get(code)?.[0]), segments(originalMesh(topology, code, false, exclude)));
      }
    }
    assert.ok(!segments(originalMesh(topology, "A", false)).includes('[3,0]/[3,1]'));
    assert.ok(segments(originalMesh(topology, "A", false)).includes('[0,0]/[0,1]'));
  } finally { globalThis.topojson = previous; }
});
