"""Apply the generator's LOD policy to the checked-in scenario chunks."""

import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from map_builder.io.writers import write_bytes_atomic, write_json_atomic
from tools.build_startup_bundle import _gzip_bytes
from tools.check_scenario_contracts import _sha256_path
from tools.refresh_political_id_raster_snapshot import refresh_snapshot
from tools.scenario_chunk_assets import apply_chunk_lod_policy


def refresh_scenario(scenario_id: str) -> None:
    directory = ROOT / "data" / "scenarios" / scenario_id
    detail_path = directory / "detail_chunks.manifest.json"
    context_path = directory / "context_lod.manifest.json"
    raw_detail = detail_path.read_bytes()
    detail = json.loads(raw_detail)
    context = json.loads(context_path.read_bytes())
    apply_chunk_lod_policy(directory, detail, context)
    pretty = raw_detail.startswith(b"{\n")
    write_json_atomic(detail_path, detail, indent=2 if pretty else None,
                      separators=None if pretty else (",", ":"), trailing_newline=raw_detail.endswith(b"\n"))
    write_json_atomic(context_path, context, trailing_newline=True)

    digest = _sha256_path(detail_path).encode("ascii")
    ledger = directory / "derived" / "atlantropa_donor_ledger.json"
    bundles = [directory / f"startup.bundle.{lang}.json" for lang in ("en", "zh")]
    sources = [directory / "manifest.json", directory / "audit.json", *bundles]
    if ledger.exists():
        sources.append(ledger)
    for path in sources:
        # Keep the startup geometry's numeric tokens byte-exact.
        raw = re.sub(rb'("detail_chunk_manifest_sha256"\s*:\s*")[a-f0-9]{64}(")',
                     lambda match: match[1] + digest + match[2], path.read_bytes())
        write_bytes_atomic(path, raw)
        if path in bundles:
            write_bytes_atomic(path.with_suffix(".json.gz"), _gzip_bytes(raw))
    if ledger.exists():
        meta_path = directory / "runtime_meta.json"
        meta = json.loads(meta_path.read_bytes())
        meta["coverage_ledger_hashes"]["atlantropa_donor_ledger"] = _sha256_path(ledger)
        write_json_atomic(meta_path, meta, trailing_newline=True)
    refresh_snapshot(scenario_id)


if __name__ == "__main__":
    for scenario_id in ("tno_1962", "hoi4_1936", "hoi4_1939"):
        refresh_scenario(scenario_id)
