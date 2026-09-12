import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  STATE_BORROWED_EFFECT_CONTRACT,
  STATE_BORROWED_SCOPED_OPERATION_CONTRACT,
  inspectStateBorrowedScopedOperationSources,
  STATE_BORROWED_OWNER_EFFECT_CONTRACT,
  inspectStateBorrowedOwnerEffectSources,
  STATE_BORROWED_RUNTIME_CONTRACT,
  inspectStateBorrowedRuntimeSources,
  STATE_BORROWED_CALLBACK_INJECTION_CONTRACT,
  findStateBorrowedCallbackInjectionEntry,
  inspectStateBorrowedCallbackInjectionSources,
  findStateBorrowedEffectContractEntry,
  inspectStateBorrowedEffectSource,
} from "../tools/state_borrowed_effect_contract.mjs";

for (const entry of STATE_BORROWED_EFFECT_CONTRACT) {
  const source = readFileSync(new URL(`../${entry.modulePath}`, import.meta.url), "utf8");
  test(`${entry.exportName}: exact source and transitive dependencies are accepted`, () => {
    assert.deepEqual(inspectStateBorrowedEffectSource(source, entry).violations, []);
    assert.deepEqual(inspectStateBorrowedEffectSource(source.replace(/\r\n?/g, "\n").replaceAll("\n", "\r\n"), entry).violations, []);
    assert.equal(findStateBorrowedEffectContractEntry(entry.modulePath, entry.exportName), entry);
    assert.equal(findStateBorrowedEffectContractEntry("js/core/fake.js", entry.exportName), null);
    assert.equal(findStateBorrowedEffectContractEntry(entry.modulePath, "fake"), null);
  });
  test(`${entry.exportName}: changed function, additional callback, input writes and helper changes fail closed`, () => {
    const alternatives = [
      source.replace(`export function ${entry.exportName}`, `export function other${entry.exportName}`),
      source.replace("} = {}) {", "afterMerge = null,\n} = {}) {\n  afterMerge?.();"),
      source.replace("} = {}) {", `} = {}) {\n  ${entry.argumentCount === 3 ? "chunkState.loadedChunkIds = [];" : "runtimeState.colors = {};"}`),
      source.replace("function ", "function changedHelper"),
    ];
    for (const modified of alternatives) {
      assert.notEqual(modified, source);
      assert.ok(inspectStateBorrowedEffectSource(modified, entry).violations.length > 0);
    }
    assert.ok(inspectStateBorrowedEffectSource("not javascript {", entry).violations.length > 0);
  });
  test(`${entry.exportName}: source gate rejects caller-forged permission metadata`, () => {
    const forged = { ...entry, allowedOptionNames: [...entry.allowedOptionNames, "afterMerge"] };
    assert.ok(inspectStateBorrowedEffectSource(source, forged).violations.length > 0);
  });
}

test("merge result paths retain all reused references while scalar coverage stays detached", () => {
  const [merge, coverage] = STATE_BORROWED_EFFECT_CONTRACT;
  assert.deepEqual(merge.borrowedResultPaths, [["mergedLayerPayloads"], ["primaryMergedLayerPayloads"], ["primaryLayerStats"]]);
  assert.deepEqual(coverage.borrowedResultPaths, []);
  assert.deepEqual(merge.callbackOptionNames, ["mergeScenarioChunkPayloads", "mergeScenarioChunkPayloadsForViewport"]);
  assert.deepEqual(coverage.callbackOptionNames, ["buildInteractiveLandData", "shouldExcludePoliticalVisualFeature"]);
  assert.deepEqual(merge.callbackBorrowedParameterIndexes, {
    mergeScenarioChunkPayloads: [1], mergeScenarioChunkPayloadsForViewport: [1, 2],
  });
  assert.deepEqual(coverage.callbackBorrowedParameterIndexes, {
    buildInteractiveLandData: [0], shouldExcludePoliticalVisualFeature: [0],
  });
  assert.throws(() => merge.callbackBorrowedParameterIndexes.mergeScenarioChunkPayloadsForViewport.push(0), TypeError);
  assert.throws(() => { coverage.callbackBorrowedParameterIndexes.buildInteractiveLandData = []; }, TypeError);
  assert.throws(() => merge.borrowedResultPaths[0].push("other"), TypeError);
});

