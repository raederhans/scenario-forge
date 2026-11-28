from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from map_builder import scenario_bundle_publish_service
from map_builder.json_source import json_source_sha256, read_json_source, write_runtime_topology_source


class ScenarioBundlePublishServiceTest(unittest.TestCase):
    def test_canonical_gzip_publish_records_actual_source_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            checkpoint_dir.mkdir()
            payload = {"type": "Topology", "padding": "x" * 2000}

            def publish_bundle(directory, _checkpoint, _scope, **kwargs):
                write_runtime_topology_source(directory, payload, max_bytes=200)

            with patch.object(scenario_bundle_publish_service, "record_published_target") as record:
                result = scenario_bundle_publish_service.publish_scenario_build_in_locked_session(
                    scenario_dir, checkpoint_dir,
                    publish_scope="polar_runtime", manual_sync_policy="backup-continue",
                    scenario_id="tno_1962", scenario_data_scope="scenario_data", all_scope="all",
                    manual_source_filenames={}, validate_publish_bundle_dir=Mock(),
                    ensure_publish_target_offline=Mock(), validate_geo_locale_checkpoint=Mock(),
                    require_startup_stage_checkpoints=Mock(), detect_unsynced_manual_edits=Mock(),
                    publish_checkpoint_bundle=publish_bundle, load_checkpoint_json=Mock(), write_json=Mock(),
                    resolve_publish_filenames=lambda _: ["runtime_topology.topo.json"], root=root,
                )
            self.assertEqual(result["publishedFiles"], ["runtime_topology.topo.json.gz"])
            self.assertEqual(record.call_args.kwargs["published_paths"], [scenario_dir / "runtime_topology.topo.json.gz"])

    def test_tno_publish_selects_storage_and_keeps_plain_checkpoint(self) -> None:
        from map_builder import scenario_bundle_publish_service as publisher
        import json

        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            checkpoint_dir = root / "checkpoint"
            scenario_dir = root / "scenario"
            checkpoint_dir.mkdir()
            payload = {"type": "Topology", "arcs": [[[1.123456789, -0.0], [2, 3]]],
                       "objects": {}, "padding": "x" * 2000}
            runtime = checkpoint_dir / "runtime_topology.topo.json"
            runtime.write_text(json.dumps(payload))
            (checkpoint_dir / "manifest.json").write_text(json.dumps({"runtime_topology_url": "old"}))
            (checkpoint_dir / "audit.json").write_text(json.dumps({"runtime_topology_path": "old"}))
            checkpoint_bytes = runtime.read_bytes()

            def write_json(path, value):
                path.write_text(json.dumps(value))

            with (patch.object(publisher, "resolve_scenario_publish_filenames", return_value=[runtime.name, "manifest.json", "audit.json"]),
                  patch.object(publisher.scenario_bundle_platform, "resolve_scenario_publish_filenames", return_value=[runtime.name, "manifest.json", "audit.json"]),
                  patch.object(publisher, "write_runtime_topology_source",
                               side_effect=lambda directory, value: write_runtime_topology_source(directory, value, max_bytes=200))):
                publisher.publish_tno_checkpoint_bundle(
                    scenario_dir, checkpoint_dir, "test",
                    load_checkpoint_json=lambda directory, name: read_json_source(directory / name), write_json=write_json,
                )
            compressed = scenario_dir / (runtime.name + ".gz")
            self.assertEqual(read_json_source(compressed), payload)
            self.assertFalse((scenario_dir / runtime.name).exists())
            manifest = read_json_source(scenario_dir / "manifest.json")
            self.assertEqual(manifest["runtime_topology_url"], "data/scenarios/tno_1962/" + compressed.name)
            self.assertEqual(manifest["source"]["runtime_topology_sha256"], json_source_sha256(compressed))
            self.assertEqual(read_json_source(scenario_dir / "audit.json")["runtime_topology_path"], manifest["runtime_topology_url"])
            self.assertEqual(runtime.read_bytes(), checkpoint_bytes)

    def test_gzip_hydration_rebinds_startup_and_snapshot_before_strict_publish_gate(self) -> None:
        import json
        from tools import patch_tno_1962_bundle as tno
        from tools import check_scenario_contracts as contracts

        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "data/scenarios/tno_1962"
            checkpoint_dir = root / "checkpoint/data/scenarios/tno_1962"
            payload = {"type": "Topology", "objects": {}, "arcs": [], "padding": "x" * 2000}
            compressed = write_runtime_topology_source(scenario_dir, payload, max_bytes=200)
            runtime_url = "data/scenarios/tno_1962/" + compressed.name
            manifest = {"scenario_id": "tno_1962", "runtime_topology_url": runtime_url,
                        "source": {"runtime_topology_sha256": json_source_sha256(compressed)},
                        "startup_bundle_url_en": "data/scenarios/tno_1962/startup.bundle.en.json",
                        "startup_bundle_url_zh": "data/scenarios/tno_1962/startup.bundle.zh.json"}
            (scenario_dir / "manifest.json").write_text(json.dumps(manifest))
            (scenario_dir / "audit.json").write_text(json.dumps({"runtime_topology_path": runtime_url}))
            for language in ("en", "zh"):
                (scenario_dir / f"startup.bundle.{language}.json").write_text(json.dumps({
                    "source": manifest["source"], "manifest_subset": manifest,
                }))
            with patch.object(contracts, "PROJECT_ROOT", root):
                snapshot = contracts._build_snapshot_for_scenario(scenario_dir, manifest)
                checkpoint_dir.mkdir(parents=True)
                (checkpoint_dir / "build_snapshot.json").write_text(json.dumps(snapshot))
                filenames = ["runtime_topology.topo.json", "manifest.json", "audit.json", "startup.bundle.en.json", "startup.bundle.zh.json"]
                with (patch.object(tno, "resolve_publish_filenames", return_value=filenames),
                      patch.object(tno, "ensure_legacy_capital_hints_checkpoint")):
                    tno.hydrate_publish_checkpoint_from_scenario(scenario_dir, checkpoint_dir, "test")
                checkpoint_manifest = read_json_source(checkpoint_dir / "manifest.json")
                errors = []
                contracts._validate_startup_bundle_sources(checkpoint_dir, checkpoint_manifest, errors)
                contracts._validate_build_snapshot(checkpoint_dir, checkpoint_manifest, errors)
                self.assertEqual(errors, [])
            raw_hash = json_source_sha256(checkpoint_dir / "runtime_topology.topo.json")
            self.assertEqual(checkpoint_manifest["runtime_topology_url"], runtime_url[:-3])
            self.assertEqual(read_json_source(checkpoint_dir / "build_snapshot.json")["input_sha"]["runtime_topology.topo.json"], raw_hash)
            for language in ("en", "zh"):
                path = checkpoint_dir / f"startup.bundle.{language}.json"
                bundle = read_json_source(path)
                self.assertEqual(bundle["manifest_subset"]["runtime_topology_url"], runtime_url[:-3])
                self.assertEqual(bundle["manifest_subset"]["source"]["runtime_topology_sha256"], raw_hash)
                self.assertEqual(bundle["source"]["runtime_topology_sha256"], raw_hash)
                self.assertEqual(read_json_source(path.with_name(path.name + ".gz")), bundle)

    def test_publish_scenario_build_does_not_record_target_when_commit_fails(self) -> None:
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
            publish_bundle = Mock(side_effect=OSError("commit failed"))

            with (
                patch.object(
                    scenario_bundle_publish_service.scenario_bundle_platform,
                    "validate_strict_publish_bundle",
                ),
                patch.object(
                    scenario_bundle_publish_service,
                    "record_published_target",
                ) as record_published_target_mock,
            ):
                with self.assertRaisesRegex(OSError, "commit failed"):
                    scenario_bundle_publish_service.publish_scenario_build_in_locked_session(
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

            record_published_target_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
