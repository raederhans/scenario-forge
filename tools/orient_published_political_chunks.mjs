import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const context = vm.createContext({});
for (const name of ["vendor/d3.v7.min.js", "vendor/topojson-client.min.js", "js/core/scenario_chunk_format_shared.js"]) {
  vm.runInContext(fs.readFileSync(new URL(name, root), "utf8"), context);
}
const orient = context.__scenarioForgeScenarioChunkFormatShared.orientPoliticalFeatureCollection;
const polygons = geometry => geometry.type === "Polygon" ? [geometry.arcs]
  : geometry.type === "MultiPolygon" ? geometry.arcs : [];

export function orientPublishedPoliticalPayload(payload) {
  if (payload.type === "Topology") {
    if (payload.transform) return { changed: false, skipped: "transform" };
    const geometries = payload.objects.political.geometries;
    const collection = context.topojson.feature(payload, payload.objects.political);
    const before = collection.features.map(feature => feature.geometry);
    orient(collection, context.d3.geoArea);
    let changed = false;
    let invariantFailures = 0;
    collection.features.forEach((feature, index) => {
      if (feature.geometry === before[index]) return;
      const oldPolygons = before[index].type === "Polygon" ? [before[index].coordinates] : before[index].coordinates;
      const newPolygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      const geometry = geometries[index];
      const originalRefs = geometry.arcs;
      const nextPolygons = polygons(geometry).map((polygon, p) => polygon.map((refs, r) =>
        JSON.stringify(oldPolygons[p][r]) === JSON.stringify(newPolygons[p][r])
          ? refs : [...refs].reverse().map(ref => ~ref)));
      geometry.arcs = geometry.type === "Polygon" ? nextPolygons[0] : nextPolygons;
      const candidate = context.topojson.feature(payload, geometry);
      const area = context.d3.geoArea(candidate);
      orient(candidate, context.d3.geoArea);
      if (JSON.stringify(candidate) !== JSON.stringify(feature) || !(area <= Math.PI * 2)) {
        geometry.arcs = originalRefs;
        invariantFailures++;
      } else {
        changed = true;
      }
    });
    return { changed, invariantFailures };
  }
  const features = payload.type === "Feature" ? [payload] : payload.features;
  const before = features.map(feature => feature.geometry);
  orient(payload, context.d3.geoArea);
  features.forEach(feature => { delete feature.sphericalArea; });
  return { changed: features.some((feature, index) => feature.geometry !== before[index]) };
}

function readPayload(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function changedWinding(before, after) {
  const a = context.d3.geoArea(before);
  const b = context.d3.geoArea(after);
  const hemisphere = 2 * Math.PI;
  const signed = area => area > hemisphere ? area - 2 * hemisphere : area;
  return (a > hemisphere) !== (b > hemisphere) || Math.sign(signed(a)) !== Math.sign(signed(b));
}

function windingProtection([source, candidate]) {
  const features = file => {
    const payload = readPayload(file);
    if (payload.type === "Topology") return context.topojson.feature(payload, payload.objects.political).features;
    return payload.type === "Feature" ? [payload] : payload.features;
  };
  const before = features(source);
  const after = features(candidate);
  const rings = geometry => geometry?.type === "Polygon" ? geometry.coordinates
    : geometry?.type === "MultiPolygon" ? geometry.coordinates.flat() : [];
  const polygon = ring => ({ type: "Polygon", coordinates: [ring] });
  const required = [];
  let offset = 0;
  before.forEach((feature, i) => {
    const original = rings(feature.geometry);
    const rounded = rings(after[i].geometry);
    const changed = original.flatMap((ring, r) =>
      changedWinding(polygon(ring), polygon(rounded[r])) ? [[offset + r, ring]] : []);
    if (changed.length) required.push(...changed);
    else if (changedWinding(feature, after[i])) {
      original.forEach((ring, r) => required.push([offset + r, ring]));
    }
    offset += original.length;
  });
  return required;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = JSON.parse(fs.readFileSync(0, "utf8"));
  const results = process.argv[2] === "--check-winding" ? files.map(windingProtection) : files.map(file => {
    const payload = readPayload(file);
    const result = orientPublishedPoliticalPayload(payload);
    if (result.changed) fs.writeFileSync(file, JSON.stringify(payload));
    return { file, ...result };
  });
  process.stdout.write(JSON.stringify(results));
}