test("coverage proof binds imported feature identity source and rejects an import replacement", () => {
  const entry = STATE_BORROWED_EFFECT_CONTRACT[1];
  const source = readFileSync(new URL(`../${entry.modulePath}`, import.meta.url), "utf8");
  assert.equal(Object.keys(entry.dependencyFingerprints).length, 3);
  assert.ok(inspectStateBorrowedEffectSource(source.replace("../feature_identity.js", "../fake_identity.js"), entry).violations.length > 0);
});


for (const entry of STATE_BORROWED_CALLBACK_INJECTION_CONTRACT) {
  const read = modulePath => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8");
  test(`${entry.parameterName}: exact factory injection and only audited production consumer are accepted`, () => {
    assert.equal(findStateBorrowedCallbackInjectionEntry(entry.modulePath, entry.enclosingFactoryExportName, entry.parameterName), entry);
    assert.deepEqual(inspectStateBorrowedCallbackInjectionSources(entry).violations, []);
    assert.equal(findStateBorrowedCallbackInjectionEntry(entry.modulePath, "otherFactory", entry.parameterName), null);
  });
  test(`${entry.parameterName}: substituted assembly, implementation write and extra production consumer fail closed`, () => {
    for (const changedPath of [entry.assemblyModulePath, entry.implementationModulePath, entry.modulePath]) {
      const inspection = inspectStateBorrowedCallbackInjectionSources(entry, {
        productionModulePaths: [],
        readSource: modulePath => read(modulePath) + (modulePath === changedPath ? "\nthrow new Error('unreviewed write or replacement');" : ""),
      });
      assert.ok(inspection.violations.some(item => item.code === "borrowed-callback-injection-source-mismatch"));
    }
    const extra = "js/core/unreviewed_consumer.js";
    const inspection = inspectStateBorrowedCallbackInjectionSources(entry, {
      productionModulePaths: [extra],
      readSource: modulePath => modulePath === extra
        ? `import { ${entry.enclosingFactoryExportName} } from "./${entry.modulePath.slice("js/core/".length)}";`
        : read(modulePath),
    });
    assert.ok(inspection.violations.some(item => item.code === "borrowed-callback-unproven-production-consumer"));
    const dynamicInspection = inspectStateBorrowedCallbackInjectionSources(entry, {
      productionModulePaths: [extra],
      readSource: modulePath => modulePath === extra
        ? `const factory = await import("./${entry.modulePath.slice("js/core/".length)}");`
        : read(modulePath),
    });
    assert.ok(dynamicInspection.violations.some(item => item.code === "borrowed-callback-unproven-production-consumer"));
  });
}

test("coverage injection reuses political owner proof and rejects borrowed-feature writes in its implementation", () => {
  const entry = STATE_BORROWED_CALLBACK_INJECTION_CONTRACT.find(item => item.parameterName === "shouldExcludePoliticalVisualFeature");
  const inspection = inspectStateBorrowedCallbackInjectionSources(entry, {
    productionModulePaths: [],
    readSource: modulePath => {
      const source = readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8");
      return modulePath === "js/core/renderer/political_feature_policy.js"
        ? source.replace("function shouldExcludePoliticalVisualFeature(feature, featureId = null) {", "function shouldExcludePoliticalVisualFeature(feature, featureId = null) { feature.properties.bad = true;")
        : source;
    },
  });
  assert.ok(inspection.violations.some(item => item.code === "state-mutation-owner-factory-source-drift"));
  assert.ok(inspection.violations.some(item => item.code === "borrowed-callback-injection-source-mismatch"));
});

