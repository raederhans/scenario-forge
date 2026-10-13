import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspectPoliticalGpuResourceOrigin, POLITICAL_GPU_RESOURCE_PATH } from "../tools/state_resource_origin_contract.mjs";

const ownerPath = "js/core/renderer/political_id_raster_runtime_owner.js";
const rendererPath = "js/core/map_renderer.js";
const extraPath = "js/core/unproved_resource_consumer.js";
const sourcePaths = [POLITICAL_GPU_RESOURCE_PATH, ownerPath, rendererPath, extraPath];
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const inspectExtra = source => inspectPoliticalGpuResourceOrigin({
  sourcePaths,
  readSource: path => path === extraPath ? source : read(path),
});
const assertRejected = source => {
  const result = inspectExtra(source);
  assert.equal(result.binding, null, source);
  assert.ok(result.violations.some(violation => violation.modulePath === extraPath
    || violation.code === "resource-origin-consumer-set-drift"), source);
  return result;
};
const encodeAll = value => [...value].map(character => `%${character.charCodeAt(0).toString(16)}`).join("");
const targets = [
  { name: "GPU", factory: "createPoliticalIdRasterGpu", file: "political_id_raster_gpu.js", encoded: "political_id_raster_%67pu.js" },
  { name: "owner", factory: "createPoliticalIdRasterRuntimeOwner", file: "political_id_raster_runtime_owner.js", encoded: "political_id_raster_runtime_%6fwner.js" },
];
const consumers = {
  static: (path, factory) => `import { ${factory} } from ${JSON.stringify(path)};`,
  dynamic: path => `import(${JSON.stringify(path)});`,
  reexport: path => `export * from ${JSON.stringify(path)};`,
  namedReexport: (path, factory) => `export { ${factory} } from ${JSON.stringify(path)};`,
};

test("resource origin still admits only the unchanged production resource graph", () => {
  const result = inspectPoliticalGpuResourceOrigin();
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.binding, {
    functionName: "createPoliticalIdRasterGpu", parameterIndex: 0,
    parameterPath: "$/property:canvas", parameterName: "canvas",
  });
  assert.deepEqual(inspectExtra('export { helper } from "./unrelated.js";').violations, []);
});

for (const target of targets) {
  for (const [variant, path] of [
    ["normal", `./renderer/${target.file}`],
    ["encoded name", `./renderer/${target.encoded}`],
    ["fully encoded path", encodeAll(`./renderer/${target.file}`)],
  ]) {
    for (const [consumer, createSource] of Object.entries(consumers)) {
      test(`resource graph rejects new ${target.name} ${consumer} with ${variant}`, () => {
        assertRejected(createSource(path, target.factory));
      });
    }
  }
}

test("encoded paths actually import the same GPU and owner factories", async () => {
  for (const target of targets) {
    const original = await import(`../js/core/renderer/${target.file}`);
    const encoded = await import(`../js/core/renderer/${target.encoded}`);
    assert.equal(encoded[target.factory], original[target.factory]);
  }
});

test("resource graph rejects case aliases, including encoded uppercase targets", () => {
  for (const target of targets) {
    for (const path of [`./renderer/${target.file.slice(0, -3).toUpperCase()}.js`, `./RENDERER/${target.file.toUpperCase()}`, encodeAll(`./renderer/${target.file.toUpperCase()}`),
      `https://example.invalid/js/core/renderer/${target.file.toUpperCase()}`]) {
      for (const createSource of Object.values(consumers)) assertRejected(createSource(path, target.factory));
    }
  }
});

test("Windows case aliases load the protected implementation", { skip: process.platform !== "win32" }, async () => {
  for (const target of targets) {
    const original = await import(`../js/core/renderer/${target.file}`);
    const alias = await import(`../js/core/renderer/${target.file.slice(0, -3).toUpperCase()}.js`);
    // Node caches different URL spellings separately, so function identity need
    // not match even though the same source and resource effects are loaded.
    assert.equal(alias[target.factory].toString(), original[target.factory].toString());
  }
});

test("resource graph rejects separator, dot segment, root and URL aliases of both targets", () => {
  for (const target of targets) {
    for (const path of [
      `.%2frenderer%2f${target.encoded}`,
      `./renderer/%2e%2e/renderer/${target.encoded}`,
      `/js/core/renderer/${target.encoded}`,
      `/js/core/%2e%2e/core/renderer/${target.encoded}`,
      `./renderer/${target.encoded}?consumer=1#scope`,
      `https://example.invalid/js/core/renderer/${target.encoded}`,
      `//example.invalid/js/core/renderer/${target.encoded}`,
      `.\\renderer\\${target.file}`,
      `.%5crenderer%5c${target.encoded}`,
    ]) {
      assertRejected(consumers.static(path, target.factory));
      assertRejected(consumers.reexport(path));
    }
  }
});

test("resource graph fails closed for malformed encodings and control characters", () => {
  for (const target of targets) {
    for (const encoding of ["%zz", "%FF", "%E0%A4%A", "%", "%00", "%0a"]) {
      const result = assertRejected(consumers.reexport(`./renderer/${encoding}${target.file}`));
      assert.ok(result.violations.some(violation => violation.code === "resource-origin-consumer-path-invalid"));
    }
  }
});

test("resource graph rejects encoded alias, namespace and unresolved dynamic consumers", () => {
  for (const target of targets) {
    const path = JSON.stringify(`./renderer/${target.encoded}`);
    assertRejected(`import { ${target.factory} as replacement } from ${path};`);
    assertRejected(`import * as replacement from ${path};`);
    assertRejected(`import(prefix + ${path});`);
  }
  for (const source of ['import(1);', 'import(`./renderer/${name}.js`);']) {
    const result = assertRejected(source);
    assert.ok(result.violations.some(violation => violation.code === "resource-origin-dynamic-consumer-unresolved"));
  }
});

test("encoded query/hash pathname data never gains a resource origin", () => {
  for (const target of targets) {
    for (const suffix of ["%3fextra", "%23extra"]) {
      const result = assertRejected(consumers.static(`./renderer/${target.file}${suffix}`, target.factory));
      assert.ok(result.violations.some(violation => violation.code === "resource-origin-consumer-path-unresolved"));
    }
  }
});
