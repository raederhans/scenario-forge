from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tools import dev_server


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


class DevServerTest(unittest.TestCase):
    def _create_scenario_fixture(self, root: Path, scenario_id: str = "test_scenario") -> Path:
        scenario_dir = root / "data" / "scenarios" / scenario_id
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
        _write_json(
            scenario_dir / "manifest.json",
            {
                "scenario_id": scenario_id,
                "display_name": "Test Scenario",
                "baseline_hash": "baseline-123",
                "countries_url": f"data/scenarios/{scenario_id}/countries.json",
                "owners_url": f"data/scenarios/{scenario_id}/owners.by_feature.json",
                "geo_locale_patch_url": f"data/scenarios/{scenario_id}/geo_locale_patch.json",
            },
        )
        _write_json(
            scenario_dir / "countries.json",
            {
                "countries": {
                    "AAA": {"tag": "AAA"},
                    "BBB": {"tag": "BBB"},
                }
            },
        )
        _write_json(
            scenario_dir / "owners.by_feature.json",
            {
                "owners": {
                    "AAA-1": "AAA",
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
        return scenario_dir

    def test_save_scenario_ownership_payload_writes_full_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)

            result = dev_server.save_scenario_ownership_payload(
                "test_scenario",
                {
                    "AAA-1": "AAA",
                    "BBB-2": "BBB",
                },
                baseline_hash="baseline-123",
                root=root,
            )

            saved_payload = json.loads((scenario_dir / "owners.by_feature.json").read_text(encoding="utf-8"))
            self.assertTrue(result["ok"])
            self.assertEqual(saved_payload["owners"]["AAA-1"], "AAA")
            self.assertEqual(saved_payload["owners"]["BBB-2"], "BBB")
            self.assertEqual(saved_payload["baseline_hash"], "baseline-123")
            self.assertEqual(result["stats"]["featureCount"], 2)

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

    def test_save_scenario_geo_locale_entry_updates_manual_overrides_and_rebuilds_patch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = self._create_scenario_fixture(root)
            builder_script = root / "builder.py"
            builder_script.write_text(
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
                        "  'generated_at': 'now',",
                        "  'geo': manual.get('geo', {}),",
                        "}",
                        "Path(args.output).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')",
                    ]
                ),
                encoding="utf-8",
            )
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
            self.assertTrue(result["ok"])
            self.assertEqual(manual_payload["geo"]["AAA-1"]["en"], "Alpha")
            self.assertEqual(patch_payload["geo"]["AAA-1"]["zh"], "\u963f\u5c14\u6cd5")


if __name__ == "__main__":
    unittest.main()
