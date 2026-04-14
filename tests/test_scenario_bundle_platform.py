from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from map_builder.contracts import ScenarioCheckpointArtifact
from map_builder import scenario_bundle_platform


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


class ScenarioBundlePlatformTest(unittest.TestCase):
    def test_checkpoint_artifact_loop_writes_and_loads_json_and_gdf_payloads(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            checkpoint_dir = Path(tmp_dir) / "checkpoint"
            artifacts = (
                ScenarioCheckpointArtifact("json_payload", "payload.json"),
                ScenarioCheckpointArtifact("gdf_payload", "payload.geojson", payload_kind="gdf"),
            )
            state = {
                "json_payload": {"ok": True},
                "gdf_payload": {"features": [{"id": "F-1"}]},
            }

            scenario_bundle_platform.write_checkpoint_artifacts(
                state,
                checkpoint_dir,
                artifacts,
                write_json=_write_json,
                gdf_to_feature_collection=lambda gdf: {"features": list(gdf["features"])},
            )
            loaded = scenario_bundle_platform.load_checkpoint_artifacts(
                checkpoint_dir,
                artifacts,
                load_json=_load_json,
                geopandas_from_features=lambda features: {"features": list(features)},
            )

            self.assertEqual(loaded["json_payload"], {"ok": True})
            self.assertEqual(loaded["gdf_payload"], {"features": [{"id": "F-1"}]})

    def test_detect_unsynced_manual_edits_backup_continue_writes_report_and_backup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            report_dir = root / "reports"
            backup_root = root / "backups"
            scenario_dir.mkdir()
            checkpoint_dir.mkdir()
            _write_json(scenario_dir / "countries.json", {"countries": {"AAA": {"name": "A"}}})
            _write_json(checkpoint_dir / "countries.json", {"countries": {"AAA": {"name": "B"}}})

            report = scenario_bundle_platform.detect_unsynced_manual_edits(
                scenario_dir,
                checkpoint_dir,
                {"manual": scenario_dir / "scenario_manual_overrides.json"},
                scenario_id="tno_1962",
                policy="backup-continue",
                load_json=_load_json,
                write_json=_write_json,
                utc_timestamp=lambda: "2026-03-29T01:02:03Z",
                normalize_core_tags=lambda value: value or [],
                normalize_locale_override_entry=lambda value: value,
                report_dir=report_dir,
                backup_root=backup_root,
                backup_continue_policy="backup-continue",
                strict_block_policy="strict-block",
            )

            self.assertTrue(report["has_drift"])
            self.assertTrue((report_dir / "tno_1962-20260329T010203Z.json").exists())
            self.assertTrue(Path(report["backup_path"]).exists())

    def test_detect_unsynced_manual_edits_strict_block_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            scenario_dir.mkdir()
            checkpoint_dir.mkdir()
            _write_json(scenario_dir / "countries.json", {"countries": {"AAA": {"name": "A"}}})
            _write_json(checkpoint_dir / "countries.json", {"countries": {"AAA": {"name": "B"}}})

            with self.assertRaisesRegex(ValueError, "Unsynced manual edits detected"):
                scenario_bundle_platform.detect_unsynced_manual_edits(
                    scenario_dir,
                    checkpoint_dir,
                    {"manual": scenario_dir / "scenario_manual_overrides.json"},
                    scenario_id="tno_1962",
                    policy="strict-block",
                    load_json=_load_json,
                    write_json=_write_json,
                    utc_timestamp=lambda: "2026-03-29T01:02:03Z",
                    normalize_core_tags=lambda value: value or [],
                    normalize_locale_override_entry=lambda value: value,
                    report_dir=root / "reports",
                    backup_root=root / "backups",
                    backup_continue_policy="backup-continue",
                    strict_block_policy="strict-block",
                )

    def test_validate_strict_publish_bundle_raises_on_contract_errors(self) -> None:
        with self.assertRaisesRegex(ValueError, "Strict bundle validation failed"):
            scenario_bundle_platform.validate_strict_publish_bundle(
                Path("unused"),
                "scenario_data",
                scenario_data_scope="scenario_data",
                all_scope="all",
                validate_publish_bundle_dir=lambda _path: ["missing runtime_topology.topo.json"],
            )

    def test_publish_checkpoint_bundle_copies_only_scope_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            checkpoint_dir = root / "checkpoint"
            scenario_dir = root / "scenario"
            checkpoint_dir.mkdir()
            _write_json(checkpoint_dir / "runtime_topology.topo.json", {"type": "Topology"})
            _write_json(checkpoint_dir / "geo_locale_patch.json", {"geo": {}})
            _write_json(checkpoint_dir / "manifest.json", {"summary": {"feature_count": 1}})
            _write_json(checkpoint_dir / "countries.json", {"countries": {"AAA": {}}})
            _write_json(checkpoint_dir / "owners.by_feature.json", {"owners": {"F-1": "AAA"}})
            _write_json(checkpoint_dir / "controllers.by_feature.json", {"controllers": {"F-1": "AAA"}})
            _write_json(checkpoint_dir / "cores.by_feature.json", {"cores": {"F-1": ["AAA"]}})
            _write_json(checkpoint_dir / "bathymetry.topo.json", {"type": "Topology"})

            scenario_bundle_platform.publish_checkpoint_bundle(
                scenario_dir,
                checkpoint_dir,
                "polar_runtime",
                load_checkpoint_json=lambda directory, filename: _load_json(directory / filename),
                write_json=_write_json,
            )

            self.assertTrue((scenario_dir / "runtime_topology.topo.json").exists())
            self.assertFalse((scenario_dir / "manifest.json").exists())

    def test_publish_checkpoint_bundle_scenario_data_copies_derived_support_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            checkpoint_dir = root / "checkpoint"
            scenario_dir = root / "scenario"
            checkpoint_dir.mkdir()
            _write_json(checkpoint_dir / "countries.json", {"countries": {"AAA": {}}})
            _write_json(checkpoint_dir / "owners.by_feature.json", {"owners": {"F-1": "AAA"}})
            _write_json(checkpoint_dir / "controllers.by_feature.json", {"controllers": {"F-1": "AAA"}})
            _write_json(checkpoint_dir / "cores.by_feature.json", {"cores": {"F-1": ["AAA"]}})
            _write_json(checkpoint_dir / "manifest.json", {"summary": {"feature_count": 1}})
            _write_json(checkpoint_dir / "audit.json", {"ok": True})
            _write_json(checkpoint_dir / "special_regions.geojson", {"type": "FeatureCollection", "features": []})
            _write_json(checkpoint_dir / "water_regions.geojson", {"type": "FeatureCollection", "features": []})
            _write_json(checkpoint_dir / "relief_overlays.geojson", {"type": "FeatureCollection", "features": []})
            _write_json(checkpoint_dir / "bathymetry.topo.json", {"type": "Topology"})
            _write_json(checkpoint_dir / "runtime_topology.bootstrap.topo.json", {"type": "Topology"})
            _write_json(checkpoint_dir / "geo_locale_patch.json", {"geo": {}})
            _write_json(checkpoint_dir / "geo_locale_patch.en.json", {"language": "en"})
            _write_json(checkpoint_dir / "geo_locale_patch.zh.json", {"language": "zh"})
            _write_json(checkpoint_dir / "locales.startup.json", {"locales": {}})
            _write_json(checkpoint_dir / "geo_aliases.startup.json", {"aliases": {}})
            _write_json(checkpoint_dir / "startup.bundle.en.json", {"ok": True})
            _write_json(checkpoint_dir / "startup.bundle.zh.json", {"ok": True})
            _write_json(checkpoint_dir / "derived" / "marine_regions_named_waters.snapshot.geojson", {"features": []})
            _write_json(checkpoint_dir / "derived" / "water_regions.provenance.json", {"generated_at": "now"})

            scenario_bundle_platform.publish_checkpoint_bundle(
                scenario_dir,
                checkpoint_dir,
                "scenario_data",
                load_checkpoint_json=lambda directory, filename: _load_json(directory / filename),
                write_json=_write_json,
            )

            self.assertTrue((scenario_dir / "derived" / "marine_regions_named_waters.snapshot.geojson").exists())
            self.assertTrue((scenario_dir / "derived" / "water_regions.provenance.json").exists())


if __name__ == "__main__":
    unittest.main()
