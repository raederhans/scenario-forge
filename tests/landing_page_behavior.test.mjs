import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { COPY, LANGUAGES } from "../landing/i18n.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const explicitArtifactRoot = String(process.env.SCENARIO_FORGE_PAGES_ARTIFACT_ROOT || "").trim();
const pagesRoot = path.resolve(REPO_ROOT, explicitArtifactRoot || "dist");
if (explicitArtifactRoot) {
  const relative = path.relative(path.join(REPO_ROOT, ".runtime"), pagesRoot);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}
const PAGES_DIST_RELATIVE = path.relative(REPO_ROOT, pagesRoot).replaceAll("\\", "/");
const PUBLIC_SCENARIO_IDS = ["blank_base", "modern_world", "hoi4_1936", "hoi4_1939", "tno_1962"];

// Page-level behaviour (assets load, links, world picker, language switch) is covered by
// tests/e2e/golden/landing_flows.spec.js in a real browser.

test("every published sample project file exists", () => {
  const manifest = JSON.parse(readFileSync(new URL("../landing/assets/sample-runs.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.public_scenario_ids, PUBLIC_SCENARIO_IDS);
  assert.deepEqual(manifest.sample_projects.map((project) => project.scenario_id).sort(), [...PUBLIC_SCENARIO_IDS].sort());
  for (const project of manifest.sample_projects) {
    assert.ok(existsSync(new URL(`../landing/${project.project_url.slice(2)}`, import.meta.url)), `${project.id} project file missing`);
  }
});

test("both language tables have the same keys and non-empty copy", () => {
  assert.deepEqual(LANGUAGES, ["en", "zh"]);
  assert.deepEqual(Object.keys(COPY.zh).sort(), Object.keys(COPY.en).sort(), "English and Chinese tables must have the same keys");
  for (const language of LANGUAGES) {
    for (const [key, value] of Object.entries(COPY[language])) {
      if (typeof value === "string") assert.ok(value.trim(), `${language} copy empty for ${key}`);
      if (typeof value === "string" && typeof COPY.en[key] === "string" && COPY.en[key].includes("|")) {
        assert.equal(value.split("|").length, COPY.en[key].split("|").length, `${key} lists differ in length`);
      }
    }
    assert.match(COPY[language].paintCount(3), /3/);
    for (const state of ["1936", "1939", "1962", "modern", "blank"]) {
      assert.ok(COPY[language].stateNames[state] && COPY[language].stateDates[state], `${language} ${state} labels`);
    }
  }
});

test("landing work-card maps expose source-backed metadata", () => {
  for (const assetRoot of ["landing", PAGES_DIST_RELATIVE]) {
    for (const fileName of ["work-alt-history-med.json", "work-scenario-switch-europe.json", "work-atlas-japan-corridor.json"]) {
      const metadataUrl = new URL(`../${assetRoot}/assets/${fileName}`, import.meta.url);
      assert.ok(existsSync(metadataUrl), `missing ${assetRoot} work-card metadata: ${fileName}`);
      const metadata = JSON.parse(readFileSync(metadataUrl, "utf8"));
      assert.equal(metadata.schema_version, 1);
      assert.equal(metadata.asset_type, "landing_work_card_map");
      assert.equal(metadata.scope?.bbox?.length, 4);
      assert.ok(metadata.sources?.length >= 3, `expected source list for ${assetRoot}/${fileName}`);
      for (const sourcePath of metadata.sources) {
        assert.ok(existsSync(new URL(`../${sourcePath}`, import.meta.url)), `missing source for ${assetRoot}/${fileName}: ${sourcePath}`);
      }
      assert.ok(Object.values(metadata.counts || {}).some((value) => Number(value) > 0), `expected rendered counts for ${assetRoot}/${fileName}`);
    }
  }
});

test("TNO work-card map uses dissolved detail sources without visible topology blocks", () => {
  for (const assetRoot of ["landing", PAGES_DIST_RELATIVE]) {
    const svg = readFileSync(new URL(`../${assetRoot}/assets/work-alt-history-med.svg`, import.meta.url), "utf8");
    const metadata = JSON.parse(readFileSync(new URL(`../${assetRoot}/assets/work-alt-history-med.json`, import.meta.url), "utf8"));
    assert.ok(svg.includes('class="political-countries"'), `missing dissolved country layer for ${assetRoot}`);
    assert.ok(!svg.includes('class="scenario-water"'), `TNO work map must not render blocky scenario water for ${assetRoot}`);
    assert.equal(
      metadata.counts?.rendered_atlantropa_features,
      metadata.counts?.source_atlantropa_features,
      `TNO Atlantropa work map must render all clipped Atlantropa features for ${assetRoot}`,
    );
    assert.ok(Number(metadata.counts?.dissolved_country_owners) > 0, `missing dissolved owner count for ${assetRoot}`);
  }
});
