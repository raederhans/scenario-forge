from pathlib import Path
import unittest

from tools.pages_artifact_root import resolve_pages_artifact_root

REPO_ROOT = Path(__file__).resolve().parents[1]
PAGES_DIST_ROOT = resolve_pages_artifact_root(repo_root=REPO_ROOT)


class FrontendRenderBoundaryContractTest(unittest.TestCase):
    def test_mainline_modules_do_not_directly_call_render_now(self):
        targets = [
            REPO_ROOT / "js" / "main.js",
            REPO_ROOT / "js" / "ui" / "sidebar.js",
            REPO_ROOT / "js" / "core" / "map_renderer.js",
            REPO_ROOT / "js" / "ui" / "dev_workspace.js",
            REPO_ROOT / "js" / "core" / "scenario_ownership_editor.js",
            REPO_ROOT / "js" / "core" / "history_manager.js",
            REPO_ROOT / "js" / "ui" / "shortcuts.js",
        ]

        offenders = []
        needle = "state.renderNowFn("
        for path in targets:
            content = path.read_text(encoding="utf-8")
            if needle in content:
                offenders.append(path.relative_to(REPO_ROOT).as_posix())

        self.assertEqual(
            offenders,
            [],
            msg=f"Direct renderNowFn calls reappeared in mainline modules: {', '.join(offenders)}",
        )

    def test_scenario_ownership_editor_has_no_render_request_after_edit_retirement(self):
        content = (REPO_ROOT / "js" / "core" / "scenario_ownership_editor.js").read_text(encoding="utf-8")
        self.assertNotIn('from "./render_boundary.js"', content)
        self.assertNotIn("flushRenderBoundary", content)
        self.assertNotIn("requestInteractionRender", content)
        self.assertIn("ownershipEditingDisabledResult", content)

    def test_render_boundary_reasons_survive_until_render_perf_snapshot(self):
        boundary = (REPO_ROOT / "js" / "core" / "render_boundary.js").read_text(encoding="utf-8")
        renderer = (REPO_ROOT / "js" / "core" / "map_renderer.js").read_text(encoding="utf-8")
        main_js = (REPO_ROOT / "js" / "main.js").read_text(encoding="utf-8")
        render_runtime_binding = (
            REPO_ROOT / "js" / "bootstrap" / "render_runtime_binding.js"
        ).read_text(encoding="utf-8")
        self.assertIn("lastScheduledReasons", boundary)
        self.assertIn("markRenderBoundaryFlushed", boundary)
        self.assertIn('recordRenderPerfMetric("renderBoundaryReasons", 0, getRenderBoundaryDebugState())', renderer)
        self.assertIn("flushRenderBoundary", main_js)
        self.assertIn("markBoundaryFlushed = markRenderBoundaryFlushed", render_runtime_binding)
        self.assertIn("markBoundaryFlushed();", render_runtime_binding)

    def test_core_modules_keep_ui_runtime_dependencies_behind_hooks(self):
        offenders = []
        forbidden_imports = [
            '../ui/i18n.js',
            '../ui/toast.js',
        ]
        for path in sorted((REPO_ROOT / "js" / "core").rglob("*.js")):
            content = path.read_text(encoding="utf-8")
            for forbidden in forbidden_imports:
                if forbidden in content:
                    offenders.append(f"{path.relative_to(REPO_ROOT).as_posix()} imports {forbidden}")

        self.assertEqual(offenders, [])

        renderer_content = (REPO_ROOT / "js" / "core" / "map_renderer.js").read_text(encoding="utf-8")
        core_i18n_content = (REPO_ROOT / "js" / "core" / "i18n.js").read_text(encoding="utf-8")
        main_content = (REPO_ROOT / "js" / "main.js").read_text(encoding="utf-8")
        render_runtime_binding_content = (
            REPO_ROOT / "js" / "bootstrap" / "render_runtime_binding.js"
        ).read_text(encoding="utf-8")
        ui_i18n_content = (REPO_ROOT / "js" / "ui" / "i18n.js").read_text(encoding="utf-8")
        ui_catalog_content = (REPO_ROOT / "js" / "ui" / "i18n_catalog.js").read_text(encoding="utf-8")

        self.assertIn('from "./i18n.js"', renderer_content)
        self.assertIn('callRuntimeHook(runtimeState, "showToastFn", message, options);', renderer_content)
        self.assertNotIn("globalThis.location", core_i18n_content)
        self.assertNotIn("localStorage", core_i18n_content)
        self.assertIn('registerHook(targetState, "showToastFn", showToastFn);', render_runtime_binding_content)
        self.assertIn("createStartupRenderRuntimeBinding({", main_content)
        self.assertIn("configureStartupSupportKeyUsageAudit();", main_content)
        self.assertIn('} from "../core/i18n.js";', ui_i18n_content)
        self.assertIn('export { UI_COPY_CATALOG } from "../core/i18n_catalog.js";', ui_catalog_content)

    def test_map_container_resize_observer_keeps_stage_resize_centered(self):
        renderer_content = (REPO_ROOT / "js" / "core" / "map_renderer.js").read_text(encoding="utf-8")
        owner_content = (
            REPO_ROOT / "js" / "core" / "renderer" / "viewport_resize_lifecycle_owner.js"
        ).read_text(encoding="utf-8")
        dist_renderer = PAGES_DIST_ROOT / "app" / "js" / "core" / "map_renderer.js"

        self.assertTrue(dist_renderer.exists())

        self.assertIn('from "./renderer/viewport_resize_lifecycle_owner.js";', renderer_content)
        self.assertIn("let viewportResizeLifecycleOwner = null;", renderer_content)
        self.assertIn("createViewportResizeLifecycleOwner({", renderer_content)
        self.assertIn("return getViewportResizeLifecycleOwner().requestMapContainerResizeSync(reason);", renderer_content)
        self.assertIn("return getViewportResizeLifecycleOwner().handleResize(reason);", renderer_content)
        self.assertIn("return getViewportResizeLifecycleOwner().bindBrowserZoomObservers();", renderer_content)
        self.assertIn('window.addEventListener("mapcreator:sidebar-layout-start", handleSidebarLayoutStart);', renderer_content)
        self.assertIn('window.addEventListener("mapcreator:sidebar-layout-refresh", () => handleResize("sidebar-layout-refresh"));', renderer_content)
        self.assertIn("function getProjectedRenderableContentBounds()", renderer_content)
        self.assertIn("function getCenteredFitZoomTransform({ centerX = true, centerY = false } = {})", renderer_content)
        self.assertIn("setHitCanvasDirty: () => {", renderer_content)
        self.assertIn("runtimeState.hitCanvasDirty = true;", renderer_content)
        self.assertIn("forceDprInvalidation = false", renderer_content)
        self.assertIn("forceDprInvalidation || Math.abs(previousDpr - runtimeState.dpr) >= 0.01", renderer_content)

        for forbidden in [
            "let mapContainerResizeObserver =",
            "let mapContainerResizeFrame =",
            "let mapContainerResizeTimer =",
            "let pendingMapResizeReason =",
            "let browserPixelRatioMediaQuery =",
            "let browserPixelRatioMediaQueryHandler =",
            "let visualViewportResizeHandler =",
            "let resizeSpatialRefreshHandle =",
        ]:
            self.assertNotIn(forbidden, renderer_content)

        for wrapper_name in [
            "getResizeReason",
            "isInteractiveLayoutResize",
            "scheduleResizeSpatialRefresh",
            "shouldPreferFullResizeReason",
            "requestMapContainerResizeSync",
            "bindMapContainerResizeObserver",
            "getDevicePixelRatioMediaQuery",
            "unbindBrowserPixelRatioObserver",
            "bindBrowserPixelRatioObserver",
            "bindVisualViewportResizeObserver",
            "bindBrowserZoomObservers",
            "handleBrowserPixelRatioRefresh",
            "handleResize",
            "handleSidebarLayoutStart",
        ]:
            self.assertIn(f"function {wrapper_name}", renderer_content)

        for owner_token in [
            "let mapContainerResizeObserver = null;",
            "let mapContainerResizeFrame = 0;",
            "let mapContainerResizeTimer = 0;",
            "let pendingMapResizeReason = \"\";",
            "let browserPixelRatioMediaQuery = null;",
            "let browserPixelRatioMediaQueryHandler = null;",
            "let visualViewportResizeHandler = null;",
            "let resizeSpatialRefreshHandle = null;",
            "function requestMapContainerResizeSync(",
            "function bindMapContainerResizeObserver(",
            "function bindBrowserPixelRatioObserver(",
            "function bindVisualViewportResizeObserver(",
            "function handleBrowserPixelRatioRefresh(",
            "function handleResize(",
            'requestMapContainerResizeSync("browser-dpr-change");',
            'requestMapContainerResizeSync("visual-viewport-resize");',
            'viewport.addEventListener("resize", visualViewportResizeHandler, { passive: true });',
            "scheduleResizeSpatialRefresh(resizeReason);",
        ]:
            self.assertIn(owner_token, owner_content)

        for forbidden in [
            "runtimeState",
            "drawCanvas",
            "initZoom",
            "renderPassToCache",
            "createElement(",
            "appendChild(",
            ".getContext(",
        ]:
            self.assertNotIn(forbidden, owner_content)


if __name__ == "__main__":
    unittest.main()
