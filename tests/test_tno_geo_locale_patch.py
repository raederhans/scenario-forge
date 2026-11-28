from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tools.build_tno_1962_geo_locale_patch import build_patch


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_locale_fixture(locales_path: Path, raw_name: str, zh_name: str) -> None:
    _write_json(locales_path, {"geo": {raw_name: {"en": raw_name, "zh": zh_name}}})


def _build_patch(scenario_dir, owners):
    geometries = [{"id": fid, "properties": {"id": fid, "name": "Pool"}} for fid in owners]
    _write_json(scenario_dir / "runtime_topology.topo.json", {"objects": {"political": {"geometries": geometries}}})
    _write_json(scenario_dir / "owners.by_feature.json", {"owners": owners})
    locales_path = scenario_dir.parent / "locales.json"
    _write_locale_fixture(locales_path, "Pool", "普尔")
    return build_patch(
        scenario_id="tno_1962", scenario_dir=scenario_dir, locales_path=locales_path,
        manual_overrides_path=scenario_dir / "missing.manual.json",
        reviewed_exceptions_path=scenario_dir / "missing.reviewed.json",
        output_path=scenario_dir / "geo_locale_patch.json",
    )


class TnoGeoLocalePatchTest(unittest.TestCase):
    def test_build_patch_writes_locale_specific_variants(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            scenario_dir = tmp_path / "scenario"
            payload = _build_patch(scenario_dir, {'FEATURE-1': 'AEF'})


            en_payload = json.loads((scenario_dir / "geo_locale_patch.en.json").read_text(encoding="utf-8"))
            zh_payload = json.loads((scenario_dir / "geo_locale_patch.zh.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["geo"]["FEATURE-1"], {"en": "Pool", "zh": "普尔"})
            self.assertEqual(en_payload["language"], "en")
            self.assertEqual(en_payload["geo"]["FEATURE-1"], {"en": "Pool"})
            self.assertEqual(zh_payload["language"], "zh")
            self.assertEqual(zh_payload["geo"]["FEATURE-1"], {"zh": "普尔"})

    def test_split_clone_duplicates_are_safe_copied(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            scenario_dir = tmp_path / "scenario"
            payload = _build_patch(scenario_dir, {'CG_ADM1_COG-3341__tno1962_1': 'AEF', 'CG_ADM1_COG-3341__tno1962_2': 'AEF'})


            self.assertEqual(set(payload["geo"].keys()), {"CG_ADM1_COG-3341__tno1962_1", "CG_ADM1_COG-3341__tno1962_2"})
            self.assertEqual(payload["audit"]["split_clone_safe_copy_count"], 2)
            self.assertEqual(payload["audit"]["collision_candidate_count"], 0)
            self.assertEqual(payload["audit"]["duplicate_raw_name_count"], 1)
            self.assertEqual(payload["audit"]["ambiguous_raw_name_count"], 0)

    def test_cross_base_duplicates_remain_collisions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            scenario_dir = tmp_path / "scenario"
            payload = _build_patch(scenario_dir, {'CG_ADM1_COG-3341__tno1962_1': 'AEF', 'FR_ADM1_0001__tno1962_1': 'FRA'})


            self.assertEqual(payload["geo"], {})
            self.assertEqual(payload["audit"]["collision_candidate_count"], 2)
            self.assertEqual(payload["audit"]["cross_base_collision_count"], 2)
            self.assertEqual(payload["audit"]["duplicate_raw_name_count"], 1)
            self.assertEqual(payload["audit"]["ambiguous_raw_name_count"], 1)
            sample = payload["audit"]["collision_candidates"][0]
            self.assertEqual(len(sample["matching_base_feature_ids"]), 2)


if __name__ == "__main__":
    unittest.main()
