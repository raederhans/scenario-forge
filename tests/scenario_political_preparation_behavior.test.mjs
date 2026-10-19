import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { analyzeScenarioPoliticalDerivedStateCoverageChunked } from "../js/core/renderer/scenario_chunk_promotion_helpers.js";

const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
const start = source.indexOf("export async function prepareScenarioPoliticalChunkPromotion(");
const end = source.indexOf("\nfunction setMapData(", start);
assert.ok(start >= 0 && end > start, "exercise the renderer's actual political preparation function");
const functionSource = source.slice(start, end).replace("export async function", "async function");
const settle = () => new Promise((resolve) => setImmediate(resolve));
const feature = (id, color, interactive = true) => ({ id, color, interactive, geometry: {} });

test("country preparation holds publication and cancellation leaves the previous authority intact", async () => {
  const h = createHarness(), before = h.state.landDataFull;
  h.hold("countries");
  const pending = h.prepare({ globalCoverage: true, features: [feature("new", "blue")] });
  while (!h.held.length) await settle();
  assert.equal(h.state.landDataFull, before);
  assert.equal(h.calls.some(([name]) => name === "adopt-spatial"), false);
  h.invalidateSelection(); h.held.shift()();
  assert.equal((await pending).status, "cancelled");
  assert.equal(h.state.landDataFull, before);
});

test("border reset consumes privately prepared countries only for the adopted source features", () => {
  const begin = source.indexOf("function clearDeferredInternalBorderMeshCaches(");
  const end = source.indexOf("function buildDetailAdmMeshSignature(", begin);
  assert.ok(begin >= 0 && end > begin);
  for (const variant of ["full", "land", "stale", "cancelled", "missing"]) {
    const features = [feature("new", "blue")], fallback = { primary: new Set(["fallback"]), detail: new Set() };
    const state = { landDataFull: { features: variant === "land" ? [] : features }, landData: { features } };
    const prepared = { status: variant === "cancelled" ? "cancelled" : "prepared",
      sourceFeatures: variant === "stale" ? [...features] : features,
      sourceCountries: { primary: new Set(["CAN"]), detail: new Set(["USA"]) } };
    let scans = 0, adopted, snapshotCalls = 0;
    const reset = new Function("runtimeState", "getSourceCountrySets", "setStaticMeshSourceCountries", "getBorderMeshOwner",
      "resetVisibleInternalBorderMeshSignature", "resetDetailAdmMeshBuildState", "staticMeshCache", "syncStaticMeshSnapshot",
      source.slice(begin, end) + "return clearDeferredInternalBorderMeshCaches;")(state,
      () => { scans++; return fallback; }, value => { adopted = value; }, () => ({ replaceDetailAdmBorders() {} }),
      () => {}, () => {}, { snapshot: {} }, () => { snapshotCalls++; });
    reset(variant === "missing" ? undefined : { preparedSourceCountries: prepared });
    const valid = ["full", "land"].includes(variant);
    assert.equal(scans, valid ? 0 : 1, variant);
    assert.equal(adopted, valid ? prepared.sourceCountries : fallback, variant);
    assert.equal(state.cachedProvinceBorders.length, 0);
    assert.equal(state.cachedLocalBorders.length, 0);
    assert.equal(snapshotCalls, 1);
  }
});