test("normalizeScenarioId direct injection binds one borrowed argument and rejects forged assembly or reassignment", () => {
  const entry = STATE_BORROWED_CALLBACK_INJECTION_CONTRACT.find(item => item.parameterName === "normalizeScenarioId");
  assert.equal(entry.invocationArgumentCount, 1);
  assert.deepEqual(entry.invocationBorrowedArgumentIndexes, [0]);
  assert.equal(entry.callbackReturnsBorrowed, false);
  assert.throws(() => entry.invocationBorrowedArgumentIndexes.push(1), TypeError);
  const read = modulePath => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8");
  const cases = [
    [entry.assemblyModulePath, source => source.replace('./scenario/shared.js', './scenario/fake_shared.js')],
    [entry.modulePath, source => source.replace('  const runtimeState = explicitRuntimeState || state;', '  normalizeScenarioId = value => { value.bad = true; return value; };\n  const runtimeState = explicitRuntimeState || state;')],
    [entry.implementationModulePath, source => source.replace('return String(value || "").trim();', 'value.bad = true; return value;')],
  ];
  for (const [changedPath, alter] of cases) {
    assert.notEqual(alter(read(changedPath)), read(changedPath));
    const inspection = inspectStateBorrowedCallbackInjectionSources(entry, {
      productionModulePaths: [],
      readSource: modulePath => modulePath === changedPath ? alter(read(modulePath)) : read(modulePath),
    });
    assert.ok(inspection.violations.some(item => item.code === "borrowed-callback-injection-source-mismatch" && item.modulePath === changedPath));
  }
  const forged = { ...entry, invocationArgumentCount: 2 };
  assert.ok(inspectStateBorrowedCallbackInjectionSources(forged).violations.some(item => item.code === "borrowed-callback-unknown-injection"));
});

test("city callback proofs preserve effectful scalar versus private-cache results and exact helper paths", () => {
  const entries = STATE_BORROWED_CALLBACK_INJECTION_CONTRACT.filter(entry => entry.enclosingFactoryExportName === "createCityLightsRenderOwner" && entry.rootParameterName === "helpers" && entry.parameterName !== "getProjectedFeatureBounds");
  assert.equal(entries.length, 7);
  for (const entry of entries) {
    assert.equal(entry.rootParameterName, "helpers");
    assert.equal(entry.parameterPath, `$/property:helpers/property:${entry.parameterName}`);
    assert.equal(entry.callbackReturnsBorrowed, false);
    assert.deepEqual(entry.invocationBorrowedArgumentIndexes, entry.parameterName === "getUrbanGlowMultiplierAt" ? [0, 1] : [0]);
    assert.equal(entry.invocationArgumentCount, entry.parameterName === "clamp" ? 3 : ["estimateProjectedAreaPx", "getUrbanGlowMultiplierAt"].includes(entry.parameterName) ? 2 : 1);
    assert.equal(entry.invocationResultKind, ["getFeatureGeoCentroid", "getProjectedGeographicPath"].includes(entry.parameterName) ? "private-cache" : "scalar");
    assert.throws(() => entry.invocationBorrowedArgumentIndexes.push(3), TypeError);
    if (!["clamp", "normalizeLongitude"].includes(entry.parameterName)) assert.ok(Object.keys(entry.sourceFingerprints).length > 2, "implementation dependencies must supplement the assembly hash");
  }
});

test("city callback source gates reject transitive input writes, borrowed result substitution and changed dependencies", () => {
  const read = modulePath => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8");
  const cases = [
    ["pathBoundsInScreen", "js/core/renderer/projected_geometry_bounds_owner.js", "function computeProjectedFeatureBounds(feature) {", "function computeProjectedFeatureBounds(feature) { feature.geometry.coordinates = [];"],
    ["estimateProjectedAreaPx", "js/core/state/actions/renderer_cache_actions.js", "function assertStateTarget(target) {", "function assertStateTarget(target) { target.extraWrite = true;"],
    ["getFeatureGeoCentroid", "js/core/map_renderer.js", "const normalized = [normalizeLongitude(longitude), clamp(latitude, -89.999, 89.999)];", "const normalized = feature.geometry.coordinates;"],
    ["getProjectedGeographicPath", "js/core/renderer/projected_geographic_path_cache.js", "function getPath(object) {", "function getPath(object) { object.geometry = null;"],
    ["getUrbanGlowMultiplierAt", "js/core/intensity_field.js", "export function sampleIntensityField(fieldsState, channelId, lon, lat) {", "export function sampleIntensityField(fieldsState, channelId, lon, lat) { lon.bad = true;"],
  ];
  for (const [name, changedPath, original, replacement] of cases) {
    const entry = STATE_BORROWED_CALLBACK_INJECTION_CONTRACT.find(item => item.parameterName === name);
    assert.ok(read(changedPath).includes(original));
    const checked = inspectStateBorrowedCallbackInjectionSources(entry, {
      productionModulePaths: [],
      readSource: modulePath => modulePath === changedPath ? read(modulePath).replace(original, replacement) : read(modulePath),
    });
    assert.ok(checked.violations.some(item => item.code === "borrowed-callback-injection-source-mismatch" && item.modulePath === changedPath));
    for (const dependencyPath of Object.keys(entry.sourceFingerprints)) {
      const drift = inspectStateBorrowedCallbackInjectionSources(entry, {
        productionModulePaths: [],
        readSource: modulePath => read(modulePath) + (modulePath === dependencyPath ? "\n// unreviewed dependency drift" : ""),
      });
      assert.ok(drift.violations.some(item => item.code === "borrowed-callback-injection-source-mismatch" && item.modulePath === dependencyPath));
    }
  }
});

