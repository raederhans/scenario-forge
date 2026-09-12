from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
RENDER_CACHE_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "render_cache_owner.js"
CITY_LIGHTS_RENDER_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "city_lights_render_owner.js"
LEGACY_MODERN_CITY_LIGHTS_RENDER_OWNER_JS = (
    REPO_ROOT / "js" / "core" / "renderer" / "modern_city_lights_render_owner.js"
)

CITY_LIGHTS_RESPONSIBILITIES = {
    "owner_state_and_caches": (
        "modernCityLightsCells",
        "modernCityLightsGeometryCache",
        "modernCityLightsPopulationBoostCache",
        "modernCityLightsStaticLayerCache",
        "lightBlobSpriteCache",
        "LIGHT_BLOB_SPRITE_SIZE",
        "LIGHT_BLOB_SPRITE_LIMIT",
        "modernCityLightsDrawStats",
        "urbanShapeCanvas",
        "urbanShapeLoadAttempted",
        "globalUrbanByCityId",
        "historicalCityLightsDerivedGlowCache",
        "historicalCityLightsFallbackCache",
        "DEFAULT_MODERN_DAY_NIGHT_CONFIG",
    ),
    "shared_render_helpers": (
        "getNightLightPalette",
        "getUrbanLightWeight",
        "drawLightEllipse",
        "getLightBlobRgb",
        "toRgbaString",
        "getLightBlobSprite",
        "drawSoftLightBlob",
        "getSoftLightAlpha",
        "getSignedHashUnit",
    ),
    "modern_geometry_and_sampling": (
        "getModernCityLightsProjectionKey",
        "getModernCityLightsGridValue",
        "getModernCityLightsNormalizationDenominator",
        "normalizeModernCityLightsValue",
        "getModernCityLightsCells",
        "sampleModernCityLightsGridNormalized",
        "getModernCityLightsGeometry",
        "shouldCullModernLightEntry",
        "getModernCityLightsZoomProfile",
        "getModernCityLightLatitudeFade",
    ),
    "modern_population_and_static_canvas": (
        "getModernDayNightNumber",
        "isModernPopulationBoostEnabled",
        "getModernPopulationBoostStrength",
        "getModernCityLightsPopulationBoostData",
        "getModernPopulationCoreGain",
        "getModernCityLightsStaticConfigSignature",
        "getModernCityLightsStaticLayerKey",
        "createModernCityLightsStaticLayerCanvas",
        "getModernCityLightsStaticLayerCanvas",
    ),
    "modern_draw_bodies": (
        "drawModernCityLightsTexture",
        "collectModernUrbanCoreEntries",
        "drawModernUrbanShapes",
        "drawModernCityLightsCores",
        "drawModernCityFallbackLights",
        "drawModernCityLightsStaticLayer",
        "drawModernNightLightsLayer",
    ),
    "historical_fallback_sanitization_and_thresholds": (
        "getHistoricalCityLightsDensity",
        "getHistoricalCityLightsSecondaryRetention",
        "interpolateHistoricalThreshold",
        "getHistoricalCityLightCapitalBoost",
        "sanitizeHistoricalCityLightEntry",
        "shouldRenderHistoricalCityLightEntry",
        "getHistoricalProxyAssetEntries",
        "computeHistoricalFallbackCityLightWeight",
        "shouldIncludeHistoricalFallbackCity",
        "getHistoricalProxyFallbackEntries",
        "getHistoricalNightLightEntries",
        "getHistoricalDerivedGlowEntries",
    ),
    "historical_draw_and_dispatch": (
        "drawHistoricalDerivedGlowLayer",
        "drawHistoricalNightLightsLayer",
        "drawNightLightsLayer",
    ),
}

# getZoomTransform remains a shared host/runtime primitive; this inventory is limited to
# City Lights-specific state, policy, geometry, sampling, canvas, and draw responsibilities.

CITY_LIGHTS_HOST_FACADES = {
    "drawNightLightsLayer",
    "getSignedHashUnit",
    "toRgbaString",
}


def city_lights_responsibility_symbols():
    return {
        symbol
        for symbols in CITY_LIGHTS_RESPONSIBILITIES.values()
        for symbol in symbols
    }


