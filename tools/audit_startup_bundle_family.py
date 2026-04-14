#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools import build_startup_bundle

DEFAULT_REPORT_DIR = ROOT / ".runtime" / "reports" / "generated" / "scenarios"


def _read_json(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise TypeError(f"Expected JSON object at {path}")
    return payload


def _resolve_geo_locale_patch_paths(scenario_dir: Path) -> dict[str, Path]:
    shared_path = scenario_dir / "geo_locale_patch.json"
    return {
        "en": scenario_dir / "geo_locale_patch.en.json" if (scenario_dir / "geo_locale_patch.en.json").exists() else shared_path,
        "zh": scenario_dir / "geo_locale_patch.zh.json" if (scenario_dir / "geo_locale_patch.zh.json").exists() else shared_path,
    }


def audit_startup_bundle_family(
    *,
    scenario_dir: Path,
    topology_primary_source_path: Path | None = None,
    report_path: Path | None = None,
) -> dict:
    scenario_dir = scenario_dir.resolve()
    _read_json(scenario_dir / "manifest.json")
    startup_locales = _read_json(scenario_dir / "locales.startup.json")
    geo_aliases = _read_json(scenario_dir / "geo_aliases.startup.json")
    payload_by_language = {
        language: _read_json(scenario_dir / f"startup.bundle.{language}.json")
        for language in build_startup_bundle.SUPPORTED_LANGUAGES
    }
    output_paths_by_language = {
        language: scenario_dir / f"startup.bundle.{language}.json"
        for language in build_startup_bundle.SUPPORTED_LANGUAGES
    }
    gzip_paths_by_language = {
        language: scenario_dir / f"startup.bundle.{language}.json.gz"
        for language in build_startup_bundle.SUPPORTED_LANGUAGES
    }
    startup_locales_payload_by_language = {
        language: build_startup_bundle.build_single_language_locales_payload(startup_locales, language)
        for language in build_startup_bundle.SUPPORTED_LANGUAGES
    }
    geo_locale_patch_paths = _resolve_geo_locale_patch_paths(scenario_dir)
    resolved_topology_primary_source_path = (
        topology_primary_source_path.resolve()
        if topology_primary_source_path is not None
        else (ROOT / "data" / "europe_topology.json").resolve()
    )
    source_sha = str((next(iter(payload_by_language.values()), {}).get("source") or {}).get("base_topology_sha256") or "").strip()
    if not resolved_topology_primary_source_path.exists():
        resolved_topology_primary_source_path = None
    elif source_sha:
        candidate_sha = build_startup_bundle._sha256_path(resolved_topology_primary_source_path)
        if candidate_sha != source_sha:
            resolved_topology_primary_source_path = None
    resolved_report_path = (
        report_path.resolve()
        if report_path is not None
        else (DEFAULT_REPORT_DIR / f"{scenario_dir.name}_startup_bundle_audit.json").resolve()
    )
    return build_startup_bundle.build_startup_bundle_report(
        payload_by_language=payload_by_language,
        output_paths_by_language=output_paths_by_language,
        gzip_paths_by_language=gzip_paths_by_language,
        startup_locales_payload_by_language=startup_locales_payload_by_language,
        original_geo_aliases=geo_aliases,
        topology_primary_source_path=resolved_topology_primary_source_path,
        startup_locales_path=scenario_dir / "locales.startup.json",
        geo_aliases_path=scenario_dir / "geo_aliases.startup.json",
        geo_locale_patch_paths_by_language=geo_locale_patch_paths,
        report_path=resolved_report_path,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit startup bundle family boundaries for a scenario directory.")
    parser.add_argument("--scenario-dir", required=True)
    parser.add_argument("--topology-primary-source", default="")
    parser.add_argument("--report-path", default="")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = audit_startup_bundle_family(
        scenario_dir=Path(args.scenario_dir),
        topology_primary_source_path=Path(args.topology_primary_source) if str(args.topology_primary_source or "").strip() else None,
        report_path=Path(args.report_path) if str(args.report_path or "").strip() else None,
    )
    print(json.dumps({
        "scenario_id": report.get("scenario_id", ""),
        "report_path": str((Path(args.report_path) if str(args.report_path or "").strip() else (DEFAULT_REPORT_DIR / f"{Path(args.scenario_dir).resolve().name}_startup_bundle_audit.json")).resolve()),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
