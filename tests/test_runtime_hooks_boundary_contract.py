from pathlib import Path
import unittest
import subprocess


REPO_ROOT = Path(__file__).resolve().parents[1]
MAIN_JS = REPO_ROOT / "js" / "main.js"
TOOLBAR_JS = REPO_ROOT / "js" / "ui" / "toolbar.js"
SIDEBAR_JS = REPO_ROOT / "js" / "ui" / "sidebar.js"
DEV_WORKSPACE_JS = REPO_ROOT / "js" / "ui" / "dev_workspace.js"
STATE_INDEX_JS = REPO_ROOT / "js" / "core" / "state" / "index.js"
STATE_CONFIG_JS = REPO_ROOT / "js" / "core" / "state" / "config.js"
STATE_BUS_JS = REPO_ROOT / "js" / "core" / "state" / "bus.js"
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
CLICK_SELECTION_OWNER_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "click_selection_transaction_owner.js"
RENDER_RUNTIME_BINDING_JS = REPO_ROOT / "js" / "bootstrap" / "render_runtime_binding.js"
HGO_RUNTIME_PREVIEW_RENDER_OWNER_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "hgo_runtime_preview_render_owner.js"
MAP_HOVER_INTERACTION_OWNER_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "map_hover_interaction_owner.js"
SAMPLE_PROJECT_IMPORT_WORKFLOW_JS = REPO_ROOT / "js" / "core" / "sample_project_import_workflow.js"


