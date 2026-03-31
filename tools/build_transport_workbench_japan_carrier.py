from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from shapely import affinity
from shapely.geometry import GeometryCollection, LineString, MultiLineString, MultiPolygon, Point, Polygon, box, shape
from shapely.ops import transform, unary_union


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "chunks" / "political.detail.country.jp.json"
OUTPUT_DIR = ROOT / "data" / "transport_layers" / "japan_corridor"
CARRIER_PATH = OUTPUT_DIR / "carrier.json"
PROVENANCE_PATH = OUTPUT_DIR / "provenance.json"

VIEWBOX_WIDTH = 1600
VIEWBOX_HEIGHT = 900
FRAME_PADDING = 40
OVERFILL_SCALE = 1.08
COMPOSITION_SHIFT_X = 0
COMPOSITION_SHIFT_Y = 42

CORRIDOR_BOUNDS = {
    "lon_min": 129.2,
    "lon_max": 141.4,
    "lat_min": 32.2,
    "lat_max": 37.3,
}

PROTECTED_DETAIL_REGIONS = {
    "tokyo_bay": {"lon_min": 139.35, "lon_max": 140.35, "lat_min": 34.95, "lat_max": 35.85},
    "ise_bay": {"lon_min": 136.45, "lon_max": 137.45, "lat_min": 34.25, "lat_max": 35.15},
    "osaka_bay": {"lon_min": 134.75, "lon_max": 135.7, "lat_min": 34.05, "lat_max": 34.95},
    "seto_inland_sea": {"lon_min": 131.35, "lon_max": 134.95, "lat_min": 33.55, "lat_max": 34.85},
}

PROJECTION_CENTER = {"lon": 136.5, "lat": 35.0}
ROTATION_DEGREES_CLOCKWISE = 8.0
SIMPLIFY_TOLERANCE = 0.045
MIN_RENDER_ISLAND_AREA = 12.0
MIN_SCALE = 1.0
MAX_SCALE = 3.4

NAMED_WATER_ANCHORS = {
    "tokyo_bay": {"lon": 139.92, "lat": 35.45},
    "ise_bay": {"lon": 136.92, "lat": 34.73},
    "osaka_bay": {"lon": 135.22, "lat": 34.52},
    "seto_inland_sea": {"lon": 133.78, "lat": 34.28},
}


@dataclass
class ProjectionConfig:
    lon0: float
    lat0: float
    cos_lat0: float
    rotation_degrees_clockwise: float


def load_japan_union() -> Polygon | MultiPolygon:
    with SOURCE_PATH.open("r", encoding="utf-8") as source_file:
        payload = json.load(source_file)
    geometries = [shape(feature["geometry"]) for feature in payload.get("features", [])]
    unioned = unary_union(geometries)
    if unioned.is_empty:
        raise RuntimeError("Japan source geometry is empty.")
    return unioned


def build_projection_config() -> ProjectionConfig:
    lat0 = PROJECTION_CENTER["lat"]
    return ProjectionConfig(
        lon0=PROJECTION_CENTER["lon"],
        lat0=lat0,
        cos_lat0=math.cos(math.radians(lat0)),
        rotation_degrees_clockwise=ROTATION_DEGREES_CLOCKWISE,
    )


def local_project(geom, config: ProjectionConfig):
    def projector(x, y, z=None):
        local_x = (x - config.lon0) * config.cos_lat0
        local_y = y - config.lat0
        return (local_x, local_y)

    projected = transform(projector, geom)
    return affinity.rotate(projected, -config.rotation_degrees_clockwise, origin=(0.0, 0.0))


def normalize_to_viewbox(geom, *, width: float, height: float, padding: float):
    min_x, min_y, max_x, max_y = geom.bounds
    geom_width = max(max_x - min_x, 1e-9)
    geom_height = max(max_y - min_y, 1e-9)
    scale = min((width - padding * 2) / geom_width, (height - padding * 2) / geom_height)

    def normalizer(x, y, z=None):
        normalized_x = (x - min_x) * scale + padding
        normalized_y = (max_y - y) * scale + padding
        return (normalized_x, normalized_y)

    normalized = transform(normalizer, geom)
    meta = {
        "scale": scale,
        "sourceBounds": {
            "minX": min_x,
            "minY": min_y,
            "maxX": max_x,
            "maxY": max_y,
        },
    }
    return normalized, meta


