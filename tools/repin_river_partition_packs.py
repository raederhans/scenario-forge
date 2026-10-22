"""Re-pin reviewed river-paint packs to the current scenario topology and baseline.

Political feature merges change the land topology bytes and the scenario
baseline, both of which are part of each pack's identity. Every pack is rebuilt
from its own recorded source (rivers, parents, lake option) and must keep
byte-identical parents and support; only the pinned identity may change. The
transport downloads and the approved IDs in js/core/river_paint/pilot_manifest.js
(and its dist mirror, when it was in sync) are updated to match.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKS = ROOT / "data/river_partitions"
MANIFEST = ROOT / "js/core/river_paint/pilot_manifest.js"
MANIFEST_MIRROR = ROOT / "dist/app/js/core/river_paint/pilot_manifest.js"
CANONICAL_SCRIPT = """
import fs from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
const { normalizeRiverPartitionPack } = await import(pathToFileURL(process.argv[1]).href);
const pack = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.stdout.write(createHash("sha256").update(JSON.stringify(normalizeRiverPartitionPack(pack))).digest("hex"));
"""


def canonical_sha256(path: Path) -> str:
    return subprocess.run(
        ["node", "--input-type=module", "-e", CANONICAL_SCRIPT, "--",
         str(ROOT / "js/core/river_paint/partition_model.js"), str(path)],
        check=True, capture_output=True, text=True, cwd=ROOT,
    ).stdout.strip()


def rebuild(pack_path: Path, base_commit: str, output: Path) -> tuple[dict, dict]:
    """Build into `output` (the builder also writes an audit beside it), then replace the pack."""
    old = json.loads(pack_path.read_text(encoding="utf-8"))
    source = old["source"]
    scenario_manifest = json.loads((ROOT / f"data/scenarios/{old['sceneId']}/manifest.json").read_text(encoding="utf-8"))
    command = [sys.executable, str(ROOT / "tools/build_river_partitions.py"),
               "--land", source["landPath"], "--rivers", source["riverPath"], "--scene-id", old["sceneId"],
               "--base-commit", base_commit, "--baseline-hash", scenario_manifest["baseline_hash"],
               "--output", str(output)]
    command += [arg for name in source["riverNames"] for arg in ("--river", name)]
    command += [arg for row in old["parents"] for arg in ("--parent", str(row["parentId"]))]
    if source.get("includeLakeCenterlines"):
        command.append("--include-lake-centerlines")
    subprocess.run(command, check=True, cwd=ROOT, stdout=subprocess.DEVNULL)
    new = json.loads(output.read_text(encoding="utf-8"))
    for key in ("parents", "support"):
        if new.get(key) != old.get(key):
            raise SystemExit(f"{pack_path.name}: {key} changed; a merge touched a reviewed river parcel")
    pack_path.write_bytes(output.read_bytes())
    return old, new


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-commit", default="", help="Provenance commit (default: HEAD).")
    args = parser.parse_args()
    base_commit = args.base_commit or subprocess.run(
        ["git", "rev-parse", "HEAD"], check=True, capture_output=True, text=True, cwd=ROOT).stdout.strip()
    manifest_text = MANIFEST.read_text(encoding="utf-8")
    mirror_in_sync = MANIFEST_MIRROR.exists() and (
        MANIFEST_MIRROR.read_bytes().replace(b"\r\n", b"\n") == MANIFEST.read_bytes().replace(b"\r\n", b"\n"))
    report = {}
    for pack_path in sorted(PACKS.glob("*.json")):
        if pack_path.name.endswith(".transport.json"):
            continue
        old_canonical = canonical_sha256(pack_path)
        with tempfile.TemporaryDirectory() as directory:
            old, new = rebuild(pack_path, base_commit, Path(directory) / pack_path.name)
        transport = pack_path.with_name(pack_path.stem + ".transport.json")
        if transport.exists():
            with tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / transport.name
                subprocess.run([sys.executable, str(ROOT / "tools/river_partitions/compact_transport.py"),
                                str(pack_path), str(output)], check=True, cwd=ROOT, stdout=subprocess.DEVNULL)
                transport.write_bytes(output.read_bytes())
        new_canonical = canonical_sha256(pack_path)
        for before, after in ((old["packId"], new["packId"]), (old_canonical, new_canonical)):
            if before != after:
                if manifest_text.count(before) != 1:
                    raise SystemExit(f"{pack_path.name}: {before} is not pinned exactly once in {MANIFEST.name}")
                manifest_text = manifest_text.replace(before, after)
        report[pack_path.stem] = new["packId"][7:19]
    MANIFEST.write_bytes(manifest_text.encode("utf-8"))
    if mirror_in_sync:
        MANIFEST_MIRROR.write_bytes(MANIFEST.read_bytes())
    print(json.dumps(report))


if __name__ == "__main__":
    main()
