from pathlib import Path
import shutil
import subprocess

root = Path('.')
payload = Path('.runtime/part2-payload')
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip() == '33b9f754d1e55298450ecca34e75d404b3f20906'

def replace(text, old, new):
    assert text.count(old) == 1, (old[:100], text.count(old))
    return text.replace(old, new)

for src, dst in [
    ('display-cache.js', 'js/core/renderer/political_id_raster_display_cache.js'),
    ('cache-tests.mjs', 'tests/political_id_raster_display_cache_behavior.test.mjs'),
    ('profile.mjs', 'tools/profile_political_raster.mjs'),
]:
    assert not Path(dst).exists(), dst
    shutil.copyfile(payload / src, dst)

p = Path('js/core/renderer/political_id_raster_runtime_owner.js')
s = p.read_text()
s = 'import { createPoliticalIdRasterDisplayCache } from "./political_id_raster_display_cache.js";\n' + s
s = replace(s, '  createGpu = createPoliticalIdRasterGpu, resourceBudget = null,', '  createGpu = createPoliticalIdRasterGpu, resourceBudget = null,\n  createDisplayCache = createPoliticalIdRasterDisplayCache,')
s = replace(s, '  const persistent = displayMode === "raster";', '''  const persistent = displayMode === "raster";
  // Diagnostic A/B only; no persisted preference or change to auto eligibility.
  const displayCache = persistent && new URLSearchParams(globalThis.location?.search || "").get("political_raster_present") !== "full"
    ? createDisplayCache() : null;
  let tileDependencies = new WeakMap(), lastTiming = null;''')
s = replace(s, '    const assets = assetStore?.stats();\n    resourceBudget?.update', '''    const assets = assetStore?.stats();
    const presentation = displayCache?.getStats();
    const dependencyBytes = displayCache ? cache.entries().reduce((sum, [, tile]) => sum + (tileDependencies.get(tile)?.byteLength || 0), 0) : 0;
    resourceBudget?.update''')
s = replace(s, '        + (assets?.memoryBytes || 0),', '        + (assets?.memoryBytes || 0) + (presentation?.paletteSnapshotBytes || 0) + dependencyBytes,')
s = replace(s, '      workerSurfaces: (graphics?.outputSurfaceBytesEstimate || 0)', '      workerSurfaces: (graphics?.outputSurfaceBytesEstimate || 0) + (presentation?.retainedSurfaceBytes || 0)')
s = replace(s, '  function releaseGpu() { gpu?.dispose(); gpu = null; gpuTiles = []; }', '  function releaseGpu() { gpu?.dispose(); gpu = null; gpuTiles = []; displayCache?.reset(); }')
s = replace(s, '    coordinates = canonicalCoordinates ? createPoliticalIdRasterCoordinateSpace(options) : null;', '    if (fittedProjectionKey !== nextFitKey || (canonicalCoordinates && !coordinates)) {\n      coordinates = canonicalCoordinates ? createPoliticalIdRasterCoordinateSpace(options) : null;\n    }')
s = replace(s, '      cache.set(descriptor.key, tile, descriptor);', '''      cache.set(descriptor.key, tile, descriptor);
      // Conservative contributor set from the validated build/asset identity.
      // It includes fill and stroke contributors, never a second ID namespace.
      if (displayCache) tileDependencies.set(tile, Uint32Array.from(entries, entry => entry.code));''')
pre, draw = s.split('  function draw() {', 1)
draw = replace(draw, '      syncSource();\n      if (!updatePlan())', '      syncSource();\n      const sourceDoneAt = performance.now();\n      if (!updatePlan())')
draw = replace(draw, '      const startedAt = performance.now();\n      gpu.setPalette', '      const startedAt = performance.now();\n      gpu.setPalette') if False else draw
draw = replace(draw, '        + plan.width * plan.height * 4 + Math.ceil(snapshot.palette.length / 4096) * 4096;', '''        // Include BOTH temporary GPU output and retained RGBA in the same
        // unchanged 80 MiB admission limit, before either allocation.
        + plan.width * plan.height * 4 * (displayCache ? 2 : 1) + Math.ceil(snapshot.palette.length / 4096) * 4096;''')
