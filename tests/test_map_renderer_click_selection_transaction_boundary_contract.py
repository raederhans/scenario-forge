from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
JS_CORE = REPO_ROOT / "js" / "core"
MAP_RENDERER_JS = JS_CORE / "map_renderer.js"
CLICK_SELECTION_TRANSACTION_OWNER_JS = JS_CORE / "map_renderer" / "click_selection_transaction_owner.js"
EVENT_BINDING_OWNER_JS = JS_CORE / "renderer" / "map_interaction_event_binding_owner.js"
INTERACTION_FUNNEL_JS = JS_CORE / "interaction_funnel.js"
INTERACTION_HIT_CANDIDATES_JS = JS_CORE / "map_renderer" / "interaction_hit_candidates.js"
HISTORY_MANAGER_JS = JS_CORE / "history_manager.js"
DIRTY_STATE_JS = JS_CORE / "dirty_state.js"
PUBLIC_FACADE_JS = JS_CORE / "map_renderer" / "public.js"
STATE_WRITE_ALLOWLIST = REPO_ROOT / "tools" / "eslint-rules" / "state-writer-allowlist.json"


def slice_between(source, start_marker, end_marker):
    start = source.find(start_marker)
    if start < 0:
        raise AssertionError(f"Expected start marker: {start_marker}")
    end = source.find(end_marker, start + len(start_marker))
    if end < 0:
        raise AssertionError(f"Expected end marker after {start_marker}: {end_marker}")
    return source[start:end]


def direct_state_write(root_name, key_name, suffix):
    return root_name + "." + key_name + suffix


