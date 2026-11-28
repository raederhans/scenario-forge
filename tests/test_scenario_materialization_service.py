from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from map_builder import config as cfg
from map_builder import scenario_materialization_service as service
from map_builder.scenario_political_materialization_support import build_country_entry_from_mutation


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _create_scenario_fixture(root: Path, scenario_id: str = "test_scenario") -> Path:
    scenario_dir = root / "data" / "scenarios" / scenario_id
    prefix = f"data/scenarios/{scenario_id}"
    _write_json(root / "data/scenarios/index.json", {
        "default_scenario_id": scenario_id, "scenarios": [{"scenario_id": scenario_id, "manifest_url": f"{prefix}/manifest.json"}],
    })
    _write_json(scenario_dir / "manifest.json", {
        "scenario_id": scenario_id, "baseline_hash": "baseline-123", "owners_url": f"{prefix}/owners.by_feature.json",
        "cores_url": f"{prefix}/cores.by_feature.json", "countries_url": f"{prefix}/countries.json",
    })
    _write_json(scenario_dir / "countries.json", {"countries": {
        "AAA": {"tag": "AAA", "display_name": "Alpha"},
        "BBB": {"tag": "BBB", "display_name": "Beta"},
    }})
    owners = {"AAA-1": "AAA", "BBB-1": "BBB"}
    for key in ("owners", "controllers", "cores"):
        values = {fid: [tag] for fid, tag in owners.items()} if key == "cores" else owners
        _write_json(scenario_dir / f"{key}.by_feature.json", {key: values, "baseline_hash": "baseline-123"})
    _write_json(scenario_dir / cfg.SCENARIO_CITY_ASSETS_PARTIAL_FILENAME,
                {"scenario_id": scenario_id, "cities": {}, "audit": {}})
    _write_json(scenario_dir / cfg.SCENARIO_CAPITAL_DEFAULTS_PARTIAL_FILENAME,
                {"scenario_id": scenario_id, "capitals_by_tag": {}, "capital_city_hints": {}})
    return scenario_dir


class ScenarioMaterializationServiceTest(unittest.TestCase):
    def test_color_only_country_mutation_preserves_existing_metadata_without_bilingual_names(self) -> None:
        existing_entry = {
            "tag": "TUN",
            "display_name": "Protectorate of Tunisia",
            "parent_owner_tag": "ITA",
            "parent_owner_tags": ["ITA"],
            "ownership_metadata": {"source": "scenario"},
            "color_hex": "#111111",
            "color_policy": "palette",
        }

        updated = build_country_entry_from_mutation(
            {"scenarioId": "test_scenario"},
            "TUN",
            {"mode": "override", "color_hex": "#AABBCC"},
            existing_entry=existing_entry,
        )

        self.assertEqual(updated["color_hex"], "#aabbcc")
        self.assertEqual(updated["color_policy"], "locked")
        self.assertEqual(updated["parent_owner_tag"], "ITA")
        self.assertEqual(updated["parent_owner_tags"], ["ITA"])
        self.assertEqual(updated["ownership_metadata"], {"source": "scenario"})
        self.assertEqual(updated["display_name"], "Protectorate of Tunisia")

    def test_apply_mutation_and_materialize_in_locked_context_materializes_political_patch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = _create_scenario_fixture(root)

            with service.load_locked_materialization_context("test_scenario", root=root) as context:
                result = service.apply_mutation_and_materialize_in_locked_context(
                    context,
                    mutation_patch={
                        "assignments_by_feature_id": {
                            "AAA-1": {"owner": "BBB"},
                        }
                    },
                    target="political",
                    root=root,
                )

            owners_payload = json.loads((scenario_dir / "owners.by_feature.json").read_text(encoding="utf-8"))
            self.assertEqual(owners_payload["owners"]["AAA-1"], "BBB")
            self.assertEqual(
                result["political"]["materialized"]["manualPayload"]["assignments"]["AAA-1"]["owner"],
                "BBB",
            )

    def test_apply_mutation_and_materialize_in_locked_context_preserves_local_only_manual_catalog_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = _create_scenario_fixture(root)
            manifest_path = scenario_dir / "manifest.json"
            manifest_payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest_payload["releasable_catalog_url"] = "data/releasables/test_scenario.source.catalog.json"
            _write_json(manifest_path, manifest_payload)
            source_path = root / "data/releasables/test_scenario.source.catalog.json"
            manual_path = scenario_dir / "releasable_catalog.manual.json"
            for path, tag, owner in ((source_path, "SRC", "AAA"), (manual_path, "MANUAL", "BBB")):
                _write_json(path, {"entries": [{
                    "tag": tag, "display_name": tag, "display_name_en": tag, "display_name_zh": tag,
                    "color_hex": "#111111", "entry_kind": "releasable", "scenario_ids": ["test_scenario"],
                    "scenario_only": True, "allow_manual_overlay": True, "parent_owner_tag": owner,
                    "preset_source": {"type": "feature_ids", "feature_ids": [f"{owner}-1"]},
                }]})

            with service.load_locked_materialization_context("test_scenario", root=root) as context:
                result = service.apply_mutation_and_materialize_in_locked_context(
                    context,
                    mutation_patch={
                        "countries": {
                            "AAA": {
                                "display_name_en": "Alpha Prime",
                                "display_name_zh": "Alpha Prime Zh",
                                "parent_owner_tag": "BBB",
                            }
                        }
                    },
                    target="political",
                    root=root,
                )

            catalog_payload = json.loads((scenario_dir / "releasable_catalog.manual.json").read_text(encoding="utf-8"))
            self.assertEqual(
                [entry["tag"] for entry in catalog_payload["entries"]],
                ["SRC", "MANUAL", "AAA"],
            )
            self.assertEqual(
                result["political"]["materialized"]["catalogPayload"]["entries"][1]["tag"],
                "MANUAL",
            )


if __name__ == "__main__":
    unittest.main()
