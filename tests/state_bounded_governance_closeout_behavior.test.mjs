import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { inspectPoliticalGpuResourceOrigin, POLITICAL_GPU_RESOURCE_PATH } from "../tools/state_resource_origin_contract.mjs";
import { inspectVisualPaintInputSites, VISUAL_PAINT_ACTION_PATH } from "../tools/state_visual_paint_contract.mjs";
import { inspectBoundedGovernanceSourceRefresh } from "../tools/state_governance_source_refresh.mjs";
import { discoverStateWriterBindingsForSource, validateStateActionNonTargetParameterMutations } from "../tools/build_state_writer_policy.mjs";
import { scanStateMutations } from "../tools/state_writer_inventory.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\r\n?/g, "\n");
const ownerPath = "js/core/renderer/political_id_raster_runtime_owner.js";
const rendererPath = "js/core/map_renderer.js";
const sourcePaths = [POLITICAL_GPU_RESOURCE_PATH, ownerPath, rendererPath];

test("GPU canvas origin is resource-only while canonical width and height remain state writes", async () => {
  assert.deepEqual(inspectPoliticalGpuResourceOrigin().violations, []);
  const source = read(POLITICAL_GPU_RESOURCE_PATH);
  const discovered = await discoverStateWriterBindingsForSource(POLITICAL_GPU_RESOURCE_PATH, source, "production", { scanAllParameters: true, includeInventories: true });
  assert.ok(!discovered.bindings.some((binding) => binding.parameterPath === "$/property:canvas"));
  for (const fixture of [
    'export function resize(state) { state.width = 1; state.height = 2; }',
    'export function resize(state) { const canvas = state; canvas.width = 1; }',
  ]) {
    const result = await discoverStateWriterBindingsForSource("js/fixture/real_state_dimensions.js", fixture, "production", { scanAllParameters: true, includeInventories: true });
    assert.ok(result.bindingInventories.some((row) => row.findings.some((finding) => finding.key === "width" && !finding.unsupported)));
  }
});

test("GPU resource receipt rejects state canvas, provider replacement, callback writes and import drift", () => {
  for (const [file, before, after] of [
    [POLITICAL_GPU_RESOURCE_PATH, "canvas = new OffscreenCanvas(1, 1)", "canvas = state"],
    [ownerPath, "createGpu({ onContextLost:", "createGpu({ canvas: state, onContextLost:"],
    [ownerPath, "createGpu = createPoliticalIdRasterGpu", "createGpu = replacementProvider"],
    [ownerPath, "stats.contextLosses++;", "state.width = 0; stats.contextLosses++;"],
    [ownerPath, 'from "./political_id_raster_gpu.js"', 'from "./replacement_gpu.js"'],
    [rendererPath, "politicalIdRasterRuntimeOwner ||= createPoliticalIdRasterRuntimeOwner({",
      "politicalIdRasterRuntimeOwner ||= createPoliticalIdRasterRuntimeOwner({ createGpu: replacementProvider,"],
  ]) {
    const source = read(file);
    assert.ok(source.includes(before), before);
    const result = inspectPoliticalGpuResourceOrigin({ sourcePaths,
      readSource: (path) => path === file ? source.replace(before, after) : read(path) });
    assert.equal(result.binding, null, after);
    assert.ok(result.violations.length, after);
  }
});

test("GPU resource receipt rejects new static, reexport and dynamic consumers", () => {
  for (const source of [
    'import { createPoliticalIdRasterGpu } from "../core/renderer/political_id_raster_gpu.js"; createPoliticalIdRasterGpu({ canvas: state });',
    'export * from "../core/renderer/political_id_raster_gpu.js";',
    'import("../core/renderer/political_id_raster_gpu.js");',
    'import("/js/core/renderer/political_id_raster_gpu.js");',
    'import(prefix + suffix);',
  ]) {
    const extra = "js/fixture/new_resource_consumer.js";
    const result = inspectPoliticalGpuResourceOrigin({ sourcePaths: [...sourcePaths, extra],
      readSource: (path) => path === extra ? source : read(path) });
    assert.equal(result.binding, null, source);
    assert.ok(result.violations.length, source);
  }
  const provider = "js/core/data_service.js";
  assert.equal(inspectPoliticalGpuResourceOrigin({ sourcePaths: [...sourcePaths, provider],
    readSource: (path) => path === provider ? read(path).replace('"js/core/city_lights_modern_asset.js"', '"js/core/renderer/political_id_raster_gpu.js"') : read(path),
  }).binding, null);
});

