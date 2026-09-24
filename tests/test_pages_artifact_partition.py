from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tools.pages_artifact_admission import build_admission_receipt
from tools.pages_artifact_partition import partition_artifact, assemble_artifact, verify_partition
from tools.pages_artifact_rehearsal import run_rehearsal
from tools.pages_artifact_shadow import build_tree_snapshot


class ArtifactPartitionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name).resolve()
        (self.repo / ".runtime").mkdir()

    def artifact(self, name="source", marker="A", sha="1" * 40):
        root = self.repo / ".runtime" / name
        root.mkdir()
        for relative, content in {
            "index.html": marker,
            "app/index.html": "<!doctype html>",
            "app/js/main.js": "export const ready = true;\n",
            "app/data/scenarios/index.json": '{"scenarios":[]}',
        }.items():
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        path = root / "pages-dist-manifest.json"
        path.write_text("{}", encoding="utf-8")
        for _ in range(20):
            snapshot = build_tree_snapshot(root)
            manifest = {
                "schema_version": 2,
                "files": [{"path": row["path"], "size_bytes": row["sizeBytes"]} for row in snapshot["files"]],
                "total_bytes": snapshot["totalBytes"],
                "required_files": ["index.html", "app/index.html", "app/data/scenarios/index.json"],
                "reachability_inventory": {"admission": {"status": "complete"}},
                "size_gate": {"status": "within_limit"},
            }
            previous_size = path.stat().st_size
            path.write_text(json.dumps(manifest, sort_keys=True) + "\n", encoding="utf-8")
            if path.stat().st_size == previous_size:
                break
        else:
            self.fail("Fixture manifest size did not converge")
        # These are deliberately small synthetic fixtures, not production smoke
        # evidence. Real CLI callers provide independently retained CI receipts.
        receipt = build_admission_receipt(root, run_id="unit-fixture", public_smoke="passed",
            source_identity={"gitSha": sha, "gitTree": "a" * 40},
            builder_identity={"path": "tools/build_pages_dist.py", "sha256": "b" * 64}, repo_root=self.repo)
        return root, receipt

    def test_partition_and_assemble_preserve_every_byte_without_hardlinks(self):
        root, receipt = self.artifact()
        package, restored = self.repo / ".runtime/package", self.repo / ".runtime/restored"
        result = partition_artifact(root, receipt, "1" * 40, package, repo_root=self.repo)
        self.assertFalse(result["urlsRewritten"])
        self.assertEqual(result["parts"]["data"]["fileCount"], 1)
        assemble_artifact(package, receipt, "1" * 40, restored, repo_root=self.repo)
        self.assertEqual(build_tree_snapshot(root), build_tree_snapshot(restored))
        (restored / "index.html").write_text("changed", encoding="utf-8")
        self.assertEqual((root / "index.html").read_text(), "A")
        self.assertEqual((package / "application/index.html").read_text(), "A")

    def test_changed_or_extra_partition_bytes_fail_before_output_publication(self):
        root, receipt = self.artifact()
        package = self.repo / ".runtime/package"
        partition_artifact(root, receipt, "1" * 40, package, repo_root=self.repo)
        (package / "data/app/data/scenarios/index.json").write_text("tampered")
        with self.assertRaises(ValueError):
            assemble_artifact(package, receipt, "1" * 40, self.repo / ".runtime/no-output", repo_root=self.repo)
        self.assertFalse((self.repo / ".runtime/no-output").exists())
        (package / "unexpected").write_text("extra")
        with self.assertRaises(ValueError):
            verify_partition(package, receipt, "1" * 40, repo_root=self.repo)

    def test_package_cannot_select_a_different_trusted_receipt(self):
        root, receipt = self.artifact()
        other, other_receipt = self.artifact("other", "B")
        package = self.repo / ".runtime/package"
        partition_artifact(root, receipt, "1" * 40, package, repo_root=self.repo)
        with self.assertRaises(ValueError):
            assemble_artifact(package, other_receipt, "1" * 40, self.repo / ".runtime/no-output", repo_root=self.repo)
        with self.assertRaises(ValueError):
            verify_partition(package, receipt, "2" * 40, repo_root=self.repo)

    def test_outputs_cannot_overwrite_inputs_or_escape_runtime(self):
        root, receipt = self.artifact()
        for output in (root, root / "nested", self.repo / "dist", self.repo / ".runtime"):
            with self.assertRaises(ValueError):
                partition_artifact(root, receipt, "1" * 40, output, repo_root=self.repo)
        self.assertEqual((root / "index.html").read_text(), "A")

    def test_source_mutation_while_copying_does_not_publish_package(self):
        import shutil
        root, receipt = self.artifact()
        original_copy = shutil.copyfile
        changed = False
        def mutate_after_copy(source, target):
            nonlocal changed
            result = original_copy(source, target)
            if not changed:
                changed = True
                (root / "index.html").write_text("changed input")
            return result
        with mock.patch("tools.pages_artifact_partition.shutil.copyfile", side_effect=mutate_after_copy):
            with self.assertRaises(ValueError):
                partition_artifact(root, receipt, "1" * 40, self.repo / ".runtime/rejected", repo_root=self.repo)
        self.assertFalse((self.repo / ".runtime/rejected").exists())

    def test_symbolic_link_package_is_rejected(self):
        root, receipt = self.artifact()
        link = self.repo / ".runtime/link"
        link.symlink_to(root, target_is_directory=True)
        with self.assertRaises(ValueError):
            partition_artifact(link, receipt, "1" * 40, self.repo / ".runtime/rejected", repo_root=self.repo)

    def rehearsal(self, command, output_name="rehearsal"):
        previous, previous_receipt = self.artifact("previous", "A", "1" * 40)
        candidate, candidate_receipt = self.artifact("candidate", "B", "2" * 40)
        return run_rehearsal(previous_root=previous, previous_receipt=previous_receipt, previous_sha="1" * 40,
            candidate_root=candidate, candidate_receipt=candidate_receipt, candidate_sha="2" * 40,
            output_root=self.repo / ".runtime" / output_name, smoke_command=command, repo_root=self.repo)

    def test_loopback_rehearsal_serves_selected_bytes_then_restores_previous(self):
        command = [sys.executable, "-c", "import os,urllib.request; u=os.environ['PLAYWRIGHT_TEST_BASE_URL']; assert u.startswith('http://127.0.0.1:'); expected=b'B' if os.environ['SCENARIO_FORGE_REHEARSAL_PHASE']=='candidate' else b'A'; assert urllib.request.urlopen(u).read()==expected"]
        report = self.rehearsal(command)
        self.assertEqual(report["status"], "passed")
        self.assertFalse(report["productionActions"])
        self.assertTrue(report["distinctArtifactBytes"])
        self.assertEqual([row["phase"] for row in report["phases"]], ["previous", "candidate", "restored-previous"])
        self.assertEqual(report["phases"][0]["artifactTreeSha256"], report["phases"][2]["artifactTreeSha256"])
        self.assertTrue(all(row["exitCode"] == 0 and not row["httpErrors"] for row in report["phases"]))

    def test_failed_smoke_stops_once_and_retains_failure_logs(self):
        with self.assertRaises(ValueError):
            self.rehearsal([sys.executable, "-c", "import sys; print('fixture failure'); sys.exit(7)"])
        output = self.repo / ".runtime/rehearsal"
        report = json.loads((output / "rehearsal.json").read_text())
        self.assertEqual(report["status"], "failed")
        self.assertEqual(len(report["phases"]), 1)
        self.assertEqual(report["phases"][0]["exitCode"], 7)
        self.assertIn("fixture failure", (output / "previous.stdout.log").read_text())

    def test_zero_exit_cannot_hide_input_mutation(self):
        command = [sys.executable, "-c", "import os,pathlib; (pathlib.Path(os.environ['SCENARIO_FORGE_PAGES_ARTIFACT_ROOT'])/'index.html').write_text('mutated')"]
        with self.assertRaises(ValueError):
            self.rehearsal(command)
        report = json.loads((self.repo / ".runtime/rehearsal/rehearsal.json").read_text())
        self.assertEqual(report["status"], "failed")
        self.assertEqual(len(report["phases"]), 1)

    def test_zero_exit_cannot_hide_failed_http_request(self):
        command = [sys.executable, "-c", "import os,urllib.request,urllib.error\ntry: urllib.request.urlopen(os.environ['PLAYWRIGHT_TEST_BASE_URL']+'missing')\nexcept urllib.error.HTTPError: pass"]
        with self.assertRaises(ValueError):
            self.rehearsal(command)
        report = json.loads((self.repo / ".runtime/rehearsal/rehearsal.json").read_text())
        self.assertEqual(report["phases"][0]["httpErrors"][0]["status"], 404)


if __name__ == "__main__":
    unittest.main()
