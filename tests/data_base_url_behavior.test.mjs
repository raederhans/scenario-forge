import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  configureDataBaseUrl,
  getDataBaseUrl,
  isExternalDataUrl,
  normalizeDataBaseUrl,
  resolveDataUrl,
} from "../js/core/data_base_url.js";
import { loadMeasuredJsonResource } from "../js/core/data_loader.js";

afterEach(() => configureDataBaseUrl(""));

test("empty base preserves values and references", () => {
  configureDataBaseUrl("");
  for (const value of ["data/x", "./data/x", {}, new URL("https://example.com/"), null, undefined, 3]) {
    assert.strictEqual(resolveDataUrl(value), value);
    assert.equal(isExternalDataUrl(resolveDataUrl(value), value), false);
  }
});

test("base normalization and data paths", () => {
  for (const base of [" https://cdn.example.com/assets ", "https://cdn.example.com/assets/"]) {
    assert.equal(configureDataBaseUrl(base), "https://cdn.example.com/assets/");
    assert.equal(getDataBaseUrl(), "https://cdn.example.com/assets/");
    for (const path of ["data/x", "./data/x"]) {
      assert.equal(resolveDataUrl(path), "https://cdn.example.com/assets/data/x");
      assert.equal(isExternalDataUrl(resolveDataUrl(path), path), true);
    }
  }
  assert.equal(normalizeDataBaseUrl("http://cdn.example.com"), "http://cdn.example.com/");
});

test("other paths and nonstrings pass through with a configured base", () => {
  configureDataBaseUrl("https://cdn.example.com");
  for (const value of ["https://example.com/data/x", "http://example.com/x", "//example.com/x", "/data/x", "blob:abc", "data:text/plain,x", "other/x", {}, null, undefined, 42]) {
    assert.strictEqual(resolveDataUrl(value), value);
    assert.equal(isExternalDataUrl(resolveDataUrl(value), value), false);
  }
});

test("empty and non-http bases are ignored", () => {
  for (const base of ["", "  ", null, undefined, "ftp://example.com", "//example.com", "/assets", "data/assets", "blob:abc", "javascript:void(0)", "https://"]) {
    assert.equal(configureDataBaseUrl(base), "");
    assert.equal(resolveDataUrl("data/x"), "data/x");
  }
});

test("module works without document and accepts an explicit Worker base", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  delete globalThis.document;
  const module = await import("../js/core/data_base_url.js?worker");
  try {
    assert.equal(module.getDataBaseUrl(), "");
    assert.equal(module.resolveDataUrl("data/x", "https://cdn.example.com/"), "https://cdn.example.com/data/x");
  } finally {
    module.configureDataBaseUrl("");
    if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
  }
});

test("meta is read lazily once and explicit configuration overrides the cache", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  let calls = 0;
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    querySelector(selector) {
      calls++;
      assert.equal(selector, 'meta[name="scenario-forge-data-base"]');
      return { content: " https://cdn.example.com/meta " };
    },
  } });
  const module = await import("../js/core/data_base_url.js?meta");
  try {
    assert.equal(calls, 0);
    assert.equal(module.getDataBaseUrl(), "https://cdn.example.com/meta/");
    assert.equal(module.getDataBaseUrl(), "https://cdn.example.com/meta/");
    assert.equal(calls, 1);
    module.configureDataBaseUrl("");
    assert.equal(module.getDataBaseUrl(), "");
    assert.equal(calls, 1);
  } finally {
    module.configureDataBaseUrl("");
    if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
    else delete globalThis.document;
  }
});

test("loadMeasuredJsonResource resolves at fetch time and preserves fetch options", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (...args) => {
    requests.push(args);
    return new Response('{"ok":true}', { headers: { "Content-Type": "application/json" } });
  });
  const signal = new AbortController().signal;
  const options = { cache: "no-store", credentials: "omit", signal };
  configureDataBaseUrl("");
  assert.deepEqual((await loadMeasuredJsonResource("data/x.json", options)).payload, { ok: true });
  configureDataBaseUrl("https://cdn.example.com/assets");
  assert.deepEqual((await loadMeasuredJsonResource("data/x.json", options)).payload, { ok: true });
  assert.deepEqual(requests, [
    ["data/x.json", options],
    ["https://cdn.example.com/assets/data/x.json", options],
  ]);
});