class MapRendererClickSelectionTransactionBoundaryContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        cls.owner_content = CLICK_SELECTION_TRANSACTION_OWNER_JS.read_text(encoding="utf-8")
        cls.click_handler = slice_between(
            cls.renderer_content,
            "async function handleClick(event, interactionContext = null)",
            "async function handleDoubleClick(event, _interactionContext = null)",
        )
        cls.owner_click_handler = slice_between(
            cls.owner_content,
            "async function handleClick(event, _interactionContext = null)",
            "return Object.freeze({ handleClick });",
        )

    def test_handle_click_facade_delegates_once_and_owner_owns_hit_resolution(self):
        self.assertIn(
            "createClickSelectionTransactionOwner,",
            self.renderer_content,
        )
        self.assertEqual(
            self.click_handler.strip(),
            "async function handleClick(event, interactionContext = null) {\n"
            "  return getClickSelectionTransactionOwner().handleClick(event, interactionContext);\n"
            "}",
        )
        for token in [
            "const hit = getHitFromEvent(event, {",
            'eventType: "click"',
            "const resolvedHit = {",
            "targetType: hit.targetType ?? null,",
            "id: hit.id ?? null,",
            "countryCode: hit.countryCode ?? null,",
            "runtimeCountryCode: hit.runtimeCountryCode ?? null,",
            "const readonlyModifiers = Object.freeze({",
            "ctrlKey: !!event?.ctrlKey,",
            "metaKey: !!event?.metaKey,",
            "shiftKey: !!event?.shiftKey,",
            "altKey: !!event?.altKey,",
            "const { decision, target } = resolveClickSelectionDecision(resolvedHit, readonlyModifiers);",
            "const id = target.id;",
            'if (target.kind === "empty" || !id) {',
            "updateDevSelectedHit(hit);",
            'if (target.kind === "special") {',
            "const specialFeature = state.specialRegionsById.get(id);",
            'if (target.kind === "water") {',
            "const waterFeature = state.waterRegionsById.get(id);",
            "const isSelectionToggle = readonlyModifiers.ctrlKey || readonlyModifiers.metaKey;",
            'if (target.kind !== "land") return;',
            "let landHit = hit;",
            "let landId = id;",
            "let feature = state.landIndex.get(landId);",
            "if (decision.devSelectionRequested) {",
            "if (event?.preventDefault) event.preventDefault();",
            "const changedSelection = toggleFeatureInDevSelection(landId);",
            "syncInspectorCountryToLandSelection(feature, landId, landHit);",
            'noteRenderAction(changedSelection ? "dev-selection-toggle" : "dev-selection-sync", actionStart);',
            "let countryCode = landHit.countryCode || getFeatureCountryCodeNormalized(feature);",
            "if (!(await ensureLeafDetailReady(countryCode, { announce: true }))) {",
            "const refreshedHit = getHitFromEvent(event, {",
            "const refreshedFeature = refreshedId ? state.landIndex.get(refreshedId) : null;",
            'if (refreshedHit.targetType === "land" && refreshedId && refreshedFeature) {',
            "updateDevSelectedHit(landHit);",
            "const targetIds = resolveInteractionTargetIds(feature, landId);",
        ]:
            self.assertIn(token, self.owner_click_handler)

        self.assertEqual(self.owner_content.count("resolveClickSelectionDecision("), 2)
        self.assertNotIn("resolveClickSelectionDecision(hit", self.owner_click_handler)
        self.assertNotIn("resolveClickSelectionDecision(event", self.owner_click_handler)
        initial_admission = slice_between(
            self.owner_click_handler,
            "const { decision, target } = resolveClickSelectionDecision(resolvedHit, readonlyModifiers);",
            "const refreshedHit = getHitFromEvent(event, {",
        )
        self.assertNotIn('if (hit.targetType === "special") {', initial_admission)
        self.assertNotIn('if (hit.targetType === "water") {', initial_admission)
        self.assertNotIn("if (event?.ctrlKey || event?.metaKey) {", initial_admission)

    def test_owner_keeps_history_dirty_sidebar_render_and_metrics_service_order(self):
        for token in [
            "captureHistoryState({",
            "commitHistoryEntry({",
            'markDirty("erase-water-region-color")',
            'requestInteractionRender("clear-water-selection-empty-click")',
            'requestInteractionRender("clear-special-selection-empty-click")',
            'requestInteractionRender("select-special-region")',
            'requestInteractionRender("click-erase-water")',
            'requestInteractionRender("click-erase")',
            "refreshWaterRegionSidebarRowsNow(",
            "refreshSpecialRegionSidebarRowsNow(",
            "refreshSidebarAfterPaint(",
            'const countryScope = state.interactionGranularity === "country";',
            'const kind = countryScope ? "erase-country-color" : "erase-feature-color";',
            'const kind = countryScope ? "fill-country-color" : "fill-feature-color";',
            "markDirty(kind);",
            "warnIncompletePaintTargets();",
            "getFeaturePaintColor(landId)",
            "noteRenderAction(",
            'setClickSelectedWaterRegionId("")',
            "setClickSelectedSpecialRegionId(id)",
        ]:
            self.assertIn(token, self.owner_click_handler)

    def test_retired_ownership_and_country_palette_commands_are_not_invoked(self):
        for token in ["setFeatureOwnerCodes(", "resetFeatureOwnerCodes(",
                      "setClickCountryColors(", "removeClickCountryColors(",
                      "scheduleDynamicBorderRecompute("]:
            self.assertNotIn(token, self.owner_click_handler)

    def test_history_dirty_and_render_wrappers_keep_existing_owners(self):
        history_content = HISTORY_MANAGER_JS.read_text(encoding="utf-8")
        dirty_content = DIRTY_STATE_JS.read_text(encoding="utf-8")

        for token in [
            'import { captureHistoryState, pushHistoryEntry } from "./history_manager.js";',
            'import { markDirty } from "./dirty_state.js";',
            "function commitHistoryEntry({ kind, before, after, affectsSovereignty = false, gesture = null } = {})",
            "pushHistoryEntry({",
            'function requestInteractionRender(reason = "interaction")',
            "getRenderRequestBoundaryOwner().requestInteractionRenderBoundary(reason).completed;",
        ]:
            self.assertIn(token, self.renderer_content)
        for token in [
            "function captureHistoryState({",
            "function pushHistoryEntry(entry)",
            "function hasHistoryDelta(before, after)",
            "function applyHistorySnapshot(snapshot, direction, entry)",
        ]:
            self.assertIn(token, history_content)
        for token in [
            'function markDirty(reason = "")',
            "markDirtyState(runtimeState, reason);",
            "updateDirtyIndicator();",
        ]:
            self.assertIn(token, dirty_content)

    def test_event_binding_and_funnel_keep_injected_click_dispatch(self):
        event_binding_content = EVENT_BINDING_OWNER_JS.read_text(encoding="utf-8")
        funnel_content = INTERACTION_FUNNEL_JS.read_text(encoding="utf-8")

        for token in [
            'requireFunction(helpers, "bindInteractionFunnel")({',
            'mapClick: requireFunction(handlers, "mapClick")',
            'mapDoubleClick: requireFunction(handlers, "mapDoubleClick")',
            'interactionRect.on("click", requireFunction(handlers, "dispatchMapClick"));',
            'interactionRect.on("dblclick", requireFunction(handlers, "dispatchMapDoubleClick"));',
        ]:
            self.assertIn(token, event_binding_content)
        for token in [
            "let mapClickImpl = null;",
            "export function bindInteractionFunnel({",
            'mapClickImpl = typeof mapClick === "function" ? mapClick : null;',
            "export function dispatchMapClick(event)",
            'debugState.lastClickContext = buildMapInteractionContext("click", event);',
            "return mapClickImpl(event, debugState.lastClickContext);",
        ]:
            self.assertIn(token, funnel_content)

    def test_hit_candidates_remain_pure_and_outside_click_transaction_ownership(self):
        hit_candidates_content = INTERACTION_HIT_CANDIDATES_JS.read_text(encoding="utf-8")

        for token in [
            "runtimeState",
            "state.",
            "document",
            "window",
            "map_renderer.js",
            "handleClick",
            "dispatchMapClick",
            "markDirty",
            "captureHistoryState",
            "pushHistoryEntry",
            "commitHistoryEntry",
            "requestInteractionRender",
            "selectedWaterRegionId",
            "selectedSpecialRegionId",
        ]:
            self.assertNotIn(token, hit_candidates_content)

    def test_unique_owner_uses_injected_ports_and_facade_allowlist_remain_unchanged(self):
        public_content = PUBLIC_FACADE_JS.read_text(encoding="utf-8")
        allowlist_content = STATE_WRITE_ALLOWLIST.read_text(encoding="utf-8")
        owner_paths = sorted(
            path.relative_to(REPO_ROOT).as_posix()
            for path in JS_CORE.rglob("*.js")
            if "click_selection_transaction" in path.stem.lower()
        )

        self.assertEqual(
            owner_paths,
            ["js/core/map_renderer/click_selection_transaction_owner.js"],
        )
        for token in [
            "export function createClickSelectionTransactionOwner(",
            "export function resolveClickSelectionDecision(resolvedHit, readonlyModifiers)",
            "Reflect.ownKeys(",
            'target.kind === "land" && (readonlyModifiers.ctrlKey || readonlyModifiers.metaKey)',
            "return { decision, target };",
        ]:
            self.assertIn(token, self.owner_content)
        for token in [
            "import ",
            "globalThis",
            "addEventListener",
            "runtimeState",
            "map_renderer.js",
            "document",
            "window",
            "State(runtimeState",
        ]:
            self.assertNotIn(token, self.owner_content)
        for token in [
            "let state = getClickState();",
            "state = getClickState();",
            "setClickSelectedWaterRegionId(",
            "setClickSelectedSpecialRegionId(",
            "requestInteractionRender(",
            "return Object.freeze({ handleClick });",
        ]:
            self.assertIn(token, self.owner_content)
        self.assertEqual(self.owner_content.count("getClickState();"), 2)
        for token in [
            "click_selection_transaction",
            "renderer_click_selection_transaction",
            "clickSelectionTransaction",
            "resolveClickSelectionDecision",
        ]:
            self.assertNotIn(token, public_content)
            self.assertNotIn(token, allowlist_content)


if __name__ == "__main__":
    unittest.main()
