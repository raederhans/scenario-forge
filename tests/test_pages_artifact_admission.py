from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from tools import build_pages_dist
from tools import pages_artifact_admission as admission
from tools import pages_artifact_shadow as shadow
from tools.pages_artifact_root import (
    PAGES_ARTIFACT_ROOT_ENV,
    PagesArtifactRootError,
    resolve_pages_artifact_root,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
RUNTIME_TMP_ROOT = REPO_ROOT / ".runtime" / "tmp"
REQUIRED_FILES = (
    "index.html",
    "app/index.html",
    ".nojekyll",
    "app/js/main.js",
    "app/data/CATALOG.json",
    "app/data/scenarios/index.json",
)


class QuietStaticHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args) -> None:
        return


def runtime_temp_directory() -> tempfile.TemporaryDirectory[str]:
    RUNTIME_TMP_ROOT.mkdir(parents=True, exist_ok=True)
    return tempfile.TemporaryDirectory(dir=RUNTIME_TMP_ROOT)


def write_fixture_artifact(root: Path) -> None:
    for relative_path in REQUIRED_FILES:
        path = root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        content = "<!doctype html><title>fixture</title>\n" if relative_path == "index.html" else f"fixture:{relative_path}\n"
        path.write_text(content, encoding="utf-8")
    manifest_path = root / shadow.MANIFEST_NAME
    payload = {
        "schema_version": 2,
        "total_bytes": 0,
        "max_allowed_bytes": 1024 * 1024,
        "size_gate": {"status": "within_limit"},
        "required_files": list(REQUIRED_FILES),
        "reachability_inventory": {"admission": {"status": "complete"}},
        "files": [],
    }
    for _ in range(20):
        manifest_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        snapshot = shadow.build_tree_snapshot(root)
        next_payload = dict(payload)
        next_payload["total_bytes"] = snapshot["totalBytes"]
        next_payload["files"] = [
            {
                "path": record["path"],
                "size_bytes": record["sizeBytes"],
                "source_kind": "fixture",
            }
            for record in snapshot["files"]
        ]
        if next_payload == payload:
            return
        payload = next_payload
    raise AssertionError("fixture manifest did not stabilize")


