from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from shapely.geometry import box, mapping

from map_builder.regional_rebuild_plan import plan_regional_rebuild


def _fc(features):
    return {"type": "FeatureCollection", "features": features}


def _f(fid, country, geom):
    return {"type": "Feature", "properties": {"id": fid, "cntr_code": country}, "geometry": mapping(geom)}


class RegionalRebuildPlanTest(unittest.TestCase):
    def _write(self, path, features):
        path.write_text(json.dumps(_fc(features)), encoding="utf-8")

    def test_duplicate_missing_and_invalid_ids_or_geometry_fail_closed(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            good = root / "good.json"
            self._write(good, [_f("RU_A", "RU", box(0, 0, 1, 1))])
            for features in (
                [_f("RU_A", "RU", box(0, 0, 1, 1)), _f("RU_A", "RU", box(1, 0, 2, 1))],
                [_f("", "RU", box(0, 0, 1, 1))],
                [_f("RU_A", "RU", box(0, 0, 1, 1).boundary)],
            ):
                bad = root / f"bad{len(list(root.glob('bad*')))}.json"
                self._write(bad, features)
                with self.assertRaises(ValueError):
                    plan_regional_rebuild(baseline_topology=bad, candidate_topology=good, source_countries=["RU"])

    def test_property_only_change_and_ring_order_are_distinguished(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root); old = root / "old.json"; new = root / "new.json"
            a = _f("RU_A", "RU", box(0, 0, 1, 1)); b = _f("RU_B", "RU", box(1, 0, 2, 1)); b["properties"]["name"] = "changed"
            self._write(old, [a, _f("RU_B", "RU", box(1, 0, 2, 1))]); self._write(new, [a, b])
            result = plan_regional_rebuild(baseline_topology=old, candidate_topology=new, source_countries=["RU"])
            self.assertIn("RU_B", result["metadata_changed_ids"])
            self.assertFalse(result["master_only_eligible"])
            ring = _f("RU_A", "RU", box(0, 0, 1, 1)); ring["geometry"] = {"type": "Polygon", "coordinates": [list(reversed(ring["geometry"]["coordinates"][0]))]}
            self._write(new, [ring, b])
            result = plan_regional_rebuild(baseline_topology=old, candidate_topology=new, source_countries=["RU"])
            self.assertNotIn("RU_A", result["changed_ids_all_sources"])

    def test_preview_reports_selected_impact_and_unknown_selector_blocks(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root); old = root / "old.json"; self._write(old, [_f("RU_A", "RU", box(0, 0, 1, 1))])
            result = plan_regional_rebuild(baseline_topology=old, source_countries=["RU"])
            self.assertTrue(result["preview"]); self.assertFalse(result["apply_eligible"]); self.assertEqual(result["source_selection"]["selected_ids"], ["RU_A"])
            result = plan_regional_rebuild(baseline_topology=old, candidate_topology=old, feature_ids=["RU_MISSING"])
            self.assertEqual(result["blocked_reasons"][0]["reason"], "unknown_feature_ids")

    def test_ru_selector_expands_coupled_source_unit(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root); old = root / "old.json"; new = root / "new.json"
            self._write(old, [_f("RU_A", "RU", box(0, 0, 1, 1)), _f("UA_A", "UA", box(1, 0, 2, 1))])
            self._write(new, [_f("RU_A", "RU", box(0, 0, 1.1, 1)), _f("UA_A", "UA", box(1, 0, 2.1, 1))])
            result = plan_regional_rebuild(baseline_topology=old, candidate_topology=new, source_countries=["RU"])
            self.assertIn("UA", result["source_selection"]["countries"])
            self.assertEqual(result["changed_ids"], ["RU_A", "UA_A"])
    def test_same_ids_selects_changed_source_and_reports_all_scenarios(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            old = root / "old.json"
            new = root / "new.json"
            old.write_text(json.dumps(_fc([_f("RU_A", "RU", box(0, 0, 1, 1)), _f("UA_A", "UA", box(1, 0, 2, 1)), _f("DE_A", "DE", box(2, 0, 3, 1))])), encoding="utf-8")
            new.write_text(json.dumps(_fc([_f("RU_A", "RU", box(0, 0, 1.1, 1)), _f("UA_A", "UA", box(1, 0, 2, 1)), _f("DE_A", "DE", box(2, 0, 3.1, 1))])), encoding="utf-8")
            scenarios = []
            for name, owner in (("s1", "TAG1"), ("s2", "TAG2")):
                directory = root / name
                (directory / "chunks").mkdir(parents=True)
                (directory / "owners.by_feature.json").write_text(json.dumps({"owners": {"RU_A": owner}}), encoding="utf-8")
                (directory / "detail_chunks.manifest.json").write_text(json.dumps({"chunks": [{"id": "political.detail.country.x", "layer": "political", "url": "chunks/x.json", "feature_bounds": []}]}), encoding="utf-8")
                (directory / "chunks" / "x.json").write_text(json.dumps(_fc([_f("RU_A", "RU", box(0, 0, 1, 1)), _f("UA_A", "UA", box(1, 0, 2, 1))])), encoding="utf-8")
                scenarios.append(directory)
            result = plan_regional_rebuild(baseline_topology=old, candidate_topology=new, source_countries=["RU"], scenario_dirs=scenarios)
            self.assertEqual(result["changed_ids"], ["RU_A"])
            self.assertEqual(result["non_target_changed_ids"], ["DE_A"])
            self.assertTrue(result["non_target_changed"])
            self.assertFalse(result["apply_eligible"])
            self.assertEqual(result["scenarios"][0]["directly_affected_chunks"], ["political.detail.country.x"])
            self.assertEqual(result["scenarios"][0]["old_owners"]["RU_A"], "TAG1")

    def test_id_set_change_is_blocked(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            old = root / "old.json"
            new = root / "new.json"
            old.write_text(json.dumps(_fc([_f("RU_A", "RU", box(0, 0, 1, 1))])), encoding="utf-8")
            new.write_text(json.dumps(_fc([_f("RU_A1", "RU", box(0, 0, .5, 1)), _f("RU_A2", "RU", box(.5, 0, 1, 1))])), encoding="utf-8")
            result = plan_regional_rebuild(baseline_topology=old, candidate_topology=new, source_countries=["RU"])
            self.assertFalse(result["apply_eligible"])
            self.assertEqual(result["blocked_reasons"][0]["reason"], "split_merge_or_id_set_change")


if __name__ == "__main__":
    unittest.main()
