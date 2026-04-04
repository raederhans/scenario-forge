from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from map_builder import config as cfg
from map_builder import scenario_build_session
from map_builder import scenario_district_groups_service
from map_builder import scenario_geo_locale_materializer
from map_builder import scenario_materialization_service as service
from map_builder.scenario_build_session import SCENARIO_BUILD_STATE_FILENAME


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
                "AAA": {"tag": "AAA", "display_name": "Alpha", "display_name_en": "Alpha", "display_name_zh": "阿尔法", "color_hex": "#123456"},
                "BBB": {"tag": "BBB", "display_name": "Beta", "display_name_en": "Beta", "display_name_zh": "贝塔", "color_hex": "#654321"},
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


class ScenarioMaterializationServiceTest(unittest.TestCase):
    def test_geo_locale_materializer_no_longer_imports_dev_server_registry(self) -> None:
        source = Path(scenario_geo_locale_materializer.__file__).read_text(encoding="utf-8")
        self.assertNotIn("from tools import dev_server", source)

    def test_apply_mutation_and_materialize_in_locked_context_materializes_political_patch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = _create_scenario_fixture(root)

            with service.load_locked_materialization_context("test_scenario", root=root) as context:
                result = service.apply_mutation_and_materialize_in_locked_context(
                    context,
                    mutation_patch={
                        "assignments_by_feature_id": {
                            "AAA-1": {"owner": "BBB"},
                        }
                    },
                    target="political",
                    root=root,
                )

            owners_payload = json.loads((scenario_dir / "owners.by_feature.json").read_text(encoding="utf-8"))
            self.assertEqual(owners_payload["owners"]["AAA-1"], "BBB")
            self.assertEqual(
                result["political"]["materialized"]["manualPayload"]["assignments"]["AAA-1"]["owner"],
                "BBB",
            )

    def test_apply_mutation_and_materialize_in_locked_context_preserves_local_only_manual_catalog_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = _create_scenario_fixture(root)
            manifest_path = scenario_dir / "manifest.json"
            manifest_payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest_payload["releasable_catalog_url"] = "data/releasables/test_scenario.source.catalog.json"
            _write_json(manifest_path, manifest_payload)
            _write_json(
                root / "data" / "releasables" / "test_scenario.source.catalog.json",
                {
                    "version": 1,
                    "catalog_id": "test_scenario.source",
                    "generated_at": "source-pass",
                    "scenario_ids": ["test_scenario"],
                    "entries": [
                        {
                            "tag": "SRC",
                            "display_name": "Source Release",
                            "display_name_en": "Source Release",
                            "display_name_zh": "Source Release Zh",
                            "color_hex": "#111111",
                            "entry_kind": "releasable",
                            "scenario_ids": ["test_scenario"],
                            "scenario_only": True,
                            "allow_manual_overlay": True,
                            "preset_source": {"type": "feature_ids", "name": "", "group_ids": [], "feature_ids": ["AAA-1"]},
                            "boundary_variants": [],
                            "parent_owner_tag": "AAA",
                            "parent_owner_tags": ["AAA"],
                        }
                    ],
                },
            )
            _write_json(
                scenario_dir / "releasable_catalog.manual.json",
                {
                    "version": 1,
                    "catalog_id": "test_scenario.manual",
                    "generated_at": "local-pass",
                    "scenario_ids": ["test_scenario"],
                    "entries": [
                        {
                            "tag": "MANUAL",
                            "display_name": "Manual",
                            "display_name_en": "Manual",
                            "display_name_zh": "Manual Zh",
                            "color_hex": "#222222",
                            "entry_kind": "releasable",
                            "scenario_ids": ["test_scenario"],
                            "scenario_only": True,
                            "allow_manual_overlay": True,
                            "preset_source": {"type": "feature_ids", "name": "", "group_ids": [], "feature_ids": ["BBB-1"]},
                            "boundary_variants": [],
                            "parent_owner_tag": "BBB",
                            "parent_owner_tags": ["BBB"],
                        }
                    ],
                },
            )

            with service.load_locked_materialization_context("test_scenario", root=root) as context:
                result = service.apply_mutation_and_materialize_in_locked_context(
                    context,
                    mutation_patch={
                        "countries": {
                            "AAA": {
                                "display_name_en": "Alpha Prime",
                                "display_name_zh": "Alpha Prime Zh",
                                "parent_owner_tag": "BBB",
                            }
                        }
                    },
                    target="political",
                    root=root,
                )

            catalog_payload = json.loads((scenario_dir / "releasable_catalog.manual.json").read_text(encoding="utf-8"))
            self.assertEqual(
                [entry["tag"] for entry in catalog_payload["entries"]],
                ["SRC", "MANUAL", "AAA"],
            )
            self.assertEqual(
                result["political"]["materialized"]["catalogPayload"]["entries"][1]["tag"],
                "MANUAL",
            )

    def test_materialize_in_locked_context_materializes_geo_locale_patch(self) -> None:
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
            checkpoint_dir = root / ".runtime" / "tmp" / "service_checkpoint"
            checkpoint_dir.mkdir(parents=True, exist_ok=True)
            from tools import patch_tno_1962_bundle as tno_bundle

            def fake_build_geo_locale_stage(scenario_dir_arg: Path, checkpoint_dir_arg: Path, refresh_named_water_snapshot: bool = False) -> None:
                _write_json(
                    checkpoint_dir_arg / tno_bundle.CHECKPOINT_GEO_LOCALE_FILENAME,
                    {"version": 1, "scenario_id": "tno_1962", "generated_at": "service-pass", "geo": {"AAA-1": {"en": "Alpha One", "zh": "阿尔法一"}}},
                )
                _write_json(checkpoint_dir_arg / tno_bundle.CHECKPOINT_GEO_LOCALE_EN_FILENAME, {"language": "en"})
                _write_json(checkpoint_dir_arg / tno_bundle.CHECKPOINT_GEO_LOCALE_ZH_FILENAME, {"language": "zh"})
                _write_json(checkpoint_dir_arg / tno_bundle.CHECKPOINT_RUNTIME_BOOTSTRAP_TOPOLOGY_FILENAME, {"objects": {}})

            def fake_build_startup_assets_stage(scenario_dir_arg: Path, checkpoint_dir_arg: Path, refresh_named_water_snapshot: bool = False) -> None:
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
                with service.load_locked_materialization_context("tno_1962", root=root) as context:
                    result = service.materialize_in_locked_context(
                        context,
                        target="geo-locale",
                        root=root,
                    )

            manual_payload = json.loads((scenario_dir / "geo_name_overrides.manual.json").read_text(encoding="utf-8"))
            patch_payload = json.loads((scenario_dir / "geo_locale_patch.json").read_text(encoding="utf-8"))
            build_state_payload = json.loads((checkpoint_dir / SCENARIO_BUILD_STATE_FILENAME).read_text(encoding="utf-8"))
            self.assertEqual(manual_payload["geo"]["AAA-1"]["en"], "Alpha One")
            self.assertEqual(patch_payload["generated_at"], "")
            self.assertEqual(result["geoLocale"]["materialized"]["buildMode"], "in_process")
            self.assertEqual(result["geoLocale"]["materialized"]["checkpointDir"], str(checkpoint_dir))
            self.assertEqual(build_state_payload["snapshot_hash"], result["geoLocale"]["materialized"]["snapshotHash"])
            self.assertIn("geo-locale", build_state_payload["stage_outputs"])

    def test_build_district_groups_payload_in_context_normalizes_mutation_payload(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _create_scenario_fixture(root)

            with service.load_locked_materialization_context("test_scenario", root=root) as context:
                payload = scenario_district_groups_service.build_district_groups_payload_in_context(
                    context,
                    {
                        "district_groups": {
                            "aaa": {
                                "districts": {
                                    "berlin": {
                                    "district_id": "berlin",
                                        "name_en": "Berlin",
                                        "name_zh": "柏林",
                                        "feature_ids": ["AAA-1"],
                                    }
                                }
                            }
                        }
                    },
                    root=root,
                )

            self.assertEqual(payload["tags"]["AAA"]["tag"], "AAA")
            self.assertEqual(
                payload["tags"]["AAA"]["districts"]["berlin"]["feature_ids"],
                ["AAA-1"],
            )


if __name__ == "__main__":
    unittest.main()