test("city getter receipts permit only projection invocation and path centroid with borrowed inputs", () => {
  for (const [name, method] of [["getProjection", null], ["getPathCanvas", "centroid"]]) {
    const entry = STATE_BORROWED_CALLBACK_INJECTION_CONTRACT.find(item => item.parameterName === name);
    assert.equal(entry.rootParameterName, "getters");
    assert.equal(entry.parameterPath, `$/property:getters/property:${name}`);
    assert.equal(entry.invocationArgumentCount, 0);
    assert.equal(entry.invocationResultKind, "shared-capability");
    assert.equal(entry.callbackReturnsBorrowed, true);
    assert.deepEqual(entry.invocationResultCalls[0], { method, argumentCount: 1, borrowedArgumentIndexes: [0], returnsBorrowedState: false });
    assert.throws(() => entry.invocationResultCalls.push({ method: "bounds" }), TypeError);
    assert.throws(() => entry.invocationResultCalls[0].borrowedArgumentIndexes.push(1), TypeError);
    const forged = { ...entry, invocationResultCalls: [{ ...entry.invocationResultCalls[0], method: "context" }] };
    assert.ok(inspectStateBorrowedCallbackInjectionSources(forged).violations.some(item => item.code === "borrowed-callback-unknown-injection"));
    const read = modulePath => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8");
    const original = `${name}: () => rendererSurfaceHost.${name}()`;
    assert.ok(read(entry.assemblyModulePath).includes(original));
    const changed = inspectStateBorrowedCallbackInjectionSources(entry, {
      productionModulePaths: [],
      readSource: modulePath => modulePath === entry.assemblyModulePath
        ? read(modulePath).replaceAll(original, `${name}: () => feature => { feature.bad = true; return feature; }`)
        : read(modulePath),
    });
    assert.ok(changed.violations.some(item => item.code === "borrowed-callback-injection-source-mismatch"));
    const producerPath = "js/core/renderer/renderer_projection_path_owner.js";
    const drift = inspectStateBorrowedCallbackInjectionSources(entry, {
      productionModulePaths: [],
      readSource: modulePath => modulePath === producerPath ? read(modulePath).replace("const rawProjection = d3.geoEqualEarth();", "const rawProjection = feature => { feature.bad = true; return feature; };") : read(modulePath),
    });
    assert.ok(drift.violations.some(item => item.code === "state-mutation-owner-factory-source-drift"));
    assert.ok(drift.violations.some(item => item.code === "borrowed-callback-injection-source-mismatch" && item.modulePath === producerPath));
  }
});

