"""Validate Russian city coverage across topology, hierarchy, and locales."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import geopandas as gpd
from shapely.geometry import Point
from topojson.utils import serialize_as_geodataframe, serialize_as_geojson

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from map_builder.processors.ru_city_overrides import CITY_SPECS, RU_CITY_GROUP_BY_ID


def _load_json(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Missing file: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _topology_political_to_gdf(topology_path: Path) -> gpd.GeoDataFrame:
    topo_dict = _load_json(topology_path)
    feature_collection = serialize_as_geojson(topo_dict, objectname="political")
    if not isinstance(feature_collection, dict) or not feature_collection.get("features"):
        return gpd.GeoDataFrame(columns=["id", "geometry"], geometry="geometry", crs="EPSG:4326")
    gdf = serialize_as_geodataframe(feature_collection)
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326", allow_override=True)
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")
    return gdf


def _validate_topology(gdf: gpd.GeoDataFrame) -> list[str]:
    errors: list[str] = []
    if "id" not in gdf.columns:
        return ["Topology political layer has no 'id' column."]

    for spec in CITY_SPECS:
        hits = gdf[gdf["id"].astype(str) == spec.stable_id].copy()
        if len(hits) != 1:
            errors.append(f"{spec.stable_id}: expected exactly 1 geometry, found {len(hits)}")
            continue

        point = Point(spec.lon, spec.lat)
        geom = hits.iloc[0].geometry
        if geom is None or geom.is_empty:
            errors.append(f"{spec.stable_id}: geometry is empty")
            continue
        if not geom.covers(point):
            errors.append(
                f"{spec.stable_id}: geometry does not cover anchor point ({spec.lon}, {spec.lat})"
            )
    return errors


def _validate_hierarchy(hierarchy_path: Path) -> list[str]:
    payload = _load_json(hierarchy_path)
    groups = payload.get("groups", {})
    if not isinstance(groups, dict):
        return ["Hierarchy payload missing groups object."]

    errors: list[str] = []
    for city_id, group_id in RU_CITY_GROUP_BY_ID.items():
        children = groups.get(group_id)
        if not isinstance(children, list) or not children:
            errors.append(f"{group_id}: missing or empty group")
            continue
        if city_id not in {str(item) for item in children}:
            errors.append(f"{group_id}: does not contain {city_id}")
    return errors


def _validate_locales(locales_path: Path) -> list[str]:
    payload = _load_json(locales_path)
    geo = payload.get("geo", {})
    if not isinstance(geo, dict):
        return ["Locales payload missing geo object."]

    english_values = {
        str((value or {}).get("en", "")).strip()
        for value in geo.values()
        if isinstance(value, dict)
    }
    errors: list[str] = []
    for spec in CITY_SPECS:
        if spec.canonical_name not in english_values:
            errors.append(f"locales.geo missing canonical EN entry: {spec.canonical_name}")
    return errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate RU city detail coverage.")
    parser.add_argument(
        "--topology",
        type=Path,
        default=Path("data") / "europe_topology.highres.json",
        help="Topology to validate.",
    )
    parser.add_argument(
        "--hierarchy",
        type=Path,
        default=Path("data") / "hierarchy.json",
        help="Hierarchy file to validate.",
    )
    parser.add_argument(
        "--locales",
        type=Path,
        default=Path("data") / "locales.json",
        help="Locales file to validate.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    print(f"[validate] topology={args.topology}")
    political = _topology_political_to_gdf(args.topology)
    print(f"[validate] political features={len(political)}")

    errors = []
    errors.extend(_validate_topology(political))
    errors.extend(_validate_hierarchy(args.hierarchy))
    errors.extend(_validate_locales(args.locales))

    if errors:
        print("[validate] FAILED")
        for err in errors:
            print(f"  - {err}")
        raise SystemExit(1)

    print("[validate] OK: RU city coverage is complete.")


if __name__ == "__main__":
    main()
