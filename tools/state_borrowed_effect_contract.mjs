import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";
import { parse } from "acorn";
import { full } from "acorn-walk";
import {
  STATE_MUTATION_DELEGATING_OWNER_CONTRACT,
  inspectStateMutationDelegatingOwnerSources,
} from "./state_action_delegation_contract.mjs";

// These are effect contracts, not purity declarations. Callers must preserve
// borrowed taint on every listed result path; merge capabilities may do work.
// Exact module identity also binds transitive helpers, constants and imports.
const fingerprint = source => createHash("sha256").update(String(source).replace(/\r\n?/g, "\n")).digest("hex");
const definitions = [
  {
    "modulePath": "js/core/scenario/chunk_layer_payloads.js",
    "exportName": "buildMergedScenarioChunkLayerPayloads",
    "argumentCount": 3,
    "borrowedArgumentIndexes": [
      0,
      1,
      2
    ],
    "optionsArgumentIndex": 2,
    "allowedOptionNames": [
      "previousSignatures",
      "nextSignatures",
      "previousMergedLayerPayloads",
      "activeChunkIds",
      "viewportBbox",
      "mergeScenarioChunkPayloads",
      "mergeScenarioChunkPayloadsForViewport"
    ],
    "callbackOptionNames": [
      "mergeScenarioChunkPayloads",
      "mergeScenarioChunkPayloadsForViewport"
    ],
    "borrowedResultPaths": [
      [
        "mergedLayerPayloads"
      ],
      [
        "primaryMergedLayerPayloads"
      ],
      [
        "primaryLayerStats"
      ]
    ],
    "dependencyFingerprints": {
      "js/core/paint_contour_source.js": "9412f0064b506cd07d56395fb46e0c3da3ba18bda43c00503920a5ecc15e20ca"
    },
    "sourceFingerprint": "8b2d728b4ad8b02fc48adb54f01b58ab1a00374719e0be2f1c91467434097dd8",
    "callbackBorrowedParameterIndexes": {
      "mergeScenarioChunkPayloads": [
        1
      ],
      "mergeScenarioChunkPayloadsForViewport": [
        1,
        2
      ]
    }
  },
  {
    "modulePath": "js/core/renderer/scenario_chunk_promotion_helpers.js",
    "exportName": "analyzeScenarioPoliticalDerivedStateCoverage",
    "argumentCount": 2,
    "borrowedArgumentIndexes": [
      0,
      1
    ],
    "optionsArgumentIndex": 1,
    "allowedOptionNames": [
      "buildInteractiveLandData",
      "shouldExcludePoliticalVisualFeature"
    ],
    "callbackOptionNames": [
      "buildInteractiveLandData",
      "shouldExcludePoliticalVisualFeature"
    ],
    "borrowedResultPaths": [],
    "dependencyFingerprints": {
      "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
      "js/core/feature_identity_shared.js": "87740ee4f95f77350073884c812865264b9e5eae2e0bfeec88d066648c2bcf0a",
      "js/core/country_code_aliases.js": "5c65ff97e89d7cfaf3c8b575c975ef25caf50d5a9a00aea34b3bd812ac661726"
    },
    "sourceFingerprint": "f94c8c6bc6c769722e60e1f2d1eac656a4c03d34fa421739949e33c102938f2d",
    "callbackBorrowedParameterIndexes": {
      "buildInteractiveLandData": [
        0
      ],
      "shouldExcludePoliticalVisualFeature": [
        0
      ]
    }
  }
];
// Cached indexes and immutable-looking pack projections still share canonical geometry.
for (const [exportName, argumentCount, borrowedArgumentIndexes, borrowedResultPaths, optionsArgumentIndex] of [
  ["getActiveRiverPack", 3, [0, 1, 2], [[]], null],
  ["getRiverPartitionIndex", 1, [0], [[]], null],
  ["getRiverParentCompatibility", 3, [0, 1, 2], [["parent"]], null],
  ["applyRiverCellOverride", 4, [0, 1, 2, 3], [["paint"]], 3],
]) definitions.push({
  modulePath: "js/core/river_paint/partition_model.js", exportName, argumentCount,
  borrowedArgumentIndexes, borrowedResultPaths, optionsArgumentIndex,
  allowedOptionNames: optionsArgumentIndex === null ? [] : ["remove"],
  callbackOptionNames: [], callbackBorrowedParameterIndexes: {},
  sourceFingerprint: "3ec6a9e6c13ed80c73fa9baaa324e75b1df678f7cd0ed34191f9ebb1f40fc8f1",
  dependencyFingerprints: {
    "js/core/river_paint/geometry_identity.js": "2e4562a87beecfb75273458038fb1d9cc9d092592551fbf2fef4e83af573ff78",
  },
});
export const STATE_BORROWED_EFFECT_CONTRACT = Object.freeze(definitions.map(entry => Object.freeze({
  ...entry,
  borrowedArgumentIndexes: Object.freeze(entry.borrowedArgumentIndexes),
  allowedOptionNames: Object.freeze(entry.allowedOptionNames),
  callbackOptionNames: Object.freeze(entry.callbackOptionNames),
  callbackBorrowedParameterIndexes: Object.freeze(Object.fromEntries(
    Object.entries(entry.callbackBorrowedParameterIndexes).map(([name, indexes]) => [name, Object.freeze(indexes)]),
  )),
  borrowedResultPaths: Object.freeze(entry.borrowedResultPaths.map(path => Object.freeze(path))),
  dependencyFingerprints: Object.freeze(entry.dependencyFingerprints),
})));

