from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from map_builder.scenario_build_session import (
    SCENARIO_BUILD_ROOT_RELATIVE,
    record_published_target,
    resolve_scenario_build_session,
)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _open_session(root, scenario_dir):
    return resolve_scenario_build_session(root=root, scenario_id="example_scenario", scenario_dir=scenario_dir)


def _create_session(root, scenario_dir):
    _write_json(scenario_dir / "manifest.json", {"scenario_id": "example_scenario"})
    _write_json(scenario_dir / "scenario_mutations.json", {})
    return _open_session(root, scenario_dir)


class ScenarioBuildSessionTest(unittest.TestCase):
    def test_resolve_scenario_build_session_uses_snapshot_root_and_persists_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "data" / "scenarios" / "example_scenario"
            build_dir = Path(_create_session(root, scenario_dir)["buildDir"])
            session = _open_session(root, scenario_dir)
            expected_root = root / SCENARIO_BUILD_ROOT_RELATIVE / "example_scenario"
            state_payload = session["state"]

            self.assertTrue(build_dir.is_relative_to(expected_root))
            self.assertEqual(build_dir.name, session["snapshotHash"])
            self.assertEqual(state_payload["scenario_id"], "example_scenario")
            self.assertEqual(state_payload["snapshot_hash"], session["snapshotHash"])
            self.assertIn("manifest.json", state_payload["input_hashes"])
            self.assertIn("scenario_mutations.json", state_payload["input_hashes"])

    def test_record_published_target_persists_artifact_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "data" / "scenarios" / "example_scenario"
            build_dir = Path(_create_session(root, scenario_dir)["buildDir"])
            published_file = scenario_dir / "countries.json"
            published_dir = scenario_dir / "chunks"
            _write_json(published_file, {"countries": {"AAA": {"name": "Alpha"}}})
            published_dir.mkdir(parents=True, exist_ok=True)

            record_published_target(
                build_dir=build_dir,
                target="scenario-data",
                published_files=[published_file, published_dir],
                root=root,
            )

            state_payload = _open_session(root, scenario_dir)["state"]
            target_entry = state_payload["published_targets"][0]
            artifact_manifest = target_entry["artifact_manifest"]
            self.assertEqual(target_entry["target"], "scenario-data")
            self.assertEqual(artifact_manifest["files"][0]["path"], "data/scenarios/example_scenario/countries.json")
            self.assertEqual(artifact_manifest["files"][0]["kind"], "file")
            self.assertEqual(artifact_manifest["files"][1]["path"], "data/scenarios/example_scenario/chunks")
            self.assertEqual(artifact_manifest["files"][1]["kind"], "directory")


if __name__ == "__main__":
    unittest.main()
