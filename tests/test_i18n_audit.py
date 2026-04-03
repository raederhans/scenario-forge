from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tools.i18n_audit import collect_code_strings


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


if __name__ == "__main__":
    unittest.main()
