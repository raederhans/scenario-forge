#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from map_builder.contracts import sha256_path
from map_builder.json_source import read_json_source, resolve_json_source_path
from map_builder.io.writers import write_json_atomic
from map_builder.scenario_context import ensure_path_within_allowed_bases, resolve_repo_path
from tools.scenario_chunk_assets import build_and_write_scenario_chunk_assets

DEFAULT_RUNTIME_POLITICAL_URL = "data/europe_topology.runtime_political_v1.json"


def _read_json(path: Path) -> dict:
    return read_json_source(path)


def _resolve_scenario_manifest_url(scenario_dir: Path, raw_url: object, *, field_name: str) -> Path | None:
    url = str(raw_url or "").strip()
    if not url:
        return None
    path = resolve_repo_path(url, root=PROJECT_ROOT)
    return ensure_path_within_allowed_bases(
        path,
        allowed_bases=(scenario_dir,),
        label=f"manifest.{field_name}",
        root=PROJECT_ROOT,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Build scenario chunk manifests and chunk payloads.")
    parser.add_argument("--scenario-dir", required=True, help="Path to the target scenario directory.")
    parser.add_argument(
        "--default-startup-topology-url",
        default=DEFAULT_RUNTIME_POLITICAL_URL,
        help="Fallback startup topology URL when the manifest has no scenario-local startup topology.",
    )
    args = parser.parse_args()

    scenario_dir = Path(args.scenario_dir).resolve()
    ensure_path_within_allowed_bases(
        scenario_dir,
        allowed_bases=(PROJECT_ROOT / "data" / "scenarios",),
        label="scenario-dir",
        root=PROJECT_ROOT,
    )
    manifest_path = scenario_dir / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"manifest.json not found at {manifest_path}")

    manifest_payload = _read_json(manifest_path)
    layer_payloads = {}
    file_map = {
        "water": manifest_payload.get("water_regions_url"),
        "special": manifest_payload.get("special_regions_url"),
        "relief": manifest_payload.get("relief_overlays_url"),
        "cities": manifest_payload.get("city_overrides_url"),
    }
    for layer_key, raw_url in file_map.items():
        path = _resolve_scenario_manifest_url(scenario_dir, raw_url, field_name=f"{layer_key}_url")
        if path is not None and path.exists():
            layer_payloads[layer_key] = _read_json(path)

    runtime_topology_payload = None
    runtime_topology_url = str(manifest_payload.get("runtime_topology_url") or "").strip()
    if runtime_topology_url:
        runtime_topology_path = _resolve_scenario_manifest_url(
            scenario_dir,
            runtime_topology_url,
            field_name="runtime_topology_url",
        )
        runtime_topology_path = resolve_json_source_path(runtime_topology_path)
        runtime_topology_payload = _read_json(runtime_topology_path)
        runtime_topology_url = f"data/scenarios/{scenario_dir.name}/{runtime_topology_path.relative_to(scenario_dir).as_posix()}"
        manifest_payload["runtime_topology_url"] = runtime_topology_url
    startup_topology_payload = None
    startup_topology_url = str(
        manifest_payload.get("runtime_bootstrap_topology_url")
        or manifest_payload.get("startup_topology_url")
        or ""
    ).strip()
    if startup_topology_url:
        startup_topology_path = _resolve_scenario_manifest_url(
            scenario_dir,
            startup_topology_url,
            field_name="startup_topology_url",
        )
        if startup_topology_path.exists():
            startup_topology_payload = _read_json(startup_topology_path)

    build_and_write_scenario_chunk_assets(
        scenario_dir=scenario_dir,
        manifest_payload=manifest_payload,
        layer_payloads=layer_payloads,
        startup_topology_payload=startup_topology_payload,
        runtime_topology_payload=runtime_topology_payload,
        startup_topology_url=startup_topology_url,
        runtime_topology_url=runtime_topology_url,
        generated_at=str(manifest_payload.get("generated_at") or "").strip(),
        default_startup_topology_url=args.default_startup_topology_url,
    )
    detail_chunk_manifest_path = scenario_dir / "detail_chunks.manifest.json"
    if detail_chunk_manifest_path.exists():
        manifest_payload["source"] = {
            **(manifest_payload.get("source") if isinstance(manifest_payload.get("source"), dict) else {}),
            "detail_chunk_manifest_sha256": sha256_path(detail_chunk_manifest_path),
        }
    write_json_atomic(manifest_path, manifest_payload, ensure_ascii=False, indent=2, trailing_newline=True)
    print(f"[scenario-chunks] Wrote chunk assets for {scenario_dir.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
