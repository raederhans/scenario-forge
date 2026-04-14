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


def _read_json(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise TypeError(f"Expected JSON object at {path}")
    return payload


def _json_size_bytes(payload: object) -> int:
    return len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def materialize_startup_support_candidate(
    *,
    whitelist_path: Path,
    startup_locales_path: Path,
    startup_geo_aliases_path: Path,
    output_locales_path: Path,
    output_aliases_path: Path,
    summary_path: Path | None = None,
) -> dict:
    whitelist = _read_json(whitelist_path)
    startup_locales = _read_json(startup_locales_path)
    startup_geo_aliases = _read_json(startup_geo_aliases_path)

    locale_key_whitelist = set(whitelist.get("candidates", {}).get("locale_keys", []))
    alias_key_whitelist = set(whitelist.get("candidates", {}).get("alias_keys", []))

    startup_locale_geo = startup_locales.get("geo", {}) if isinstance(startup_locales, dict) else {}
    startup_alias_map = startup_geo_aliases.get("alias_to_stable_key", {}) if isinstance(startup_geo_aliases, dict) else {}
    if not isinstance(startup_locale_geo, dict):
      startup_locale_geo = {}
    if not isinstance(startup_alias_map, dict):
      startup_alias_map = {}

    candidate_locales = {
        "ui": startup_locales.get("ui", {}) if isinstance(startup_locales, dict) else {},
        "geo": {
            key: value
            for key, value in startup_locale_geo.items()
            if key in locale_key_whitelist
        },
    }
    candidate_aliases = {
        "alias_to_stable_key": {
            alias: stable_key
            for alias, stable_key in startup_alias_map.items()
            if alias in alias_key_whitelist
        }
    }

    write_json_atomic(output_locales_path, candidate_locales, ensure_ascii=False, indent=2, trailing_newline=True)
    write_json_atomic(output_aliases_path, candidate_aliases, ensure_ascii=False, indent=2, trailing_newline=True)

    summary = {
        "version": 1,
        "whitelist_path": str(whitelist_path),
        "startup_locales_path": str(startup_locales_path),
        "startup_geo_aliases_path": str(startup_geo_aliases_path),
        "output_locales_path": str(output_locales_path),
        "output_aliases_path": str(output_aliases_path),
        "locale_keys_before": len(startup_locale_geo),
        "locale_keys_after": len(candidate_locales["geo"]),
        "alias_keys_before": len(startup_alias_map),
        "alias_keys_after": len(candidate_aliases["alias_to_stable_key"]),
        "locale_bytes_before": _json_size_bytes(startup_locales),
        "locale_bytes_after": _json_size_bytes(candidate_locales),
        "alias_bytes_before": _json_size_bytes(startup_geo_aliases),
        "alias_bytes_after": _json_size_bytes(candidate_aliases),
    }
    if summary_path is not None:
        write_json_atomic(summary_path, summary, ensure_ascii=False, indent=2, trailing_newline=True)
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Materialize startup support candidate files from a whitelist candidate.")
    parser.add_argument("--whitelist", required=True)
    parser.add_argument("--startup-locales", required=True)
    parser.add_argument("--startup-geo-aliases", required=True)
    parser.add_argument("--output-locales", required=True)
    parser.add_argument("--output-aliases", required=True)
    parser.add_argument("--summary-path", default="")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = materialize_startup_support_candidate(
        whitelist_path=Path(args.whitelist).resolve(),
        startup_locales_path=Path(args.startup_locales).resolve(),
        startup_geo_aliases_path=Path(args.startup_geo_aliases).resolve(),
        output_locales_path=Path(args.output_locales).resolve(),
        output_aliases_path=Path(args.output_aliases).resolve(),
        summary_path=Path(args.summary_path).resolve() if str(args.summary_path or "").strip() else None,
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