class RuntimeHooksBoundaryContractTest(unittest.TestCase):
    def test_state_index_keeps_runtime_hook_compat_surface(self):
        # Exercise the exported contract instead of pinning function declaration strings.
        result = subprocess.run(
            ["node", "--test", "tests/runtime_hook_compat_behavior.test.mjs",
             "tests/runtime_hook_lifecycle_behavior.test.mjs"],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_main_toolbar_sidebar_and_dev_workspace_keep_hook_wiring(self):
        main_content = MAIN_JS.read_text(encoding="utf-8")
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        dev_workspace_content = DEV_WORKSPACE_JS.read_text(encoding="utf-8")
        render_runtime_binding_content = RENDER_RUNTIME_BINDING_JS.read_text(encoding="utf-8")

        self.assertIn('registerRuntimeHook(state, "setStartupReadonlyStateFn", setStartupReadonlyState);', main_content)
        self.assertIn('registerRuntimeHook(state, "ensureFullLocalizationDataReadyFn", ensureFullLocalizationDataReady);', main_content)
        self.assertIn('registerHook(targetState, "showToastFn", showToastFn);', render_runtime_binding_content)
        self.assertLess(
            render_runtime_binding_content.index("initToastFn();"),
            render_runtime_binding_content.index('registerHook(targetState, "showToastFn", showToastFn);'),
        )
        self.assertIn('registerRuntimeHook(state, "syncDeveloperModeUiFn", syncDeveloperModeUi);', toolbar_content)
        self.assertIn('registerRuntimeHook(state, "updateWorkspaceStatusFn", refreshWorkspaceStatus);', toolbar_content)
        self.assertIn('registerRuntimeHook(state, "openTransportWorkbenchFn", (trigger = null) => openTransportWorkbench(trigger));', toolbar_content)
        self.assertIn('registerRuntimeHook(state, "closeTransportWorkbenchFn", ({ restoreFocus = true } = {}) => (', toolbar_content)
        self.assertIn('registerRuntimeHook(state, "restoreSupportSurfaceFromUrlFn", restoreSupportSurfaceFromUrl);', toolbar_content)
        self.assertIn('registerRuntimeHook(state, "updateScenarioContextBarFn", refreshScenarioContextBar);', toolbar_content)
        self.assertIn('registerRuntimeHook(state, "triggerScenarioGuideFn", triggerScenarioGuide);', toolbar_content)
        self.assertIn('registerRuntimeHook(state, "refreshSampleProjectBannerFn", refreshSampleProjectSurfaces);', toolbar_content)
        self.assertIn('registerRuntimeHook(state, "renderHgoRuntimePreviewFn", (options = {}) => (', toolbar_content)
        self.assertIn('registerRuntimeHook(state, "inspectHgoRuntimePreviewPointFn", (x, y, options = {}) => (', toolbar_content)
        self.assertIn('registerRuntimeHook(state, "renderCountryListFn", renderList);', sidebar_content)
        self.assertIn('registerRuntimeHook(state, "refreshCountryListRowsFn", refreshCountryRows);', sidebar_content)
        self.assertIn('registerRuntimeHook(state, "renderWaterRegionListFn", renderWaterRegionList);', sidebar_content)
        self.assertIn('registerRuntimeHook(state, "refreshWaterRegionListRowsFn", refreshWaterRegionRows);', sidebar_content)
        self.assertIn('registerRuntimeHook(state, "renderSpecialRegionListFn", renderSpecialRegionList);', sidebar_content)
        self.assertIn('registerRuntimeHook(state, "refreshSpecialRegionListRowsFn", refreshSpecialRegionRows);', sidebar_content)
        self.assertIn('registerRuntimeHook(state, "getStrategicOverlayPerfCountersFn", getStrategicOverlayPerfCounters);', sidebar_content)
        self.assertIn('registerRuntimeHook(state, "setDevWorkspaceExpandedFn", (nextValue) => {', dev_workspace_content)

    def test_runtime_hook_helpers_coordinate_safe_calls(self):
        index_content = STATE_INDEX_JS.read_text(encoding="utf-8")
        bus_content = STATE_BUS_JS.read_text(encoding="utf-8")
        history_content = (REPO_ROOT / "js" / "core" / "history_manager.js").read_text(encoding="utf-8")
        i18n_content = (REPO_ROOT / "js" / "ui" / "i18n.js").read_text(encoding="utf-8")

        self.assertIn("export function emitStateBusEvent(eventName, payload) {", index_content)
        self.assertIn("export function subscribeStateBusEvent(eventName, listener) {", index_content)
        self.assertIn("export function on(eventName, listener) {", bus_content)
        self.assertIn("export function off(eventName, listener = null) {", bus_content)
        self.assertIn("export function emit(eventName, payload) {", bus_content)
        self.assertIn("export function once(eventName, listener) {", bus_content)
        self.assertIn('callRuntimeHook(state, "updateHistoryUIFn");', history_content)
        self.assertIn('callRuntimeHooks(state, uiHooks);', history_content)
        self.assertIn('await callRuntimeHook(state, "ensureFullLocalizationDataReadyFn", {', i18n_content)
        self.assertIn('callRuntimeHooks(state, [', i18n_content)

    def test_sample_project_banner_hook_stays_on_notification_bus(self):
        config_content = STATE_CONFIG_JS.read_text(encoding="utf-8")
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        workflow_content = SAMPLE_PROJECT_IMPORT_WORKFLOW_JS.read_text(encoding="utf-8")
        controller_content = (
            REPO_ROOT / "js" / "ui" / "toolbar" / "sample_project_banner_controller.js"
        ).read_text(encoding="utf-8")

        self.assertIn('refreshSampleProjectBannerFn: "sample-project:refresh-banner"', config_content)
        self.assertIn('REFRESH_SAMPLE_PROJECT_BANNER: STATE_BUS_EVENT_BY_HOOK_NAME.refreshSampleProjectBannerFn', config_content)
        self.assertIn('callRuntimeHook(targetState, "refreshSampleProjectBannerFn", committedState);', workflow_content)
        self.assertIn("return committedState;", workflow_content)
        self.assertIn("createSampleProjectBannerController,", toolbar_content)
        self.assertIn('from "./toolbar/sample_project_banner_controller.js";', toolbar_content)
        self.assertIn('registerRuntimeHook(state, "refreshSampleProjectBannerFn", refreshSampleProjectSurfaces);', toolbar_content)
        self.assertIn("export function resolveSampleProjectBannerView", controller_content)

    def test_hgo_runtime_preview_hooks_are_registered_for_renderer_mode(self):
        config_content = STATE_CONFIG_JS.read_text(encoding="utf-8")
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        click_owner_content = CLICK_SELECTION_OWNER_JS.read_text(encoding="utf-8")
        hgo_preview_owner_content = HGO_RUNTIME_PREVIEW_RENDER_OWNER_JS.read_text(encoding="utf-8")
        hover_owner_content = MAP_HOVER_INTERACTION_OWNER_JS.read_text(encoding="utf-8")

        for hook_name in [
            "setHgoRuntimePreviewEnabledFn",
            "toggleHgoRuntimePreviewFn",
            "syncHgoRuntimePreviewUiFn",
            "getHgoRuntimePreviewProjectionOptionsFn",
            "renderHgoRuntimePreviewFn",
            "inspectHgoRuntimePreviewPointFn",
        ]:
            self.assertIn(f'"{hook_name}"', config_content)

        self.assertIn(
            'renderOptions: () => callRuntimeHook(state, "getHgoRuntimePreviewProjectionOptionsFn") || {},',
            toolbar_content,
        )
        self.assertIn('callRuntimeHook(runtimeState, "renderHgoRuntimePreviewFn"', hgo_preview_owner_content)
        self.assertIn('callRuntimeHook(runtimeState, "inspectHgoRuntimePreviewPointFn"', hgo_preview_owner_content)
        self.assertIn(
            'hgoRuntimePreviewController?.renderPreview?.(options) || null',
            toolbar_content,
        )
        self.assertIn(
            'hgoRuntimePreviewController?.inspectPoint?.(x, y, options) || null',
            toolbar_content,
        )
        self.assertIn("function getHgoRuntimePreviewProjectionOptions(overrides = {})", renderer_content)
        self.assertIn("HGO_DEFAULT_TARGET_PROJECTION", hgo_preview_owner_content)
        self.assertIn("HGO_SOURCE_PROJECTION", hgo_preview_owner_content)
        self.assertIn(
            'registerRuntimeHook(runtimeState, "getHgoRuntimePreviewProjectionOptionsFn", getHgoRuntimePreviewProjectionOptions);',
            renderer_content,
        )
        self.assertIn("projectionPixelRatio: runtimeState.dpr,", hgo_preview_owner_content)
        self.assertIn("projectionTransform: runtimeState.zoomTransform || null,", hgo_preview_owner_content)
        self.assertIn("function drawHgoPreviewPass()", renderer_content)
        self.assertIn('renderIfReady("hgo-preview-pass"', hgo_preview_owner_content)
        self.assertIn("targetCanvas,", hgo_preview_owner_content)
        self.assertIn("...getProjectionOptions(options),", hgo_preview_owner_content)
        self.assertIn("function inspectHgoRuntimePreviewFromEvent(", renderer_content)
        self.assertIn("function normalizeHitPayload(", hgo_preview_owner_content)
        self.assertIn('if (targetType === "hgo") {', renderer_content)
        self.assertIn("normalized.hgoRuntime = hgoRuntime;", renderer_content)
        self.assertIn('requestInteractionRender("hgo-runtime-preview-click");', click_owner_content)

        hgo_hit_start = hgo_preview_owner_content.index('id: `hgo:province:${resolved.provinceId}`')
        hgo_hit_end = hgo_preview_owner_content.index("hgoRuntime: Object.freeze({", hgo_hit_start)
        hgo_hit_body = hgo_preview_owner_content[hgo_hit_start:hgo_hit_end]
        self.assertIn('targetType: "hgo",', hgo_hit_body)
        self.assertIn("countryCode: ownerTag,", hgo_hit_body)
        self.assertIn('hitSource: "hgo-runtime-preview",', hgo_hit_body)

        # HGO 预览必须作为 render pass 参与合成；drawCanvas 末尾不能再直写主 canvas。
        draw_start = renderer_content.index("function drawCanvas() {")
        draw_end = renderer_content.index("function readRenderPerfMetricDuration(", draw_start)
        draw_body = renderer_content[draw_start:draw_end]
        self.assertNotIn('renderHgoRuntimePreviewIfReady("draw-canvas");', draw_body)
        self.assertNotIn("preferLastGoodFrameForHgoPreview", draw_body)

        hover_start = renderer_content.index("function handleMouseMove(event) {")
        hover_end = renderer_content.index("function addRecentColor(color) {", hover_start)
        hover_body = renderer_content[hover_start:hover_end]
        self.assertIn("getMapHoverInteractionOwner().handleMouseMove(event);", hover_body)
        self.assertIn('"inspectHgoRuntimePreviewFromEvent"', hover_owner_content)
        self.assertIn('getterApi.inspectHgoRuntimePreviewFromEvent(event, { eventType: "hover" });', hover_owner_content)
        self.assertIn('if (hgoRuntimeHover?.active) {', hover_owner_content)
        self.assertIn('return clearHoverForExclusiveMode("hgo-runtime-hover", hgoHit, hgoHit ? "pointer" : "");', hover_owner_content)

        click_start = click_owner_content.index("async function handleClick(event, _interactionContext = null) {")
        click_end = click_owner_content.index("const clickedFacilityEntry = getHoveredFacilityEntryFromEvent(event);", click_start)
        click_body = click_owner_content[click_start:click_end]
        self.assertIn('inspectHgoRuntimePreviewFromEvent(event, { eventType: "click" });', click_body)
        self.assertIn("if (hgoRuntimeClick.active) {", click_body)
        self.assertIn("updateDevSelectedHit(hgoRuntimeClick.hit?.id ? hgoRuntimeClick.hit : null);", click_body)
        self.assertEqual(
            renderer_content.count(
                "return getClickSelectionTransactionOwner().handleClick(event, interactionContext);"
            ),
            1,
        )

    def test_physical_intensity_tool_hook_is_registered_for_renderer_mode(self):
        config_content = STATE_CONFIG_JS.read_text(encoding="utf-8")
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")

        self.assertIn('"setIntensityFieldToolFn"', config_content)
        self.assertIn('registerRuntimeHook(runtimeState, "setIntensityFieldToolFn", setIntensityFieldTool);', renderer_content)
        self.assertIn("runtimeState.intensityFieldTool = normalizeIntensityFieldToolState(next);", renderer_content)
        self.assertIn("handlePhysicalIntensityPointerDown", renderer_content)


if __name__ == "__main__":
    unittest.main()
