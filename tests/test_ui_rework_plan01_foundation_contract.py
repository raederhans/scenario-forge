from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]


class UiReworkPlan01FoundationContractTest(unittest.TestCase):
    def test_ui_contract_module_exports_foundation_contracts(self):
        content = (REPO_ROOT / "js" / "ui" / "ui_contract.js").read_text(encoding="utf-8")
        required_snippets = [
            "const UI_TITLE_ROLE_CLASSES = Object.freeze(",
            "const UI_SURFACE_ROLE_CLASSES = Object.freeze(",
            "const UI_COPY_ROLE_CLASSES = Object.freeze(",
            "const UI_ACTION_ROLE_CLASSES = Object.freeze(",
            "const UI_SCOPE_CONTRACT = Object.freeze(",
            "const UI_URL_STATE_KEYS = Object.freeze(",
            "const UI_OVERLAY_KINDS = Object.freeze(",
            "function captureFocusOrigin(",
            "function restoreFocusOrigin(",
            "function applyDialogContract(",
            "dialog.tabIndex = -1;",
            "dialog.dataset.uiOverlayKind = UI_OVERLAY_KINDS.dialog.kind;",
            "export {",
        ]
        for snippet in required_snippets:
            self.assertIn(snippet, content)

    def test_css_defines_semantic_role_families_for_future_migrations(self):
        content = (REPO_ROOT / "css" / "style.css").read_text(encoding="utf-8")
        required_tokens = [
            ".sidebar-anchor-title",
            ".sidebar-section-title",
            ".sidebar-support-title",
            ".sidebar-appendix-title",
            ".sidebar-shell-anchor",
            ".sidebar-section-head",
            ".sidebar-support-head",
            ".sidebar-appendix-head",
            ".sidebar-group-label",
            ".sidebar-field-label",
            ".sidebar-section-shell",
            ".sidebar-support-block",
            ".sidebar-appendix-shell",
            ".sidebar-detail-group",
            ".sidebar-empty-state",
            ".sidebar-support-actions",
            ".sidebar-tool-panel",
            ".sidebar-help-copy",
            ".sidebar-empty-copy",
            ".sidebar-empty-copy.is-title",
            ".sidebar-section-info-trigger",
            ".sidebar-action-primary",
            ".sidebar-support-entry-btn",
            ".sidebar-tool-action-primary",
            ".sidebar-action-secondary",
            ".sidebar-action-secondary.is-danger",
        ]
        for token in required_tokens:
            self.assertIn(token, content)

    def test_app_dialog_is_wired_to_shared_dialog_and_focus_contract(self):
        content = (REPO_ROOT / "js" / "ui" / "app_dialog.js").read_text(encoding="utf-8")
        required_snippets = [
            'from "./ui_contract.js"',
            "applyDialogContract(dialog, {",
            "captureFocusOrigin(document)",
            "restoreFocusOrigin(previouslyFocused)",
        ]
        for snippet in required_snippets:
            self.assertIn(snippet, content)

    def test_toolbar_uses_shared_focus_return_contract(self):
        content = (REPO_ROOT / "js" / "ui" / "toolbar.js").read_text(encoding="utf-8")
        required_snippets = [
            'from "./ui_contract.js"',
            "createFocusReturnRegistry()",
            "rememberSurfaceTrigger(",
            "restoreSurfaceTriggerFocus(",
        ]
        forbidden_snippets = [
            "const overlayFocusReturnTargets = new WeakMap();",
            "const getFocusableElements = (container) => {",
        ]
        for snippet in required_snippets:
            self.assertIn(snippet, content)
        for snippet in forbidden_snippets:
            self.assertNotIn(snippet, content)


if __name__ == "__main__":
    unittest.main()

