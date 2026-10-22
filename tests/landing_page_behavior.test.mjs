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
const LANDING_HTML = readFileSync(new URL("../landing/index.html", import.meta.url), "utf8");
const LANDING_APP = readFileSync(new URL("../landing/app.js", import.meta.url), "utf8");
const PUBLIC_SCENARIO_IDS = ["blank_base", "modern_world", "hoi4_1936", "hoi4_1939", "tno_1962"];

function parseAttributes(source) {
  const attributes = new Map();
  for (const match of source.matchAll(/\s([a-zA-Z0-9:-]+)(?:="([^"]*)")?/g)) attributes.set(match[1], match[2] ?? "");
  return attributes;
}

function links(html, marker) {
  return [...html.matchAll(new RegExp(`<a\\b([^>]*\\b${marker}\\b[^>]*)>`, "g"))].map((match) => parseAttributes(match[1]));
}

function keysUsed(attribute) {
  return [...new Set([...LANDING_HTML.matchAll(new RegExp(`${attribute}="([^"]+)"`, "g"))].map((match) => match[1]))];
}

test("landing local asset references exist", () => {
  const referencedAssets = new Set();
  for (const source of [LANDING_HTML, LANDING_APP]) {
    for (const match of source.matchAll(/\.\/assets\/[^"')\s`$]+/g)) referencedAssets.add(match[0]);
  }
  assert.ok(referencedAssets.size > 0, "expected landing page to reference local assets");
  for (const assetPath of referencedAssets) {
    assert.ok(existsSync(new URL(`../landing/${assetPath.slice(2)}`, import.meta.url)), `missing landing asset: ${assetPath}`);
  }
});

test("every starting world links to its sample project and editor entry", () => {
  const manifest = JSON.parse(readFileSync(new URL("../landing/assets/sample-runs.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.public_scenario_ids, PUBLIC_SCENARIO_IDS);
  const downloads = links(LANDING_HTML, "data-sample-project-list-link");
  const openLinks = new Set(links(LANDING_HTML, "data-sample-project-open-link").map((link) => link.get("href")));
  assert.deepEqual(
    downloads.map((link) => link.get("href")).sort(),
    manifest.sample_projects.map((project) => project.project_url).sort(),
  );
  for (const project of manifest.sample_projects) {
    const link = downloads.find((candidate) => candidate.get("href") === project.project_url);
    assert.equal(link.get("data-sample-scenario"), project.scenario_id, `${project.id} scenario`);
    assert.ok(openLinks.has(`./app/?sample=${project.id}&view=guide`), `${project.id} editor link missing`);
    assert.ok(existsSync(new URL(`../landing/${project.project_url.slice(2)}`, import.meta.url)), `${project.id} project file missing`);
  }
});

test("both languages translate every key the page uses", () => {
  assert.deepEqual(LANGUAGES, ["en", "zh"]);
  assert.deepEqual(Object.keys(COPY.zh).sort(), Object.keys(COPY.en).sort(), "English and Chinese tables must have the same keys");
  for (const attribute of ["data-i18n", "data-i18n-aria-label", "data-i18n-list"]) {
    for (const key of keysUsed(attribute)) {
      for (const language of LANGUAGES) {
        assert.equal(typeof COPY[language][key], "string", `${language} copy missing for ${attribute}="${key}"`);
        assert.ok(COPY[language][key].trim(), `${language} copy empty for ${key}`);
      }
    }
  }
  for (const key of keysUsed("data-i18n-list")) {
    assert.equal(COPY.en[key].split("|").length, COPY.zh[key].split("|").length, `${key} lists differ in length`);
  }
  for (const language of LANGUAGES) {
    assert.match(COPY[language].paintCount(3), /3/);
    for (const state of ["1936", "1939", "1962", "modern", "blank"]) {
      assert.ok(COPY[language].stateNames[state] && COPY[language].stateDates[state], `${language} ${state} labels`);
    }
  }
});

test("the starting-world picker covers every map state the stage can show", () => {
  const stage = JSON.parse(readFileSync(new URL("../landing/assets/history-scrubber.json", import.meta.url), "utf8"));
  const worlds = [...LANDING_HTML.matchAll(/data-world="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(worlds, ["blank", "modern", "1936", "1939", "1962"]);
  const stateIds = stage.states.map((state) => state.id);
  for (const world of worlds.filter((world) => world !== "blank")) assert.ok(stateIds.includes(world), `stage has no ${world} state`);
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
