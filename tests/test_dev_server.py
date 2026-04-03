from __future__ import annotations

import gzip
import io
import json
import os
import threading
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

from map_builder import config as cfg
from map_builder import scenario_geo_locale_materializer
from map_builder import scenario_materialization_service
from map_builder.scenario_political_materializer import build_political_materialization_transaction
from tools import dev_server


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_geo_builder_script(path: Path, *, generated_at: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(
            [
                "from __future__ import annotations",
                "import argparse, json",
                "from pathlib import Path",
                "parser = argparse.ArgumentParser()",
                "parser.add_argument('--scenario-id')",
                "parser.add_argument('--scenario-dir')",
                "parser.add_argument('--manual-overrides')",
                "parser.add_argument('--output')",
                "args = parser.parse_args()",
                "manual = json.loads(Path(args.manual_overrides).read_text(encoding='utf-8'))",
                "payload = {",
                "  'version': 1,",
                "  'scenario_id': args.scenario_id,",
                f"  'generated_at': {generated_at!r},",
                "  'geo': manual.get('geo', {}),",
                "}",
                "Path(args.output).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')",
            ]
        ),
        encoding="utf-8",
    )


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
    def _build_handler_for_static_response(
        self,
        *,
        target_path: Path,
        route: str | None = None,
        accept_encoding: str = "gzip",
    ) -> tuple[dev_server.Handler, list[tuple[str, object]]]:
        events: list[tuple[str, object]] = []
        handler = object.__new__(dev_server.Handler)
        handler.path = route or f"/{target_path.name}"
        handler.headers = {"Accept-Encoding": accept_encoding}
        handler.wfile = io.BytesIO()
        handler.translate_path = lambda _path: str(target_path)
        handler.guess_type = lambda _path: "application/json"
        handler.send_response = lambda status: events.append(("status", status))
        handler.send_header = lambda name, value: events.append(("header", (name, value)))
        handler.end_headers = lambda: events.append(("end_headers", None))
        return handler, events

    def _create_scenario_fixture(
        self,
        root: Path,
        scenario_id: str = "test_scenario",
        *,
        include_controllers: bool = True,
        include_cores: bool = True,
        geo_locale_builder_url: str | None = None,
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
        if include_controllers:
            manifest_payload["controllers_url"] = f"data/scenarios/{scenario_id}/controllers.by_feature.json"
        if include_cores:
            manifest_payload["cores_url"] = f"data/scenarios/{scenario_id}/cores.by_feature.json"
        if geo_locale_builder_url:
            manifest_payload["geo_locale_builder_url"] = geo_locale_builder_url
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
        if include_controllers:
            _write_json(
                scenario_dir / "controllers.by_feature.json",
                {
                    "controllers": {
                        "DE-1": "AAA",
                        "DE-2": "BBB",
                        "DE-3": "AAA",
                        "AAA-1": "AAA",
                        "BBB-2": "BBB",
                    },
                    "baseline_hash": "baseline-123",
                },
            )
        _write_json(
            scenario_dir / "owners.by_feature.json",
            {
                "owners": {
                    "DE-1": "AAA",
                    "DE-2": "BBB",
                    "DE-3": "AAA",
                    "AAA-1": "AAA",
                    "BBB-2": "BBB",
                },
                "baseline_hash": "baseline-123",
            },
        )
        if include_cores:
            _write_json(
                scenario_dir / "cores.by_feature.json",
                {
                    "cores": {
                        "DE-1": ["AAA"],
                        "DE-2": ["BBB"],
                        "DE-3": ["AAA"],
                        "AAA-1": ["AAA"],
                        "BBB-2": ["BBB"],
                    },
                    "baseline_hash": "baseline-123",
                },
            )
        _write_json(
            scenario_dir / "geo_locale_patch.json",
            {
                "version": 1,
                "scenario_id": scenario_id,
                "generated_at": "",
                "geo": {},
            },
        )
        _write_json(
            scenario_dir / cfg.SCENARIO_CITY_ASSETS_PARTIAL_FILENAME,
            {
                "version": 1,
                "scenario_id": scenario_id,
                "generated_at": "",
                "cities": {},
                "audit": {
                    "renamed_city_count": 0,
                    "name_conflict_count": 0,
                    "unresolved_city_rename_count": 0,
                    "name_conflicts": [],
                    "unresolved_city_renames": [],
                },
            },
        )
        _write_json(
            scenario_dir / cfg.SCENARIO_CAPITAL_DEFAULTS_PARTIAL_FILENAME,
            {
                "version": 1,
                "scenario_id": scenario_id,
                "generated_at": "",
                "capitals_by_tag": {},
                "capital_city_hints": {},
                "audit": {},
            },
        )
        return scenario_dir

    def test_dev_server_tcp_server_handles_parallel_requests(self) -> None:
        slow_started = threading.Event()
        release_slow = threading.Event()

        class ParallelProbeHandler(dev_server.http.server.BaseHTTPRequestHandler):
            def log_message(self, format: str, *args) -> None:  # noqa: A003
                return

            def do_GET(self) -> None:  # noqa: N802
                if self.path == "/slow":
                    slow_started.set()
                    release_slow.wait(timeout=2.0)
                    body = b"slow"
                elif self.path == "/fast":
                    body = b"fast"
                else:
                    body = b"missing"
                    self.send_response(404)
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        httpd = dev_server.DevServerTCPServer((dev_server.BIND_ADDRESS, 0), ParallelProbeHandler)
        server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        server_thread.start()

        try:
            port = httpd.server_address[1]
            slow_result: dict[str, object] = {}

            def run_slow_request() -> None:
                with urllib.request.urlopen(
                    f"http://{dev_server.BIND_ADDRESS}:{port}/slow",
                    timeout=2.0,
                ) as response:
                    slow_result["status"] = response.status
                    slow_result["body"] = response.read().decode("utf-8")

            slow_thread = threading.Thread(target=run_slow_request, daemon=True)
            slow_thread.start()
            self.assertTrue(slow_started.wait(timeout=1.0))

            fast_started_at = time.perf_counter()
            with urllib.request.urlopen(
                f"http://{dev_server.BIND_ADDRESS}:{port}/fast",
                timeout=1.0,
            ) as response:
                fast_body = response.read().decode("utf-8")
                fast_status = response.status
            fast_elapsed = time.perf_counter() - fast_started_at

            release_slow.set()
            slow_thread.join(timeout=1.0)

            self.assertEqual(fast_status, 200)
            self.assertEqual(fast_body, "fast")
            self.assertLess(
                fast_elapsed,
                0.25,
                "Fast request should not wait for a slow in-flight request.",
            )
            self.assertEqual(slow_result, {"status": 200, "body": "slow"})
        finally:
            release_slow.set()
            httpd.shutdown()
            httpd.server_close()
            server_thread.join(timeout=1.0)

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
            self.assertEqual(manual_payload["assignments"]["DE-1"]["controller"], "AAA")
            self.assertEqual(manual_payload["assignments"]["DE-1"]["cores"], ["AAA"])
            self.assertEqual(mutations_payload["assignments_by_feature_id"]["DE-1"]["owner"], "BBB")
            self.assertEqual(result["mutationsPath"], "data/scenarios/test_scenario/scenario_mutations.json")
            self.assertEqual(result["stats"]["featureCount"], 5)
            self.assertEqual(result["stats"]["touchedFeatureCount"], 2)

    def test_political_materializer_builds_transaction_from_mutations_payload(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            self._create_scenario_fixture(root)
            context = dev_server.load_scenario_context("test_scenario", root=root)
            mutations_payload = dev_server._load_scenario_mutations_payload(context)
            mutations_payload["countries"]["AAA"] = {
                "mode": "override",
                "display_name_en": "Alpha Prime",
                "display_name_zh": "阿尔法首府",
                "color_hex": "#654321",
                "parent_owner_tag": "BBB",
            }
            mutations_payload["assignments_by_feature_id"]["DE-1"] = {"owner": "BBB"}

            transaction_payloads, materialized = build_political_materialization_transaction(
                context,
                mutations_payload,
                root=root,
                deps=dev_server._political_materializer_deps(),
            )

            transaction_names = {path.name for path, _payload in transaction_payloads}
            self.assertIn("scenario_mutations.json", transaction_names)
            self.assertIn("countries.json", transaction_names)
            self.assertIn("owners.by_feature.json", transaction_names)
            self.assertIn("scenario_manual_overrides.json", transaction_names)
            self.assertEqual(
                materialized["countriesPayload"]["countries"]["AAA"]["display_name_en"],
                "Alpha Prime",
            )
            self.assertEqual(
                materialized["ownersPayload"]["owners"]["DE-1"],
                "BBB",
            )
            self.assertEqual(
                materialized["manualPayload"]["assignments"]["DE-1"]["owner"],
                "BBB",
            )

    def test_political_materializer_derives_manual_payload_without_reading_existing_manual_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)
            _write_json(
                scenario_dir / "scenario_manual_overrides.json",
                {
                    "version": 1,
                    "scenario_id": "test_scenario",
                    "generated_at": "stale",
                    "countries": {
                        "ZZZ": {"mode": "override", "display_name_en": "Stale"},
                    },
                    "assignments": {
                        "BBB-1": {"owner": "AAA"},
                    },
                },
            )
            context = dev_server.load_scenario_context("test_scenario", root=root)
            mutations_payload = dev_server._load_scenario_mutations_payload(context)
            mutations_payload["countries"]["AAA"] = {
                "mode": "override",
                "display_name_en": "Alpha Prime",
                "display_name_zh": "阿尔法首都",
                "color_hex": "#654321",
            }
            mutations_payload["assignments_by_feature_id"]["AAA-1"] = {"owner": "BBB"}

            _transaction_payloads, materialized = build_political_materialization_transaction(
                context,
                mutations_payload,
                root=root,
                deps=dev_server._political_materializer_deps(),
            )

            self.assertEqual(
                sorted(materialized["manualPayload"]["countries"].keys()),
                ["AAA"],
            )
            self.assertEqual(
                sorted(materialized["manualPayload"]["assignments"].keys()),
                ["AAA-1"],
            )
            self.assertNotIn("ZZZ", materialized["manualPayload"]["countries"])
            self.assertNotIn("BBB-1", materialized["manualPayload"]["assignments"])

    def test_save_scenario_capital_payload_materializes_capital_from_mutations(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)

            result = dev_server.save_scenario_capital_payload(
                "test_scenario",
                tag="AAA",
                feature_id="AAA-1",
                city_id="alpha-city",
                capital_state_id=101,
                city_name="Alpha City",
                stable_key="id::alpha-city",
                country_code="AA",
                lookup_iso2="AA",
                base_iso2="AA",
                capital_kind="primary_capital",
                population=12345,
                lon=12.34,
                lat=56.78,
                urban_match_id="urban-alpha",
                base_tier="city",
                name_ascii="Alpha City",
                root=root,
            )

            countries_payload = json.loads((scenario_dir / "countries.json").read_text(encoding="utf-8"))
            manual_payload = json.loads((scenario_dir / "scenario_manual_overrides.json").read_text(encoding="utf-8"))
            city_overrides_payload = json.loads((scenario_dir / "city_overrides.json").read_text(encoding="utf-8"))
            mutations_payload = json.loads((scenario_dir / "scenario_mutations.json").read_text(encoding="utf-8"))

            self.assertTrue(result["ok"])
            self.assertEqual(countries_payload["countries"]["AAA"]["capital_state_id"], 101)
            self.assertEqual(manual_payload["countries"]["AAA"]["capital_state_id"], 101)
            self.assertEqual(mutations_payload["capitals"]["AAA"]["feature_id"], "AAA-1")
            self.assertEqual(city_overrides_payload["capitals_by_tag"]["AAA"], "alpha-city")
            self.assertEqual(city_overrides_payload["capital_city_hints"]["AAA"]["city_name"], "Alpha City")
            self.assertEqual(result["cityOverrideEntry"]["city_id"], "alpha-city")
            self.assertEqual(result["mutationsPath"], "data/scenarios/test_scenario/scenario_mutations.json")

    def test_save_scenario_capital_payload_seeds_previous_hint_from_defaults_partial(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)
            _write_json(
                scenario_dir / cfg.SCENARIO_CAPITAL_DEFAULTS_PARTIAL_FILENAME,
                {
                    "version": 1,
                    "scenario_id": "test_scenario",
                    "generated_at": "defaults-pass",
                    "capitals_by_tag": {"AAA": "alpha-default"},
                    "capital_city_hints": {
                        "AAA": {
                            "tag": "AAA",
                            "city_id": "alpha-default",
                            "city_name": "Alpha Default",
                            "name_ascii": "Alpha Default",
                            "stable_key": "id::alpha-default",
                            "country_code": "AA",
                            "lookup_iso2": "AA",
                            "base_iso2": "AA",
                            "capital_kind": "primary_capital",
                            "population": 12345,
                            "lon": 12.34,
                            "lat": 56.78,
                            "urban_match_id": "urban-alpha",
                            "base_tier": "city",
                            "host_feature_id": "AAA-1",
                        }
                    },
                    "audit": {},
                },
            )

            result = dev_server.save_scenario_capital_payload(
                "test_scenario",
                tag="AAA",
                feature_id="AAA-1",
                city_id="alpha-default",
                capital_state_id=101,
                root=root,
            )

            city_overrides_payload = json.loads((scenario_dir / "city_overrides.json").read_text(encoding="utf-8"))
            hint = city_overrides_payload["capital_city_hints"]["AAA"]
            self.assertTrue(result["ok"])
            self.assertEqual(hint["city_name"], "Alpha Default")
            self.assertEqual(hint["name_ascii"], "Alpha Default")
            self.assertEqual(hint["population"], 12345)
            self.assertEqual(hint["base_tier"], "city")
            self.assertEqual(hint["urban_match_id"], "urban-alpha")
            self.assertEqual(hint["lookup_iso2"], "AA")
            self.assertEqual(hint["country_code"], "AA")

    def test_save_scenario_capital_payload_ignores_stale_city_override_capital_sections(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)
            _write_json(
                scenario_dir / "city_overrides.json",
                {
                    "version": 1,
                    "scenario_id": "test_scenario",
                    "generated_at": "stale-pass",
                    "capitals_by_tag": {"AAA": "stale-city"},
                    "capital_city_hints": {
                        "AAA": {
                            "tag": "AAA",
                            "city_id": "stale-city",
                            "city_name": "Stale City",
                            "host_feature_id": "AAA-1",
                        }
                    },
                    "cities": {
                        "CITY::legacy": {
                            "display_name": {"en": "Legacy City", "zh": "鏃у煄"},
                            "aliases": ["Legacy City"],
                        }
                    },
                    "audit": {
                        "renamed_city_count": 1,
                        "name_conflict_count": 0,
                    },
                },
            )
            _write_json(
                scenario_dir / cfg.SCENARIO_CAPITAL_DEFAULTS_PARTIAL_FILENAME,
                {
                    "version": 1,
                    "scenario_id": "test_scenario",
                    "generated_at": "defaults-pass",
                    "capitals_by_tag": {"BBB": "beta-default"},
                    "capital_city_hints": {
                        "BBB": {
                            "tag": "BBB",
                            "city_id": "beta-default",
                            "city_name": "Beta City",
                            "host_feature_id": "BBB-2",
                        }
                    },
                    "audit": {},
                },
            )
            _write_json(
                scenario_dir / "capital_hints.json",
                {
                    "version": 1,
                    "scenario_id": "test_scenario",
                    "generated_at": "defaults-pass",
                    "entry_count": 1,
                    "missing_tag_count": 0,
                    "missing_tags": [],
                    "entries": [
                        {
                            "tag": "BBB",
                            "city_id": "beta-default",
                            "city_name": "Beta City",
                            "host_feature_id": "BBB-2",
                        }
                    ],
                    "audit": {},
                },
            )

            result = dev_server.save_scenario_capital_payload(
                "test_scenario",
                tag="AAA",
                feature_id="AAA-1",
                city_id="alpha-city",
                capital_state_id=101,
                city_name="Alpha City",
                stable_key="id::alpha-city",
                country_code="AA",
                lookup_iso2="AA",
                base_iso2="AA",
                capital_kind="primary_capital",
                population=12345,
                lon=12.34,
                lat=56.78,
                urban_match_id="urban-alpha",
                base_tier="city",
                name_ascii="Alpha City",
                root=root,
            )

            city_overrides_payload = json.loads((scenario_dir / "city_overrides.json").read_text(encoding="utf-8"))
            self.assertTrue(result["ok"])
            self.assertEqual(city_overrides_payload["capitals_by_tag"]["AAA"], "alpha-city")
            self.assertEqual(city_overrides_payload["capital_city_hints"]["AAA"]["city_name"], "Alpha City")
            self.assertEqual(city_overrides_payload["capitals_by_tag"]["BBB"], "beta-default")
            self.assertEqual(city_overrides_payload["cities"], {})
            self.assertNotEqual(city_overrides_payload["capital_city_hints"]["AAA"]["city_id"], "stale-city")

    def test_save_scenario_capital_payload_prefers_city_assets_partial_over_stale_city_overrides(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)
            _write_json(
                scenario_dir / "city_overrides.json",
                {
                    "version": 1,
                    "scenario_id": "test_scenario",
                    "generated_at": "stale-cities",
                    "cities": {
                        "CITY::legacy": {
                            "display_name": {"en": "Legacy City", "zh": "鏃у煄"},
                            "aliases": ["Legacy City"],
                        }
                    },
                    "audit": {"renamed_city_count": 1, "name_conflict_count": 0},
                },
            )
            _write_json(
                scenario_dir / cfg.SCENARIO_CITY_ASSETS_PARTIAL_FILENAME,
                {
                    "version": 1,
                    "scenario_id": "test_scenario",
                    "generated_at": "partial-cities",
                    "cities": {
                        "CITY::partial": {
                            "display_name": {"en": "Partial City", "zh": "閮ㄥ垎鍩庡競"},
                            "aliases": ["Partial City"],
                        }
                    },
                    "audit": {"renamed_city_count": 1, "name_conflict_count": 0},
                },
            )

            result = dev_server.save_scenario_capital_payload(
                "test_scenario",
                tag="AAA",
                feature_id="AAA-1",
                city_id="alpha-city",
                capital_state_id=101,
                city_name="Alpha City",
                stable_key="id::alpha-city",
                country_code="AA",
                lookup_iso2="AA",
                base_iso2="AA",
                capital_kind="primary_capital",
                population=12345,
                lon=12.34,
                lat=56.78,
                urban_match_id="urban-alpha",
                base_tier="city",
                name_ascii="Alpha City",
                root=root,
            )

            city_overrides_payload = json.loads((scenario_dir / "city_overrides.json").read_text(encoding="utf-8"))
            self.assertTrue(result["ok"])
            self.assertIn("CITY::partial", city_overrides_payload["cities"])
            self.assertNotIn("CITY::legacy", city_overrides_payload["cities"])

    def test_save_scenario_capital_payload_requires_city_assets_partial(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)
            city_assets_partial_path = scenario_dir / cfg.SCENARIO_CITY_ASSETS_PARTIAL_FILENAME
            city_assets_partial_path.unlink()

            with self.assertRaises(dev_server.DevServerError) as exc_info:
                dev_server.save_scenario_capital_payload(
                    "test_scenario",
                    tag="AAA",
                    feature_id="AAA-1",
                    city_id="alpha-city",
                    capital_state_id=101,
                    city_name="Alpha City",
                    stable_key="id::alpha-city",
                    country_code="AA",
                    lookup_iso2="AA",
                    base_iso2="AA",
                    capital_kind="primary_capital",
                    population=12345,
                    lon=12.34,
                    lat=56.78,
                    urban_match_id="urban-alpha",
                    base_tier="city",
                    name_ascii="Alpha City",
                    root=root,
                )

            error = exc_info.exception
            self.assertEqual(error.code, "missing_city_assets_partial")
            self.assertEqual(error.details["scenarioId"], "test_scenario")
            self.assertEqual(error.details["path"], str(city_assets_partial_path))

    def test_save_scenario_capital_payload_requires_capital_defaults_partial(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)
            capital_defaults_partial_path = scenario_dir / cfg.SCENARIO_CAPITAL_DEFAULTS_PARTIAL_FILENAME
            capital_defaults_partial_path.unlink()

            with self.assertRaises(dev_server.DevServerError) as exc_info:
                dev_server.save_scenario_capital_payload(
                    "test_scenario",
                    tag="AAA",
                    feature_id="AAA-1",
                    city_id="alpha-city",
                    capital_state_id=101,
                    city_name="Alpha City",
                    stable_key="id::alpha-city",
                    country_code="AA",
                    lookup_iso2="AA",
                    base_iso2="AA",
                    capital_kind="primary_capital",
                    population=12345,
                    lon=12.34,
                    lat=56.78,
                    urban_match_id="urban-alpha",
                    base_tier="city",
                    name_ascii="Alpha City",
                    root=root,
                )

            error = exc_info.exception
            self.assertEqual(error.code, "missing_capital_defaults_partial")
            self.assertEqual(error.details["scenarioId"], "test_scenario")
            self.assertEqual(error.details["path"], str(capital_defaults_partial_path))

    def test_save_scenario_capital_payload_ignores_stale_capital_hints_when_defaults_partial_exists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)
            _write_json(
                scenario_dir / cfg.SCENARIO_CAPITAL_DEFAULTS_PARTIAL_FILENAME,
                {
                    "version": 1,
                    "scenario_id": "test_scenario",
                    "generated_at": "defaults-partial-pass",
                    "capitals_by_tag": {"BBB": "beta-from-partial"},
                    "capital_city_hints": {
                        "BBB": {
                            "tag": "BBB",
                            "city_id": "beta-from-partial",
                            "city_name": "Beta Partial",
                            "host_feature_id": "BBB-2",
                        }
                    },
                    "audit": {},
                },
            )
            _write_json(
                scenario_dir / "capital_hints.json",
                {
                    "version": 1,
                    "scenario_id": "test_scenario",
                    "generated_at": "stale-hints-pass",
                    "entry_count": 1,
                    "missing_tag_count": 0,
                    "missing_tags": [],
                    "entries": [
                        {
                            "tag": "BBB",
                            "city_id": "beta-from-hints",
                            "city_name": "Beta Hints",
                            "host_feature_id": "BBB-2",
                        }
                    ],
                    "audit": {},
                },
            )

            result = dev_server.save_scenario_capital_payload(
                "test_scenario",
                tag="AAA",
                feature_id="AAA-1",
                city_id="alpha-city",
                capital_state_id=101,
                city_name="Alpha City",
                stable_key="id::alpha-city",
                country_code="AA",
                lookup_iso2="AA",
                base_iso2="AA",
                capital_kind="primary_capital",
                population=12345,
                lon=12.34,
                lat=56.78,
                urban_match_id="urban-alpha",
                base_tier="city",
                name_ascii="Alpha City",
                root=root,
            )

            city_overrides_payload = json.loads((scenario_dir / "city_overrides.json").read_text(encoding="utf-8"))
            self.assertTrue(result["ok"])
            self.assertEqual(city_overrides_payload["capitals_by_tag"]["BBB"], "beta-from-partial")
            self.assertEqual(city_overrides_payload["capital_city_hints"]["BBB"]["city_name"], "Beta Partial")

    def test_save_scenario_geo_locale_entry_uses_in_process_materializer_for_tno(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root, scenario_id="tno_1962")
            published_patch_payload = {
                "version": 1,
                "scenario_id": "tno_1962",
                "generated_at": "in-process-pass",
                "geo": {"AAA-1": {"en": "Alpha One", "zh": "阿尔法一"}},
            }

            def fake_materialize(context: dict[str, object], *, root: Path, error_cls: type[Exception], fallback_builder_path=None, checkpoint_dir=None) -> dict[str, object]:
                return {"checkpointPaths": ["checkpoint/geo_locale_patch.json"], "buildMode": "in_process"}

            def fake_publish(context: dict[str, object], *, target: str, root: Path, checkpoint_dir=None) -> dict[str, object]:
                if target == "geo-locale":
                    _write_json(Path(context["geoLocalePatchPath"]), published_patch_payload)
                return {"target": target}

            with (
                mock.patch.object(
                    scenario_materialization_service,
                    "materialize_scenario_geo_locale",
                    side_effect=fake_materialize,
                ) as materialize_mock,
                mock.patch.object(
                    dev_server,
                    "publish_scenario_outputs_in_locked_context",
                    side_effect=fake_publish,
                ) as publish_mock,
            ):
                result = dev_server.save_scenario_geo_locale_entry(
                    "tno_1962",
                    feature_id="AAA-1",
                    en="Alpha One",
                    zh="阿尔法一",
                    root=root,
                )

            manual_payload = json.loads((scenario_dir / "geo_name_overrides.manual.json").read_text(encoding="utf-8"))
            mutations_payload = json.loads((scenario_dir / "scenario_mutations.json").read_text(encoding="utf-8"))
            self.assertTrue(result["ok"])
            self.assertEqual(manual_payload["geo"]["AAA-1"]["en"], "Alpha One")
            self.assertEqual(mutations_payload["geo_locale"]["AAA-1"]["zh"], "阿尔法一")
            self.assertEqual(result["entry"]["en"], "Alpha One")
            materialize_mock.assert_called_once()
            self.assertEqual(publish_mock.call_count, 2)

    def test_validate_country_code_accepts_two_or_three_uppercase_letters_and_rejects_invalid_values(self) -> None:
        self.assertEqual(dev_server._validate_country_code("de"), "DE")
        self.assertEqual(dev_server._validate_country_code("USA"), "USA")
        with self.assertRaises(dev_server.DevServerError) as exc_info:
            dev_server._validate_country_code("A1")

        self.assertEqual(exc_info.exception.code, "invalid_country_code")

    def test_load_scenario_context_accepts_locale_specific_geo_patch_urls(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)
            manifest_path = scenario_dir / "manifest.json"
            manifest_payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest_payload.pop("geo_locale_patch_url", None)
            manifest_payload["geo_locale_patch_url_en"] = "data/scenarios/test_scenario/geo_locale_patch.en.json"
            manifest_payload["geo_locale_patch_url_zh"] = "data/scenarios/test_scenario/geo_locale_patch.zh.json"
            _write_json(manifest_path, manifest_payload)
            _write_json(
                scenario_dir / "geo_locale_patch.en.json",
                {
                    "version": 1,
                    "scenario_id": "test_scenario",
                    "language": "en",
                    "geo": {},
                },
            )
            _write_json(
                scenario_dir / "geo_locale_patch.zh.json",
                {
                    "version": 1,
                    "scenario_id": "test_scenario",
                    "language": "zh",
                    "geo": {},
                },
            )

            context = dev_server.load_scenario_context("test_scenario", root=root)

            self.assertEqual(context["geoLocalePatchPath"], scenario_dir / "geo_locale_patch.en.json")

    def test_normalize_optional_float_accepts_finite_values_and_rejects_non_finite(self) -> None:
        self.assertEqual(dev_server._normalize_optional_float("12.5"), 12.5)
        self.assertIsNone(dev_server._normalize_optional_float(""))
        with self.assertRaises(dev_server.DevServerError) as exc_info:
            dev_server._normalize_optional_float("inf")

        self.assertEqual(exc_info.exception.code, "invalid_number")

    def test_load_scenario_tag_feature_ids_uses_owners_only_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            self._create_scenario_fixture(root, include_controllers=False, include_cores=False)

            with mock.patch.object(dev_server, "_load_political_payload_bundle", side_effect=AssertionError("bundle should not be used")):
                feature_ids = dev_server._load_scenario_tag_feature_ids(
                    dev_server.load_scenario_context("test_scenario", root=root),
                    "AAA",
                )

            self.assertEqual(feature_ids, {"DE-1", "DE-3", "AAA-1"})

    def test_save_scenario_tag_create_payload_bootstraps_local_catalog_and_updates_political_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            source_catalog_url = "data/releasables/test_scenario.source.catalog.json"
            scenario_dir = self._create_scenario_fixture(
                root,
                releasable_catalog_url=source_catalog_url,
            )
            _write_json(
                root / source_catalog_url,
                {
                    "version": 1,
                    "catalog_id": "test_scenario.source",
                    "generated_at": "2026-03-19T00:00:00Z",
                    "scenario_ids": ["test_scenario"],
                    "entries": [
                        {
                            "tag": "OLD",
                            "display_name": "Old Release",
                            "display_name_en": "Old Release",
                            "display_name_zh": "\u65e7\u91ca\u653e",
                            "color_hex": "#111111",
                            "entry_kind": "releasable",
                            "scenario_ids": ["test_scenario"],
                            "scenario_only": True,
                            "allow_manual_overlay": True,
                            "preset_source": {
                                "type": "feature_ids",
                                "name": "",
                                "group_ids": [],
                                "feature_ids": ["AAA-1"],
                            },
                            "boundary_variants": [],
                            "parent_owner_tag": "AAA",
                            "parent_owner_tags": ["AAA"],
                        }
                    ],
                },
            )

            result = dev_server.save_scenario_tag_create_payload(
                "test_scenario",
                feature_ids=["DE-1", "DE-2"],
                tag="CCC",
                name_en="Caledonia",
                name_zh="\u5361\u83b1\u591a\u5c3c\u4e9a",
                color_hex="#123456",
                parent_owner_tag="AAA",
                root=root,
            )

            countries_payload = json.loads((scenario_dir / "countries.json").read_text(encoding="utf-8"))
            owners_payload = json.loads((scenario_dir / "owners.by_feature.json").read_text(encoding="utf-8"))
            controllers_payload = json.loads((scenario_dir / "controllers.by_feature.json").read_text(encoding="utf-8"))
            cores_payload = json.loads((scenario_dir / "cores.by_feature.json").read_text(encoding="utf-8"))
            manual_payload = json.loads((scenario_dir / "scenario_manual_overrides.json").read_text(encoding="utf-8"))
            manifest_payload = json.loads((scenario_dir / "manifest.json").read_text(encoding="utf-8"))
            catalog_payload = json.loads((scenario_dir / "releasable_catalog.manual.json").read_text(encoding="utf-8"))
            mutations_payload = json.loads((scenario_dir / "scenario_mutations.json").read_text(encoding="utf-8"))
            created_country = countries_payload["countries"]["CCC"]

            self.assertTrue(result["ok"])
            self.assertEqual(created_country["display_name"], "Caledonia")
            self.assertEqual(created_country["display_name_en"], "Caledonia")
            self.assertEqual(created_country["display_name_zh"], "\u5361\u83b1\u591a\u5c3c\u4e9a")
            self.assertEqual(created_country["parent_owner_tag"], "AAA")
            self.assertEqual(owners_payload["owners"]["DE-1"], "CCC")
            self.assertEqual(owners_payload["owners"]["DE-2"], "CCC")
            self.assertEqual(controllers_payload["controllers"]["DE-1"], "CCC")
            self.assertEqual(controllers_payload["controllers"]["DE-2"], "CCC")
            self.assertEqual(cores_payload["cores"]["DE-1"], ["CCC"])
            self.assertEqual(manual_payload["countries"]["CCC"]["mode"], "create")
            self.assertEqual(manual_payload["assignments"]["DE-1"]["owner"], "CCC")
            self.assertEqual(manual_payload["assignments"]["DE-1"]["controller"], "CCC")
            self.assertEqual(manual_payload["assignments"]["DE-1"]["cores"], ["CCC"])
            self.assertEqual(mutations_payload["tags"]["CCC"]["feature_ids"], ["DE-1", "DE-2"])
            self.assertEqual(mutations_payload["countries"]["CCC"]["mode"], "create")
            self.assertEqual(manifest_payload["releasable_catalog_url"], "data/scenarios/test_scenario/releasable_catalog.manual.json")
            self.assertEqual(catalog_payload["entries"][0]["tag"], "OLD")
            self.assertEqual(catalog_payload["entries"][1]["tag"], "CCC")
            self.assertEqual(catalog_payload["entries"][1]["parent_owner_tag"], "AAA")
            self.assertEqual(catalog_payload["entries"][1]["preset_source"]["feature_ids"], ["DE-1", "DE-2"])

    @unittest.skip("Replaced by preservation of untouched local-only manual catalog entries.")
    def test_save_scenario_tag_create_payload_ignores_stale_local_catalog_when_deriving_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            source_catalog_url = "data/releasables/test_scenario.source.catalog.json"
            scenario_dir = self._create_scenario_fixture(
                root,
                releasable_catalog_url=source_catalog_url,
            )
            _write_json(
                root / source_catalog_url,
                {
                    "version": 1,
                    "catalog_id": "test_scenario.source",
                    "generated_at": "2026-03-19T00:00:00Z",
                    "scenario_ids": ["test_scenario"],
                    "entries": [
                        {
                            "tag": "OLD",
                            "display_name": "Old Release",
                            "display_name_en": "Old Release",
                            "display_name_zh": "旧释放",
                            "color_hex": "#111111",
                            "entry_kind": "releasable",
                            "scenario_ids": ["test_scenario"],
                            "scenario_only": True,
                            "allow_manual_overlay": True,
                            "preset_source": {
                                "type": "feature_ids",
                                "name": "",
                                "group_ids": [],
                                "feature_ids": ["AAA-1"],
                            },
                            "boundary_variants": [],
                            "parent_owner_tag": "AAA",
                            "parent_owner_tags": ["AAA"],
                        }
                    ],
                },
            )
            _write_json(
                scenario_dir / "releasable_catalog.manual.json",
                {
                    "version": 1,
                    "catalog_id": "test_scenario.manual",
                    "generated_at": "stale",
                    "scenario_ids": ["test_scenario"],
                    "entries": [
                        {
                            "tag": "STALE",
                            "display_name": "Stale",
                            "display_name_en": "Stale",
                            "display_name_zh": "陈旧",
                            "color_hex": "#999999",
                            "entry_kind": "releasable",
                            "scenario_ids": ["test_scenario"],
                            "scenario_only": True,
                            "allow_manual_overlay": True,
                            "preset_source": {
                                "type": "feature_ids",
                                "name": "",
                                "group_ids": [],
                                "feature_ids": ["BBB-1"],
                            },
                            "boundary_variants": [],
                            "parent_owner_tag": "BBB",
                            "parent_owner_tags": ["BBB"],
                        }
                    ],
                },
            )

            result = dev_server.save_scenario_tag_create_payload(
                "test_scenario",
                feature_ids=["DE-1", "DE-2"],
                tag="CCC",
                name_en="Caledonia",
                name_zh="卡莱多尼亚",
                color_hex="#123456",
                parent_owner_tag="AAA",
                root=root,
            )

            catalog_payload = json.loads((scenario_dir / "releasable_catalog.manual.json").read_text(encoding="utf-8"))
            self.assertTrue(result["ok"])
            self.assertEqual(
                [entry["tag"] for entry in catalog_payload["entries"]],
                ["OLD", "CCC"],
            )
            self.assertNotIn(
                "STALE",
                {entry["tag"] for entry in catalog_payload["entries"]},
            )

    def test_save_scenario_country_payload_preserves_untouched_local_manual_catalog_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            source_catalog_url = "data/releasables/test_scenario.source.catalog.json"
            scenario_dir = self._create_scenario_fixture(
                root,
                releasable_catalog_url=source_catalog_url,
            )
            _write_json(
                root / source_catalog_url,
                {
                    "version": 1,
                    "catalog_id": "test_scenario.source",
                    "generated_at": "2026-03-19T00:00:00Z",
                    "scenario_ids": ["test_scenario"],
                    "entries": [
                        {
                            "tag": "OLD",
                            "display_name": "Old Release",
                            "display_name_en": "Old Release",
                            "display_name_zh": "Old Release Zh",
                            "color_hex": "#111111",
                            "entry_kind": "releasable",
                            "scenario_ids": ["test_scenario"],
                            "scenario_only": True,
                            "allow_manual_overlay": True,
                            "preset_source": {
                                "type": "feature_ids",
                                "name": "",
                                "group_ids": [],
                                "feature_ids": ["AAA-1"],
                            },
                            "boundary_variants": [],
                            "parent_owner_tag": "AAA",
                            "parent_owner_tags": ["AAA"],
                        }
                    ],
                },
            )
            _write_json(
                scenario_dir / "releasable_catalog.manual.json",
                {
                    "version": 1,
                    "catalog_id": "test_scenario.manual",
                    "generated_at": "stale",
                    "scenario_ids": ["test_scenario"],
                    "entries": [
                        {
                            "tag": "OLD",
                            "display_name": "Old Release Local",
                            "display_name_en": "Old Release Local",
                            "display_name_zh": "Old Release Local Zh",
                            "color_hex": "#999999",
                            "entry_kind": "releasable",
                            "scenario_ids": ["test_scenario"],
                            "scenario_only": True,
                            "allow_manual_overlay": True,
                            "preset_source": {
                                "type": "feature_ids",
                                "name": "",
                                "group_ids": [],
                                "feature_ids": ["BBB-1"],
                            },
                            "boundary_variants": [],
                            "parent_owner_tag": "BBB",
                            "parent_owner_tags": ["BBB"],
                        },
                        {
                            "tag": "STALE",
                            "display_name": "Stale",
                            "display_name_en": "Stale",
                            "display_name_zh": "Stale Zh",
                            "color_hex": "#999999",
                            "entry_kind": "releasable",
                            "scenario_ids": ["test_scenario"],
                            "scenario_only": True,
                            "allow_manual_overlay": True,
                            "preset_source": {
                                "type": "feature_ids",
                                "name": "",
                                "group_ids": [],
                                "feature_ids": ["BBB-1"],
                            },
                            "boundary_variants": [],
                            "parent_owner_tag": "BBB",
                            "parent_owner_tags": ["BBB"],
                        },
                        {
                            "tag": "MAN2",
                            "display_name": "Manual Two",
                            "display_name_en": "Manual Two",
                            "display_name_zh": "Manual Two Zh",
                            "color_hex": "#777777",
                            "entry_kind": "releasable",
                            "scenario_ids": ["test_scenario"],
                            "scenario_only": True,
                            "allow_manual_overlay": True,
                            "preset_source": {
                                "type": "feature_ids",
                                "name": "",
                                "group_ids": [],
                                "feature_ids": ["DE-3"],
                            },
                            "boundary_variants": [],
                            "parent_owner_tag": "AAA",
                            "parent_owner_tags": ["AAA"],
                        },
                    ],
                },
            )

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

    def test_load_scenario_context_allows_shared_releasable_catalog_under_data_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            source_catalog_url = "data/releasables/test_scenario.source.catalog.json"
            self._create_scenario_fixture(
                root,
                releasable_catalog_url=source_catalog_url,
            )

            context = dev_server.load_scenario_context("test_scenario", root=root)

            self.assertEqual(
                context["releasableCatalogPath"],
                (root / source_catalog_url).resolve(),
            )

    def test_load_scenario_context_allows_geo_locale_builder_under_tools_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            builder_path = root / "tools" / "override_builder.py"
            _write_geo_builder_script(builder_path, generated_at="override")
            self._create_scenario_fixture(
                root,
                geo_locale_builder_url="tools/override_builder.py",
            )

            context = dev_server.load_scenario_context("test_scenario", root=root)

            self.assertEqual(
                context["geoLocaleBuilderPath"],
                builder_path.resolve(),
            )

    def test_load_scenario_context_rejects_releasable_catalog_outside_allowed_roots(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            self._create_scenario_fixture(
                root,
                releasable_catalog_url="misc/test_scenario.source.catalog.json",
            )

            with self.assertRaises(dev_server.DevServerError) as exc_info:
                dev_server.load_scenario_context("test_scenario", root=root)

            self.assertEqual(exc_info.exception.code, "path_not_allowed")

    def test_load_scenario_context_rejects_geo_locale_builder_outside_allowed_roots(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            self._create_scenario_fixture(
                root,
                geo_locale_builder_url="builders/override_builder.py",
            )

            with self.assertRaises(dev_server.DevServerError) as exc_info:
                dev_server.load_scenario_context("test_scenario", root=root)

            self.assertEqual(exc_info.exception.code, "path_not_allowed")

    def test_read_json_body_rejects_oversized_payloads_before_reading(self) -> None:
        handler = object.__new__(dev_server.Handler)
        handler.headers = {"Content-Length": str(dev_server.MAX_JSON_BODY_BYTES + 1)}
        handler.rfile = io.BytesIO(b"")

        with self.assertRaises(dev_server.DevServerError) as exc_info:
            dev_server.Handler._read_json_body(handler)

        self.assertEqual(exc_info.exception.code, "body_too_large")
        self.assertEqual(exc_info.exception.status, 413)

    def test_maybe_send_gzip_static_compresses_static_json_when_client_accepts_gzip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            target_path = Path(tmp_dir) / "sample.json"
            target_payload = {"hello": "world"}
            _write_json(target_path, target_payload)
            handler, events = self._build_handler_for_static_response(target_path=target_path)

            handled = dev_server.Handler._maybe_send_gzip_static(handler, head_only=False)

            self.assertTrue(handled)
            self.assertIn(("status", 200), events)
            self.assertIn(("header", ("Content-Encoding", "gzip")), events)
            self.assertIn(("header", ("Vary", "Accept-Encoding")), events)
            compressed_body = handler.wfile.getvalue()
            self.assertEqual(
                json.loads(gzip.decompress(compressed_body).decode("utf-8")),
                target_payload,
            )

    def test_maybe_send_gzip_static_skips_static_json_when_client_does_not_accept_gzip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            target_path = Path(tmp_dir) / "sample.json"
            _write_json(target_path, {"hello": "world"})
            handler, events = self._build_handler_for_static_response(
                target_path=target_path,
                accept_encoding="br",
            )

            handled = dev_server.Handler._maybe_send_gzip_static(handler, head_only=False)

            self.assertFalse(handled)
            self.assertEqual(events, [])
            self.assertEqual(handler.wfile.getvalue(), b"")

    def test_maybe_send_gzip_static_skips_dev_api_routes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            target_path = Path(tmp_dir) / "sample.json"
            _write_json(target_path, {"ok": True})
            handler, events = self._build_handler_for_static_response(
                target_path=target_path,
                route="/__dev/scenario/tag/create",
            )

            handled = dev_server.Handler._maybe_send_gzip_static(handler, head_only=False)

            self.assertFalse(handled)
            self.assertEqual(events, [])
            self.assertEqual(handler.wfile.getvalue(), b"")

    def test_save_scenario_ownership_payload_accepts_assignments_by_feature_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)

            result = dev_server.save_scenario_ownership_payload(
                "test_scenario",
                None,
                assignments_by_feature_id={
                    "DE-1": {
                        "owner": "BBB",
                        "controller": "BBB",
                        "cores": ["BBB", "AAA"],
                    }
                },
                baseline_hash="baseline-123",
                root=root,
            )

            owners_payload = json.loads((scenario_dir / "owners.by_feature.json").read_text(encoding="utf-8"))
            controllers_payload = json.loads((scenario_dir / "controllers.by_feature.json").read_text(encoding="utf-8"))
            cores_payload = json.loads((scenario_dir / "cores.by_feature.json").read_text(encoding="utf-8"))
            manual_payload = json.loads((scenario_dir / "scenario_manual_overrides.json").read_text(encoding="utf-8"))
            self.assertTrue(result["ok"])
            self.assertEqual(owners_payload["owners"]["DE-1"], "BBB")
            self.assertEqual(controllers_payload["controllers"]["DE-1"], "BBB")
            self.assertEqual(cores_payload["cores"]["DE-1"], ["BBB", "AAA"])
            self.assertEqual(manual_payload["assignments"]["DE-1"]["cores"], ["BBB", "AAA"])

    def test_save_scenario_ownership_payload_owner_only_update_succeeds_without_controllers_or_cores(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(
                root,
                include_controllers=False,
                include_cores=False,
            )

            result = dev_server.save_scenario_ownership_payload(
                "test_scenario",
                {"DE-1": "BBB"},
                baseline_hash="baseline-123",
                root=root,
            )

            owners_payload = json.loads((scenario_dir / "owners.by_feature.json").read_text(encoding="utf-8"))
            manual_payload = json.loads((scenario_dir / "scenario_manual_overrides.json").read_text(encoding="utf-8"))
            self.assertTrue(result["ok"])
            self.assertEqual(owners_payload["owners"]["DE-1"], "BBB")
            self.assertFalse((scenario_dir / "controllers.by_feature.json").exists())
            self.assertFalse((scenario_dir / "cores.by_feature.json").exists())
            self.assertEqual(manual_payload["assignments"]["DE-1"]["owner"], "BBB")
            self.assertNotIn("controller", manual_payload["assignments"]["DE-1"])
            self.assertNotIn("cores", manual_payload["assignments"]["DE-1"])

    def test_save_scenario_ownership_payload_rejects_controller_assignment_when_controllers_file_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            self._create_scenario_fixture(root, include_controllers=False)

            with self.assertRaises(dev_server.DevServerError) as exc_info:
                dev_server.save_scenario_ownership_payload(
                    "test_scenario",
                    None,
                    assignments_by_feature_id={"DE-1": {"controller": "BBB"}},
                    baseline_hash="baseline-123",
                    root=root,
                )

            self.assertEqual(exc_info.exception.code, "missing_controllers_file")

    def test_save_scenario_ownership_payload_rejects_core_assignment_when_cores_file_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            self._create_scenario_fixture(root, include_cores=False)

            with self.assertRaises(dev_server.DevServerError) as exc_info:
                dev_server.save_scenario_ownership_payload(
                    "test_scenario",
                    None,
                    assignments_by_feature_id={"DE-1": {"cores": ["BBB"]}},
                    baseline_hash="baseline-123",
                    root=root,
                )

            self.assertEqual(exc_info.exception.code, "missing_cores_file")

    def test_save_scenario_country_payload_updates_manual_overrides_and_country_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)

            result = dev_server.save_scenario_country_payload(
                "test_scenario",
                tag="AAA",
                name_en="Alpha Prime",
                name_zh="阿尔法首府",
                color_hex="#654321",
                parent_owner_tag="BBB",
                notes="Scenario edit",
                featured=True,
                root=root,
            )

            countries_payload = json.loads((scenario_dir / "countries.json").read_text(encoding="utf-8"))
            manual_payload = json.loads((scenario_dir / "scenario_manual_overrides.json").read_text(encoding="utf-8"))
            mutations_payload = json.loads((scenario_dir / "scenario_mutations.json").read_text(encoding="utf-8"))
            self.assertTrue(result["ok"])
            self.assertEqual(countries_payload["countries"]["AAA"]["display_name_en"], "Alpha Prime")
            self.assertEqual(countries_payload["countries"]["AAA"]["display_name_zh"], "阿尔法首府")
            self.assertEqual(countries_payload["countries"]["AAA"]["color_hex"], "#654321")
            self.assertEqual(countries_payload["countries"]["AAA"]["parent_owner_tag"], "BBB")
            self.assertEqual(countries_payload["countries"]["AAA"]["notes"], "Scenario edit")
            self.assertTrue(countries_payload["countries"]["AAA"]["featured"])
            self.assertEqual(manual_payload["countries"]["AAA"]["mode"], "override")
            self.assertEqual(manual_payload["countries"]["AAA"]["display_name_en"], "Alpha Prime")
            self.assertEqual(mutations_payload["countries"]["AAA"]["display_name_en"], "Alpha Prime")

    def test_save_scenario_ownership_payload_rejects_unknown_owner_tag(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            self._create_scenario_fixture(root)

            with self.assertRaises(dev_server.DevServerError) as exc_info:
                dev_server.save_scenario_ownership_payload(
                    "test_scenario",
                    {"AAA-1": "ZZZ"},
                    baseline_hash="baseline-123",
                    root=root,
                )

            self.assertEqual(exc_info.exception.code, "invalid_owner_codes")

    def test_save_scenario_tag_create_payload_rejects_duplicate_tag(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            self._create_scenario_fixture(root)

            with self.assertRaises(dev_server.DevServerError) as exc_info:
                dev_server.save_scenario_tag_create_payload(
                    "test_scenario",
                    feature_ids=["DE-1"],
                    tag="AAA",
                    name_en="Duplicate",
                    name_zh="\u91cd\u590d",
                    color_hex="#123456",
                    root=root,
                )

            self.assertEqual(exc_info.exception.code, "duplicate_country_tag")

    def test_save_scenario_tag_create_payload_succeeds_without_controllers_or_cores(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(
                root,
                include_controllers=False,
                include_cores=False,
            )

            result = dev_server.save_scenario_tag_create_payload(
                "test_scenario",
                feature_ids=["DE-1", "DE-2"],
                tag="CCC",
                name_en="Caledonia",
                name_zh="卡莱多尼亚",
                color_hex="#123456",
                root=root,
            )

            countries_payload = json.loads((scenario_dir / "countries.json").read_text(encoding="utf-8"))
            owners_payload = json.loads((scenario_dir / "owners.by_feature.json").read_text(encoding="utf-8"))
            manual_payload = json.loads((scenario_dir / "scenario_manual_overrides.json").read_text(encoding="utf-8"))
            self.assertTrue(result["ok"])
            self.assertEqual(countries_payload["countries"]["CCC"]["display_name_en"], "Caledonia")
            self.assertEqual(owners_payload["owners"]["DE-1"], "CCC")
            self.assertFalse((scenario_dir / "controllers.by_feature.json").exists())
            self.assertFalse((scenario_dir / "cores.by_feature.json").exists())
            self.assertEqual(manual_payload["assignments"]["DE-1"]["owner"], "CCC")
            self.assertNotIn("controller", manual_payload["assignments"]["DE-1"])
            self.assertNotIn("cores", manual_payload["assignments"]["DE-1"])

    def test_save_scenario_district_groups_payload_writes_country_payload_and_updates_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)

            result = dev_server.save_scenario_district_groups_payload(
                "test_scenario",
                tag="AAA",
                districts=[
                    {
                        "districtId": "berlin",
                        "nameEn": "Berlin",
                        "nameZh": "\u67cf\u6797",
                        "featureIds": ["DE-1", "DE-3"],
                    },
                    {
                        "districtId": "alpha_core",
                        "nameEn": "Alpha Core",
                        "nameZh": "\u963f\u5c14\u6cd5\u6838\u5fc3",
                        "featureIds": ["AAA-1"],
                    },
                ],
                root=root,
            )

            district_payload = json.loads((scenario_dir / "district_groups.manual.json").read_text(encoding="utf-8"))
            manifest_payload = json.loads((scenario_dir / "manifest.json").read_text(encoding="utf-8"))
            aaa_payload = district_payload["tags"]["AAA"]

            self.assertTrue(result["ok"])
            self.assertEqual(aaa_payload["tag"], "AAA")
            self.assertEqual(aaa_payload["districts"]["berlin"]["name_en"], "Berlin")
            self.assertEqual(aaa_payload["districts"]["alpha_core"]["feature_ids"], ["AAA-1"])
            self.assertEqual(manifest_payload["district_groups_url"], "data/scenarios/test_scenario/district_groups.manual.json")
            self.assertEqual(result["districtGroupsUrl"], "data/scenarios/test_scenario/district_groups.manual.json")
            self.assertEqual(result["stats"]["districtCount"], 2)

    def test_save_scenario_district_groups_payload_rolls_back_when_manifest_write_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)
            original_write_json_atomic = dev_server.write_json_atomic

            def failing_write_json_atomic(path: Path, payload: object, **kwargs: object) -> None:
                if Path(path) == scenario_dir / "manifest.json":
                    raise RuntimeError("manifest write failed")
                original_write_json_atomic(path, payload, **kwargs)

            with mock.patch.object(dev_server, "write_json_atomic", side_effect=failing_write_json_atomic):
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
            self.assertNotIn("district_groups_url", manifest_payload)

    def test_write_json_transaction_preserves_original_exception_when_rollback_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            first_path = root / "first.json"
            second_path = root / "second.json"
            _write_json(first_path, {"version": 1, "value": "original"})
            _write_json(second_path, {"version": 1, "value": "unchanged"})
            original_write_json_atomic = dev_server.write_json_atomic

            def failing_write_json_atomic(path: Path, payload: object, **kwargs: object) -> None:
                if Path(path) == second_path:
                    raise RuntimeError("primary failure")
                original_write_json_atomic(path, payload, **kwargs)

            with (
                mock.patch.object(dev_server, "write_json_atomic", side_effect=failing_write_json_atomic),
                mock.patch.object(dev_server, "write_text_atomic", side_effect=OSError("rollback failure")),
            ):
                with self.assertRaises(RuntimeError) as exc_info:
                    dev_server._write_json_transaction(
                        [
                            (first_path, {"version": 2, "value": "updated"}),
                            (second_path, {"version": 2, "value": "blocked"}),
                        ]
                    )

            self.assertEqual(str(exc_info.exception), "primary failure")
            self.assertTrue(any("Rollback failed:" in note for note in exc_info.exception.__notes__))

    def test_save_scenario_district_groups_payload_rejects_duplicate_feature_ids(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            self._create_scenario_fixture(root)

            with self.assertRaises(dev_server.DevServerError) as exc_info:
                dev_server.save_scenario_district_groups_payload(
                    "test_scenario",
                    tag="AAA",
                    districts=[
                        {
                            "districtId": "berlin",
                            "nameEn": "Berlin",
                            "nameZh": "\u67cf\u6797",
                            "featureIds": ["DE-1", "DE-3"],
                        },
                        {
                            "districtId": "spandau",
                            "nameEn": "Spandau",
                            "nameZh": "\u65bd\u5f6d\u9053",
                            "featureIds": ["DE-1"],
                        },
                    ],
                    root=root,
                )

            self.assertEqual(exc_info.exception.code, "duplicate_feature_ids")

    def test_save_scenario_district_groups_payload_rejects_features_outside_target_tag(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            self._create_scenario_fixture(root)

            with self.assertRaises(dev_server.DevServerError) as exc_info:
                dev_server.save_scenario_district_groups_payload(
                    "test_scenario",
                    tag="AAA",
                    districts=[
                        {
                            "districtId": "mixed",
                            "nameEn": "Mixed",
                            "nameZh": "\u6df7\u5408",
                            "featureIds": ["DE-1", "DE-2"],
                        }
                    ],
                    root=root,
                )

            self.assertEqual(exc_info.exception.code, "unknown_feature_ids")

    def test_save_shared_district_template_and_apply_to_scenario_tag(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)

            template_result = dev_server.save_shared_district_template_payload(
                "test_scenario",
                tag="AAA",
                template_tag="AAA",
                districts=[
                    {
                        "districtId": "alpha",
                        "nameEn": "Alpha",
                        "nameZh": "\u963f\u5c14\u6cd5",
                        "featureIds": ["DE-1", "DE-3", "AAA-1"],
                    }
                ],
                root=root,
            )
            apply_result = dev_server.apply_shared_district_template_payload(
                "test_scenario",
                tag="AAA",
                template_tag="AAA",
                root=root,
            )

            shared_payload = json.loads((root / "data" / "scenarios" / "district_templates.shared.json").read_text(encoding="utf-8"))
            district_payload = json.loads((scenario_dir / "district_groups.manual.json").read_text(encoding="utf-8"))

            self.assertTrue(template_result["ok"])
            self.assertTrue(apply_result["ok"])
            self.assertIn("AAA", shared_payload["templates"])
            self.assertEqual(shared_payload["templates"]["AAA"]["districts"]["alpha"]["feature_ids"], ["DE-1", "DE-3", "AAA-1"])
            self.assertEqual(district_payload["tags"]["AAA"]["districts"]["alpha"]["name_en"], "Alpha")

    def test_save_scenario_district_groups_payload_rejects_legacy_geo_country_payload(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)
            _write_json(
                scenario_dir / "district_groups.manual.json",
                {
                    "version": 1,
                    "scenario_id": "test_scenario",
                    "generated_at": "",
                    "countries": {
                        "DE": {
                            "country_code": "DE",
                            "districts": {
                                "legacy": {
                                    "district_id": "legacy",
                                    "name_en": "Legacy",
                                    "name_zh": "\u65e7\u533a\u5212",
                                    "feature_ids": ["DE-1"],
                                }
                            },
                        }
                    },
                },
            )

            with self.assertRaises(dev_server.DevServerError) as exc_info:
                dev_server.save_scenario_district_groups_payload(
                    "test_scenario",
                    tag="AAA",
                    districts=[],
                    root=root,
                )

            self.assertEqual(exc_info.exception.code, "legacy_district_groups_detected")

    def test_save_scenario_geo_locale_entry_updates_manual_overrides_and_rebuilds_patch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)
            builder_script = root / "builder.py"
            _write_geo_builder_script(builder_script, generated_at="now")
            original_registry = dict(dev_server.GEO_LOCALE_BUILDER_BY_SCENARIO)
            dev_server.GEO_LOCALE_BUILDER_BY_SCENARIO = {
                "test_scenario": builder_script,
            }
            try:
                result = dev_server.save_scenario_geo_locale_entry(
                    "test_scenario",
                    feature_id="AAA-1",
                    en="Alpha",
                    zh="\u963f\u5c14\u6cd5",
                    root=root,
                )
            finally:
                dev_server.GEO_LOCALE_BUILDER_BY_SCENARIO = original_registry

            manual_payload = json.loads((scenario_dir / "geo_name_overrides.manual.json").read_text(encoding="utf-8"))
            patch_payload = json.loads((scenario_dir / "geo_locale_patch.json").read_text(encoding="utf-8"))
            mutations_payload = json.loads((scenario_dir / "scenario_mutations.json").read_text(encoding="utf-8"))
            self.assertTrue(result["ok"])
            self.assertEqual(manual_payload["geo"]["AAA-1"]["en"], "Alpha")
            self.assertEqual(patch_payload["geo"]["AAA-1"]["zh"], "\u963f\u5c14\u6cd5")
            self.assertEqual(mutations_payload["geo_locale"]["AAA-1"]["en"], "Alpha")

    def test_save_scenario_geo_locale_entry_prefers_manifest_builder_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            override_builder = root / "tools" / "override_builder.py"
            registry_builder = root / "tools" / "registry_builder.py"
            _write_geo_builder_script(override_builder, generated_at="override")
            _write_geo_builder_script(registry_builder, generated_at="registry")
            scenario_dir = self._create_scenario_fixture(
                root,
                geo_locale_builder_url="tools/override_builder.py",
            )
            original_registry = dict(dev_server.GEO_LOCALE_BUILDER_BY_SCENARIO)
            dev_server.GEO_LOCALE_BUILDER_BY_SCENARIO = {
                "test_scenario": registry_builder,
            }
            try:
                result = dev_server.save_scenario_geo_locale_entry(
                    "test_scenario",
                    feature_id="AAA-1",
                    en="Alpha",
                    zh="阿尔法",
                    root=root,
                )
            finally:
                dev_server.GEO_LOCALE_BUILDER_BY_SCENARIO = original_registry

            patch_payload = json.loads((scenario_dir / "geo_locale_patch.json").read_text(encoding="utf-8"))
            self.assertTrue(result["ok"])
            self.assertEqual(patch_payload["generated_at"], "override")

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
            original_registry = dict(dev_server.GEO_LOCALE_BUILDER_BY_SCENARIO)
            dev_server.GEO_LOCALE_BUILDER_BY_SCENARIO = {
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
                dev_server.GEO_LOCALE_BUILDER_BY_SCENARIO = original_registry

            manual_payload = json.loads(manual_path.read_text(encoding="utf-8"))
            mutations_path = scenario_dir / "scenario_mutations.json"
            self.assertEqual(exc_info.exception.code, "geo_locale_build_failed")
            self.assertEqual(manual_payload, original_manual_payload)
            self.assertFalse(mutations_path.exists())
            self.assertEqual(exc_info.exception.details["stderr"], "intentional failure")

    def test_save_scenario_geo_locale_entry_rejects_when_no_builder_is_registered(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            self._create_scenario_fixture(root)
            original_registry = dict(dev_server.GEO_LOCALE_BUILDER_BY_SCENARIO)
            dev_server.GEO_LOCALE_BUILDER_BY_SCENARIO = {}
            try:
                with self.assertRaises(dev_server.DevServerError) as exc_info:
                    dev_server.save_scenario_geo_locale_entry(
                        "test_scenario",
                        feature_id="AAA-1",
                        en="Alpha",
                        zh="阿尔法",
                        root=root,
                    )
            finally:
                dev_server.GEO_LOCALE_BUILDER_BY_SCENARIO = original_registry

            self.assertEqual(exc_info.exception.code, "geo_locale_not_supported")

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

            with mock.patch.object(dev_server, "write_json_atomic", side_effect=gated_write_json_atomic):
                first_thread = threading.Thread(target=run_first, name="first-save", daemon=True)
                second_thread = threading.Thread(target=run_second, name="second-save", daemon=True)
                first_thread.start()
                self.assertTrue(first_write_started.wait(timeout=1.0))
                second_thread.start()
                time.sleep(0.15)
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
            original_registry = dict(dev_server.GEO_LOCALE_BUILDER_BY_SCENARIO)
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

            dev_server.GEO_LOCALE_BUILDER_BY_SCENARIO = {"test_scenario": builder_script}
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
                dev_server.GEO_LOCALE_BUILDER_BY_SCENARIO = original_registry

            self.assertNotIn("first_error", results)
            self.assertIsInstance(results.get("second_error"), dev_server.DevServerError)
            self.assertEqual(results["second_error"].code, "geo_locale_build_failed")
            manual_payload = json.loads((scenario_dir / "geo_name_overrides.manual.json").read_text(encoding="utf-8"))
            patch_payload = json.loads((scenario_dir / "geo_locale_patch.json").read_text(encoding="utf-8"))
            self.assertEqual(manual_payload["geo"]["AAA-1"]["en"], "Alpha One")
            self.assertEqual(manual_payload["geo"]["AAA-1"]["zh"], "阿尔法一")
            self.assertEqual(patch_payload["geo"]["AAA-1"]["en"], "Alpha One")
            self.assertEqual(patch_payload["generated_at"], "first-pass")

    def test_apply_shared_district_template_payload_reloads_context_after_acquiring_transaction_lock(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)

            template_result = dev_server.save_shared_district_template_payload(
                "test_scenario",
                tag="AAA",
                template_tag="AAA",
                districts=[
                    {
                        "districtId": "alpha",
                        "nameEn": "Alpha",
                        "nameZh": "阿尔法",
                        "featureIds": ["DE-1", "DE-3", "AAA-1"],
                    }
                ],
                root=root,
            )
            self.assertTrue(template_result["ok"])

            original_load_scenario_context = dev_server.load_scenario_context
            call_count = {"value": 0}

            def counting_load_scenario_context(*args: object, **kwargs: object) -> dict[str, object]:
                call_count["value"] += 1
                return original_load_scenario_context(*args, **kwargs)

            with mock.patch.object(dev_server, "load_scenario_context", side_effect=counting_load_scenario_context):
                apply_result = dev_server.apply_shared_district_template_payload(
                    "test_scenario",
                    tag="AAA",
                    template_tag="AAA",
                    root=root,
                )

            district_payload = json.loads((scenario_dir / "district_groups.manual.json").read_text(encoding="utf-8"))
            self.assertTrue(apply_result["ok"])
            self.assertEqual(call_count["value"], 2)
            self.assertEqual(district_payload["tags"]["AAA"]["districts"]["alpha"]["feature_ids"], ["DE-1", "DE-3", "AAA-1"])

    def test_parse_args_accepts_fixed_port(self) -> None:
        args = dev_server.parse_args(["/", "--port", "8010"])

        self.assertEqual(args.port, 8010)
        self.assertEqual(args.open_path, "/")

    def test_start_server_prefers_requested_port_and_exits_when_busy(self) -> None:
        busy_error = OSError("Address already in use")
        busy_error.errno = 10048

        with (
            mock.patch.object(dev_server, "DevServerTCPServer", side_effect=busy_error) as server_cls,
            self.assertRaises(SystemExit) as exc_info,
        ):
            dev_server.start_server("/", preferred_port=8010)

        self.assertEqual(exc_info.exception.code, 1)
        self.assertEqual(server_cls.call_count, 1)
        self.assertEqual(server_cls.call_args.args[0], (dev_server.BIND_ADDRESS, 8010))

    def test_main_prefers_environment_port_over_cli_port(self) -> None:
        with (
            mock.patch.dict(os.environ, {"MAPCREATOR_DEV_PORT": "8011"}, clear=False),
            mock.patch.object(dev_server, "start_server") as start_server_mock,
            mock.patch.object(dev_server, "resolve_open_path", return_value="/") as resolve_open_path_mock,
        ):
            dev_server.main(["/", "--port", "8010"])

        resolve_open_path_mock.assert_called_once_with("/")
        start_server_mock.assert_called_once_with("/", preferred_port=8011)


if __name__ == "__main__":
    unittest.main()
