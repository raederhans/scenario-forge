from __future__ import annotations

import tempfile
import threading
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import patch

from map_builder.scenario_locks import scenario_build_lock
from tools import publish_scenario_build


class PublishScenarioBuildCliTest(unittest.TestCase):
    def test_scenario_build_lock_inherits_same_thread_transaction_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "data" / "scenarios" / "tno_1962"
            scenario_dir.mkdir(parents=True, exist_ok=True)

            with scenario_build_lock(
                root=root,
                scenario_id="tno_1962",
                scenario_dir=scenario_dir,
                holder="test",
            ):
                with scenario_build_lock(
                    root=root,
                    scenario_id="tno_1962",
                    scenario_dir=scenario_dir,
                    holder="test",
                ):
                    self.assertTrue(True)

    def test_scenario_build_lock_allows_same_thread_same_transaction_reentry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "data" / "scenarios" / "tno_1962"
            scenario_dir.mkdir(parents=True, exist_ok=True)

            with scenario_build_lock(
                root=root,
                scenario_id="tno_1962",
                scenario_dir=scenario_dir,
                holder="test",
                transaction_id="tx-1",
            ):
                with scenario_build_lock(
                    root=root,
                    scenario_id="tno_1962",
                    scenario_dir=scenario_dir,
                    holder="test",
                    transaction_id="tx-1",
                ):
                    self.assertTrue(True)

    def test_scenario_build_lock_rejects_same_thread_different_transaction(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "data" / "scenarios" / "tno_1962"
            scenario_dir.mkdir(parents=True, exist_ok=True)

            with scenario_build_lock(
                root=root,
                scenario_id="tno_1962",
                scenario_dir=scenario_dir,
                holder="test",
                transaction_id="tx-1",
            ):
                with self.assertRaisesRegex(RuntimeError, "another scenario writer is active"):
                    with scenario_build_lock(
                        root=root,
                        scenario_id="tno_1962",
                        scenario_dir=scenario_dir,
                        holder="test",
                        transaction_id="tx-2",
                    ):
                        self.fail("expected lock acquisition to fail")

    def test_scenario_build_lock_rejects_different_thread_even_with_same_transaction(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "data" / "scenarios" / "tno_1962"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            errors: list[str] = []

            def worker() -> None:
                try:
                    with scenario_build_lock(
                        root=root,
                        scenario_id="tno_1962",
                        scenario_dir=scenario_dir,
                        holder="test",
                        transaction_id="tx-1",
                    ):
                        pass
                except RuntimeError as exc:
                    errors.append(str(exc))

            with scenario_build_lock(
                root=root,
                scenario_id="tno_1962",
                scenario_dir=scenario_dir,
                holder="test",
                transaction_id="tx-1",
            ):
                thread = threading.Thread(target=worker)
                thread.start()
                thread.join(timeout=5)

            self.assertTrue(errors)
            self.assertIn("another scenario writer is active", errors[0])

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
