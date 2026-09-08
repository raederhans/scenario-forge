"""Prepare/check a fixed-source editor sparse checkout; never apply it to a worktree."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools import build_pages_dist as pages
from tools.pages_artifact_root import has_reparse_point_component, resolve_runtime_path

PROFILE = "public-editor-source"
POLICY_FILES = (
    "tools/editor_checkout_profile.py", "tools/build_pages_dist.py",
    "tools/pages_artifact_root.py", "tools/app_entry_resolver.py",
)


def git(repo: Path, *args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=repo)


def safe_path(value: str) -> str:
    if not isinstance(value, str) or not value or any(c in value for c in "\\\r\n\0"):
        raise ValueError(f"Unsupported repository path: {value!r}")
    parts = value.split("/")
    if any(p in ("", ".", "..") or p[-1:].isspace() for p in parts):
        raise ValueError(f"Unsafe repository path: {value!r}")
    return value


def sparse_pattern(value: str) -> str:
    # Root-anchored literal files: no directory globs, negation, or character classes.
    return "/" + "".join("\\" + c if c in "*?[]!#" else c for c in safe_path(value))


def read_tree(repo: Path, sha: str) -> dict[str, dict]:
    result = {}
    for row in git(repo, "ls-tree", "-rz", "--long", sha).split(b"\0"):
        if not row:
            continue
        meta, name = row.decode("utf-8").split("\t", 1)
        mode, kind, oid, size = meta.split()
        name = safe_path(name)
        if kind != "blob":
            raise ValueError(f"Unsupported tree entry: {name} ({kind})")
        result[name] = {"path": name, "mode": mode, "gitBlob": oid, "bytes": int(size)}
    return result


def data_references(value):
    if isinstance(value, dict):
        for child in value.values():
            yield from data_references(child)
    elif isinstance(value, list):
        for child in value:
            yield from data_references(child)
    elif isinstance(value, str) and value.startswith("data/"):
        yield safe_path(urlsplit(value).path)


def select_editor_files(entries: dict[str, dict], read_json) -> tuple[set[str], dict[str, list[str]]]:
    registry_path = "data/scenarios/index.json"
    registry = read_json(registry_path)
    public_ids = registry["public_baseline_ids"]
    if not public_ids or not {"hoi4_1936", "modern_world"}.issubset(public_ids):
        raise ValueError("Public editor scenario registry is incomplete")
    manifests = []
    for entry in registry["scenarios"]:
        if entry["scenario_id"] in public_ids:
            manifests.append(safe_path(entry["manifest_url"]))
    if len(manifests) != len(public_ids) or len(set(manifests)) != len(manifests):
        raise ValueError("Public editor scenario manifest mapping is incomplete")
    chunked = frozenset(
        Path(p).parent.relative_to("data/scenarios") / "runtime_topology.topo.json"
        for p in manifests if read_json(p).get("detail_chunk_manifest_url")
    )
    policy = pages.PagesProductionPublicationPolicy(chunked)

    def baseline(path: str) -> bool:
        if path.startswith("dist/"):
            return False
        if not path.startswith("data/"):
            return True
        relative = path[5:]
        if relative in (*pages.DATA_RUNTIME_FILES, "AGENTS.md", "CATALOG.md", "source_ledger.json"):
            return True
        if any(relative.startswith(d + "/") for d in pages.DATA_RUNTIME_DIRS):
            return True
        if relative.startswith(("scenarios/", "transport_layers/")):
            return policy.allows(path)
        if relative.startswith("hgo_catalogs/"):
            identity_path = relative[len("hgo_catalogs/"):]
            return identity_path in (*pages.HGO_IDENTITY_RUNTIME_FILES, "hgo_flags.png_manifest.json") or any(
                identity_path.startswith(f"flags_png/{tier}/") for tier in pages.HGO_IDENTITY_FLAG_TIERS
            )
        return False

    selected = {path for path in entries if baseline(path)}
    required = {"index.html", "start_dev.bat", "run_server.bat", "tools/dev_server.py",
                "data/CATALOG.json", "data/manifest.json", "data/runtime_asset_registry.json", registry_path}
    refs = {}
    # Unlike Pages, source metadata remains unchanged. Keep direct runtime registry
    # targets plus all public scenario references, including full topology/audits.
    # CATALOG/build-manifest inventories are not runtime dependency graphs; following
    # every listed source recipe/transport payload would recreate the full checkout.
    pending = ["data/runtime_asset_registry.json", *manifests]
    for entry in registry["scenarios"]:
        if entry["scenario_id"] in public_ids:
            required.update(data_references(entry))
    while pending:
        metadata = pending.pop()
        if metadata in refs:
            continue
        targets = sorted(set(data_references(read_json(metadata))))
        refs[metadata] = targets
        required.add(metadata)
        required.update(targets)
        for target in targets:
            if target.startswith("data/scenarios/") and "manifest" in PurePosixPath(target).name:
                pending.append(target)
    missing = sorted(required - entries.keys())
    if missing:
        raise ValueError(f"Required editor references absent from source tree: {missing}")
    selected.update(required)
    for path in selected:
        if entries[path]["mode"] not in ("100644", "100755"):
            raise ValueError(f"Selected path is not a regular Git file: {path}")
    return selected, refs


def prepare_profile(repo: Path, sha: str) -> dict:
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("An exact 40-character source commit is required")
    if git(repo, "rev-parse", f"{sha}^{{commit}}").decode().strip() != sha:
        raise ValueError("Source commit mismatch")
    # Policy must be the committed version for the selected source, even if the
    # caller supplies a different repo or has local edits to this script/imports.
    for path in POLICY_FILES:
        if (ROOT / path).read_bytes().replace(b"\r\n", b"\n") != git(repo, "show", f"{sha}:{path}").replace(b"\r\n", b"\n"):
            raise ValueError(f"Profile policy differs from source commit: {path}")
    entries = read_tree(repo, sha)
    cache = {}

    def read_json(path):
        path = safe_path(path)
        if path not in entries:
            raise ValueError(f"Metadata absent from source tree: {path}")
        if path not in cache:
            cache[path] = json.loads(git(repo, "show", f"{sha}:{path}"))
        return cache[path]

    selected, refs = select_editor_files(entries, read_json)
    groups = {key: [entries[p] for p in sorted(entries) if (p in selected) == keep]
              for key, keep in (("selected", True), ("excluded", False))}
    return {
        "profile": PROFILE,
        "source": {"commit": sha, "gitTree": git(repo, "rev-parse", f"{sha}^{{tree}}").decode().strip()},
        "scope": "Public scenario UI/owner editing with existing runtime assets; fast HOI4 1936 and Modern World roundtrip acceptance",
        "unsupported": ["HGO local preview", "full transport workbench payloads", "raw data rebuilding", "Pages build/release", "P4 history qualification"],
        "metadataReferences": refs,
        "measurement": "Git tree logical blob bytes; shared Git objects/history and download volume are unchanged",
        "totals": {key: {"files": len(rows), "bytes": sum(row["bytes"] for row in rows)} for key, rows in groups.items()},
        **groups,
    }


def source_presence(repo: Path, sha: str) -> list[dict]:
    ledger = json.loads(git(repo, "show", f"{sha}:data/source_ledger.json"))
    return [{"sourceId": row["source_id"], "path": safe_path(row["local_path"]),
             "present": (repo / safe_path(row["local_path"])).is_file(),
             "immutableRef": row.get("immutable_ref"), "expectedSha256": row.get("current_local_sha256"),
             "upstreamUrl": row.get("upstream_url"), "rebuildCommand": row.get("rebuild_command"),
             "localPresencePolicy": row.get("local_presence")}
            for row in ledger]


def check_materialization(repo: Path, profile: dict) -> dict:
    if git(repo, "rev-parse", "HEAD").decode().strip() != profile["source"]["commit"]:
        raise ValueError("Materialized worktree HEAD differs from profile source")
    parents = {str((repo / row["path"]).parent) for row in profile["selected"]}
    if any(has_reparse_point_component(Path(parent)) for parent in parents):
        raise ValueError("Materialized source must not traverse a symbolic link or junction")
    missing = [r["path"] for r in profile["selected"] if not (repo / r["path"]).is_file() or (repo / r["path"]).is_symlink()]
    unexpected = [r["path"] for r in profile["excluded"] if (repo / r["path"]).exists() or (repo / r["path"]).is_symlink()]
    if missing or unexpected:
        raise ValueError(f"Materialization mismatch: missing={missing}; excludedPresent={unexpected}")
    return {"files": len(profile["selected"]), "actualFileBytes": sum((repo / r["path"]).stat().st_size for r in profile["selected"]),
            "logicalGitBytes": profile["totals"]["selected"]["bytes"], "excludedPresent": 0,
            "note": "Selected tracked regular files only; excludes .git, dependencies, .runtime, filesystem allocation overhead"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "check"))
    parser.add_argument("--source", required=True, help="Full immutable source commit")
    parser.add_argument("--repo", type=Path, default=ROOT)
    parser.add_argument("--out-root", type=Path, required=True, help="Existing prepare output for check; new .runtime directory for prepare")
    args = parser.parse_args()
    repo = args.repo.resolve()
    out = resolve_runtime_path(args.out_root, repo_root=ROOT, require_directory=True)
    profile = prepare_profile(repo, args.source)
    patterns = "\n".join(sparse_pattern(row["path"]) for row in profile["selected"]) + "\n"
    if args.command == "prepare":
        presence = source_presence(repo, args.source)
        if out.exists():
            raise ValueError("Use a new profile output directory; existing evidence is retained")
        out.mkdir(parents=True)
        (out / "profile.json").write_text(json.dumps(profile, indent=2) + "\n", encoding="utf-8")
        (out / "sparse-checkout.txt").write_text(patterns, encoding="utf-8", newline="\n")
        (out / "source-presence.json").write_text(json.dumps(presence, indent=2) + "\n", encoding="utf-8")
    else:
        if json.loads((out / "profile.json").read_text(encoding="utf-8")) != profile or (out / "sparse-checkout.txt").read_text(encoding="utf-8") != patterns:
            raise ValueError("Prepared profile/patterns differ from the fixed-source selection")
        print(json.dumps(check_materialization(repo, profile), indent=2))
    print(json.dumps({"source": profile["source"], "totals": profile["totals"]}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as error:
        print(f"editor checkout profile failed: {error}", file=sys.stderr)
        raise SystemExit(2)
