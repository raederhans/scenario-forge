from __future__ import annotations

import tempfile
import unittest
import json
from pathlib import Path

from tools.i18n_audit import collect_code_strings

REPO_ROOT = Path(__file__).resolve().parents[1]


class I18nAuditTest(unittest.TestCase):
    def _write_repo_file(self, repo_root: Path, relative_path: str, content: str) -> None:
        path = repo_root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def test_collects_legacy_and_declarative_coverage_separately(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "js/ui/i18n.js",
                """
const uiMap = [
  ["createTagBtn", "Create Tag"],
];
                """.strip(),
            )
            self._write_repo_file(
                repo_root,
                "index.html",
                """
<!doctype html>
<html>
  <body>
    <button id="createTagBtn">Create Tag</button>
    <button data-i18n="Scenario Tag Creator">Scenario Tag Creator</button>
  </body>
</html>
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertIn("Scenario Tag Creator", result["declarative_ui_keys"])
            self.assertIn("Create Tag", result["legacy_ui_map_keys"])
            self.assertIn("Create Tag", result["covered_default_literals"])
            self.assertIn("Scenario Tag Creator", result["covered_default_literals"])

    def test_splits_uncovered_a11y_and_non_translatable_literals(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "js/sample.js",
                """
const count = 3;
showToast("Apply Scenario");
showToast(`Copied ${count} region entries to the clipboard.`);
                """.strip(),
            )
            self._write_repo_file(
                repo_root,
                "index.html",
                """
<!doctype html>
<html>
  <body>
    <button aria-label="Toggle left panel">Panels</button>
    <input placeholder="berlin" />
    <span>0px</span>
  </body>
</html>
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertIn("Copied {expr} region entries to the clipboard.", result["dynamic_ui_candidates"])
            self.assertIn("Apply Scenario", result["uncovered_user_visible_literals"])
            self.assertIn("Toggle left panel", result["a11y_literals"])
            self.assertIn("berlin", result["non_translatable_tokens"])
            self.assertIn("0px", result["non_translatable_tokens"])

    def test_keeps_literal_translated_ui_alias_in_sync_with_ui_t_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "js/sample.js",
                """
const label = t("Create Tag", "ui");
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertEqual(result["ui_t_keys"], result["literal_translated_ui_keys"])

    def test_unicode_icon_escape_does_not_count_as_uncovered_literal(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "js/sample.js",
                r"""
const gear = document.createElement("button");
gear.textContent = "\u2699";
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertNotIn("\\u2699", result["uncovered_user_visible_literals"])
            self.assertNotIn("⚙", result["uncovered_user_visible_literals"])

    def test_collect_code_strings_ignores_broken_multiline_declarative_markup_without_hiding_valid_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "index.html",
                """
<!doctype html>
<html>
  <body>
    <button
      data-i18n="Broken
      data-extra="ignored"
    >Broken</button>
    <button data-i18n="Scenario Tag Creator">Scenario Tag Creator</button>
  </body>
</html>
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertIn("Scenario Tag Creator", result["declarative_ui_keys"])
            self.assertNotIn("Broken      data-extra=", result["declarative_ui_keys"])

    def test_ignores_script_and_importmap_contents_in_markup_audit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "index.html",
                """
<!doctype html>
<html>
  <head>
    <script type="importmap">
      {
        "imports": {
          "/js/": "./js/"
        }
      }
    </script>
    <script>
      (() => {
        const preload = document.createElement("link");
        preload.setAttribute("data-startup-bundle-preload", "true");
      })();
    </script>
  </head>
  <body>
    <button data-i18n="Scenario Tag Creator">Scenario Tag Creator</button>
  </body>
</html>
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertNotIn('{ "imports": { "/js/": "./js/" } }', result["uncovered_user_visible_literals"])
            self.assertFalse(
                any("data-startup-bundle-preload" in item for item in result["uncovered_user_visible_literals"])
            )
            self.assertIn("Scenario Tag Creator", result["covered_default_literals"])

    def test_collects_inline_ui_translation_keys_and_alt_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "js/ui/i18n_catalog.js",
                """
export const UI_COPY_CATALOG = Object.freeze({
  "Export preview ready": { zh: "导出预览已就绪", en: "Export preview ready" },
  Override: { zh: "覆盖", en: "Override" },
});
                """.strip(),
            )
            self._write_repo_file(
                repo_root,
                "index.html",
                """
<!doctype html>
<html>
  <body>
    <img data-i18n-alt="Export preview ready" alt="Export preview ready" />
  </body>
</html>
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertIn("Export preview ready", result["inline_ui_keys"])
            self.assertIn("Override", result["inline_ui_keys"])
            self.assertIn("Export preview ready", result["declarative_ui_keys"])
            self.assertIn("Export preview ready", result["covered_default_literals"])

    def test_collects_landing_markup_and_runtime_alt_literals(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "landing/index.html",
                """
<!doctype html>
<html>
  <body>
    <a data-i18n="Start mapping">Start mapping</a>
    <img data-i18n-alt="Landing preview" alt="Landing preview" />
  </body>
</html>
                """.strip(),
            )
            self._write_repo_file(
                repo_root,
                "landing/app.js",
                """
const translations = {
  en: {
    startMapping: "Start mapping",
  },
  zh: {
    startMapping: "开始制图",
  },
};
const image = document.querySelector("img");
image.setAttribute("alt", "Landing runtime preview");
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertEqual(result["source_scope_stats"]["landing"]["file_count"], 2)
            self.assertIn("Start mapping", result["landing_translation_default_values"])
            self.assertIn("Start mapping", result["declarative_ui_keys"])
            self.assertIn("Landing preview", result["declarative_ui_keys"])
            self.assertIn("Landing runtime preview", result["uncovered_user_visible_literals"])

    def test_collects_transport_descriptor_fields_as_ui_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "js/ui/toolbar/transport_workbench_descriptor.js",
                """
const config = {
  label: "Road classes",
  description: "Decide what enters the Japan road pack before any style rule runs.",
};
                """.strip(),
            )

            result = collect_code_strings(repo_root)

            self.assertIn("Road classes", result["ui_t_keys"])
            self.assertIn("Road classes", result["dynamic_config_ui_keys"])
            self.assertIn(
                "Decide what enters the Japan road pack before any style rule runs.",
                result["ui_t_keys"],
            )

    def test_main_runtime_supports_same_declarative_alt_attribute_as_audit(self) -> None:
        i18n_js = (REPO_ROOT / "js" / "ui" / "i18n.js").read_text(encoding="utf-8")

        self.assertIn('getAttribute("data-i18n-alt")', i18n_js)
        self.assertIn('setAttribute("alt", t(altKey, "ui"))', i18n_js)
        self.assertIn("[data-i18n-alt]", i18n_js)

    def test_locale_ui_domain_terms_avoid_obvious_machine_mistranslations(self) -> None:
        locales = json.loads((REPO_ROOT / "data" / "locales.json").read_text(encoding="utf-8"))
        ui = locales.get("ui") or {}
        geo = locales.get("geo") or {}
        high_risk_terms = {
            "Classes": "类别",
            "Airport inspector": "机场检查器",
            "Rail inspector": "铁路检查器",
            "Port inspector": "港口检查器",
            "Hub category": "枢纽类别",
            "Port": "港口",
            "Energy carrier": "能源预览面板",
            "Industrial land carrier": "工业用地预览面板",
            "Road lens": "道路视图",
            "Lens": "视图",
            "Mineral inspector": "矿产检查器",
            "Station opacity": "车站不透明度",
        }

        for key, expected_zh in high_risk_terms.items():
            with self.subTest(key=key):
                self.assertEqual((ui.get(key) or {}).get("zh"), expected_zh)

        self.assertEqual((geo.get("id::FR_ARR_62007") or {}).get("zh"), "朗斯")

        banned_fragments = (
            "课程",
            "检查员",
            "督察",
            "轮毂",
            "电台",
            "端口",
            "家庭",
            "承运",
            "镜头",
            "航空公司",
            "能量载体",
            "集线器",
            "透镜",
            "工业陆运载体",
            "载体",
            "航空母舰",
            "搬运车",
            "检验员",
            "镜片",
        )
        for section_name, section in (("ui", ui), ("geo", geo)):
            for key, entry in section.items():
                zh_value = entry.get("zh", "") if isinstance(entry, dict) else ""
                with self.subTest(section=section_name, key=key):
                    self.assertFalse(any(fragment in zh_value for fragment in banned_fragments), zh_value)


if __name__ == "__main__":
    unittest.main()
