from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from map_builder import config as cfg
from map_builder import scenario_build_session
from map_builder import scenario_geo_locale_materializer
from tools import dev_server
from tools import materialize_scenario_mutations
from tools import publish_scenario_outputs


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _create_scenario_fixture(root: Path, scenario_id: str = "test_scenario") -> Path:
    scenario_dir = root / "data" / "scenarios" / scenario_id
    _write_json(
        root / "data" / "scenarios" / "index.json",
        {
            "version": 1,
            "default_scenario_id": scenario_id,
            "scenarios": [
                {
                    "scenario_id": scenario_id,
                    "display_name": "Test Scenario",
                    "manifest_url": f"data/scenarios/{scenario_id}/manifest.json",
                }
            ],
        },
    )
    _write_json(
        scenario_dir / "manifest.json",
        {
            "scenario_id": scenario_id,
            "display_name": "Test Scenario",
            "baseline_hash": "baseline-123",
            "countries_url": f"data/scenarios/{scenario_id}/countries.json",
            "owners_url": f"data/scenarios/{scenario_id}/owners.by_feature.json",
            "controllers_url": f"data/scenarios/{scenario_id}/controllers.by_feature.json",
            "cores_url": f"data/scenarios/{scenario_id}/cores.by_feature.json",
            "geo_locale_patch_url": f"data/scenarios/{scenario_id}/geo_locale_patch.json",
        },
    )
    _write_json(
        scenario_dir / "countries.json",
        {
            "countries": {
                "AAA": {"tag": "AAA"},
                "BBB": {"tag": "BBB"},
            }
        },
    )
    _write_json(
        scenario_dir / "owners.by_feature.json",
        {
            "owners": {
                "AAA-1": "AAA",
                "BBB-1": "BBB",
            },
            "baseline_hash": "baseline-123",
        },
    )
    _write_json(
        scenario_dir / "controllers.by_feature.json",
        {
            "controllers": {
                "AAA-1": "AAA",
                "BBB-1": "BBB",
            },
            "baseline_hash": "baseline-123",
        },
    )
    _write_json(
        scenario_dir / "cores.by_feature.json",
        {
            "cores": {
                "AAA-1": ["AAA"],
                "BBB-1": ["BBB"],
            },
            "baseline_hash": "baseline-123",
        },
    )
    _write_json(
        scenario_dir / "geo_locale_patch.json",
        {
            "version": 1,
            "scenario_id": scenario_id,
            "generated_at": "",
            "geo": {},
        },
    )
    _write_json(
        scenario_dir / cfg.SCENARIO_CITY_ASSETS_PARTIAL_FILENAME,
        {
            "version": 1,
            "scenario_id": scenario_id,
            "generated_at": "",
            "cities": {},
            "audit": {
                "renamed_city_count": 0,
                "name_conflict_count": 0,
                "unresolved_city_rename_count": 0,
                "name_conflicts": [],
                "unresolved_city_renames": [],
            },
        },
    )
    _write_json(
        scenario_dir / cfg.SCENARIO_CAPITAL_DEFAULTS_PARTIAL_FILENAME,
        {
            "version": 1,
            "scenario_id": scenario_id,
            "generated_at": "",
            "capitals_by_tag": {},
            "capital_city_hints": {},
            "audit": {},
        },
    )
    return scenario_dir