test("chunk feature collection injection retains features only and binds identity readers to their actual source", () => {
  const normalize = STATE_BORROWED_CALLBACK_INJECTION_CONTRACT.find(entry => entry.parameterName === "normalizeScenarioFeatureCollection");
  assert.deepEqual(normalize.invocationBorrowedResultPaths, [["features"]]);
  assert.equal(normalize.callbackReturnsBorrowed, true);
  assert.throws(() => normalize.invocationBorrowedResultPaths[0].push("geometry"), TypeError);
  const read = modulePath => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8");
  for (const name of ["normalizeScenarioFeatureCollection", "getScenarioFeatureCollectionIdentityList", "areScenarioFeatureCollectionsEquivalent"]) {
    const entry = STATE_BORROWED_CALLBACK_INJECTION_CONTRACT.find(item => item.parameterName === name);
    assert.equal(entry.implementationModulePath, "js/core/scenario/pure_helpers.js");
    assert.equal(entry.invocationArgumentCount, name === "areScenarioFeatureCollectionsEquivalent" ? 2 : 1);
    if (name !== "normalizeScenarioFeatureCollection") {
      assert.equal(entry.callbackReturnsBorrowed, false);
      assert.deepEqual(entry.invocationBorrowedResultPaths, []);
    }
    const swapped = inspectStateBorrowedCallbackInjectionSources(entry, {
      productionModulePaths: [],
      readSource: modulePath => modulePath === entry.assemblyModulePath ? read(modulePath).replace('./scenario/pure_helpers.js', './scenario_chunk_manager.js') : read(modulePath),
    });
    assert.ok(swapped.violations.some(item => item.code === "borrowed-callback-injection-source-mismatch" && item.modulePath === entry.assemblyModulePath));
    const parameter = name === "areScenarioFeatureCollectionsEquivalent" ? "leftPayload" : "payload";
    const signature = name === "areScenarioFeatureCollectionsEquivalent" ? "leftPayload, rightPayload" : "payload";
    for (const effect of [`${parameter}.features.length = 0;`, `return ${parameter};`]) {
      const inspection = inspectStateBorrowedCallbackInjectionSources(entry, {
        productionModulePaths: [],
        readSource: modulePath => modulePath === entry.implementationModulePath
          ? read(modulePath).replace(`function ${name}(${signature}) {`, `function ${name}(${signature}) { ${effect}`)
          : read(modulePath),
      });
      assert.ok(inspection.violations.some(item => item.code === "borrowed-callback-injection-source-mismatch" && item.modulePath === entry.implementationModulePath));
    }
  }
  const identities = STATE_BORROWED_CALLBACK_INJECTION_CONTRACT.find(entry => entry.parameterName === "getScenarioFeatureCollectionIdentityList");
  assert.ok(identities.sourceFingerprints["js/core/feature_identity_shared.js"]);
  const forged = { ...normalize, invocationBorrowedResultPaths: [] };
  assert.ok(inspectStateBorrowedCallbackInjectionSources(forged).violations.some(item => item.code === "borrowed-callback-unknown-injection"));
});

test("borrowed runtime receipt retains pending promotion and public prewarm payload references", () => {
  const [entry] = STATE_BORROWED_RUNTIME_CONTRACT;
  assert.deepEqual(inspectStateBorrowedRuntimeSources(entry).violations, []);
  assert.deepEqual(entry.borrowedLocalStorage, [{ functionName: "refreshActiveScenarioChunks", bindingName: "pendingPromotion", paths: [["mergedLayerPayloads"], ["primaryMergedLayerPayloads"], ["primaryLayerStats"]] }]);
  assert.deepEqual(entry.borrowedResultPathsByMethod, { preloadScenarioCoarseChunks: [[]] });
  assert.deepEqual(entry.borrowedPublicExports, [{ modulePath: "js/core/scenario_resources.js", exportName: "preloadScenarioCoarseChunks", paths: [[]] }]);
  assert.throws(() => entry.borrowedLocalStorage[0].paths.push([]), TypeError);
  assert.throws(() => entry.borrowedPublicExports[0].paths[0].push("fake"), TypeError);
});

test("borrowed runtime receipt rejects undeclared source returns and forged public exports", () => {
  const [entry] = STATE_BORROWED_RUNTIME_CONTRACT;
  const read = modulePath => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8");
  const altered = inspectStateBorrowedRuntimeSources(entry, {
    readSource: modulePath => modulePath === entry.factoryModulePath
      ? read(modulePath).replace("return mergedLayerPayloads;", "return runtimeState;") : read(modulePath),
  });
  assert.ok(altered.violations.some(item => item.code === "borrowed-runtime-factory-source-mismatch"));
  assert.ok(altered.violations.some(item => item.code === "borrowed-callback-injection-source-mismatch"));
  const publicSource = "js/core/scenario_resources.js";
  const replacement = inspectStateBorrowedRuntimeSources(entry, {
    readSource: modulePath => modulePath === publicSource ? read(modulePath).replaceAll("preloadScenarioCoarseChunks", "unreviewedPrewarm") : read(modulePath),
  });
  assert.ok(replacement.violations.some(item => item.code === "borrowed-callback-injection-source-mismatch" && item.modulePath === publicSource));
  const forged = { ...entry, borrowedPublicExports: [{ modulePath: publicSource, exportName: "otherExport", paths: [[]] }] };
  assert.ok(inspectStateBorrowedRuntimeSources(forged).violations.some(item => item.code === "borrowed-runtime-unknown-contract"));
});

