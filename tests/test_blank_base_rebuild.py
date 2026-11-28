from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from map_builder.json_source import write_runtime_topology_source
from tools import build_blank_base_scenario as subject


def topology(ids):
    result = {"type": "Topology", "arcs": [], "objects": {
        "political": {"type": "GeometryCollection", "geometries": [],
                      "computed_neighbors": [[] for _ in ids]}
    }}
    for i, fid in enumerate(ids):
        result["arcs"].append([[i, 0], [i + .987654321, 0], [i + .987654321, 1], [i, 1], [i, 0]])
        result["objects"]["political"]["geometries"].append({
            "type": "Polygon", "arcs": [[i]], "properties": {"id": fid, "name": fid}
        })
    return result


class BlankBaseRebuildTest(unittest.TestCase):
    def test_copy_preserves_old_ids_geometry_and_source(self):
        source = topology(["old", "new"])
        source["objects"]["water"] = deepcopy(source["objects"]["political"])
        original = deepcopy(source)
        output = subject.rebuild_topology(source, topology(["old"]))
        self.assertEqual(output, source)
        self.assertEqual(source, original)
        self.assertIsNot(output["arcs"], source["arcs"])
        self.assertEqual([r["properties"]["id"] for r in output["objects"]["political"]["geometries"]],
                         ["old", "new"])

    def test_strips_all_assignment_fields_and_keeps_geography(self):
        source = topology(["old"])
        props = source["objects"]["political"]["geometries"][0]["properties"]
        props.update({key: "occupied" for key in (
            "cntr_code", "country_code", "owner", "controller", "core", "cores",
            "scenario_owner", "scenario_controller", "color", "color_hex",
            "admin1_group", "legacy_name", "anchor_county_name",
        )})
        props.update(claim_status="sector", sector_start_lon=0)
        output = subject.rebuild_topology(source, topology(["old"]))
        self.assertEqual(output["objects"]["political"]["geometries"][0]["properties"], {
            "id": "old", "name": "old", "claim_status": "sector", "sector_start_lon": 0
        })
        self.assertEqual(output["arcs"], source["arcs"])

    def test_rejects_loss_of_existing_id(self):
        with self.assertRaisesRegex(ValueError, "missing existing blank IDs.*old"):
            subject.rebuild_topology(topology(["new"]), topology(["old"]))

    def test_compressed_source_and_target_use_one_canonical_representation(self):
        temporary_root = subject.ROOT / ".runtime/tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temporary_root) as temporary:
            root = Path(temporary)
            target, source = root / "blank_base", root / "modern_world"
            target.mkdir()
            source.mkdir()
            payload = topology(["old", "new"])
            for row in payload["objects"]["political"]["geometries"]:
                row["properties"]["name"] = "Geographic name " * 100
            stored_source = write_runtime_topology_source(source, payload, max_bytes=512)
            self.assertEqual(stored_source.suffix, ".gz")
            (target / "runtime_topology.topo.json").write_text(json.dumps(topology(["old"])), encoding="utf-8")
            subject.write_json(target / "manifest.json", {
                "scenario_id": "blank_base", "map_mode": "blank", "baseline_hash": "baseline",
                "summary": {"feature_count": 2},
            })
            subject.write_json(target / "audit.json", {})
            for name in ("owners", "cores", "controllers"):
                subject.write_json(target / f"{name}.by_feature.json", {name: {}})
            with patch.object(subject, "refresh_scenario", return_value=[]), patch.object(
                subject, "write_runtime_topology_source",
                side_effect=lambda directory, result: write_runtime_topology_source(directory, result, max_bytes=512),
            ):
                report = subject.build_blank_base_scenario(source / "runtime_topology.topo.json", target)
            compressed_target = target / "runtime_topology.topo.json.gz"
            self.assertFalse((target / "runtime_topology.topo.json").exists())
            self.assertEqual(subject.read(target / "runtime_topology.topo.json"), payload)
            manifest = subject.read(target / "manifest.json")
            self.assertEqual(manifest["runtime_topology_url"], compressed_target.relative_to(subject.ROOT).as_posix())
            self.assertEqual(report["source_sha256"], hashlib.sha256(stored_source.read_bytes()).hexdigest())
            self.assertEqual(manifest["source"]["runtime_topology_sha256"],
                             hashlib.sha256(compressed_target.read_bytes()).hexdigest())
            with self.assertRaisesRegex(ValueError, "source topology must differ"):
                subject.build_blank_base_scenario(compressed_target, target)


if __name__ == "__main__":
    unittest.main()
