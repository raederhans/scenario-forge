import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { rewriteMetaUrls } from "../tools/build_editor_bundle.mjs";

const JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "js");

test("relative import.meta.url references are rebased onto js/bundle", () => {
  const cases = [
    [path.join(JS, "core", "border_mesh_worker_client.js"), `new URL("../workers/border_mesh.worker.js", import.meta.url)`,
      `new URL("../workers/border_mesh.worker.js", import.meta.url)`],
    [path.join(JS, "core", "renderer", "country_label_source.js"), `new URL('../../workers/country_label_geometry.worker.js', import.meta.url)`,
      `new URL('../workers/country_label_geometry.worker.js', import.meta.url)`],
    [path.join(JS, "core", "renderer", "country_label_render_owner.js"), `new URL("./country_label_layout_worker.js", import.meta.url)`,
      `new URL("../core/renderer/country_label_layout_worker.js", import.meta.url)`],
    [path.join(JS, "core", "map_renderer.js"), `new URL("../../vendor/textures/paper_vintage_01.svg", import.meta.url)`,
      `new URL("../../vendor/textures/paper_vintage_01.svg", import.meta.url)`],
  ];
  for (const [file, source, expected] of cases) {
    const { code, count } = rewriteMetaUrls(`const u = ${source};`, file);
    assert.equal(code, `const u = ${expected};`, file);
    assert.equal(count, 1);
  }
});

test("non-literal and non-relative URLs are left alone", () => {
  const file = path.join(JS, "core", "data_service.js");
  for (const source of [
    "new URL(`../../${normalizedUrl}`, import.meta.url)",
    'new URL(sourceUrl, globalThis.location?.href || import.meta.url)',
    'new URL("https://example.com/a.js", import.meta.url)',
  ]) {
    const { code, count } = rewriteMetaUrls(source, file);
    assert.equal(code, source);
    assert.equal(count, 0);
  }
});