test("prepared coverage is reused only for its exact adopted authority and paint revision", async () => {
  for (const mutation of ["paint", "payload", "interactive", "scene", "primary"]) {
    const h = createHarness();
    const payload = { globalCoverage: true, features: [feature("leaf", "blue"), feature("support", "gray", false)] };
    const prepared = await h.prepare(payload);
    h.state.scenarioPoliticalChunkData = { ...payload };
    h.state.scenarioPoliticalVisibleChunkData = null;
    const adopted = prepared.adopt();
    const coverage = adopted.getPreparedCoverage();
    assert.equal(coverage.landDataCoverageMissing, false);
    assert.equal(coverage.colorCoverageMissing, false);
    assert.equal(coverage.expectedInteractiveFeatureCount, 1);
    assert.equal(adopted.getPreparedCoverage(), coverage, "constant-time exact authority read");
    if (mutation === "paint") h.state.colorRevision++;
    if (mutation === "payload") h.state.scenarioPoliticalChunkData = { features: [...payload.features] };
    if (mutation === "interactive") h.state.landData = { features: [] };
    if (mutation === "scene") h.state.sceneGeneration++;
    if (mutation === "primary") h.state.scenarioPoliticalVisibleChunkData = { features: [payload.features[0]] };
    assert.equal(adopted.getPreparedCoverage(), null, mutation);
  }
});

function createHarness() {
  const previous = feature("old", "old-color");
  const collection = { features: [previous] };
  const state = { activeScenarioId: "tno_1962", sceneGeneration: 1, colorRevision: 4,
    landDataFull: collection, landData: collection, landIndex: new Map([[previous.id, previous]]),
    colors: { old: "old-color" }, scenarioAtlantropaData: { features: [] }, riversData: { features: [] } };
  const calls = [], colorReads = [], candidates = new WeakMap(), held = [];
  let selected = true, sceneActive = true, selectionCurrent = true, spatialGeneration = 0, projection = 1;
  let holdStage = null, onYield = () => {}, clock = 0;
  let describeDelta = () => null;
  const identity = () => [state.activeScenarioId, state.sceneGeneration, projection, state.landIndex];
  const yieldToMain = async () => { onYield(); await Promise.resolve(); };
  async function stage(name, options) {
    calls.push([name]);
    if (holdStage === name) {
      holdStage = null;
      await new Promise((resolve) => held.push(resolve));
    }
    await options.yieldControl();
  }
  const spatialOwner = {
    async preparePrimarySpatialCandidateChunked(options) {
      const version = ++spatialGeneration;
      calls.push(["spatial-input", options.features]);
      await stage("spatial", options);
      const candidate = { landIndex: new Map(options.features.map((f) => [f.id, f])) };
      candidates.set(candidate, () => version === spatialGeneration && options.isCurrent());
      return { status: "prepared", candidate, maxSliceMs: 1, yieldCount: 1, computedBounds: options.features.length, reusedItems: 0 };
    },
    isPrimarySpatialCandidateCurrent(candidate) { return !!candidates.get(candidate)?.(); },
    adoptPrimarySpatialCandidate(candidate) {
      if (!this.isPrimarySpatialCandidateCurrent(candidate)) return { status: "cancelled" };
      calls.push(["adopt-spatial"]);
      candidates.delete(candidate);
      state.landIndex = candidate.landIndex;
      return { status: "published" };
    },
  };
  const deps = {
    runtimeState: state, state,
    isTnoRasterSceneSelected: () => selected,
    tnoRasterSceneOwner: { isActive: () => sceneActive },
    nowMs: () => clock++, getPoliticalDerivedStateIdentity: identity, yieldToMain,
    getPoliticalCollectionOwner: () => ({
      async composePoliticalFeatureCollectionsChunked(_base, payload, _overrides, options) {
        await stage("compose", options);
        return { status: "prepared", collection: payload, maxSliceMs: 1, yieldCount: 1 };
      },
      async preparePoliticalCollectionViewChunked(fullCollection, options) {
        await stage("view", options);
        return { status: "prepared", interactiveCollection: { features: fullCollection.features.filter((f) => f.interactive) },
          coverage: { totalFeatures: fullCollection.features.length }, maxSliceMs: 1, yieldCount: 1 };
      },
    }),
    getBorderMeshOwner: () => ({
      async prepareSourceCountrySets(options) {
        await stage("countries", options);
        if (!options.isCurrent()) return { status: "cancelled" };
        return { status: "prepared", sourceFeatures: options.fullCollection.features,
          sourceCountries: { primary: new Set(["CAN"]), detail: new Set() }, maxSliceMs: 1, yieldCount: 1 };
      },
    }),
    buildAtlantropaLandLikeFeatureCollection: (sourceFeatures) => {
      calls.push(["extras-input", sourceFeatures]);
      return sourceFeatures?.length ? { features: sourceFeatures } : null;
    },
    appendUniqueFeatureCollections: (full, extras, options) => {
      assert.equal(options.publish, false);
      return extras?.features.length ? { ...full, features: [...full.features, ...extras.features] } : full;
    },
    getRiverPaintRuntime: () => ({ pinCollection: (full) => full }),
    politicalDerivedStateCache: {
      describe: (options) => describeDelta(options),
      commit: (baseline) => { calls.push(["commit-baseline", baseline]); },
    },
    getSpatialIndexRuntimeOwner: () => spatialOwner,
    ensureProjectedBoundsCache: () => new Map(),
    getFeatureId: (f) => f.id,
    analyzeScenarioPoliticalDerivedStateCoverageChunked,
    shouldExcludePoliticalVisualFeature: () => false,
    getResolvedFeatureColor: (f, id) => { colorReads.push(id); return f.color; },
    recordRenderPerfMetric: (...args) => { calls.push(["metric", ...args]); },
    setDebugCountryCoverageState: (_target, coverage) => { calls.push(["coverage", coverage]); },
    buildRuntimePoliticalMeta: () => { calls.push(["metadata"]); },
    replaceResolvedColorsState: (target, colors) => { calls.push(["adopt-colors"]); target.colors = colors; },
    bumpColorRevision: (target) => { target.colorRevision += 1; },
    retargetPendingPoliticalColorEditRevisionAfterColorRebuild: (revision) => { calls.push(["retarget-paint", revision]); },
    getCountryFillPaletteOwner: () => ({ invalidate: () => { calls.push(["palette"]); } }),
    notifyPaintContourColorsChanged: () => { calls.push(["paint-contours"]); },
    queueIndexUiRefresh: (...args) => { calls.push(["ui", ...args]); },
    finalizeIndexBuildEffects: () => { calls.push(["finalize"]); },
  };
  const prepare = new Function(...Object.keys(deps), `let previousPoliticalExtraIds = [];
    ${functionSource}
    return prepareScenarioPoliticalChunkPromotion;`)(...Object.values(deps));
  return { state, calls, colorReads,
    prepare: (payload, options = {}) => prepare({ politicalPayload: payload, isCurrent: () => selectionCurrent, ...options }),
    onYield: (callback) => { onYield = callback; }, hold: (name) => { holdStage = name; }, held,
    select: (value) => { selected = value; }, activate: (value) => { sceneActive = value; },
    invalidateSelection: () => { selectionCurrent = false; },
    invalidateProjection: () => { projection += 1; },
    setDelta: (describe) => { describeDelta = describe; },
    invalidateSpatial: () => { spatialGeneration += 1; } };
}

