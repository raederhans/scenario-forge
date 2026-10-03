import copy
import gzip
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tools.perf.project_baseline_startup import project_startup_inputs
from tools.startup_topology_codec import encode_startup_topology, encode_topology


REPO_ROOT = Path(__file__).resolve().parents[1]
TOPOLOGY = {
    "type": "Topology",
    "transform": {"scale": [0.01, 0.01], "translate": [-180, -90]},
    "objects": {"political": {"type": "GeometryCollection", "geometries": [
        {"type": "Polygon", "id": "candidate-feature", "arcs": [[0, ~1]],
         "properties": {"owner": "GER"}},
    ]}},
    "arcs": [[[3, 4], [5, 0], [0, 5], [-5, -5]], [[8, 4], [-5, 0]]],
}


class BaselineStartupProjectionTest(unittest.TestCase):
    def setUp(self):
        runtime = REPO_ROOT / ".runtime/tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="baseline-startup-", dir=runtime)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.candidate = self.root / "candidate"
        self.baseline = self.root / "baseline"
        self.scenario_id = "tno_1962"
        self.relative_dir = Path("data/scenarios") / self.scenario_id

    def prepare(self, version=7, baseline_version=5):
        source_dir = self.candidate / self.relative_dir
        source_dir.mkdir(parents=True)
        self.payload = {
            "version": version, "scenario_id": self.scenario_id, "language": "en",
            "manifest_subset": {"startup_bundle_version": version, "baseline_hash": "same-owners"},
            "source": {"runtime_topology_sha256": "candidate-source-topology"},
            "base": {"topology_primary": copy.deepcopy(TOPOLOGY)},
            "scenario": {"runtime_topology_bootstrap": copy.deepcopy(TOPOLOGY),
                         "owners": {"values": ["GER"]}, "runtime_political_meta": {"featureIds": ["candidate-feature"]}},
        }
        encode = encode_startup_topology if version == 7 else encode_topology
        if version >= 6:
            self.payload["base"]["topology_primary"] = encode(TOPOLOGY)
            self.payload["scenario"]["runtime_topology_bootstrap"] = encode(TOPOLOGY)
        manifest = {"scenario_id": self.scenario_id, "startup_bundle_version": version,
                    "source": self.payload["source"], "baseline_hash": "same-owners"}
        for language in ("en", "zh"):
            relative = self.relative_dir / f"startup.bundle.{language}.json"
            manifest[f"startup_bundle_url_{language}"] = relative.as_posix()
            raw = json.dumps({**self.payload, "language": language}).encode("utf-8")
            (self.candidate / relative).write_bytes(raw)
            (self.candidate / Path(str(relative) + ".gz")).write_bytes(gzip.compress(raw, mtime=0))
        (source_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        (source_dir / "runtime_topology.topo.json").write_text("candidate workload", encoding="utf-8")
        shutil.copytree(self.candidate, self.baseline)
        (self.baseline / "tools").mkdir()
        (self.baseline / "tools/build_startup_bundle.py").write_text(
            f"raise RuntimeError('must not import baseline builder')\nSTARTUP_BUNDLE_VERSION = {baseline_version}\n",
            encoding="utf-8")
        (self.baseline / "js/workers").mkdir(parents=True)
        (self.baseline / "js/workers/startup_boot.worker.js").write_text("unchanged baseline runtime", encoding="utf-8")

    def project(self, verify=False):
        return project_startup_inputs(self.candidate, self.baseline, [self.scenario_id], verify=verify)

    def test_old_baseline_receives_identical_standard_topology_for_v6_and_v7(self):
        for version in (6, 7):
            with self.subTest(version=version):
                self.prepare(version)
                candidate_before = {path.relative_to(self.candidate): path.read_bytes()
                                    for path in self.candidate.rglob("*") if path.is_file()}
                report = self.project()
                self.assertEqual(report, self.project(verify=True))
                self.assertEqual(len(report["changed_files"]), 5)
                for language in ("en", "zh"):
                    bundle = self.baseline / self.relative_dir / f"startup.bundle.{language}.json"
                    projected = json.loads(bundle.read_bytes())
                    expected = copy.deepcopy(self.payload)
                    expected["language"] = language
                    expected["version"] = expected["manifest_subset"]["startup_bundle_version"] = 5
                    expected["base"]["topology_primary"] = TOPOLOGY
                    expected["scenario"]["runtime_topology_bootstrap"] = TOPOLOGY
                    self.assertEqual(projected, expected)
                    self.assertEqual(gzip.decompress(Path(str(bundle) + ".gz").read_bytes()), bundle.read_bytes())
                self.assertEqual((self.baseline / "js/workers/startup_boot.worker.js").read_text(), "unchanged baseline runtime")
                self.assertEqual((self.baseline / self.relative_dir / "runtime_topology.topo.json").read_text(), "candidate workload")
                self.assertEqual(candidate_before, {path.relative_to(self.candidate): path.read_bytes()
                                                  for path in self.candidate.rglob("*") if path.is_file()})
                shutil.rmtree(self.candidate)
                shutil.rmtree(self.baseline)

    def test_compatible_v6_baseline_retains_original_encoded_bytes(self):
        self.prepare(version=6, baseline_version=6)
        self.assertEqual(self.project()["changed_files"], [])
        self.assertEqual(self.project(verify=True)["changed_files"], [])

    def test_v7_candidate_on_v6_baseline_uses_standard_wire(self):
        self.prepare(version=7, baseline_version=6)
        self.assertEqual(len(self.project()["changed_files"]), 5)
        self.project(verify=True)

    def test_verification_rejects_workload_changes(self):
        self.prepare()
        self.project()
        path = self.baseline / self.relative_dir / "startup.bundle.en.json"
        payload = json.loads(path.read_bytes())
        payload["scenario"]["owners"]["values"] = ["USA"]
        path.write_text(json.dumps(payload), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "differs from candidate workload"):
            self.project(verify=True)

    def test_malformed_new_wire_fails_closed(self):
        self.prepare()
        path = self.candidate / self.relative_dir / "startup.bundle.en.json"
        payload = json.loads(path.read_bytes())
        payload["base"]["topology_primary"]["arcs_encoding"]["arc_count"] = -1
        path.write_text(json.dumps(payload), encoding="utf-8")
        with self.assertRaises(ValueError):
            self.project()

    def test_candidate_cli_writes_and_verifies_projection_receipt(self):
        self.prepare()
        receipt = self.root / "receipt.json"
        command = [sys.executable, str(REPO_ROOT / "tools/perf/project_baseline_startup.py"),
                   "--candidate-root", str(self.candidate), "--baseline-root", str(self.baseline),
                   "--scenarios", self.scenario_id, "--receipt", str(receipt)]
        for arguments in (command, [*command, "--verify"]):
            completed = subprocess.run(arguments, capture_output=True, text=True, timeout=20)
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        report = json.loads(receipt.read_bytes())
        report["assets"][0]["sha256"] = "tampered"
        receipt.write_text(json.dumps(report), encoding="utf-8")
        completed = subprocess.run([*command, "--verify"], capture_output=True, text=True, timeout=20)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("receipt does not match", completed.stderr)

    def test_projection_restores_legacy_topojson_consumer(self):
        self.prepare()
        source = self.candidate / self.relative_dir / "startup.bundle.en.json"
        target = self.baseline / self.relative_dir / "startup.bundle.en.json"
        self.project()
        script = """
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), context);
const source = JSON.parse(fs.readFileSync(process.argv[2])).base.topology_primary;
const target = JSON.parse(fs.readFileSync(process.argv[3])).base.topology_primary;
assert.throws(() => context.topojson.feature(source, source.objects.political));
const collection = context.topojson.feature(target, target.objects.political);
assert.equal(collection.features[0].id, 'candidate-feature');
assert.equal(collection.features[0].properties.owner, 'GER');
assert.equal(collection.features[0].geometry.coordinates[0][0][0], -179.97);
"""
        completed = subprocess.run(["node", "-e", script, str(REPO_ROOT / "vendor/topojson-client.min.js"),
                                    str(source), str(target)], capture_output=True, text=True, timeout=20)
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)


if __name__ == "__main__":
    unittest.main()