export function findStateBorrowedEffectContractEntry(modulePath, exportName) {
  const normalizedPath = String(modulePath || "").replaceAll("\\", "/").replace(/^\.\//, "");
  return STATE_BORROWED_EFFECT_CONTRACT.find(entry => entry.modulePath === normalizedPath && entry.exportName === exportName) || null;
}

export function inspectStateBorrowedEffectSource(source, entry, {
  readSource = modulePath => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8"),
} = {}) {
  const violations = [];
  const expected = findStateBorrowedEffectContractEntry(entry?.modulePath, entry?.exportName);
  if (!expected || JSON.stringify(entry) !== JSON.stringify(expected)) {
    return { violations: [{ code: "borrowed-effect-unknown-contract" }] };
  }
  try {
    const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
    const declaration = ast.body.find(node => node.type === "ExportNamedDeclaration"
      && node.declaration?.id?.name === expected.exportName)?.declaration;
    if (!declaration || declaration.params.length !== expected.argumentCount) {
      violations.push({ code: "borrowed-effect-export-shape-mismatch", exportName: expected.exportName });
    }
  } catch (error) {
    violations.push({ code: "borrowed-effect-parse-failure", message: error.message });
  }
  if (fingerprint(source) !== expected.sourceFingerprint) {
    violations.push({ code: "borrowed-effect-source-mismatch", modulePath: expected.modulePath });
  }
  for (const [modulePath, expectedFingerprint] of Object.entries(expected.dependencyFingerprints)) {
    try {
      const dependencySource = readSource(modulePath);
      if (fingerprint(dependencySource) !== expectedFingerprint) {
        violations.push({ code: "borrowed-effect-dependency-mismatch", modulePath });
      }
    } catch (error) {
      violations.push({ code: "borrowed-effect-dependency-unavailable", modulePath, message: error.message });
    }
  }
  return { violations };
}

// A factory parameter is trusted only at its audited production injection site.
// Tests remain free to inject substitutes; new production consumers fail closed.
// Direct callback receipts prove read-only use of the specified borrowed inputs,
// not purity: bounds publish cache/diagnostic actions and glow replaces intensity
// state. Private-cache results retain their identity and mutability; they contain
// no borrowed input/state references but are not claimed to be deep detached.
const callbackInjectionDefinitions =[
  {
    "modulePath": "js/core/scenario/chunk_runtime.js",
    "enclosingFactoryExportName": "createScenarioChunkRuntimeController",
    "parameterName": "mergeScenarioChunkPayloads",
    "parameterPath": "$/property:mergeScenarioChunkPayloads",
    "parameterIndex": 0,
    "callbackName": "mergeScenarioChunkPayloads",
    "assemblyModulePath": "js/core/scenario_resources.js",
    "implementationModulePath": "js/core/scenario_chunk_manager.js",
    "implementationExportName": "mergeScenarioChunkPayloads",
    "sourceFingerprints": {
      "js/core/scenario/chunk_runtime.js": "dba4786f02dd30a2aec378cb4379cdef7050b8db43757dcd1a00960dded525c9",
      "js/core/scenario_resources.js": "a25c10176ae23a166ce3e7b6d29d6b0ba5bd8c4af75be58fea54bcc3bb4cce09",
      "js/core/scenario_chunk_manager.js": "600141575549766e7be14102def421dd86f8476174ee4fb59f0ebb14996281dc",
      "js/core/scenario/political_lod_policy.js": "2ddb65299ede3a51ce306f8e42bfa5b5710b0a7ac87c7eac8819142ee04a9c45",
      "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
      "js/core/feature_identity_shared.js": "87740ee4f95f77350073884c812865264b9e5eae2e0bfeec88d066648c2bcf0a",
      "js/core/country_code_aliases.js": "5c65ff97e89d7cfaf3c8b575c975ef25caf50d5a9a00aea34b3bd812ac661726"
    }
  },
  {
    "modulePath": "js/core/scenario/chunk_runtime.js",
    "enclosingFactoryExportName": "createScenarioChunkRuntimeController",
    "parameterName": "mergeScenarioChunkPayloadsForViewport",
    "parameterPath": "$/property:mergeScenarioChunkPayloadsForViewport",
    "parameterIndex": 0,
    "callbackName": "mergeScenarioChunkPayloadsForViewport",
    "assemblyModulePath": "js/core/scenario_resources.js",
    "implementationModulePath": "js/core/scenario_chunk_manager.js",
    "implementationExportName": "mergeScenarioChunkPayloadsForViewport",
    "sourceFingerprints": {
      "js/core/scenario/chunk_runtime.js": "dba4786f02dd30a2aec378cb4379cdef7050b8db43757dcd1a00960dded525c9",
      "js/core/scenario_resources.js": "a25c10176ae23a166ce3e7b6d29d6b0ba5bd8c4af75be58fea54bcc3bb4cce09",
      "js/core/scenario_chunk_manager.js": "600141575549766e7be14102def421dd86f8476174ee4fb59f0ebb14996281dc",
      "js/core/scenario/political_lod_policy.js": "2ddb65299ede3a51ce306f8e42bfa5b5710b0a7ac87c7eac8819142ee04a9c45",
      "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
      "js/core/feature_identity_shared.js": "87740ee4f95f77350073884c812865264b9e5eae2e0bfeec88d066648c2bcf0a",
      "js/core/country_code_aliases.js": "5c65ff97e89d7cfaf3c8b575c975ef25caf50d5a9a00aea34b3bd812ac661726"
    }
  },
  {
    "modulePath": "js/core/map_renderer/scenario_refresh_runtime.js",
    "enclosingFactoryExportName": "createScenarioRefreshRuntime",
    "bindingKind": "destructured-local",
    "rootParameterName": "deps",
    "parameterName": "buildInteractiveLandData",
    "parameterPath": "$/property:buildInteractiveLandData",
    "parameterIndex": 0,
    "callbackName": "buildInteractiveLandData",
    "assemblyModulePath": "js/core/map_renderer.js",
    "implementationModulePath": "js/core/renderer/political_collection_owner.js",
    "implementationExportName": "createPoliticalCollectionOwner",
    "requiredOwnerCompositionNames": [
      "composePoliticalFeaturePolicy"
    ],
    "callbackReturnsBorrowed": true,
    "sourceFingerprints": {
      "js/core/map_renderer/scenario_refresh_runtime.js": "4b3bb3c073a7c66f46886ff35e205b506c7de42ca000ed5e1d03e280bbab8a18",
      "js/core/map_renderer.js": "b2e4c91cb69ea76ac1a9262c230005e3d16b0c3335fafc5d57a7d574a18877ec",
      "js/core/river_paint/partition_model.js": "3ec6a9e6c13ed80c73fa9baaa324e75b1df678f7cd0ed34191f9ebb1f40fc8f1",
      "js/core/river_paint/geometry_identity.js": "2e4562a87beecfb75273458038fb1d9cc9d092592551fbf2fef4e83af573ff78",
      "js/core/river_paint/pilot_manifest.js": "e63d24879c44b189d94914f108fdfe5f5f22d52709701b4f753dbe9611711cd9",
      "js/core/renderer/political_collection_owner.js": "339ee012af48aa0304fcb9b7fc8cbea02dfc8fccf11088d14687778603231368",
      "js/core/renderer/political_feature_policy.js": "43a3eba1061b38f6609b533a588ce12876ae315d87d2b75aee395d61786d4a6f",
      "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
      "js/core/feature_identity_shared.js": "87740ee4f95f77350073884c812865264b9e5eae2e0bfeec88d066648c2bcf0a",
      "js/core/country_code_aliases.js": "5c65ff97e89d7cfaf3c8b575c975ef25caf50d5a9a00aea34b3bd812ac661726",
      "vendor/d3.v7.min.js": "f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539"
    }
  },
  {
    "modulePath": "js/core/map_renderer/scenario_refresh_runtime.js",
    "enclosingFactoryExportName": "createScenarioRefreshRuntime",
    "bindingKind": "destructured-local",
    "rootParameterName": "deps",
    "parameterName": "shouldExcludePoliticalVisualFeature",
    "parameterPath": "$/property:shouldExcludePoliticalVisualFeature",
    "parameterIndex": 0,
    "callbackName": "shouldExcludePoliticalVisualFeature",
    "assemblyModulePath": "js/core/map_renderer.js",
    "implementationModulePath": "js/core/renderer/political_feature_policy.js",
    "implementationExportName": "createPoliticalFeaturePolicy",
    "requiredOwnerCompositionNames": [
      "composePoliticalFeaturePolicy"
    ],
    "callbackReturnsBorrowed": false,
    "sourceFingerprints": {
      "js/core/map_renderer/scenario_refresh_runtime.js": "4b3bb3c073a7c66f46886ff35e205b506c7de42ca000ed5e1d03e280bbab8a18",
      "js/core/map_renderer.js": "b2e4c91cb69ea76ac1a9262c230005e3d16b0c3335fafc5d57a7d574a18877ec",
      "js/core/river_paint/partition_model.js": "3ec6a9e6c13ed80c73fa9baaa324e75b1df678f7cd0ed34191f9ebb1f40fc8f1",
      "js/core/river_paint/geometry_identity.js": "2e4562a87beecfb75273458038fb1d9cc9d092592551fbf2fef4e83af573ff78",
      "js/core/river_paint/pilot_manifest.js": "e63d24879c44b189d94914f108fdfe5f5f22d52709701b4f753dbe9611711cd9",
      "js/core/renderer/political_collection_owner.js": "339ee012af48aa0304fcb9b7fc8cbea02dfc8fccf11088d14687778603231368",
      "js/core/renderer/political_feature_policy.js": "43a3eba1061b38f6609b533a588ce12876ae315d87d2b75aee395d61786d4a6f",
      "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
      "js/core/feature_identity_shared.js": "87740ee4f95f77350073884c812865264b9e5eae2e0bfeec88d066648c2bcf0a",
      "js/core/country_code_aliases.js": "5c65ff97e89d7cfaf3c8b575c975ef25caf50d5a9a00aea34b3bd812ac661726",
      "vendor/d3.v7.min.js": "f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539"
    }
  },
  {
    "modulePath": "js/core/scenario/chunk_runtime.js",
    "enclosingFactoryExportName": "createScenarioChunkRuntimeController",
    "parameterName": "normalizeScenarioId",
    "parameterPath": "$/property:normalizeScenarioId",
    "parameterIndex": 0,
    "callbackName": "normalizeScenarioId",
    "assemblyModulePath": "js/core/scenario_resources.js",
    "implementationModulePath": "js/core/scenario/shared.js",
    "implementationExportName": "normalizeScenarioId",
    "invocationArgumentCount": 1,
    "invocationBorrowedArgumentIndexes": [
      0
    ],
    "callbackReturnsBorrowed": false,
    "sourceFingerprints": {
      "js/core/scenario/chunk_runtime.js": "dba4786f02dd30a2aec378cb4379cdef7050b8db43757dcd1a00960dded525c9",
      "js/core/scenario_resources.js": "a25c10176ae23a166ce3e7b6d29d6b0ba5bd8c4af75be58fea54bcc3bb4cce09",
      "js/core/scenario/shared.js": "827902ae4329606239ac8b42c7b36702c996fea4015bc35d59f8e4aa770db77d"
    }
  },
  {
    "modulePath": "js/core/renderer/city_lights_render_owner.js",
    "enclosingFactoryExportName": "createCityLightsRenderOwner",
    "bindingKind": "destructured-local",
    "rootParameterName": "helpers",
    "parameterName": "pathBoundsInScreen",
    "parameterPath": "$/property:helpers/property:pathBoundsInScreen",
    "parameterIndex": 0,
    "callbackName": "pathBoundsInScreen",
    "assemblyModulePath": "js/core/map_renderer.js",
    "implementationModulePath": "js/core/map_renderer.js",
    "implementationExportName": "pathBoundsInScreen",
    "invocationArgumentCount": 1,
    "invocationBorrowedArgumentIndexes": [
      0
    ],
    "invocationResultKind": "scalar",
    "callbackReturnsBorrowed": false,
    "requiredOwnerCompositionNames": [
      "getProjectedGeometryBoundsOwner",
      "recordProjectedBoundsDiagnosticsState",
      "getRendererProjectionPathOwner",
      "getScenarioRegionOverlayRenderOwner",
      "getRenderPerfMetricsRuntimeOwner"
    ],
    "sourceFingerprints": {
      "js/core/renderer/city_lights_render_owner.js": "0cd18953a1a501db7c3ce0b39988082235bea5751d300ff1ca044c0c64966a1d",
      "js/core/map_renderer.js": "b2e4c91cb69ea76ac1a9262c230005e3d16b0c3335fafc5d57a7d574a18877ec",
      "js/core/renderer/projected_geometry_bounds_owner.js": "19c6770ea59cad8c7ac3a5294b5d5ba0530883afa0c8b9e42d7cef17638b6447",
      "js/core/state/renderer_runtime_state.js": "86c16c937cd2d3a28ef05dc3c42b47630f70b32355caab99394e6a835783abb8",
      "js/core/state/actions/renderer_cache_actions.js": "4ffe985761e14cba6978de1f529007317063d1ecc9776108b67a5d3cf8a1c739",
      "js/core/renderer/projected_bounds_diagnostics_owner.js": "a121edc8b9f0ddb7418614e72a8a8498b412483da0fa47977e396f5c74b55b22",
      "js/core/state/actions/renderer_diagnostics_actions.js": "4c87c50b0e93c79d07d8ac6b218246427424ccbe4fb18440f880022c4b030515",
      "js/core/renderer/scenario_region_overlay_render_owner.js": "385c9e494f8da2ba43ef16e7ff72b816554391ce62b5c267a2ba3109e449ca5b",
      "js/core/renderer/render_perf_metrics_runtime_owner.js": "41543b243e6c8b1619c1f9c3e09b3deea0c88245318a5d78ac19754d2a9fa73d",
      "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
      "js/core/feature_identity_shared.js": "87740ee4f95f77350073884c812865264b9e5eae2e0bfeec88d066648c2bcf0a",
      "js/core/country_code_aliases.js": "5c65ff97e89d7cfaf3c8b575c975ef25caf50d5a9a00aea34b3bd812ac661726",
      "js/core/renderer/renderer_surface_host.js": "58361f391628007208099fba71707254a680e46310274e91bf8f22a876df3e83",
      "js/core/renderer/renderer_projection_path_owner.js": "489a62baf4bed0936dcd716b8ed2b9f87cc3fbec34ba0284d2adc1907dfae2bb",
      "js/core/renderer/projection_geometry_identity.js": "25aca815b841ab7238697cb512f2221bb1042bd50170a9804cee3e511669cf8e",
      "vendor/d3.v7.min.js": "f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539"
    }
  },
  {
    "modulePath": "js/core/renderer/city_lights_render_owner.js",
    "enclosingFactoryExportName": "createCityLightsRenderOwner",
    "bindingKind": "destructured-local",
    "rootParameterName": "helpers",
    "parameterName": "estimateProjectedAreaPx",
    "parameterPath": "$/property:helpers/property:estimateProjectedAreaPx",
    "parameterIndex": 0,
    "callbackName": "estimateProjectedAreaPx",
    "assemblyModulePath": "js/core/map_renderer.js",
    "implementationModulePath": "js/core/map_renderer.js",
    "implementationExportName": "estimateProjectedAreaPx",
    "invocationArgumentCount": 2,
    "invocationBorrowedArgumentIndexes": [
      0
    ],
    "invocationResultKind": "scalar",
    "callbackReturnsBorrowed": false,
    "requiredOwnerCompositionNames": [
      "getProjectedGeometryBoundsOwner",
      "recordProjectedBoundsDiagnosticsState",
      "getRendererProjectionPathOwner",
      "getScenarioRegionOverlayRenderOwner",
      "getRenderPerfMetricsRuntimeOwner"
    ],
    "sourceFingerprints": {
      "js/core/renderer/city_lights_render_owner.js": "0cd18953a1a501db7c3ce0b39988082235bea5751d300ff1ca044c0c64966a1d",
      "js/core/map_renderer.js": "b2e4c91cb69ea76ac1a9262c230005e3d16b0c3335fafc5d57a7d574a18877ec",
      "js/core/renderer/projected_geometry_bounds_owner.js": "19c6770ea59cad8c7ac3a5294b5d5ba0530883afa0c8b9e42d7cef17638b6447",
      "js/core/state/renderer_runtime_state.js": "86c16c937cd2d3a28ef05dc3c42b47630f70b32355caab99394e6a835783abb8",
      "js/core/state/actions/renderer_cache_actions.js": "4ffe985761e14cba6978de1f529007317063d1ecc9776108b67a5d3cf8a1c739",
      "js/core/renderer/projected_bounds_diagnostics_owner.js": "a121edc8b9f0ddb7418614e72a8a8498b412483da0fa47977e396f5c74b55b22",
      "js/core/state/actions/renderer_diagnostics_actions.js": "4c87c50b0e93c79d07d8ac6b218246427424ccbe4fb18440f880022c4b030515",
      "js/core/renderer/scenario_region_overlay_render_owner.js": "385c9e494f8da2ba43ef16e7ff72b816554391ce62b5c267a2ba3109e449ca5b",
      "js/core/renderer/render_perf_metrics_runtime_owner.js": "41543b243e6c8b1619c1f9c3e09b3deea0c88245318a5d78ac19754d2a9fa73d",
      "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
      "js/core/feature_identity_shared.js": "87740ee4f95f77350073884c812865264b9e5eae2e0bfeec88d066648c2bcf0a",
      "js/core/country_code_aliases.js": "5c65ff97e89d7cfaf3c8b575c975ef25caf50d5a9a00aea34b3bd812ac661726",
      "js/core/renderer/renderer_surface_host.js": "58361f391628007208099fba71707254a680e46310274e91bf8f22a876df3e83",
      "js/core/renderer/renderer_projection_path_owner.js": "489a62baf4bed0936dcd716b8ed2b9f87cc3fbec34ba0284d2adc1907dfae2bb",
      "js/core/renderer/projection_geometry_identity.js": "25aca815b841ab7238697cb512f2221bb1042bd50170a9804cee3e511669cf8e",
      "vendor/d3.v7.min.js": "f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539"
    }
  },
  {
    "modulePath": "js/core/renderer/city_lights_render_owner.js",
    "enclosingFactoryExportName": "createCityLightsRenderOwner",
    "bindingKind": "destructured-local",
    "rootParameterName": "helpers",
    "parameterName": "getFeatureGeoCentroid",
    "parameterPath": "$/property:helpers/property:getFeatureGeoCentroid",
    "parameterIndex": 0,
    "callbackName": "getFeatureGeoCentroid",
    "assemblyModulePath": "js/core/map_renderer.js",
    "implementationModulePath": "js/core/map_renderer.js",
    "implementationExportName": "getFeatureGeoCentroid",
    "invocationArgumentCount": 1,
    "invocationBorrowedArgumentIndexes": [
      0
    ],
    "invocationResultKind": "private-cache",
    "callbackReturnsBorrowed": false,
    "requiredOwnerCompositionNames": [],
    "sourceFingerprints": {
      "js/core/renderer/city_lights_render_owner.js": "0cd18953a1a501db7c3ce0b39988082235bea5751d300ff1ca044c0c64966a1d",
      "js/core/map_renderer.js": "b2e4c91cb69ea76ac1a9262c230005e3d16b0c3335fafc5d57a7d574a18877ec",
      "vendor/d3.v7.min.js": "f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539"
    }
  },
  {
    "modulePath": "js/core/renderer/city_lights_render_owner.js",
    "enclosingFactoryExportName": "createCityLightsRenderOwner",
    "bindingKind": "destructured-local",
    "rootParameterName": "helpers",
    "parameterName": "getProjectedGeographicPath",
    "parameterPath": "$/property:helpers/property:getProjectedGeographicPath",
    "parameterIndex": 0,
    "callbackName": "getProjectedGeographicPath",
    "assemblyModulePath": "js/core/map_renderer.js",
    "implementationModulePath": "js/core/map_renderer.js",
    "implementationExportName": "getProjectedGeographicPath",
    "invocationArgumentCount": 1,
    "invocationBorrowedArgumentIndexes": [
      0
    ],
    "invocationResultKind": "private-cache",
    "callbackReturnsBorrowed": false,
    "requiredOwnerCompositionNames": [
      "getProjectedGeographicPathCache",
      "getRendererProjectionPathOwner"
    ],
    "sourceFingerprints": {
      "js/core/renderer/city_lights_render_owner.js": "0cd18953a1a501db7c3ce0b39988082235bea5751d300ff1ca044c0c64966a1d",
      "js/core/map_renderer.js": "b2e4c91cb69ea76ac1a9262c230005e3d16b0c3335fafc5d57a7d574a18877ec",
      "js/core/renderer/projected_geographic_path_cache.js": "42384146c3a12b6f975fa479289c0bbe9064b99d4ab0819739ea3d95b39d6bca",
      "js/core/renderer/renderer_surface_host.js": "58361f391628007208099fba71707254a680e46310274e91bf8f22a876df3e83",
      "js/core/renderer/renderer_projection_path_owner.js": "489a62baf4bed0936dcd716b8ed2b9f87cc3fbec34ba0284d2adc1907dfae2bb",
      "js/core/renderer/projection_geometry_identity.js": "25aca815b841ab7238697cb512f2221bb1042bd50170a9804cee3e511669cf8e",
      "vendor/d3.v7.min.js": "f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539"
    }
  },
  {
    "modulePath": "js/core/renderer/city_lights_render_owner.js",
    "enclosingFactoryExportName": "createCityLightsRenderOwner",
    "bindingKind": "destructured-local",
    "rootParameterName": "helpers",
    "parameterName": "getUrbanGlowMultiplierAt",
    "parameterPath": "$/property:helpers/property:getUrbanGlowMultiplierAt",
    "parameterIndex": 0,
    "callbackName": "getUrbanGlowMultiplierAt",
    "assemblyModulePath": "js/core/map_renderer.js",
    "implementationModulePath": "js/core/map_renderer.js",
    "implementationExportName": "getUrbanGlowMultiplierAt",
    "invocationArgumentCount": 2,
    "invocationBorrowedArgumentIndexes": [
      0,
      1
    ],
    "invocationResultKind": "scalar",
    "callbackReturnsBorrowed": false,
    "requiredOwnerCompositionNames": [],
    "sourceFingerprints": {
      "js/core/renderer/city_lights_render_owner.js": "0cd18953a1a501db7c3ce0b39988082235bea5751d300ff1ca044c0c64966a1d",
      "js/core/map_renderer.js": "b2e4c91cb69ea76ac1a9262c230005e3d16b0c3335fafc5d57a7d574a18877ec",
      "js/core/state.js": "d5db7104a473a577bff27bdee57125982dc7b66f6bc14e76d0f87e3bb336aaef",
      "js/core/intensity_field.js": "f9bfad34368d667483e85ef831944ce1851ca47c96cdc73221c165c260f1293f",
      "js/core/state/intensity_field_state.js": "31631a55a3a26f9a3e1eda661c2bbf1477df2c5d53e8ef77c743fde813b7478d"
    }
  },
  {
    "modulePath": "js/core/renderer/city_lights_render_owner.js",
    "enclosingFactoryExportName": "createCityLightsRenderOwner",
    "bindingKind": "destructured-local",
    "rootParameterName": "getters",
    "parameterName": "getProjection",
    "parameterPath": "$/property:getters/property:getProjection",
    "parameterIndex": 0,
    "callbackName": "getProjection",
    "assemblyModulePath": "js/core/map_renderer.js",
    "implementationModulePath": "js/core/renderer/renderer_surface_host.js",
    "implementationExportName": "createRendererSurfaceHost",
    "invocationArgumentCount": 0,
    "invocationBorrowedArgumentIndexes": [],
    "invocationResultKind": "shared-capability",
    "callbackReturnsBorrowed": true,
    "invocationResultCalls": [
      {
        "method": null,
        "argumentCount": 1,
        "borrowedArgumentIndexes": [
          0
        ],
        "returnsBorrowedState": false
      },
      {
        "method": "scale",
        "argumentCount": 0,
        "borrowedArgumentIndexes": [],
        "returnsBorrowedState": false
      },
      {
        "method": "translate",
        "argumentCount": 0,
        "borrowedArgumentIndexes": [],
        "returnsBorrowedState": false
      },
      {
        "method": "center",
        "argumentCount": 0,
        "borrowedArgumentIndexes": [],
        "returnsBorrowedState": false
      },
      {
        "method": "rotate",
        "argumentCount": 0,
        "borrowedArgumentIndexes": [],
        "returnsBorrowedState": false
      }
    ],
    "requiredOwnerCompositionNames": [
      "getRendererProjectionPathOwner"
    ],
    "sourceFingerprints": {
      "js/core/renderer/city_lights_render_owner.js": "0cd18953a1a501db7c3ce0b39988082235bea5751d300ff1ca044c0c64966a1d",
      "js/core/map_renderer.js": "b2e4c91cb69ea76ac1a9262c230005e3d16b0c3335fafc5d57a7d574a18877ec",
      "js/core/renderer/renderer_surface_host.js": "58361f391628007208099fba71707254a680e46310274e91bf8f22a876df3e83",
      "js/core/renderer/renderer_projection_path_owner.js": "489a62baf4bed0936dcd716b8ed2b9f87cc3fbec34ba0284d2adc1907dfae2bb",
      "js/core/renderer/projection_geometry_identity.js": "25aca815b841ab7238697cb512f2221bb1042bd50170a9804cee3e511669cf8e",
      "vendor/d3.v7.min.js": "f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539"
    }
  },
  {
    "modulePath": "js/core/renderer/city_lights_render_owner.js",
    "enclosingFactoryExportName": "createCityLightsRenderOwner",
    "bindingKind": "destructured-local",
    "rootParameterName": "getters",
    "parameterName": "getPathCanvas",
    "parameterPath": "$/property:getters/property:getPathCanvas",
    "parameterIndex": 0,
    "callbackName": "getPathCanvas",
    "assemblyModulePath": "js/core/map_renderer.js",
    "implementationModulePath": "js/core/renderer/renderer_surface_host.js",
    "implementationExportName": "createRendererSurfaceHost",
    "invocationArgumentCount": 0,
    "invocationBorrowedArgumentIndexes": [],
    "invocationResultKind": "shared-capability",
    "callbackReturnsBorrowed": true,
    "invocationResultCalls": [
      {
        "method": "centroid",
        "argumentCount": 1,
        "borrowedArgumentIndexes": [
          0
        ],
        "returnsBorrowedState": false
      },
      {
        "method": "bounds",
        "argumentCount": 1,
        "borrowedArgumentIndexes": [
          0
        ],
        "returnsBorrowedState": false
      }
    ],
    "requiredOwnerCompositionNames": [
      "getRendererProjectionPathOwner"
    ],
    "sourceFingerprints": {
      "js/core/renderer/city_lights_render_owner.js": "0cd18953a1a501db7c3ce0b39988082235bea5751d300ff1ca044c0c64966a1d",
      "js/core/map_renderer.js": "b2e4c91cb69ea76ac1a9262c230005e3d16b0c3335fafc5d57a7d574a18877ec",
      "js/core/renderer/renderer_surface_host.js": "58361f391628007208099fba71707254a680e46310274e91bf8f22a876df3e83",
      "js/core/renderer/renderer_projection_path_owner.js": "489a62baf4bed0936dcd716b8ed2b9f87cc3fbec34ba0284d2adc1907dfae2bb",
      "js/core/renderer/projection_geometry_identity.js": "25aca815b841ab7238697cb512f2221bb1042bd50170a9804cee3e511669cf8e",
      "vendor/d3.v7.min.js": "f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539"
    }
  },
  {
    "modulePath": "js/core/scenario/chunk_runtime.js",
    "enclosingFactoryExportName": "createScenarioChunkRuntimeController",
    "parameterName": "normalizeScenarioFeatureCollection",
    "parameterPath": "$/property:normalizeScenarioFeatureCollection",
    "parameterIndex": 0,
    "callbackName": "normalizeScenarioFeatureCollection",
    "assemblyModulePath": "js/core/scenario_resources.js",
    "implementationModulePath": "js/core/scenario/pure_helpers.js",
    "implementationExportName": "normalizeScenarioFeatureCollection",
    "invocationArgumentCount": 1,
    "invocationBorrowedArgumentIndexes": [
      0
    ],
    "callbackReturnsBorrowed": true,
    "invocationBorrowedResultPaths": [
      [
        "features"
      ]
    ],
    "sourceFingerprints": {
      "js/core/scenario/chunk_runtime.js": "dba4786f02dd30a2aec378cb4379cdef7050b8db43757dcd1a00960dded525c9",
      "js/core/scenario_resources.js": "a25c10176ae23a166ce3e7b6d29d6b0ba5bd8c4af75be58fea54bcc3bb4cce09",
      "js/core/scenario/pure_helpers.js": "0c48e6f3a5138da08e2550700aa37af574be2fafda8f010e868908f82f218d8d"
    }
  },
  {
    "modulePath": "js/core/scenario/chunk_runtime.js",
    "enclosingFactoryExportName": "createScenarioChunkRuntimeController",
    "parameterName": "getScenarioFeatureCollectionIdentityList",
    "parameterPath": "$/property:getScenarioFeatureCollectionIdentityList",
    "parameterIndex": 0,
    "callbackName": "getScenarioFeatureCollectionIdentityList",
    "assemblyModulePath": "js/core/scenario_resources.js",
    "implementationModulePath": "js/core/scenario/pure_helpers.js",
    "implementationExportName": "getScenarioFeatureCollectionIdentityList",
    "invocationArgumentCount": 1,
    "invocationBorrowedArgumentIndexes": [
      0
    ],
    "callbackReturnsBorrowed": false,
    "invocationBorrowedResultPaths": [],
    "sourceFingerprints": {
      "js/core/scenario/chunk_runtime.js": "dba4786f02dd30a2aec378cb4379cdef7050b8db43757dcd1a00960dded525c9",
      "js/core/scenario_resources.js": "a25c10176ae23a166ce3e7b6d29d6b0ba5bd8c4af75be58fea54bcc3bb4cce09",
      "js/core/scenario/pure_helpers.js": "0c48e6f3a5138da08e2550700aa37af574be2fafda8f010e868908f82f218d8d",
      "js/core/scenario_runtime_queries.js": "b4d1805c004e9f24fc757ab6d279f63eed0276fdbe104ceabf643b569e848e03",
      "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
      "js/core/feature_identity_shared.js": "87740ee4f95f77350073884c812865264b9e5eae2e0bfeec88d066648c2bcf0a",
      "js/core/country_code_aliases.js": "5c65ff97e89d7cfaf3c8b575c975ef25caf50d5a9a00aea34b3bd812ac661726"
    }
  },
  {
    "modulePath": "js/core/scenario/chunk_runtime.js",
    "enclosingFactoryExportName": "createScenarioChunkRuntimeController",
    "parameterName": "areScenarioFeatureCollectionsEquivalent",
    "parameterPath": "$/property:areScenarioFeatureCollectionsEquivalent",
    "parameterIndex": 0,
    "callbackName": "areScenarioFeatureCollectionsEquivalent",
    "assemblyModulePath": "js/core/scenario_resources.js",
    "implementationModulePath": "js/core/scenario/pure_helpers.js",
    "implementationExportName": "areScenarioFeatureCollectionsEquivalent",
    "invocationArgumentCount": 2,
    "invocationBorrowedArgumentIndexes": [
      0,
      1
    ],
    "callbackReturnsBorrowed": false,
    "invocationBorrowedResultPaths": [],
    "sourceFingerprints": {
      "js/core/scenario/chunk_runtime.js": "dba4786f02dd30a2aec378cb4379cdef7050b8db43757dcd1a00960dded525c9",
      "js/core/scenario_resources.js": "a25c10176ae23a166ce3e7b6d29d6b0ba5bd8c4af75be58fea54bcc3bb4cce09",
      "js/core/scenario/pure_helpers.js": "0c48e6f3a5138da08e2550700aa37af574be2fafda8f010e868908f82f218d8d"
    }
  },
  {
    "modulePath": "js/core/renderer/city_lights_render_owner.js",
    "enclosingFactoryExportName": "createCityLightsRenderOwner",
    "bindingKind": "destructured-local",
    "rootParameterName": "helpers",
    "parameterName": "normalizeLongitude",
    "parameterPath": "$/property:helpers/property:normalizeLongitude",
    "parameterIndex": 0,
    "callbackName": "normalizeLongitude",
    "assemblyModulePath": "js/core/map_renderer.js",
    "implementationModulePath": "js/core/map_renderer.js",
    "implementationExportName": "normalizeLongitude",
    "invocationArgumentCount": 1,
    "invocationBorrowedArgumentIndexes": [
      0
    ],
    "invocationResultKind": "scalar",
    "callbackReturnsBorrowed": false,
    "sourceFingerprints": {
      "js/core/renderer/city_lights_render_owner.js": "0cd18953a1a501db7c3ce0b39988082235bea5751d300ff1ca044c0c64966a1d",
      "js/core/map_renderer.js": "b2e4c91cb69ea76ac1a9262c230005e3d16b0c3335fafc5d57a7d574a18877ec"
    }
  },
  {
    "modulePath": "js/core/renderer/city_lights_render_owner.js",
    "enclosingFactoryExportName": "createCityLightsRenderOwner",
    "bindingKind": "destructured-local",
    "rootParameterName": "helpers",
    "parameterName": "clamp",
    "parameterPath": "$/property:helpers/property:clamp",
    "parameterIndex": 0,
    "callbackName": "clamp",
    "assemblyModulePath": "js/core/map_renderer.js",
    "implementationModulePath": "js/core/map_renderer.js",
    "implementationExportName": "clamp",
    "invocationArgumentCount": 3,
    "invocationBorrowedArgumentIndexes": [
      0
    ],
    "invocationResultKind": "scalar",
    "callbackReturnsBorrowed": false,
    "sourceFingerprints": {
      "js/core/renderer/city_lights_render_owner.js": "0cd18953a1a501db7c3ce0b39988082235bea5751d300ff1ca044c0c64966a1d",
      "js/core/map_renderer.js": "b2e4c91cb69ea76ac1a9262c230005e3d16b0c3335fafc5d57a7d574a18877ec"
    }
  },
  {
    "modulePath": "js/core/renderer/city_lights_render_owner.js",
    "enclosingFactoryExportName": "createCityLightsRenderOwner",
    "bindingKind": "destructured-local",
    "rootParameterName": "helpers",
    "parameterName": "getProjectedFeatureBounds",
    "parameterPath": "$/property:helpers/property:getProjectedFeatureBounds",
    "parameterIndex": 0,
    "callbackName": "getProjectedFeatureBounds",
    "assemblyModulePath": "js/core/map_renderer.js",
    "implementationModulePath": "js/core/map_renderer.js",
    "implementationExportName": "getProjectedFeatureBounds",
    "invocationArgumentCount": 1,
    "invocationBorrowedArgumentIndexes": [
      0
    ],
    "invocationResultKind": "shared-cache",
    "callbackReturnsBorrowed": true,
    "requiredOwnerCompositionNames": [
      "getProjectedGeometryBoundsOwner",
      "recordProjectedBoundsDiagnosticsState",
      "getRendererProjectionPathOwner",
      "getScenarioRegionOverlayRenderOwner",
      "getRenderPerfMetricsRuntimeOwner"
    ],
    "sourceFingerprints": {
      "js/core/renderer/city_lights_render_owner.js": "0cd18953a1a501db7c3ce0b39988082235bea5751d300ff1ca044c0c64966a1d",
      "js/core/map_renderer.js": "b2e4c91cb69ea76ac1a9262c230005e3d16b0c3335fafc5d57a7d574a18877ec",
      "js/core/renderer/projected_geometry_bounds_owner.js": "19c6770ea59cad8c7ac3a5294b5d5ba0530883afa0c8b9e42d7cef17638b6447",
      "js/core/state/renderer_runtime_state.js": "86c16c937cd2d3a28ef05dc3c42b47630f70b32355caab99394e6a835783abb8",
      "js/core/state/actions/renderer_cache_actions.js": "4ffe985761e14cba6978de1f529007317063d1ecc9776108b67a5d3cf8a1c739",
      "js/core/renderer/projected_bounds_diagnostics_owner.js": "a121edc8b9f0ddb7418614e72a8a8498b412483da0fa47977e396f5c74b55b22",
      "js/core/state/actions/renderer_diagnostics_actions.js": "4c87c50b0e93c79d07d8ac6b218246427424ccbe4fb18440f880022c4b030515",
      "js/core/renderer/scenario_region_overlay_render_owner.js": "385c9e494f8da2ba43ef16e7ff72b816554391ce62b5c267a2ba3109e449ca5b",
      "js/core/renderer/render_perf_metrics_runtime_owner.js": "41543b243e6c8b1619c1f9c3e09b3deea0c88245318a5d78ac19754d2a9fa73d",
      "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
      "js/core/feature_identity_shared.js": "87740ee4f95f77350073884c812865264b9e5eae2e0bfeec88d066648c2bcf0a",
      "js/core/country_code_aliases.js": "5c65ff97e89d7cfaf3c8b575c975ef25caf50d5a9a00aea34b3bd812ac661726",
      "js/core/renderer/renderer_surface_host.js": "58361f391628007208099fba71707254a680e46310274e91bf8f22a876df3e83",
      "js/core/renderer/renderer_projection_path_owner.js": "489a62baf4bed0936dcd716b8ed2b9f87cc3fbec34ba0284d2adc1907dfae2bb",
      "js/core/renderer/projection_geometry_identity.js": "25aca815b841ab7238697cb512f2221bb1042bd50170a9804cee3e511669cf8e",
      "vendor/d3.v7.min.js": "f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539"
    },
    "invocationBorrowedResultPaths": [
      []
    ]
  },
  {
    "modulePath": "js/core/scenario/chunk_runtime.js",
    "enclosingFactoryExportName": "createScenarioChunkRuntimeController",
    "parameterName": "syncScenarioLocalizationState",
    "parameterPath": "$/property:syncScenarioLocalizationState",
    "parameterIndex": 0,
    "callbackName": "syncScenarioLocalizationState",
    "assemblyModulePath": "js/core/scenario_resources.js",
    "implementationModulePath": "js/core/scenario_localization_state.js",
    "implementationExportName": "syncScenarioLocalizationState",
    "invocationArgumentCount": 1,
    "invocationBorrowedArgumentIndexes": [
      0
    ],
    "callbackReturnsBorrowed": false,
    "invocationResultKind": "undefined",
    "effects": [
      "Publish city override payload reference through applyScenarioChunkCityExternalEffectState and increment cityLayerRevision",
      "Publish geo locale patch reference, preserving the existing default payload when omitted",
      "Rebuild locales.geo and geoAliasToStableKey holders from base and scenario dictionaries; nested source values can remain shared",
      "Read source feature and coordinate references for D3 containment/centroid localization without mutating those inputs",
      "Emit console.info for synchronized locale conflicts; the callback returns undefined"
    ],
    "sourceFingerprints": {
      "js/core/scenario/chunk_runtime.js": "dba4786f02dd30a2aec378cb4379cdef7050b8db43757dcd1a00960dded525c9",
      "js/core/scenario_resources.js": "a25c10176ae23a166ce3e7b6d29d6b0ba5bd8c4af75be58fea54bcc3bb4cce09",
      "js/core/scenario_localization_state.js": "acddbb64da4c1df0424dde3bc8d90a1b26fcf4c2eb09f6b5f94362c39cd3ded3",
      "js/core/state.js": "d5db7104a473a577bff27bdee57125982dc7b66f6bc14e76d0f87e3bb336aaef",
      "js/core/state/actions/scenario_presentation_actions.js": "d7d718d9d3a177888cee6314f854cb1bda3f4c1f4591167115a125801dc4d066",
      "js/core/data_loader.js": "a73ace4f40db48f4199788b1a551a85632a6065bb2258e5c8e2e677aadc81ef6",
      "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
      "js/core/feature_identity_shared.js": "87740ee4f95f77350073884c812865264b9e5eae2e0bfeec88d066648c2bcf0a",
      "js/core/country_code_aliases.js": "5c65ff97e89d7cfaf3c8b575c975ef25caf50d5a9a00aea34b3bd812ac661726",
      "vendor/d3.v7.min.js": "f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539"
    }
  }
]
;
export const STATE_BORROWED_CALLBACK_INJECTION_CONTRACT = Object.freeze(callbackInjectionDefinitions.map(entry => Object.freeze({
  ...entry, sourceFingerprints: Object.freeze(entry.sourceFingerprints),
  ...(entry.effects ? { effects: Object.freeze(entry.effects) } : {}),
  requiredOwnerCompositionNames: Object.freeze(entry.requiredOwnerCompositionNames || []),
  ...(entry.invocationBorrowedArgumentIndexes ? { invocationBorrowedArgumentIndexes: Object.freeze(entry.invocationBorrowedArgumentIndexes) } : {}),
  ...(entry.invocationBorrowedResultPaths ? { invocationBorrowedResultPaths: Object.freeze(entry.invocationBorrowedResultPaths.map(path => Object.freeze(path))) } : {}),
  ...(entry.invocationResultCalls ? { invocationResultCalls: Object.freeze(entry.invocationResultCalls.map(call => Object.freeze({ ...call, borrowedArgumentIndexes: Object.freeze(call.borrowedArgumentIndexes) }))) } : {}),
})));
export function findStateBorrowedCallbackInjectionEntry(modulePath, enclosingFactoryExportName, parameterName) {
  return STATE_BORROWED_CALLBACK_INJECTION_CONTRACT.find(entry => entry.modulePath === modulePath
    && entry.enclosingFactoryExportName === enclosingFactoryExportName && entry.parameterName === parameterName) || null;
}
function listProductionJavaScriptModules(directory = "js") {
  const modules = [];
  for (const item of readdirSync(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true })) {
    const modulePath = `${directory}/${item.name}`;
    if (item.isDirectory()) modules.push(...listProductionJavaScriptModules(modulePath));
    else if (item.name.endsWith(".js") || item.name.endsWith(".mjs")) modules.push(modulePath);
  }
  return modules;
}
export function inspectStateBorrowedCallbackInjectionSources(entry, {
  readSource = modulePath => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8"),
  productionModulePaths = null,
} = {}) {
  const expected = findStateBorrowedCallbackInjectionEntry(entry?.modulePath, entry?.enclosingFactoryExportName, entry?.parameterName);
  if (!expected || JSON.stringify(expected) !== JSON.stringify(entry)) {
    return { violations: [{ code: "borrowed-callback-unknown-injection" }] };
  }
  const violations = [];
  for (const [modulePath, expectedFingerprint] of Object.entries(expected.sourceFingerprints)) {
    try {
      if (fingerprint(readSource(modulePath)) !== expectedFingerprint) {
        violations.push({ code: "borrowed-callback-injection-source-mismatch", modulePath });
      }
    } catch (error) {
      violations.push({ code: "borrowed-callback-injection-source-unavailable", modulePath, message: error.message });
    }
  }
  for (const compositionName of expected.requiredOwnerCompositionNames) {
    const ownerEntry = STATE_MUTATION_DELEGATING_OWNER_CONTRACT.find(candidate => candidate.compositionModulePath === expected.assemblyModulePath
      && candidate.compositionExportName === compositionName);
    if (!ownerEntry) {
      violations.push({ code: "borrowed-callback-owner-proof-missing", compositionName });
      continue;
    }
    try {
      const checked = inspectStateMutationDelegatingOwnerSources({
        compositionSource: readSource(ownerEntry.compositionModulePath),
        factorySource: readSource(ownerEntry.factoryModulePath), entry: ownerEntry,
      });
      violations.push(...checked.violations);
    } catch (error) {
      violations.push({ code: "borrowed-callback-owner-proof-failed", compositionName, message: error.message });
    }
  }
  // Additional production consumers need their own audited injection receipt.
  try {
    for (const modulePath of productionModulePaths || listProductionJavaScriptModules()) {
      if (modulePath === expected.modulePath || modulePath === expected.assemblyModulePath) continue;
      const source = readSource(modulePath);
      if (!source.includes(posix.basename(expected.modulePath, ".js"))) continue;
      const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
      full(ast, node => {
        if (node.type !== "ImportExpression") return;
        const specifier = node.source?.value;
        if (typeof specifier !== "string" || posix.normalize(posix.join(posix.dirname(modulePath), specifier)) === expected.modulePath) {
          violations.push({ code: "borrowed-callback-unproven-production-consumer", modulePath });
        }
      });
      for (const statement of ast.body) {
        if (!statement.source?.value || !String(statement.source.value).startsWith(".")) continue;
        const resolved = posix.normalize(posix.join(posix.dirname(modulePath), statement.source.value));
        if (resolved === expected.modulePath) violations.push({ code: "borrowed-callback-unproven-production-consumer", modulePath });
      }
    }
  } catch (error) {
    violations.push({ code: "borrowed-callback-production-discovery-failed", message: error.message });
  }
  return { violations };
}

