from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from map_builder.io.readers import read_json_optional, read_json_strict
from map_builder.io.writers import write_json_atomic


class IoHelpersTest(unittest.TestCase):
    def test_read_json_strict_reports_path_for_invalid_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            broken_path = Path(tmp_dir) / "broken.json"
            broken_path.write_text("{not-valid-json", encoding="utf-8")

            with self.assertRaises(ValueError) as exc_info:
                read_json_strict(broken_path)

            message = str(exc_info.exception)
            self.assertIn(str(broken_path), message)
            self.assertIn("parse JSON", message)

    def test_read_json_optional_supports_utf8_sig(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            payload_path = Path(tmp_dir) / "payload.json"
            payload_path.write_text("\ufeff" + json.dumps({"hello": "world"}), encoding="utf-8")

            payload = read_json_optional(payload_path, default={})

            self.assertEqual(payload, {"hello": "world"})

    def test_write_json_atomic_replaces_target_without_leaking_temp_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            target_path = tmp_path / "payload.json"

            write_json_atomic(target_path, {"version": 1}, ensure_ascii=False, indent=2, trailing_newline=True)
            write_json_atomic(target_path, {"version": 2}, ensure_ascii=False, indent=2, trailing_newline=True)

            payload = json.loads(target_path.read_text(encoding="utf-8"))
            self.assertEqual(payload, {"version": 2})
            self.assertEqual(list(tmp_path.glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
