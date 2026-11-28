import tempfile
import unittest
from pathlib import Path

from map_builder.base_stage import compute_stage_signature, should_skip_stage, update_stage_cache


class IncrementalBuildCacheTests(unittest.TestCase):
    def test_signature_changes_when_content_changes_even_with_same_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "input.json"
            path.write_text("aaaa", encoding="utf-8")
            first = compute_stage_signature(stage_name="unit", inputs=[path])
            path.write_text("bbbb", encoding="utf-8")
            second = compute_stage_signature(stage_name="unit", inputs=[path])
        self.assertNotEqual(first, second)

    def test_cache_hit_requires_output_content_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "output.json"
            output.write_text("stable", encoding="utf-8")
            cache = {}
            update_stage_cache(cache_payload=cache, stage_name="unit", signature="sig", outputs=[output])
            self.assertTrue(should_skip_stage(cache_payload=cache, stage_name="unit", signature="sig", outputs=[output]))
            output.write_text("changed", encoding="utf-8")
            self.assertFalse(should_skip_stage(cache_payload=cache, stage_name="unit", signature="sig", outputs=[output]))

    def test_added_source_file_invalidates_then_reverts_to_cache_hit(self):
        with tempfile.TemporaryDirectory() as tmp:
            source_dir = Path(tmp) / "sources"
            source_dir.mkdir()
            first = compute_stage_signature(stage_name="unit", inputs=[source_dir])
            (source_dir / "new.geojson").write_text("source", encoding="utf-8")
            changed = compute_stage_signature(stage_name="unit", inputs=[source_dir])
            self.assertNotEqual(first, changed)
            (source_dir / "new.geojson").unlink()
            self.assertEqual(first, compute_stage_signature(stage_name="unit", inputs=[source_dir]))


if __name__ == "__main__":
    unittest.main()
