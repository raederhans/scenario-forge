from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from shapely.geometry import box, mapping

from tools.check_atlantropa_geometry import check_scenario, compare_baseline


def feature(fid, geom, layer="land"):
    return {"type": "Feature", "properties": {"id": fid, "atl_render_layer": layer}, "geometry": mapping(geom)}


class CheckAtlantropaGeometryTests(unittest.TestCase):
    def run_fixture(self, source, chunks):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "chunks").mkdir()
            import json
            for lod, features in chunks.items():
                (root / "chunks" / f"scenario_atlantropa.{lod}.r0c0.json").write_text(json.dumps({"features": features}))
            with patch("tools.check_atlantropa_geometry.topology_features", return_value=source):
                return check_scenario(root)

    def test_overlap_and_missing_or_changed_chunk_are_failures(self):
        source = [feature("ATLPRV_1", box(0, 0, 2, 2)), feature("ATLPRV_2", box(1, 0, 3, 2)),
                  feature("ATLSEA_1", box(0, 1, 2, 3), "water")]
        report = self.run_fixture(source, {"coarse": [feature("ATLPRV_1", box(0, 0, 1, 1))]})
        kinds = {issue["check"] for issue in report["issues"]}
        self.assertFalse(report["passed"])
        self.assertTrue({"land_overlap", "land_sea_overlap", "chunk_missing", "source_coarse_coverage"}.issubset(kinds))

    def test_baseline_detects_non_atl_owner_manual_and_political_changes(self):
        import json
        with tempfile.TemporaryDirectory() as directory:
            old, new = Path(directory) / "old", Path(directory) / "new"
            old.mkdir()
            new.mkdir()
            for folder, tag in ((old, "FRA"), (new, "ITA")):
                (folder / "owners.by_feature.json").write_text(json.dumps({"owners": {"FR_1": tag}}))
                (folder / "geo_name_overrides.manual.json").write_text(json.dumps({"name": tag}))
            issues = []
            with patch("tools.check_atlantropa_geometry.topology_features", side_effect=[
                    [feature("FR_1", box(0, 0, 1, 1))], [feature("FR_1", box(0, 0, 2, 1))]]):
                compare_baseline(new, old, issues)
            self.assertIn("non_atl_political", {i["check"] for i in issues})
            self.assertEqual({i["file"] for i in issues if "file" in i},
                             {"owners.by_feature.json", "geo_name_overrides.manual.json"})


if __name__ == "__main__":
    unittest.main()
