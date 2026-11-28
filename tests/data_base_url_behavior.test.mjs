import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  configureDataBaseUrl,
  resolveDataUrl,
} from "../js/core/data_base_url.js";

afterEach(() => configureDataBaseUrl(""));

test("base normalization and data paths", () => {
  for (const base of [" https://cdn.example.com/assets ", "https://cdn.example.com/assets/"]) {
    assert.equal(configureDataBaseUrl(base), "https://cdn.example.com/assets/");
    for (const path of ["data/x", "./data/x"]) {
      assert.equal(resolveDataUrl(path), "https://cdn.example.com/assets/data/x");
    }
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