// Reference-flow receipt only: this runtime still performs its existing state effects.
const borrowedRuntimeDefinition = {
  "factoryModulePath": "js/core/scenario/chunk_runtime.js",
  "factoryExportName": "createScenarioChunkRuntimeController",
  "factorySourceFingerprint": "50cb734238ae90342da6f9115e1f8c2708e1e4abb8701916b5c60270d885e079",
  "borrowedLocalStorage": [
    {
      "functionName": "refreshActiveScenarioChunks",
      "bindingName": "pendingPromotion",
      "paths": [
        [
          "mergedLayerPayloads"
        ],
        [
          "primaryMergedLayerPayloads"
        ],
        [
          "primaryLayerStats"
        ]
      ]
    }
  ],
  "borrowedResultPathsByMethod": {
    "preloadScenarioCoarseChunks": [
      []
    ]
  },
  "borrowedPublicExports": [
    {
      "modulePath": "js/core/scenario_resources.js",
      "exportName": "preloadScenarioCoarseChunks",
      "paths": [
        []
      ]
    }
  ]
};
const riverBorrowedRuntimeDefinition = {
  "factoryModulePath": "js/core/river_paint/runtime.js",
  "factoryExportName": "createRiverPaintRuntime",
  "getterExportName": "getRiverPaintRuntime",
  "factorySourceFingerprint": "d72dac9e287df4b37604a7212892601ccb0ef637147051ac229cad33b5e28f60",
  "sourceFingerprints": {
    "js/core/river_paint/runtime.js": "5a7a14eb9ce15a5b24f207bba52898638c36c46faf91cc2316ef1007bace56a2",
    "js/core/river_paint/partition_model.js": "3ec6a9e6c13ed80c73fa9baaa324e75b1df678f7cd0ed34191f9ebb1f40fc8f1",
    "js/core/river_paint/geometry_identity.js": "2e4562a87beecfb75273458038fb1d9cc9d092592551fbf2fef4e83af573ff78",
    "js/core/river_paint/pilot_manifest.js": "e63d24879c44b189d94914f108fdfe5f5f22d52709701b4f753dbe9611711cd9",
    "js/core/state/actions/river_paint_actions.js": "7b14e409523f8f5617ccb25af777c2e7de846b63f2364c0651145753e787144b"
  },
  "borrowedLocalStorage": [
    {
      "functionName": "createRiverPaintRuntime",
      "bindingName": "cellFeatures",
      "paths": [
        []
      ]
    },
    {
      "functionName": "createRiverPaintRuntime",
      "bindingName": "pinnedCache",
      "paths": [
        []
      ]
    },
    {
      "functionName": "createRiverPaintRuntime",
      "bindingName": "surfaceCache",
      "paths": [
        []
      ]
    }
  ],
  "borrowedResultPathsByMethod": {
    "getActivePack": [
      []
    ],
    "getCellFeature": [
      []
    ],
    "getParentFeature": [
      []
    ],
    "pinCollection": [
      []
    ],
    "surfaces": [
      []
    ],
    "refineHit": [
      []
    ]
  },
  "methodArgumentCounts": {
    "getActivePack": [
      0
    ],
    "getCellFeature": [
      1
    ],
    "getParentFeature": [
      1
    ],
    "pinCollection": [
      1
    ],
    "surfaces": [
      0,
      1
    ],
    "refineHit": [
      2
    ],
    "diagnostics": [
      0
    ],
    "expandDirtyIds": [
      1
    ],
    "assertReadyForExport": [
      0
    ],
    "enable": [
      1
    ],
    "setMode": [
      1
    ],
    "cancel": [
      0
    ]
  },
  "borrowedPublicExports": []
};
const freezeBorrowedPaths = paths => Object.freeze(paths.map(path => Object.freeze([...path])));
export const STATE_BORROWED_RUNTIME_CONTRACT = Object.freeze([borrowedRuntimeDefinition, riverBorrowedRuntimeDefinition].map(borrowedRuntimeDefinition => Object.freeze({
  ...borrowedRuntimeDefinition,
  ...(borrowedRuntimeDefinition.sourceFingerprints ? {
    sourceFingerprints: Object.freeze(borrowedRuntimeDefinition.sourceFingerprints),
    methodArgumentCounts: Object.freeze(Object.fromEntries(Object.entries(borrowedRuntimeDefinition.methodArgumentCounts)
      .map(([method, counts]) => [method, Object.freeze(counts)]))),
  } : {}),
  borrowedLocalStorage: Object.freeze(borrowedRuntimeDefinition.borrowedLocalStorage.map(storage => Object.freeze({
    ...storage, paths: freezeBorrowedPaths(storage.paths),
  }))),
  borrowedResultPathsByMethod: Object.freeze(Object.fromEntries(Object.entries(borrowedRuntimeDefinition.borrowedResultPathsByMethod)
    .map(([method, paths]) => [method, freezeBorrowedPaths(paths)]))),
  borrowedPublicExports: Object.freeze(borrowedRuntimeDefinition.borrowedPublicExports.map(entry => Object.freeze({
    ...entry, paths: freezeBorrowedPaths(entry.paths),
  }))),
})));

