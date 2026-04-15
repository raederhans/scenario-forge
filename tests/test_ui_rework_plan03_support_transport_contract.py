from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]


class UiReworkPlan03SupportTransportContractTest(unittest.TestCase):
    def test_agent_tiers_doc_exists_for_multi_agent_runs(self):
        content = (REPO_ROOT / "docs" / "shared" / "agent-tiers.md").read_text(encoding="utf-8")
        self.assertIn("## LOW", content)
        self.assertIn("## STANDARD", content)
        self.assertIn("## THOROUGH", content)
        self.assertIn("## 多代理启动前必看文件", content)
        self.assertIn("## 收尾前最低验证要求", content)
        self.assertIn("## 什么算真正收尾", content)

    def test_main_paths_no_longer_ship_old_inspector_summary_classes(self):
        index_content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        css_content = (REPO_ROOT / "css" / "style.css").read_text(encoding="utf-8")
        self.assertNotIn("inspector-section-summary-copy", index_content)
        self.assertNotIn("class=\"section-header inspector-section-summary", index_content)
        self.assertNotIn(".inspector-section-summary {", css_content)
        self.assertNotIn(".inspector-section-summary-copy {", css_content)

    def test_support_surface_tool_panels_keep_help_copy_and_drop_export_tooltip(self):
        content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="scenarioGuideBackdrop"', content)
        self.assertIn('id="scenarioGuidePopover"', content)
        self.assertIn('id="scenarioGuideCloseBtn"', content)
        self.assertIn("scenario-guide-modal", content)
        self.assertIn("Open this manual from the scenario bar or the Utilities panel. Both Guide buttons open the same help surface, so you can keep the next editing step visible while you work.", content)
        self.assertIn("Upload a local image, align it with opacity / scale / offsets, then keep those alignment values in the project. The image file itself needs to be uploaded again when you restore the project.", content)
        self.assertIn("Open the export workbench to preview the map, reorder layers, tune image adjustments, choose the target format, and export up to the current 8K limit.", content)
        self.assertNotIn("lblExportInfoTooltip", content)

    def test_transport_shell_uses_phase03_titles_and_status_contract(self):
        content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        required_tokens = [
            'id="transportWorkbenchInfoTitle" class="transport-workbench-info-title" data-i18n="Transport guide"',
            'class="transport-workbench-column-kicker" data-i18n="Lens">Lens',
            'class="transport-workbench-column-kicker" data-i18n="Inspector">Inspector',
            'id="transportWorkbenchCompareStatus" class="transport-workbench-preview-compare-status" data-i18n="Live working state" aria-live="polite"',
            'id="transportWorkbenchInspectorEmptyTitle" class="transport-workbench-empty-title" data-i18n="No transport schema loaded yet"',
        ]
        for token in required_tokens:
            self.assertIn(token, content)

    def test_toolbar_drops_legacy_transport_info_renderer_and_uses_new_copy(self):
        content = (REPO_ROOT / "js" / "ui" / "toolbar.js").read_text(encoding="utf-8")
        self.assertNotIn("renderTransportWorkbenchInfoPopoverLegacy", content)
        self.assertIn("transportWorkbenchCompareStatus.textContent", content)
        self.assertIn('transportWorkbenchInspectorTitle.textContent = `${t(family.label, "ui")} inspector`;', content)


if __name__ == "__main__":
    unittest.main()