def find_symbol_definitions(source, symbols):
    found = set()
    for symbol in symbols:
        escaped = re.escape(symbol)
        patterns = (
            rf"\bfunction\s+{escaped}\s*\(",
            rf"\b(?:const|let|var)\s+{escaped}\s*=",
            rf"(?<![\w$]){escaped}\s*=(?!=)",
            rf"\.\s*{escaped}\s*=(?!=)",
            rf"(?:^|[,{{;])\s*(?:async\s+)?{escaped}\s*\([^;{{}}]*\)\s*{{",
            rf"\b{escaped}\s*:\s*(?:function\b|(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)",
        )
        if any(re.search(pattern, source, re.MULTILINE) for pattern in patterns):
            found.add(symbol)
    return found


def extract_callable(source, symbol):
    escaped = re.escape(symbol)
    patterns = (
        rf"\bfunction\s+{escaped}\s*\((?P<params>[^)]*)\)\s*{{",
        rf"\b(?:const|let|var)\s+{escaped}\s*=\s*(?:async\s*)?\((?P<params>[^)]*)\)\s*=>\s*{{",
        rf"\b(?:const|let|var)\s+{escaped}\s*=\s*(?:async\s*)?function\s*\((?P<params>[^)]*)\)\s*{{",
    )
    match = next((candidate for pattern in patterns if (candidate := re.search(pattern, source))), None)
    if match is None:
        return None
    opening_brace = match.end() - 1
    depth = 0
    for index in range(opening_brace, len(source)):
        if source[index] == "{":
            depth += 1
        elif source[index] == "}":
            depth -= 1
            if depth == 0:
                return match.group("params"), source[opening_brace + 1:index]
    return None


def is_thin_city_lights_delegate(source, symbol):
    callable_definition = extract_callable(source, symbol)
    if callable_definition is None:
        return False
    params, body = callable_definition
    body = re.sub(r"/\*[\s\S]*?\*/|//[^\n]*", "", body)
    body = re.sub(r"\s+", " ", body).strip()
    escaped = re.escape(symbol)
    direct = re.fullmatch(
        rf"return\s+getCityLightsRenderOwner\(\)\s*\.\s*{escaped}\s*\((?P<args>[^;{{}}]*)\)\s*;?",
        body,
    )
    local = re.fullmatch(
        rf"(?:const|let)\s+(?P<owner>[A-Za-z_$][\w$]*)\s*=\s*getCityLightsRenderOwner\(\)\s*;\s*"
        rf"return\s+(?P=owner)\s*\.\s*{escaped}\s*\((?P<args>[^;{{}}]*)\)\s*;?",
        body,
    )
    delegate = direct or local
    if delegate is None:
        return False
    compact = lambda value: re.sub(r"\s+", "", value)
    return compact(params) == compact(delegate.group("args"))


