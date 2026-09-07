import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readText = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function extractFunction(source, functionName) {
  const startToken = `function ${functionName}`;
  const start = source.indexOf(startToken);
  assert.notEqual(start, -1, `${functionName} must exist`);
  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `${functionName} must have a body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`${functionName} body must close`);
}

test("ocean depth intensity channel is registered as a background pass mask", () => {
  const source = readText("js/core/intensity_field.js");

  assert.match(source, /oceanDepth:\s*Object\.freeze\(\{/);
  assert.match(source, /id:\s*"oceanDepth"/);
  assert.match(source, /targetPasses:\s*Object\.freeze\(\["background"\]\)/);
  assert.match(source, /applyMode:\s*"passMask"/);
});

test("background render pass composes ocean depth mask after ocean style", () => {
  const source = readText("js/core/map_renderer.js");
  const backgroundOwnerSource = readText("js/core/renderer/political_background_render_owner.js");
  const oceanOwnerSource = readText("js/core/renderer/ocean_render_owner.js");
  const rootDrawBackgroundBody = extractFunction(source, "drawBackgroundPass");
  const drawBackgroundBody = extractFunction(backgroundOwnerSource, "drawBackgroundPass");
  const depthLayerBody = extractFunction(backgroundOwnerSource, "drawOceanDepthMaskLayer");
  const drawOceanStyleBody = extractFunction(source, "drawOceanStyle");

  assert.match(source, /import \{ createPoliticalBackgroundRenderOwner \} from "\.\/renderer\/political_background_render_owner\.js";/);
  assert.match(rootDrawBackgroundBody, /return getPoliticalBackgroundRenderOwner\(\)\.drawBackgroundPass\(\);/);
  assert.match(source, /commitIntensityFieldsState: \(intensityFields\) => \{\s*runtimeState\.intensityFields = intensityFields;/);
  assert.match(source, /import \{ createOceanRenderOwner \} from "\.\/renderer\/ocean_render_owner\.js";/);
  assert.match(source, /function getOceanRenderOwner\(\)/);
  assert.match(drawOceanStyleBody, /return getOceanRenderOwner\(\)\.drawOceanStyle\(\);/);
  assert.doesNotMatch(drawOceanStyleBody, /getBathymetryFeatureCollections\(\)/);
  assert.match(oceanOwnerSource, /export function createOceanRenderOwner/);
  assert.match(oceanOwnerSource, /function drawOceanStyle\(\)/);
  assert.match(oceanOwnerSource, /runtimeState\.oceanMaskMode = OCEAN_MASK_MODE_BATHYMETRY/);
  assert.match(source, /getIntensityFieldMaskOwner,/);
  assert.match(readText("js/core/renderer/render_pass_signature_policy.js"), /`field:oceanDepth:\$\{Number\(intensityFields\.channels\.oceanDepth\?\.revision \|\| 0\)\}`/);
  assert.ok(drawBackgroundBody.indexOf("drawOceanStyle();") < drawBackgroundBody.indexOf("drawOceanDepthMaskLayer();"));
  assert.match(depthLayerBody, /getIntensityFieldMaskOwner\(\)\.getMaskCanvas\("oceanDepth"/);
  assert.match(depthLayerBody, /commitIntensityFieldsState\(intensityFields\)/);
  assert.match(depthLayerBody, /applyOceanClipMask\(state\.oceanMaskMode \|\| OCEAN_MASK_MODE_TOPOLOGY\)/);
  assert.match(depthLayerBody, /surface\.getContext\(\)\.globalCompositeOperation = OCEAN_DEPTH_MASK_BLEND_MODE/);
  assert.match(depthLayerBody, /surface\.getContext\(\)\.setTransform\(1, 0, 0, 1, 0, 0\)/);
  assert.match(depthLayerBody, /surface\.getContext\(\)\.drawImage\(maskResult\.canvas, 0, 0\)/);
});

test("ocean appearance panel binds depth field editor to oceanDepth", () => {
  const controller = readText("js/ui/toolbar/ocean_lake_controls_controller.js");
  const markup = readText("index.html");

  assert.match(controller, /createIntensityFieldEditorNodes\(documentRef,\s*\{\s*prefix:\s*"oceanDepthField"/);
  assert.match(controller, /channelIds:\s*\["oceanDepth"\]/);
  assert.match(controller, /defaultChannelId:\s*"oceanDepth"/);
  assert.match(controller, /oceanDepthFieldEditor\.render\(\)/);
  assert.match(controller, /oceanDepthFieldEditor\.bindEvents\(\)/);
  [
    "oceanDepthFieldEnabled",
    "oceanDepthFieldToolToggleBtn",
    "oceanDepthFieldPaintBtn",
    "oceanDepthFieldEraseBtn",
    "oceanDepthFieldPointsBtn",
    "oceanDepthFieldWeight",
    "oceanDepthFieldWeightValue",
    "oceanDepthFieldRadius",
    "oceanDepthFieldRadiusValue",
    "oceanDepthFieldClearBtn",
    "oceanDepthFieldPointCount",
    "oceanDepthFieldPointList",
  ].forEach((id) => {
    assert.match(markup, new RegExp(`id="${id}"`));
  });
});