export function inspectStateBorrowedRuntimeSources(entry, {
  readSource = modulePath => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8"),
} = {}) {
  const expected = STATE_BORROWED_RUNTIME_CONTRACT.find(candidate => candidate.factoryModulePath === entry?.factoryModulePath
    && candidate.factoryExportName === entry?.factoryExportName);
  if (!expected || JSON.stringify(entry) !== JSON.stringify(expected)) {
    return { violations: [{ code: "borrowed-runtime-unknown-contract" }] };
  }
  if (expected.getterExportName === "getRiverPaintRuntime") {
    const violations = [];
    try {
      for (const [modulePath, expectedFingerprint] of Object.entries(expected.sourceFingerprints)) {
        if (fingerprint(readSource(modulePath)) !== expectedFingerprint) violations.push({ code: "borrowed-runtime-source-mismatch", modulePath });
      }
      const source = readSource(expected.factoryModulePath).replace(/\r\n?/g, "\n");
      const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
      const declarations = ast.body.map(node => node.declaration || node);
      const factory = declarations.find(node => node.id?.name === expected.factoryExportName);
      const getter = declarations.find(node => node.id?.name === expected.getterExportName);
      const cache = declarations.find(node => node.type === "VariableDeclaration" && node.kind === "const"
        && node.declarations.length === 1 && node.declarations[0].id.name === "runtimes");
      if (!factory || fingerprint(source.slice(factory.start, factory.end).trim()) !== expected.factorySourceFingerprint
        || factory.params[0]?.name !== "state" || factory.params.length !== 2
        || !cache || cache.declarations[0].init?.type !== "NewExpression"
        || cache.declarations[0].init.callee.name !== "WeakMap" || cache.declarations[0].init.arguments.length
        || !getter || getter.params.length !== 1 || getter.params[0].name !== "state"
        || source.slice(getter.body.start, getter.body.end).replace(/\s+/g, " ") !== "{ if (!runtimes.has(state)) runtimes.set(state, createRiverPaintRuntime(state)); return runtimes.get(state); }") {
        violations.push({ code: "borrowed-runtime-factory-getter-shape-mismatch" });
      }
    } catch (error) { violations.push({ code: "borrowed-runtime-source-unavailable", message: error.message }); }
    return { violations };
  }
  // Reuse the complete chunk/assembly source receipt and production-consumer
  // discovery; export names alone never authorize a public borrowed result.
  const injection = findStateBorrowedCallbackInjectionEntry(expected.factoryModulePath, expected.factoryExportName, "normalizeScenarioId");
  if (!injection) return { violations: [{ code: "borrowed-runtime-injection-proof-missing" }] };
  const violations = [...inspectStateBorrowedCallbackInjectionSources(injection, { readSource }).violations];
  try {
    const source = readSource(expected.factoryModulePath).replace(/\r\n?/g, "\n");
    const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
    const factory = ast.body.find(node => node.type === "FunctionDeclaration" && node.id?.name === expected.factoryExportName);
    if (!factory || fingerprint(source.slice(factory.start, factory.end).trim()) !== expected.factorySourceFingerprint) {
      violations.push({ code: "borrowed-runtime-factory-source-mismatch", modulePath: expected.factoryModulePath });
    }
  } catch (error) {
    violations.push({ code: "borrowed-runtime-source-unavailable", message: error.message });
  }
  return { violations };
}

