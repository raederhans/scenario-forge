from __future__ import annotations

"""Fail-closed artifact-only Pages shadow verification.

This tool never builds or changes the checked-in ``dist`` tree.  The build
step writes under ``.runtime`` and this tool proves that result is byte-for-byte
equivalent to the clean, tracked delivery tree before a local public smoke is
allowed to count toward any tracked-dist retirement decision.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
TRACKED_DIST_ROOT = ROOT / "dist"
MANIFEST_NAME = "pages-dist-manifest.json"
RECEIPT_SCHEMA_VERSION = 1
COMPARISON_SCHEMA_VERSION = 1


class ShadowVerificationError(ValueError):
    pass


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalized_relative_path(value: str) -> str:
    candidate = str(value).replace("\\", "/")
    if not candidate or candidate.startswith("/") or ".." in Path(candidate).parts:
        raise ShadowVerificationError(f"invalid artifact relative path: {value!r}")
    return candidate


def has_reparse_point_component(path: Path) -> bool:
    candidate = path.expanduser().absolute()
    while True:
        try:
            is_junction = getattr(os.path, "isjunction", lambda _value: False)(candidate)
            if candidate.exists() and (candidate.is_symlink() or is_junction):
                return True
        except OSError:
            return True
        if candidate.parent == candidate:
            return False
        candidate = candidate.parent


def validate_cli_runtime_path(path: Path, *, label: str, must_exist: bool = False) -> Path:
    """Accept only non-reparse paths below this checkout's ignored runtime root."""
    if has_reparse_point_component(path):
        raise ShadowVerificationError(f"{label} must not traverse a symbolic link or junction")
    selected = path.expanduser().resolve()
    runtime_root = (ROOT / ".runtime").resolve()
    try:
        selected.relative_to(runtime_root)
    except ValueError as exc:
        raise ShadowVerificationError(f"{label} must be inside repository .runtime") from exc
    if must_exist and not selected.exists():
        raise ShadowVerificationError(f"{label} does not exist: {selected}")
    return selected


def build_tree_snapshot(root: Path) -> dict[str, Any]:
    root = root.resolve()
    if not root.is_dir():
        raise ShadowVerificationError(f"artifact root is not a directory: {root}")
    records: list[dict[str, Any]] = []
    for path in root.rglob("*"):
        is_junction = getattr(os.path, "isjunction", lambda _value: False)(path)
        if path.is_symlink() or is_junction:
            raise ShadowVerificationError(f"artifact tree must not contain symbolic link or junction: {path}")
        if not path.is_file():
            continue
        relative = normalized_relative_path(path.relative_to(root).as_posix())
        records.append({
            "path": relative,
            "sizeBytes": path.stat().st_size,
            "sha256": sha256_file(path),
        })
    records.sort(key=lambda record: record["path"])
    paths = [record["path"] for record in records]
    if len(paths) != len(set(paths)):
        raise ShadowVerificationError("artifact tree has duplicate normalized paths")
    return {
        "fileCount": len(records),
        "totalBytes": sum(int(record["sizeBytes"]) for record in records),
        "files": records,
        "treeSha256": sha256_bytes(canonical_bytes(records)),
    }