test("city shared capability receipts permit only observed getter arities and refuse setters", () => {
  const projection = STATE_BORROWED_CALLBACK_INJECTION_CONTRACT.find(entry => entry.parameterName === "getProjection");
  const path = STATE_BORROWED_CALLBACK_INJECTION_CONTRACT.find(entry => entry.parameterName === "getPathCanvas");
  assert.deepEqual(projection.invocationResultCalls.map(call => [call.method, call.argumentCount]), [[null, 1], ["scale", 0], ["translate", 0], ["center", 0], ["rotate", 0]]);
  assert.deepEqual(path.invocationResultCalls.map(call => [call.method, call.argumentCount]), [["centroid", 1], ["bounds", 1]]);
  for (const method of ["scale", "translate", "center", "rotate"]) {
    const call = projection.invocationResultCalls.find(item => item.method === method);
    assert.deepEqual(call.borrowedArgumentIndexes, []);
    assert.equal(call.returnsBorrowedState, false);
    const setter = { ...projection, invocationResultCalls: projection.invocationResultCalls.map(item => item.method === method ? { ...item, argumentCount: 1 } : item) };
    assert.ok(inspectStateBorrowedCallbackInjectionSources(setter).violations.some(item => item.code === "borrowed-callback-unknown-injection"));
  }
  assert.deepEqual(path.invocationResultCalls[1].borrowedArgumentIndexes, [0]);
  for (const method of ["context", "projection", "unknown"]) {
    const forged = { ...path, invocationResultCalls: [...path.invocationResultCalls, { method, argumentCount: 1, borrowedArgumentIndexes: [0], returnsBorrowedState: false }] };
    assert.ok(inspectStateBorrowedCallbackInjectionSources(forged).violations.some(item => item.code === "borrowed-callback-unknown-injection"));
  }
});

test("city projected bounds keeps its publicly cached result borrowed and exact one-feature input", () => {
  const entry = STATE_BORROWED_CALLBACK_INJECTION_CONTRACT.find(item => item.parameterName === "getProjectedFeatureBounds");
  assert.equal(entry.parameterPath, "$/property:helpers/property:getProjectedFeatureBounds");
  assert.equal(entry.invocationArgumentCount, 1);
  assert.deepEqual(entry.invocationBorrowedArgumentIndexes, [0]);
  assert.equal(entry.invocationResultKind, "shared-cache");
  assert.equal(entry.callbackReturnsBorrowed, true);
  assert.deepEqual(entry.invocationBorrowedResultPaths, [[]]);
  assert.ok(entry.requiredOwnerCompositionNames.includes("getProjectedGeometryBoundsOwner"));
  assert.ok(entry.sourceFingerprints["js/core/state/actions/renderer_cache_actions.js"]);
  const forged = { ...entry, callbackReturnsBorrowed: false, invocationBorrowedResultPaths: [] };
  assert.ok(inspectStateBorrowedCallbackInjectionSources(forged).violations.some(item => item.code === "borrowed-callback-unknown-injection"));
});

test("political owner effect proof binds injected shared cache and retains explicit effects", () => {
  const [entry] = STATE_BORROWED_OWNER_EFFECT_CONTRACT;
  assert.deepEqual(inspectStateBorrowedOwnerEffectSources(entry).violations, []);
  assert.equal(entry.localResultOrigin, "injected-shared-cache");
  assert.deepEqual(entry.localMethodNames, ["getPoliticalPathCacheHandle", "getPoliticalFeaturePathEntry"]);
  assert.ok(entry.effects.some(effect => effect.includes("Map get/set/clear")));
  assert.ok(entry.effects.some(effect => effect.includes("counter")));
  assert.ok(entry.effects.some(effect => effect.includes("warmup queue")));
  assert.ok(entry.effects.some(effect => effect.includes("remain borrowed")));
  assert.throws(() => entry.localMethodNames.push("otherMethod"), TypeError);
  assert.throws(() => entry.requiredOwnerCompositions[0].exportName = "otherOwner", TypeError);
});

