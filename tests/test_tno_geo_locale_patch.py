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
    def test_build_patch_writes_locale_specific_variants(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            scenario_dir = tmp_path / "scenario"
            _write_json(
                scenario_dir / "runtime_topology.topo.json",
                {
                    "objects": {
                        "political": {
                            "geometries": [
                                {"id": "FEATURE-1", "properties": {"id": "FEATURE-1", "name": "Pool"}},
                            ]
                        }
                    }
                },
            )
            _write_json(
                scenario_dir / "owners.by_feature.json",
                {
                    "owners": {
                        "FEATURE-1": "AEF",
                    }
                },
            )
            locales_path = tmp_path / "locales.json"
            _write_locale_fixture(locales_path, "Pool", "普尔")
            output_path = scenario_dir / "geo_locale_patch.json"

            payload = build_patch(
                scenario_id="tno_1962",
                scenario_dir=scenario_dir,
                locales_path=locales_path,
                manual_overrides_path=scenario_dir / "missing.manual.json",
                reviewed_exceptions_path=scenario_dir / "missing.reviewed.json",
                output_path=output_path,
            )

            en_payload = json.loads((scenario_dir / "geo_locale_patch.en.json").read_text(encoding="utf-8"))
            zh_payload = json.loads((scenario_dir / "geo_locale_patch.zh.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["geo"]["FEATURE-1"], {"en": "Pool", "zh": "普尔"})
            self.assertEqual(en_payload["language"], "en")
            self.assertEqual(en_payload["geo"]["FEATURE-1"], {"en": "Pool"})
            self.assertEqual(zh_payload["language"], "zh")
            self.assertEqual(zh_payload["geo"]["FEATURE-1"], {"zh": "普尔"})

    def test_manual_override_replaces_data_not_available_feature_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            scenario_dir = tmp_path / "scenario"
            feature_id = "IN_ADM2_76128533B2782141712775"
            _write_json(
                scenario_dir / "runtime_topology.topo.json",
                {
                    "objects": {
                        "political": {
                            "geometries": [
                                {"id": feature_id, "properties": {"id": feature_id, "name": "DATA NOT AVAILABLE"}},
                            ]
                        }
                    }
                },
            )
            _write_json(
                scenario_dir / "owners.by_feature.json",
                {"owners": {feature_id: "RAJ"}},
            )
            _write_json(
                tmp_path / "locales.json",
                {"geo": {"DATA NOT AVAILABLE": {"en": "DATA NOT AVAILABLE", "zh": "数据不可用"}}},
            )
            manual_path = scenario_dir / "geo_name_overrides.manual.json"
            _write_json(
                manual_path,
                {
                    "version": 1,
                    "scenario_id": "tno_1962",
                    "geo": {
                        feature_id: {"en": "Northern Areas", "zh": "北部地区"},
                    },
                },
            )

            payload = build_patch(
                scenario_id="tno_1962",
                scenario_dir=scenario_dir,
                locales_path=tmp_path / "locales.json",
                manual_overrides_path=manual_path,
                reviewed_exceptions_path=scenario_dir / "missing.reviewed.json",
                output_path=scenario_dir / "geo_locale_patch.json",
            )

            en_payload = json.loads((scenario_dir / "geo_locale_patch.en.json").read_text(encoding="utf-8"))
            zh_payload = json.loads((scenario_dir / "geo_locale_patch.zh.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["geo"][feature_id], {"en": "Northern Areas", "zh": "北部地区"})
            self.assertEqual(en_payload["geo"][feature_id], {"en": "Northern Areas"})
            self.assertEqual(zh_payload["geo"][feature_id], {"zh": "北部地区"})
            self.assertEqual(payload["audit"]["manual_feature_overrides"], 1)

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
                reviewed_exceptions_path=scenario_dir / "missing.reviewed.json",
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
                reviewed_exceptions_path=scenario_dir / "missing.reviewed.json",
                output_path=scenario_dir / "geo_locale_patch.json",
            )

            self.assertEqual(payload["geo"], {})
            self.assertEqual(payload["audit"]["collision_candidate_count"], 2)
            self.assertEqual(payload["audit"]["cross_base_collision_count"], 2)
            self.assertEqual(payload["audit"]["duplicate_raw_name_count"], 1)
            self.assertEqual(payload["audit"]["ambiguous_raw_name_count"], 1)
            sample = payload["audit"]["collision_candidates"][0]
            self.assertEqual(len(sample["matching_base_feature_ids"]), 2)

    def test_reviewed_collision_exceptions_are_tracked_but_do_not_remain_unresolved(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            scenario_dir = tmp_path / "scenario"
            _write_json(
                scenario_dir / "runtime_topology.topo.json",
                {
                    "objects": {
                        "political": {
                            "geometries": [
                                {"id": "F-1", "properties": {"id": "F-1", "name": "Pool"}},
                                {"id": "F-2", "properties": {"id": "F-2", "name": "Pool"}},
                            ]
                        }
                    }
                },
            )
            _write_json(
                scenario_dir / "owners.by_feature.json",
                {
                    "owners": {
                        "F-1": "AAA",
                        "F-2": "BBB",
                    }
                },
            )
            _write_locale_fixture(tmp_path / "locales.json", "Pool", "泳池")
            reviewed_path = scenario_dir / "geo_locale_reviewed_exceptions.json"
            _write_json(
                reviewed_path,
                {
                    "version": 1,
                    "scenario_id": "tno_1962",
                    "reviewed_collision_feature_ids": ["F-1", "F-2"],
                    "excluded_feature_prefixes": [],
                },
            )

            payload = build_patch(
                scenario_id="tno_1962",
                scenario_dir=scenario_dir,
                locales_path=tmp_path / "locales.json",
                manual_overrides_path=scenario_dir / "missing.manual.json",
                reviewed_exceptions_path=reviewed_path,
                output_path=scenario_dir / "geo_locale_patch.json",
            )

            self.assertEqual(payload["audit"]["collision_candidate_count"], 0)
            self.assertEqual(payload["audit"]["reviewed_collision_exception_count"], 2)
            self.assertEqual(len(payload["audit"]["reviewed_collision_candidates"]), 2)

    def test_excluded_feature_prefixes_skip_synthetic_features_from_locale_decision_surface(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            scenario_dir = tmp_path / "scenario"
            _write_json(
                scenario_dir / "runtime_topology.topo.json",
                {
                    "objects": {
                        "political": {
                            "geometries": [
                                {
                                    "id": "ATLSEA_FILL_demo_1",
                                    "properties": {"id": "ATLSEA_FILL_demo_1", "name": "Synthetic Sea Fill"},
                                },
                                {"id": "FEATURE-1", "properties": {"id": "FEATURE-1", "name": "Pool"}},
                            ]
                        }
                    }
                },
            )
            _write_json(
                scenario_dir / "owners.by_feature.json",
                {
                    "owners": {
                        "ATLSEA_FILL_demo_1": "ATL",
                        "FEATURE-1": "AAA",
                    }
                },
            )
            _write_locale_fixture(tmp_path / "locales.json", "Pool", "泳池")
            reviewed_path = scenario_dir / "geo_locale_reviewed_exceptions.json"
            _write_json(
                reviewed_path,
                {
                    "version": 1,
                    "scenario_id": "tno_1962",
                    "reviewed_collision_feature_ids": [],
                    "excluded_feature_prefixes": ["ATLSEA_FILL_"],
                },
            )

            payload = build_patch(
                scenario_id="tno_1962",
                scenario_dir=scenario_dir,
                locales_path=tmp_path / "locales.json",
                manual_overrides_path=scenario_dir / "missing.manual.json",
                reviewed_exceptions_path=reviewed_path,
                output_path=scenario_dir / "geo_locale_patch.json",
            )

            self.assertEqual(payload["geo"]["FEATURE-1"], {"en": "Pool", "zh": "泳池"})
            self.assertEqual(payload["audit"]["excluded_feature_count"], 1)
            self.assertEqual(payload["audit"]["omitted_feature_count"], 0)
            self.assertEqual(payload["audit"]["excluded_features"][0]["feature_id"], "ATLSEA_FILL_demo_1")

    def test_reviewed_exceptions_reject_mismatched_scenario_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            scenario_dir = tmp_path / "scenario"
            _write_json(
                scenario_dir / "runtime_topology.topo.json",
                {
                    "objects": {
                        "political": {
                            "geometries": [
                                {"id": "FEATURE-1", "properties": {"id": "FEATURE-1", "name": "Pool"}},
                            ]
                        }
                    }
                },
            )
            _write_json(
                scenario_dir / "owners.by_feature.json",
                {
                    "owners": {
                        "FEATURE-1": "AEF",
                    }
                },
            )
            _write_locale_fixture(tmp_path / "locales.json", "Pool", "泡池")
            reviewed_path = scenario_dir / "geo_locale_reviewed_exceptions.json"
            _write_json(
                reviewed_path,
                {
                    "version": 1,
                    "scenario_id": "other_scenario",
                    "reviewed_collision_feature_ids": [],
                    "excluded_feature_prefixes": [],
                },
            )

            with self.assertRaises(ValueError) as exc_info:
                build_patch(
                    scenario_id="tno_1962",
                    scenario_dir=scenario_dir,
                    locales_path=tmp_path / "locales.json",
                    manual_overrides_path=scenario_dir / "missing.manual.json",
                    reviewed_exceptions_path=reviewed_path,
                    output_path=scenario_dir / "geo_locale_patch.json",
                )

            self.assertIn("must target scenario `tno_1962`", str(exc_info.exception))


if __name__ == "__main__":
    unittest.main()
