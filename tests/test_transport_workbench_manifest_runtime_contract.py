from pathlib import Path
import json
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
VARIANT_HELPER_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_manifest_variants.js"
PORT_PREVIEW_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_port_preview.js"
INDUSTRIAL_PREVIEW_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_industrial_zone_preview.js"
INDUSTRIAL_PREVIEW_LOADER_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_industrial_zone_preview_loader.js"
POINT_PREVIEW_SHARED_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_point_preview_shared.js"
POINT_PREVIEW_LOADER_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_point_preview_loader.js"
POINT_PREVIEW_DOM_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_point_preview_dom.js"
POINT_PREVIEW_RUNTIME_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_point_preview_runtime.js"
POINT_DENSITY_HELPERS_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_density_helpers.js"
LINE_RUNTIME_SHARED_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_line_runtime_shared.js"
FAMILY_PREVIEW_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_family_preview.js"
MANIFEST_PREVIEW_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_manifest_preview.js"
FAMILY_REGISTRY_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_family_registry.js"
TRANSPORT_CAPABILITY_REGISTRY_JS = REPO_ROOT / "js" / "core" / "transport_capability_registry.js"
DATA_SERVICE_JS = REPO_ROOT / "js" / "core" / "data_service.js"
STATE_DEFAULTS_JS = REPO_ROOT / "js" / "core" / "state_defaults.js"
UI_STATE_JS = REPO_ROOT / "js" / "core" / "state" / "ui_state.js"
TOOLBAR_JS = REPO_ROOT / "js" / "ui" / "toolbar.js"
TRANSPORT_WORKBENCH_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_controller.js"
TRANSPORT_WORKBENCH_CONFIG_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_config_owner.js"
TRANSPORT_WORKBENCH_APPLY_BRIDGE_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_apply_bridge_owner.js"
TRANSPORT_WORKBENCH_INSPECTOR_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_inspector_owner.js"
TRANSPORT_CARRIER_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_carrier.js"
CARRIER_JSON = REPO_ROOT / "data" / "transport_layers" / "japan_corridor" / "carrier.json"
CARRIER_PROVENANCE_JSON = REPO_ROOT / "data" / "transport_layers" / "japan_corridor" / "provenance.json"
CARRIER_BUILDER_PY = REPO_ROOT / "tools" / "build_transport_workbench_japan_carrier.py"
LOCALES_JSON = REPO_ROOT / "data" / "locales.json"
STARTUP_LOCALE_FILES = [
    REPO_ROOT / "data" / "scenarios" / "hoi4_1936" / "locales.startup.json",
    REPO_ROOT / "data" / "scenarios" / "hoi4_1939" / "locales.startup.json",
    REPO_ROOT / "data" / "scenarios" / "tno_1962" / "locales.startup.json",
]
PACK_RESOLVER_JS = REPO_ROOT / "js" / "core" / "transport_pack_resolver.js"
ROAD_PREVIEW_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_road_preview.js"
RAIL_PREVIEW_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_rail_preview.js"
ROAD_PREVIEW_DOM_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_road_preview_dom.js"
RAIL_PREVIEW_DOM_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_rail_preview_dom.js"


