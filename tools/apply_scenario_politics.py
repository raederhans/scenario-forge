"""Apply starting politics after building scenarios.

After split overlays, corrections, or any other countries.json changes, rerun
python tools/apply_scenario_politics.py.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scenario_builder.hoi4.politics import GAME_TAG_ALIASES, annotate_countries, read_histories
from tools.refresh_political_id_raster_snapshot import refresh_snapshot
from tools.check_scenario_contracts import _compose_snapshot_payload

SCENARIOS = ("hoi4_1936", "hoi4_1939", "tno_1962")
GAME_ROOT = Path("C:/Program Files (x86)/Steam/steamapps/common/Hearts of Iron IV")
TNO_ROOT = Path("C:/Program Files (x86)/Steam/steamapps/workshop/content/394360/2438003901")
# Scenario-only tags that have neither a game history file nor a parent to inherit from.
# Chinese cliques follow the vanilla warlords (SHX/GXC/YUN/XSM are all neutrality);
# San Marino was governed by the Sammarinese Fascist Party from 1923 to 1943.
_CHINESE_CLIQUES = ("GMA", "HBC", "HNN", "LUQ", "QMA", "YUE")
_HOI4_OVERRIDES = {
    **{tag: {"ruling_ideology": "neutrality"} for tag in _CHINESE_CLIQUES},
    "SMN": {"ruling_ideology": "fascism"},
}
MANUAL_OVERRIDES = {"hoi4_1936": _HOI4_OVERRIDES, "hoi4_1939": _HOI4_OVERRIDES}


def compact(payload: object) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def node_gzip(raw: bytes) -> bytes:
    """Compress like tools/build_political_id_raster_assets.mjs, the bundles' other writer.

    Node's zlib output is about 0.8% smaller than Python's for these bundles and
    reproduces the committed sidecars byte for byte.
    """
    script = "process.stdout.write(require('node:zlib').gzipSync(require('fs').readFileSync(0), { level: 9 }))"
    return subprocess.run(["node", "-e", script], input=raw, capture_output=True, check=True).stdout


def replace_bundle(text: str, old: dict, new: dict, old_sha: str, new_sha: str) -> str:
    old_s = compact(old)
    old_source = f'"countries_sha256":"{old_sha}"'
    assert text.count(old_s) == 1, "Old countries payload must occur exactly once"
    assert text.count(old_source) == 1, "Old countries sha256 must occur exactly once"
    updated = text.replace(old_s, compact(new), 1).replace(
        old_source, f'"countries_sha256":"{new_sha}"', 1,
    )
    payload = json.loads(updated)
    assert payload["scenario"]["countries"] == new
    assert payload["source"]["countries_sha256"] == new_sha
    return updated


def prepare(scenario_id: str) -> tuple[dict, dict]:
    directory = ROOT / "data/scenarios" / scenario_id
    countries_path = directory / "countries.json"
    original = countries_path.read_bytes()
    old = json.loads(original)
    manifest = json.loads((directory / "manifest.json").read_bytes())
    source = TNO_ROOT if scenario_id == "tno_1962" else GAME_ROOT
    new, report = annotate_countries(
        old, read_histories(source / "history/countries"), manifest["bookmark_date"],
        MANUAL_OVERRIDES.get(scenario_id),
        game_tag_aliases=GAME_TAG_ALIASES.get(scenario_id),
    )
    if scenario_id == "tno_1962":
        raw = json.dumps(new, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    else:
        raw = (json.dumps(new, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    new = json.loads(raw)
    old_sha = hashlib.sha256(original).hexdigest()
    new_sha = hashlib.sha256(raw).hexdigest()
    outputs = {countries_path: raw}
    for language in ("en", "zh"):
        path = directory / f"startup.bundle.{language}.json"
        text = path.read_bytes().decode("utf-8")
        updated = replace_bundle(text, old, new, old_sha, new_sha).encode("utf-8")
        outputs[path] = updated
        outputs[path.with_suffix(".json.gz")] = node_gzip(updated)
    return outputs, report


def snapshot_matches(scenario_id: str) -> bool:
    directory = ROOT / "data/scenarios" / scenario_id
    manifest = json.loads((directory / "manifest.json").read_bytes())
    snapshot_path = directory / "build_snapshot.json"
    snapshot = json.loads(snapshot_path.read_bytes())
    audit = json.loads((directory / "audit.json").read_bytes())
    return (
        snapshot == _compose_snapshot_payload(directory, manifest)
        and manifest["snapshot_fingerprint"] == snapshot["snapshot_fingerprint"]
        and audit["snapshot_fingerprint"] == snapshot["snapshot_fingerprint"]
        and audit["source"]["build_snapshot_sha256"] == hashlib.sha256(snapshot_path.read_bytes()).hexdigest()
        and all(not (directory / f"{name}.gz").exists()
                or gzip.decompress((directory / f"{name}.gz").read_bytes()) == (directory / name).read_bytes()
                for name in ("manifest.json", "build_snapshot.json", "audit.json"))
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", action="append", choices=SCENARIOS)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    prepared = {scenario_id: prepare(scenario_id) for scenario_id in (args.scenario or SCENARIOS)}
    consistent = True
    for scenario_id, (outputs, report) in prepared.items():
        changed = {path: raw for path, raw in outputs.items() if path.read_bytes() != raw}
        current = not changed and snapshot_matches(scenario_id)
        consistent = consistent and current
        if not args.check and not current:
            for path, raw in changed.items():
                path.write_bytes(raw)
            for language in ("en", "zh"):
                bundle_path = ROOT / "data/scenarios" / scenario_id / f"startup.bundle.{language}.json"
                bundle = json.loads(bundle_path.read_bytes())
                countries_raw = (bundle_path.parent / "countries.json").read_bytes()
                assert bundle["scenario"]["countries"] == json.loads(countries_raw)
                assert bundle["source"]["countries_sha256"] == hashlib.sha256(countries_raw).hexdigest()
            refresh_snapshot(scenario_id)
        print(f"{scenario_id}: {'consistent' if current else 'differs' if args.check else 'updated'}")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps({key: report for key, (_, report) in prepared.items()}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return int(args.check and not consistent)


if __name__ == "__main__":
    raise SystemExit(main())
