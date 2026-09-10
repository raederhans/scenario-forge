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
  return { topology, geometries };
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
  const { topology, geometries } = fixture();
  const previous = globalThis.topojson;
  const seenObjects = [];
  globalThis.topojson = { ...topojson, mesh: (input, object, filter) => {
    seenObjects.push(object);
    return topojson.mesh(input, object, filter);
  } };
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
    assert.ok(seenObjects.every((object) => object !== topology.objects.political));
    assert.ok(seenObjects.every((object) => object.geometries.length < geometries.length));
    // A's country subset includes B (shared international arc), but no C/D.
    assert.deepEqual(seenObjects[0].geometries.map((geometry) => geometry.id), [0, 1, 2, 3]);
    assert.ok(!segments(originalMesh(topology, "A", false)).includes('[3,0]/[3,1]'));
    assert.ok(segments(originalMesh(topology, "A", false)).includes('[0,0]/[0,1]'));
  } finally { globalThis.topojson = previous; }
});

test("country assignments index once per revision and resolver, memoize per-call arc predicates", () => {
  const { topology, geometries } = fixture();
  const previous = globalThis.topojson;
  globalThis.topojson = topojson;
  let countryReads = 0, exclusionReads = 0, groupReads = 0, geometryReads = 0;
  Object.defineProperty(topology.objects.political, "geometries", { get() { geometryReads += 1; return geometries; } });
  const resolve = (geometry) => { countryReads += 1; return country(geometry); };
  const options = { topology, getFeatureCountryCodeNormalized: resolve,
    getAdmin1Group: (geometry) => { groupReads += 1; return group(geometry); },
    shouldExcludePoliticalInteractionFeature: () => { exclusionReads += 1; return false; },
    isUsableMesh: usable, countryAssignmentRevision: "one" };
  try {
    buildSourceBorderMeshes({ ...options, includedCountries: new Set(["A", "B", "C", "D"]) });
    assert.equal(countryReads, geometries.length);
    assert.equal(geometryReads, 1);
    assert.ok(exclusionReads <= geometries.length);
    assert.ok(groupReads <= geometries.length);
    buildSourceBorderMeshes({ ...options, includedCountries: new Set(["A"]) });
    assert.equal(countryReads, geometries.length, "repeat country uses cached assignment");
    geometries[2].properties.country = "B";
    const reassigned = buildSourceBorderMeshes({ ...options, countryAssignmentRevision: "two", includedCountries: new Set(["A", "B"]) });
    assert.equal(countryReads, geometries.length * 2);
    assert.equal(geometryReads, 1, "assignment change reuses the arc index");
    for (const code of ["A", "B"]) {
      assert.deepEqual(segments(reassigned.localMeshesByCountry.get(code)?.[0]), segments(originalMesh(topology, code, false)));
    }
    let newResolverReads = 0;
    buildSourceBorderMeshes({ ...options, getFeatureCountryCodeNormalized: (geometry) => {
      newResolverReads += 1; return country(geometry);
    }, includedCountries: new Set(["A"]) });
    assert.equal(newResolverReads, geometries.length);
  } finally { globalThis.topojson = previous; }
});

test("requested border kinds avoid constructing unused meshes", () => {
  const { topology } = fixture();
  const previous = globalThis.topojson;
  let meshes = 0;
  globalThis.topojson = { ...topojson, mesh: (...args) => { meshes += 1; return topojson.mesh(...args); } };
  try {
    const options = { topology, includedCountries: new Set(["A"]), getFeatureCountryCodeNormalized: country,
      getAdmin1Group: group, isUsableMesh: usable };
    const province = buildSourceBorderMeshes({ ...options, includeLocal: false });
    assert.equal(meshes, 1);
    assert.equal(province.localMeshes.length, 0);
    const local = buildSourceBorderMeshes({ ...options, includeProvince: false });
    assert.equal(meshes, 2);
    assert.equal(local.provinceMeshes.length, 0);
  } finally { globalThis.topojson = previous; }
});