test("political owner effect proof rejects external cache substitution, input writes and forged metadata", () => {
  const [entry] = STATE_BORROWED_OWNER_EFFECT_CONTRACT;
  const read = modulePath => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8");
  const cases = [
    ["js/core/map_renderer.js", "return getRenderCacheOwner().getRenderPassCacheState();", "return globalThis.externalCache;"],
    [entry.factoryModulePath, "let warmupTransform = null;", "runtimeState.unapproved = true; let warmupTransform = null;"],
    [entry.factoryModulePath, "const resolvedId = featureId || getFeatureId(feature);", "feature.geometry = null; const resolvedId = featureId || getFeatureId(feature);"],
    ["js/core/renderer/render_cache_owner.js", "getRoot: () => state.renderPassCache,", "getRoot: () => globalThis.externalCache,"],
    ["js/core/renderer/render_pass_cache_state_normalizer.js", null, null],
    ["js/core/state/actions/renderer_cache_actions.js", null, null],
  ];
  for (const [changedPath, original, replacement] of cases) {
    if (original) assert.ok(read(changedPath).includes(original));
    const result = inspectStateBorrowedOwnerEffectSources(entry, {
      readSource: modulePath => modulePath === changedPath
        ? original ? read(modulePath).replace(original, replacement) : read(modulePath) + "\n// unreviewed cache effect drift"
        : read(modulePath),
    });
    assert.ok(result.violations.some(item => item.code === "borrowed-owner-effect-source-mismatch" && item.modulePath === changedPath));
  }
  for (const forged of [{ ...entry, localMethodNames: [...entry.localMethodNames, "otherMethod"] }, { ...entry, localResultOrigin: "private-cache" }]) {
    assert.ok(inspectStateBorrowedOwnerEffectSources(forged).violations.some(item => item.code === "borrowed-owner-effect-unknown-contract"));
  }
});

test("city exact operation receipts preserve frozen inputs, sparse slices and set member identity", () => {
  const entries = STATE_BORROWED_SCOPED_OPERATION_CONTRACT;
  assert.equal(entries.length, 3);
  for (const entry of entries) assert.deepEqual(inspectStateBorrowedScopedOperationSources(entry).violations, []);
  const finite = entries.find(entry => entry.operationKind === "finite-literal-array");
  const check = Function("minX", "minY", "maxX", "maxY", `return ${finite.operationSource};`);
  assert.equal(check(0, 1, 2, 3), true);
  assert.equal(check(0, NaN, 2, 3), false);
  assert.deepEqual(finite.borrowedResultPaths, []);
  const slice = entries.find(entry => entry.operationKind === "borrowed-slice");
  const point = Object.freeze([10, 20]);
  const anchors = Object.freeze([point, , point, Object.freeze([30, 40])]);
  const sliced = Function("anchors", `return ${slice.operationSource};`)(anchors);
  assert.equal(sliced.length, 3);
  assert.equal(1 in sliced, false);
  assert.equal(sliced[0], point);
  assert.equal(sliced[2], point);
  assert.notEqual(sliced, anchors);
  assert.deepEqual(slice.borrowedResultPaths, [[]]);
  const membership = entries.find(entry => entry.operationKind === "borrowed-membership-set");
  const id = Object.freeze({ id: "retained-identity" });
  const input = Object.freeze([Object.freeze({ feature: Object.freeze({ properties: Object.freeze({ city_ids: Object.freeze([id, "A", "A"]) }) }) })]);
  const set = Function("urbanCoreEntries", `return ${membership.operationSource};`)(input);
  assert.equal(set.size, 2);
  assert.equal(set.has(id), true);
  assert.deepEqual(membership.borrowedResultPaths, [[]]);
  assert.deepEqual(membership.resultCalls.map(call => [call.method, call.argumentCount]), [["has", 1]]);
});

