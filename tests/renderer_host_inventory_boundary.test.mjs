import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

function readRepoFile(...parts) {
  const absolutePath = path.join(REPO_ROOT, ...parts);
  assert.ok(fs.existsSync(absolutePath), `Expected repository file to exist: ${parts.join("/")}`);
  return fs.readFileSync(absolutePath, "utf8");
}

function assertIncludes(source, token, message) {
  assert.ok(source.includes(token), `${message}: missing token ${JSON.stringify(token)}`);
}

function assertExcludes(source, token, message) {
  assert.ok(!source.includes(token), `${message}: unexpected token ${JSON.stringify(token)}`);
}

test("renderer host inventory files exist", () => {
  readRepoFile("js", "core", "map_renderer.js");
  readRepoFile("js", "core", "map_renderer", "public.js");
  readRepoFile("tools", "check_architecture_boundaries.mjs");
  readRepoFile("docs", "active", "renderer-host-audit-20260625.md");
});

test("public renderer facade stays re-exported from map_renderer", () => {
  const publicSource = readRepoFile("js", "core", "map_renderer", "public.js");
  assert.match(
    publicSource,
    /from\s+["']\.\.\/map_renderer\.js["']/,
    "public.js must continue to re-export the stable facade from ../map_renderer.js.",
  );

  const categories = {
    lifecycle: ["buildInteractionInfrastructureAfterStartup", "initMap", "render", "setMapData"],
    selectionFill: ["addFeatureToDevSelection", "applyDevSelectionFill", "autoFillMap"],
    overlay: [
      "startOperationalLineDraw",
      "startOperationGraphicDraw",
      "startUnitCounterPlacement",
      "startSpecialZoneDraw",
    ],
    invalidationRefresh: [
      "invalidateAllRenderPasses",
      "refreshColorState",
      "reconcileDetailPromotionPoliticalPass",
    ],
    diagnosticsExportPass: ["renderExportPassesToCanvas", "renderLegend", "RENDER_PASS_NAMES"],
    viewport: ["getZoomPercent", "resetZoomToFit", "setZoomPercent", "zoomByStep"],
  };

  for (const [category, tokens] of Object.entries(categories)) {
    for (const token of tokens) {
      assertIncludes(publicSource, token, `public facade category ${category} must keep ${token}`);
    }
  }
});

test("architecture boundary tool tracks renderer host and budgets", () => {
  const architectureSource = readRepoFile("tools", "check_architecture_boundaries.mjs");
  for (const token of ["js/core/map_renderer.js", "LINE_BUDGETS", "[FILES.renderer]"]) {
    assertIncludes(architectureSource, token, "architecture boundary tool must keep renderer host guard");
  }
});

test("renderer host imports current owner and runtime modules", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");
  const requiredTokens = [
    "createRenderPipelinePassesOwner",
    "createDayNightRuntimeOwner",
    "createRenderCacheOwner",
    "createScenarioRefreshRuntime",
    "createExactAfterSettleScheduler",
    "CANVAS_LAYER_NAMES",
    "createSpatialIndexRuntimeOwner",
    "./map_renderer/render_pass_catalog.js",
  ];

  for (const token of requiredTokens) {
    assertIncludes(rendererSource, token, "renderer host must keep expected owner/runtime import token");
  }

  assertIncludes(
    rendererSource,
    'export { RENDER_PASS_NAMES } from "./map_renderer/render_pass_catalog.js";',
    "renderer host must continue to re-export RENDER_PASS_NAMES",
  );
});

test("renderer host no longer owns render pass catalog definitions", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");
  const forbiddenTokens = [
    "export const RENDER_PASS_NAMES = [",
    "const TRANSFORM_REUSED_RENDER_PASS_NAMES = new Set([",
    "const VIEWPORT_STABLE_RENDER_PASS_SIGNATURE_NAMES = new Set([",
    "const INTERACTION_COMPOSITE_PASS_NAMES = [",
    "const TRANSFORMED_FRAME_PASS_NAMES = [",
    "const RENDER_PASS_OVERSCAN_RATIO_PER_SIDE =",
  ];

  for (const token of forbiddenTokens) {
    assertExcludes(rendererSource, token, "renderer host must not define render pass catalog locally");
  }
});

test("P9 renderer host audit document keeps extraction ranking anchor", () => {
  const auditSource = readRepoFile("docs", "active", "renderer-host-audit-20260625.md");
  assertIncludes(
    auditSource,
    "## Extraction candidate ranking",
    "P9 audit doc must keep the extraction candidate ranking heading",
  );
});

test("package exposes the renderer host inventory script", () => {
  const packageSource = readRepoFile("package.json");
  assertIncludes(
    packageSource,
    '"test:node:renderer-host-inventory": "node --test tests/renderer_host_inventory_boundary.test.mjs"',
    "package.json must expose renderer host inventory test script",
  );
});
