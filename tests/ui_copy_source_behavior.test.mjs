import test from "node:test";
import assert from "node:assert/strict";
import { validateCatalog } from "../tools/build_ui_copy.mjs";

test("catalog validation accepts both plural forms", () => {
  const entry = { en: { one: "{count} item", other: "{count} items" }, zh: "{count} 项" };
  assert.doesNotThrow(() => validateCatalog({ Count: entry }));
});

test("catalog validation rejects a missing translation placeholder", () => {
  const invalid = { en: "{count} items", zh: "项目" };
  assert.throws(() => validateCatalog({ Invalid: invalid }), /Invalid/);
});