test("visual paint input receipts retain mutation and normalizer dependency rejections", async () => {
  const source = read(VISUAL_PAINT_ACTION_PATH);
  assert.equal(inspectVisualPaintInputSites(source).sites.size, 2);
  assert.deepEqual(await validateStateActionNonTargetParameterMutations(VISUAL_PAINT_ACTION_PATH, source), []);
  for (const [before, after] of [
    ['String(id ?? "").trim()', '(id.name = "changed", String(id ?? "").trim())'],
    ["normalizeHexColor(value)", "replacementNormalizer(value)"],
    ["const ids = Array.from", "featureIds.push('changed'); const ids = Array.from"],
  ]) {
    const changed = source.replace(before, after);
    assert.notEqual(changed, source);
    assert.equal(inspectVisualPaintInputSites(changed).sites.size, 0);
    assert.ok((await validateStateActionNonTargetParameterMutations(VISUAL_PAINT_ACTION_PATH, changed)).length);
  }
  assert.equal(inspectVisualPaintInputSites(source, {
    readSource: (path) => path === "js/core/color_hex_utils.js" ? read(path).replace('const input = String(value', 'value.changed = true; const input = String(value') : read(path),
  }).sites.size, 0);
});

test("cleared river paint retains borrowed result taint while changed ID lists are detached", () => {
  const scan = (tail) => scanStateMutations([
    'import { state as runtimeState } from "./state.js";',
    'import { clearRiverCellOverrides } from "./river_paint/partition_model.js";',
    'const result = clearRiverCellOverrides(runtimeState.riverPaint, ["parent"]);',
    tail,
  ].join("\n"), { filePath: "js/core/paint_borrow_fixture.js", derivedAliasTaintMode: "strict",
    bindings: [{ id: "module:runtimeState", kind: "module", name: "runtimeState", importSource: "./state.js", importedName: "state" }] });
  assert.deepEqual(scan('result.changedCellIds.push("local");'), []);
  assert.ok(scan('result.paint.overrides.changed = "#000000";').length);
  assert.ok(scan('const alias = result.paint; publish(alias);').length);
});

test("retirement source refreshes require the exact body transfer and preserve historical anchors", () => {
  const historical = (revision, file) => execFileSync("git", ["show", `${revision}:${file}`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  for (const [modulePath, sourceFingerprint] of [
    [rendererPath, "93c5f0e16585f8ff9916c3fe2d884c191aa9aa479b8967256e8be842e2893c81"],
    ["js/core/state/color_state.js", "7f8c97d4a14f27f97b39e0385eabda857204529880b39e807d3d168b42892e59"],
    ["js/core/state/actions/scenario_activation_actions.js", "4dda5e6240f1eaaf632f60f8360905fcfcb8d93d2773d0398af0292423c61e0e"],
  ]) {
    const options = { modulePath, sourceFingerprint, source: read(modulePath), readCurrentSource: read, readHistoricalSource: historical };
    assert.equal(inspectBoundedGovernanceSourceRefresh(options), true, modulePath);
    assert.equal(inspectBoundedGovernanceSourceRefresh({ ...options, source: options.source + "\nstate.featureOverrides = {};" }), false);
    assert.equal(inspectBoundedGovernanceSourceRefresh({ ...options, readHistoricalSource: () => options.source }), false);
    if (modulePath !== rendererPath) assert.equal(inspectBoundedGovernanceSourceRefresh({ ...options,
      readCurrentSource: (path) => path === VISUAL_PAINT_ACTION_PATH ? read(path).replace("target.visualOverrides[id] = color;", "target.featureOverrides[id] = color;") : read(path),
    }), false);
  }
});