// Audited effect origin, not a pure reader or private-cache exemption.
const borrowedOwnerEffectDefinition = {
  "factoryModulePath": "js/core/renderer/political_path_cache_owner.js",
  "factoryExportName": "createPoliticalPathCacheOwner",
  "factorySourceFingerprint": "0b829bb0c135344374312216fb8d8d92036189c1009579819f0146ba0c831746",
  "localResultOrigin": "injected-shared-cache",
  "localMethodNames": [
    "getPoliticalPathCacheHandle",
    "getPoliticalFeaturePathEntry"
  ],
  "effects": [
    "Shared renderPassCache normalization and publication through ensureRenderPassCacheState and cache actions",
    "Shared politicalPathCache Map get/set/clear and holder, signature, transform and reason replacement",
    "Shared warmup queue and handle replacement, queue iteration and deferred scheduling/cancellation",
    "Shared performance counter increments and metric callback writes",
    "Shared geoPath context temporarily changed for Path2D streaming and restored in finally",
    "Cached entries preserve feature.geometry identity; public cache/map/geometryRef results remain borrowed"
  ],
  "requiredOwnerCompositions": [
    {
      "modulePath": "js/core/map_renderer.js",
      "exportName": "composePoliticalPathCacheOwner"
    },
    {
      "modulePath": "js/core/map_renderer.js",
      "exportName": "getRenderCacheOwner"
    },
    {
      "modulePath": "js/core/renderer/render_cache_owner.js",
      "exportName": "composeRenderCacheValidationScope"
    },
    {
      "modulePath": "js/core/map_renderer.js",
      "exportName": "getRendererProjectionPathOwner"
    },
    {
      "modulePath": "js/core/map_renderer.js",
      "exportName": "getRenderPerfMetricsRuntimeOwner"
    }
  ],
  "sourceFingerprints": {
    "js/core/renderer/political_path_cache_owner.js": "1da5d4f86a65793f272f1f9170cb7729a24257573e880eadc9b51b71b3d13a4a",
    "js/core/map_renderer.js": "b2e4c91cb69ea76ac1a9262c230005e3d16b0c3335fafc5d57a7d574a18877ec",
    "js/core/renderer/render_cache_owner.js": "e00eb062b37f04f49acdf30334be402a309eb483f158634cdb41298ccd20348d",
    "js/core/renderer/render_cache_validation_scope.js": "d6f09790a3fa9be6fcd6172521c9658aeff01db9ce7e964b439b84bf7cd7febf",
    "js/core/state/renderer_runtime_state.js": "86c16c937cd2d3a28ef05dc3c42b47630f70b32355caab99394e6a835783abb8",
    "js/core/renderer/render_pass_cache_state_normalizer.js": "03f4cad1217469c4a5d980ebb0e54793f2bd0f86fa4e557f0b68f11d8af9d70c",
    "js/core/state/actions/renderer_cache_actions.js": "4ffe985761e14cba6978de1f529007317063d1ecc9776108b67a5d3cf8a1c739",
    "js/core/renderer/projection_geometry_identity.js": "25aca815b841ab7238697cb512f2221bb1042bd50170a9804cee3e511669cf8e",
    "js/core/renderer/renderer_surface_host.js": "58361f391628007208099fba71707254a680e46310274e91bf8f22a876df3e83",
    "js/core/renderer/renderer_projection_path_owner.js": "489a62baf4bed0936dcd716b8ed2b9f87cc3fbec34ba0284d2adc1907dfae2bb",
    "js/core/renderer/render_perf_metrics_runtime_owner.js": "41543b243e6c8b1619c1f9c3e09b3deea0c88245318a5d78ac19754d2a9fa73d",
    "js/core/state/actions/renderer_diagnostics_actions.js": "4c87c50b0e93c79d07d8ac6b218246427424ccbe4fb18440f880022c4b030515",
    "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
    "js/core/feature_identity_shared.js": "87740ee4f95f77350073884c812865264b9e5eae2e0bfeec88d066648c2bcf0a",
    "js/core/country_code_aliases.js": "5c65ff97e89d7cfaf3c8b575c975ef25caf50d5a9a00aea34b3bd812ac661726",
    "vendor/d3.v7.min.js": "f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539"
  }
};
export const STATE_BORROWED_OWNER_EFFECT_CONTRACT = Object.freeze([Object.freeze({
  ...borrowedOwnerEffectDefinition,
  localMethodNames: Object.freeze(borrowedOwnerEffectDefinition.localMethodNames),
  effects: Object.freeze(borrowedOwnerEffectDefinition.effects),
  requiredOwnerCompositions: Object.freeze(borrowedOwnerEffectDefinition.requiredOwnerCompositions.map(entry => Object.freeze(entry))),
  sourceFingerprints: Object.freeze(borrowedOwnerEffectDefinition.sourceFingerprints),
})]);
export function inspectStateBorrowedOwnerEffectSources(entry, {
  readSource = modulePath => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8"),
} = {}) {
  const expected = STATE_BORROWED_OWNER_EFFECT_CONTRACT.find(candidate => candidate.factoryModulePath === entry?.factoryModulePath
    && candidate.factoryExportName === entry?.factoryExportName);
  if (!expected || JSON.stringify(expected) !== JSON.stringify(entry)) return { violations: [{ code: "borrowed-owner-effect-unknown-contract" }] };
  const violations = [];
  try {
    for (const [modulePath, expectedFingerprint] of Object.entries(expected.sourceFingerprints)) {
      if (fingerprint(readSource(modulePath)) !== expectedFingerprint) violations.push({ code: "borrowed-owner-effect-source-mismatch", modulePath });
    }
    const source = readSource(expected.factoryModulePath).replace(/\r\n?/g, "\n");
    const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
    const factory = ast.body.map(node => node.declaration || node).find(node => node.type === "FunctionDeclaration" && node.id?.name === expected.factoryExportName);
    if (!factory || fingerprint(source.slice(factory.start, factory.end).trim()) !== expected.factorySourceFingerprint) {
      violations.push({ code: "borrowed-owner-effect-factory-mismatch" });
    }
    for (const composition of expected.requiredOwnerCompositions) {
      const owner = STATE_MUTATION_DELEGATING_OWNER_CONTRACT.find(candidate => candidate.compositionModulePath === composition.modulePath
        && candidate.compositionExportName === composition.exportName);
      if (!owner) { violations.push({ code: "borrowed-owner-effect-owner-proof-missing", ...composition }); continue; }
      violations.push(...inspectStateMutationDelegatingOwnerSources({
        compositionSource: readSource(owner.compositionModulePath), factorySource: readSource(owner.factoryModulePath), entry: owner,
      }).violations);
    }
  } catch (error) {
    violations.push({ code: "borrowed-owner-effect-source-unavailable", message: error.message });
  }
  return { violations };
}

