#!/usr/bin/env python3
"""Build the night-lights-only global urban mask from Natural Earth.

Download once, then rebuild offline with:
  python tools/build_world_urban_lights_asset.py --download
  python tools/build_world_urban_lights_asset.py

Requires the project's geopandas and shapely dependencies. The input ZIP stays
in .runtime; its exact digest is recorded in the generated asset. Coordinates
use clockwise exterior rings, matching the project's d3 spherical paths.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

import geopandas as gpd
from shapely import STRtree, normalize
from shapely.geometry import mapping, shape
from shapely.geometry.polygon import orient

ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = "https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_urban_areas.zip"
SOURCE_SHA256 = "2c593114e954ce1adb297ddee5465f05d9e81fa0a26deb13f8500d58a00d7051"
DEFAULT_SOURCE = ROOT / ".runtime/tmp/world-urban/ne_10m_urban_areas.zip"
DEFAULT_OUTPUT = ROOT / "data/world_urban_lights.geojson"
DEFAULT_CITIES = ROOT / "data/world_cities.geojson"


def topology_signature(geometry):
    parts = list(geometry.geoms) if geometry.geom_type == "MultiPolygon" else [geometry]
    return len(parts), tuple(len(part.interiors) for part in parts)


def compact_geometry(geometry, tolerance):
    simplified = geometry.simplify(tolerance, preserve_topology=True)
    # Explicitly retain components and holes, including tiny source holes.
    if topology_signature(simplified) != topology_signature(geometry):
        simplified = geometry
    parts = list(simplified.geoms) if simplified.geom_type == "MultiPolygon" else [simplified]
    coordinates = [mapping(orient(part, sign=-1.0))["coordinates"] for part in parts]
    raw = {"type": simplified.geom_type, "coordinates": coordinates if simplified.geom_type == "MultiPolygon" else coordinates[0]}

    def rounded(value, precision):
        if isinstance(value, (list, tuple)):
            return [rounded(item, precision) for item in value]
        return round(float(value), precision)

    for precision in (5, 6, 7):
        candidate = {"type": raw["type"], "coordinates": rounded(raw["coordinates"], precision)}
        polygon = shape(candidate)
        if polygon.is_valid and not polygon.is_empty and topology_signature(polygon) == topology_signature(geometry):
            return candidate
    return raw


def build_collection(rows, cities, *, tolerance=0.003, source_sha256="", cities_sha256=""):
    features = []
    for geometry, properties in rows:
        if geometry.geom_type not in ("Polygon", "MultiPolygon") or not geometry.is_valid:
            raise ValueError("Urban source must contain valid Polygon/MultiPolygon geometries")
        identity = "ne_urban_" + hashlib.sha256(normalize(geometry).wkb).hexdigest()[:16]
        compact = compact_geometry(geometry, tolerance)
        polygon = shape(compact)
        point = polygon.representative_point()
        features.append({"type": "Feature", "id": identity, "properties": {
            "id": identity,
            "scalerank": int(properties.get("scalerank", 9)),
            "area_sqkm": float(properties.get("area_sqkm", 0)),
            "anchor": [point.x, point.y],
            "city_ids": [], "population_sum": 0, "capital_score": 0, "anchors": [],
        }, "geometry": compact})
    features.sort(key=lambda feature: feature["id"])
    if len({feature["id"] for feature in features}) != len(features):
        raise ValueError("Urban source contains duplicate geometries/identities")
    polygons = [shape(feature["geometry"]) for feature in features]
    tree = STRtree(polygons)
    matches = [[] for _ in features]
    for city in cities:
        properties = city.get("properties", {})
        city_id = properties.get("id") or properties.get("city_id")
        if not city_id or city.get("geometry", {}).get("type") != "Point":
            continue
        point = shape(city["geometry"])
        candidates = tree.query(point, predicate="within")
        if len(candidates):
            # In overlapping source polygons, assign one smallest containing area.
            index = min(candidates, key=lambda candidate: (polygons[candidate].area, features[candidate]["id"]))
            matches[index].append((city_id, max(0, int(properties.get("population") or 0)),
                                   3 if properties.get("is_country_capital") else (1 if properties.get("is_admin_capital") else 0),
                                   [point.x, point.y]))
    for feature, cities_in_polygon in zip(features, matches):
        cities_in_polygon.sort(key=lambda city: (-city[1], city[0]))
        properties = feature["properties"]
        properties["city_ids"] = sorted(city[0] for city in cities_in_polygon)
        properties["population_sum"] = sum(city[1] for city in cities_in_polygon)
        properties["capital_score"] = max((city[2] for city in cities_in_polygon), default=0)
        properties["anchors"] = [city[3] for city in cities_in_polygon[:3]]
    return {"type": "FeatureCollection", "metadata": {
        "schema_version": 1, "source": "Natural Earth 1:10m urban areas", "source_url": SOURCE_URL,
        "source_sha256": source_sha256, "world_cities_sha256": cities_sha256,
        "license": "public domain", "simplification_tolerance_degrees": tolerance,
        "coordinate_precision": "5 decimals; 6/7 or original if topology requires",
        "ring_winding": "clockwise exterior for d3 spherical rendering",
        "city_match": "strict within output geometry; smallest polygon wins overlap",
        "limitations": "Generalized built-up footprint, not contemporary night-light observations or street geometry",
    }, "features": features}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--cities", type=Path, default=DEFAULT_CITIES)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--tolerance", type=float, default=0.003)
    parser.add_argument("--download", action="store_true", help="Download official source only when missing")
    args = parser.parse_args()
    if args.tolerance < 0 or args.tolerance > 0.02:
        parser.error("--tolerance must be between 0 and 0.02 degrees")
    if not args.source.exists() and args.download:
        args.source.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(SOURCE_URL, timeout=120) as response:
            payload = response.read()
        args.source.write_bytes(payload)
    if not args.source.is_file():
        parser.error("Source ZIP is missing; use --download once or --source PATH for offline input")
    source_sha256 = hashlib.sha256(args.source.read_bytes()).hexdigest()
    if source_sha256 != SOURCE_SHA256:
        parser.error("Source ZIP differs from the pinned Natural Earth snapshot; review the source before updating SOURCE_SHA256")
    frame = gpd.read_file(args.source)
    if frame.crs is None or frame.crs.to_epsg() != 4326:
        parser.error("Source must declare EPSG:4326")
    rows = [(row.geometry, row.to_dict()) for _, row in frame.iterrows()]
    cities_payload = args.cities.read_bytes()
    result = build_collection(rows, json.loads(cities_payload)["features"], tolerance=args.tolerance,
                              source_sha256=source_sha256,
                              cities_sha256=hashlib.sha256(cities_payload).hexdigest())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(result['features'])} polygons; {args.output.stat().st_size:,} bytes: {args.output}")


if __name__ == "__main__":
    main()
