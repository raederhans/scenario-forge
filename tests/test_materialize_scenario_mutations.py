from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from map_builder import config as cfg
from map_builder import scenario_build_session
from map_builder import scenario_geo_locale_materializer
from tools import materialize_scenario_mutations


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _create_scenario_fixture(root: Path, scenario_id: str = "test_scenario") -> Path:
    scenario_dir = root / "data" / "scenarios" / scenario_id
    base = f"data/scenarios/{scenario_id}"
    _write_json(root / "data/scenarios/index.json", {"scenarios": [
        {"scenario_id": scenario_id, "manifest_url": f"{base}/manifest.json"}
    ]})
    _write_json(scenario_dir / "manifest.json", {
        "scenario_id": scenario_id, "countries_url": f"{base}/countries.json",
        "cores_url": f"{base}/cores.by_feature.json",
        "owners_url": f"{base}/owners.by_feature.json", "geo_locale_patch_url": f"{base}/geo_locale_patch.json",
    })
    _write_json(scenario_dir / "countries.json", {"countries": {"AAA": {"tag": "AAA"}, "BBB": {"tag": "BBB"}}})
    assignments = {"AAA-1": "AAA", "BBB-1": "BBB"}
    _write_json(scenario_dir / "owners.by_feature.json", {"owners": assignments, "baseline_hash": "baseline-123"})
    _write_json(scenario_dir / "controllers.by_feature.json", {"controllers": assignments, "baseline_hash": "baseline-123"})
    _write_json(scenario_dir / "cores.by_feature.json", {"cores": {fid: [tag] for fid, tag in assignments.items()}})
    _write_json(scenario_dir / "geo_locale_patch.json", {"version": 1, "scenario_id": scenario_id, "generated_at": "", "geo": {}})
    return scenario_dir


class MaterializeScenarioMutationsTest(unittest.TestCase):
    def test_materialize_political_target_writes_materialized_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = _create_scenario_fixture(root)
            _write_json(scenario_dir / cfg.SCENARIO_CITY_ASSETS_PARTIAL_FILENAME, {"cities": {}})
            _write_json(scenario_dir / cfg.SCENARIO_CAPITAL_DEFAULTS_PARTIAL_FILENAME, {"capitals_by_tag": {}})
            _write_json(scenario_dir / "scenario_mutations.json", {
                "version": 1, "scenario_id": "test_scenario",
                "countries": {"AAA": {"mode": "override", "display_name_en": "Alpha Prime",
                                      "display_name_zh": "阿尔法首都"}},
                "assignments_by_feature_id": {"AAA-1": {"owner": "BBB"}},
            })

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
            geo = {"AAA-1": {"en": "Alpha One", "zh": "阿尔法一"}}
            _write_json(scenario_dir / "scenario_mutations.json", {
                "version": 1, "scenario_id": "tno_1962", "geo_locale": geo,
            })
            checkpoint_dir = root / ".runtime" / "tmp" / "tno_checkpoint"
            checkpoint_dir.mkdir(parents=True, exist_ok=True)
            from tools import patch_tno_1962_bundle as tno_bundle

            def fake_build_geo_locale_stage(scenario_dir_arg: Path, checkpoint_dir_arg: Path, refresh_named_water_snapshot: bool = False) -> None:
                self.assertEqual(scenario_dir_arg, scenario_dir)
                self.assertEqual(checkpoint_dir_arg, checkpoint_dir)
                _write_json(
                    checkpoint_dir_arg / tno_bundle.CHECKPOINT_GEO_LOCALE_FILENAME,
                    {"version": 1, "scenario_id": "tno_1962", "generated_at": "geo-pass", "geo": geo},
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


if __name__ == "__main__":
    unittest.main()
