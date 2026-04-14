from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from map_builder.scenario_rebuild_planner import (
    compute_tno_stage_signature_payload,
    resolve_tno_rebuild_plan,
)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


class ScenarioRebuildPlannerTest(unittest.TestCase):
    def test_resolve_tno_rebuild_plan_for_water_keeps_countries_out_of_stage_sequence(self) -> None:
        plan = resolve_tno_rebuild_plan("water")

        self.assertEqual(
            plan.stage_sequence,
            ("water_state", "runtime_topology", "startup_support_assets", "startup_bundle_assets", "write_bundle", "chunk_assets"),
        )
        self.assertEqual(plan.publish_scope, "all")
        self.assertEqual(plan.publish_targets, ())

    def test_resolve_tno_rebuild_plan_for_geo_locale_uses_target_publish(self) -> None:
        plan = resolve_tno_rebuild_plan("geo-locale")

        self.assertEqual(plan.stage_sequence, ("geo_locale", "startup_support_assets"))
        self.assertEqual(plan.publish_scope, None)
        self.assertEqual(plan.publish_targets, ("geo-locale", "startup-support-assets"))

    def test_resolve_tno_rebuild_plan_for_startup_rebuilds_support_and_bundle(self) -> None:
        plan = resolve_tno_rebuild_plan("startup")

        self.assertEqual(plan.stage_sequence, ("startup_support_assets", "startup_bundle_assets"))
        self.assertEqual(plan.publish_targets, ("startup-support-assets", "startup-bundle-assets"))

    def test_compute_tno_stage_signature_payload_includes_expected_checkpoint_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "data" / "scenarios" / "tno_1962"
            checkpoint_dir = root / ".runtime" / "build" / "scenario" / "tno_1962" / "snapshot"
            _write_json(scenario_dir / "manifest.json", {"scenario_id": "tno_1962"})
            _write_json(checkpoint_dir / "runtime_topology.topo.json", {"objects": {}})
            _write_json(checkpoint_dir / "geo_locale_patch.json", {"geo": {}})
            _write_json(checkpoint_dir / "geo_locale_patch.en.json", {"language": "en"})
            _write_json(checkpoint_dir / "geo_locale_patch.zh.json", {"language": "zh"})
            _write_json(scenario_dir / "derived" / "startup_support_whitelist.json", {"locale_keys": [], "alias_keys": []})
            _write_json(checkpoint_dir / "countries.json", {"countries": {}})
            _write_json(checkpoint_dir / "owners.by_feature.json", {"owners": {}})
            _write_json(checkpoint_dir / "controllers.by_feature.json", {"controllers": {}})
            _write_json(checkpoint_dir / "cores.by_feature.json", {"cores": {}})

            payload = compute_tno_stage_signature_payload(
                "startup_support_assets",
                scenario_dir=scenario_dir,
                checkpoint_dir=checkpoint_dir,
            )

            labels = list(payload["inputs"].keys())
            self.assertTrue(any(label.endswith("runtime_topology.topo.json") for label in labels))
            self.assertTrue(any(label.endswith("geo_locale_patch.json") for label in labels))
            self.assertTrue(any(label.endswith("derived/startup_support_whitelist.json") for label in labels))
            self.assertEqual(payload["stage"], "startup_support_assets")

    def test_compute_tno_stage_signature_payload_for_water_includes_refresh_and_donor_roots(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "data" / "scenarios" / "tno_1962"
            checkpoint_dir = root / ".runtime" / "build" / "scenario" / "tno_1962" / "snapshot"
            tno_root = root / "tno"
            hgo_root = root / "hgo"
            _write_json(checkpoint_dir / "scenario_political.geojson", {"features": []})
            _write_json(checkpoint_dir / "stage_metadata.json", {"generated_at": "now"})
            _write_json(scenario_dir / "derived" / "marine_regions_named_waters.snapshot.geojson", {"features": []})
            _write_json(scenario_dir / "derived" / "water_regions.provenance.json", {"generated_at": "now"})
            (tno_root / "map").mkdir(parents=True, exist_ok=True)
            (hgo_root / "map").mkdir(parents=True, exist_ok=True)
            (tno_root / "map" / "provinces.bmp").write_bytes(b"bmp")
            (tno_root / "map" / "definition.csv").write_text("id;name\n", encoding="utf-8")
            (hgo_root / "map" / "provinces.bmp").write_bytes(b"bmp")
            (hgo_root / "map" / "definition.csv").write_text("id;name\n", encoding="utf-8")

            payload = compute_tno_stage_signature_payload(
                "water_state",
                scenario_dir=scenario_dir,
                checkpoint_dir=checkpoint_dir,
                refresh_named_water_snapshot=True,
                tno_root=tno_root,
                hgo_root=hgo_root,
            )

            self.assertTrue(payload["refresh_named_water_snapshot"])
            self.assertEqual(payload["tno_root"], str(tno_root.resolve()))
            self.assertEqual(payload["hgo_root"], str(hgo_root.resolve()))


if __name__ == "__main__":
    unittest.main()
