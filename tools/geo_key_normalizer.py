import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path


def slugify(text: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", str(text).strip())
    cleaned = cleaned.strip("_")
    return cleaned.lower() or "unknown"


def choose_primary_name(properties: dict) -> str:
    candidates = [
        properties.get("name"),
        properties.get("name_en"),
        properties.get("NAME"),
        properties.get("name_long"),
    ]
    for value in candidates:
        if isinstance(value, str) and value.strip():
            return value.strip()
    raw_id = properties.get("id")
    if isinstance(raw_id, (str, int, float)) and str(raw_id).strip():
        return str(raw_id).strip()
    country_code = str(properties.get("cntr_code", "")).strip().upper()
    if country_code:
        return f"{country_code} Region"
    return "Unknown Region"


def collect_aliases(properties: dict) -> list[str]:
    aliases = set()
    for key, value in properties.items():
        if "name" not in str(key).lower():
            continue
        if isinstance(value, str) and value.strip():
            aliases.add(value.strip())
    aliases.discard("")
    return sorted(aliases)


def collect_disambiguated_aliases(properties: dict, primary_name: str) -> list[str]:
    aliases = set()
    country_code = str(properties.get("cntr_code", "")).strip().upper()
    admin1_group = str(properties.get("admin1_group", "")).strip()

    if primary_name and country_code:
        aliases.add(f"{primary_name} ({country_code})")
    if primary_name and admin1_group and admin1_group != primary_name:
        aliases.add(f"{primary_name} [{admin1_group}]")
    return sorted(aliases)


def stable_key_for_geometry(geometry: dict, primary_name: str) -> str:
    properties = geometry.get("properties") or {}
    raw_id = properties.get("id") or geometry.get("id")
    if isinstance(raw_id, (str, int, float)):
        stable_id = str(raw_id).strip()
        if stable_id:
            return f"id::{stable_id}"

    cntr_code = str(properties.get("cntr_code", "")).strip().upper()
    if cntr_code:
        return f"cntr::{cntr_code}::{slugify(primary_name)}"
    return f"name::{slugify(primary_name)}"


def load_political_geometries(topology_path: Path) -> list[dict]:
    with topology_path.open("r", encoding="utf-8") as file:
        data = json.load(file)

    if not isinstance(data, dict) or data.get("type") != "Topology":
        raise ValueError(f"Expected Topology JSON at {topology_path}")

    political = data.get("objects", {}).get("political")
    if not isinstance(political, dict):
        raise ValueError("Missing objects.political in topology data")

    geometries = political.get("geometries")
    if not isinstance(geometries, list):
        raise ValueError("objects.political.geometries must be a list")
    return geometries


def normalize_geokeys(topology_path: Path) -> dict:
    geometries = load_political_geometries(topology_path)

    entries = []
    alias_candidates: dict[str, set[str]] = {}
    used_stable_keys = set()

    for index, geometry in enumerate(geometries):
        properties = geometry.get("properties") or {}
        primary_name = choose_primary_name(properties)
        stable_key = stable_key_for_geometry(geometry, primary_name)

        if stable_key in used_stable_keys:
            stable_key = f"{stable_key}__{index}"
        used_stable_keys.add(stable_key)

        aliases = collect_aliases(properties)
        if primary_name not in aliases:
            aliases.append(primary_name)
        aliases.extend(collect_disambiguated_aliases(properties, primary_name))
        aliases = sorted(set(aliases))

        for alias in aliases:
            bucket = alias_candidates.setdefault(alias, set())
            bucket.add(stable_key)

        entries.append(
            {
                "stable_key": stable_key,
                "feature_id": geometry.get("id"),
                "country_code": properties.get("cntr_code"),
                "primary_name": primary_name,
                "aliases": aliases,
            }
        )

    entries.sort(key=lambda item: item["stable_key"])
    alias_to_stable = {
        alias: next(iter(stable_keys))
        for alias, stable_keys in sorted(alias_candidates.items())
        if len(stable_keys) == 1
    }
    ambiguous_aliases = [
        {
            "alias": alias,
            "stable_keys": sorted(stable_keys),
        }
        for alias, stable_keys in sorted(alias_candidates.items())
        if len(stable_keys) > 1
    ]

    return {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": str(topology_path),
        "entry_count": len(entries),
        "alias_count": len(alias_to_stable),
        "conflict_count": 0,
        "conflicts": [],
        "ambiguous_alias_count": len(ambiguous_aliases),
        "ambiguous_aliases_sample": ambiguous_aliases[:200],
        "entries": entries,
        "alias_to_stable_key": alias_to_stable,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate stable geo keys and alias mapping.")
    parser.add_argument("--topology", type=Path, help="Input topology path")
    parser.add_argument("--output", type=Path, help="Output alias mapping path")
    return parser.parse_args()


def resolve_default_topology(base_dir: Path) -> Path:
    candidates = [
        base_dir / "data" / "europe_topology.na_v2.json",
        base_dir / "data" / "europe_topology.na_v1.json",
        base_dir / "data" / "europe_topology.highres.json",
        base_dir / "data" / "europe_topology.json",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[-1]


def main() -> None:
    args = parse_args()
    base_dir = Path(__file__).resolve().parents[1]
    default_topology = resolve_default_topology(base_dir)
    topology_path = args.topology or default_topology
    output_path = args.output or (base_dir / "data" / "geo_aliases.json")

    payload = normalize_geokeys(topology_path)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)

    print(
        f"OK: geo aliases generated. entries={payload['entry_count']}, "
        f"aliases={payload['alias_count']}, conflicts={payload['conflict_count']}"
    )
    print(f"Saved geo aliases to: {output_path}")


if __name__ == "__main__":
    main()
