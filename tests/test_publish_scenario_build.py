from __future__ import annotations

import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import patch

from tools import publish_scenario_build


class PublishScenarioBuildCliTest(unittest.TestCase):
    def test_run_publish_scenario_build_uses_tno_locks_and_service(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            checkpoint_dir.mkdir(parents=True, exist_ok=True)

            with (
                patch.object(
                    publish_scenario_build.tno_bundle,
                    "_scenario_build_session_lock",
                    return_value=nullcontext(),
                ) as scenario_lock_mock,
                patch.object(
                    publish_scenario_build.tno_bundle,
                    "_checkpoint_build_lock",
                    return_value=nullcontext(),
                ) as checkpoint_lock_mock,
                patch.object(
                    publish_scenario_build,
                    "publish_scenario_build_in_locked_session",
                    return_value={"publishScope": "scenario_data"},
                ) as publish_mock,
            ):
                result = publish_scenario_build.run_publish_scenario_build(
                    scenario_dir,
                    checkpoint_dir,
                    publish_scope="scenario_data",
                    manual_sync_policy="backup-continue",
                )

            scenario_lock_mock.assert_called_once_with(scenario_dir)
            checkpoint_lock_mock.assert_called_once_with(
                checkpoint_dir,
                stage=publish_scenario_build.tno_bundle.STAGE_WRITE_BUNDLE,
            )
            publish_mock.assert_called_once()
            self.assertEqual(result["publishScope"], "scenario_data")

    def test_run_publish_scenario_build_requires_existing_checkpoint_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "missing-checkpoint"
            scenario_dir.mkdir(parents=True, exist_ok=True)

            with self.assertRaisesRegex(FileNotFoundError, "Missing checkpoint directory"):
                publish_scenario_build.run_publish_scenario_build(
                    scenario_dir,
                    checkpoint_dir,
                    publish_scope="polar_runtime",
                    manual_sync_policy="backup-continue",
                )


if __name__ == "__main__":
    unittest.main()
