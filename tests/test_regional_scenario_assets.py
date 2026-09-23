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
from tools.build_tno_russia_precision_assets import sizes


def _runtime(features, *, extra=None):
    return Topology({"type": "FeatureCollection", "features": features}, object_name="political", prequantize=False).to_dict()


def _f(fid, x):
    return {"type": "Feature", "properties": {"id": fid, "cntr_code": "RU"}, "geometry": mapping(box(x, 0, x + 1, 1))}


class RegionalScenarioAssetsTest(unittest.TestCase):
    def test_size_report_compresses_shared_files_once_and_remeasures_changes(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / 'chunks').mkdir()
            chunks = [{'url': 'chunks/land.json', 'layer': 'political'},
                      {'url': 'chunks/water.json', 'layer': 'water'}]
            (root / 'detail_chunks.manifest.json').write_text(json.dumps({'chunks': chunks}))
            paths = [root / entry['url'] for entry in chunks]
            paths += [root / f'startup.bundle.{lang}.json' for lang in ('en', 'zh')]
            for path in paths:
                path.write_bytes(b'{"label":"test"}')
            expected = len(gzip.compress(paths[0].read_bytes(), compresslevel=6, mtime=0))
            with patch('tools.build_tno_russia_precision_assets.gzip.compress', wraps=gzip.compress) as compress:
                report = sizes(root)
            self.assertEqual(compress.call_count, 4)
            self.assertEqual(report['chunks_gzip6_bytes'], expected * 2)
            self.assertEqual(report['political_chunks_gzip6_bytes'], expected)
            self.assertEqual(report['largest_political_chunks'][0]['gzip6_bytes'], expected)
            self.assertEqual(report['startup_gzip6_bytes'], {'en': expected, 'zh': expected})
            paths[0].write_bytes(b'{"changed":true,"data":[1,2,3,4,5]}')
            changed = len(gzip.compress(paths[0].read_bytes(), compresslevel=6, mtime=0))
            self.assertEqual(sizes(root)['political_chunks_gzip6_bytes'], changed)

    def _fixture(self, root: Path, *, changed=True, nonpolitical=False):
        baseline = root / "baseline"
        (baseline / "chunks").mkdir(parents=True)
        runtime_rel = Path("runtime_topology.topo.json")
        old_runtime = _runtime([_f("RU_A", 0), _f("RU_B", 1)])
        new_runtime = _runtime([_f("RU_A", .2) if changed else _f("RU_A", 0), _f("RU_B", 1)])
        if nonpolitical:
            old_runtime["objects"]["place"] = {"type": "Point", "coordinates": [0, 0]}
            new_runtime["objects"]["place"] = {"type": "Point", "coordinates": [1, 0]}
        (baseline / runtime_rel).write_text(json.dumps(old_runtime), encoding="utf-8")
        candidate = root / "candidate.json"
        candidate.write_text(json.dumps(new_runtime), encoding="utf-8")
        (baseline / "manifest.json").write_text(json.dumps({"scenario_id": "demo", "runtime_topology_url": "data/scenarios/demo/runtime_topology.topo.json"}), encoding="utf-8")
        owners = {"owners": {"RU_A": "OLD", "RU_B": "KEEP"}}
        (baseline / "owners.by_feature.json").write_text(json.dumps(owners), encoding="utf-8")
        body = {"type": "FeatureCollection", "features": [_f("RU_A", 0)]}
        chunk = baseline / "chunks" / "political.detail.country.old.json"
        chunk.write_text(json.dumps(body), encoding="utf-8")
        digest = hashlib.sha256(chunk.read_bytes()).hexdigest()
        keep = baseline / "chunks" / "political.detail.country.keep.json"
        keep.write_text(json.dumps({"type": "FeatureCollection", "features": [_f("RU_B", 1)]}), encoding="utf-8")
        keep_digest = hashlib.sha256(keep.read_bytes()).hexdigest()
        (baseline / "detail_chunks.manifest.json").write_text(json.dumps({"chunks": [
            {"id": "political.detail.country.old", "layer": "political", "lod": "detail", "url": "data/scenarios/demo/chunks/political.detail.country.old.json", "country_codes": ["OLD"], "sha256": digest},
            {"id": "political.detail.country.keep", "layer": "political", "lod": "detail", "url": "data/scenarios/demo/chunks/political.detail.country.keep.json", "country_codes": ["KEEP"], "sha256": keep_digest},
        ]}), encoding="utf-8")
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

    def test_nonpolitical_change_is_rejected_and_baseline_untouched(self):
        with tempfile.TemporaryDirectory() as d:
            baseline, candidate = self._fixture(Path(d), nonpolitical=True)
            with self.assertRaises(ValueError):
                build_regional_scenario_assets(baseline_dir=baseline, candidate_runtime_path=candidate, output_dir=Path(d) / "out")
            self.assertTrue((baseline / "manifest.json").exists())

    def test_existing_gzip_mismatch_rejects(self):
        with tempfile.TemporaryDirectory() as d:
            baseline, candidate = self._fixture(Path(d))
            with gzip.open(str(baseline / "chunks" / "political.detail.country.keep.json.gz"), "wb") as h:
                h.write(b"wrong")
            with self.assertRaises(ValueError):
                build_regional_scenario_assets(baseline_dir=baseline, candidate_runtime_path=candidate, output_dir=Path(d) / "out")

    def test_build_failure_rolls_back_and_paths_cannot_escape(self):
        with tempfile.TemporaryDirectory() as d:
            baseline, candidate = self._fixture(Path(d))
            before = {str(p.relative_to(baseline)): p.read_bytes() for p in baseline.rglob("*") if p.is_file()}
            with patch("tools.regional_scenario_assets.build_and_write_scenario_chunk_assets", side_effect=RuntimeError("build failed")):
                with self.assertRaises(RuntimeError):
                    build_regional_scenario_assets(baseline_dir=baseline, candidate_runtime_path=candidate, output_dir=Path(d) / "out")
            self.assertFalse((Path(d) / "out").exists())
            self.assertFalse(list(Path(d).glob(".out.staging-*")))
            self.assertEqual(before, {str(p.relative_to(baseline)): p.read_bytes() for p in baseline.rglob("*") if p.is_file()})
            manifest = json.loads((baseline / "manifest.json").read_text())
            manifest["runtime_topology_url"] = "data/scenarios/demo/../../escape.json"
            (baseline / "manifest.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "escapes"):
                build_regional_scenario_assets(baseline_dir=baseline, candidate_runtime_path=candidate, output_dir=Path(d) / "out")

    def test_auxiliary_owner_records_preserved_but_changes_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            baseline, candidate = self._fixture(Path(d), changed=False)
            owner_path = baseline / "owners.by_feature.json"
            owners = json.loads(owner_path.read_text())
            owners["owners"]["ATL_HELPER"] = "OLD"
            owner_path.write_text(json.dumps(owners))
            output = Path(d) / "out"
            build_regional_scenario_assets(baseline_dir=baseline, candidate_runtime_path=candidate, output_dir=output)
            self.assertEqual(owner_path.read_bytes(), (output / owner_path.name).read_bytes())
            replacement = Path(d) / "owners.json"
            owners["owners"]["ATL_HELPER"] = "NEW"
            replacement.write_text(json.dumps(owners))
            with self.assertRaisesRegex(ValueError, "Non-political owner"):
                build_regional_scenario_assets(baseline_dir=baseline, candidate_runtime_path=candidate,
                    output_dir=Path(d) / "out2", candidate_owners_path=replacement)


if __name__ == "__main__":
    unittest.main()