def normalize_point(point: Point, *, normalization_meta: dict, padding: float) -> Point:
    scale = normalization_meta["scale"]
    bounds = normalization_meta["sourceBounds"]
    normalized_x = (point.x - bounds["minX"]) * scale + padding
    normalized_y = (bounds["maxY"] - point.y) * scale + padding
    return Point(normalized_x, normalized_y)


def normalize_with_meta(geom, *, normalization_meta: dict, padding: float):
    scale = normalization_meta["scale"]
    bounds = normalization_meta["sourceBounds"]

    def normalizer(x, y, z=None):
        normalized_x = (x - bounds["minX"]) * scale + padding
        normalized_y = (bounds["maxY"] - y) * scale + padding
        return (normalized_x, normalized_y)

    return transform(normalizer, geom)


def apply_composition_transform(geom):
    if geom.is_empty:
        return geom
    composed = affinity.scale(geom, xfact=OVERFILL_SCALE, yfact=OVERFILL_SCALE, origin=(VIEWBOX_WIDTH / 2, VIEWBOX_HEIGHT / 2))
    return affinity.translate(composed, xoff=COMPOSITION_SHIFT_X, yoff=COMPOSITION_SHIFT_Y)


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
    raise TypeError(f"Unsupported polygonal geometry: {type(geom)!r}")


def collect_protected_render_regions(config: ProjectionConfig, normalization_meta: dict):
    regions = []
    for bounds in PROTECTED_DETAIL_REGIONS.values():
        region = box(bounds["lon_min"], bounds["lat_min"], bounds["lon_max"], bounds["lat_max"])
        region = local_project(region, config)
        region = normalize_with_meta(region, normalization_meta=normalization_meta, padding=FRAME_PADDING)
        regions.append(apply_composition_transform(region))
    return unary_union(regions)


def prune_micro_islands(geom, *, min_area: float, protected_regions):
    kept_polygons = []
    for polygon in iter_polygons(geom):
        if polygon.area >= min_area or polygon.intersects(protected_regions):
            kept_polygons.append(polygon)
    if not kept_polygons:
        return GeometryCollection()
    if len(kept_polygons) == 1:
        return kept_polygons[0]
    return MultiPolygon(kept_polygons)


def format_num(value: float) -> str:
    if abs(value) < 1e-9:
        value = 0.0
    text = f"{value:.3f}".rstrip("0").rstrip(".")
    return text or "0"


def ring_to_path(ring: Iterable[tuple[float, float]]) -> str:
    coords = list(ring)
    if not coords:
        return ""
    if coords[0] == coords[-1]:
        coords = coords[:-1]
    if len(coords) < 3:
        return ""
    segments = [f"M {format_num(coords[0][0])} {format_num(coords[0][1])}"]
    segments.extend(f"L {format_num(x)} {format_num(y)}" for x, y in coords[1:])
    segments.append("Z")
    return " ".join(segments)


def geometry_to_path_data(geom) -> str:
    if geom.is_empty:
        return ""
    if isinstance(geom, Polygon):
        parts = [ring_to_path(geom.exterior.coords)]
        parts.extend(ring_to_path(interior.coords) for interior in geom.interiors)
        return " ".join(part for part in parts if part)
    if isinstance(geom, MultiPolygon):
        return " ".join(geometry_to_path_data(part) for part in geom.geoms if not part.is_empty)
    if isinstance(geom, LineString):
        coords = list(geom.coords)
        if len(coords) < 2:
            return ""
        segments = [f"M {format_num(coords[0][0])} {format_num(coords[0][1])}"]
        segments.extend(f"L {format_num(x)} {format_num(y)}" for x, y in coords[1:])
        return " ".join(segments)
    if isinstance(geom, MultiLineString):
        return " ".join(geometry_to_path_data(part) for part in geom.geoms if not part.is_empty)
    if isinstance(geom, GeometryCollection):
        return " ".join(geometry_to_path_data(part) for part in geom.geoms if not part.is_empty)
    raise TypeError(f"Unsupported geometry for path conversion: {type(geom)!r}")