class TransportWorkbenchManifestRuntimeContractTest(unittest.TestCase):
    # 这些测试锁住 transport workbench 的静态合同：registry、owner、state 和 checked-in 数据必须一起改。
    def test_shared_variant_helper_exposes_shared_manifest_contract(self) -> None:
        content = VARIANT_HELPER_JS.read_text(encoding="utf-8")

        self.assertIn("manifest?.variants", content)
        self.assertIn("manifest?.default_variant", content)
        self.assertNotIn("coverage_variants", content)
        self.assertNotIn("distribution_variants", content)
        self.assertNotIn("default_coverage_tier", content)
        self.assertNotIn("default_distribution_variant", content)

    def test_line_preview_shared_runtime_owns_svg_path_and_order_helpers(self) -> None:
        shared_content = LINE_RUNTIME_SHARED_JS.read_text(encoding="utf-8")
        road_content = ROAD_PREVIEW_JS.read_text(encoding="utf-8")
        rail_content = RAIL_PREVIEW_JS.read_text(encoding="utf-8")
        road_dom_content = ROAD_PREVIEW_DOM_JS.read_text(encoding="utf-8")
        rail_dom_content = RAIL_PREVIEW_DOM_JS.read_text(encoding="utf-8")

        for export_name in (
            "createTransportWorkbenchSvgNode",
            "normalizeTransportWorkbenchNumber",
            "createTransportWorkbenchLinePathD",
            "measureTransportWorkbenchProjectedLineLength",
            "buildTransportWorkbenchProjectedLines",
            "findTransportWorkbenchDatasetNode",
            "syncTransportWorkbenchSvgGroupOrder",
        ):
            self.assertIn(f"export function {export_name}", shared_content)
        for preview_content in (road_content, rail_content):
            self.assertIn("transport_workbench_line_runtime_shared.js", preview_content)
            self.assertIn("normalizeTransportWorkbenchNumber as normalizeNumber", preview_content)
            self.assertIn("createTransportWorkbenchLinePathD as createPathD", preview_content)
            self.assertIn("measureTransportWorkbenchProjectedLineLength as measureProjectedLength", preview_content)
            self.assertIn("findTransportWorkbenchDatasetNode as findDatasetNode", preview_content)
            self.assertNotRegex(preview_content, r"(?m)^function normalizeNumber\(")
            self.assertNotRegex(preview_content, r"(?m)^function createPathD\(")
            self.assertNotRegex(preview_content, r"(?m)^function measureProjectedLength\(")
            self.assertNotRegex(preview_content, r"(?m)^function findDatasetNode\(")
        for dom_content in (road_dom_content, rail_dom_content):
            self.assertIn("transport_workbench_line_runtime_shared.js", dom_content)
            self.assertIn("createTransportWorkbenchSvgNode as createSvgNode", dom_content)
            self.assertIn("syncTransportWorkbenchSvgGroupOrder as syncGroupOrder", dom_content)
            self.assertNotRegex(dom_content, r"(?m)^function createSvgNode\(")
            self.assertNotRegex(dom_content, r"(?m)^function syncGroupOrder\(")
        self.assertIn("buildTransportWorkbenchProjectedLines as buildProjectedLines", road_content)

    def test_port_preview_uses_shared_variant_contract_only(self) -> None:
        content = PORT_PREVIEW_JS.read_text(encoding="utf-8")

        self.assertIn('./transport_workbench_manifest_variants.js', content)
        self.assertIn("resolveTransportWorkbenchManifestVariantId", content)
        self.assertIn("getTransportWorkbenchManifestVariantMeta", content)
        self.assertNotIn("coverage_variants", content)
        self.assertNotIn("default_coverage_tier", content)

    def test_industrial_preview_uses_shared_variant_contract_only(self) -> None:
        content = INDUSTRIAL_PREVIEW_JS.read_text(encoding="utf-8")

        self.assertIn('./transport_workbench_manifest_variants.js', content)
        self.assertIn("resolveTransportWorkbenchManifestVariantId", content)
        self.assertIn("getTransportWorkbenchManifestVariantMeta", content)
        self.assertIn("getTransportWorkbenchManifestDefaultVariantId", content)
        self.assertNotIn("distribution_variants", content)
        self.assertNotIn("default_distribution_variant", content)

    def test_toolbar_no_longer_reads_legacy_transport_variant_fields(self) -> None:
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        controller_content = TRANSPORT_WORKBENCH_CONTROLLER_JS.read_text(encoding="utf-8")
        apply_owner_content = TRANSPORT_WORKBENCH_APPLY_BRIDGE_OWNER_JS.read_text(encoding="utf-8")
        inspector_owner_content = TRANSPORT_WORKBENCH_INSPECTOR_OWNER_JS.read_text(encoding="utf-8")

        self.assertIn('./toolbar/transport_workbench_controller.js', toolbar_content)
        self.assertIn('./transport_workbench_inspector_owner.js', controller_content)
        self.assertIn('../transport_workbench_manifest_variants.js', inspector_owner_content)
        self.assertIn("listTransportWorkbenchManifestVariantEntries", inspector_owner_content)
        self.assertIn("getTransportWorkbenchManifestDefaultVariantId", inspector_owner_content)
        self.assertIn("getTransportWorkbenchManifestVariantMeta", inspector_owner_content)
        self.assertNotIn("coverage_variants", controller_content)
        self.assertNotIn("distribution_variants", controller_content)
        self.assertNotIn("default_coverage_tier", controller_content)
        self.assertNotIn("default_distribution_variant", controller_content)
        self.assertNotIn("coverage_variants", inspector_owner_content)
        self.assertNotIn("distribution_variants", inspector_owner_content)
        self.assertNotIn("default_coverage_tier", inspector_owner_content)
        self.assertNotIn("default_distribution_variant", inspector_owner_content)
        self.assertIn("getTransportWorkbenchOverviewBridgeSupport", apply_owner_content)

    def test_transport_capability_registry_owns_family_capability_truth(self) -> None:
        registry_content = TRANSPORT_CAPABILITY_REGISTRY_JS.read_text(encoding="utf-8")
        state_defaults_content = STATE_DEFAULTS_JS.read_text(encoding="utf-8")
        ui_state_content = UI_STATE_JS.read_text(encoding="utf-8")
        family_registry_content = (REPO_ROOT / "js" / "ui" / "transport_workbench_family_registry.js").read_text(encoding="utf-8")
        descriptor_content = (REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_descriptor.js").read_text(encoding="utf-8")

        self.assertIn("TRANSPORT_CAPABILITY_REGISTRY", registry_content)
        self.assertIn("TRANSPORT_CAPABILITY_APPLY_COMPATIBILITY", registry_content)
        self.assertIn("TRANSPORT_CAPABILITY_FAMILY_IDS = Object.freeze(Object.keys(TRANSPORT_CAPABILITY_REGISTRY))", registry_content)
        self.assertIn("listTransportCapabilityFamilyIds", registry_content)
        self.assertIn("listTransportRuntimeCapabilityFamilyIds", registry_content)
        self.assertIn("TRANSPORT_CAPABILITY_FAMILY_IDS.filter((familyId) => TRANSPORT_CAPABILITY_REGISTRY[familyId].runtimeKind", registry_content)
        self.assertIn("TRANSPORT_OVERVIEW_VISUAL_MODES", registry_content)
        self.assertIn("resolveTransportOverviewPatchFromWorkbench", registry_content)
        self.assertIn("getTransportWorkbenchOverviewBridgeSupport", registry_content)
        self.assertIn("resolveTransportOverviewPointStrategy", registry_content)
        self.assertIn("resolveTransportOverviewLineStrategy", registry_content)
        self.assertIn("export const TRANSPORT_WORKBENCH_CONTROL_SCHEMAS", descriptor_content)
        self.assertIn("export const TRANSPORT_WORKBENCH_DEFAULT_CONFIGS", descriptor_content)
        self.assertIn("export const TRANSPORT_WORKBENCH_DENSITY_FAMILY_IDS", descriptor_content)
        self.assertIn('baseCapability: "polygon_or_point"', registry_content)
        self.assertIn('runtimeKind: "mixed"', registry_content)
        self.assertIn('geometryKind: "polygon_or_point"', registry_content)
        self.assertIn('adapterId: "active_industrial_zones_manifest"', descriptor_content)
        self.assertIn('geometryKind: "polygon_or_point"', descriptor_content)
        self.assertIn("Polygon packs and OSM center-point packs keep their own geometry contract", descriptor_content)
        self.assertNotIn('adapterId: "japan_industrial_zones_v2"', descriptor_content)
        self.assertIn("deepFreeze({", descriptor_content)
        self.assertIn("TRANSPORT_WORKBENCH_DENSITY_FAMILY_ID_SET", descriptor_content)
        self.assertIn("export function buildEnergyFacilitySubtypeControlOptions", descriptor_content)
        self.assertIn("options: ({ previewSnapshot }) => buildEnergyFacilitySubtypeControlOptions(previewSnapshot)", descriptor_content)
        self.assertIn("TRANSPORT_OVERVIEW_CAPABILITY_FAMILY_IDS", state_defaults_content)
        self.assertIn("TRANSPORT_OVERVIEW_FAMILY_IDS = TRANSPORT_OVERVIEW_CAPABILITY_FAMILY_IDS", state_defaults_content)
        self.assertIn("../core/transport_capability_registry.js", family_registry_content)
        self.assertIn("../../core/transport_capability_registry.js", descriptor_content)
        self.assertIn("getTransportCapabilityFamilyMetadata", family_registry_content)
        self.assertIn("getTransportCapabilityFamilyMetadata", descriptor_content)
        self.assertIn("return listTransportRuntimeCapabilityFamilyIds();", family_registry_content)
        self.assertIn("listTransportCapabilityFamilyIds().map(createTransportWorkbenchFamilyDescriptor)", descriptor_content)
        self.assertIn('listTransportRuntimeCapabilityFamilyIds', ui_state_content)
        self.assertIn('layerOrder: [...TRANSPORT_WORKBENCH_RUNTIME_FAMILY_IDS],', ui_state_content)
        self.assertNotIn('["road", "rail", "airport", "port"]', family_registry_content)
        self.assertNotIn('["road", "rail", "airport", "port"]', descriptor_content)

    def test_label_separation_contract_stays_in_the_same_range_across_state_and_preview(self) -> None:
        state_defaults_content = STATE_DEFAULTS_JS.read_text(encoding="utf-8")
        config_owner_content = TRANSPORT_WORKBENCH_CONFIG_OWNER_JS.read_text(encoding="utf-8")
        density_helper_content = POINT_DENSITY_HELPERS_JS.read_text(encoding="utf-8")

        self.assertIn("separationStrength: 1,", state_defaults_content)
        self.assertIn("toFiniteNumber(rawLabels.separationStrength, defaults.labels.separationStrength)", state_defaults_content)
        self.assertIn("0.7,", state_defaults_content)
        self.assertIn("1.8", state_defaults_content)
        self.assertIn("Math.max(0.7, Math.min(1.8, Number(source.labelSeparation)", config_owner_content)
        self.assertIn("return clamp(normalizeNumber(config?.labelSeparation, 1), 0.7, 1.8);", density_helper_content)

    def test_preview_pack_loaders_reject_missing_pack_paths_before_fetch(self) -> None:
        point_content = POINT_PREVIEW_LOADER_JS.read_text(encoding="utf-8")
        industrial_content = INDUSTRIAL_PREVIEW_LOADER_JS.read_text(encoding="utf-8")
        line_content = LINE_RUNTIME_SHARED_JS.read_text(encoding="utf-8")

        self.assertLess(point_content.index("if (!packPath)"), point_content.index("getTransportAsset(packPath"))
        self.assertLess(industrial_content.index("if (!packPath)"), industrial_content.index("getTransportAsset(packPath"))
        self.assertIn("Transport workbench manifest is missing ${mode}/${key} pack path.", line_content)

    def test_preview_gets_route_through_data_service(self) -> None:
        point_content = POINT_PREVIEW_LOADER_JS.read_text(encoding="utf-8")
        industrial_content = INDUSTRIAL_PREVIEW_LOADER_JS.read_text(encoding="utf-8")
        line_content = LINE_RUNTIME_SHARED_JS.read_text(encoding="utf-8")
        manifest_content = MANIFEST_PREVIEW_JS.read_text(encoding="utf-8")

        self.assertIn("../core/data_service.js", point_content)
        self.assertIn("getTransportAsset", point_content)
        self.assertIn("../core/data_service.js", industrial_content)
        self.assertIn("getTransportAsset", industrial_content)
        self.assertIn("../core/data_service.js", line_content)
        self.assertIn("loadTransportAsset", line_content)
        self.assertIn("../core/data_service.js", manifest_content)
        self.assertIn("getTransportAsset", manifest_content)
        self.assertNotIn("fetch(packPath", point_content)
        self.assertNotIn("fetch(packPath", industrial_content)

    def test_industrial_preview_supports_polygon_and_point_runtime_shapes(self) -> None:
        industrial_content = INDUSTRIAL_PREVIEW_JS.read_text(encoding="utf-8")
        industrial_loader_content = INDUSTRIAL_PREVIEW_LOADER_JS.read_text(encoding="utf-8")

        self.assertIn("function createPolygonFeature", industrial_content)
        self.assertIn("function createPointFeature", industrial_content)
        self.assertIn("function createIndustrialFeature", industrial_content)
        self.assertIn("function createPointNode", industrial_content)
        self.assertIn("function createIndustrialNode", industrial_content)
        self.assertIn("createJapanIndustrialZonePreviewLoader(runtime", industrial_content)
        self.assertIn("function hasPackPath", industrial_loader_content)
        self.assertIn(".map((feature) => createIndustrialFeature(feature, variantId))", industrial_loader_content)
        self.assertIn("const requestedMode = shouldUseFullPack(scale) ? PACK_MODE_FULL : PACK_MODE_PREVIEW;", industrial_content)
        self.assertIn("const targetMode = hasPackPath(manifest, variantId, requestedMode) ? requestedMode : PACK_MODE_PREVIEW;", industrial_content)
        self.assertIn("if (includeFull && hasPackPath(manifest, variantId, PACK_MODE_FULL))", industrial_content)
        self.assertIn("return !!getPackPath(manifest, variantId, mode);", industrial_loader_content)
        self.assertIn("runtime.rootGroup.appendChild(createIndustrialNode(feature, style, onFeatureSelect));", industrial_content)
        self.assertIn("function getAggregateSelectionFeatureId", industrial_content)
        self.assertIn("node.dataset.featureId = getAggregateSelectionFeatureId(aggregateEntry);", industrial_content)
        self.assertIn("id: getAggregateSelectionFeatureId(aggregateEntry),", industrial_content)

    def test_point_preview_keeps_view_only_camera_sync_on_the_light_path(self) -> None:
        point_content = POINT_PREVIEW_SHARED_JS.read_text(encoding="utf-8")
        point_loader_content = POINT_PREVIEW_LOADER_JS.read_text(encoding="utf-8")
        point_dom_content = POINT_PREVIEW_DOM_JS.read_text(encoding="utf-8")
        point_runtime_content = POINT_PREVIEW_RUNTIME_JS.read_text(encoding="utf-8")
        lifecycle_content = (REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_preview_lifecycle_owner.js").read_text(encoding="utf-8")

        self.assertIn("viewOnly", lifecycle_content)
        self.assertIn("viewOnly: true", lifecycle_content)
        self.assertIn("createTransportWorkbenchPointPreviewRuntime(definition)", point_content)
        self.assertIn("createTransportWorkbenchPointPreviewLoader(runtime, definition", point_content)
        self.assertIn("function resetLoadStateForActivePack", point_loader_content)
        self.assertIn("function setActivePack", point_loader_content)
        self.assertIn("async function loadManifest", point_loader_content)
        self.assertIn("function startAuditLoad", point_loader_content)
        self.assertIn("function startSubtypeCatalogLoad", point_loader_content)
        self.assertIn("async function loadPack", point_loader_content)
        self.assertIn("export function ensureTransportWorkbenchPointRootGroups", point_dom_content)
        self.assertIn("export function createTransportWorkbenchPointMarkerNode", point_dom_content)
        self.assertIn("export function createTransportWorkbenchPointLabelNode", point_dom_content)
        self.assertIn("export function createTransportWorkbenchPointLabelDescriptor", point_dom_content)
        self.assertIn("renderLabelDescriptors(runtime)", point_content)
        self.assertIn("runtime.labelDescriptors", point_content)
        self.assertIn("runtime.renderedConfigSignature === nextConfigSignature", point_content)
        self.assertIn("runtime.renderedViewSignature === nextViewSignature", point_content)
        self.assertIn("createViewRenderSignature(targetMode, scale)", point_content)
        self.assertIn("const sourcePack = await loadPack(targetMode, config);", point_content)
        self.assertIn("const pack = createEffectivePointPack(sourcePack, config, definition);", point_content)
        self.assertIn("createTransportWorkbenchEffectivePointPack(sourcePack, config, definition", point_loader_content)
        self.assertIn("config?.editOverlay?.deleted", point_runtime_content)
        self.assertIn("config?.editOverlay?.updated", point_runtime_content)
        self.assertIn(".filter((feature) => !deletedIds.has(feature.id))", point_runtime_content)
        self.assertIn("function createTransportWorkbenchUpdatedPointFeature", point_runtime_content)
        self.assertIn("const updatedEntriesById = new Map", point_runtime_content)
        self.assertIn("...sourceProperties", point_runtime_content)
        self.assertIn("...patchProperties", point_runtime_content)
        self.assertIn('edit_overlay_mode: "updated"', point_runtime_content)
        self.assertLess(
            point_content.index("options.viewOnly"),
            point_content.index("const sourcePack = await loadPack")
        )

    def test_transport_carrier_uses_active_pack_runtime_asset_key_through_data_service(self) -> None:
        carrier_content = TRANSPORT_CARRIER_JS.read_text(encoding="utf-8")
        point_content = POINT_PREVIEW_SHARED_JS.read_text(encoding="utf-8")
        point_loader_content = POINT_PREVIEW_LOADER_JS.read_text(encoding="utf-8")
        line_content = LINE_RUNTIME_SHARED_JS.read_text(encoding="utf-8")
        industrial_content = INDUSTRIAL_PREVIEW_JS.read_text(encoding="utf-8")
        industrial_loader_content = INDUSTRIAL_PREVIEW_LOADER_JS.read_text(encoding="utf-8")
        data_service_content = DATA_SERVICE_JS.read_text(encoding="utf-8")

        self.assertIn("../core/data_service.js", carrier_content)
        self.assertIn('const DEFAULT_ASSET_KEY = "transport_carrier:japan_corridor";', carrier_content)
        self.assertIn("resolveCarrierAssetKeyFromManifest", carrier_content)
        self.assertIn("ensureTransportWorkbenchCarrierForManifest", carrier_content)
        self.assertIn("getAsset(resolvedKey)", carrier_content)
        self.assertIn("activeAssetKey", carrier_content)
        self.assertIn("currentEnsureGeneration", carrier_content)
        self.assertIn("loadedAsset", carrier_content)
        self.assertIn("missing carrier_asset_key", carrier_content)
        self.assertIn("transportCarrierAssetKey", carrier_content)
        self.assertNotIn("getAsset(DEFAULT_ASSET_KEY)", carrier_content)
        self.assertNotIn("resolveDataAssetUrl", carrier_content)
        self.assertNotIn("fetch(DEFAULT_ASSET_URL)", carrier_content)
        self.assertIn("await definition.prepareCarrier?.(manifest);", line_content)
        self.assertIn("loadGeneration", line_content)
        self.assertIn("isLoadGenerationCurrent", line_content)
        self.assertIn("await ensureTransportWorkbenchCarrierForManifest(manifest);", point_loader_content)
        self.assertIn("loadGeneration", point_loader_content)
        self.assertIn("isLoadGenerationCurrent", point_loader_content)
        self.assertIn("await ensureTransportWorkbenchCarrierForManifest(manifest);", industrial_loader_content)
        self.assertIn("loadGeneration", industrial_loader_content)
        self.assertIn("isLoadGenerationCurrent", industrial_loader_content)
        self.assertIn("renderJapanIndustrialZonePreview(config = {}, options = {})", industrial_content)
        self.assertIn('typeof options.isCurrent === "function" && !options.isCurrent()', industrial_content)
        self.assertNotIn("projectManifestClipPoint", point_content)
        self.assertNotIn('projectTransportWorkbenchCarrierGeometry(rawFeature?.geometry, "main")', industrial_content)
        self.assertNotIn("getManifestClipBbox", point_content)
        self.assertIn('registerMapcreatorSnapshotProvider("loadStatus", "data_service"', data_service_content)

    def test_industrial_preview_resets_load_snapshot_on_active_pack_change(self) -> None:
        industrial_content = INDUSTRIAL_PREVIEW_LOADER_JS.read_text(encoding="utf-8")

        self.assertIn("function createInitialLoadState()", industrial_content)
        self.assertIn("function createInitialRenderStats()", industrial_content)
        self.assertIn("function resetLoadStateForActivePack()", industrial_content)
        self.assertIn("runtime.loadState = createInitialLoadState();", industrial_content)
        self.assertIn("runtime.renderStats = createInitialRenderStats();", industrial_content)
        self.assertIn("runtime.activePackMode = null;", industrial_content)
        self.assertIn("runtime.activeVariantId = null;", industrial_content)
        self.assertIn("runtime.renderedConfigSignature = \"\";", industrial_content)
        self.assertIn("resetLoadStateForActivePack();", industrial_content)

    def test_japan_carrier_default_orientation_is_data_driven(self) -> None:
        carrier_payload = json.loads(CARRIER_JSON.read_text(encoding="utf-8"))
        provenance_payload = json.loads(CARRIER_PROVENANCE_JSON.read_text(encoding="utf-8"))
        builder_content = CARRIER_BUILDER_PY.read_text(encoding="utf-8")
        carrier_content = TRANSPORT_CARRIER_JS.read_text(encoding="utf-8")

        self.assertEqual(carrier_payload["defaultCamera"]["rotationQuarterTurns"], 1)
        self.assertEqual(provenance_payload["defaultCamera"]["rotationQuarterTurns"], 1)
        self.assertIn('"rotationQuarterTurns": 1', builder_content)
        self.assertIn("getDefaultRotationQuarterTurns()", carrier_content)
        self.assertIn("defaultQuarterTurns: getDefaultRotationQuarterTurns()", carrier_content)


    def test_family_preview_dispatch_is_config_driven(self) -> None:
        preview_content = FAMILY_PREVIEW_JS.read_text(encoding="utf-8")
        registry_content = FAMILY_REGISTRY_JS.read_text(encoding="utf-8")

        self.assertIn("createPreviewHandler", preview_content)
        self.assertIn("forEachPreviewHandler", preview_content)
        self.assertIn("getTransportWorkbenchFamilyPreviewConfig", preview_content)
        self.assertIn("listTransportWorkbenchFamilyPreviewConfigs", preview_content)
        self.assertIn("PREVIEW_MODULES_BY_KEY", preview_content)
        self.assertIn("selectTransportWorkbenchFamilyPreviewFeature", preview_content)
        self.assertIn("return !!handler.selectFeature(selection);", preview_content)
        self.assertIn("candidateFamilyId === normalizedFamilyId", preview_content)
        self.assertIn("candidateHandler.clear?.();", preview_content)
        self.assertIn("return handler.render(config, options);", preview_content)
        self.assertNotIn("runtimeState", preview_content)
        self.assertNotIn("transport_workbench_carrier.js", preview_content)
        self.assertNotIn("querySelector", preview_content)
        self.assertNotIn("FAMILY_PREVIEW_HANDLERS", preview_content)
        self.assertIn("TRANSPORT_WORKBENCH_FAMILY_PREVIEW_EXPORTS", registry_content)
        self.assertIn('selectFeature: "selectJapanRoadPreviewFeature"', registry_content)
        self.assertIn('selectFeature: "selectJapanRailPreviewFeature"', registry_content)
        self.assertIn('selectFeature: "selectJapanAirportPreviewFeature"', registry_content)
        self.assertIn('selectFeature: "selectJapanIndustrialZonePreviewFeature"', registry_content)
        self.assertIn("previewOnly: true", registry_content)
        self.assertIn('moduleKey: "road"', registry_content)
        self.assertIn('moduleKey: "rail"', registry_content)
        self.assertIn("export function getTransportWorkbenchFamilyPreviewConfig", registry_content)
        self.assertIn("export function listTransportWorkbenchFamilyPreviewConfigs", registry_content)

    def test_data_tab_family_rows_have_selection_contracts(self) -> None:
        registry_content = FAMILY_REGISTRY_JS.read_text(encoding="utf-8")
        modules = {
            "road": (REPO_ROOT / "js" / "ui" / "transport_workbench_road_preview.js").read_text(encoding="utf-8"),
            "rail": (REPO_ROOT / "js" / "ui" / "transport_workbench_rail_preview.js").read_text(encoding="utf-8"),
            "airport": (REPO_ROOT / "js" / "ui" / "transport_workbench_airport_preview.js").read_text(encoding="utf-8"),
            "port": (REPO_ROOT / "js" / "ui" / "transport_workbench_port_preview.js").read_text(encoding="utf-8"),
            "logistics_hubs": (REPO_ROOT / "js" / "ui" / "transport_workbench_logistics_hub_preview.js").read_text(encoding="utf-8"),
            "mineral_resources": (REPO_ROOT / "js" / "ui" / "transport_workbench_mineral_resource_preview.js").read_text(encoding="utf-8"),
            "energy_facilities": (REPO_ROOT / "js" / "ui" / "transport_workbench_energy_facility_preview.js").read_text(encoding="utf-8"),
            "industrial_zones": (REPO_ROOT / "js" / "ui" / "transport_workbench_industrial_zone_preview.js").read_text(encoding="utf-8"),
        }
        for family_id, module_content in modules.items():
            if "dataRows" not in module_content:
                continue
            registry_block_start = registry_content.index(f"{family_id}: Object.freeze")
            registry_block_end = registry_content.index("}),", registry_block_start)
            registry_block = registry_content[registry_block_start:registry_block_end]
            self.assertIn("selectFeature:", registry_block, family_id)

    def test_apply_bridge_routes_through_active_pack_contract(self) -> None:
        # Apply 链路按 gate -> patch -> overlay -> runtime state -> context layer 的顺序推进，顺序错会造成主图读到半套状态。
        registry_content = TRANSPORT_CAPABILITY_REGISTRY_JS.read_text(encoding="utf-8")
        controller_content = TRANSPORT_WORKBENCH_CONTROLLER_JS.read_text(encoding="utf-8")
        apply_owner_content = TRANSPORT_WORKBENCH_APPLY_BRIDGE_OWNER_JS.read_text(encoding="utf-8")
        overlay_content = (REPO_ROOT / "js" / "core" / "transport_country_overlay.js").read_text(encoding="utf-8")
        resolver_content = (REPO_ROOT / "js" / "core" / "transport_pack_resolver.js").read_text(encoding="utf-8")

        self.assertIn("getTransportWorkbenchActivePackBridgeSupport", registry_content)
        self.assertIn("createTransportPackSourceGateReport(normalizedPackId, manifest)", apply_owner_content)
        self.assertIn('reason: "source_pending"', registry_content)
        self.assertIn('reason: "active_pack_required"', registry_content)
        self.assertNotIn("hasExactTransportWorkbenchBridgeValueSet", registry_content)
        self.assertNotIn("TRANSPORT_WORKBENCH_OVERVIEW_BRIDGE_SUPPORTED_VALUES", registry_content)
        self.assertIn("dataLayerKeys: [...(MAIN_MAP_CONSUMER_KEYS_BY_FAMILY[normalizedFamilyId] || [])]", registry_content)
        self.assertIn("resolveTransportOverviewPatchFromWorkbench", registry_content)
        self.assertIn("loadTransportCountryOverlayState(patch.activePackId || activePackId)", apply_owner_content)
        self.assertIn("applyTransportCountryOverlayState(runtimeState, overlayState)", apply_owner_content)
        self.assertIn("applyTransportWorkbenchOverviewState(runtimeState, {", apply_owner_content)
        self.assertIn('reason: "transport-workbench-apply", renderNow: false', apply_owner_content)
        self.assertIn('getApplyDisabledReasonCopy', apply_owner_content)
        self.assertIn('Select a transport pack before applying to the main map', apply_owner_content)
        self.assertIn('Checking pack source before apply', apply_owner_content)
        self.assertIn('Choose a pack for this layer', apply_owner_content)
        self.assertNotIn("applyTransportCountryOverlayState(runtimeState, overlayState)", controller_content)
        self.assertNotIn("clearTransportCountryOverlayState(runtimeState, \"transport-workbench-pack-switch\")", controller_content)
        self.assertIn("transportWorkbenchPackSelect", controller_content)
        self.assertIn("MAIN_MAP_CONSUMER_KEYS_BY_FAMILY", overlay_content)
        self.assertIn('germany_road: Object.freeze({ packId: "germany_road", family: "road"', resolver_content)
        self.assertIn('france_rail: Object.freeze({ packId: "france_rail", family: "rail"', resolver_content)
        self.assertIn('usa_airport: Object.freeze({ packId: "usa_airport", family: "airport"', resolver_content)
        self.assertIn('usa_port: Object.freeze({ packId: "usa_port", family: "port"', resolver_content)
        self.assertIn('reason: "consumer_missing"', resolver_content)
        self.assertNotRegex(registry_content, re.compile(r"return\s*\{[\s\S]*?\bdisplayConfig\s*,[\s\S]*?\};"))
        self.assertIn('label: t("Preview only", "ui")', apply_owner_content)
        self.assertIn('label: t("Workbench only", "ui")', apply_owner_content)
        expected_apply_order = [
            "const gateReport = await refreshPackGateReport(activePackId);",
            "const patch = resolveTransportOverviewPatchFromWorkbench(",
            "const overlayState = await loadTransportCountryOverlayState(",
            "applyTransportCountryOverlayState(runtimeState, overlayState);",
            "applyTransportWorkbenchOverviewState(runtimeState, {",
            "await runtimeState.ensureContextLayerDataFn(",
        ]
        last_index = -1
        for needle in expected_apply_order:
            next_index = apply_owner_content.index(needle)
            self.assertGreater(next_index, last_index)
            last_index = next_index

    def test_main_map_target_packs_resolve_runtime_manifests_with_carriers(self) -> None:
        runtime_registry = json.loads((REPO_ROOT / "data" / "runtime_asset_registry.json").read_text(encoding="utf-8"))
        resolver_content = PACK_RESOLVER_JS.read_text(encoding="utf-8")
        target_block = resolver_content.split("const WORKBENCH_SELECTABLE_PACKS", 1)[0]
        target_pack_ids = re.findall(r'^\s+([a-z0-9_]+): Object\.freeze\(\{ packId: "\1"', target_block, re.MULTILINE)
        expected_target_pack_ids: list[str] = []
        for pack_id, asset_key in sorted((runtime_registry.get("transport_manifest_keys") or {}).items()):
            asset_url = (runtime_registry.get("assets") or {}).get(asset_key, {}).get("url")
            if not asset_url:
                continue
            manifest_path = REPO_ROOT / asset_url
            if not manifest_path.is_file():
                continue
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if (
                manifest.get("mainMapEligible") is True
                and manifest.get("apply_bridge_supported") is True
                and manifest.get("coverage_scope") == "country"
                and manifest.get("carrier_asset_key")
            ):
                expected_target_pack_ids.append(str(manifest.get("pack_id") or pack_id))
        missing_from_resolver = sorted(set(expected_target_pack_ids) - set(target_pack_ids))
        self.assertFalse(missing_from_resolver, missing_from_resolver)
        failures: list[str] = []

        for pack_id in target_pack_ids:
            asset_key = (runtime_registry.get("transport_manifest_keys") or {}).get(pack_id)
            if not asset_key:
                failures.append(f"{pack_id}: missing runtime manifest key")
                continue
            asset_url = (runtime_registry.get("assets") or {}).get(asset_key, {}).get("url")
            if not asset_url:
                failures.append(f"{pack_id}: missing runtime manifest url")
                continue
            manifest_path = REPO_ROOT / asset_url
            if not manifest_path.is_file():
                failures.append(f"{pack_id}: missing manifest file {asset_url}")
                continue
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest.get("pack_id") != pack_id:
                failures.append(f"{pack_id}: manifest pack_id {manifest.get('pack_id')}")
            if not manifest.get("carrier_asset_key"):
                failures.append(f"{pack_id}: missing carrier_asset_key")
            if not manifest.get("mainMapEligible"):
                failures.append(f"{pack_id}: missing mainMapEligible")
            if not manifest.get("apply_bridge_supported"):
                failures.append(f"{pack_id}: missing apply_bridge_supported")

        self.assertFalse(failures, failures)

    def test_runtime_registered_workbench_facility_packs_are_selectable(self) -> None:
        runtime_registry = json.loads((REPO_ROOT / "data" / "runtime_asset_registry.json").read_text(encoding="utf-8"))
        resolver_content = (REPO_ROOT / "js" / "core" / "transport_pack_resolver.js").read_text(encoding="utf-8")
        facility_families = {"energy_facilities", "mineral_resources", "industrial_zones", "logistics_hubs"}
        missing: list[str] = []
        for pack_id, asset_key in sorted((runtime_registry.get("transport_manifest_keys") or {}).items()):
            if pack_id.startswith("japan_"):
                continue
            family_id = pack_id.split("_", 1)[1] if "_" in pack_id else ""
            if family_id in facility_families:
                if f'{pack_id}: Object.freeze({{ packId: "{pack_id}"' not in resolver_content:
                    missing.append(f"{pack_id}:{asset_key}")

        self.assertFalse(missing, missing)

    def test_transport_copy_drops_road_only_legacy_phrases_from_runtime_and_startup_locales(self) -> None:
        stale_phrases = [
            "Only the road family is live right now",
            "Road and rail are the only Japan families with detailed controls right now.",
            "Use the center board to sort the seven transport families.",
            "These controls style only the future rail overlay shell.",
        ]

        locales_content = LOCALES_JSON.read_text(encoding="utf-8")
        controller_content = TRANSPORT_WORKBENCH_CONTROLLER_JS.read_text(encoding="utf-8")

        for phrase in stale_phrases:
            self.assertNotIn(phrase, locales_content)
            self.assertNotIn(phrase, controller_content)
            for startup_locale_file in STARTUP_LOCALE_FILES:
                self.assertNotIn(phrase, startup_locale_file.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
