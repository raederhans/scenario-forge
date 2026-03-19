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
    _write_json(
        locales_path,
        {
            "geo": {
                raw_name: {
                    "en": raw_name,
                    "zh": zh_name,
                }
            }
        },
    )


class TnoGeoLocalePatchTest(unittest.TestCase):
    def test_split_clone_duplicates_are_safe_copied(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            scenario_dir = tmp_path / "scenario"
            _write_json(
                scenario_dir / "runtime_topology.topo.json",
                {
                    "objects": {
                        "political": {
                            "geometries": [
                                {"id": "CG_ADM1_COG-3341__tno1962_1", "properties": {"id": "CG_ADM1_COG-3341__tno1962_1", "name": "Pool"}},
                                {"id": "CG_ADM1_COG-3341__tno1962_2", "properties": {"id": "CG_ADM1_COG-3341__tno1962_2", "name": "Pool"}},
                            ]
                        }
                    }
                },
            )
            _write_json(
                scenario_dir / "owners.by_feature.json",
                {
                    "owners": {
                        "CG_ADM1_COG-3341__tno1962_1": "AEF",
                        "CG_ADM1_COG-3341__tno1962_2": "AEF",
                    }
                },
            )
            locales_path = tmp_path / "locales.json"
            _write_locale_fixture(locales_path, "Pool", "普尔")

            payload = build_patch(
                scenario_id="tno_1962",
                scenario_dir=scenario_dir,
                locales_path=locales_path,
                manual_overrides_path=scenario_dir / "missing.manual.json",
                output_path=scenario_dir / "geo_locale_patch.json",
            )

            self.assertEqual(set(payload["geo"].keys()), {"CG_ADM1_COG-3341__tno1962_1", "CG_ADM1_COG-3341__tno1962_2"})
            self.assertEqual(payload["audit"]["split_clone_safe_copy_count"], 2)
            self.assertEqual(payload["audit"]["collision_candidate_count"], 0)
            self.assertEqual(payload["audit"]["duplicate_raw_name_count"], 1)
            self.assertEqual(payload["audit"]["ambiguous_raw_name_count"], 0)

    def test_cross_base_duplicates_remain_collisions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            scenario_dir = tmp_path / "scenario"
            _write_json(
                scenario_dir / "runtime_topology.topo.json",
                {
                    "objects": {
                        "political": {
                            "geometries": [
                                {"id": "CG_ADM1_COG-3341__tno1962_1", "properties": {"id": "CG_ADM1_COG-3341__tno1962_1", "name": "Pool"}},
                                {"id": "FR_ADM1_0001__tno1962_1", "properties": {"id": "FR_ADM1_0001__tno1962_1", "name": "Pool"}},
                            ]
                        }
                    }
                },
            )
            _write_json(
                scenario_dir / "owners.by_feature.json",
                {
                    "owners": {
                        "CG_ADM1_COG-3341__tno1962_1": "AEF",
                        "FR_ADM1_0001__tno1962_1": "FRA",
                    }
                },
            )
            locales_path = tmp_path / "locales.json"
            _write_locale_fixture(locales_path, "Pool", "普尔")

            payload = build_patch(
                scenario_id="tno_1962",
                scenario_dir=scenario_dir,
                locales_path=locales_path,
                manual_overrides_path=scenario_dir / "missing.manual.json",
                output_path=scenario_dir / "geo_locale_patch.json",
            )

            self.assertEqual(payload["geo"], {})
            self.assertEqual(payload["audit"]["collision_candidate_count"], 2)
            self.assertEqual(payload["audit"]["cross_base_collision_count"], 2)
            self.assertEqual(payload["audit"]["duplicate_raw_name_count"], 1)
            self.assertEqual(payload["audit"]["ambiguous_raw_name_count"], 1)
            sample = payload["audit"]["collision_candidates"][0]
            self.assertEqual(len(sample["matching_base_feature_ids"]), 2)


if __name__ == "__main__":
    unittest.main()
