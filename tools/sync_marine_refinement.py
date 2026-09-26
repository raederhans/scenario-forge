"""Refresh ocean-dependent metadata/startup assets without rebuilding political chunks.

Run after adopting validated outputs from rebuild_water_geometry --refine-marine.
The normal strict scenario checker remains the final read-only gate.
"""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.check_scenario_contracts import (
    apply_safe_scenario_contract_repairs, discover_scenario_dirs, write_json,
)
from tools.patch_tno_1962_bundle import sync_tno_water_summary_from_scenario
from tools.scenario_chunk_assets import _build_chunk_payloads_for_layer


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    manifest_path = ROOT / "data/manifest.json"
    manifest = read(manifest_path)
    for name in ("europe_topology.json", "europe_topology.na_v2.json"):
        path = ROOT / "data" / name
        topology = read(path)
        manifest["outputs"][name].update(
            size_bytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
            arc_count=len(topology["arcs"]), arc_point_count=sum(len(arc) for arc in topology["arcs"]),
        )
    write_json(manifest_path, manifest)
    scenario = ROOT / "data/scenarios/tno_1962"
    sync_tno_water_summary_from_scenario(scenario)
    chunks, layers = _build_chunk_payloads_for_layer(
        scenario_id="tno_1962", scenario_dir=scenario, layer_key="water",
        payload=read(scenario / "water_regions.geojson"),
    )
    detail = read(scenario / "detail_chunks.manifest.json")
    detail["chunks"] = [chunk for chunk in detail["chunks"] if chunk["layer"] != "water"] + chunks
    write_json(scenario / "detail_chunks.manifest.json", detail)
    context = read(scenario / "context_lod.manifest.json")
    context["layers"].update(layers)
    write_json(scenario / "context_lod.manifest.json", context)
    meta = read(scenario / "runtime_meta.json")
    meta["layer_chunk_counts"]["water"] = len(chunks)
    meta["total_chunk_count"] = len(detail["chunks"])
    write_json(scenario / "runtime_meta.json", meta)
    for directory in discover_scenario_dirs(ROOT / "data/scenarios", []):
        print(f"Refresh dependent startup assets: {directory.name}", flush=True)
        apply_safe_scenario_contract_repairs(directory, rebuild_chunk_assets=False)


if __name__ == "__main__":
    main()
