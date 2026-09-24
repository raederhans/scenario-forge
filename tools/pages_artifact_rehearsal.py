from __future__ import annotations

"""Isolated previous -> candidate -> previous artifact rehearsal.

Never invokes a deployment API, changes a Git ref, edits a source artifact or
binds a non-loopback address. Rehearsal receipts are not production approvals.
"""
import argparse
import functools
import http.server
import json
import os
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.pages_artifact_admission import verify_artifact_handoff
from tools.pages_artifact_root import resolve_runtime_path
from tools.pages_artifact_shadow import canonical_bytes, sha256_file


class ArtifactRehearsalError(ValueError):
    pass


class LoopbackArtifactServer:
    def __init__(self, root: Path):
        self.errors: list[dict[str, Any]] = []
        errors = self.errors

        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, _format, *_args):
                pass

            def log_request(self, code="-", size="-"):
                if isinstance(code, int) and code >= 400:
                    errors.append({"status": code, "path": self.path})

            def end_headers(self):
                self.send_header("Cache-Control", "no-store")
                super().end_headers()

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(root)))
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.url = f"http://127.0.0.1:{self.server.server_port}/"

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_exc):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()


def run_rehearsal(*, previous_root: Path, previous_receipt: dict[str, Any], previous_sha: str,
                  candidate_root: Path, candidate_receipt: dict[str, Any], candidate_sha: str,
                  output_root: Path, smoke_command: list[str], repo_root: Path = ROOT) -> dict[str, Any]:
    if not smoke_command or any(not isinstance(arg, str) or not arg or "\0" in arg for arg in smoke_command):
        raise ArtifactRehearsalError("Smoke command must be a nonempty JSON argv array")
    previous = resolve_runtime_path(previous_root, repo_root=repo_root, must_exist=True, require_directory=True)
    candidate = resolve_runtime_path(candidate_root, repo_root=repo_root, must_exist=True, require_directory=True)
    output = resolve_runtime_path(output_root, repo_root=repo_root, require_directory=True)
    if output.exists() or any(output == root or output in root.parents or root in output.parents for root in (previous, candidate)):
        raise ArtifactRehearsalError("Rehearsal output must be new and disjoint from both artifacts")
    # Both independently retained receipts must validate before any server starts.
    verify_artifact_handoff(previous, previous_receipt, expected_source_sha=previous_sha, repo_root=repo_root)
    verify_artifact_handoff(candidate, candidate_receipt, expected_source_sha=candidate_sha, repo_root=repo_root)
    output.mkdir(parents=True)
    report = {
        "schemaVersion": 1, "kind": "isolated-pages-recovery-rehearsal", "status": "running",
        "productionActions": False, "bindAddress": "127.0.0.1", "command": list(smoke_command),
        "distinctArtifactBytes": previous_receipt["artifact"]["treeSha256"] != candidate_receipt["artifact"]["treeSha256"],
        "phases": [],
    }
    try:
        for phase, root, receipt, source_sha in (
            ("previous", previous, previous_receipt, previous_sha),
            ("candidate", candidate, candidate_receipt, candidate_sha),
            ("restored-previous", previous, previous_receipt, previous_sha),
        ):
            verify_artifact_handoff(root, receipt, expected_source_sha=source_sha, repo_root=repo_root)
            row = {"phase": phase, "sourceSha": source_sha, "receiptSha256": receipt["receiptSha256"],
                   "artifactTreeSha256": receipt["artifact"]["treeSha256"], "status": "running"}
            report["phases"].append(row)
            stdout_path, stderr_path = output / f"{phase}.stdout.log", output / f"{phase}.stderr.log"
            # A fresh fixed-root server for each phase prevents an in-flight
            # request from mixing releases during a mutable-directory switch.
            with LoopbackArtifactServer(root) as server:
                environment = dict(os.environ)
                environment.update({
                    "PLAYWRIGHT_TEST_BASE_URL": server.url,
                    "SCENARIO_FORGE_PAGES_URL": server.url,
                    "SCENARIO_FORGE_PAGES_ARTIFACT_ROOT": str(root),
                    "SCENARIO_FORGE_REHEARSAL_PHASE": phase,
                    "SCENARIO_FORGE_REHEARSAL_SOURCE_SHA": source_sha,
                })
                with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
                    process = subprocess.run(smoke_command, cwd=repo_root, env=environment,
                                             stdout=stdout, stderr=stderr, shell=False, check=False)
                row.update({"exitCode": process.returncode, "httpErrors": list(server.errors),
                            "stdoutSha256": sha256_file(stdout_path), "stderrSha256": sha256_file(stderr_path)})
            # A zero command exit cannot legitimize changed input bytes.
            verify_artifact_handoff(root, receipt, expected_source_sha=source_sha, repo_root=repo_root)
            if process.returncode or row["httpErrors"]:
                row["status"] = "failed"
                raise ArtifactRehearsalError(f"{phase} smoke failed; preserve raw logs")
            row["status"] = "passed"
        if report["phases"][0]["artifactTreeSha256"] != report["phases"][2]["artifactTreeSha256"]:
            raise ArtifactRehearsalError("Restored bytes differ from the selected previous release")
        report["status"] = "passed"
        return report
    except BaseException as error:
        report["status"] = "failed"
        report["error"] = str(error)
        if report["phases"] and report["phases"][-1]["status"] == "running":
            report["phases"][-1]["status"] = "failed"
        raise
    finally:
        (output / "rehearsal.json").write_bytes(canonical_bytes(report) + b"\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for prefix in ("previous", "candidate"):
        parser.add_argument(f"--{prefix}-root", type=Path, required=True)
        parser.add_argument(f"--{prefix}-receipt", type=Path, required=True)
        parser.add_argument(f"--{prefix}-sha", required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--smoke-command-json", required=True)
    args = parser.parse_args(argv)
    try:
        values = vars(args)
        command = json.loads(values.pop("smoke_command_json"))
        if not isinstance(command, list):
            raise ArtifactRehearsalError("Smoke command must be a JSON argv array")
        for key in ("previous_receipt", "candidate_receipt"):
            path = resolve_runtime_path(values[key], repo_root=ROOT, must_exist=True)
            values[key] = json.loads(path.read_text(encoding="utf-8"))
        result = run_rehearsal(**values, smoke_command=command)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Artifact rehearsal failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
