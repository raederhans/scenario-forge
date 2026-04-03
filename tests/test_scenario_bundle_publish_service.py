from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from map_builder import scenario_bundle_publish_service


class ScenarioBundlePublishServiceTest(unittest.TestCase):
    def test_publish_scenario_data_scope_runs_strict_checks_before_publish(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            checkpoint_dir.mkdir(parents=True, exist_ok=True)

            ensure_offline = Mock()
            validate_geo_locale = Mock()
            require_startup = Mock()
            detect_manual_sync = Mock(return_value={"has_drift": False})
            publish_bundle = Mock()

            with patch.object(
                scenario_bundle_publish_service.scenario_bundle_platform,
                "validate_strict_publish_bundle",
            ) as strict_validate:
                result = scenario_bundle_publish_service.publish_scenario_build_in_locked_session(
                    scenario_dir,
                    checkpoint_dir,
                    publish_scope="scenario_data",
                    manual_sync_policy="backup-continue",
                    scenario_id="tno_1962",
                    scenario_data_scope="scenario_data",
                    all_scope="all",
                    manual_source_filenames={
                        "scenario_manual_overrides": "scenario_manual_overrides.json",
                        "geo_name_overrides": "geo_name_overrides.manual.json",
                    },
                    validate_publish_bundle_dir=lambda path: [],
                    ensure_publish_target_offline=ensure_offline,
                    validate_geo_locale_checkpoint=validate_geo_locale,
                    require_startup_stage_checkpoints=require_startup,
                    detect_unsynced_manual_edits=detect_manual_sync,
                    publish_checkpoint_bundle=publish_bundle,
                    load_checkpoint_json=Mock(),
                    write_json=Mock(),
                    resolve_publish_filenames=lambda scope: ["countries.json", "owners.by_feature.json"],
                )

            ensure_offline.assert_called_once_with(scenario_dir)
            strict_validate.assert_called_once()
            validate_geo_locale.assert_called_once_with(
                checkpoint_dir,
                scenario_dir / "geo_name_overrides.manual.json",
            )
            require_startup.assert_called_once_with(checkpoint_dir)
            detect_manual_sync.assert_called_once()
            publish_bundle.assert_called_once()
            self.assertEqual(result["publishScope"], "scenario_data")
            self.assertEqual(result["publishedFiles"], ["countries.json", "owners.by_feature.json"])
            self.assertIn("manualSyncReport", result)

    def test_publish_polar_runtime_scope_skips_scenario_data_guards(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            checkpoint_dir.mkdir(parents=True, exist_ok=True)

            ensure_offline = Mock()
            validate_geo_locale = Mock()
            require_startup = Mock()
            detect_manual_sync = Mock()
            publish_bundle = Mock()

            with patch.object(
                scenario_bundle_publish_service.scenario_bundle_platform,
                "validate_strict_publish_bundle",
            ) as strict_validate:
                result = scenario_bundle_publish_service.publish_scenario_build_in_locked_session(
                    scenario_dir,
                    checkpoint_dir,
                    publish_scope="polar_runtime",
                    manual_sync_policy="backup-continue",
                    scenario_id="tno_1962",
                    scenario_data_scope="scenario_data",
                    all_scope="all",
                    manual_source_filenames={"scenario_manual_overrides": "scenario_manual_overrides.json"},
                    validate_publish_bundle_dir=lambda path: [],
                    ensure_publish_target_offline=ensure_offline,
                    validate_geo_locale_checkpoint=validate_geo_locale,
                    require_startup_stage_checkpoints=require_startup,
                    detect_unsynced_manual_edits=detect_manual_sync,
                    publish_checkpoint_bundle=publish_bundle,
                    load_checkpoint_json=Mock(),
                    write_json=Mock(),
                    resolve_publish_filenames=lambda scope: ["runtime_topology.topo.json"],
                )

            ensure_offline.assert_not_called()
            strict_validate.assert_not_called()
            validate_geo_locale.assert_not_called()
            require_startup.assert_not_called()
            detect_manual_sync.assert_not_called()
            publish_bundle.assert_called_once()
            self.assertEqual(result["publishedFiles"], ["runtime_topology.topo.json"])
            self.assertNotIn("manualSyncReport", result)


if __name__ == "__main__":
    unittest.main()
