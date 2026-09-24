"""Build a display-only global lake layer from the checked-in Natural Earth source.

Existing named inland waters remain authoritative: their stable IDs and repaired
geometries are copied from ``water_regions.geojson``. Remaining source lakes
are included with Natural Earth IDs and made non-interactive for map rendering.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile

import geopandas as gpd
from shapely import set_precision
from shapely.geometry import mapping

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from init_map_data import SEEDED_LAKE_REGION_SPECS
from map_builder.geo.water_geometry import compile_water_feature_collection
from map_builder.geo.water_region_authority import polygonal


SOURCE = ROOT / "data" / "ne_10m_lakes.zip"
EXISTING = ROOT / "data" / "water_regions.geojson"
OUTPUT = ROOT / "data" / "global_lakes.geojson"
SIMPLIFY_DEGREES = 0.005
COORDINATE_DIGITS = 5
EXCLUDED_NAMES = {"congo lake"}


def _clean_name(value: object) -> str:
    return re.sub(r"\s+", " ", _text(value).strip()).casefold()


def _text(value: object) -> str:
    if value is None:
        return ""
    try:
        if value != value:  # NaN guard
            return ""
    except (TypeError, ValueError):
        pass
    return str(value)


def _spec_source_names() -> set[str]:
    names: set[str] = set()
    for spec in SEEDED_LAKE_REGION_SPECS:
        if str(spec.get("source_layer", "lakes")).strip().lower() != "lakes":
            continue
        names.update(_clean_name(name) for name in spec.get("match_names", []) if _clean_name(name))
    return names


def _existing_inland_features() -> list[dict]:
    collection = json.loads(EXISTING.read_text(encoding="utf-8"))
    retained = []
    for feature in collection.get("features", []):
        props = feature.get("properties", {})
        if props.get("water_type") not in {"lake", "reservoir", "inland_sea"}:
            continue
        if props.get("id") == "congo_lake" or _clean_name(props.get("name")) in EXCLUDED_NAMES:
            continue
        feature["properties"].pop("scenario_id", None)
        retained.append(deepcopy(feature))
    return retained


def _source_lake_features() -> tuple[list[dict], int]:
    frame = gpd.read_file(SOURCE)
    names_to_skip = _spec_source_names()
    # The current canonical IDs are retained verbatim. Name matching is scoped
    # to the explicit seed specs; bounding boxes are intentionally not used.
    source_features = []
    skipped = 0
    for _, row in frame.iterrows():
        values = {_clean_name(row.get("name")), _clean_name(row.get("name_en"))}
        values.discard("")
        if values & names_to_skip or values & EXCLUDED_NAMES:
            skipped += 1
            continue
        geometry = polygonal(row.geometry)
        if geometry.is_empty:
            continue
        geometry = polygonal(geometry.simplify(SIMPLIFY_DEGREES, preserve_topology=True))
        geometry = polygonal(set_precision(geometry, 10 ** -COORDINATE_DIGITS, mode="valid_output"))
        if geometry.is_empty:
            continue
        ne_id = str(row.get("ne_id") or "").strip()
        if not ne_id:
            raise ValueError("Natural Earth lake feature is missing ne_id")
        feature_id = f"ne_lake_{ne_id}"
        properties = {
            "id": feature_id,
            "name": _text(row.get("name")).strip(),
            "name_en": _text(row.get("name_en")).strip(),
            "name_zh": _text(row.get("name_zh")).strip(),
            "water_type": "lake",
            "interactive": False,
            "render_as_base_geography": True,
            "source_standard": "natural_earth_lakes",
            "ne_id": ne_id,
        }
        for field in ("scalerank", "min_zoom"):
            value = row.get(field)
            if value is not None:
                try:
                    if value == value:  # NaN guard
                        properties[field] = int(value) if float(value).is_integer() else float(value)
                except (TypeError, ValueError):
                    pass
        source_features.append({
            "type": "Feature",
            "id": feature_id,
            "properties": properties,
            "geometry": mapping(geometry),
        })
    return source_features, skipped


def build_collection() -> tuple[dict, dict]:
    source_count = len(gpd.read_file(SOURCE))
    existing = _existing_inland_features()
    source, skipped = _source_lake_features()
    # Canonical inland geometry was already compiled. Keep it byte-for-byte in
    # coordinate space and compile only the new Natural Earth additions.
    source_collection = compile_water_feature_collection(
        {"type": "FeatureCollection", "features": source}
    )
    compiled = {"type": "FeatureCollection", "features": [*existing, *source_collection["features"]]}
    if source_collection.get("water_geometry_precision"):
        compiled["water_geometry_precision"] = source_collection["water_geometry_precision"]
    ids = [feature["properties"]["id"] for feature in compiled["features"]]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate global lake feature IDs")
    if any(feature["properties"]["id"] == "congo_lake" for feature in compiled["features"]):
        raise ValueError("Congo Lake is scenario-only and cannot enter global lakes")
    stats = {
        "source_candidate_count": source_count,
        "source_name_matches_deduplicated": skipped,
        "preserved_existing_inland_count": len(existing),
        "new_natural_earth_lake_count": len(source),
        "output_feature_count": len(compiled["features"]),
        "output_path": OUTPUT.relative_to(ROOT).as_posix(),
        "simplify_degrees": SIMPLIFY_DEGREES,
        "coordinate_digits": COORDINATE_DIGITS,
    }
    return compiled, stats


def main() -> None:
    collection, stats = build_collection()
    output_dir = ROOT / ".runtime" / "tmp"
    output_dir.mkdir(parents=True, exist_ok=True)
    # Keep generated files away from the repository root and atomically replace
    # only the owned output path.
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=output_dir,
                                     delete=False, suffix=".geojson") as handle:
        json.dump(collection, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
        temporary = Path(handle.name)
    temporary.replace(OUTPUT)
    # Keep the registered asset's integrity metadata reproducible on rebuild.
    digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path = ROOT / "data" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["outputs"]["global_lakes.geojson"].update({
        "size_bytes": OUTPUT.stat().st_size,
        "sha256": digest(OUTPUT),
        "feature_count": len(collection["features"]),
    })
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    ledger_path = ROOT / "data" / "source_ledger.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    for entry in ledger:
        if entry.get("source_id") == "global_lakes_natural_earth":
            entry["current_local_sha256"] = digest(OUTPUT)
            entry["immutable_ref"] = f"Source ZIP sha256:{digest(SOURCE)}; canonical water sha256:{digest(EXISTING)}"
        elif entry.get("source_id") == "natural_earth_lakes_10m":
            entry["current_local_sha256"] = digest(SOURCE)
            entry["immutable_ref"] = f"Source ZIP sha256:{digest(SOURCE)}"
    ledger_path.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
