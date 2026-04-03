from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from map_builder import scenario_publish_service
from tools import publish_scenario_outputs


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _create_scenario_fixture(root: Path, scenario_id: str = "tno_1962") -> Path:
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
    _write_json(scenario_dir / "countries.json", {"countries": {}})
    _write_json(scenario_dir / "owners.by_feature.json", {"owners": {}, "baseline_hash": "baseline-123"})
    _write_json(scenario_dir / "controllers.by_feature.json", {"controllers": {}, "baseline_hash": "baseline-123"})
    _write_json(scenario_dir / "cores.by_feature.json", {"cores": {}, "baseline_hash": "baseline-123"})
    _write_json(scenario_dir / "geo_locale_patch.json", {"version": 1, "scenario_id": scenario_id, "generated_at": "", "geo": {}})
    return scenario_dir


class PublishScenarioOutputsTest(unittest.TestCase):
    def test_publish_geo_locale_target_for_tno_copies_checkpoint_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = _create_scenario_fixture(root)
            checkpoint_dir = root / ".runtime" / "tmp" / "publish_checkpoint"
            checkpoint_dir.mkdir(parents=True, exist_ok=True)
            from tools import patch_tno_1962_bundle as tno_bundle

            _write_json(checkpoint_dir / tno_bundle.CHECKPOINT_RUNTIME_BOOTSTRAP_TOPOLOGY_FILENAME, {"objects": {}})
            _write_json(
                checkpoint_dir / tno_bundle.CHECKPOINT_GEO_LOCALE_FILENAME,
                {"version": 1, "scenario_id": "tno_1962", "generated_at": "publish-pass", "geo": {"AAA-1": {"en": "Alpha One"}}},
            )
            _write_json(checkpoint_dir / tno_bundle.CHECKPOINT_GEO_LOCALE_EN_FILENAME, {"language": "en"})
            _write_json(checkpoint_dir / tno_bundle.CHECKPOINT_GEO_LOCALE_ZH_FILENAME, {"language": "zh"})

            result = publish_scenario_outputs.run_publish_scenario_outputs(
                "tno_1962",
                target="geo-locale",
                root=root,
                checkpoint_dir=checkpoint_dir,
            )

            published_patch = json.loads((scenario_dir / "geo_locale_patch.json").read_text(encoding="utf-8"))
            self.assertEqual(published_patch["generated_at"], "publish-pass")
            self.assertEqual(result["geoLocale"]["publishMode"], "copied_from_checkpoint")

    def test_publish_startup_assets_target_for_tno_copies_checkpoint_bundles(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = _create_scenario_fixture(root)
            checkpoint_dir = root / ".runtime" / "tmp" / "startup_publish_checkpoint"
            checkpoint_dir.mkdir(parents=True, exist_ok=True)
            from tools import patch_tno_1962_bundle as tno_bundle

            _write_json(checkpoint_dir / tno_bundle.CHECKPOINT_RUNTIME_BOOTSTRAP_TOPOLOGY_FILENAME, {"objects": {}})
            _write_json(checkpoint_dir / tno_bundle.CHECKPOINT_GEO_LOCALE_FILENAME, {"version": 1, "scenario_id": "tno_1962", "generated_at": "", "geo": {}})
            _write_json(checkpoint_dir / tno_bundle.CHECKPOINT_GEO_LOCALE_EN_FILENAME, {"language": "en"})
            _write_json(checkpoint_dir / tno_bundle.CHECKPOINT_GEO_LOCALE_ZH_FILENAME, {"language": "zh"})
            _write_json(checkpoint_dir / tno_bundle.CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME, {"language": "en"})
            _write_json(checkpoint_dir / tno_bundle.CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME, {"language": "zh"})
            _write_json(root / "data" / "locales.startup.json", {"locales": {}})
            _write_json(root / "data" / "geo_aliases.startup.json", {"aliases": {}})

            with scenario_publish_service.load_locked_publish_context("tno_1962", root=root) as context:
                result = scenario_publish_service.publish_scenario_outputs_in_locked_context(
                    context,
                    target="startup-assets",
                    root=root,
                    checkpoint_dir=checkpoint_dir,
                )

            self.assertTrue((scenario_dir / tno_bundle.CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME).exists())
            self.assertEqual(result["startupAssets"]["publishMode"], "copied_from_checkpoint")
            self.assertEqual(len(result["startupAssets"]["supportingPaths"]), 2)


if __name__ == "__main__":
    unittest.main()