def validate_pages_manifest(root: Path, snapshot: dict[str, Any]) -> dict[str, Any]:
    manifest_path = root / MANIFEST_NAME
    if not manifest_path.is_file():
        raise ShadowVerificationError(f"artifact has no {MANIFEST_NAME}")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ShadowVerificationError(f"invalid Pages manifest: {exc}") from exc
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 2:
        raise ShadowVerificationError("Pages manifest schema_version must be 2")
    entries = manifest.get("files")
    if not isinstance(entries, list) or not entries:
        raise ShadowVerificationError("Pages manifest files must be a non-empty list")
    manifest_entries: list[tuple[str, int]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise ShadowVerificationError("Pages manifest files entry must be an object")
        path = normalized_relative_path(str(entry.get("path") or ""))
        size = entry.get("size_bytes")
        if not isinstance(size, int) or size < 0:
            raise ShadowVerificationError(f"Pages manifest invalid size for {path}")
        manifest_entries.append((path, size))
    if manifest_entries != sorted(manifest_entries, key=lambda item: item[0]):
        raise ShadowVerificationError("Pages manifest files must be path-sorted")
    if len(manifest_entries) != len(set(manifest_entries)):
        raise ShadowVerificationError("Pages manifest contains duplicate file entries")
    actual_entries = [(record["path"], int(record["sizeBytes"])) for record in snapshot["files"]]
    if manifest_entries != actual_entries:
        raise ShadowVerificationError("Pages manifest file path/size set does not match artifact tree")
    if int(manifest.get("total_bytes", -1)) != int(snapshot["totalBytes"]):
        raise ShadowVerificationError("Pages manifest total_bytes does not match artifact tree")
    required = manifest.get("required_files")
    if not isinstance(required, list) or not required:
        raise ShadowVerificationError("Pages manifest required_files must be non-empty")
    actual_paths = {record["path"] for record in snapshot["files"]}
    missing = sorted(normalized_relative_path(str(value)) for value in required if normalized_relative_path(str(value)) not in actual_paths)
    if missing:
        raise ShadowVerificationError(f"Pages artifact is missing manifest-required files: {', '.join(missing)}")
    reachability = manifest.get("reachability_inventory")
    if not isinstance(reachability, dict) or reachability.get("admission", {}).get("status") != "complete":
        raise ShadowVerificationError("Pages manifest reachability admission is not complete")
    size_gate = manifest.get("size_gate")
    if not isinstance(size_gate, dict) or size_gate.get("status") != "within_limit":
        raise ShadowVerificationError("Pages manifest size gate is not within_limit")
    return {
        "manifestSha256": sha256_file(manifest_path),
        "schemaVersion": manifest["schema_version"],
        "requiredFileCount": len(required),
        "reachabilityAdmission": reachability["admission"]["status"],
        "sizeGate": size_gate["status"],
    }


def run_git(args: list[str], *, repo_root: Path = ROOT) -> str:
    result = subprocess.run(["git", *args], cwd=repo_root, text=True, capture_output=True)
    if result.returncode:
        raise ShadowVerificationError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    # Porcelain status uses leading spaces as fixed-width index/worktree columns.
    return result.stdout.rstrip("\r\n")


def read_git_identity(*, repo_root: Path = ROOT) -> dict[str, str]:
    status = run_git(["status", "--porcelain", "--untracked-files=all"], repo_root=repo_root)
    for line in status.splitlines():
        changed_path = line[3:].replace("\\", "/") if len(line) >= 4 else ""
        if changed_path != "dist" and not changed_path.startswith("dist/"):
            raise ShadowVerificationError(
                f"artifact shadow permits reference-build changes only under tracked dist: {changed_path or line}"
            )
    sha = run_git(["rev-parse", "HEAD"], repo_root=repo_root)
    tree = run_git(["rev-parse", "HEAD^{tree}"], repo_root=repo_root)
    dist_tree = run_git(["rev-parse", "HEAD:dist"], repo_root=repo_root)
    return {"sha": sha, "tree": tree, "rollbackDistTree": dist_tree}


def build_comparison(
    artifact_root: Path,
    *,
    evidence_run_id: str,
    tracked_root: Path = TRACKED_DIST_ROOT,
    git_identity: dict[str, str] | None = None,
) -> dict[str, Any]:
    if not evidence_run_id.strip():
        raise ShadowVerificationError("comparison evidence runId is required")
    artifact_root = artifact_root.resolve()
    tracked_root = tracked_root.resolve()
    if artifact_root == tracked_root:
        raise ShadowVerificationError("artifact root must not be the tracked dist root")
    artifact_snapshot = build_tree_snapshot(artifact_root)
    tracked_snapshot = build_tree_snapshot(tracked_root)
    artifact_manifest = validate_pages_manifest(artifact_root, artifact_snapshot)
    tracked_manifest = validate_pages_manifest(tracked_root, tracked_snapshot)
    file_hashes_match = artifact_snapshot["files"] == tracked_snapshot["files"]
    manifest_matches = artifact_manifest["manifestSha256"] == tracked_manifest["manifestSha256"]
    tree_matches = artifact_snapshot["treeSha256"] == tracked_snapshot["treeSha256"]
    if not (file_hashes_match and manifest_matches and tree_matches):
        raise ShadowVerificationError("artifact Pages tree is not byte-equivalent to tracked dist")
    identity = git_identity or read_git_identity()
    if not all(isinstance(identity.get(field), str) and identity[field] for field in ("sha", "tree", "rollbackDistTree")):
        raise ShadowVerificationError("git identity must include sha, tree, and rollbackDistTree")
    comparison = {
        "schemaVersion": COMPARISON_SCHEMA_VERSION,
        "status": "passed",
        "evidenceRunId": evidence_run_id,
        "git": dict(identity),
        "rollback": {"trackedDistGitTree": identity["rollbackDistTree"]},
        "referenceBuild": {"mode": "legacy-tracked-dist", "changesConfinedToDist": True},
        "artifact": {**artifact_snapshot, **artifact_manifest},
        "tracked": {**tracked_snapshot, **tracked_manifest},
        "equivalence": {
            "manifestSha256Matches": manifest_matches,
            "treeSha256Matches": tree_matches,
            "fileSha256Matches": file_hashes_match,
        },
    }
    comparison["comparisonSha256"] = sha256_bytes(canonical_bytes(comparison))
    return comparison


def validate_comparison(comparison: dict[str, Any]) -> None:
    supplied_hash = str(comparison.get("comparisonSha256") or "")
    unsigned = dict(comparison)
    unsigned.pop("comparisonSha256", None)
    if supplied_hash != sha256_bytes(canonical_bytes(unsigned)):
        raise ShadowVerificationError("comparisonSha256 mismatch")
    if comparison.get("schemaVersion") != COMPARISON_SCHEMA_VERSION or comparison.get("status") != "passed":
        raise ShadowVerificationError("comparison is not a passed current schema artifact")
    if not isinstance(comparison.get("evidenceRunId"), str) or not comparison["evidenceRunId"].strip():
        raise ShadowVerificationError("comparison evidence runId is missing")
    equivalence = comparison.get("equivalence")
    if not isinstance(equivalence, dict) or not all(equivalence.get(key) is True for key in (
        "manifestSha256Matches", "treeSha256Matches", "fileSha256Matches",
    )):
        raise ShadowVerificationError("comparison equivalence is incomplete")
    for section in ("artifact", "tracked"):
        value = comparison.get(section)
        if not isinstance(value, dict) or not value.get("treeSha256") or not value.get("manifestSha256"):
            raise ShadowVerificationError(f"comparison {section} identity is incomplete")
        files = value.get("files")
        if not isinstance(files, list) or value.get("fileCount") != len(files):
            raise ShadowVerificationError(f"comparison {section} inventory is incomplete")
    artifact = comparison["artifact"]
    tracked = comparison["tracked"]
    if artifact.get("files") != tracked.get("files"):
        raise ShadowVerificationError("comparison file inventories are not equal")
    if artifact.get("treeSha256") != tracked.get("treeSha256"):
        raise ShadowVerificationError("comparison tree identities are not equal")
    if artifact.get("manifestSha256") != tracked.get("manifestSha256"):
        raise ShadowVerificationError("comparison manifest identities are not equal")
    git = comparison.get("git")
    rollback = comparison.get("rollback")
    if not isinstance(git, dict) or any(
        not isinstance(git.get(field), str) or len(git[field]) != 40
        for field in ("sha", "tree", "rollbackDistTree")
    ):
        raise ShadowVerificationError("comparison git identity is incomplete")
    if not isinstance(rollback, dict) or rollback.get("trackedDistGitTree") != git["rollbackDistTree"]:
        raise ShadowVerificationError("comparison rollback identity is inconsistent")
    reference_build = comparison.get("referenceBuild")
    if reference_build != {"mode": "legacy-tracked-dist", "changesConfinedToDist": True}:
        raise ShadowVerificationError("comparison reference build identity is invalid")


def receipt_identity(comparison: dict[str, Any]) -> dict[str, str]:
    git = comparison["git"]
    return {
        "gitSha": git["sha"],
        "gitTree": git["tree"],
        "rollbackDistTree": git["rollbackDistTree"],
        "manifestSha256": comparison["artifact"]["manifestSha256"],
        "treeSha256": comparison["artifact"]["treeSha256"],
    }


def receipt_hash(receipt: dict[str, Any]) -> str:
    unsigned = dict(receipt)
    unsigned.pop("receiptSha256", None)
    return sha256_bytes(canonical_bytes(unsigned))


def load_receipt(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ShadowVerificationError(f"cannot read previous receipt: {exc}") from exc
    if not isinstance(value, dict) or value.get("receiptSha256") != receipt_hash(value):
        raise ShadowVerificationError("previous receipt hash mismatch")
    if value.get("schemaVersion") != RECEIPT_SCHEMA_VERSION:
        raise ShadowVerificationError("previous receipt schema mismatch")
    return value


def validate_previous_receipt(receipt: dict[str, Any]) -> None:
    if receipt.get("receiptSha256") != receipt_hash(receipt):
        raise ShadowVerificationError("previous receipt hash mismatch")
    if receipt.get("schemaVersion") != RECEIPT_SCHEMA_VERSION:
        raise ShadowVerificationError("previous receipt schema mismatch")
    if receipt.get("status") not in {"green", "failed-public-smoke"}:
        raise ShadowVerificationError("previous receipt status is invalid")
    if receipt.get("publicSmoke") not in {"passed", "failed"}:
        raise ShadowVerificationError("previous receipt public smoke is invalid")
    if (receipt.get("status") == "green") != (receipt.get("publicSmoke") == "passed"):
        raise ShadowVerificationError("previous receipt status/public smoke disagree")
    count = receipt.get("consecutiveGreenRuns")
    if not isinstance(count, int) or count < 0:
        raise ShadowVerificationError("previous receipt green count is invalid")
    if receipt.get("trackedDistRetirementEligible") is not (count >= 3):
        raise ShadowVerificationError("previous receipt retirement eligibility is invalid")
    if receipt.get("legacyTrackedDistRetained") is not True:
        raise ShadowVerificationError("previous receipt must retain tracked dist")
    evidence_run_ids = receipt.get("evidenceRunIds")
    if (
        not isinstance(evidence_run_ids, list)
        or not evidence_run_ids
        or any(not isinstance(run_id, str) or not run_id for run_id in evidence_run_ids)
        or len(evidence_run_ids) != len(set(evidence_run_ids))
        or evidence_run_ids[-1] != receipt.get("runId")
    ):
        raise ShadowVerificationError("previous receipt evidence run chain is invalid")
    if count > len(evidence_run_ids):
        raise ShadowVerificationError("previous receipt green count exceeds its evidence run chain")
    identity = receipt.get("identity")
    if not isinstance(identity, dict) or any(not isinstance(identity.get(field), str) or not identity[field] for field in (
        "gitSha", "gitTree", "rollbackDistTree", "manifestSha256", "treeSha256",
    )):
        raise ShadowVerificationError("previous receipt identity is incomplete")


def build_receipt(
    comparison: dict[str, Any],
    *,
    public_smoke: str,
    previous: dict[str, Any] | None = None,
) -> dict[str, Any]:
    validate_comparison(comparison)
    run_id = comparison["evidenceRunId"]
    if public_smoke not in {"passed", "failed"}:
        raise ShadowVerificationError("public smoke must be passed or failed")
    identity = receipt_identity(comparison)
    is_green = public_smoke == "passed"
    previous_hash = None
    previous_count = 0
    previous_identity = None
    evidence_run_ids: list[str] = []
    if previous is not None:
        validate_previous_receipt(previous)
        evidence_run_ids = list(previous["evidenceRunIds"])
        if run_id in evidence_run_ids:
            raise ShadowVerificationError("comparison evidence runId must not repeat")
        previous_hash = previous["receiptSha256"]
        if previous.get("status") == "green":
            previous_count = int(previous["consecutiveGreenRuns"])
            previous_identity = previous["identity"]
    same_identity = previous_identity == identity
    green_count = (previous_count + 1) if is_green and same_identity else (1 if is_green else 0)
    receipt = {
        "schemaVersion": RECEIPT_SCHEMA_VERSION,
        "status": "green" if is_green else "failed-public-smoke",
        "runId": run_id,
        "evidenceRunIds": [*evidence_run_ids, run_id],
        "comparisonSha256": comparison["comparisonSha256"],
        "publicSmoke": public_smoke,
        "identity": identity,
        "previousReceiptSha256": previous_hash,
        "consecutiveGreenRuns": green_count,
        "trackedDistRetirementEligible": green_count >= 3,
        "legacyTrackedDistRetained": True,
    }
    receipt["receiptSha256"] = receipt_hash(receipt)
    return receipt


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify an artifact-only Pages shadow")
    commands = parser.add_subparsers(dest="command", required=True)
    verify = commands.add_parser("verify")
    verify.add_argument("--artifact-root", type=Path, required=True)
    verify.add_argument("--run-id", required=True)
    verify.add_argument("--comparison-out", type=Path, required=True)
    receipt = commands.add_parser("receipt")
    receipt.add_argument("--comparison", type=Path, required=True)
    receipt.add_argument("--public-smoke", choices=("passed", "failed"), required=True)
    receipt.add_argument("--out", type=Path, required=True)
    receipt.add_argument("--previous", type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.command == "verify":
            artifact_root = validate_cli_runtime_path(args.artifact_root, label="artifact root", must_exist=True)
            comparison_out = validate_cli_runtime_path(args.comparison_out, label="comparison output")
            comparison = build_comparison(artifact_root, evidence_run_id=args.run_id)
            write_json(comparison_out, comparison)
        else:
            comparison_path = validate_cli_runtime_path(args.comparison, label="comparison", must_exist=True)
            out_path = validate_cli_runtime_path(args.out, label="receipt output")
            comparison = json.loads(comparison_path.read_text(encoding="utf-8"))
            previous = load_receipt(validate_cli_runtime_path(args.previous, label="previous receipt", must_exist=True)) if args.previous else None
            receipt = build_receipt(comparison, public_smoke=args.public_smoke, previous=previous)
            write_json(out_path, receipt)
        return 0
    except (OSError, ValueError, ShadowVerificationError) as exc:
        print(f"pages artifact shadow failed: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