draw = replace(draw, '''      gpu.setPalette(snapshot.palette, `${namespace}:${snapshot.paletteRevision}`);
      gpu.setTiles(tiles);
      gpuTiles = tiles;
      gpu.draw(plan);
      const context = surface.getContext();''', '''      const paletteKey = `${namespace}:${snapshot.paletteRevision}`;
      gpu.setPalette(snapshot.palette, paletteKey);
      const paletteDoneAt = performance.now();
      gpu.setTiles(tiles);
      gpuTiles = tiles;
      const tilesDoneAt = performance.now();
      let frame;
      if (displayCache) frame = displayCache.draw({ gpu, plan, tiles, palette: snapshot.palette,
        revision: paletteKey, dependencies: tile => tileDependencies.get(tile) });
      else { gpu.draw(plan); frame = gpu.canvas; }
      const rasterDoneAt = performance.now();
      const context = surface.getContext();''')
draw = replace(draw, '        context.drawImage(gpu.canvas, plan.outputX, plan.outputY, plan.outputWidth, plan.outputHeight);', '        context.drawImage(frame, plan.outputX, plan.outputY, plan.outputWidth, plan.outputHeight);')
draw = replace(draw, '      } finally { context.restore(); }\n      const renderedIds', '      } finally { context.restore(); }\n      const compositeDoneAt = performance.now();\n      const renderedIds')
draw = replace(draw, '      lastDrawTotalMs = performance.now() - drawStartedAt;', '''      lastDrawTotalMs = performance.now() - drawStartedAt;
      const presentation = displayCache?.getStats();
      lastTiming = { sourceMs: sourceDoneAt - drawStartedAt, planningMs: startedAt - sourceDoneAt,
        paletteUploadMs: paletteDoneAt - startedAt, tileBindingMs: tilesDoneAt - paletteDoneAt,
        rasterMs: rasterDoneAt - tilesDoneAt, gpuSubmitMs: presentation?.lastGpuMs ?? rasterDoneAt - tilesDoneAt,
        captureMs: presentation?.lastCaptureMs || 0, targetCompositeMs: compositeDoneAt - rasterDoneAt,
        finishMs: performance.now() - compositeDoneAt, totalMs: lastDrawTotalMs,
        phase: "CPU wall time including any browser synchronization; not GPU execution or presentation" };''')
draw = replace(draw, '      firstRasterReadyMs, lastDrawTotalMs, nativeRefinements, refinementPending:', '''      presentation: displayCache ? "retained-regions" : "full-gpu",
      presentationCache: displayCache?.getStats() || null, lastTiming: lastTiming && { ...lastTiming },
      firstRasterReadyMs, lastDrawTotalMs, nativeRefinements, refinementPending:''')
draw = replace(draw, '      identityBuilder.dispose();', '      identityBuilder.dispose();\n      displayCache?.dispose();\n      tileDependencies = new WeakMap();')
p.write_text(pre + '  function draw() {' + draw)

p = Path('tests/political_id_raster_runtime_owner_behavior.test.mjs')
s = p.read_text()
s = 'import { createPoliticalIdRasterDisplayCache } from "../js/core/renderer/political_id_raster_display_cache.js";\n' + s
s = replace(s, '    resourceBudget, refineAfterMs, displayMode,', '''    resourceBudget, refineAfterMs, displayMode,
    createDisplayCache: () => createPoliticalIdRasterDisplayCache({ createCanvas: (width, height) => ({
      width, height, getContext: () => ({ save() {}, restore() {}, setTransform() {}, clearRect() {}, drawImage() {} }),
    }) }),''')
s += '''

test("resident presentation reuses stable RGBA and accounts its retained surface", async t => {
  const updates = [];
  const f = fixture({ displayMode: "raster", resourceBudget: { update: (...args) => updates.push(args), release() {} } });
  t.after(() => f.owner.dispose());
  f.owner.draw(); await resolveAll(f); assert.ok(f.owner.draw());
  const before = f.owner.getDiagnostics();
  assert.ok(before.presentationCache.retainedSurfaceBytes > 0);
  assert.ok(f.owner.draw());
  const after = f.owner.getDiagnostics();
  assert.equal(after.presentationCache.reusedFrames, before.presentationCache.reusedFrames + 1);
  assert.equal(after.builds, before.builds);
  assert.equal(after.nativeRefinements, 0);
  assert.ok(updates.at(-1)[1].workerSurfaces >= after.presentationCache.retainedSurfaceBytes);
  assert.ok(after.lastTiming.totalMs >= 0);
  const count = after.presentationCache.fullUpdates;
  f.owner.loseContextForValidation(); assert.ok(f.owner.draw());
  assert.equal(f.owner.getDiagnostics().presentationCache.fullUpdates, count + 1);
});
'''
p.write_text(s)