test("political preparation retains old authority through yields and adopts collections indexes and full colors together", async () => {
  const h = createHarness();
  const before = { full: h.state.landDataFull, interactive: h.state.landData, index: h.state.landIndex, colors: h.state.colors };
  const payload = { globalCoverage: true, features: [feature("leaf", "blue"), feature("support", "gray", false)] };
  let yields = 0;
  h.onYield(() => {
    yields += 1;
    assert.equal(h.state.landDataFull, before.full);
    assert.equal(h.state.landData, before.interactive);
    assert.equal(h.state.landIndex, before.index);
    assert.equal(h.state.colors, before.colors);
    assert.deepEqual(h.state.colors, { old: "old-color" });
    assert.deepEqual([...h.state.landIndex.keys()], ["old"]);
  });
  const prepared = await h.prepare(payload);
  assert.equal(prepared.status, "prepared");
  assert.ok(yields >= 3);
  assert.deepEqual(h.colorReads, ["leaf", "support"], "noninteractive full features still need colors");
  assert.equal(prepared.isCurrent(), true);
  const adopted = prepared.adopt();
  assert.equal(adopted.prepared, true);
  assert.equal(adopted.preparedSourceCountries.sourceFeatures, payload.features);
  assert.deepEqual([...adopted.preparedSourceCountries.sourceCountries.primary], ["CAN"]);
  assert.equal(h.state.landDataFull, payload);
  assert.deepEqual(h.state.landData.features.map((f) => f.id), ["leaf"]);
  assert.deepEqual([...h.state.landIndex.keys()], ["leaf"]);
  assert.deepEqual(h.state.colors, { leaf: "blue", support: "gray" });
  assert.equal(h.state.colorRevision, 5);
  const commit = h.calls.find(([name]) => name === "commit-baseline")[1];
  assert.equal(commit.collection, h.state.landDataFull);
  assert.equal(commit.colors, h.state.colors);
  assert.equal(commit.identity.at(-1), h.state.landIndex);
  assert.equal(prepared.isCurrent(), false);
  assert.throws(() => prepared.adopt(), /expired/);
});

