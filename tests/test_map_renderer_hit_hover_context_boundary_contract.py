from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
MAP_HOVER_INTERACTION_OWNER_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "map_hover_interaction_owner.js"
CLICK_SELECTION_OWNER_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "click_selection_transaction_owner.js"
PUBLIC_FACADE_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "public.js"
STATE_WRITE_ALLOWLIST = REPO_ROOT / "tools" / "eslint-rules" / "state-writer-allowlist.json"


def slice_between(source, start_marker, end_marker):
    start = source.find(start_marker)
    if start < 0:
        raise AssertionError(f"Expected start marker: {start_marker}")
    end = source.find(end_marker, start + len(start_marker))
    if end < 0:
        raise AssertionError(f"Expected end marker after {start_marker}: {end_marker}")
    return source[start:end]


class MapRendererHitHoverContextBoundaryContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        cls.hover_owner_content = MAP_HOVER_INTERACTION_OWNER_JS.read_text(encoding="utf-8")

    def test_hit_canvas_owner_receives_live_reads_and_root_scheduling_directly(self):
        owner_factory = slice_between(
            self.renderer_content,
            "function getHitCanvasSchedulingOwner()",
            "function getRendererTransactionResetOwner()",
        )

        for token in [
            "renderPhaseIdle: RENDER_PHASE_IDLE,",
            "idleTimeoutMs: STAGED_HIT_CANVAS_TIMEOUT_MS,",
            "hasHitCanvasRuntime: () => Boolean(rendererSurfaceHost.getHitContext() && rendererSurfaceHost.getPathHitCanvas()),",
            "isHitCanvasDirty: () => Boolean(runtimeState.hitCanvasDirty),",
            "isHitCanvasBuildDeferred: () => Boolean(runtimeState.deferHitCanvasBuild),",
            "getRenderPhase: () => runtimeState.renderPhase,",
            "getScheduledHitCanvasBuildHandle: () => runtimeState.hitCanvasBuildScheduled,",
            "getActiveScenarioId: () => runtimeState.activeScenarioId,",
            "scheduleDeferredWork,",
            "cancelDeferredWork,",
            "setScheduledHitCanvasBuildHandle: (handle) => {",
            "setHitCanvasBuildScheduledState(runtimeState, handle);",
            "runScheduledHitCanvasBuild: (details) => drawScheduledHitCanvasWithMetric(details),",
        ]:
            self.assertIn(token, owner_factory)

        for forbidden in [
            "getInteractionReceiverContext",
            "getRendererRuntimeContext",
            "rendererRuntimeContext:",
        ]:
            self.assertNotIn(forbidden, owner_factory)

    def test_hover_owner_receives_shared_state_surface_and_root_effects_directly(self):
        owner_factory = slice_between(
            self.renderer_content,
            "function getMapHoverInteractionOwner()",
            "function getVisibleFrameDiagnosticsOwner()",
        )

        for token in [
            "state: runtimeState,",
            "surfaceHost: rendererSurfaceHost,",
            "hoverSnapPx: HIT_SNAP_RADIUS_HOVER_PX,",
            "renderPhaseIdle: RENDER_PHASE_IDLE",
            "nowMs,",
            "inspectHgoRuntimePreviewFromEvent,",
            "getHitFromEvent,",
            "getHoveredFacilityEntryFromEvent,",
            "isFacilityDetailsSurfaceActive,",
            "getHoveredCityTooltipEntry,",
            "getTooltipTextForFeature: getTooltipText,",
            "getSelectedFacilityEntry: () => selectedFacilityEntry,",
            "updateDevHoverHit,",
            "renderHoverOverlay,",
            "recordInteractionDurationMetric,",
            "hidePhysicalIntensityBrushPreview,",
            "helpers: { getFacilityKey: buildFacilityEntryKey },",
        ]:
            self.assertIn(token, owner_factory)

        for forbidden in [
            "getInteractionReceiverContext",
            "getRendererRuntimeContext",
            "rendererRuntimeContext:",
        ]:
            self.assertNotIn(forbidden, owner_factory)

        for token in [
            "function hasHoverIds() {",
            "setHoveredFeatureIdsState(state, { landId, riverCellId, waterId, specialId });",
            "const throttleMs = Number(state.MOUSE_THROTTLE_MS || 0);",
            "const lastMouseMoveTime = Number(state.lastMouseMoveTime || 0);",
            "setLastMouseMoveTimeState(state, now);",
            "if (!surfaceHost.getTooltip()) {",
            "let hoveredFacilityEntry = null;",
            "function setHoverOverlayDirty(dirty = true) { setClickHoverOverlayDirtyState(state, dirty); }",
            "const entry = hoveredFacilityEntry || getterApi.getSelectedFacilityEntry();",
        ]:
            self.assertIn(token, self.hover_owner_content)

        direct_write = (
            r"\bstate\.(?:hoveredId|hoveredWaterRegionId|hoveredSpecialRegionId|"
            r"hoverOverlayDirty|lastMouseMoveTime|tooltipPendingState|tooltipRafHandle)\s*=(?!=)"
        )
        self.assertNotRegex(self.hover_owner_content, direct_write)
        self.assertIn('../state/actions/renderer_interaction_actions.js', self.hover_owner_content)

    def test_click_transaction_is_owner_owned_with_one_private_root_facade(self):
        click_facade = slice_between(
            self.renderer_content,
            "async function handleClick(event, interactionContext = null)",
            "async function handleDoubleClick(event, _interactionContext = null)",
        )
        owner_content = CLICK_SELECTION_OWNER_JS.read_text(encoding="utf-8")
        click_handler = slice_between(
            owner_content,
            "async function handleClick(event, _interactionContext = null)",
            "return Object.freeze({ handleClick });",
        )
        public_content = PUBLIC_FACADE_JS.read_text(encoding="utf-8")
        allowlist_content = STATE_WRITE_ALLOWLIST.read_text(encoding="utf-8")

        self.assertEqual(
            click_facade.strip(),
            "async function handleClick(event, interactionContext = null) {\n"
            "  return getClickSelectionTransactionOwner().handleClick(event, interactionContext);\n"
            "}",
        )
        self.assertEqual(self.renderer_content.count(".handleClick(event, interactionContext)"), 1)
        for token in [
            "getHitFromEvent(event, {",
            'eventType: "click"',
            "captureHistoryState(",
            "commitHistoryEntry({",
            "markDirty(",
        ]:
            self.assertIn(token, click_handler)
        self.assertNotIn("hitHoverContext", click_handler)
        self.assertNotIn("runtimeState", click_handler)
        self.assertNotIn("RendererRuntimeContext", public_content)
        self.assertNotIn("rendererRuntimeContext", allowlist_content)


if __name__ == "__main__":
    unittest.main()
