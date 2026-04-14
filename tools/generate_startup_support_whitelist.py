#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.io.writers import write_json_atomic

DEFAULT_REPORT_DIR = ROOT / ".runtime" / "reports" / "generated" / "scenarios"


def _read_json(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise TypeError(f"Expected JSON object at {path}")
    return payload


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _serialize_path(path: Path | None) -> str:
    if path is None:
        return ""
    resolved = Path(path).resolve()
    try:
        return resolved.relative_to(ROOT).as_posix()
    except ValueError:
        return str(resolved)


def _iter_report_paths(paths: list[str], scenario_id: str) -> list[Path]:
    resolved: list[Path] = []
    for raw_path in paths:
        path = Path(raw_path).resolve()
        if path.is_dir():
            resolved.extend(sorted(path.glob(f"{scenario_id}_startup_support_key_usage*.json")))
        elif path.exists():
            resolved.append(path)
    deduped: list[Path] = []
    seen: set[Path] = set()
    for path in resolved:
        if path in seen:
            continue
        seen.add(path)
        deduped.append(path)
    return deduped


def generate_startup_support_whitelist(
    *,
    scenario_id: str,
    usage_report_paths: list[Path],
    startup_locales_path: Path,
    startup_geo_aliases_path: Path,
    full_locales_path: Path | None = None,
    full_geo_aliases_path: Path | None = None,
    baseline_whitelist_path: Path | None = None,
    support_audit_report_path: Path | None = None,
    output_path: Path | None = None,
) -> dict:
    if not usage_report_paths:
        raise ValueError("At least one startup support key-usage report is required.")

    startup_locales_payload = _read_json(startup_locales_path)
    startup_geo_aliases_payload = _read_json(startup_geo_aliases_path)
    full_locales_payload = _read_json(full_locales_path) if full_locales_path else startup_locales_payload
    full_geo_aliases_payload = _read_json(full_geo_aliases_path) if full_geo_aliases_path else startup_geo_aliases_payload
    baseline_whitelist_payload = _read_json(baseline_whitelist_path) if baseline_whitelist_path else {}
    startup_locale_geo = startup_locales_payload.get("geo", {}) if isinstance(startup_locales_payload, dict) else {}
    startup_alias_map = startup_geo_aliases_payload.get("alias_to_stable_key", {}) if isinstance(startup_geo_aliases_payload, dict) else {}
    full_locale_geo = full_locales_payload.get("geo", {}) if isinstance(full_locales_payload, dict) else {}
    full_alias_map = full_geo_aliases_payload.get("alias_to_stable_key", {}) if isinstance(full_geo_aliases_payload, dict) else {}
    baseline_locale_keys = {
        _normalize_text(value)
        for value in baseline_whitelist_payload.get("locale_keys", [])
        if _normalize_text(value)
    }
    baseline_alias_keys = {
        _normalize_text(value)
        for value in baseline_whitelist_payload.get("alias_keys", [])
        if _normalize_text(value)
    }
    if not isinstance(startup_locale_geo, dict):
        startup_locale_geo = {}
    if not isinstance(startup_alias_map, dict):
        startup_alias_map = {}
    if not isinstance(full_locale_geo, dict):
        full_locale_geo = {}
    if not isinstance(full_alias_map, dict):
        full_alias_map = {}

    aggregate_query_keys: set[str] = set()
    aggregate_direct_locale_keys: set[str] = set()
    aggregate_alias_keys: set[str] = set()
    aggregate_alias_target_keys: set[str] = set()
    aggregate_miss_keys: set[str] = set()
    languages: set[str] = set()
    sources: set[str] = set()

    for report_path in usage_report_paths:
        payload = _read_json(report_path)
        if _normalize_text(payload.get("scenario_id")) != scenario_id:
            raise ValueError(f"Usage report {report_path} does not match scenario_id={scenario_id}.")
        usage = payload.get("usage", {}) if isinstance(payload, dict) else {}
        if not isinstance(usage, dict):
            usage = {}
        languages.add(_normalize_text(usage.get("language")) or "unknown")
        sources.add(_normalize_text(payload.get("source")) or "unknown")
        aggregate_query_keys.update(_normalize_text(value) for value in usage.get("queryKeys", []) if _normalize_text(value))
        aggregate_direct_locale_keys.update(_normalize_text(value) for value in usage.get("directLocaleKeys", []) if _normalize_text(value))
        aggregate_alias_keys.update(_normalize_text(value) for value in usage.get("aliasKeys", []) if _normalize_text(value))
        aggregate_alias_target_keys.update(_normalize_text(value) for value in usage.get("aliasTargetKeys", []) if _normalize_text(value))
        aggregate_miss_keys.update(_normalize_text(value) for value in usage.get("missKeys", []) if _normalize_text(value))

    recovered_locale_keys = (
        aggregate_direct_locale_keys
        | aggregate_alias_target_keys
    ) & set(full_locale_geo.keys())
    recovered_alias_keys = aggregate_alias_keys & set(full_alias_map.keys())
    candidate_locale_keys = sorted(baseline_locale_keys | recovered_locale_keys)
    candidate_alias_keys = sorted(baseline_alias_keys | recovered_alias_keys)
    unresolved_miss_keys = sorted(
        aggregate_miss_keys
        - aggregate_direct_locale_keys
        - aggregate_alias_keys
        - aggregate_alias_target_keys
    )
    support_audit = _read_json(support_audit_report_path) if support_audit_report_path and support_audit_report_path.exists() else None

    result = {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": "",
        "inputs": {
            "usage_reports": [_serialize_path(path) for path in usage_report_paths],
            "startup_locales_path": _serialize_path(startup_locales_path),
            "startup_geo_aliases_path": _serialize_path(startup_geo_aliases_path),
            "full_locales_path": _serialize_path(full_locales_path),
            "full_geo_aliases_path": _serialize_path(full_geo_aliases_path),
            "baseline_whitelist_path": _serialize_path(baseline_whitelist_path),
            "support_audit_report_path": _serialize_path(support_audit_report_path),
        },
        "aggregate_usage": {
            "languages": sorted(language for language in languages if language),
            "sources": sorted(source for source in sources if source),
            "query_key_count": len(aggregate_query_keys),
            "direct_locale_key_count": len(aggregate_direct_locale_keys),
            "alias_key_count": len(aggregate_alias_keys),
            "alias_target_key_count": len(aggregate_alias_target_keys),
            "miss_key_count": len(aggregate_miss_keys),
        },
        "candidates": {
            "locale_keys": candidate_locale_keys,
            "alias_keys": candidate_alias_keys,
        },
        "coverage": {
            "full_locale_geo_total": len(full_locale_geo),
            "full_alias_total": len(full_alias_map),
            "startup_locale_geo_total": len(startup_locale_geo),
            "startup_alias_total": len(startup_alias_map),
            "baseline_locale_key_count": len(baseline_locale_keys),
            "baseline_alias_key_count": len(baseline_alias_keys),
            "candidate_locale_key_count": len(candidate_locale_keys),
            "candidate_alias_key_count": len(candidate_alias_keys),
            "recovered_locale_key_count": len(recovered_locale_keys),
            "recovered_alias_key_count": len(recovered_alias_keys),
            "added_locale_key_count": len(set(candidate_locale_keys) - baseline_locale_keys),
            "added_alias_key_count": len(set(candidate_alias_keys) - baseline_alias_keys),
            "locale_candidate_ratio_vs_full": (len(candidate_locale_keys) / len(full_locale_geo)) if full_locale_geo else 0.0,
            "alias_candidate_ratio_vs_full": (len(candidate_alias_keys) / len(full_alias_map)) if full_alias_map else 0.0,
            "locale_candidate_ratio_vs_startup": (len(candidate_locale_keys) / len(startup_locale_geo)) if startup_locale_geo else 0.0,
            "alias_candidate_ratio_vs_startup": (len(candidate_alias_keys) / len(startup_alias_map)) if startup_alias_map else 0.0,
        },
        "unresolved": {
            "miss_keys": unresolved_miss_keys,
        },
        "support_audit_snapshot": {
            "required_geo_key_sources": support_audit.get("required_geo_key_sources", {}) if isinstance(support_audit, dict) else {},
            "startup_locales": support_audit.get("startup_locales", {}) if isinstance(support_audit, dict) else {},
            "startup_geo_aliases": support_audit.get("startup_geo_aliases", {}) if isinstance(support_audit, dict) else {},
        },
        "recommendation": {
            "ready_for_direct_prune": False,
            "reason": "Need multiple startup samples before pruning support files; current whitelist is candidate-only.",
        },
    }

    if output_path is not None:
        write_json_atomic(output_path, result, ensure_ascii=False, indent=2, trailing_newline=True)
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate candidate startup support whitelist from runtime key-usage reports.")
    parser.add_argument("--scenario-id", required=True)
    parser.add_argument("--usage-report", action="append", default=[])
    parser.add_argument("--usage-report-dir", action="append", default=[])
    parser.add_argument("--startup-locales", required=True)
    parser.add_argument("--startup-geo-aliases", required=True)
    parser.add_argument("--full-locales", default="")
    parser.add_argument("--full-geo-aliases", default="")
    parser.add_argument("--baseline-whitelist", default="")
    parser.add_argument("--support-audit-report", default="")
    parser.add_argument("--output-path", default="")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    usage_report_paths = _iter_report_paths(args.usage_report + args.usage_report_dir, args.scenario_id)
    result = generate_startup_support_whitelist(
        scenario_id=args.scenario_id,
        usage_report_paths=usage_report_paths,
        startup_locales_path=Path(args.startup_locales).resolve(),
        startup_geo_aliases_path=Path(args.startup_geo_aliases).resolve(),
        full_locales_path=Path(args.full_locales).resolve() if _normalize_text(args.full_locales) else None,
        full_geo_aliases_path=Path(args.full_geo_aliases).resolve() if _normalize_text(args.full_geo_aliases) else None,
        baseline_whitelist_path=Path(args.baseline_whitelist).resolve() if _normalize_text(args.baseline_whitelist) else None,
        support_audit_report_path=Path(args.support_audit_report).resolve() if _normalize_text(args.support_audit_report) else None,
        output_path=Path(args.output_path).resolve() if _normalize_text(args.output_path) else None,
    )
    print(json.dumps({
        "scenario_id": result.get("scenario_id", ""),
        "usage_report_count": len(result.get("inputs", {}).get("usage_reports", [])),
        "candidate_locale_key_count": result.get("coverage", {}).get("candidate_locale_key_count", 0),
        "candidate_alias_key_count": result.get("coverage", {}).get("candidate_alias_key_count", 0),
        "output_path": str(Path(args.output_path).resolve()) if _normalize_text(args.output_path) else "",
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
