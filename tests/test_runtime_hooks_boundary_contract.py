from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAIN_JS = REPO_ROOT / "js" / "main.js"
TOOLBAR_JS = REPO_ROOT / "js" / "ui" / "toolbar.js"
SIDEBAR_JS = REPO_ROOT / "js" / "ui" / "sidebar.js"
DEV_WORKSPACE_JS = REPO_ROOT / "js" / "ui" / "dev_workspace.js"
STATE_INDEX_JS = REPO_ROOT / "js" / "core" / "state" / "index.js"
STATE_BUS_JS = REPO_ROOT / "js" / "core" / "state" / "bus.js"


class RuntimeHooksBoundaryContractTest(unittest.TestCase):
    def test_state_index_keeps_runtime_hook_compat_surface(self):
        content = STATE_INDEX_JS.read_text(encoding="utf-8")

        self.assertIn("export function registerRuntimeHook(target, hookName, hook) {", content)
        self.assertIn("export function readRuntimeHook(target, hookName) {", content)
        self.assertIn("export function callRuntimeHook(target, hookName, ...args) {", content)
        self.assertIn("export function callRuntimeHooks(target, hookNames, ...args) {", content)
        self.assertIn("export function bindStateCompatSurface(target) {", content)
        self.assertIn("export function registerRuntimeHookBusListener(target, hookName, listener) {", content)

    def test_main_toolbar_sidebar_and_dev_workspace_keep_hook_wiring(self):
        main_content = MAIN_JS.read_text(encoding="utf-8")
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        dev_workspace_content = DEV_WORKSPACE_JS.read_text(encoding="utf-8")

        self.assertIn('registerRuntimeHook(state, "setStartupReadonlyStateFn", setStartupReadonlyState);', main_content)
        self.assertIn('registerRuntimeHook(state, "ensureFullLocalizationDataReadyFn", ensureFullLocalizationDataReady);', main_content)
        self.assertIn('registerRuntimeHook(state, "syncDeveloperModeUiFn", syncDeveloperModeUi);', toolbar_content)
        self.assertIn('registerRuntimeHook(state, "updateWorkspaceStatusFn", refreshWorkspaceStatus);', toolbar_content)
        self.assertIn('registerRuntimeHook(state, "openTransportWorkbenchFn", (trigger = null) => openTransportWorkbench(trigger));', toolbar_content)
        self.assertIn('registerRuntimeHook(state, "closeTransportWorkbenchFn", ({ restoreFocus = true } = {}) => (', toolbar_content)
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
        self.assertIn('callRuntimeHooks(state, [', history_content)
        self.assertIn('await callRuntimeHook(state, "ensureFullLocalizationDataReadyFn", {', i18n_content)
        self.assertIn('callRuntimeHooks(state, [', i18n_content)


if __name__ == "__main__":
    unittest.main()
