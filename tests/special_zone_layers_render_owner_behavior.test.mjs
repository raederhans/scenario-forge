import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { markProjectionGeometryChanged } from "../js/core/renderer/projection_geometry_identity.js";

const d3 = createRequire(import.meta.url)("../vendor/d3.v7.min.js");
import { createLayerFromPreset } from "../js/core/special_zone_layers.js";
import { createSpecialZoneLayersRenderOwner } from "../js/core/renderer/special_zone_layers_render_owner.js";

class Element {
  constructor(tag) {
    this.tag = tag;
    this.attributes = {};
    this.children = [];
    this.namespaceURI = "http://www.w3.org/2000/svg";
    this.ownerDocument = { createElementNS: (_namespace, name) => new Element(name) };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    this.children.push(node);
    node.parentNode = this;
    return node;
  }
  insertBefore(node, next) {
    if (!next) return this.appendChild(node);
    if (node.parentNode) node.parentNode.removeChild(node);
    this.children.splice(this.children.indexOf(next), 0, node);
    node.parentNode = this;
    return node;
  }
  removeChild(node) {
    this.children.splice(this.children.indexOf(node), 1);
    node.parentNode = null;
    return node;
  }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
  querySelectorAll(selector) {
    return this.children.filter((node) => selector.split(",").some((part) => {
      const [tag, className] = part.trim().split(".");
      return tag === "*" || (tag === node.tag && (!className || node.attributes.class === className));
    }));
  }
}

function createGroup() {
  const element = new Element("g");
  const group = d3.select(element);
  Object.defineProperty(group, "nodes", { get: () => element.children });
  return group;
}

function setup(getSelectionBoundary = () => null, topology = null, defs = null) {
  const group = createGroup();
  const rendered = [];
  const layers = [
    createLayerFromPreset("claim", { id: "claim", memberFeatureIds: ["a", "b"] }),
    createLayerFromPreset("economic", { id: "economic", memberFeatureIds: ["c"] }),
  ];
  const state = {
    specialZoneLayers: { layers, activeLayerId: "claim" },
    landIndex: new Map(["a", "b", "c"].map((id) => [id, { type: "Feature", properties: { id }, geometry: { type: "Polygon", coordinates: [] } }])),
    topology,
  };
  const path = d3.geoPath();
  const pathSVG = (geometry) => { rendered.push(geometry); return path(geometry); };
  pathSVG.projection = () => path.projection();
  const owner = createSpecialZoneLayersRenderOwner({
    state, helpers: { getSelectionBoundary, getPathSVG: () => pathSVG },
    groupGetters: { getSpecialZonesGroup: () => group, getStrategicDefs: () => defs },
  });
  return { group, owner, rendered, state, path };
}

test("each visible layer renders fill, texture and outline in layer order independently", () => {
  const boundary = { type: "MultiLineString", coordinates: [] };
  const calls = [];
  const { group, owner, rendered, state } = setup((ids) => { calls.push([...ids]); return ids.has("a") ? boundary : null; });
  owner.updateSpecialZonesPaths();
  assert.deepEqual(calls, [["a", "b"], ["c"]]);
  assert.deepEqual(group.nodes.map((node) => node.attributes.class), ["special-zone", "special-zone-pattern", "special-zone-outline", "special-zone", "special-zone-pattern", "special-zone-outline"]);
  assert.equal(rendered[0].type, "FeatureCollection");
  assert.equal(rendered[0].features.length, 2);
  assert.equal(rendered[1], boundary);
  assert.equal(rendered[2].type, "FeatureCollection");
  assert.equal(rendered.length, 3);
  assert.equal(group.nodes[2].attributes["stroke-dasharray"], "6 4");
  assert.equal(group.nodes[5].attributes["stroke-dasharray"], undefined);
  assert.equal(group.nodes[2].attributes["stroke-width"], "1.9");
  assert.equal(group.nodes[5].attributes["stroke-width"], "0.6");
  assert.equal(group.nodes[2].attributes["vector-effect"], "non-scaling-stroke");
  state.specialZoneLayers.layers.reverse();
  owner.updateSpecialZonesPaths();
  assert.equal(group.nodes.length, 6);
  assert.equal(group.nodes[0].attributes.fill, "#a3e635");
  state.specialZoneLayers.layers[0].visible = false;
  owner.updateSpecialZonesPaths();
  assert.equal(group.nodes.length, 3);
});