class MaterializeScenarioMutationsTest(unittest.TestCase):
    def test_materialize_political_target_writes_materialized_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = _create_scenario_fixture(root)
            _write_json(
                scenario_dir / "scenario_mutations.json",
                {
                    "version": 1,
                    "scenario_id": "test_scenario",
                    "generated_at": "",
                    "countries": {
                        "AAA": {
                            "mode": "override",
                            "display_name_en": "Alpha Prime",
                            "display_name_zh": "阿尔法首都",
                        }
                    },
                    "assignments_by_feature_id": {
                        "AAA-1": {"owner": "BBB"},
                    },
                    "capitals": {},
                    "geo_locale": {},
                    "tags": {},
                    "district_groups": {},
                },
            )

            result = materialize_scenario_mutations.materialize_scenario_mutations(
                "test_scenario",
                target="political",
                root=root,
            )

            countries_payload = json.loads((scenario_dir / "countries.json").read_text(encoding="utf-8"))
            owners_payload = json.loads((scenario_dir / "owners.by_feature.json").read_text(encoding="utf-8"))
            self.assertEqual(countries_payload["countries"]["AAA"]["display_name_en"], "Alpha Prime")
            self.assertEqual(owners_payload["owners"]["AAA-1"], "BBB")
            self.assertEqual(result["political"]["countriesPath"], "data/scenarios/test_scenario/countries.json")

    def test_materialize_geo_locale_target_for_tno_runs_in_process_without_publishing_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = _create_scenario_fixture(root, scenario_id="tno_1962")
            _write_json(
                scenario_dir / "scenario_mutations.json",
                {
                    "version": 1,
                    "scenario_id": "tno_1962",
                    "generated_at": "",
                    "countries": {},
                    "assignments_by_feature_id": {},
                    "capitals": {},
                    "geo_locale": {
                        "AAA-1": {"en": "Alpha One", "zh": "阿尔法一"},
                    },
                    "tags": {},
                    "district_groups": {},
                },
            )
            checkpoint_dir = root / ".runtime" / "tmp" / "tno_checkpoint"
            checkpoint_dir.mkdir(parents=True, exist_ok=True)
            from tools import patch_tno_1962_bundle as tno_bundle

            def fake_build_geo_locale_stage(scenario_dir_arg: Path, checkpoint_dir_arg: Path, refresh_named_water_snapshot: bool = False) -> None:
                self.assertEqual(scenario_dir_arg, scenario_dir)
                self.assertEqual(checkpoint_dir_arg, checkpoint_dir)
                _write_json(
                    checkpoint_dir_arg / tno_bundle.CHECKPOINT_GEO_LOCALE_FILENAME,
                    {
                        "version": 1,
                        "scenario_id": "tno_1962",
                        "generated_at": "geo-pass",
                        "geo": {"AAA-1": {"en": "Alpha One", "zh": "阿尔法一"}},
                    },
                )
                _write_json(checkpoint_dir_arg / tno_bundle.CHECKPOINT_GEO_LOCALE_EN_FILENAME, {"language": "en"})
                _write_json(checkpoint_dir_arg / tno_bundle.CHECKPOINT_GEO_LOCALE_ZH_FILENAME, {"language": "zh"})
                _write_json(checkpoint_dir_arg / tno_bundle.CHECKPOINT_RUNTIME_BOOTSTRAP_TOPOLOGY_FILENAME, {"objects": {}})

            def fake_build_startup_assets_stage(scenario_dir_arg: Path, checkpoint_dir_arg: Path, refresh_named_water_snapshot: bool = False) -> None:
                self.assertEqual(scenario_dir_arg, scenario_dir)
                self.assertEqual(checkpoint_dir_arg, checkpoint_dir)
                _write_json(checkpoint_dir_arg / tno_bundle.CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME, {"language": "en"})
                _write_json(checkpoint_dir_arg / tno_bundle.CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME, {"language": "zh"})

            with (
                mock.patch.object(
                    scenario_geo_locale_materializer,
                    "ensure_scenario_build_session",
                    side_effect=lambda **kwargs: scenario_build_session.ensure_scenario_build_session(
                        scenario_id="tno_1962",
                        scenario_dir=scenario_dir,
                        root=root,
                        build_dir=checkpoint_dir,
                    ),
                ),
                mock.patch.object(tno_bundle, "build_geo_locale_stage", side_effect=fake_build_geo_locale_stage),
                mock.patch.object(tno_bundle, "build_startup_assets_stage", side_effect=fake_build_startup_assets_stage),
            ):
                result = materialize_scenario_mutations.materialize_scenario_mutations(
                    "tno_1962",
                    target="geo-locale",
                    root=root,
                )

            manual_payload = json.loads((scenario_dir / "geo_name_overrides.manual.json").read_text(encoding="utf-8"))
            published_patch = json.loads((scenario_dir / "geo_locale_patch.json").read_text(encoding="utf-8"))
            self.assertEqual(manual_payload["geo"]["AAA-1"]["en"], "Alpha One")
            self.assertEqual(published_patch["generated_at"], "")
            self.assertEqual(result["geoLocale"]["buildMode"], "in_process")
            self.assertEqual(result["geoLocale"]["checkpointDir"], str(checkpoint_dir))
            self.assertTrue((checkpoint_dir / tno_bundle.CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME).exists())
            self.assertFalse((scenario_dir / tno_bundle.CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME).exists())

    def test_materialize_district_groups_target_writes_derived_payload(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = _create_scenario_fixture(root)
            _write_json(
                scenario_dir / "scenario_mutations.json",
                {
                    "version": 1,
                    "scenario_id": "test_scenario",
                    "generated_at": "",
                    "countries": {},
                    "assignments_by_feature_id": {},
                    "capitals": {},
                    "geo_locale": {},
                    "tags": {},
                    "district_groups": {
                        "AAA": {
                            "tag": "AAA",
                            "districts": {
                                "alpha": {
                                    "district_id": "alpha",
                                    "name_en": "Alpha District",
                                    "name_zh": "阿尔法区",
                                    "feature_ids": ["AAA-1"],
                                }
                            },
                        }
                    },
                },
            )

            result = materialize_scenario_mutations.materialize_scenario_mutations(
                "test_scenario",
                target="district-groups",
                root=root,
            )

            district_groups_payload = json.loads((scenario_dir / "district_groups.manual.json").read_text(encoding="utf-8"))
            manifest_payload = json.loads((scenario_dir / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(
                district_groups_payload["tags"]["AAA"]["districts"]["alpha"]["feature_ids"],
                ["AAA-1"],
            )
            self.assertEqual(
                manifest_payload["district_groups_url"],
                "data/scenarios/test_scenario/district_groups.manual.json",
            )
            self.assertEqual(result["districtGroups"]["filePath"], "data/scenarios/test_scenario/district_groups.manual.json")

    def test_publish_geo_locale_target_for_tno_copies_checkpoint_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = _create_scenario_fixture(root, scenario_id="tno_1962")
            checkpoint_dir = root / ".runtime" / "tmp" / "tno_publish_checkpoint"
            checkpoint_dir.mkdir(parents=True, exist_ok=True)
            from tools import patch_tno_1962_bundle as tno_bundle

            _write_json(
                checkpoint_dir / tno_bundle.CHECKPOINT_GEO_LOCALE_FILENAME,
                {
                    "version": 1,
                    "scenario_id": "tno_1962",
                    "generated_at": "publish-pass",
                    "geo": {"AAA-1": {"en": "Alpha One", "zh": "闃垮皵娉曚竴"}},
                },
            )
            _write_json(checkpoint_dir / tno_bundle.CHECKPOINT_GEO_LOCALE_EN_FILENAME, {"language": "en"})
            _write_json(checkpoint_dir / tno_bundle.CHECKPOINT_GEO_LOCALE_ZH_FILENAME, {"language": "zh"})
            _write_json(checkpoint_dir / tno_bundle.CHECKPOINT_RUNTIME_BOOTSTRAP_TOPOLOGY_FILENAME, {"objects": {}})

            result = publish_scenario_outputs.run_publish_scenario_outputs(
                "tno_1962",
                target="geo-locale",
                root=root,
                checkpoint_dir=checkpoint_dir,
            )

            published_patch = json.loads((scenario_dir / "geo_locale_patch.json").read_text(encoding="utf-8"))
            self.assertEqual(published_patch["generated_at"], "publish-pass")
            self.assertEqual(result["geoLocale"]["publishMode"], "copied_from_checkpoint")


if __name__ == "__main__":
    unittest.main()