for (const mutation of ["paint", "scene", "selection", "projection"]) {
  test(`${mutation} changes during preparation cancel without replacing the live document`, async () => {
    const h = createHarness();
    const before = { full: h.state.landDataFull, index: h.state.landIndex, colors: h.state.colors };
    let yields = 0;
    h.onYield(() => {
      if (++yields !== 2) return;
      if (mutation === "paint") { h.state.colors.old = "edited"; h.state.colorRevision += 1; }
      if (mutation === "scene") h.state.activeScenarioId = "another";
      if (mutation === "selection") h.invalidateSelection();
      if (mutation === "projection") h.invalidateProjection();
    });
    const prepared = await h.prepare({ globalCoverage: true, features: [feature("new", "blue")] });
    assert.equal(prepared.status, "cancelled");
    assert.equal(h.state.landDataFull, before.full);
    assert.equal(h.state.landIndex, before.index);
    assert.equal(h.state.colors, before.colors);
    assert.equal(h.state.colors.old, mutation === "paint" ? "edited" : "old-color");
    assert.ok(!h.calls.some(([name]) => name === "adopt-spatial" || name === "adopt-colors"));
  });
}

test("paint or spatial ownership changes after preparation prevent payload adoption", async () => {
  for (const mutation of ["paint", "spatial"]) {
    const h = createHarness();
    const prepared = await h.prepare({ globalCoverage: true, features: [feature("new", "blue")] });
    assert.equal(prepared.isCurrent(), true);
    if (mutation === "paint") { h.state.colors.old = "edited"; h.state.colorRevision += 1; }
    else h.invalidateSpatial();
    assert.equal(prepared.isCurrent(), false);
    assert.throws(() => prepared.adopt(), /expired/);
    assert.deepEqual([...h.state.landIndex.keys()], ["old"]);
    assert.ok(!h.calls.some(([name]) => name === "adopt-colors"));
  }
});

test("an older preparation finishing after a newer publication cannot replace it", async () => {
  const h = createHarness();
  h.hold("compose");
  const old = h.prepare({ globalCoverage: true, features: [feature("old-candidate", "red")] });
  await settle();
  assert.equal(h.held.length, 1);
  const latestPayload = { globalCoverage: true, features: [feature("latest", "blue")] };
  const latest = await h.prepare(latestPayload);
  latest.adopt();
  h.held.shift()();
  assert.equal((await old).status, "cancelled");
  assert.equal(h.state.landDataFull, latestPayload);
  assert.deepEqual(h.state.colors, { latest: "blue" });
  assert.equal(h.calls.filter(([name]) => name === "adopt-spatial").length, 1);
});