test("city scoped operation gates reject nested writes, different callbacks, set mutation and forged grants", () => {
  for (const entry of STATE_BORROWED_SCOPED_OPERATION_CONTRACT) {
    const read = modulePath => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8");
    const replacement = entry.operationKind === "finite-literal-array"
      ? entry.operationSource.replace("Number.isFinite", "value => { runtimeState.bad = value; return true; }")
      : entry.operationKind === "borrowed-slice"
        ? entry.operationSource.replace("slice", "splice")
        : entry.operationSource.replace("entry.feature.properties?.city_ids || []", "(entry.feature.geometry = null, [])");
    const result = inspectStateBorrowedScopedOperationSources(entry, {
      readSource: modulePath => read(modulePath).replace(entry.operationSource, replacement),
    });
    assert.ok(result.violations.some(item => item.code === "borrowed-scoped-operation-source-mismatch"));
    assert.ok(result.violations.some(item => item.code === "borrowed-scoped-operation-expression-mismatch"));
    const forged = { ...entry, operationSource: "anything()" };
    assert.ok(inspectStateBorrowedScopedOperationSources(forged).violations.some(item => item.code === "borrowed-scoped-operation-unknown-contract"));
    if (entry.bindingName) {
      const mutated = inspectStateBorrowedScopedOperationSources(entry, {
        readSource: modulePath => read(modulePath).replace("visibleUrbanCityIds.has(", "visibleUrbanCityIds.add("),
      });
      assert.ok(mutated.violations.some(item => item.code === "borrowed-scoped-operation-factory-mismatch"));
      const extraCapability = { ...entry, resultCalls: [...entry.resultCalls, { method: "add", argumentCount: 1 }] };
      assert.ok(inspectStateBorrowedScopedOperationSources(extraCapability).violations.some(item => item.code === "borrowed-scoped-operation-unknown-contract"));
    }
  }
});

test("localization callback proof preserves global publication effects and rejects altered source behavior", () => {
  const entry = STATE_BORROWED_CALLBACK_INJECTION_CONTRACT.find(item => item.parameterName === "syncScenarioLocalizationState");
  assert.equal(entry.invocationArgumentCount, 1);
  assert.deepEqual(entry.invocationBorrowedArgumentIndexes, [0]);
  assert.equal(entry.callbackReturnsBorrowed, false);
  assert.equal(entry.invocationResultKind, "undefined");
  assert.ok(entry.effects.some(effect => effect.includes("payload reference")));
  assert.ok(entry.effects.some(effect => effect.includes("cityLayerRevision")));
  assert.ok(entry.sourceFingerprints["js/core/data_loader.js"]);
  assert.ok(entry.sourceFingerprints["vendor/d3.v7.min.js"]);
  assert.throws(() => entry.effects.push("pure"), TypeError);
  const read = modulePath => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8");
  const cases = [
    [entry.assemblyModulePath, './scenario_localization_state.js', './fake_localization.js'],
    [entry.implementationModulePath, 'applyScenarioGeoLocalization();', 'applyScenarioGeoLocalization(); return cityOverridesPayload;'],
    [entry.implementationModulePath, 'const geometry = feature?.geometry;', 'feature.bad = true; const geometry = feature?.geometry;'],
    ['js/core/data_loader.js', 'const geo = {};', 'cityCollection.features.length = 0; const geo = {};'],
    ['js/core/state/actions/scenario_presentation_actions.js', 'export function applyScenarioChunkCityExternalEffectState(target, payload) {', 'export function applyScenarioChunkCityExternalEffectState(target, payload) { payload.bad = true;'],
  ];
  for (const [changedPath, original, replacement] of cases) {
    assert.ok(read(changedPath).includes(original));
    const checked = inspectStateBorrowedCallbackInjectionSources(entry, {
      productionModulePaths: [],
      readSource: modulePath => modulePath === changedPath ? read(modulePath).replace(original, replacement) : read(modulePath),
    });
    assert.ok(checked.violations.some(item => item.code === "borrowed-callback-injection-source-mismatch" && item.modulePath === changedPath));
  }
});
