from __future__ import annotations

import tempfile
import urllib.error
import unittest
from pathlib import Path
from unittest import mock

from tools.translate_manager import MachineTranslator, collect_ui_keys, contains_cjk


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

    def test_collects_escaped_quote_ui_calls(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            self._write_repo_file(
                repo_root,
                "js/sample.js",
                r"""
const label = t("Say \"hi\"", "ui");
                """.strip(),
            )

            keys = collect_ui_keys(repo_root)

            self.assertIn('Say "hi"', keys)

    def test_collect_ui_keys_does_not_swallow_multiline_declarative_markup(self) -> None:
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
    <button data-i18n="Next Label">Next Label</button>
  </body>
</html>
                """.strip(),
            )

            keys = collect_ui_keys(repo_root)

            self.assertIn("Next Label", keys)
            self.assertNotIn("Broken      data-extra=", keys)

    def test_contains_cjk_uses_shared_cjk_detection(self) -> None:
        self.assertTrue(contains_cjk("阿尔法"))
        self.assertFalse(contains_cjk("Alpha"))

    def test_machine_translator_does_not_consume_quota_or_cache_failed_requests(self) -> None:
        translator = MachineTranslator(enabled=True, max_requests=1)
        failure = urllib.error.URLError("temporary outage")

        with mock.patch("tools.translate_manager.urllib.request.urlopen", side_effect=failure) as mocked_urlopen:
            self.assertIsNone(translator.translate("Hello"))
            self.assertIsNone(translator.translate("Hello"))

        self.assertEqual(mocked_urlopen.call_count, 2)
        self.assertEqual(translator.requests_made, 0)
        self.assertEqual(translator.cache, {})

    def test_machine_translator_caches_successful_translations(self) -> None:
        translator = MachineTranslator(enabled=True, max_requests=1)
        response = mock.MagicMock()
        response.read.return_value = b'[[["\xe4\xbd\xa0\xe5\xa5\xbd","Hello",null,null,1]],null,"en"]'
        response.__enter__.return_value = response
        response.__exit__.return_value = False

        with mock.patch("tools.translate_manager.urllib.request.urlopen", return_value=response) as mocked_urlopen:
            self.assertEqual(translator.translate("Hello"), "你好")
            self.assertEqual(translator.translate("Hello"), "你好")

        self.assertEqual(mocked_urlopen.call_count, 1)
        self.assertEqual(translator.requests_made, 1)
        self.assertEqual(translator.cache, {"Hello": "你好"})


if __name__ == "__main__":
    unittest.main()