// Exact city expression receipts preserve borrowed values and nested effects.
const borrowedScopedOperationDefinitions = [
  {
    "factoryModulePath": "js/core/renderer/city_lights_render_owner.js",
    "factoryExportName": "createCityLightsRenderOwner",
    "factorySourceFingerprint": "66531d6554dfa4d3c962772283dee3705fb849e5ba6954d9112bc8f258a7a162",
    "sourceFingerprint": "0cd18953a1a501db7c3ce0b39988082235bea5751d300ff1ca044c0c64966a1d",
    "functionName": "drawModernUrbanShapes",
    "operationKind": "finite-literal-array",
    "operationSource": "[minX, minY, maxX, maxY].every(Number.isFinite)",
    "operationSourceFingerprint": "e3ec5767dd39d7e03db9b5c19ea3d40553d9bdf384aca36b68abfe06e85afa22",
    "borrowedResultPaths": []
  },
  {
    "factoryModulePath": "js/core/renderer/city_lights_render_owner.js",
    "factoryExportName": "createCityLightsRenderOwner",
    "factorySourceFingerprint": "66531d6554dfa4d3c962772283dee3705fb849e5ba6954d9112bc8f258a7a162",
    "sourceFingerprint": "0cd18953a1a501db7c3ce0b39988082235bea5751d300ff1ca044c0c64966a1d",
    "functionName": "drawModernUrbanShapes",
    "operationKind": "borrowed-slice",
    "operationSource": "anchors.slice(0, 3)",
    "operationSourceFingerprint": "ca27aa61a2912973d174c575d7460a8ccae3629d405ef88b0d001b37c34bce0d",
    "borrowedResultPaths": [
      []
    ]
  },

];
export const STATE_BORROWED_SCOPED_OPERATION_CONTRACT = Object.freeze(borrowedScopedOperationDefinitions.map(entry => Object.freeze({
  ...entry,
  borrowedResultPaths: freezeBorrowedPaths(entry.borrowedResultPaths),
  ...(entry.resultCalls ? { resultCalls: Object.freeze(entry.resultCalls.map(call => Object.freeze({ ...call, borrowedArgumentIndexes: Object.freeze(call.borrowedArgumentIndexes) }))) } : {}),
})));
export function inspectStateBorrowedScopedOperationSources(entry, {
  readSource = modulePath => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8"),
} = {}) {
  const expected = STATE_BORROWED_SCOPED_OPERATION_CONTRACT.find(candidate => candidate.factoryModulePath === entry?.factoryModulePath
    && candidate.functionName === entry?.functionName && candidate.operationKind === entry?.operationKind);
  if (!expected || JSON.stringify(expected) !== JSON.stringify(entry)) return { violations: [{ code: "borrowed-scoped-operation-unknown-contract" }] };
  const violations = [];
  try {
    const source = readSource(expected.factoryModulePath).replace(/\r\n?/g, "\n");
    if (fingerprint(source) !== expected.sourceFingerprint) violations.push({ code: "borrowed-scoped-operation-source-mismatch" });
    const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
    const factory = ast.body.map(node => node.declaration || node).find(node => node.type === "FunctionDeclaration" && node.id?.name === expected.factoryExportName);
    if (!factory || fingerprint(source.slice(factory.start, factory.end).trim()) !== expected.factorySourceFingerprint) violations.push({ code: "borrowed-scoped-operation-factory-mismatch" });
    let matches = 0;
    // The complete factory hash binds lexical scope, variable identity and all
    // uses of the private membership set; the expression hash is the call-site key.
    full(ast, node => {
      if (node.type === "FunctionDeclaration" && node.id?.name === expected.functionName) {
        full(node.body, expression => {
          if ((expression.type === "CallExpression" || expression.type === "NewExpression")
            && fingerprint(source.slice(expression.start, expression.end)) === expected.operationSourceFingerprint) matches += 1;
        });
      }
    });
    if (matches !== 1 || fingerprint(expected.operationSource) !== expected.operationSourceFingerprint) violations.push({ code: "borrowed-scoped-operation-expression-mismatch" });
  } catch (error) {
    violations.push({ code: "borrowed-scoped-operation-source-unavailable", message: error.message });
  }
  return { violations };
}