test("unsupported scene payload and empty baseline use the existing synchronous path", async () => {
  for (const unsupported of ["unselected", "inactive", "partial", "empty-index"]) {
    const h = createHarness();
    const payload = { globalCoverage: true, features: [feature("new", "blue")] };
    if (unsupported === "unselected") h.select(false);
    if (unsupported === "inactive") h.activate(false);
    if (unsupported === "partial") payload.globalCoverage = false;
    if (unsupported === "empty-index") h.state.landIndex.clear();
    assert.equal(await h.prepare(payload), null);
    assert.equal(h.calls.length, 0);
    assert.equal(h.colorReads.length, 0);
  }
});

test("mixed Atlantropa promotion prepares pending extras and accepts that expected live replacement", async () => {
  const h = createHarness();
  const oldExtras = [feature("old-extra", "old")];
  h.state.scenarioAtlantropaData = { features: oldExtras };
  const expectedFeatures = [feature("pending-extra", "sand")];
  const atlantropaPayload = { features: expectedFeatures };
  const prepared = await h.prepare({ globalCoverage: true, features: [feature("new", "blue")] }, { atlantropaPayload });
  assert.equal(prepared.status, "prepared");
  assert.equal(h.calls.find(([name]) => name === "extras-input")[1], expectedFeatures);
  assert.deepEqual(h.colorReads, ["new", "pending-extra"]);
  assert.equal(h.state.scenarioAtlantropaData.features, oldExtras, "preparation leaves the old payload live");
  h.state.scenarioAtlantropaData = { features: expectedFeatures };
  assert.equal(prepared.isCurrent(), true, "publishing the expected payload must not invalidate its candidate");
  prepared.adopt();
  assert.deepEqual(h.state.landDataFull.features.map((f) => f.id), ["new", "pending-extra"]);
  assert.deepEqual(h.state.colors, { new: "blue", "pending-extra": "sand" });
});

test("mixed Atlantropa candidate rejects an unrelated replacement during preparation or before adoption", async () => {
  for (const phase of ["preparation", "adoption"]) {
    const h = createHarness();
    const oldCollection = h.state.landDataFull;
    const pending = { features: [feature("pending-extra", "sand")] };
    const unrelated = { features: [feature("unrelated-extra", "green")] };
    if (phase === "preparation") h.onYield(() => { h.state.scenarioAtlantropaData = unrelated; });
    const prepared = await h.prepare({ globalCoverage: true, features: [feature("new", "blue")] }, { atlantropaPayload: pending });
    if (phase === "preparation") assert.equal(prepared.status, "cancelled");
    else {
      assert.equal(prepared.status, "prepared");
      h.state.scenarioAtlantropaData = unrelated;
      assert.equal(prepared.isCurrent(), false);
      assert.throws(() => prepared.adopt(), /expired/);
    }
    assert.equal(h.state.landDataFull, oldCollection);
    assert.deepEqual(h.state.colors, { old: "old-color" });
  }
});

test("incremental promotion resolves changed noninteractive colors from the full feature map", async () => {
  const h = createHarness();
  h.state.colors = { old: "old-color", leaf: "blue", support: "previous-gray" };
  const payload = { globalCoverage: true, features: [feature("leaf", "blue"), feature("support", "gray", false)] };
  h.setDelta(({ collection }) => ({ changedIds: ["support"], removedIds: ["old"],
    features: new Map(collection.features.map((f) => [f.id, f])) }));
  const prepared = await h.prepare(payload);
  assert.equal(prepared.status, "prepared");
  assert.deepEqual(h.colorReads, ["support"]);
  assert.deepEqual(h.calls.find(([name]) => name === "spatial-input")[1].map((f) => f.id), ["leaf"]);
  const adopted = prepared.adopt();
  assert.equal(adopted.incremental, true);
  assert.deepEqual(h.state.colors, { leaf: "blue", support: "gray" });
  assert.ok(!h.calls.some(([name]) => name === "metadata"), "valid delta retains runtime metadata");
});
