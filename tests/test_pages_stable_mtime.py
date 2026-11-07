from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from tools import pages_stable_mtime


def write_tree(root: Path, files: dict[str, bytes]) -> None:
    for relative_path, payload in files.items():
        path = root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)


def mtimes(root: Path) -> dict[str, int]:
    return {
        path.relative_to(root).as_posix(): int(path.stat().st_mtime)
        for path in root.rglob("*")
        if path.is_file()
    }


class PagesStableMtimeTest(unittest.TestCase):
    FILES = {
        "index.html": b"<!doctype html>\n",
        "app/js/main.js": b"console.log(1);\n",
        "app/data/scenarios/tno_1962/manifest.json": b'{"id":"tno_1962"}\n',
    }

    def test_same_content_built_twice_gets_same_mtimes(self) -> None:
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            write_tree(Path(first), self.FILES)
            time.sleep(1.1)
            write_tree(Path(second), self.FILES)
            self.assertNotEqual(mtimes(Path(first)), mtimes(Path(second)))

            self.assertEqual(pages_stable_mtime.stamp_tree(Path(first)), len(self.FILES))
            pages_stable_mtime.stamp_tree(Path(second))

            self.assertEqual(mtimes(Path(first)), mtimes(Path(second)))

    def test_changing_one_file_changes_only_its_mtime(self) -> None:
        with tempfile.TemporaryDirectory() as before, tempfile.TemporaryDirectory() as after:
            write_tree(Path(before), self.FILES)
            write_tree(Path(after), {**self.FILES, "app/js/main.js": b"console.log(2);\n"})
            pages_stable_mtime.stamp_tree(Path(before))
            pages_stable_mtime.stamp_tree(Path(after))

            old, new = mtimes(Path(before)), mtimes(Path(after))
            changed = sorted(name for name in old if old[name] != new[name])
            self.assertEqual(changed, ["app/js/main.js"])

    def test_mtimes_are_in_the_past(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            write_tree(Path(root), self.FILES)
            pages_stable_mtime.stamp_tree(Path(root))
            for stamp in mtimes(Path(root)).values():
                self.assertGreaterEqual(stamp, pages_stable_mtime.MTIME_BASE_EPOCH)
                self.assertLess(stamp, time.time())

    def test_rejects_missing_root(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(NotADirectoryError):
                pages_stable_mtime.stamp_tree(Path(root) / "missing")


if __name__ == "__main__":
    unittest.main()
