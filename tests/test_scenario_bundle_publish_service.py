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
        from tools import patch_tno_1962_bundle as tno
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

            with (patch.object(tno, "resolve_scenario_publish_filenames", return_value=[runtime.name, "manifest.json", "audit.json"]),
                  patch.object(tno.scenario_bundle_platform, "resolve_scenario_publish_filenames", return_value=[runtime.name, "manifest.json", "audit.json"]),
                  patch.object(tno, "write_runtime_topology_source",
                               side_effect=lambda directory, value: write_runtime_topology_source(directory, value, max_bytes=200))):
                tno._publish_tno_checkpoint_bundle(
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

    def test_tno_gzip_hydration_keeps_checkpoint_manifest_plain(self) -> None:
        from tools import patch_tno_1962_bundle as tno
        import json

        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir, checkpoint_dir = root / "scenario", root / "checkpoint"
            payload = {"type": "Topology", "padding": "x" * 2000}
            compressed = write_runtime_topology_source(scenario_dir, payload, max_bytes=200)
            runtime_url = "data/scenarios/tno_1962/" + compressed.name
            (scenario_dir / "manifest.json").write_text(json.dumps({
                "runtime_topology_url": runtime_url,
                "source": {"runtime_topology_sha256": json_source_sha256(compressed)},
            }))
            (scenario_dir / "audit.json").write_text(json.dumps({"runtime_topology_path": runtime_url}))
            with (patch.object(tno, "resolve_publish_filenames", return_value=["runtime_topology.topo.json", "manifest.json", "audit.json"]),
                  patch.object(tno, "ensure_legacy_capital_hints_checkpoint")):
                tno.hydrate_publish_checkpoint_from_scenario(scenario_dir, checkpoint_dir, "test")
            plain = checkpoint_dir / "runtime_topology.topo.json"
            self.assertEqual(read_json_source(plain), payload)
            self.assertFalse(plain.with_name(plain.name + ".gz").exists())
            manifest = read_json_source(checkpoint_dir / "manifest.json")
            self.assertEqual(manifest["runtime_topology_url"], runtime_url[:-3])
            self.assertEqual(manifest["source"]["runtime_topology_sha256"], json_source_sha256(plain))
            self.assertEqual(read_json_source(checkpoint_dir / "audit.json")["runtime_topology_path"], runtime_url[:-3])

    def test_tno_chunk_rebuild_writes_canonical_gzip_bytes(self) -> None:
        from tools import patch_tno_1962_bundle as tno
        import json

        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "data/scenarios/tno_1962"
            scenario_dir.mkdir(parents=True)
            # Start from an explicit gzip URL: the rebuild must never write JSON
            # text into this path merely because the manifest already uses it.
            (scenario_dir / "manifest.json").write_text(json.dumps({
                "runtime_topology_url": "data/scenarios/tno_1962/runtime_topology.topo.json.gz",
            }))
            payload = {"type": "Topology", "objects": {}, "arcs": [], "padding": "x" * 2000}
            with (patch.object(tno, "ROOT", root),
                  patch.object(tno, "load_checkpoint_json", side_effect=lambda _, name: payload if name == "runtime_topology.topo.json" else {}),
                  patch.object(tno, "write_runtime_topology_source",
                               side_effect=lambda directory, value: write_runtime_topology_source(directory, value, max_bytes=200)),
                  patch.object(tno, "build_bootstrap_runtime_topology", return_value={}),
                  patch.object(tno, "build_and_write_scenario_chunk_assets") as chunks):
                tno.rebuild_published_scenario_chunk_assets(scenario_dir, root / "checkpoint")
            compressed = scenario_dir / "runtime_topology.topo.json.gz"
            self.assertEqual(read_json_source(compressed), payload)
            manifest = read_json_source(scenario_dir / "manifest.json")
            self.assertEqual(manifest["source"]["runtime_topology_sha256"], json_source_sha256(compressed))
            self.assertEqual(chunks.call_args.kwargs["runtime_topology_url"], manifest["runtime_topology_url"])

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

    def test_scenario_data_publish_binds_existing_gzip_runtime_without_republishing_it(self) -> None:
        import json
        from tools import patch_tno_1962_bundle as tno

        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir, checkpoint_dir = root / "scenario", root / "checkpoint"
            checkpoint_dir.mkdir()
            payload = {"type": "Topology", "objects": {}, "arcs": [], "padding": "x" * 2000}
            compressed = write_runtime_topology_source(scenario_dir, payload, max_bytes=200)
            before = compressed.read_bytes()
            raw_path = checkpoint_dir / "runtime_topology.topo.json"
            raw_path.write_text(json.dumps(payload))
            manifest = {"runtime_topology_url": "data/scenarios/tno_1962/" + raw_path.name,
                        "source": {"runtime_topology_sha256": json_source_sha256(raw_path)}}
            filenames = ["manifest.json", "audit.json", "startup.bundle.en.json", "startup.bundle.zh.json"]
            for name in filenames:
                value = manifest if name == "manifest.json" else {"source": manifest["source"], "manifest_subset": manifest}
                (checkpoint_dir / name).write_text(json.dumps(value))
            with (patch.object(tno, "resolve_scenario_publish_filenames", return_value=filenames),
                  patch.object(tno.scenario_bundle_platform, "resolve_scenario_publish_filenames", return_value=filenames),
                  patch.object(tno, "write_runtime_topology_source") as runtime_writer):
                tno._publish_tno_checkpoint_bundle(scenario_dir, checkpoint_dir, "scenario_data",
                    load_checkpoint_json=lambda directory, name: read_json_source(directory / name),
                    write_json=lambda path, value: path.write_text(json.dumps(value)))
            runtime_writer.assert_not_called()
            self.assertEqual(compressed.read_bytes(), before)
            self.assertFalse((scenario_dir / raw_path.name).exists())
            stored_hash = json_source_sha256(compressed)
            manifest = read_json_source(scenario_dir / "manifest.json")
            self.assertEqual(manifest["runtime_topology_url"], "data/scenarios/tno_1962/" + compressed.name)
            self.assertEqual(manifest["source"]["runtime_topology_sha256"], stored_hash)
            for language in ("en", "zh"):
                bundle = read_json_source(scenario_dir / f"startup.bundle.{language}.json")
                self.assertEqual(bundle["manifest_subset"]["runtime_topology_url"], manifest["runtime_topology_url"])
                self.assertEqual(bundle["source"]["runtime_topology_sha256"], stored_hash)

    def test_tno_full_cli_rebinds_startup_and_final_snapshot_after_chunks(self) -> None:
        from argparse import Namespace
        from contextlib import ExitStack, nullcontext
        import gzip
        import json
        from tools import patch_tno_1962_bundle as tno
        from tools import check_scenario_contracts as contracts

        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "data/scenarios/tno_1962"
            checkpoint_dir = root / "checkpoint"
            checkpoint_dir.mkdir()
            empty_topology = {"type": "Topology", "objects": {"political": {"type": "GeometryCollection", "geometries": []}}, "arcs": []}
            runtime = {**empty_topology, "padding": "x" * 2000}
            runtime_url = "data/scenarios/tno_1962/runtime_topology.topo.json"

            def write(path, value):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(value), encoding="utf-8")

            for filename in tno.resolve_scenario_publish_filenames(tno.PUBLISH_SCOPE_ALL):
                write(checkpoint_dir / filename, {})
            write(root / "data/europe_topology.json", empty_topology)
            write(root / "data/manifest.json", {"version": 1})
            write(checkpoint_dir / "runtime_topology.topo.json", runtime)
            write(checkpoint_dir / tno.CHECKPOINT_RUNTIME_BOOTSTRAP_TOPOLOGY_FILENAME, empty_topology)
            write(checkpoint_dir / "locales.startup.json", {"geo": {}})
            write(checkpoint_dir / "geo_aliases.startup.json", {})
            write(checkpoint_dir / "countries.json", {"countries": {}})
            write(checkpoint_dir / "owners.by_feature.json", {"owners": {}})
            write(checkpoint_dir / "cores.by_feature.json", {"cores": {}})
            raw_hash = json_source_sha256(checkpoint_dir / "runtime_topology.topo.json")
            manifest = {"scenario_id": "tno_1962", "generated_at": "2026-10-05T00:00:00Z", "baseline_hash": "test",
                        "runtime_topology_url": runtime_url, "summary": {"feature_count": 0},
                        "startup_bundle_url_en": "data/scenarios/tno_1962/startup.bundle.en.json",
                        "startup_bundle_url_zh": "data/scenarios/tno_1962/startup.bundle.zh.json",
                        "source": {"runtime_topology_sha256": raw_hash}}
            write(checkpoint_dir / "manifest.json", manifest)
            for language in ("en", "zh"):
                write(checkpoint_dir / f"startup.bundle.{language}.json", {"source": manifest["source"], "manifest_subset": manifest})
            checkpoint_bytes = {path.name: path.read_bytes() for path in checkpoint_dir.glob("*.json")}
            # Regional publishing can leave these sidecars present. They must
            # follow the final repair, not retain the earlier publish snapshot.
            write(scenario_dir / "manifest.json", manifest)
            write(scenario_dir / "audit.json", {})
            write(scenario_dir / "build_snapshot.json", contracts.build_scenario_snapshot_payload(
                scenario_id="tno_1962", profile_id=contracts.resolve_scenario_contract_profile("tno_1962").profile_id,
                input_sha={}, output_sha={}, feature_count=0, water_count=0, chunk_count=0,
                generated_at=manifest["generated_at"],
            ))
            for name in ("manifest.json", "audit.json", "build_snapshot.json"):
                path = scenario_dir / name
                path.with_name(name + ".gz").write_bytes(gzip.compress(path.read_bytes(), mtime=0))
            events = []

            def publish(directory, checkpoint, scope, **kwargs):
                events.append("publish")
                tno._publish_tno_checkpoint_bundle(directory, checkpoint, scope,
                    load_checkpoint_json=lambda base, name: read_json_source(base / name), write_json=write)
                published = read_json_source(directory / "manifest.json")
                for language in ("en", "zh"):
                    bundle = read_json_source(directory / f"startup.bundle.{language}.json")
                    self.assertEqual(bundle["manifest_subset"]["runtime_topology_url"], published["runtime_topology_url"])
                    self.assertEqual(bundle["source"]["runtime_topology_sha256"], published["source"]["runtime_topology_sha256"])

            def chunk_builder(*, scenario_dir, manifest_payload, **kwargs):
                events.append("chunks")
                write(scenario_dir / "detail_chunks.manifest.json", {"chunks": [], "rebuilt": True})
                manifest_payload["source"]["detail_chunk_manifest_sha256"] = json_source_sha256(scenario_dir / "detail_chunks.manifest.json")

            def chunks(directory, checkpoint):
                tno.rebuild_published_scenario_chunk_assets(directory, checkpoint)

            real_repair = contracts.apply_safe_scenario_contract_repairs

            def repair(directory, **kwargs):
                events.append("repair")
                return real_repair(directory, **kwargs)

            args = Namespace(scenario_dir=str(scenario_dir), checkpoint_dir=str(checkpoint_dir),
                             tno_root=None, hgo_root=None, changed_domain="", stage="all",
                             refresh_named_water_snapshot=False, manual_sync_policy="backup-continue")
            with ExitStack() as stack:
                stack.enter_context(patch.object(tno, "ROOT", root))
                stack.enter_context(patch.object(contracts, "PROJECT_ROOT", root))
                stack.enter_context(patch.object(tno, "parse_args", return_value=args))
                stack.enter_context(patch.object(tno, "_scenario_build_session_lock", side_effect=lambda _: nullcontext()))
                stack.enter_context(patch.object(tno, "_checkpoint_build_lock", side_effect=lambda *a, **k: nullcontext()))
                for name in ("build_countries_stage_state", "write_countries_stage_checkpoints", "ensure_water_stage_checkpoints",
                             "build_runtime_topology_stage", "write_runtime_topology_stage_checkpoints", "build_geo_locale_stage",
                             "build_startup_assets_stage", "print_bundle_summary"):
                    stack.enter_context(patch.object(tno, name, return_value={}))
                stack.enter_context(patch.object(tno, "write_bundle_stage", side_effect=publish))
                stack.enter_context(patch.object(tno, "build_chunk_assets_stage", side_effect=chunks))
                stack.enter_context(patch.object(tno, "build_and_write_scenario_chunk_assets", side_effect=chunk_builder))
                stack.enter_context(patch.object(tno, "write_runtime_topology_source",
                    side_effect=lambda directory, value: write_runtime_topology_source(directory, value, max_bytes=200)))
                stack.enter_context(patch.object(tno, "build_bootstrap_runtime_topology", return_value=empty_topology))
                stack.enter_context(patch.object(tno, "apply_safe_scenario_contract_repairs", side_effect=repair))
                stack.enter_context(patch.object(contracts, "build_startup_bootstrap_assets"))
                stack.enter_context(patch.object(contracts, "write_tno_coverage_ledgers"))
                stack.enter_context(patch.object(contracts, "_ensure_geo_locale_patch_inputs", return_value={
                    "base": scenario_dir / "geo_locale_patch.json", "en": scenario_dir / "geo_locale_patch.en.json",
                    "zh": scenario_dir / "geo_locale_patch.zh.json"}))
                tno.main()
                manifest = read_json_source(scenario_dir / "manifest.json")
                snapshot = read_json_source(scenario_dir / "build_snapshot.json")
                expected_snapshot = contracts._compose_snapshot_payload(scenario_dir, manifest)
                self.assertEqual(snapshot, expected_snapshot)
            self.assertEqual(events, ["publish", "chunks", "repair"])
            stored_hash = json_source_sha256(scenario_dir / "runtime_topology.topo.json.gz")
            self.assertNotEqual(stored_hash, raw_hash)
            self.assertEqual(snapshot["input_sha"]["runtime_topology.topo.json"], stored_hash)
            self.assertEqual(manifest["source"]["runtime_topology_sha256"], stored_hash)
            self.assertEqual(manifest["snapshot_fingerprint"], snapshot["snapshot_fingerprint"])
            for language in ("en", "zh"):
                path = scenario_dir / f"startup.bundle.{language}.json"
                bundle = read_json_source(path)
                self.assertEqual(bundle["manifest_subset"]["runtime_topology_url"], manifest["runtime_topology_url"])
                self.assertEqual(bundle["source"]["runtime_topology_sha256"], stored_hash)
                for field, value in bundle["manifest_subset"]["source"].items():
                    self.assertEqual(value, bundle["source"][field])
                self.assertEqual(bundle["source"]["detail_chunk_manifest_sha256"], manifest["source"]["detail_chunk_manifest_sha256"])
                self.assertEqual(snapshot["output_sha"][path.name], json_source_sha256(path))
                self.assertEqual(snapshot["output_sha"][path.name + ".gz"], json_source_sha256(path.with_name(path.name + ".gz")))
                self.assertEqual(read_json_source(path.with_name(path.name + ".gz")), bundle)
            audit = read_json_source(scenario_dir / "audit.json")
            self.assertEqual(audit["source"]["runtime_topology_sha256"], stored_hash)
            self.assertEqual(audit["source"]["build_snapshot_sha256"], json_source_sha256(scenario_dir / "build_snapshot.json"))
            self.assertEqual(audit["snapshot_fingerprint"], snapshot["snapshot_fingerprint"])
            for name in ("manifest.json", "audit.json", "build_snapshot.json"):
                path = scenario_dir / name
                self.assertEqual(gzip.decompress(path.with_name(name + ".gz").read_bytes()), path.read_bytes())
            self.assertEqual(checkpoint_bytes, {path.name: path.read_bytes() for path in checkpoint_dir.glob("*.json")})


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