class MapRendererRenderCacheOwnerBoundaryContractTest(unittest.TestCase):
    def test_map_renderer_keeps_cache_facade_while_render_cache_owner_holds_canvas_and_signature_state(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = RENDER_CACHE_OWNER_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        self.assertIn(
            "import { createRenderCacheOwner } from './renderer/render_cache_owner.js';",
            renderer_imports,
        )
        self.assertIn("let renderCacheOwner = null;", renderer_content)
        self.assertIn("function getRenderCacheOwner() {", renderer_content)
        get_owner_match = re.search(
            r"function getRenderCacheOwner\(\) \{(?P<body>[\s\S]*?)\n\}",
            renderer_content,
        )
        self.assertIsNotNone(get_owner_match)
        get_owner_body = get_owner_match.group("body")
        self.assertIn("renderCacheOwner = createRenderCacheOwner({", get_owner_body)
        self.assertIn("state: runtimeState,", get_owner_body)
        self.assertIn("interactionCompositePassNames: Object.freeze([...INTERACTION_COMPOSITE_PASS_NAMES]),", get_owner_body)
        self.assertIn("renderPassNames: Object.freeze([...RENDER_PASS_NAMES]),", get_owner_body)
        self.assertIn("transformedFramePassNames: new Set(TRANSFORM_REUSED_RENDER_PASS_NAMES),", get_owner_body)
        self.assertIn("getContext: () => rendererSurfaceHost.getContext?.() || null,", get_owner_body)
        self.assertIn("cloneZoomTransform,", get_owner_body)
        self.assertIn("ensureRenderPassCacheState,", get_owner_body)
        self.assertIn("getTransformSignature,", get_owner_body)
        self.assertIn("getVisibleFrameIdentity,", get_owner_body)
        self.assertNotIn("invalidateInteractionComposite,", get_owner_body)
        self.assertNotIn("getRenderCacheReceiverContext", get_owner_body)
        self.assertNotIn("getRendererRuntimeContext", get_owner_body)
        self.assertNotIn("rendererRuntimeContext:", get_owner_body)
        self.assertIn("function getRenderPassCacheState() {", renderer_content)
        self.assertIn("return getRenderCacheOwner().getRenderPassCacheState();", renderer_content)
        self.assertIn("return getRenderCacheOwner().clearLastGoodFrame(reason);", renderer_content)
        self.assertIn("return getRenderCacheOwner().invalidateInteractionComposite(reason);", renderer_content)
        self.assertIn("function getMutationPassNames(mutation = {}) {", renderer_content)
        self.assertIn("return mutation.normalizedPassNames;", renderer_content)
        self.assertIn("const hostFollowUps = mutation.effects?.hostFollowUps || {};", renderer_content)
        self.assertIn("return applyRenderPassInvalidationEffects(getRenderCacheOwner().invalidateRenderPasses(passNames, reason));", renderer_content)
        self.assertIn("return applyRenderPassInvalidationEffects(getRenderCacheOwner().invalidateAllRenderPasses(reason));", renderer_content)
        self.assertIn("const mutation = getRenderCacheOwner().clearRenderPassReferenceTransforms(passNames);", renderer_content)
        self.assertIn("return getRenderCacheOwner().getRenderPassLayout(passName);", renderer_content)
        self.assertIn("return getRenderCacheOwner().resizeRenderPassCanvases(passNames);", renderer_content)
        self.assertIn("return getRenderCacheOwner().ensureRenderPassCanvas(passName);", renderer_content)
        self.assertIn("return getRenderCacheOwner().ensureLastGoodFrameCanvas();", renderer_content)
        self.assertIn("return getRenderCacheOwner().ensureInteractionCompositeCanvas();", renderer_content)
        self.assertIn("return getRenderCacheOwner().ensureCompositeBufferCanvas();", renderer_content)
        self.assertIn("return getRenderCacheOwner().getPassReferenceTransform(passName);", renderer_content)
        self.assertIn("return getRenderCacheOwner().setPassReferenceTransform(passName, transform);", renderer_content)
        self.assertIn("return getRenderCacheOwner().getPassFullReferenceTransform(passName);", renderer_content)
        self.assertIn("return getRenderCacheOwner().setPassFullReferenceTransform(passName, transform);", renderer_content)
        self.assertIn("return getRenderCacheOwner().hasPassFullReferenceTransform(passName);", renderer_content)
        self.assertIn("return getRenderCacheOwner().clearPassFullReferenceTransforms(passNames);", renderer_content)
        self.assertIn("return getRenderCacheOwner().getInteractionCompositeSignature(cache);", renderer_content)
        self.assertIn("return getRenderCacheOwner().getInteractionCompositeReuseDecision(currentTransform, cache, options);", renderer_content)
        self.assertIn("return getRenderCacheOwner().canDrawInteractionComposite(currentTransform, cache);", renderer_content)

        self.assertIn("export function createRenderCacheOwner({", owner_content)
        self.assertIn("const RENDER_CACHE_OWNER_SUMMARY_VERSION = 1;", owner_content)
        self.assertIn('import { createRenderCacheValidationScope } from "./render_cache_validation_scope.js";', owner_content)
        self.assertIn("function composeRenderCacheValidationScope(state, ensureRenderPassCacheState, cloneZoomTransform, renderPassNames)", owner_content)
        self.assertIn("const owner = createRenderCacheValidationScope({", owner_content)
        self.assertIn("const { getRenderPassCacheState, withValidatedCache } = composeRenderCacheValidationScope(", owner_content)
        self.assertIn("ensure: () => ensureRenderPassCacheState(state, { cloneZoomTransform, renderPassNames }),", owner_content)
        self.assertRegex(
            owner_content,
            r"const \{ getRenderPassCacheState, withValidatedCache \} = composeRenderCacheValidationScope\(\s*"
            r"state,\s*ensureRenderPassCacheState, cloneZoomTransform, renderPassNames,\s*\);",
        )
        self.assertIn("getRoot: () => state.renderPassCache,", owner_content)
        self.assertIn("function normalizeRenderPassRequest(passNames, { filterKnown = true } = {}) {", owner_content)
        self.assertIn("function createMutationSummary({", owner_content)
        self.assertIn("version: RENDER_CACHE_OWNER_SUMMARY_VERSION,", owner_content)
        self.assertIn("requestedPassNames,", owner_content)
        self.assertIn("normalizedPassNames,", owner_content)
        self.assertIn("droppedPassNames,", owner_content)
        self.assertIn("sharedReferenceTransformCleared", owner_content)
        self.assertIn("function invalidateRenderPasses(passNames, reason = \"unspecified\") {", owner_content)
        self.assertIn("function invalidateAllRenderPasses(reason = \"unspecified\") {", owner_content)
        self.assertIn("function clearRenderPassReferenceTransforms(passNames = null) {", owner_content)
        self.assertIn("function invalidateInteractionComposite(reason = \"interaction-composite-invalidation\") {", owner_content)
        self.assertIn("function clearLastGoodFrame(reason = \"clear\") {", owner_content)
        self.assertNotIn("invalidateInteractionComposite = () => {}", owner_content)
        self.assertIn("function buildRenderPassLayout(passName) {", owner_content)
        self.assertIn("function resizeRenderPassCanvases(passNames = renderPassNames) {", owner_content)
        self.assertIn("function ensureRenderPassCanvas(passName) {", owner_content)
        self.assertRegex(
            owner_content,
            r"(?s)function ensureRenderPassCanvas\(passName\) \{"
            r".*?resizeRenderPassCanvases\(\[passName\]\);"
            r".*?return cache\.canvases\[passName\];",
        )
        self.assertIn("function ensureLastGoodFrameCanvas() {", owner_content)
        self.assertIn("function ensureInteractionCompositeCanvas() {", owner_content)
        self.assertIn("function ensureCompositeBufferCanvas() {", owner_content)
        self.assertIn("function getPassFullReferenceTransform(passName) {", owner_content)
        self.assertIn("function setPassFullReferenceTransform(passName, transform) {", owner_content)
        self.assertIn("function hasPassFullReferenceTransform(passName) {", owner_content)
        self.assertIn("function clearPassFullReferenceTransforms(passNames = null) {", owner_content)
        self.assertIn("function getInteractionCompositeMismatchReasons(composite, currentTransform, cache = getRenderPassCacheState()) {", owner_content)
        self.assertIn('mismatchReasons.push("scene-generation-mismatch");', owner_content)
        self.assertIn('mismatchReasons.push("scenario-data-generation-mismatch");', owner_content)
        self.assertIn("function getInteractionCompositeReuseDecision(", owner_content)
        self.assertIn('new Set(["selection-version-mismatch", "topology-revision-mismatch"])', owner_content)
        self.assertIn("allowSelectionTopologyContinuity", owner_content)
        self.assertIn("function canDrawInteractionComposite(currentTransform, cache = getRenderPassCacheState()) {", owner_content)
        self.assertIn("invalidateInteractionComposite(rejectReason);", owner_content)
        self.assertIn("invalidateRenderPasses,", owner_content)
        self.assertIn("invalidateAllRenderPasses,", owner_content)
        self.assertIn("clearRenderPassReferenceTransforms,", owner_content)
        self.assertIn("invalidateInteractionComposite,", owner_content)
        self.assertIn("clearLastGoodFrame,", owner_content)
        self.assertIn("getInteractionCompositeReuseDecision,", owner_content)
        self.assertIn("return transform ? cloneZoomTransform(transform) : null;", owner_content)
        self.assertIn("cache.fullReferenceTransforms[passName] = cloneZoomTransform(transform);", owner_content)
        self.assertNotIn("return cache.referenceTransform ? cloneZoomTransform(cache.referenceTransform) : null;", owner_content.split("function getPassFullReferenceTransform(passName) {", 1)[1].split("function setPassFullReferenceTransform", 1)[0])

        self.assertIsNone(re.search(r"function\s+buildRenderPassLayout\s*\(", renderer_content))
        self.assertIsNone(re.search(r"function\s+getInteractionCompositeRejectReason\s*\(", renderer_content))

    def test_modern_city_lights_static_cache_excludes_clock_fields(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = CITY_LIGHTS_RENDER_OWNER_JS.read_text(encoding="utf-8")
        signature_match = re.search(
            r"function getModernCityLightsStaticConfigSignature\(config\) \{(?P<body>[\s\S]*?)\n  \}",
            owner_content,
        )
        self.assertIsNotNone(signature_match)
        signature_body = signature_match.group("body")

        self.assertIn("cityLightsIntensity", signature_body)
        self.assertIn("cityLightsTextureOpacity", signature_body)
        self.assertIn("cityLightsCorridorStrength", signature_body)
        self.assertIn("cityLightsCoreSharpness", signature_body)
        self.assertIn("cityLightsPopulationBoostStrength", signature_body)
        self.assertNotIn("manualUtcMinutes", signature_body)
        self.assertNotIn("shadowOpacity", signature_body)
        self.assertNotIn("twilightWidthDeg", signature_body)

        key_match = re.search(
            r"function getModernCityLightsStaticLayerKey\(config\) \{(?P<body>[\s\S]*?)\n  \}",
            owner_content,
        )
        self.assertIsNotNone(key_match)
        key_body = key_match.group("body")
        self.assertIn("getModernCityLightsStaticConfigSignature(config)", key_body)
        self.assertIn("getTransformSignature(getZoomTransform())", key_body)
        self.assertIn("runtimeState.contextLayerRevision", key_body)
        self.assertIn("runtimeState.cityLayerRevision", key_body)
        self.assertIn("intensityFields?.channels?.urbanGlow?.revision", key_body)
        self.assertNotIn("manualUtcMinutes", key_body)
        self.assertNotIn("getDayNightSignatureClockToken", key_body)
        self.assertNotIn("shadowOpacity", key_body)
        self.assertNotIn("twilightWidthDeg", key_body)
        self.assertNotIn("solarState", key_body)

        self.assertRegex(
            owner_content,
            r"function drawModernNightLightsLayer\(k, config, solarState\) \{[\s\S]*?"
            r"const staticLayerCanvas = getModernCityLightsStaticLayerCanvas\(k, config, intensity\);[\s\S]*?"
            r"context\.drawImage\(staticLayerCanvas, 0, 0\);",
        )
        self.assertIn("drawNightLightsLayer(k, config, solarState);", renderer_content)
        self.assertIn("return getCityLightsRenderOwner().drawNightLightsLayer(k, config, solarState);", renderer_content)
        self.assertIn("function drawHistoricalNightLightsLayer(k, config, solarState) {", owner_content)
        self.assertNotIn("const historicalCityLightsFallbackCache = {", renderer_content)
        self.assertNotIn("function getHistoricalCityLightsDensity(config) {", renderer_content)
        self.assertNotIn("allowStaticBuild", renderer_content)
        self.assertNotIn("allowBuild: allowStaticBuild", renderer_content)

    def test_city_lights_implementation_responsibilities_cannot_flow_back_to_map_renderer(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = CITY_LIGHTS_RENDER_OWNER_JS.read_text(encoding="utf-8")
        responsibilities = city_lights_responsibility_symbols()
        owner_definitions = find_symbol_definitions(owner_content, responsibilities)
        host_definitions = find_symbol_definitions(renderer_content, responsibilities)

        self.assertEqual(owner_definitions, responsibilities)
        self.assertEqual(host_definitions - CITY_LIGHTS_HOST_FACADES, set())
        self.assertEqual(host_definitions & CITY_LIGHTS_HOST_FACADES, CITY_LIGHTS_HOST_FACADES)
        for facade_symbol in CITY_LIGHTS_HOST_FACADES:
            with self.subTest(facade_symbol=facade_symbol):
                self.assertTrue(is_thin_city_lights_delegate(renderer_content, facade_symbol))

    def test_city_lights_definition_scanner_rejects_common_host_reflow_shapes(self):
        hostile_sources = {
            "function declaration": "function drawSoftLightBlob() { return 1; }",
            "const arrow": "const getModernCityLightsGeometry = () => ({ entries: [] });",
            "assignment": "getModernCityLightsStaticLayerCanvas = function () { return canvas; };",
            "member assignment": "host.getModernCityLightsPopulationBoostData = () => cache;",
            "object method": "const host = { shouldIncludeHistoricalFallbackCity(feature) { return !!feature; } };",
            "property arrow": "const host = { drawHistoricalDerivedGlowLayer: (entries) => entries };",
        }
        responsibilities = city_lights_responsibility_symbols()
        for shape, source in hostile_sources.items():
            with self.subTest(shape=shape):
                self.assertEqual(len(find_symbol_definitions(source, responsibilities)), 1)

        benign_calls = "drawSoftLightBlob(entry); owner.getModernCityLightsGeometry();"
        self.assertEqual(find_symbol_definitions(benign_calls, responsibilities), set())

    def test_city_lights_thin_delegate_contract_allows_equivalent_formatting_and_local_owner(self):
        equivalent = """
            function drawModernNightLightsLayer(...args) {
              const owner = getCityLightsRenderOwner();
              return owner.drawModernNightLightsLayer(
                ...args
              );
            }
        """
        implementation_body = """
            function drawModernNightLightsLayer(...args) {
              const cache = {};
              return getCityLightsRenderOwner().drawModernNightLightsLayer(...args);
            }
        """
        wrong_delegate = """
            function drawModernNightLightsLayer(...args) {
              return getCityLightsRenderOwner().drawNightLightsLayer(...args);
            }
        """

        self.assertTrue(is_thin_city_lights_delegate(equivalent, "drawModernNightLightsLayer"))
        self.assertFalse(is_thin_city_lights_delegate(implementation_body, "drawModernNightLightsLayer"))
        self.assertFalse(is_thin_city_lights_delegate(wrong_delegate, "drawModernNightLightsLayer"))

    def test_legacy_modern_city_lights_owner_path_stays_removed(self):
        self.assertFalse(LEGACY_MODERN_CITY_LIGHTS_RENDER_OWNER_JS.exists())

    def test_modern_city_lights_advanced_controls_reach_draw_algorithms(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = CITY_LIGHTS_RENDER_OWNER_JS.read_text(encoding="utf-8")

        texture_match = re.search(
            r"function drawModernCityLightsTexture\(config, intensity\) \{(?P<body>[\s\S]*?)\n  \}",
            owner_content,
        )
        self.assertIsNotNone(texture_match)
        texture_body = texture_match.group("body")
        self.assertIn('getModernDayNightNumber(config, "cityLightsTextureOpacity")', texture_body)
        self.assertIn('getModernDayNightNumber(config, "cityLightsCorridorStrength")', texture_body)
        self.assertIn("textureOpacity <= 0 && corridorStrength <= 0", texture_body)
        self.assertIn("textureOpacity *", texture_body)
        self.assertIn("corridorStrength *", texture_body)
        self.assertNotIn("function drawModernCityLightsCorridors(", owner_content)
        self.assertNotIn("function drawModernCityLightsPopulationBoostLayer(", owner_content)
        self.assertNotIn("function getModernGridEntryJitter(", owner_content)

        core_match = re.search(
            r"function drawModernCityLightsCores\(k, config, _intensity, coreEntries = null\) \{(?P<body>[\s\S]*?)\n  \}",
            owner_content,
        )
        self.assertIsNotNone(core_match)
        core_body = core_match.group("body")
        self.assertIn('getModernDayNightNumber(config, "cityLightsCoreSharpness")', core_body)
        self.assertIn("haloSpread", core_body)
        self.assertIn("coreSpread", core_body)
        self.assertIn("coreInnerStop", core_body)
        self.assertIn("coreMidStop", core_body)

    def test_active_scenario_shell_empty_political_baseline_cannot_fall_back_to_primary(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")

        self.assertIn(
            "const runtimeBaseCollection = getRuntimePoliticalBaseCollection(runtimeCollection);",
            renderer_content,
        )
        self.assertIn(
            'const hasScenarioRuntimePoliticalSource = !!String(runtimeState.activeScenarioId || "").trim()',
            renderer_content,
        )
        self.assertIn("&& !!runtimeTopology?.objects?.political;", renderer_content)
        self.assertRegex(
            renderer_content,
            r"if \(runtimeBaseCollection\) \{[\s\S]*?"
            r"fullCollection = runtimeBaseCollection;[\s\S]*?"
            r"\} else if \(hasScenarioRuntimePoliticalSource\) \{[\s\S]*?"
            r"fullCollection = \{ type: \"FeatureCollection\", features: \[\] \};[\s\S]*?"
            r"\} else if \(primaryTopology\?\.objects\?\.political",
        )
        self.assertIn(
            "appendUniqueFeatureCollections(\n    fullCollection,\n    buildAtlantropaLandLikeFeatureCollection()\n  );",
            renderer_content,
        )


if __name__ == "__main__":
    unittest.main()
