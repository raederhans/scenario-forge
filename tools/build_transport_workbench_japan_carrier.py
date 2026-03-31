from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import geopandas as gpd
except ImportError as exc:
    raise SystemExit("geopandas is required. Install with: uv pip install geopandas") from exc

try:
    from pyproj import Transformer
except ImportError as exc:
    raise SystemExit("pyproj is required. Install with: uv pip install pyproj") from exc

from shapely.geometry import GeometryCollection, LineString, MultiLineString, MultiPolygon, Polygon, box, mapping
from shapely.ops import linemerge, transform, unary_union


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT / "data" / "ne_10m_admin_1_states_provinces.shp"
OUTPUT_DIR = ROOT / "data" / "transport_layers" / "japan_corridor"
CARRIER_PATH = OUTPUT_DIR / "carrier.json"
PROVENANCE_PATH = OUTPUT_DIR / "provenance.json"

VIEWBOX_WIDTH = 1600
VIEWBOX_HEIGHT = 900

PROJECTION = {
    "type": "geoConicConformal",
    "center": [136.5, 35.0],
    "parallels": [33.0, 37.0],
    "precision": 0.2,
}

DEFAULT_CAMERA = {
    "scale": 1.0,
    "translateX": 0.0,
    "translateY": 0.0,
    "minScale": 1.0,
    "maxScale": 3.0,
}

LOD_SWITCH = {
    "detailOn": 1.4,
    "overviewOn": 1.25,
}

FRAME_SPECS = {
    "main": {
        "type": "main",
        "label": "Japan four islands",
        "extent": {"x": 18, "y": 18, "width": 1564, "height": 864},
        "include_codes": "all_japan_visible",
        "clipBounds": {"lonMin": 129.0, "latMin": 30.75, "lonMax": 146.6, "latMax": 45.9},
    },
}

EXCLUDED_CODES = {"JP-47"}

LOD_SPECS = {
    "overview": {"toleranceMeters": 1400.0, "minAreaSqMeters": 6_000_000.0},
    "detail": {"toleranceMeters": 220.0, "minAreaSqMeters": 700_000.0},
}

NAMED_WATER_ANCHORS = {
    "tokyo_bay": {"frameId": "main", "lon": 139.92, "lat": 35.45},
    "ise_bay": {"frameId": "main", "lon": 136.92, "lat": 34.73},
    "osaka_bay": {"frameId": "main", "lon": 135.22, "lat": 34.52},
    "seto_inland_sea": {"frameId": "main", "lon": 133.78, "lat": 34.28},
}

LCC_PROJ4 = (
    f"+proj=lcc +lat_1={PROJECTION['parallels'][0]} +lat_2={PROJECTION['parallels'][1]} "
    f"+lat_0={PROJECTION['center'][1]} +lon_0={PROJECTION['center'][0]} "
    "+datum=WGS84 +units=m +no_defs"
)
FORWARD_TRANSFORMER = Transformer.from_crs("EPSG:4326", LCC_PROJ4, always_xy=True)
INVERSE_TRANSFORMER = Transformer.from_crs(LCC_PROJ4, "EPSG:4326", always_xy=True)


def round_nested(value: Any, digits: int = 6) -> Any:
    if isinstance(value, float):
        return round(value, digits)
    if isinstance(value, list):
        return [round_nested(item, digits) for item in value]
    if isinstance(value, tuple):
        return [round_nested(item, digits) for item in value]
    if isinstance(value, dict):
        return {key: round_nested(item, digits) for key, item in value.items()}
    return value


def geometry_to_geojson(geom) -> dict[str, Any]:
    return round_nested(mapping(geom), 6)


def project_geometry(geom):
    return transform(FORWARD_TRANSFORMER.transform, geom)


def unproject_geometry(geom):
    return transform(INVERSE_TRANSFORMER.transform, geom)


def iter_polygons(geom):
    if geom.is_empty:
        return
    if isinstance(geom, Polygon):
        yield geom
        return
    if isinstance(geom, MultiPolygon):
        for polygon in geom.geoms:
            if not polygon.is_empty:
                yield polygon
        return
    if isinstance(geom, GeometryCollection):
        for child in geom.geoms:
            yield from iter_polygons(child)
        return
    raise TypeError(f"Unsupported polygon geometry: {type(geom)!r}")


def iter_lines(geom):
    if geom.is_empty:
        return
    if isinstance(geom, LineString):
        yield geom
        return
    if isinstance(geom, MultiLineString):
        for line in geom.geoms:
            if not line.is_empty:
                yield line
        return
    if isinstance(geom, GeometryCollection):
        for child in geom.geoms:
            yield from iter_lines(child)
        return
    raise TypeError(f"Unsupported line geometry: {type(geom)!r}")


def collect_polygon(parts) -> Polygon | MultiPolygon | GeometryCollection:
    if not parts:
        return GeometryCollection()
    if len(parts) == 1:
        return parts[0]
    return MultiPolygon(parts)


def collect_lines(parts) -> LineString | MultiLineString | GeometryCollection:
    if not parts:
        return GeometryCollection()
    if len(parts) == 1:
        return parts[0]
    return MultiLineString(parts)


def prune_micro_polygons(geom, *, min_area: float):
    parts = [polygon for polygon in iter_polygons(geom) if polygon.area >= min_area]
    return collect_polygon(parts)


def simplify_polygon_geometry(geom, *, tolerance_meters: float, min_area_sq_meters: float):
    projected = project_geometry(geom)
    simplified = projected.simplify(tolerance_meters, preserve_topology=True)
    simplified = prune_micro_polygons(simplified, min_area=min_area_sq_meters)
    return unproject_geometry(simplified)


