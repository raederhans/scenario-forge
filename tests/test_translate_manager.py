from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tools.translate_manager import collect_ui_keys


class TranslateManagerKeyCollectionTest(unittest.TestCase):
    def _write_repo_file(self, repo_root: Path, relative_path: str, content: str) -> None:
        path = repo_root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def test_collects_ui_call_uimap_and_declarative_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "js/sample.js",
                """
const label = t("Apply", "ui");
                """.strip(),
            )
            self._write_repo_file(
                repo_root,
                "js/ui/i18n.js",
                """
const uiMap = [
  ["lblCurrentTool", "Tools"],
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
    <button data-i18n="Link Lakes To Ocean">Link Lakes To Ocean</button>
    <input data-i18n-placeholder="Search Water Regions" />
    <button data-i18n-aria-label="Toggle left panel"></button>
  </body>
</html>
                """.strip(),
            )

            keys = collect_ui_keys(repo_root)

            self.assertIn("Apply", keys)
            self.assertIn("Tools", keys)
            self.assertIn("Link Lakes To Ocean", keys)
            self.assertIn("Search Water Regions", keys)
            self.assertIn("Toggle left panel", keys)


if __name__ == "__main__":
    unittest.main()
