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
    "dependencyFingerprints": {},
    "sourceFingerprint": "c5b5529dc4acbac1edc503245eeca78a42b8a104d75b45b30deb65c1fd543055",
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
      "js/core/feature_identity_shared.js": "8f87083cb48bd69c7c0c31c5ae9227e9bde7aeec2435481f09a688dd490ededf",
      "js/core/country_code_aliases.js": "b6320aff3f15a9bdec71b5fc4ea9549dd87aff50fec898f2a73aa3258b1daed5"
    },
    "sourceFingerprint": "43f549d75838c3c72852ae27e8611e0093f44f6de7dabb1ec53237143788bf63",
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

export function inspectStateBorrowedEffectSource(source, entry) {
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
      const dependencySource = readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8");
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
      "js/core/scenario/chunk_runtime.js": "107cc8b6cef2b021a63b73e99d2215d46154ff81225d5ae335ad44ca9f236652",
      "js/core/scenario_resources.js": "6ed9dc4c944976a5bfb235970de741bb2d41893731efd6514f9f07ceba964ff9",
      "js/core/scenario_chunk_manager.js": "ad27aaf75a1c34066de6eb0389a5039f1ee06338efce4886f811520c3a15fee6",
      "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
      "js/core/feature_identity_shared.js": "8f87083cb48bd69c7c0c31c5ae9227e9bde7aeec2435481f09a688dd490ededf",
      "js/core/country_code_aliases.js": "b6320aff3f15a9bdec71b5fc4ea9549dd87aff50fec898f2a73aa3258b1daed5"
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
      "js/core/scenario/chunk_runtime.js": "107cc8b6cef2b021a63b73e99d2215d46154ff81225d5ae335ad44ca9f236652",
      "js/core/scenario_resources.js": "6ed9dc4c944976a5bfb235970de741bb2d41893731efd6514f9f07ceba964ff9",
      "js/core/scenario_chunk_manager.js": "ad27aaf75a1c34066de6eb0389a5039f1ee06338efce4886f811520c3a15fee6",
      "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
      "js/core/feature_identity_shared.js": "8f87083cb48bd69c7c0c31c5ae9227e9bde7aeec2435481f09a688dd490ededf",
      "js/core/country_code_aliases.js": "b6320aff3f15a9bdec71b5fc4ea9549dd87aff50fec898f2a73aa3258b1daed5"
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
      "js/core/map_renderer/scenario_refresh_runtime.js": "61c8e1b75e215895e9804b837f8ffba4aee4e9479aeac018080552976b888e18",
      "js/core/map_renderer.js": "86a0a7043270dd488091c4c49d8e4da375cf34d3465f81588f0b52b5339900e1",
      "js/core/renderer/political_collection_owner.js": "3cc51f68606887b37f55f6f60d169957122f4d4e27dd595f4d58dfe363420dd7",
      "js/core/renderer/political_feature_policy.js": "294229eee3dcc24bf87942d17bd9f56889dce18cf6d99a18c1503a5d0d8d0da8",
      "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
      "js/core/feature_identity_shared.js": "8f87083cb48bd69c7c0c31c5ae9227e9bde7aeec2435481f09a688dd490ededf",
      "js/core/country_code_aliases.js": "b6320aff3f15a9bdec71b5fc4ea9549dd87aff50fec898f2a73aa3258b1daed5",
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
      "js/core/map_renderer/scenario_refresh_runtime.js": "61c8e1b75e215895e9804b837f8ffba4aee4e9479aeac018080552976b888e18",
      "js/core/map_renderer.js": "86a0a7043270dd488091c4c49d8e4da375cf34d3465f81588f0b52b5339900e1",
      "js/core/renderer/political_collection_owner.js": "3cc51f68606887b37f55f6f60d169957122f4d4e27dd595f4d58dfe363420dd7",
      "js/core/renderer/political_feature_policy.js": "294229eee3dcc24bf87942d17bd9f56889dce18cf6d99a18c1503a5d0d8d0da8",
      "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
      "js/core/feature_identity_shared.js": "8f87083cb48bd69c7c0c31c5ae9227e9bde7aeec2435481f09a688dd490ededf",
      "js/core/country_code_aliases.js": "b6320aff3f15a9bdec71b5fc4ea9549dd87aff50fec898f2a73aa3258b1daed5",
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
      "js/core/scenario/chunk_runtime.js": "107cc8b6cef2b021a63b73e99d2215d46154ff81225d5ae335ad44ca9f236652",
      "js/core/scenario_resources.js": "6ed9dc4c944976a5bfb235970de741bb2d41893731efd6514f9f07ceba964ff9",
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
      "js/core/renderer/city_lights_render_owner.js": "b8f30b649646cd3d075a766ccb086c1a8e769cd539b9795d6aa3d06c65e8ed6b",
      "js/core/map_renderer.js": "86a0a7043270dd488091c4c49d8e4da375cf34d3465f81588f0b52b5339900e1",
      "js/core/renderer/projected_geometry_bounds_owner.js": "607af297c0d2c78171bebfaad7376f3f40a6fa1b05d43656de00b50a9608cf0d",
      "js/core/state/renderer_runtime_state.js": "86c16c937cd2d3a28ef05dc3c42b47630f70b32355caab99394e6a835783abb8",
      "js/core/state/actions/renderer_cache_actions.js": "4ffe985761e14cba6978de1f529007317063d1ecc9776108b67a5d3cf8a1c739",
      "js/core/renderer/projected_bounds_diagnostics_owner.js": "a121edc8b9f0ddb7418614e72a8a8498b412483da0fa47977e396f5c74b55b22",
      "js/core/state/actions/renderer_diagnostics_actions.js": "4c87c50b0e93c79d07d8ac6b218246427424ccbe4fb18440f880022c4b030515",
      "js/core/renderer/scenario_region_overlay_render_owner.js": "2da38f196da48a0fc5bcfaa21068a56cee212218e416443152be34689a68f2bd",
      "js/core/renderer/render_perf_metrics_runtime_owner.js": "41543b243e6c8b1619c1f9c3e09b3deea0c88245318a5d78ac19754d2a9fa73d",
      "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
      "js/core/feature_identity_shared.js": "8f87083cb48bd69c7c0c31c5ae9227e9bde7aeec2435481f09a688dd490ededf",
      "js/core/country_code_aliases.js": "b6320aff3f15a9bdec71b5fc4ea9549dd87aff50fec898f2a73aa3258b1daed5",
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
      "js/core/renderer/city_lights_render_owner.js": "b8f30b649646cd3d075a766ccb086c1a8e769cd539b9795d6aa3d06c65e8ed6b",
      "js/core/map_renderer.js": "86a0a7043270dd488091c4c49d8e4da375cf34d3465f81588f0b52b5339900e1",
      "js/core/renderer/projected_geometry_bounds_owner.js": "607af297c0d2c78171bebfaad7376f3f40a6fa1b05d43656de00b50a9608cf0d",
      "js/core/state/renderer_runtime_state.js": "86c16c937cd2d3a28ef05dc3c42b47630f70b32355caab99394e6a835783abb8",
      "js/core/state/actions/renderer_cache_actions.js": "4ffe985761e14cba6978de1f529007317063d1ecc9776108b67a5d3cf8a1c739",
      "js/core/renderer/projected_bounds_diagnostics_owner.js": "a121edc8b9f0ddb7418614e72a8a8498b412483da0fa47977e396f5c74b55b22",
      "js/core/state/actions/renderer_diagnostics_actions.js": "4c87c50b0e93c79d07d8ac6b218246427424ccbe4fb18440f880022c4b030515",
      "js/core/renderer/scenario_region_overlay_render_owner.js": "2da38f196da48a0fc5bcfaa21068a56cee212218e416443152be34689a68f2bd",
      "js/core/renderer/render_perf_metrics_runtime_owner.js": "41543b243e6c8b1619c1f9c3e09b3deea0c88245318a5d78ac19754d2a9fa73d",
      "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
      "js/core/feature_identity_shared.js": "8f87083cb48bd69c7c0c31c5ae9227e9bde7aeec2435481f09a688dd490ededf",
      "js/core/country_code_aliases.js": "b6320aff3f15a9bdec71b5fc4ea9549dd87aff50fec898f2a73aa3258b1daed5",
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
      "js/core/renderer/city_lights_render_owner.js": "b8f30b649646cd3d075a766ccb086c1a8e769cd539b9795d6aa3d06c65e8ed6b",
      "js/core/map_renderer.js": "86a0a7043270dd488091c4c49d8e4da375cf34d3465f81588f0b52b5339900e1",
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
      "js/core/renderer/city_lights_render_owner.js": "b8f30b649646cd3d075a766ccb086c1a8e769cd539b9795d6aa3d06c65e8ed6b",
      "js/core/map_renderer.js": "86a0a7043270dd488091c4c49d8e4da375cf34d3465f81588f0b52b5339900e1",
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
      "js/core/renderer/city_lights_render_owner.js": "b8f30b649646cd3d075a766ccb086c1a8e769cd539b9795d6aa3d06c65e8ed6b",
      "js/core/map_renderer.js": "86a0a7043270dd488091c4c49d8e4da375cf34d3465f81588f0b52b5339900e1",
      "js/core/state.js": "d5db7104a473a577bff27bdee57125982dc7b66f6bc14e76d0f87e3bb336aaef",
      "js/core/intensity_field.js": "677c5dc76d783b306f4d37b678af57a5fc3902de1a1928fe5faaacbf8f685e20",
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
      "js/core/renderer/city_lights_render_owner.js": "b8f30b649646cd3d075a766ccb086c1a8e769cd539b9795d6aa3d06c65e8ed6b",
      "js/core/map_renderer.js": "86a0a7043270dd488091c4c49d8e4da375cf34d3465f81588f0b52b5339900e1",
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
      "js/core/renderer/city_lights_render_owner.js": "b8f30b649646cd3d075a766ccb086c1a8e769cd539b9795d6aa3d06c65e8ed6b",
      "js/core/map_renderer.js": "86a0a7043270dd488091c4c49d8e4da375cf34d3465f81588f0b52b5339900e1",
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
      "js/core/scenario/chunk_runtime.js": "107cc8b6cef2b021a63b73e99d2215d46154ff81225d5ae335ad44ca9f236652",
      "js/core/scenario_resources.js": "6ed9dc4c944976a5bfb235970de741bb2d41893731efd6514f9f07ceba964ff9",
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
      "js/core/scenario/chunk_runtime.js": "107cc8b6cef2b021a63b73e99d2215d46154ff81225d5ae335ad44ca9f236652",
      "js/core/scenario_resources.js": "6ed9dc4c944976a5bfb235970de741bb2d41893731efd6514f9f07ceba964ff9",
      "js/core/scenario/pure_helpers.js": "0c48e6f3a5138da08e2550700aa37af574be2fafda8f010e868908f82f218d8d",
      "js/core/scenario_runtime_queries.js": "043727dee7bee46cf753026763c5f5add5fa3139a30b3a4f82e853ad31057eed",
      "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
      "js/core/feature_identity_shared.js": "8f87083cb48bd69c7c0c31c5ae9227e9bde7aeec2435481f09a688dd490ededf",
      "js/core/country_code_aliases.js": "b6320aff3f15a9bdec71b5fc4ea9549dd87aff50fec898f2a73aa3258b1daed5"
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
      "js/core/scenario/chunk_runtime.js": "107cc8b6cef2b021a63b73e99d2215d46154ff81225d5ae335ad44ca9f236652",
      "js/core/scenario_resources.js": "6ed9dc4c944976a5bfb235970de741bb2d41893731efd6514f9f07ceba964ff9",
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
      "js/core/renderer/city_lights_render_owner.js": "b8f30b649646cd3d075a766ccb086c1a8e769cd539b9795d6aa3d06c65e8ed6b",
      "js/core/map_renderer.js": "86a0a7043270dd488091c4c49d8e4da375cf34d3465f81588f0b52b5339900e1"
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
      "js/core/renderer/city_lights_render_owner.js": "b8f30b649646cd3d075a766ccb086c1a8e769cd539b9795d6aa3d06c65e8ed6b",
      "js/core/map_renderer.js": "86a0a7043270dd488091c4c49d8e4da375cf34d3465f81588f0b52b5339900e1"
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
      "js/core/renderer/city_lights_render_owner.js": "b8f30b649646cd3d075a766ccb086c1a8e769cd539b9795d6aa3d06c65e8ed6b",
      "js/core/map_renderer.js": "86a0a7043270dd488091c4c49d8e4da375cf34d3465f81588f0b52b5339900e1",
      "js/core/renderer/projected_geometry_bounds_owner.js": "607af297c0d2c78171bebfaad7376f3f40a6fa1b05d43656de00b50a9608cf0d",
      "js/core/state/renderer_runtime_state.js": "86c16c937cd2d3a28ef05dc3c42b47630f70b32355caab99394e6a835783abb8",
      "js/core/state/actions/renderer_cache_actions.js": "4ffe985761e14cba6978de1f529007317063d1ecc9776108b67a5d3cf8a1c739",
      "js/core/renderer/projected_bounds_diagnostics_owner.js": "a121edc8b9f0ddb7418614e72a8a8498b412483da0fa47977e396f5c74b55b22",
      "js/core/state/actions/renderer_diagnostics_actions.js": "4c87c50b0e93c79d07d8ac6b218246427424ccbe4fb18440f880022c4b030515",
      "js/core/renderer/scenario_region_overlay_render_owner.js": "2da38f196da48a0fc5bcfaa21068a56cee212218e416443152be34689a68f2bd",
      "js/core/renderer/render_perf_metrics_runtime_owner.js": "41543b243e6c8b1619c1f9c3e09b3deea0c88245318a5d78ac19754d2a9fa73d",
      "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
      "js/core/feature_identity_shared.js": "8f87083cb48bd69c7c0c31c5ae9227e9bde7aeec2435481f09a688dd490ededf",
      "js/core/country_code_aliases.js": "b6320aff3f15a9bdec71b5fc4ea9549dd87aff50fec898f2a73aa3258b1daed5",
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
      "js/core/scenario/chunk_runtime.js": "107cc8b6cef2b021a63b73e99d2215d46154ff81225d5ae335ad44ca9f236652",
      "js/core/scenario_resources.js": "6ed9dc4c944976a5bfb235970de741bb2d41893731efd6514f9f07ceba964ff9",
      "js/core/scenario_localization_state.js": "9331101eb9c502039c663b7b44138ad74eea36d8d35b4e6836aea128d48d373a",
      "js/core/state.js": "d5db7104a473a577bff27bdee57125982dc7b66f6bc14e76d0f87e3bb336aaef",
      "js/core/state/actions/scenario_presentation_actions.js": "f9c424cbea229271a28092ef47724af07534e944efed7bd5a95e52f40b52fdc2",
      "js/core/data_loader.js": "512185df4a0d7114e6ffbad441157d33301060f89a435661b2f236d638cf44fb",
      "js/core/feature_identity.js": "ed2ea2ce3f63baaadf33360ecd0d84e722e5ba06042857e5b0b1516383fdca54",
      "js/core/feature_identity_shared.js": "8f87083cb48bd69c7c0c31c5ae9227e9bde7aeec2435481f09a688dd490ededf",
      "js/core/country_code_aliases.js": "b6320aff3f15a9bdec71b5fc4ea9549dd87aff50fec898f2a73aa3258b1daed5",
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
  "factorySourceFingerprint": "5bf9741fa6e4e0a713410519e35354862c187b6f9819a86ca474377a8e03eed2",
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
const freezeBorrowedPaths = paths => Object.freeze(paths.map(path => Object.freeze([...path])));
export const STATE_BORROWED_RUNTIME_CONTRACT = Object.freeze([Object.freeze({
  ...borrowedRuntimeDefinition,
  borrowedLocalStorage: Object.freeze(borrowedRuntimeDefinition.borrowedLocalStorage.map(storage => Object.freeze({
    ...storage, paths: freezeBorrowedPaths(storage.paths),
  }))),
  borrowedResultPathsByMethod: Object.freeze(Object.fromEntries(Object.entries(borrowedRuntimeDefinition.borrowedResultPathsByMethod)
    .map(([method, paths]) => [method, freezeBorrowedPaths(paths)]))),
  borrowedPublicExports: Object.freeze(borrowedRuntimeDefinition.borrowedPublicExports.map(entry => Object.freeze({
    ...entry, paths: freezeBorrowedPaths(entry.paths),
  }))),
})]);

export function inspectStateBorrowedRuntimeSources(entry, {
  readSource = modulePath => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8"),
} = {}) {
  const expected = STATE_BORROWED_RUNTIME_CONTRACT.find(candidate => candidate.factoryModulePath === entry?.factoryModulePath
    && candidate.factoryExportName === entry?.factoryExportName);
  if (!expected || JSON.stringify(entry) !== JSON.stringify(expected)) {
    return { violations: [{ code: "borrowed-runtime-unknown-contract" }] };
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
  "factorySourceFingerprint": "c451d541f0d567309f5f0f71f97c5274f5052cd92c4cf28996446f2e17972891",
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
    "js/core/renderer/political_path_cache_owner.js": "8f9a3102e53feb3bad939fe16f2f799329de96e91653b14ca2554076b5aa91b8",
    "js/core/map_renderer.js": "86a0a7043270dd488091c4c49d8e4da375cf34d3465f81588f0b52b5339900e1",
    "js/core/renderer/render_cache_owner.js": "343fc5602c23568f9658a2655c0246afa722fa45e138fdf9c0fccd875c81c6de",
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
    "js/core/feature_identity_shared.js": "8f87083cb48bd69c7c0c31c5ae9227e9bde7aeec2435481f09a688dd490ededf",
    "js/core/country_code_aliases.js": "b6320aff3f15a9bdec71b5fc4ea9549dd87aff50fec898f2a73aa3258b1daed5",
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
    "factorySourceFingerprint": "fd86667f1243909ec3db5cecb4a4d2abbd0ccc88fa85613d0278eac1c0a4a512",
    "sourceFingerprint": "b8f30b649646cd3d075a766ccb086c1a8e769cd539b9795d6aa3d06c65e8ed6b",
    "functionName": "drawModernUrbanShapes",
    "operationKind": "finite-literal-array",
    "operationSource": "[minX, minY, maxX, maxY].every(Number.isFinite)",
    "operationSourceFingerprint": "e3ec5767dd39d7e03db9b5c19ea3d40553d9bdf384aca36b68abfe06e85afa22",
    "borrowedResultPaths": []
  },
  {
    "factoryModulePath": "js/core/renderer/city_lights_render_owner.js",
    "factoryExportName": "createCityLightsRenderOwner",
    "factorySourceFingerprint": "fd86667f1243909ec3db5cecb4a4d2abbd0ccc88fa85613d0278eac1c0a4a512",
    "sourceFingerprint": "b8f30b649646cd3d075a766ccb086c1a8e769cd539b9795d6aa3d06c65e8ed6b",
    "functionName": "drawModernUrbanShapes",
    "operationKind": "borrowed-slice",
    "operationSource": "anchors.slice(0, 3)",
    "operationSourceFingerprint": "ca27aa61a2912973d174c575d7460a8ccae3629d405ef88b0d001b37c34bce0d",
    "borrowedResultPaths": [
      []
    ]
  },
  {
    "factoryModulePath": "js/core/renderer/city_lights_render_owner.js",
    "factoryExportName": "createCityLightsRenderOwner",
    "factorySourceFingerprint": "fd86667f1243909ec3db5cecb4a4d2abbd0ccc88fa85613d0278eac1c0a4a512",
    "sourceFingerprint": "b8f30b649646cd3d075a766ccb086c1a8e769cd539b9795d6aa3d06c65e8ed6b",
    "functionName": "drawModernCityFallbackLights",
    "operationKind": "borrowed-membership-set",
    "operationSource": "new Set(urbanCoreEntries.flatMap((entry) => entry.feature.properties?.city_ids || []))",
    "operationSourceFingerprint": "0766442e4cf7d06ecb5afc7303e51c63714cf1e7cf448bfffc49f26476146b60",
    "borrowedResultPaths": [
      []
    ],
    "bindingName": "visibleUrbanCityIds",
    "resultCalls": [
      {
        "method": "has",
        "argumentCount": 1,
        "borrowedArgumentIndexes": [
          0
        ],
        "returnsBorrowedState": false
      }
    ]
  }
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
