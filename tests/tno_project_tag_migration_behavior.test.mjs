import assert from "node:assert/strict";
import test from "node:test";

import { TNO_TAG_MIGRATION_VERSION, migrateTnoProjectTags } from "../js/core/country_code_aliases.js";

const project = (version, colors, active) => ({
  scenario: { id: "tno_1962", ...(version ? { tagMigrationVersion: version } : {}) },
  sovereignBaseColors: colors,
  ...(active ? { activeSovereignCode: active } : {}),
});

test("an unversioned TNO project runs every tag migration step in order", () => {
  const result = migrateTnoProjectTags(project(0, { GUI: "#111111", GY: "#222222", BZ: "#333333" }, "BZ"));
  assert.equal(result.scenario.tagMigrationVersion, TNO_TAG_MIGRATION_VERSION);
  assert.deepEqual(result.sovereignBaseColors, { GUZ: "#111111", GUY: "#222222", BLZ: "#333333" });
  assert.equal(result.activeSovereignCode, "BLZ");
});

test("a version-1 TNO project only runs the later steps", () => {
  // GUI saved after version 1 already means Guinea and must not become Guizhou.
  const result = migrateTnoProjectTags(project(1, { GUI: "#111111", GY: "#222222" }));
  assert.deepEqual(result.sovereignBaseColors, { GUI: "#111111", GUY: "#222222" });
});

test("current TNO projects and other scenarios are left unchanged", () => {
  const current = project(TNO_TAG_MIGRATION_VERSION, { GY: "#222222" });
  assert.equal(migrateTnoProjectTags(current), current);
  const hoi4 = { scenario: { id: "hoi4_1936" }, sovereignBaseColors: { GY: "#222222" } };
  assert.equal(migrateTnoProjectTags(hoi4), hoi4);
});

test("a legacy tag wins over the tag it migrates into", () => {
  const result = migrateTnoProjectTags(project(0, { GSW: "#aaaaaa", ANG: "#bbbbbb" }));
  assert.deepEqual(result.sovereignBaseColors, { ANG: "#aaaaaa" });
});