test("topology merge requires complete layer coverage and falls back independently", () => {
  const previous = globalThis.topojson;
  const calls = [];
  const merged = { type: "MultiPolygon", coordinates: [] };
  globalThis.topojson = { merge: (_topology, geometries) => { calls.push(geometries); return merged; } };
  try {
    const { owner, rendered } = setup(() => null, { objects: { political: { geometries: [{ id: "a" }, { id: "c" }] } } });
    owner.updateSpecialZonesPaths();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], [{ id: "c" }]);
    assert.equal(rendered[0].type, "FeatureCollection");
    assert.equal(rendered[2].geometry, merged);
    assert.equal(rendered.length, 3);
  } finally { globalThis.topojson = previous; }
});

test("identical updates retain path and pattern nodes without generating paths", () => {
  const previous = globalThis.d3;
  globalThis.d3 = d3;
  try {
    const defs = createGroup();
    const { group, owner, rendered } = setup(() => ({ type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] }), null, defs);
    owner.updateSpecialZonesPaths();
    const nodes = [...group.nodes];
    const patterns = [...defs.nodes];
    const marks = patterns.map((pattern) => [...pattern.children]);
    const attributes = nodes.map((node) => ({ ...node.attributes }));
    assert.ok(patterns.length > 0);
    assert.ok(marks.every((children) => children.length > 0));
    assert.equal(rendered.length, 4);
    rendered.length = 0;
    owner.updateSpecialZonesPaths();
    assert.equal(rendered.length, 0);
    nodes.forEach((node, index) => assert.equal(group.nodes[index], node));
    patterns.forEach((pattern, index) => {
      assert.equal(defs.nodes[index], pattern);
      marks[index].forEach((mark, childIndex) => assert.equal(pattern.children[childIndex], mark));
    });
    assert.deepEqual(group.nodes.map((node) => node.attributes), attributes);
  } finally { globalThis.d3 = previous; }
});

test("changing one layer's members only generates that layer's paths", () => {
  const { group, owner, rendered, state } = setup();
  owner.updateSpecialZonesPaths();
  const nodes = [...group.nodes];
  rendered.length = 0;
  state.specialZoneLayers.layers[0].memberFeatureIds = ["a"];
  owner.updateSpecialZonesPaths();
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].properties.__specialZoneLayerId, "claim");
  assert.deepEqual(rendered[0].features.map((feature) => feature.properties.sourceFeatureId), ["a"]);
  nodes.forEach((node, index) => assert.equal(group.nodes[index], node));
});

test("fill, pattern and outline retain the original fixture paths", () => {
  const boundary = { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] };
  const { group, owner, state } = setup((ids) => ids.has("a") ? boundary : null);
  for (const [index, feature] of [...state.landIndex.values()].entries()) {
    feature.geometry.coordinates = [[[index, 0], [index + 1, 0], [index, 1], [index, 0]]];
  }
  owner.updateSpecialZonesPaths();
  assert.deepEqual(group.nodes.map((node) => node.attributes.d), [
    "M0,0L1,0L0,1ZM1,0L2,0L1,1Z", "M0,0L1,0L0,1ZM1,0L2,0L1,1Z", "M0,0L1,1",
    "M2,0L3,0L2,1Z", "M2,0L3,0L2,1Z", "M2,0L3,0L2,1Z",
  ]);
});

test("projection changes invalidate paths while retaining nodes", () => {
  const { group, owner, rendered, path } = setup();
  const projection = d3.geoIdentity();
  path.projection(projection);
  owner.updateSpecialZonesPaths();
  const nodes = [...group.nodes];
  rendered.length = 0;
  projection.scale(2);
  markProjectionGeometryChanged(projection);
  owner.updateSpecialZonesPaths();
  assert.equal(rendered.length, 2);
  nodes.forEach((node, index) => assert.equal(group.nodes[index], node));
});
