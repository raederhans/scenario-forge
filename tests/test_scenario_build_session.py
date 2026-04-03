from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from map_builder.scenario_build_session import (
    SCENARIO_BUILD_ROOT_RELATIVE,
    SCENARIO_BUILD_STATE_FILENAME,
    resolve_scenario_build_session,
)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


class ScenarioBuildSessionTest(unittest.TestCase):
    def test_resolve_scenario_build_session_uses_snapshot_root_and_persists_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "data" / "scenarios" / "example_scenario"
            _write_json(scenario_dir / "manifest.json", {"scenario_id": "example_scenario"})
            _write_json(
                scenario_dir / "scenario_mutations.json",
                {
                    "version": 1,
                    "scenario_id": "example_scenario",
                    "generated_at": "",
                    "tags": {},
                    "countries": {},
                    "assignments_by_feature_id": {},
                    "capitals": {},
                    "geo_locale": {},
                    "district_groups": {},
                },
            )

            session = resolve_scenario_build_session(
                root=root,
                scenario_id="example_scenario",
                scenario_dir=scenario_dir,
            )

            build_dir = Path(session["buildDir"])
            expected_root = root / SCENARIO_BUILD_ROOT_RELATIVE / "example_scenario"
            state_path = build_dir / SCENARIO_BUILD_STATE_FILENAME
            state_payload = json.loads(state_path.read_text(encoding="utf-8"))

            self.assertTrue(build_dir.is_relative_to(expected_root))
            self.assertEqual(build_dir.name, session["snapshotHash"])
            self.assertEqual(state_payload["scenario_id"], "example_scenario")
            self.assertEqual(state_payload["snapshot_hash"], session["snapshotHash"])
            self.assertIn("manifest.json", state_payload["input_hashes"])
            self.assertIn("scenario_mutations.json", state_payload["input_hashes"])


if __name__ == "__main__":
    unittest.main()
