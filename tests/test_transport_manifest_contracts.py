from __future__ import annotations

import json
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class TransportManifestContractsTest(unittest.TestCase):
    def test_main_map_point_packs_include_visible_importance_ranks(self) -> None:
        point_layers_by_pack = {
            "global_airport": "airports",
            "usa_airport": "airports",
            "china_airport": "airports",
            "russia_airport": "airports",
            "india_airport": "airports",
            "germany_airport": "airports",
            "france_airport": "airports",
            "uk_airport": "airports",
            "global_port": "ports",
            "usa_port": "ports",
            "germany_port": "ports",
            "france_port": "ports",
            "uk_port": "ports",
            "china_port": "ports",
            "india_port": "ports",
            "russia_port": "ports",
        }
        failures: list[str] = []
        airport_types = {"company_managed", "national", "specific_local", "local", "other", "shared"}
        airport_statuses = {"active", "paused", "unknown"}
        port_designations = {"international_strategy", "international_hub", "important", "local", "shelter"}
        port_manager_types = {"1", "2", "3", "4", "5"}
        for pack_id, layer_key in point_layers_by_pack.items():
            manifest_path = PROJECT_ROOT / "data" / "transport_layers" / pack_id / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            for phase in ("preview", "full"):
                layer_path = PROJECT_ROOT / manifest["paths"][phase][layer_key]
                payload = json.loads(layer_path.read_text(encoding="utf-8"))
                features = payload.get("features") or []
                bad_ranks = [
                    feature.get("properties", {}).get("id", index)
                    for index, feature in enumerate(features)
                    if not isinstance(feature.get("properties", {}).get("importance_rank"), (int, float))
                    or not 1 <= int(feature.get("properties", {}).get("importance_rank")) <= 3
                ]
                if bad_ranks:
                    failures.append(f"{pack_id}:{phase}:{layer_key}:bad_importance_rank:{bad_ranks[:5]}")
                if phase == "preview" and not any(int(feature.get("properties", {}).get("importance_rank", 0)) >= 2 for feature in features):
                    failures.append(f"{pack_id}:{phase}:{layer_key}:no_default_visible_features")
                if layer_key == "airports":
                    bad_airport_contract = [
                        feature.get("properties", {}).get("id", index)
                        for index, feature in enumerate(features)
                        if feature.get("properties", {}).get("airport_type") not in airport_types
                        or feature.get("properties", {}).get("status_category") not in airport_statuses
                    ]
                    if bad_airport_contract:
                        failures.append(f"{pack_id}:{phase}:{layer_key}:bad_workbench_airport_filters:{bad_airport_contract[:5]}")
                if layer_key == "ports":
                    bad_port_contract = [
                        feature.get("properties", {}).get("id", index)
                        for index, feature in enumerate(features)
                        if feature.get("properties", {}).get("legal_designation") not in port_designations
                        or str(feature.get("properties", {}).get("manager_type_code", "")) not in port_manager_types
                    ]
                    if bad_port_contract:
                        failures.append(f"{pack_id}:{phase}:{layer_key}:bad_workbench_port_filters:{bad_port_contract[:5]}")

        self.assertFalse(failures, failures)

    def test_russia_carrier_keeps_kaliningrad_and_excludes_foreign_admin_codes(self) -> None:
        provenance_path = PROJECT_ROOT / "data" / "transport_layers" / "russia_carrier" / "provenance.json"
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        codes = provenance["frames"]["main"]["prefectureCodes"]
        foreign_codes = [code for code in codes if not str(code).startswith("RU-")]

        self.assertIn("RU-KGD", codes)
        self.assertFalse(foreign_codes, foreign_codes)
