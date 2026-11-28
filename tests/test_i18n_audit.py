from __future__ import annotations

import tempfile
import unittest
import json
from pathlib import Path

from tools.translate_manager import sync_ui_translations


class I18nAuditTest(unittest.TestCase):
    def test_ui_only_sync_preserves_geo_and_metadata_and_is_repeatable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            source = {
                "Fixture UI": {"zh": "界面测试词条", "en": "Fixture display"},
                "Existing": {"zh": "已有词条", "en": "Existing"},
            }
            self._write_ui_catalog(root, source)
            path = root / "data/locales.json"
            self._write_repo_json(root, "data/locales.json", {
                "metadata": {"preserved": True},
                "geo": {"Place": {"en": "Place", "zh": "地点"}},
                "ui": {"Existing": {"en": "Old", "zh": "旧值"}, "Stale": {"en": "Stale", "zh": "旧键"}},
            })
            sync_ui_translations(path, root)
            first = path.read_text(encoding="utf-8")
            payload = json.loads(first)
            self.assertEqual(payload["geo"], {"Place": {"en": "Place", "zh": "地点"}})
            self.assertEqual(payload["metadata"], {"preserved": True})
            self.assertEqual(payload["ui"], source)
            sync_ui_translations(path, root)
            self.assertEqual(path.read_text(encoding="utf-8"), first)

    def _write_repo_file(self, repo_root: Path, relative_path: str, content: str) -> None:
        path = repo_root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def _write_repo_json(self, repo_root: Path, relative_path: str, payload: dict) -> None:
        self._write_repo_file(
            repo_root,
            relative_path,
            json.dumps(payload, ensure_ascii=False, indent=2),
        )

    def _write_ui_catalog(self, repo_root: Path, payload: dict) -> None:
        self._write_repo_file(
            repo_root,
            "js/core/i18n_catalog.js",
            f"export const UI_COPY_CATALOG = Object.freeze({json.dumps(payload, ensure_ascii=False)});\n",
        )


if __name__ == "__main__":
    unittest.main()
