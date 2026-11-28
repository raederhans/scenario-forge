from __future__ import annotations

import json
import threading
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from map_builder import config as cfg
from map_builder import scenario_context
from map_builder import scenario_geo_locale_registry
from map_builder import scenario_geo_locale_materializer
from tools import dev_server


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_failing_geo_builder_script(path: Path, *, stderr: str = "builder failed") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(
            [
                "from __future__ import annotations",
                "import sys",
                f"sys.stderr.write({stderr!r})",
                "raise SystemExit(1)",
            ]
        ),
        encoding="utf-8",
    )


class DevServerTest(unittest.TestCase):
    def _create_scenario_fixture(
        self,
        root: Path,
        scenario_id: str = "test_scenario",
        *,
        releasable_catalog_url: str | None = None,
    ) -> Path:
        scenario_dir = root / "data" / "scenarios" / scenario_id
        manifest_payload = {
            "scenario_id": scenario_id,
            "display_name": "Test Scenario",
            "baseline_hash": "baseline-123",
            "countries_url": f"data/scenarios/{scenario_id}/countries.json",
            "owners_url": f"data/scenarios/{scenario_id}/owners.by_feature.json",
            "geo_locale_patch_url": f"data/scenarios/{scenario_id}/geo_locale_patch.json",
        }
        manifest_payload["cores_url"] = f"data/scenarios/{scenario_id}/cores.by_feature.json"
        if releasable_catalog_url:
            manifest_payload["releasable_catalog_url"] = releasable_catalog_url
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
        _write_json(scenario_dir / "manifest.json", manifest_payload)
        _write_json(
            scenario_dir / "countries.json",
            {
                "countries": {
                    "AAA": {"tag": "AAA"},
                    "BBB": {"tag": "BBB"},
                }
            },
        )
        owners = {"DE-1": "AAA", "DE-2": "BBB", "DE-3": "AAA", "AAA-1": "AAA", "BBB-2": "BBB"}
        for field, values in (
            ("owners", owners), ("controllers", owners), ("cores", {fid: [tag] for fid, tag in owners.items()}),
        ):
            _write_json(scenario_dir / f"{field}.by_feature.json", {field: values, "baseline_hash": "baseline-123"})
        _write_json(
            scenario_dir / "geo_locale_patch.json",
            {
                "version": 1,
                "scenario_id": scenario_id,
                "generated_at": "",
                "geo": {},
            },
        )
        partial = {"version": 1, "scenario_id": scenario_id, "generated_at": "", "audit": {}}
        _write_json(scenario_dir / cfg.SCENARIO_CITY_ASSETS_PARTIAL_FILENAME, {**partial, "cities": {}})
        _write_json(scenario_dir / cfg.SCENARIO_CAPITAL_DEFAULTS_PARTIAL_FILENAME,
                    {**partial, "capitals_by_tag": {}, "capital_city_hints": {}})
        return scenario_dir

    def test_save_scenario_ownership_payload_legacy_owner_updates_preserve_controller_and_core_and_write_manual_overrides(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)

            result = dev_server.save_scenario_ownership_payload(
                "test_scenario",
                {
                    "DE-1": "BBB",
                    "DE-2": "AAA",
                },
                baseline_hash="baseline-123",
                root=root,
            )

            saved_payload = json.loads((scenario_dir / "owners.by_feature.json").read_text(encoding="utf-8"))
            controllers_payload = json.loads((scenario_dir / "controllers.by_feature.json").read_text(encoding="utf-8"))
            cores_payload = json.loads((scenario_dir / "cores.by_feature.json").read_text(encoding="utf-8"))
            manual_payload = json.loads((scenario_dir / "scenario_manual_overrides.json").read_text(encoding="utf-8"))
            mutations_payload = json.loads((scenario_dir / "scenario_mutations.json").read_text(encoding="utf-8"))
            self.assertTrue(result["ok"])
            self.assertEqual(saved_payload["owners"]["DE-1"], "BBB")
            self.assertEqual(saved_payload["owners"]["DE-2"], "AAA")
            self.assertEqual(saved_payload["owners"]["DE-3"], "AAA")
            self.assertEqual(saved_payload["baseline_hash"], "baseline-123")
            self.assertEqual(controllers_payload["controllers"]["DE-1"], "AAA")
            self.assertEqual(cores_payload["cores"]["DE-1"], ["AAA"])
            self.assertEqual(manual_payload["assignments"]["DE-1"]["owner"], "BBB")
            self.assertNotIn("controller", manual_payload["assignments"]["DE-1"])
            self.assertEqual(manual_payload["assignments"]["DE-1"]["cores"], ["AAA"])
            self.assertEqual(mutations_payload["assignments_by_feature_id"]["DE-1"]["owner"], "BBB")
            self.assertEqual(result["mutationsPath"], "data/scenarios/test_scenario/scenario_mutations.json")
            self.assertEqual(result["stats"]["featureCount"], 5)
            self.assertEqual(result["stats"]["touchedFeatureCount"], 2)

    def test_save_scenario_country_payload_preserves_untouched_local_manual_catalog_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            source_catalog_url = "data/releasables/test_scenario.source.catalog.json"
            scenario_dir = self._create_scenario_fixture(
                root,
                releasable_catalog_url=source_catalog_url,
            )

            def entry(tag, name, color, parent, feature):
                return {
                    "tag": tag, "display_name": name, "display_name_en": name, "display_name_zh": name + " Zh",
                    "color_hex": color, "entry_kind": "releasable", "scenario_ids": ["test_scenario"],
                    "scenario_only": True, "allow_manual_overlay": True, "boundary_variants": [],
                    "preset_source": {"type": "feature_ids", "name": "", "group_ids": [], "feature_ids": [feature]},
                    "parent_owner_tag": parent, "parent_owner_tags": [parent],
                }

            _write_json(root / source_catalog_url, {
                "version": 1, "catalog_id": "test_scenario.source", "scenario_ids": ["test_scenario"],
                "entries": [
                    entry('OLD', 'Old Release', '#111111', 'AAA', 'AAA-1'),
                ],
            })
            _write_json(scenario_dir / "releasable_catalog.manual.json", {
                "version": 1, "catalog_id": "test_scenario.manual", "scenario_ids": ["test_scenario"],
                "entries": [
                    entry('OLD', 'Old Release Local', '#999999', 'BBB', 'BBB-1'),
                    entry('STALE', 'Stale', '#999999', 'BBB', 'BBB-1'),
                    entry('MAN2', 'Manual Two', '#777777', 'AAA', 'DE-3'),
                ],
            })

            result = dev_server.save_scenario_country_payload(
                "test_scenario",
                tag="AAA",
                name_en="Alpha Prime",
                name_zh="Alpha Prime Zh",
                color_hex="#123456",
                parent_owner_tag="BBB",
                root=root,
            )

            catalog_payload = json.loads((scenario_dir / "releasable_catalog.manual.json").read_text(encoding="utf-8"))
            self.assertTrue(result["ok"])
            self.assertEqual(
                [entry["tag"] for entry in catalog_payload["entries"]],
                ["OLD", "STALE", "MAN2", "AAA"],
            )
            self.assertEqual(catalog_payload["entries"][0]["display_name_en"], "Old Release")
            self.assertEqual(catalog_payload["entries"][1]["preset_source"]["feature_ids"], ["BBB-1"])
            self.assertEqual(catalog_payload["entries"][2]["preset_source"]["feature_ids"], ["DE-3"])
            self.assertEqual(catalog_payload["entries"][3]["tag"], "AAA")

    def test_save_scenario_district_groups_payload_rolls_back_when_manifest_write_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)
            original_write_json_atomic = scenario_context.write_json_atomic

            def failing_write_json_atomic(path: Path, payload: object, **kwargs: object) -> None:
                if Path(path) == scenario_dir / "manifest.json":
                    raise RuntimeError("manifest write failed")
                original_write_json_atomic(path, payload, **kwargs)

            with mock.patch.object(scenario_context, "write_json_atomic", side_effect=failing_write_json_atomic):
                with self.assertRaises(RuntimeError):
                    dev_server.save_scenario_district_groups_payload(
                        "test_scenario",
                        tag="AAA",
                        districts=[
                            {
                                "districtId": "berlin",
                                "nameEn": "Berlin",
                                "nameZh": "柏林",
                                "featureIds": ["DE-1", "DE-3"],
                            }
                        ],
                        root=root,
                    )

            manifest_payload = json.loads((scenario_dir / "manifest.json").read_text(encoding="utf-8"))
            self.assertFalse((scenario_dir / "district_groups.manual.json").exists())
            self.assertFalse((scenario_dir / "scenario_mutations.json").exists())
            self.assertNotIn("district_groups_url", manifest_payload)

    def test_save_scenario_geo_locale_entry_rolls_back_manual_overrides_on_builder_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)
            builder_script = root / "tools" / "failing_builder.py"
            _write_failing_geo_builder_script(builder_script, stderr="intentional failure")
            manual_path = scenario_dir / "geo_name_overrides.manual.json"
            original_manual_payload = {
                "version": 1,
                "scenario_id": "test_scenario",
                "generated_at": "before",
                "geo": {
                    "AAA-1": {
                        "en": "Original",
                        "zh": "原始",
                    }
                },
            }
            _write_json(manual_path, original_manual_payload)
            original_registry = dict(scenario_geo_locale_registry.GEO_LOCALE_BUILDER_BY_SCENARIO)
            scenario_geo_locale_registry.GEO_LOCALE_BUILDER_BY_SCENARIO = {
                "test_scenario": builder_script,
            }
            try:
                with self.assertRaises(dev_server.DevServerError) as exc_info:
                    dev_server.save_scenario_geo_locale_entry(
                        "test_scenario",
                        feature_id="AAA-1",
                        en="Updated",
                        zh="已更新",
                        root=root,
                    )
            finally:
                scenario_geo_locale_registry.GEO_LOCALE_BUILDER_BY_SCENARIO = original_registry

            manual_payload = json.loads(manual_path.read_text(encoding="utf-8"))
            mutations_path = scenario_dir / "scenario_mutations.json"
            self.assertEqual(exc_info.exception.code, "geo_locale_build_failed")
            self.assertEqual(manual_payload, original_manual_payload)
            self.assertFalse(mutations_path.exists())
            self.assertEqual(exc_info.exception.details["stderr"], "intentional failure")

    def test_save_scenario_ownership_payload_blocks_overlapping_save_until_first_commit_finishes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)
            owners_path = scenario_dir / "owners.by_feature.json"
            first_write_started = threading.Event()
            release_first_write = threading.Event()
            second_reached_write = threading.Event()
            original_write_json_atomic = dev_server.write_json_atomic
            results: dict[str, object] = {}

            def gated_write_json_atomic(path: Path, payload: object, **kwargs: object) -> None:
                current_name = threading.current_thread().name
                if Path(path) == owners_path and current_name == "first-save":
                    first_write_started.set()
                    self.assertTrue(release_first_write.wait(timeout=2.0))
                elif Path(path) == owners_path and current_name == "second-save":
                    second_reached_write.set()
                    raise RuntimeError("intentional ownership write failure")
                original_write_json_atomic(path, payload, **kwargs)

            def run_first() -> None:
                try:
                    results["first"] = dev_server.save_scenario_ownership_payload(
                        "test_scenario",
                        {"DE-1": "BBB"},
                        baseline_hash="baseline-123",
                        root=root,
                    )
                except Exception as exc:  # pragma: no cover - failure path asserted below
                    results["first_error"] = exc

            def run_second() -> None:
                try:
                    dev_server.save_scenario_ownership_payload(
                        "test_scenario",
                        {"DE-2": "AAA"},
                        baseline_hash="baseline-123",
                        root=root,
                    )
                except Exception as exc:
                    results["second_error"] = exc

            with mock.patch.object(scenario_context, "write_json_atomic", side_effect=gated_write_json_atomic):
                first_thread = threading.Thread(target=run_first, name="first-save", daemon=True)
                second_thread = threading.Thread(target=run_second, name="second-save", daemon=True)
                first_thread.start()
                self.assertTrue(first_write_started.wait(timeout=1.0))
                second_thread.start()
                time.sleep(0.35)
                self.assertFalse(
                    second_reached_write.is_set(),
                    "Second overlapping ownership save should stay blocked until the first transaction commits.",
                )
                release_first_write.set()
                first_thread.join(timeout=2.0)
                second_thread.join(timeout=2.0)

            self.assertNotIn("first_error", results)
            self.assertIsInstance(results.get("second_error"), RuntimeError)
            owners_payload = json.loads(owners_path.read_text(encoding="utf-8"))
            manual_payload = json.loads((scenario_dir / "scenario_manual_overrides.json").read_text(encoding="utf-8"))
            self.assertEqual(owners_payload["owners"]["DE-1"], "BBB")
            self.assertEqual(owners_payload["owners"]["DE-2"], "BBB")
            self.assertEqual(manual_payload["assignments"]["DE-1"]["owner"], "BBB")
            self.assertNotIn("DE-2", manual_payload["assignments"])

    def test_save_scenario_geo_locale_entry_blocks_overlapping_builder_and_preserves_committed_manual_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)
            builder_script = root / "tools" / "fake_builder.py"
            builder_script.parent.mkdir(parents=True, exist_ok=True)
            builder_script.write_text("# placeholder\n", encoding="utf-8")
            original_registry = dict(scenario_geo_locale_registry.GEO_LOCALE_BUILDER_BY_SCENARIO)
            first_builder_started = threading.Event()
            release_first_builder = threading.Event()
            second_builder_started = threading.Event()
            results: dict[str, object] = {}

            def fake_builder_run(command: list[str], **kwargs: object) -> mock.Mock:
                current_name = threading.current_thread().name
                manual_path = Path(command[command.index("--manual-overrides") + 1])
                output_path = Path(command[command.index("--output") + 1])
                manual_payload = json.loads(manual_path.read_text(encoding="utf-8"))
                if current_name == "first-geo-save":
                    first_builder_started.set()
                    self.assertTrue(release_first_builder.wait(timeout=2.0))
                    _write_json(
                        output_path,
                        {
                            "version": 1,
                            "scenario_id": "test_scenario",
                            "generated_at": "first-pass",
                            "geo": manual_payload.get("geo", {}),
                        },
                    )
                    return mock.Mock(returncode=0, stdout="", stderr="")
                second_builder_started.set()
                return mock.Mock(returncode=1, stdout="", stderr="intentional builder failure")

            def run_first() -> None:
                try:
                    results["first"] = dev_server.save_scenario_geo_locale_entry(
                        "test_scenario",
                        feature_id="AAA-1",
                        en="Alpha One",
                        zh="阿尔法一",
                        root=root,
                    )
                except Exception as exc:  # pragma: no cover - failure path asserted below
                    results["first_error"] = exc

            def run_second() -> None:
                try:
                    dev_server.save_scenario_geo_locale_entry(
                        "test_scenario",
                        feature_id="AAA-1",
                        en="Broken Update",
                        zh="错误更新",
                        root=root,
                    )
                except Exception as exc:
                    results["second_error"] = exc

            scenario_geo_locale_registry.GEO_LOCALE_BUILDER_BY_SCENARIO = {"test_scenario": builder_script}
            try:
                with mock.patch.object(
                    scenario_geo_locale_materializer.subprocess,
                    "run",
                    side_effect=fake_builder_run,
                ):
                    first_thread = threading.Thread(target=run_first, name="first-geo-save", daemon=True)
                    second_thread = threading.Thread(target=run_second, name="second-geo-save", daemon=True)
                    first_thread.start()
                    self.assertTrue(first_builder_started.wait(timeout=1.0))
                    second_thread.start()
                    time.sleep(0.15)
                    self.assertFalse(
                        second_builder_started.is_set(),
                        "Second geo locale save should not enter the builder while the first transaction is still active.",
                    )
                    release_first_builder.set()
                    first_thread.join(timeout=2.0)
                    second_thread.join(timeout=2.0)
            finally:
                scenario_geo_locale_registry.GEO_LOCALE_BUILDER_BY_SCENARIO = original_registry

            self.assertNotIn("first_error", results)
            self.assertIsInstance(results.get("second_error"), RuntimeError)
            self.assertIn("another scenario writer is active", str(results["second_error"]))
            manual_payload = json.loads((scenario_dir / "geo_name_overrides.manual.json").read_text(encoding="utf-8"))
            patch_payload = json.loads((scenario_dir / "geo_locale_patch.json").read_text(encoding="utf-8"))
            self.assertEqual(manual_payload["geo"]["AAA-1"]["en"], "Alpha One")
            self.assertEqual(manual_payload["geo"]["AAA-1"]["zh"], "阿尔法一")
            self.assertEqual(patch_payload["geo"]["AAA-1"]["en"], "Alpha One")
            self.assertEqual(patch_payload["generated_at"], "first-pass")


if __name__ == "__main__":
    unittest.main()