def extract_anchor_points(config: ProjectionConfig, normalization_meta: dict) -> dict[str, dict[str, float]]:
    anchors: dict[str, dict[str, float]] = {}
    for anchor_id, anchor in NAMED_WATER_ANCHORS.items():
        projected = local_project(Point(anchor["lon"], anchor["lat"]), config)
        point = normalize_point(projected, normalization_meta=normalization_meta, padding=FRAME_PADDING)
        point = apply_composition_transform(point)
        anchors[anchor_id] = {
            "x": round(point.x, 3),
            "y": round(point.y, 3),
            "lon": anchor["lon"],
            "lat": anchor["lat"],
        }
    return anchors


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    japan_union = load_japan_union()
    crop_box = box(
        CORRIDOR_BOUNDS["lon_min"],
        CORRIDOR_BOUNDS["lat_min"],
        CORRIDOR_BOUNDS["lon_max"],
        CORRIDOR_BOUNDS["lat_max"],
    )
    corridor_land = japan_union.intersection(crop_box)
    if corridor_land.is_empty:
        raise RuntimeError("Corridor clip removed the entire Japan geometry.")

    projection = build_projection_config()
    projected_land = local_project(corridor_land, projection)
    projected_land = projected_land.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)
    normalized_land, normalization_meta = normalize_to_viewbox(
        projected_land,
        width=VIEWBOX_WIDTH,
        height=VIEWBOX_HEIGHT,
        padding=FRAME_PADDING,
    )

    frame = box(0, 0, VIEWBOX_WIDTH, VIEWBOX_HEIGHT)
    composed_land = apply_composition_transform(normalized_land)
    protected_regions = collect_protected_render_regions(projection, normalization_meta)
    composed_land = prune_micro_islands(
        composed_land,
        min_area=MIN_RENDER_ISLAND_AREA,
        protected_regions=protected_regions,
    )
    land_bounds = composed_land.bounds
    coastline = composed_land.boundary
    sea_mask = frame.difference(composed_land)
    named_waters = extract_anchor_points(projection, normalization_meta)

    carrier_payload = {
        "version": "japan_corridor_v1",
        "viewBox": {
            "width": VIEWBOX_WIDTH,
            "height": VIEWBOX_HEIGHT,
        },
        "defaultCamera": {
            "scale": 1,
            "translateX": 0,
            "translateY": 0,
            "minScale": MIN_SCALE,
            "maxScale": MAX_SCALE,
        },
        "bounds": {
            "frame": {"minX": 0, "minY": 0, "maxX": VIEWBOX_WIDTH, "maxY": VIEWBOX_HEIGHT},
            "land": {
                "minX": round(land_bounds[0], 3),
                "minY": round(land_bounds[1], 3),
                "maxX": round(land_bounds[2], 3),
                "maxY": round(land_bounds[3], 3),
            },
        },
        "paths": {
            "land": geometry_to_path_data(composed_land),
            "landMask": geometry_to_path_data(composed_land),
            "coastline": geometry_to_path_data(coastline),
            "seaMask": geometry_to_path_data(sea_mask),
        },
        "namedWaterAnchors": named_waters,
        "clipPolicy": {
            "land": "strict",
            "sea": "strict",
            "crossMask": "split-geometry-required",
        },
    }

    provenance_payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": str(SOURCE_PATH.relative_to(ROOT)).replace("\\", "/"),
        "corridorBounds": CORRIDOR_BOUNDS,
        "projection": {
            "type": "local_equirectangular",
            "center": PROJECTION_CENTER,
            "rotationDegreesClockwise": ROTATION_DEGREES_CLOCKWISE,
        },
        "simplifyTolerance": SIMPLIFY_TOLERANCE,
        "minRenderIslandArea": MIN_RENDER_ISLAND_AREA,
        "viewBox": {"width": VIEWBOX_WIDTH, "height": VIEWBOX_HEIGHT, "padding": FRAME_PADDING},
        "composition": {
            "overfillScale": OVERFILL_SCALE,
            "shiftX": COMPOSITION_SHIFT_X,
            "shiftY": COMPOSITION_SHIFT_Y,
        },
        "protectedDetailRegions": PROTECTED_DETAIL_REGIONS,
        "namedWaterAnchors": NAMED_WATER_ANCHORS,
    }

    CARRIER_PATH.write_text(json.dumps(carrier_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    PROVENANCE_PATH.write_text(json.dumps(provenance_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {CARRIER_PATH.relative_to(ROOT)}")
    print(f"Wrote {PROVENANCE_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
