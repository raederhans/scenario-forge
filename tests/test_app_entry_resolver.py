from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tools import app_entry_resolver


class AppEntryResolverTest(unittest.TestCase):
    def test_resolve_landing_entry_accepts_canonical_env_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            landing_path = root / "landing" / "index.html"
            landing_path.parent.mkdir(parents=True, exist_ok=True)
            landing_path.write_text("<html>landing</html>", encoding="utf-8")
            (root / "index.html").write_text("<html>app</html>", encoding="utf-8")

            with mock.patch.dict(os.environ, {"MAPCREATOR_LANDING_ENTRY": "landing/index.html"}, clear=False):
                resolved = app_entry_resolver.resolve_landing_entry_path(root=root)

            self.assertEqual(resolved, landing_path.resolve())

    def test_resolve_editor_entry_accepts_legacy_env_alias(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            editor_path = root / "workspace" / "index.html"
            editor_path.parent.mkdir(parents=True, exist_ok=True)
            editor_path.write_text("<html>workspace</html>", encoding="utf-8")
            (root / "index.html").write_text("<html>fallback</html>", encoding="utf-8")

            with mock.patch.dict(os.environ, {"MAPCREATOR_EDITOR_SOURCE": "workspace/index.html"}, clear=False):
                resolved = app_entry_resolver.resolve_editor_entry_path(root=root)

            self.assertEqual(resolved, editor_path.resolve())

    def test_resolve_entry_rejects_path_outside_allowed_roots(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            outside_dir = Path(tmp_dir).parent / "outside-entry-test"
            outside_dir.mkdir(parents=True, exist_ok=True)
            outside_path = outside_dir / "index.html"
            outside_path.write_text("<html>outside</html>", encoding="utf-8")
            (root / "index.html").write_text("<html>fallback</html>", encoding="utf-8")

            with mock.patch.dict(os.environ, {"MAPCREATOR_LANDING_ENTRY": str(outside_path)}, clear=False):
                with self.assertRaisesRegex(ValueError, "outside the repository root"):
                    app_entry_resolver.resolve_landing_entry_path(root=root)

    def test_resolve_entry_rejects_non_index_html_root_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            readme_path = root / "README.md"
            readme_path.write_text("docs", encoding="utf-8")
            (root / "index.html").write_text("<html>fallback</html>", encoding="utf-8")

            with mock.patch.dict(os.environ, {"MAPCREATOR_LANDING_ENTRY": "README.md"}, clear=False):
                with self.assertRaisesRegex(ValueError, "index.html entry file"):
                    app_entry_resolver.resolve_landing_entry_path(root=root)


if __name__ == "__main__":
    unittest.main()