def build_internal_border_lines(prefecture_geometries, country_union, *, tolerance_meters: float):
    projected_boundaries = unary_union([project_geometry(geom).boundary for geom in prefecture_geometries])
    projected_coastline = project_geometry(country_union).boundary.buffer(max(tolerance_meters * 0.6, 50.0))
    internal = projected_boundaries.difference(projected_coastline)
    if internal.is_empty:
        return GeometryCollection()
    if isinstance(internal, GeometryCollection):
        line_parts = [line for line in iter_lines(internal)]
        internal = unary_union(line_parts) if line_parts else GeometryCollection()
    merged = linemerge(internal)
    simplified = merged.simplify(max(tolerance_meters * 0.55, 70.0), preserve_topology=True)
    return unproject_geometry(simplified)


def load_prefectures() -> gpd.GeoDataFrame:
    if not SOURCE_PATH.exists():
        raise FileNotFoundError(f"Natural Earth admin1 source not found: {SOURCE_PATH}")
    gdf = gpd.read_file(SOURCE_PATH)
    japan = gdf[gdf["adm0_a3"].astype(str) == "JPN"].copy()
    if japan.empty:
        raise RuntimeError("No Japan prefectures found in Natural Earth admin1 source.")
    japan["iso_3166_2"] = japan["iso_3166_2"].astype(str).str.strip()
    japan = japan[~japan["iso_3166_2"].isin(EXCLUDED_CODES)].copy()
    if japan.empty:
        raise RuntimeError("Japan prefecture source became empty after exclusions.")
    japan = japan.to_crs("EPSG:4326")
    return japan


def select_frame_prefectures(prefectures: gpd.GeoDataFrame, frame_id: str) -> gpd.GeoDataFrame:
    spec = FRAME_SPECS[frame_id]
    include_codes = spec["include_codes"]
    if include_codes == "all_japan_visible":
        return prefectures.copy()
    return prefectures[prefectures["iso_3166_2"].isin(include_codes)].copy()


def build_frame_payload(frame_id: str, prefectures: gpd.GeoDataFrame) -> dict[str, Any]:
    selected = select_frame_prefectures(prefectures, frame_id)
    if selected.empty:
        raise RuntimeError(f"No prefectures selected for frame '{frame_id}'.")

    clip_spec = FRAME_SPECS[frame_id].get("clipBounds")
    if clip_spec:
        clip_box = box(clip_spec["lonMin"], clip_spec["latMin"], clip_spec["lonMax"], clip_spec["latMax"])
        selected = selected.copy()
        selected["geometry"] = selected.geometry.intersection(clip_box)
        selected = selected[~selected.geometry.is_empty].copy()

    frame_union = unary_union(selected.geometry.tolist())
    if frame_union.is_empty:
        raise RuntimeError(f"Frame '{frame_id}' union geometry is empty.")

    lod_payload = {}
    for lod_name, lod_spec in LOD_SPECS.items():
        land_geom = simplify_polygon_geometry(
            frame_union,
            tolerance_meters=lod_spec["toleranceMeters"],
            min_area_sq_meters=lod_spec["minAreaSqMeters"],
        )
        prefecture_lines = build_internal_border_lines(
            selected.geometry.tolist(),
            frame_union,
            tolerance_meters=lod_spec["toleranceMeters"],
        )
        lod_payload[lod_name] = {
            "land": geometry_to_geojson(land_geom),
            "prefectureLines": geometry_to_geojson(prefecture_lines),
        }

    return {
        "type": FRAME_SPECS[frame_id]["type"],
        "label": FRAME_SPECS[frame_id]["label"],
        "extent": FRAME_SPECS[frame_id]["extent"],
        "prefectureCodes": selected["iso_3166_2"].astype(str).tolist(),
        "fitGeometry": geometry_to_geojson(frame_union),
        "routeMask": geometry_to_geojson(frame_union),
        "lod": lod_payload,
    }


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    prefectures = load_prefectures()
    frames = {frame_id: build_frame_payload(frame_id, prefectures) for frame_id in FRAME_SPECS}

    carrier_payload = {
        "version": "japan_carrier_v3",
        "source": {
            "kind": "natural_earth_admin1",
            "path": str(SOURCE_PATH.relative_to(ROOT)).replace("\\", "/"),
        },
        "viewBox": {"width": VIEWBOX_WIDTH, "height": VIEWBOX_HEIGHT},
        "defaultCamera": DEFAULT_CAMERA,
        "projection": {
            **PROJECTION,
            "lodSwitch": LOD_SWITCH,
        },
        "frames": frames,
        "namedWaterAnchors": NAMED_WATER_ANCHORS,
        "clipPolicy": {
            "land": "strict",
            "sea": "strict",
            "crossMask": "caller-must-provide-frame-for-lines-and-polygons",
        },
    }

    provenance_payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": str(SOURCE_PATH.relative_to(ROOT)).replace("\\", "/"),
        "sourceKind": "Natural Earth 10m admin1",
        "excludedCodes": sorted(EXCLUDED_CODES),
        "projection": {
            "proj4": LCC_PROJ4,
            **PROJECTION,
        },
        "viewBox": {"width": VIEWBOX_WIDTH, "height": VIEWBOX_HEIGHT},
        "defaultCamera": DEFAULT_CAMERA,
        "lod": LOD_SPECS,
        "frames": {
            frame_id: {
                "type": payload["type"],
                "extent": payload["extent"],
                "prefectureCodes": payload["prefectureCodes"],
            }
            for frame_id, payload in frames.items()
        },
        "namedWaterAnchors": NAMED_WATER_ANCHORS,
    }

    CARRIER_PATH.write_text(json.dumps(carrier_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    PROVENANCE_PATH.write_text(json.dumps(provenance_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {CARRIER_PATH.relative_to(ROOT)}")
    print(f"Wrote {PROVENANCE_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
