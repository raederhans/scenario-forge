import tempfile
import unittest
from pathlib import Path

from map_builder.base_stage import (
    compute_stage_signature,
    describe_path_state,
    should_skip_stage,
    update_stage_cache,
)
from map_builder.scenario_rebuild_planner import compute_tno_stage_signature_payload


class IncrementalBuildCacheTests(unittest.TestCase):
    def test_signature_changes_when_content_changes_even_with_same_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "input.json"
            path.write_text("aaaa", encoding="utf-8")
            first = compute_stage_signature(stage_name="unit", inputs=[path])
            path.write_text("bbbb", encoding="utf-8")
            second = compute_stage_signature(stage_name="unit", inputs=[path])
        self.assertNotEqual(first, second)
        self.assertNotIn("mtime_ns", describe_path_state(path) if path.exists() else {})

    def test_directory_identity_is_recursive_and_order_independent(self):
        with tempfile.TemporaryDirectory() as left, tempfile.TemporaryDirectory() as right:
            left_path, right_path = Path(left), Path(right)
            (left_path / "b").mkdir()
            (left_path / "a").write_text("one", encoding="utf-8")
            (left_path / "b" / "c").write_text("two", encoding="utf-8")
            (right_path / "b").mkdir()
            (right_path / "b" / "c").write_text("two", encoding="utf-8")
            (right_path / "a").write_text("one", encoding="utf-8")
            def content_entries(state):
                return sorted((Path(item["path"]).relative_to(Path(state["path"])).as_posix(), item["sha256"])
                              for item in state["children"])
            self.assertEqual(content_entries(describe_path_state(left_path)), content_entries(describe_path_state(right_path)))

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

    def test_cache_hit_rejects_directory_output_and_different_output_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output_dir = root / "out"
            output_dir.mkdir()
            (output_dir / "part.json").write_text("stable", encoding="utf-8")
            cache = {}
            update_stage_cache(cache_payload=cache, stage_name="unit", signature="sig", outputs=[output_dir])
            self.assertTrue(should_skip_stage(cache_payload=cache, stage_name="unit", signature="sig", outputs=[output_dir]))
            other_dir = root / "other"
            other_dir.mkdir()
            (other_dir / "part.json").write_text("stable", encoding="utf-8")
            self.assertFalse(should_skip_stage(cache_payload=cache, stage_name="unit", signature="sig", outputs=[other_dir]))

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

    def test_chunk_signature_includes_owner_mapping(self):
        with tempfile.TemporaryDirectory() as tmp:
            scenario = Path(tmp) / "scenario"
            checkpoint = scenario / "checkpoint"
            checkpoint.mkdir(parents=True)
            payload = compute_tno_stage_signature_payload("chunk_assets", scenario_dir=scenario, checkpoint_dir=checkpoint)
        self.assertIn("owners.by_feature.json", payload["inputs"])


if __name__ == "__main__":
    unittest.main()
