#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools import build_startup_bootstrap_assets

DEFAULT_REPORT_DIR = ROOT / ".runtime" / "reports" / "generated" / "scenarios"


def _read_json(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise TypeError(f"Expected JSON object at {path}")
    return payload


def audit_startup_support_family(
    *,
    scenario_dir: Path,
    base_topology_path: Path | None = None,
    full_locales_path: Path | None = None,
    full_geo_aliases_path: Path | None = None,
    full_runtime_topology_path: Path | None = None,
    startup_support_whitelist_path: Path | None = None,
    report_path: Path | None = None,
) -> dict:
    scenario_dir = scenario_dir.resolve()
    scenario_manifest = _read_json(scenario_dir / "manifest.json")
    scenario_geo_patch = _read_json(scenario_dir / "geo_locale_patch.json")
    startup_locales = _read_json(scenario_dir / "locales.startup.json")
    startup_geo_aliases = _read_json(scenario_dir / "geo_aliases.startup.json")

    resolved_base_topology_path = (base_topology_path or (ROOT / "data" / "europe_topology.json")).resolve()
    resolved_full_locales_path = (full_locales_path or (ROOT / "data" / "locales.json")).resolve()
    resolved_full_geo_aliases_path = (full_geo_aliases_path or (ROOT / "data" / "geo_aliases.json")).resolve()
    resolved_full_runtime_topology_path = (full_runtime_topology_path or (scenario_dir / "runtime_topology.topo.json")).resolve()
    resolved_startup_support_whitelist_path = build_startup_bootstrap_assets.resolve_startup_support_whitelist_path(
        scenario_dir / "locales.startup.json",
        startup_support_whitelist_path.resolve() if startup_support_whitelist_path else None,
    )
    resolved_report_path = (
        report_path.resolve()
        if report_path is not None
        else (DEFAULT_REPORT_DIR / f"{scenario_dir.name}_startup_support_audit.json").resolve()
    )

    return build_startup_bootstrap_assets.build_startup_support_assets_report(
        scenario_id=build_startup_bootstrap_assets._normalize_key(
            scenario_manifest.get("scenario_id") or scenario_geo_patch.get("scenario_id")
        ),
        base_topology_path=resolved_base_topology_path,
        full_locales_path=resolved_full_locales_path,
        full_geo_aliases_path=resolved_full_geo_aliases_path,
        scenario_geo_patch_path=(scenario_dir / "geo_locale_patch.json").resolve(),
        startup_locales_output_path=(scenario_dir / "locales.startup.json").resolve(),
        startup_geo_aliases_output_path=(scenario_dir / "geo_aliases.startup.json").resolve(),
        base_topology=_read_json(resolved_base_topology_path),
        runtime_bootstrap_topology=_read_json(resolved_full_runtime_topology_path),
        scenario_geo_patch=scenario_geo_patch,
        full_locales=_read_json(resolved_full_locales_path),
        full_geo_aliases=_read_json(resolved_full_geo_aliases_path),
        startup_locales=startup_locales,
        startup_geo_aliases=startup_geo_aliases,
        startup_support_whitelist_path=resolved_startup_support_whitelist_path,
        startup_support_whitelist=build_startup_bootstrap_assets.load_startup_support_whitelist(
            resolved_startup_support_whitelist_path
        ),
        report_path=resolved_report_path,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit startup support files for a scenario directory.")
    parser.add_argument("--scenario-dir", required=True)
    parser.add_argument("--base-topology", default="")
    parser.add_argument("--full-locales", default="")
    parser.add_argument("--full-geo-aliases", default="")
    parser.add_argument("--full-runtime-topology", default="")
    parser.add_argument("--startup-support-whitelist", default="")
    parser.add_argument("--report-path", default="")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = audit_startup_support_family(
        scenario_dir=Path(args.scenario_dir),
        base_topology_path=Path(args.base_topology) if str(args.base_topology or "").strip() else None,
        full_locales_path=Path(args.full_locales) if str(args.full_locales or "").strip() else None,
        full_geo_aliases_path=Path(args.full_geo_aliases) if str(args.full_geo_aliases or "").strip() else None,
        full_runtime_topology_path=Path(args.full_runtime_topology) if str(args.full_runtime_topology or "").strip() else None,
        startup_support_whitelist_path=Path(args.startup_support_whitelist) if str(args.startup_support_whitelist or "").strip() else None,
        report_path=Path(args.report_path) if str(args.report_path or "").strip() else None,
    )
    print(json.dumps({
        "scenario_id": report.get("scenario_id", ""),
        "report_path": str((Path(args.report_path) if str(args.report_path or "").strip() else (DEFAULT_REPORT_DIR / f"{Path(args.scenario_dir).resolve().name}_startup_support_audit.json")).resolve()),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
