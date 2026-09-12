import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parse } from "acorn";
import { inspectProjectedBoundsStateBoundary } from "../tools/check_architecture_boundaries.mjs";

const source = fs.readFileSync(new URL("../js/core/renderer/projected_geometry_bounds_owner.js", import.meta.url), "utf8");
const owner = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body
  .find(node => node.type === "ExportNamedDeclaration" && node.declaration?.id?.name === "createProjectedGeometryBoundsOwner").declaration;
const inject = statement => source.slice(0, owner.body.start + 1) + `\n${statement}\n` + source.slice(owner.body.start + 1);

test("current bounds owner checks ID cache readiness and writes through imported authorities", () => {
  assert.deepEqual(inspectProjectedBoundsStateBoundary(source), []);
});

for (const [name, statement] of [
  ["direct field assignment", "state.projectedBoundsById = new Map();"],
  ["direct map write", 'state.projectedBoundsById.set("bad", {});'],
  ["other lifecycle field", "void state.zoomTransform;"],
  ["dynamic field read", 'const key = "projectedBoundsById"; void state[key];'],
  ["literal computed field read", 'void state["projectedBoundsById"];'],
  ["root alias write", "const alias = state; alias.projectedBoundsById = new Map();"],
  ["cache alias write", 'const alias = state.projectedBoundsById; alias.set("bad", {});'],
  ["cache getter alias", 'const getCache = () => state.projectedBoundsById; const alias = getCache; alias().set("bad", {});'],
  ["cache local write", 'const cache = state.projectedBoundsById; cache.set("bad", {});'],
  ["cache return-value write", 'state.projectedBoundsById.get("bad").minX = 9;'],
  ["cache method escape", 'const set = state.projectedBoundsById.set; set("bad", {});'],
  ["borrow escape", 'return state;'],
  ["nested closure borrow escape", "helpers.leak = () => { return state.projectedBoundsById; };"],
  ["shadowed Map constructor", "const Map = { [Symbol.hasInstance](value) { helpers.leak = value; return true; } };"],
]) {
  test(`bounds boundary rejects ${name}`, () => {
    assert.ok(inspectProjectedBoundsStateBoundary(inject(statement)).length > 0);
  });
}

test("bounds boundary rejects shadowed and counterfeit state authorities", () => {
  assert.ok(inspectProjectedBoundsStateBoundary(inject(
    'function setProjectedBoundsCacheEntryState(state) {} setProjectedBoundsCacheEntryState(state);',
  )).length > 0);
  assert.ok(inspectProjectedBoundsStateBoundary(source.replace(
    '../state/actions/renderer_cache_actions.js', './fake_actions.js',
  )).length > 0);
});

test("bounds boundary rejects helper functions returning the cache", () => {
  const candidate = inject("function getCache() { return state.projectedBoundsById; }");
  assert.notEqual(candidate, source);
  assert.ok(inspectProjectedBoundsStateBoundary(candidate).length > 0);
});
