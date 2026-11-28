import json
from pathlib import Path
import tempfile
import unittest

from tools import patch_tno_1962_bundle as tno_bundle


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _write_checkpoint_contract_files(checkpoint_dir: Path) -> None:
    _write_json(checkpoint_dir / "manifest.json", {"summary": {"feature_count": 999}})
    _write_json(checkpoint_dir / "audit.json", {"summary": {"feature_count": 999}, "owner_stats": {}})


def _topology_fixture() -> dict:
    def geometry(feature_id: str, **props: object) -> dict:
        return {"type": "Polygon", "properties": {"id": feature_id, **props}, "arcs": []}

    objects = {
        "political": [
            geometry("F-1", cntr_code="AAA"), geometry("F-2", cntr_code="BBB"),
            geometry("RU_ARCTIC_FB_FIXTURE", scenario_helper_kind="shell_fallback"),
        ],
        "scenario_atlantropa": [
            geometry("ATLISL_fixture", cntr_code="ATL", assigned_owner_tag="ITA", atl_render_layer="land",
                     atl_color_rule="owner", atl_interactive=True),
            geometry("ATLSEA_fixture", cntr_code="ATL", owner_tag="ATL", atl_render_layer="water",
                     atl_color_rule="atlantropa_sea", atl_interactive=True),
        ],
        "scenario_water": [geometry("tno_fixture_sea")],
    }
    return {"type": "Topology", "objects": {
        name: {"type": "GeometryCollection", "geometries": rows} for name, rows in objects.items()}}


class TnoWaterOwnersConsistencyTest(unittest.TestCase):
    def test_rebuild_water_domain_feature_maps_uses_checkpoint_runtime_ids(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            checkpoint_dir.mkdir()
            _write_json(checkpoint_dir / tno_bundle.CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME, _topology_fixture())
            _write_checkpoint_contract_files(checkpoint_dir)
            _write_json(checkpoint_dir / "countries.json", {"countries": {
                tag: {"tag": tag} for tag in ("AAA", "BBB", "ITA", "ATL")}})
            _write_json(
                checkpoint_dir / "owners.by_feature.json",
                {"owners": {"F-1": "AAA", "F-2": "BBB", "STALE-OLD": "BBB"}},
            )
            _write_json(
                checkpoint_dir / "cores.by_feature.json",
                {"cores": {"F-1": ["AAA"], "F-2": ["BBB"], "STALE-OLD": ["BBB"]}},
            )

            tno_bundle.rebuild_water_domain_feature_maps_from_validated_scenario(scenario_dir, checkpoint_dir)

            owners = json.loads((checkpoint_dir / "owners.by_feature.json").read_text(encoding="utf-8"))["owners"]
            cores = json.loads((checkpoint_dir / "cores.by_feature.json").read_text(encoding="utf-8"))["cores"]
            self.assertEqual(
                owners,
                {
                    "ATLISL_fixture": "ITA",
                    "ATLSEA_fixture": "ATL",
                    "F-1": "AAA",
                    "F-2": "BBB",
                },
            )
            self.assertEqual(set(cores), set(owners))
            self.assertNotIn("STALE-OLD", owners)
            self.assertNotIn("RU_ARCTIC_FB_FIXTURE", owners)
            self.assertNotIn("tno_fixture_sea", owners)

    def test_rebuild_water_domain_feature_maps_rejects_owner_and_core_drift(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "scenario"
            checkpoint_dir = root / "checkpoint"
            checkpoint_dir.mkdir()
            topology = _topology_fixture()
            _write_checkpoint_contract_files(checkpoint_dir)
            _write_json(checkpoint_dir / "countries.json", {"countries": {"AAA": {"tag": "AAA"}, "BBB": {"tag": "BBB"}, "ITA": {"tag": "ITA"}, "ATL": {"tag": "ATL"}}})
            _write_json(checkpoint_dir / "owners.by_feature.json", {"owners": {"F-1": "AAA", "F-2": "BBB"}})
            _write_json(checkpoint_dir / "cores.by_feature.json", {"cores": {"F-1": ["AAA"], "F-2": ["BBB"]}})

            rows = topology["objects"]["political"]["geometries"]
            rows.append({"type": "Polygon", "properties": {"id": "STRAY-RUNTIME-ONLY", "cntr_code": "AAA"}, "arcs": []})
            _write_json(checkpoint_dir / tno_bundle.CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME, topology)
            with self.assertRaisesRegex(ValueError, "Unexpected water-domain runtime feature id"):
                tno_bundle.rebuild_water_domain_feature_maps_from_validated_scenario(scenario_dir, checkpoint_dir)

            rows.pop()
            rows[0]["properties"]["owner_tag"] = "BBB"
            rows[1]["properties"]["core_tags"] = ["AAA"]
            _write_json(checkpoint_dir / tno_bundle.CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME, topology)
            with self.assertRaisesRegex(ValueError, "conflicting owner tags"):
                tno_bundle.rebuild_water_domain_feature_maps_from_validated_scenario(scenario_dir, checkpoint_dir)

            rows[0]["properties"].pop("owner_tag")
            _write_json(checkpoint_dir / tno_bundle.CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME, topology)
            with self.assertRaisesRegex(ValueError, "conflicting core tags"):
                tno_bundle.rebuild_water_domain_feature_maps_from_validated_scenario(scenario_dir, checkpoint_dir)


if __name__ == "__main__":
    unittest.main()