p = Path('tools/verification/catalog/records/renderer_cache_pipeline.mjs')
s = p.read_text()
s = replace(s, 'tests/political_id_raster_runtime_owner_behavior.test.mjs tests/political_id_raster_runtime_assets_behavior.test.mjs', 'tests/political_id_raster_display_cache_behavior.test.mjs tests/political_id_raster_runtime_owner_behavior.test.mjs tests/political_id_raster_runtime_assets_behavior.test.mjs')
s = replace(s, '      "js/core/renderer/political_id_raster_runtime_owner.js",', '      "js/core/renderer/political_id_raster_runtime_owner.js",\n      "js/core/renderer/political_id_raster_display_cache.js",\n      "tests/political_id_raster_display_cache_behavior.test.mjs",')
s = replace(s, '      "tools/verify_political_raster_resident.mjs",', '      "tools/verify_political_raster_resident.mjs",\n      "tools/profile_political_raster.mjs",')
p.write_text(s)

Path('docs/active/political-raster-part2-20261012.md').write_text('''# Political raster, second delivery: R3/R4 revision

Baseline: 33b9f754d1e55298450ecca34e75d404b3f20906, building on the R0-R2 resident candidate in PR #229. Main remains b09a2e8e40895789924adee4305750fc642458d6. The earlier six PR workflows and independent five-case 1936 legacy regression completed successfully. They are evidence for the earlier commit, not this change.

## Revised execution contract

The first delivery proved resident rendering and canonical edit/history preservation, not stable acceleration. This delivery therefore moves performance attribution ahead of default admission. R3/R4 comprise retained-region RGBA presentation, explicit stage timings, separate pixel-quality checks, native/full-raster/retained-raster comparisons, and navigation/lifecycle verification. R5 prebuilt asset regeneration and raster-first startup, R6 default-on admission, general layer migration and Windows hardware-GPU acceptance remain gated subsequent deliveries. This is a revision of the execution order, not a claim that those later objectives are complete.

Canonical vector geometry, IDs, picking authority, palette and history stay unchanged. The new cache owns only disposable RGBA pixels and a palette byte snapshot. Source tile contributor codes conservatively determine recolor regions. Unknown contributors, palette namespace growth, geometry/grid changes, scene replacement and context loss cause full redraw. Identical raster-grid pans and unchanged palettes reuse the RGBA image. A changed color redraws one bounded union region, not individual per-tile WebGL readbacks. Transparent regions are cleared before copying. No resolution, projection precision or raster-ID interpolation is changed. Legacy hybrid still uses the original full GPU presentation.

Both retained RGBA and temporary GPU output are charged against the existing 80 MiB admission estimate before allocation; cache-owned palette and dependency arrays are accounted. Existing CPU/asset deadlines and resource limits are not enlarged. Diagnostic URL political_raster_present=full selects the previous full-GPU presentation only for paired comparison. It does not write user preferences. Automatic raster eligibility stays disabled.

## Verification and evidence

Focused regression: node --test tests/political_id_raster_display_cache_behavior.test.mjs tests/political_id_raster_runtime_owner_behavior.test.mjs tests/political_id_raster_runtime_assets_behavior.test.mjs

Main-app profiling: node tools/profile_political_raster.mjs --base-url http://127.0.0.1:8008/app/ --scenario hoi4_1939 --revision EXACT_COMMIT

The profiler separates untimed pixel validation from timed input/state/frame sampling. Timings describe input-to-observed-ready and CPU stage wall times, not presentation, GPU execution, INP, or universal FPS. Preserve outliers and report GPU environment. Full-raster versus retained-raster pixels are compared after cold activation, recolor/undo/redo and navigation. The native comparison is diagnostic because raster is intentionally approximate; this delivery must not introduce additional visual degradation relative to the preceding raster path.

Acceptance requires focused tests, architectural boundaries, three-scenario resident lifecycle, full-versus-retained pixel equivalence within the stated one-byte rounding tolerance, no warm geometry rebuilds/native redraws, bounded resource accounting, and inspectable performance results. A passing functional case is not an acceleration gate. A failing case keeps this candidate unaccepted rather than weakening assertions. Required final-head CI, merge and deploy remain distinct.

## Environment boundary

The interactive terminal and Python execution tools returned ClientError before any command ran in this conversation. No conclusion about the user's separately configured cloud workspace follows. Implementation and tests use the already connected repository and its isolated GitHub Actions bootstrap branch. No new cloud service, paid machine, credentials, main push, merge or deployment is created.

Results are recorded separately after execution, pinned to their tested revision. This document does not predeclare tests successful.
''')
print('Applied complete part-two candidate to exact owned baseline.')
