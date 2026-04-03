from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.scenario_materialization_service import (
    materialize_existing_mutations,
)


def materialize_scenario_mutations(
    scenario_id: str,
    *,
    target: str,
    root: Path = ROOT,
) -> dict[str, object]:
    service_result = materialize_existing_mutations(
        str(scenario_id or "").strip(),
        target=str(target or "").strip().lower(),
        root=root,
    )
    results: dict[str, object] = {
        "scenarioId": service_result["scenarioId"],
        "target": service_result["target"],
    }
    context = service_result["context"]
    if "political" in service_result:
        materialized = service_result["political"]["materialized"]
        results["political"] = {
            "countriesPath": str(Path(context["countriesPath"]).relative_to(root)).replace("\\", "/"),
            "ownersPath": str(Path(context["ownersPath"]).relative_to(root)).replace("\\", "/"),
            "manualOverridesPath": str(Path(context["manualOverridesPath"]).relative_to(root)).replace("\\", "/"),
            "countryCount": len(materialized["countriesPayload"].get("countries", {})),
        }
    if "geoLocale" in service_result:
        results["geoLocale"] = service_result["geoLocale"]["materialized"]
    return results


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Materialize scenario mutations into scenario artifacts.",
        allow_abbrev=False,
    )
    parser.add_argument("--scenario-id", required=True)
    parser.add_argument("--target", choices=("political", "geo-locale", "all"), required=True)
    parser.add_argument("--root", default=str(ROOT))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    result = materialize_scenario_mutations(
        args.scenario_id,
        target=args.target,
        root=Path(args.root).resolve(),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
