import test from "node:test";
import assert from "node:assert/strict";
import { resolveAtlantropaSeaFillColor } from "../js/core/scenario/atlantropa_sea_color.js";

const manifest = { style_defaults: {
  ocean: { fillColor: "#aabbcc" },
  atlantropa_sea: { fillColor: "#123456" },
} };

test("unchanged ocean uses manifest Atlantropa sea color", () => {
  assert.equal(resolveAtlantropaSeaFillColor(manifest, "#aabbcc"), "#123456");
  assert.equal(resolveAtlantropaSeaFillColor(manifest, "#ABC"), "#123456");
});

test("edited ocean color takes precedence", () => {
  assert.equal(resolveAtlantropaSeaFillColor(manifest, "#654321"), "#654321");
});

test("missing or invalid sea color follows ocean", () => {
  for (const fillColor of [undefined, "invalid-color"]) {
    assert.equal(resolveAtlantropaSeaFillColor({ style_defaults: {
      ocean: manifest.style_defaults.ocean, atlantropa_sea: { fillColor },
    } }, "#aabbcc"), "#aabbcc");
  }
  assert.equal(resolveAtlantropaSeaFillColor(null, "#aabbcc"), "#aabbcc");
});