class PagesArtifactAdmissionTests(unittest.TestCase):
    def tearDown(self) -> None:
        build_pages_dist.configure_dist_root(env={})

    def test_root_contract_uses_explicit_runtime_env_and_tracked_fallback(self) -> None:
        with runtime_temp_directory() as tmp_dir:
            repo_root = Path(tmp_dir)
            tracked = repo_root / "dist"
            tracked.mkdir()
            artifact = repo_root / ".runtime" / "candidate" / "dist"
            artifact.mkdir(parents=True)

            self.assertEqual(resolve_pages_artifact_root(repo_root=repo_root, env={}), tracked.resolve())
            self.assertEqual(
                resolve_pages_artifact_root(
                    repo_root=repo_root,
                    env={PAGES_ARTIFACT_ROOT_ENV: ".runtime/candidate/dist"},
                    must_exist=True,
                ),
                artifact.resolve(),
            )
            with self.assertRaisesRegex(PagesArtifactRootError, "must not name tracked dist"):
                resolve_pages_artifact_root("dist", repo_root=repo_root)
            with self.assertRaisesRegex(PagesArtifactRootError, "inside repository .runtime"):
                resolve_pages_artifact_root(repo_root / "outside", repo_root=repo_root)
            with self.assertRaisesRegex(PagesArtifactRootError, "below repository .runtime"):
                resolve_pages_artifact_root(repo_root / ".runtime", repo_root=repo_root)

    def test_builder_honors_shared_artifact_root_env_without_creating_output(self) -> None:
        selected = build_pages_dist.configure_dist_root(
            env={PAGES_ARTIFACT_ROOT_ENV: ".runtime/m10-builder-contract-fixture/dist"}
        )
        self.assertEqual(selected, (REPO_ROOT / ".runtime" / "m10-builder-contract-fixture" / "dist").resolve())
        self.assertFalse(selected.exists())

    def test_compact_receipt_summary_and_fixture_http_smoke(self) -> None:
        with runtime_temp_directory() as tmp_dir:
            repo_root = Path(tmp_dir)
            artifact = repo_root / ".runtime" / "fixture" / "dist"
            write_fixture_artifact(artifact)
            receipt = admission.build_admission_receipt(
                artifact,
                run_id="fixture-run-1",
                public_smoke="passed",
                source_identity={"gitSha": "a" * 40, "gitTree": "b" * 40},
                builder_identity={"path": admission.BUILDER_PATH, "sha256": "c" * 64},
                repo_root=repo_root,
            )
            admission.validate_admission_receipt(receipt)
            summary = admission.build_admission_summary(receipt)

            self.assertNotIn("files", receipt["artifact"])
            self.assertLess(len(shadow.canonical_bytes(receipt)), 2048)
            self.assertEqual(summary["receiptSha256"], receipt["receiptSha256"])
            self.assertEqual(summary["artifactRoot"], ".runtime/fixture/dist")
            self.assertEqual(summary["publicSmoke"], "passed")

            handler = partial(QuietStaticHandler, directory=str(artifact))
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{server.server_port}/", timeout=5) as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn(b"fixture", response.read())
            finally:
                server.shutdown()
                thread.join(timeout=5)
                server.server_close()

    def test_tampered_artifact_and_receipt_fail_closed(self) -> None:
        with runtime_temp_directory() as tmp_dir:
            repo_root = Path(tmp_dir)
            artifact = repo_root / ".runtime" / "fixture" / "dist"
            write_fixture_artifact(artifact)
            (artifact / "app" / "js" / "main.js").write_text("tampered\n", encoding="utf-8")
            with self.assertRaisesRegex(shadow.ShadowVerificationError, "path/size"):
                admission.build_admission_receipt(
                    artifact,
                    run_id="fixture-run-2",
                    source_identity={"gitSha": "a" * 40, "gitTree": "b" * 40},
                    builder_identity={"path": admission.BUILDER_PATH, "sha256": "c" * 64},
                    repo_root=repo_root,
                )

            write_fixture_artifact(artifact)
            receipt = admission.build_admission_receipt(
                artifact,
                run_id="fixture-run-3",
                source_identity={"gitSha": "a" * 40, "gitTree": "b" * 40},
                builder_identity={"path": admission.BUILDER_PATH, "sha256": "c" * 64},
                repo_root=repo_root,
            )
            receipt["artifact"]["totalBytes"] += 1
            with self.assertRaisesRegex(admission.PagesArtifactAdmissionError, "receiptSha256 mismatch"):
                admission.validate_admission_receipt(receipt)

    def test_release_handoff_binds_source_smoke_and_actual_bytes(self) -> None:
        with runtime_temp_directory() as tmp_dir:
            repo_root = Path(tmp_dir)
            artifact = repo_root / ".runtime" / "fixture" / "dist"
            write_fixture_artifact(artifact)
            receipt = admission.build_admission_receipt(
                artifact, run_id="handoff", public_smoke="passed",
                source_identity={"gitSha": "a" * 40, "gitTree": "b" * 40},
                builder_identity={"path": admission.BUILDER_PATH, "sha256": "c" * 64},
                repo_root=repo_root,
            )
            result = admission.verify_artifact_handoff(
                artifact, receipt, expected_source_sha="a" * 40, repo_root=repo_root,
            )
            self.assertEqual(result["gitSha"], "a" * 40)
            with self.assertRaisesRegex(admission.PagesArtifactAdmissionError, "source SHA"):
                admission.verify_artifact_handoff(
                    artifact, receipt, expected_source_sha="d" * 40, repo_root=repo_root,
                )
            untested = {**receipt, "publicSmoke": "not-run"}
            untested["receiptSha256"] = admission.receipt_hash(untested)
            with self.assertRaisesRegex(admission.PagesArtifactAdmissionError, "smoke"):
                admission.verify_artifact_handoff(
                    artifact, untested, expected_source_sha="a" * 40, repo_root=repo_root,
                )
            # Preserve length so even a valid path/size manifest cannot hide changed bytes.
            main = artifact / "app" / "js" / "main.js"
            original = main.read_bytes()
            main.write_bytes(b"X" + original[1:])
            with self.assertRaisesRegex(admission.PagesArtifactAdmissionError, "treeSha256 mismatch"):
                admission.verify_artifact_handoff(
                    artifact, receipt, expected_source_sha="a" * 40, repo_root=repo_root,
                )

if __name__ == "__main__":
    unittest.main()