// Complete live evidence only: no finding is removed and no pure-reader claim is made.
const riverOwnerSourceFingerprints = Object.freeze({
  "js/core/river_paint/editor_owner.js": "e40ba9ec9a296c24a506f8f672a50eea40a48360ea61d8d9855092420b1f3b02",
  "js/core/map_data_boundary.js": "326ba03c0a42d58950019c857fe8b70eedd6decab59ac480b1da7cbef3f21147",
  "js/core/river_paint/partition_model.js": "3ec6a9e6c13ed80c73fa9baaa324e75b1df678f7cd0ed34191f9ebb1f40fc8f1",
  "js/core/river_paint/geometry_identity.js": "2e4562a87beecfb75273458038fb1d9cc9d092592551fbf2fef4e83af573ff78",
  "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
  "js/core/feature_identity_shared.js": "87740ee4f95f77350073884c812865264b9e5eae2e0bfeec88d066648c2bcf0a",
  "js/core/country_code_aliases.js": "5c65ff97e89d7cfaf3c8b575c975ef25caf50d5a9a00aea34b3bd812ac661726",
  "js/core/state/actions/river_paint_actions.js": "7b14e409523f8f5617ccb25af777c2e7de846b63f2364c0651145753e787144b",
  "js/core/river_paint/runtime.js": "5a7a14eb9ce15a5b24f207bba52898638c36c46faf91cc2316ef1007bace56a2",
  "js/core/river_paint/pilot_manifest.js": "e63d24879c44b189d94914f108fdfe5f5f22d52709701b4f753dbe9611711cd9",
  "js/core/river_paint/render_owner.js": "0f0741d8f2000ba1a73c89bbb6d8700bb0bc9dda3499f038efb773711582079c"
});
export const STATE_RIVER_OWNER_SOURCE_RECEIPTS = Object.freeze([
  {
    "modulePath": "js/core/river_paint/editor_owner.js",
    "functionName": "createRiverPaintEditorOwner",
    "parameterName": "state",
    "parameterIndex": 0,
    "parameterPath": "$/property:state",
    "findingsFingerprint": "9523b3d3e157d6174806b20ce87dbe1ac143ca95f4cbc28450f4b8bba72375df",
    "actionDelegationsFingerprint": "402aa89a6d87c455794c79adfc69f9792e6c3a1a45a66cdc4737e734f908aa2a",
    "findingCount": 5,
    "actionDelegationCount": 1
  },
  {
    "modulePath": "js/core/river_paint/render_owner.js",
    "functionName": "createRiverPaintRenderOwner",
    "parameterName": "state",
    "parameterIndex": 0,
    "parameterPath": "$/property:state",
    // The indexed borrowed parent lookup adds two conservative findings;
    // retain them alongside all seven pre-existing findings.
    "findingsFingerprint": "d97d97bd4afcc8b08486374c2a55233f8104ce12dca3556db1bdb28dca9534dc",
    "actionDelegationsFingerprint": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "findingCount": 9,
    "actionDelegationCount": 0
  },
  {
    "modulePath": "js/core/river_paint/runtime.js",
    "functionName": "createRiverPaintRuntime",
    "parameterName": "state",
    "parameterIndex": 0,
    "parameterPath": "$",
    "findingsFingerprint": "2ff97c6077431ed6ce7b033fd680ad0c81836a82a383b97a267a2137a1aec48e",
    "actionDelegationsFingerprint": "24a693d5505854ff9ae9adea4bec39e527db0893130de6cfbfb6245f8be0abb8",
    "findingCount": 29,
    "actionDelegationCount": 3
  },
  {
    "modulePath": "js/core/river_paint/runtime.js",
    "functionName": "getRiverPaintRuntime",
    "parameterName": "state",
    "parameterIndex": 0,
    "parameterPath": "$",
    "findingsFingerprint": "023d30270d0ea1283000616b1c45ce52876c20340ca2622167dc74756d7ca039",
    "actionDelegationsFingerprint": "ab107ffbc257a97496db700fdda043c02ee7cdfa0ffaa50b4817812448068d51",
    "findingCount": 32,
    "actionDelegationCount": 3
  }
].map(Object.freeze));

