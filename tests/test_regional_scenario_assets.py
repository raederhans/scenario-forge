from __future__ import annotations

import gzip
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from shapely.geometry import box, mapping
from topojson import Topology

from tools.regional_scenario_assets import build_regional_scenario_assets
from tools.scenario_chunk_assets import build_and_write_scenario_chunk_assets
from tools.build_tno_russia_precision_assets import finalize_stage
from tools.regional_scenario_assets import _copy_gzip
from map_builder.json_source import read_json_source, write_runtime_topology_source


def _runtime(features):
    return Topology({"type": "FeatureCollection", "features": features}, object_name="political", prequantize=False).to_dict()


def _f(fid, x):
    return {"type": "Feature", "properties": {"id": fid, "cntr_code": "RU"}, "geometry": mapping(box(x, 0, x + 1, 1))}


class RegionalScenarioAssetsTest(unittest.TestCase):
    def test_gzip_only_runtime_updates_manifest_and_survives_finalization(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            baseline, candidate = self._fixture(root)
            old_plain = baseline / "runtime_topology.topo.json"
            old_gz = old_plain.with_name(old_plain.name + ".gz")
            old_gz.write_bytes(gzip.compress(old_plain.read_bytes()))
            old_plain.unlink()
            manifest = read_json_source(baseline / "manifest.json")
            manifest["runtime_topology_url"] += ".gz"
            (baseline / "manifest.json").write_text(json.dumps(manifest))
            payload = read_json_source(candidate)
            payload["padding"] = "same precise coordinates" * 200
            candidate_gz = candidate.with_name(candidate.name + ".gz")
            candidate_gz.write_bytes(gzip.compress(json.dumps(payload).encode("utf-8")))
            output = root / "out"
            with patch("tools.regional_scenario_assets.write_runtime_topology_source",
                       side_effect=lambda directory, value: write_runtime_topology_source(directory, value, max_bytes=600)):
                build_regional_scenario_assets(baseline_dir=baseline, candidate_runtime_path=candidate_gz, output_dir=output)
            manifest = read_json_source(output / "manifest.json")
            runtime = output / "runtime_topology.topo.json.gz"
            self.assertEqual(manifest["runtime_topology_url"], "data/scenarios/demo/" + runtime.name)
            self.assertEqual(manifest["source"]["runtime_topology_sha256"], hashlib.sha256(runtime.read_bytes()).hexdigest())
            self.assertFalse((output / "runtime_topology.topo.json").exists())
            self.assertEqual(read_json_source(runtime)["arcs"], payload["arcs"])
            self.assertIn("computed_neighbors", read_json_source(runtime)["objects"]["political"])
            _copy_gzip(runtime)
            self.assertFalse(runtime.with_name(runtime.name + ".gz").exists())
            with (patch("tools.check_scenario_contracts.apply_safe_scenario_contract_repairs", return_value=[]),
                  patch("tools.check_scenario_contracts._build_snapshot_for_scenario", return_value={"snapshot_fingerprint": "test"}),
                  patch("tools.check_scenario_contracts._refresh_audit_payload")):
                finalize_stage(output)
            self.assertEqual(read_json_source(runtime)["arcs"], payload["arcs"])

    def _fixture(self, root: Path, *, changed=True):
        baseline = root / "baseline"
        (baseline / "chunks").mkdir(parents=True)
        runtime_rel = Path("runtime_topology.topo.json")
        old_runtime = _runtime([_f("RU_A", 0), _f("RU_B", 1)])
        new_runtime = _runtime([_f("RU_A", .2) if changed else _f("RU_A", 0), _f("RU_B", 1)])
        (baseline / runtime_rel).write_text(json.dumps(old_runtime), encoding="utf-8")
        candidate = root / "candidate.json"
        candidate.write_text(json.dumps(new_runtime), encoding="utf-8")
        (baseline / "manifest.json").write_text(json.dumps({"scenario_id": "demo", "runtime_topology_url": "data/scenarios/demo/runtime_topology.topo.json"}), encoding="utf-8")
        owners = {"owners": {"RU_A": "OLD", "RU_B": "KEEP"}}
        (baseline / "owners.by_feature.json").write_text(json.dumps(owners), encoding="utf-8")
        manifest = json.loads((baseline / "manifest.json").read_text())
        build_and_write_scenario_chunk_assets(scenario_dir=baseline, manifest_payload=manifest,
            runtime_topology_payload=old_runtime, runtime_topology_url=manifest["runtime_topology_url"], generated_at="test")
        (baseline / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        return baseline, candidate

    def test_owner_transfer_reuses_unaffected_chunk_and_cleans_old(self):
        with tempfile.TemporaryDirectory() as d:
            baseline, candidate = self._fixture(Path(d), changed=False)
            output = Path(d) / "candidate"
            candidate_owners = Path(d) / "owners.json"
            candidate_owners.write_text(json.dumps({"owners": {"RU_A": "NEW", "RU_B": "KEEP"}}), encoding="utf-8")
            report = build_regional_scenario_assets(baseline_dir=baseline, candidate_runtime_path=candidate, output_dir=output, candidate_owners_path=candidate_owners)
            self.assertEqual(report["status"], "candidate")
            self.assertEqual(report["owner_changed_ids"], ["RU_A"])
            self.assertEqual(report["changed_ids"], [])
            self.assertFalse((output / "chunks" / "political.detail.country.old.json").exists())
            self.assertTrue((output / "chunks" / "political.detail.country.new.json").exists())
            self.assertEqual((baseline / "chunks/political.detail.country.keep.json").read_bytes(),
                             (output / "chunks/political.detail.country.keep.json").read_bytes())
            # Compare the real incremental output with an independent full chunk build.
            full = Path(d) / "full"
            full.mkdir()
            (full / "owners.by_feature.json").write_bytes(candidate_owners.read_bytes())
            manifest = json.loads((output / "manifest.json").read_text())
            runtime = json.loads((output / "runtime_topology.topo.json").read_text())
            build_and_write_scenario_chunk_assets(scenario_dir=full, manifest_payload=manifest,
                runtime_topology_payload=runtime, runtime_topology_url=manifest["runtime_topology_url"])
            for path in (full / "chunks").glob("*.json"):
                self.assertEqual(path.read_bytes(), (output / "chunks" / path.name).read_bytes())
            self.assertEqual(json.loads((full / "mesh_pack.json").read_text())["meshes"],
                             json.loads((output / "mesh_pack.json").read_text())["meshes"])
            for path in output.rglob("*.json"):
                self.assertEqual(path.read_bytes(), gzip.decompress(Path(str(path) + ".gz").read_bytes()))

    def test_corrupt_cached_json_or_gzip_rejects_without_output(self):
        with tempfile.TemporaryDirectory() as d:
            baseline, candidate = self._fixture(Path(d))
            chunk = baseline / "chunks" / "political.detail.country.keep.json"
            chunk.write_text("corrupt", encoding="utf-8")
            with self.assertRaises(ValueError):
                build_regional_scenario_assets(baseline_dir=baseline, candidate_runtime_path=candidate, output_dir=Path(d) / "out")
            self.assertFalse((Path(d) / "out").exists())


if __name__ == "__main__":
    unittest.main()
