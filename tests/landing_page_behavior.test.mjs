import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const explicitArtifactRoot = String(process.env.SCENARIO_FORGE_PAGES_ARTIFACT_ROOT || "").trim();
const pagesRoot = path.resolve(REPO_ROOT, explicitArtifactRoot || "dist");
if (explicitArtifactRoot) {
  const relative = path.relative(path.join(REPO_ROOT, ".runtime"), pagesRoot);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}
const PAGES_DIST_RELATIVE = path.relative(REPO_ROOT, pagesRoot).replaceAll("\\", "/");

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