export function inspectRiverOwnerSourceEvidence(modulePath, {
  inventories,
  readSource = modulePath => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8"),
} = {}) {
  const entries = typeof modulePath === "string" && STATE_RIVER_OWNER_SOURCE_RECEIPTS.filter(entry => entry.modulePath === modulePath);
  if (!entries?.length) return { violations: [{ code: "river-owner-receipt-unknown" }] };
  const violations = [];
  try {
    for (const [dependencyPath, expected] of Object.entries(riverOwnerSourceFingerprints)) {
      if (fingerprint(readSource(dependencyPath)) !== expected) violations.push({ code: "river-owner-source-drift", modulePath: dependencyPath });
    }
    if (!Array.isArray(inventories) || inventories.length !== entries.length) {
      violations.push({ code: "river-owner-binding-count-drift" });
    }
    for (const entry of entries) {
      const matches = (inventories || []).filter(inventory => inventory.binding?.functionName === entry.functionName);
      const inventory = matches[0];
      const binding = inventory?.binding;
      if (matches.length !== 1 || binding?.kind !== "function-parameter"
        || binding.parameterName !== entry.parameterName || binding.parameterIndex !== entry.parameterIndex
        || binding.parameterPath !== entry.parameterPath
        || fingerprint(JSON.stringify(inventory?.findings)) !== entry.findingsFingerprint
        || fingerprint(JSON.stringify(inventory?.actionDelegations)) !== entry.actionDelegationsFingerprint) {
        violations.push({ code: "river-owner-inventory-drift", functionName: entry.functionName });
      }
    }
  } catch (error) { violations.push({ code: "river-owner-source-unavailable", message: error.message }); }
  return { violations };
}
