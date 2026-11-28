import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

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
    this.children.push(node);
    node.parentNode = this;
    return node;
  }
  insertBefore(node) { return this.appendChild(node); }
  querySelectorAll(selector) {
    return this.children.filter((node) => selector.split(",").some((part) => {
      const [tag, className] = part.trim().split(".");
      return tag === "*" || (tag === node.tag && (!className || node.attributes.class === className));
    }));
  }
}

function setup(topology) {
  const group = d3.select(new Element("g"));
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
    state, helpers: { getSelectionBoundary: () => null, getPathSVG: () => pathSVG },
    groupGetters: { getSpecialZonesGroup: () => group, getStrategicDefs: () => null },
  });
  return { owner, rendered };
}

test("topology merge requires complete layer coverage and falls back independently", () => {
  const previous = globalThis.topojson;
  const calls = [];
  const merged = { type: "MultiPolygon", coordinates: [] };
  globalThis.topojson = { merge: (_topology, geometries) => { calls.push(geometries); return merged; } };
  try {
    const { owner, rendered } = setup({ objects: { political: { geometries: [{ id: "a" }, { id: "c" }] } } });
    owner.updateSpecialZonesPaths();
    assert.deepEqual(calls[0], [{ id: "c" }]);
    assert.equal(rendered[0].type, "FeatureCollection");
    assert.equal(rendered[2].geometry, merged);
  } finally { globalThis.topojson = previous; }
});
