import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "acorn";

const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
const declaration = ast.body.find((node) => node.type === "FunctionDeclaration"
  && node.id.name === "ensureCountrySourceBorderMeshes");
const compose = new Function("runtimeState", "staticMeshSourceCountries", "getBorderMeshOwner",
  "globalThis", "canonicalCountryCode", "isUsableMesh",
  `${source.slice(declaration.start, declaration.end)}; return ensureCountrySourceBorderMeshes;`);

function harness(build) {
  const detail = Object.freeze({ objects: Object.freeze({ political: {} }), name: "detail" });
  const primary = Object.freeze({ objects: Object.freeze({ political: {} }), name: "primary" });
  const state = {
    topologyDetail: detail, topologyPrimary: primary,
    cachedProvinceBorders: [], cachedLocalBorders: [], cachedGridLines: [],
    cachedProvinceBordersByCountry: new Map(), cachedLocalBordersByCountry: new Map(),
  };
  const countries = { detail: new Set(["DEU"]), primary: new Set(["DEU"]) };
  const calls = [];
  const buildSourceBorderMeshes = (topology, codes, options) => {
    calls.push({ topology, codes: [...codes], options });
    return build(topology);
  };
  const owner = Object.freeze({ buildSourceBorderMeshes });
  const ensure = compose(state, countries, () => owner,
    { topojson: {} }, (code) => String(code).toUpperCase(), (mesh) => !!mesh?.valid);
  return { state, countries, calls, ensure };
}

const meshes = (mesh) => ({ provinceMeshesByCountry: new Map([["DEU", [null, mesh]]]),
  localMeshesByCountry: new Map([["DEU", [mesh]]]) });

test("country source borders keep source order, mesh identities and cached no-op behavior", () => {
  const detailMesh = Object.freeze({ valid: true, id: "detail" });
  const primaryMesh = Object.freeze({ valid: true, id: "primary" });
  const h = harness((topology) => meshes(topology.name === "detail" ? detailMesh : primaryMesh));
  h.ensure("deu");
  assert.deepEqual(h.calls.map(({ topology }) => topology.name), ["detail", "primary"]);
  assert.deepEqual(h.state.cachedProvinceBorders, [detailMesh, primaryMesh]);
  assert.equal(h.state.cachedProvinceBorders[0], detailMesh);
  assert.deepEqual(h.state.cachedLocalBordersByCountry.get("DEU"), [detailMesh, primaryMesh]);
  assert.deepEqual(h.state.cachedGridLines, h.state.cachedLocalBorders);
  assert.notEqual(h.state.cachedGridLines, h.state.cachedLocalBorders);
  h.ensure("deu");
  assert.equal(h.calls.length, 2);
});

test("missing or empty detail source still visits primary and respects requested levels", () => {
  const mesh = Object.freeze({ valid: true });
  const h = harness((topology) => topology.name === "detail" ? null : meshes(mesh));
  h.ensure("DEU", { includeProvince: false });
  assert.deepEqual(h.state.cachedProvinceBorders, []);
  assert.equal(h.state.cachedProvinceBordersByCountry.has("DEU"), false);
  assert.deepEqual(h.state.cachedLocalBorders, [mesh]);
  assert.deepEqual(h.calls[0].options, { includeProvince: false, includeLocal: true });
});

test("a later source failure preserves earlier append effects without publishing country completion", () => {
  const mesh = Object.freeze({ valid: true });
  const failure = new Error("primary build failed");
  const h = harness((topology) => {
    if (topology.name === "primary") throw failure;
    return meshes(mesh);
  });
  assert.throws(() => h.ensure("DEU"), (error) => error === failure);
  assert.deepEqual(h.state.cachedProvinceBorders, [mesh]);
  assert.deepEqual(h.state.cachedLocalBorders, [mesh]);
  assert.equal(h.state.cachedProvinceBordersByCountry.has("DEU"), false);
  assert.equal(h.state.cachedLocalBordersByCountry.has("DEU"), false);
  assert.deepEqual(h.state.cachedGridLines, []);
});
