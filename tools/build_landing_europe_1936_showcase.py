from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from xml.sax.saxutils import escape as xml_escape

from shapely import normalize, set_precision
from shapely.errors import GEOSException
from shapely.geometry import GeometryCollection, box, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union
from shapely.validation import make_valid
from topojson.utils import serialize_as_geojson


REPO_ROOT = Path(__file__).resolve().parents[1]
LANDING_ASSETS = REPO_ROOT / "landing" / "assets"
HOI4_MANIFEST = REPO_ROOT / "data" / "scenarios" / "hoi4_1936" / "manifest.json"
HOI4_1939_MANIFEST = REPO_ROOT / "data" / "scenarios" / "hoi4_1939" / "manifest.json"
TNO_1962_MANIFEST = REPO_ROOT / "data" / "scenarios" / "tno_1962" / "manifest.json"
BLANK_BASE_MANIFEST = REPO_ROOT / "data" / "scenarios" / "blank_base" / "manifest.json"
EUROPE_BLANK_TOPOLOGY = REPO_ROOT / "data" / "europe_topology.runtime_political_v1.json"
EUROPE_BLANK_COASTLINE = REPO_ROOT / "data" / "europe_land_bg.geojson"
EUROPE_URBAN_AREAS = REPO_ROOT / "data" / "europe_urban.geojson"
EUROPE_RIVERS = REPO_ROOT / "data" / "europe_rivers.geojson"
WORLD_CITIES = REPO_ROOT / "data" / "world_cities.geojson"
RAIL_CATALOG = REPO_ROOT / "data" / "transport_layers" / "global_rail" / "catalog.json"

SHOWCASE_SVG = LANDING_ASSETS / "europe-1936-showcase.svg"
SHOWCASE_METADATA = LANDING_ASSETS / "europe-1936-showcase.json"
HERO_SCENARIO_OUTPUTS = {
    "blank": {
        "svg": LANDING_ASSETS / "hero-blank.svg",
        "metadata": LANDING_ASSETS / "hero-blank.json",
    },
    "hoi4-1936": {
        "svg": LANDING_ASSETS / "hero-hoi4-1936.svg",
        "metadata": LANDING_ASSETS / "hero-hoi4-1936.json",
    },
    "hoi4-1939": {
        "svg": LANDING_ASSETS / "hero-hoi4-1939.svg",
        "metadata": LANDING_ASSETS / "hero-hoi4-1939.json",
    },
    "tno-1962": {
        "svg": LANDING_ASSETS / "hero-tno-1962.svg",
        "metadata": LANDING_ASSETS / "hero-tno-1962.json",
    },
}
EUROPE_BBOX = (-12.5, 34.0, 41.5, 72.5)
HERO_BBOX = (-10.0, 34.0, 39.0, 65.0)
SHOWCASE_BBOX = (-14.0, 29.0, 44.0, 72.5)
SHOWCASE_DETAIL_BBOX = EUROPE_BBOX
SHOWCASE_CANVAS_WIDTH = 980
SHOWCASE_CANVAS_HEIGHT = 620
HERO_CANVAS_WIDTH = 980
HERO_CANVAS_HEIGHT = 680
HERO_CAPITAL_LIMIT = 8
TNO_1962_HERO_CAPITAL_TAGS = ("ENG", "FRA", "GER", "ITA", "IBR", "RKU", "SOV", "WRS", "BRG")
TNO_1962_HERO_CAPITAL_LABELS = {
    "BRG": "Nanzig",
}
TNO_1962_HERO_CAPITAL_POINTS = {
    # Nanzig is the TNO-localized Nancy feature (FR_ARR_54003), not Brussels.
    "BRG": (6.18496, 48.68439),
}
HERO_TERRITORY_PATH_LIMIT_PER_TAG = 48
HERO_BLANK_LAND_PATH_LIMIT = 8600
HERO_BLANK_COASTLINE_PATH_LIMIT = 1000
HERO_BASE_UNDERLAY_PATH_LIMIT = 360
HERO_BASE_UNDERLAY_COASTLINE_LIMIT = 360
SHOWCASE_CANVAS_PADDING = 36
HERO_CANVAS_PADDING = 18
PROJECTION_CENTER_LON = 10.0
PROJECTION_CENTER_LAT = 52.0
HERO_PROJECTION_DECIMAL_PLACES = 12
HERO_PROJECTED_PIXEL_DECIMAL_PLACES = 9
HERO_GEOMETRY_PRECISION_GRID = 1e-9
RAIL_LINE_LIMIT = 220
RAIL_MIN_LINES_PER_SHARD = 55
RAIL_MIN_PROJECTED_PX = 8.0
RAIL_DEDUPE_PIXEL_GRID = 2.0
URBAN_AREA_LIMIT = 96
URBAN_AREA_SIMPLIFY = 0.045
RIVER_LINE_LIMIT = 82
RIVER_LINE_SIMPLIFY = 0.025
RIVER_MIN_PROJECTED_PX = 16.0
NIGHT_LIGHT_LIMIT = 72
NIGHT_LIGHT_BELT_LIMIT = 54
NIGHT_LIGHT_BELT_MIN_DISTANCE_PX = 14.0
NIGHT_LIGHT_BELT_MAX_DISTANCE_PX = 74.0
BLANK_LAND_SIMPLIFY = 0.08
BLANK_INTERNAL_STROKE_WIDTH = 0.25
BLANK_COASTLINE_STROKE_WIDTH = 0.5
HERO_MEDITERRANEAN_ISLAND_BBOXES = (
    (8.3, 41.2, 9.8, 43.2),  # Corsica
    (8.0, 38.7, 9.9, 41.4),  # Sardinia
    (11.8, 36.4, 15.7, 38.4),  # Sicily
    (1.0, 38.4, 4.6, 40.3),  # Balearic Islands
    (32.0, 34.4, 34.9, 35.9),  # Cyprus
)
SHOWCASE_FOCUS_TAGS = {"GER", "POL", "CZE", "ROM", "SOV", "YUG", "ITA", "FRA", "ENG"}
SHOWCASE_COUNTRY_LABEL_TAGS = {"ENG", "FRA", "GER", "ITA", "POL", "ROM", "SOV", "YUG"}
SHOWCASE_CITY_TIER_LIMITS = (8, 16, 26, 34)
SHOWCASE_CITY_TIER_MIN_DISTANCE_PX = (44.0, 36.0, 30.0, 24.0)
TRANSREGIONAL_EUROPE_SHOWCASE_TAGS = {"TUR"}
SHOWCASE_BACKGROUND_TAGS = {
    "ALG",
    "EGY",
    "IRQ",
    "JOR",
    "LBA",
    "LEB",
    "MOR",
    "PAL",
    "SAU",
    "SYR",
    "TUN",
}
SHOWCASE_LAYERS = (
    {"id": "political", "label": "1936 political ownership"},
    {"id": "rail", "label": "Europe rail network"},
    {"id": "cities", "label": "City labels and capital anchors"},
    {"id": "day-night", "label": "day-night cycle"},
)
TAG_PATTERN = re.compile(r"^[A-Z0-9_]{2,12}$")


@dataclass(frozen=True)
class HeroScenario:
    mode: str
    scenario_id: str
    title: str
    manifest_path: Path
    palette_class: str
    capital_defaults_path: Path | None = None
    hero_capital_tags: tuple[str, ...] = ()
    hero_capital_labels: dict[str, str] | None = None
    hero_capital_points: dict[str, tuple[float, float]] | None = None
    blank: bool = False


HERO_SCENARIOS = (
    HeroScenario(
        mode="blank",
        scenario_id="blank_base",
        title="Blank Europe canvas",
        manifest_path=BLANK_BASE_MANIFEST,
        palette_class="blank",
        blank=True,
    ),
    HeroScenario(
        mode="hoi4-1936",
        scenario_id="hoi4_1936",
        title="HOI4 1936 Europe",
        manifest_path=HOI4_MANIFEST,
        palette_class="hoi4-1936",
    ),
    HeroScenario(
        mode="hoi4-1939",
        scenario_id="hoi4_1939",
        title="HOI4 1939 Europe",
        manifest_path=HOI4_1939_MANIFEST,
        palette_class="hoi4-1939",
    ),
    HeroScenario(
        mode="tno-1962",
        scenario_id="tno_1962",
        title="TNO 1962 Europe and Atlantropa",
        manifest_path=TNO_1962_MANIFEST,
        palette_class="tno-1962",
        capital_defaults_path=REPO_ROOT / "data" / "scenarios" / "tno_1962" / "capital_defaults.partial.json",
        hero_capital_tags=TNO_1962_HERO_CAPITAL_TAGS,
        hero_capital_labels=TNO_1962_HERO_CAPITAL_LABELS,
        hero_capital_points=TNO_1962_HERO_CAPITAL_POINTS,
    ),
)


@dataclass(frozen=True)
class Canvas:
    width: int
    height: int
    bbox: tuple[float, float, float, float]
    projected_bounds: tuple[float, float, float, float]
    scale: float
    offset_x: float
    offset_y: float

    @classmethod
    def create(cls, width: int, height: int, bbox: tuple[float, float, float, float], padding: int = SHOWCASE_CANVAS_PADDING) -> "Canvas":
        min_x, min_y, max_x, max_y = (
            canonical_projection_value(value) for value in projection_bounds_for_bbox(bbox)
        )
        projected_width = max_x - min_x
        projected_height = max_y - min_y
        usable_width = width - padding * 2
        usable_height = height - padding * 2
        scale = canonical_projection_value(min(usable_width / projected_width, usable_height / projected_height))
        fitted_width = projected_width * scale
        fitted_height = projected_height * scale
        return cls(
            width=width,
            height=height,
            bbox=bbox,
            projected_bounds=(min_x, min_y, max_x, max_y),
            scale=scale,
            offset_x=canonical_projection_value((width - fitted_width) / 2.0),
            offset_y=canonical_projection_value((height - fitted_height) / 2.0),
        )

    def project(self, lon: float, lat: float) -> tuple[float, float]:
        min_x, _min_y, _max_x, max_y = self.projected_bounds
        raw_x, raw_y = project_laea(lon, lat)
        x = self.offset_x + (raw_x - min_x) * self.scale
        y = self.offset_y + (max_y - raw_y) * self.scale
        return canonical_projected_pixel_value(x), canonical_projected_pixel_value(y)


def canonical_projection_value(value: float) -> float:
    return round(float(value), HERO_PROJECTION_DECIMAL_PLACES)


def canonical_projected_pixel_value(value: float) -> float:
    return round(float(value), HERO_PROJECTED_PIXEL_DECIMAL_PLACES)


def project_laea(lon: float, lat: float) -> tuple[float, float]:
    lon0 = math.radians(PROJECTION_CENTER_LON)
    lat0 = math.radians(PROJECTION_CENTER_LAT)
    lon_rad = math.radians(lon)
    lat_rad = math.radians(lat)
    denominator = 1 + math.sin(lat0) * math.sin(lat_rad) + math.cos(lat0) * math.cos(lat_rad) * math.cos(lon_rad - lon0)
    k = math.sqrt(2 / max(denominator, 1e-9))
    x = k * math.cos(lat_rad) * math.sin(lon_rad - lon0)
    y = k * (math.cos(lat0) * math.sin(lat_rad) - math.sin(lat0) * math.cos(lat_rad) * math.cos(lon_rad - lon0))
    return x, y


def projection_bounds_for_bbox(bbox: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    min_lon, min_lat, max_lon, max_lat = bbox
    points: list[tuple[float, float]] = []
    steps = 32
    for index in range(steps + 1):
        ratio = index / steps
        lon = min_lon + (max_lon - min_lon) * ratio
        lat = min_lat + (max_lat - min_lat) * ratio
        points.append(project_laea(lon, min_lat))
        points.append(project_laea(lon, max_lat))
        points.append(project_laea(min_lon, lat))
        points.append(project_laea(max_lon, lat))
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return (min(xs), min(ys), max(xs), max(ys))


def read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return payload


def write_text_lf(path: Path, text: str) -> None:
    path.write_bytes(text.replace("\r\n", "\n").encode("utf-8"))


def repo_path(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def repo_relative_path(relative_path: str) -> Path:
    if not relative_path or Path(relative_path).is_absolute():
        raise ValueError(f"Expected repo-relative path, got {relative_path!r}")
    return REPO_ROOT / relative_path


def fmt(value: float) -> str:
    return f"{value:.1f}".rstrip("0").rstrip(".")


def clamp_hex(color: str | None, default: str = "#9fb6a7") -> str:
    if not isinstance(color, str) or len(color) != 7 or not color.startswith("#"):
        return default
    return color


def validate_tag(tag: str) -> str:
    if not TAG_PATTERN.fullmatch(tag):
        raise ValueError(f"Unexpected country tag for showcase SVG: {tag!r}")
    return tag


def topology_features(path: Path, object_name: str) -> list[dict]:
    payload = read_json(path)
    collection = serialize_as_geojson(payload, objectname=object_name)
    features = collection.get("features") if isinstance(collection, dict) else None
    if not isinstance(features, list):
        return []
    return [feature for feature in features if isinstance(feature, dict)]


def geojson_features(path: Path) -> list[dict]:
    payload = read_json(path)
    features = payload.get("features")
    if not isinstance(features, list):
        return []
    return [feature for feature in features if isinstance(feature, dict)]


def scenario_paths(manifest_path: Path = HOI4_MANIFEST, capital_defaults_path: Path | None = None) -> dict[str, Path]:
    manifest = read_json(manifest_path)
    paths = {
        "manifest": manifest_path,
        "runtime_topology": repo_relative_path(manifest["runtime_topology_url"]),
        "owners": repo_relative_path(manifest["owners_url"]),
        "countries": repo_relative_path(manifest["countries_url"]),
    }
    capital_hints_url = manifest.get("capital_hints_url")
    if isinstance(capital_hints_url, str) and capital_hints_url:
        paths["capital_hints"] = repo_relative_path(capital_hints_url)
    city_overrides_url = manifest.get("city_overrides_url")
    if isinstance(city_overrides_url, str) and city_overrides_url:
        paths["city_overrides"] = repo_relative_path(city_overrides_url)
    if capital_defaults_path is not None:
        paths["capital_defaults"] = capital_defaults_path
    atlantropa_topology_url = manifest.get("scenario_atlantropa_topology_url")
    if isinstance(atlantropa_topology_url, str) and atlantropa_topology_url:
        paths["atlantropa_topology"] = repo_relative_path(atlantropa_topology_url)
    atlantropa_metadata_url = manifest.get("scenario_atlantropa_metadata_url")
    if isinstance(atlantropa_metadata_url, str) and atlantropa_metadata_url:
        paths["atlantropa_metadata"] = repo_relative_path(atlantropa_metadata_url)
    return paths


def rail_paths() -> list[Path]:
    catalog = read_json(RAIL_CATALOG)
    paths: list[Path] = []
    for entry in catalog.get("entries", []):
        if entry.get("region_id") != "europe":
            continue
        manifest = read_json(repo_relative_path(entry["manifest_path"]))
        rail_path = manifest.get("paths", {}).get("full", {}).get("railways")
        if isinstance(rail_path, str) and rail_path:
            paths.append(repo_relative_path(rail_path))
    return paths


def valid_geometry(geometry: BaseGeometry) -> BaseGeometry:
    if geometry.is_valid:
        return geometry
    try:
        return make_valid(geometry)
    except GEOSException:
        try:
            repaired = geometry.buffer(0)
        except GEOSException:
            return GeometryCollection()
        return repaired if repaired.is_valid else GeometryCollection()


def canonicalize_hero_geometry(geometry: BaseGeometry) -> BaseGeometry:
    repaired = valid_geometry(geometry)
    if repaired.is_empty:
        return repaired
    snapped = set_precision(repaired, grid_size=HERO_GEOMETRY_PRECISION_GRID)
    return normalize(valid_geometry(snapped))


def renderable_geometry(geometry: BaseGeometry) -> BaseGeometry:
    try:
        return valid_geometry(geometry)
    except GEOSException:
        try:
            return geometry.buffer(0)
        except GEOSException:
            return GeometryCollection()


def europe_country_tags(countries: dict) -> set[str]:
    tags = {
        tag
        for tag, country in countries.items()
        if isinstance(country, dict) and country.get("continent_id") == "continent_europe"
    }
    return tags | TRANSREGIONAL_EUROPE_SHOWCASE_TAGS


def polygon_path(geometry: BaseGeometry, canvas: Canvas, include_interiors: bool = False) -> list[str]:
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        rings = [ring_path(geometry.exterior.coords, canvas)]
        if include_interiors:
            rings.extend(ring_path(interior.coords, canvas) for interior in geometry.interiors)
        path = " ".join(ring for ring in rings if ring)
        return [path] if path else []
    if geometry.geom_type == "MultiPolygon":
        paths: list[str] = []
        for polygon in sorted(geometry.geoms, key=lambda item: item.area, reverse=True):
            paths.extend(polygon_path(polygon, canvas, include_interiors=include_interiors))
        return [path for path in paths if path]
    if geometry.geom_type == "GeometryCollection":
        paths: list[str] = []
        for part in sorted(polygon_parts(geometry), key=lambda item: item.area, reverse=True):
            paths.extend(polygon_path(part, canvas, include_interiors=include_interiors))
        return [path for path in paths if path]
    return []


def polygon_parts(geometry: BaseGeometry) -> list[BaseGeometry]:
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    if geometry.geom_type == "MultiPolygon":
        return sorted(geometry.geoms, key=lambda item: item.area, reverse=True)
    if geometry.geom_type == "GeometryCollection":
        parts: list[BaseGeometry] = []
        for part in geometry.geoms:
            parts.extend(polygon_parts(part))
        return parts
    return []


def polygon_exterior_paths(geometry: BaseGeometry, canvas: Canvas) -> list[str]:
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        path = ring_path(geometry.exterior.coords, canvas)
        return [path] if path else []
    if geometry.geom_type == "MultiPolygon":
        paths: list[str] = []
        for polygon in sorted(geometry.geoms, key=lambda item: item.area, reverse=True):
            paths.extend(polygon_exterior_paths(polygon, canvas))
        return [path for path in paths if path]
    if geometry.geom_type == "GeometryCollection":
        paths: list[str] = []
        for part in geometry.geoms:
            paths.extend(polygon_exterior_paths(part, canvas))
        return [path for path in paths if path]
    return []


def bounds_intersect(first: tuple[float, float, float, float], second: tuple[float, float, float, float]) -> bool:
    first_min_x, first_min_y, first_max_x, first_max_y = first
    second_min_x, second_min_y, second_max_x, second_max_y = second
    return not (
        first_max_x < second_min_x
        or first_min_x > second_max_x
        or first_max_y < second_min_y
        or first_min_y > second_max_y
    )


def intersects_mediterranean_island_bbox(geometry: BaseGeometry) -> bool:
    point = geometry.representative_point()
    return any(box(*island_bbox).covers(point) for island_bbox in HERO_MEDITERRANEAN_ISLAND_BBOXES)


def ring_path(points: Iterable[tuple[float, float]], canvas: Canvas) -> str:
    projected = [canvas.project(float(lon), float(lat)) for lon, lat, *_ in points]
    if len(projected) < 3:
        return ""
    commands = [f"M{fmt(projected[0][0])} {fmt(projected[0][1])}"]
    commands.extend(f"L{fmt(x)} {fmt(y)}" for x, y in projected[1:])
    commands.append("Z")
    return " ".join(commands)


def line_path(geometry: BaseGeometry, canvas: Canvas) -> list[tuple[str, float, str]]:
    if geometry.is_empty:
        return []
    if geometry.geom_type == "LineString":
        line = project_line(geometry.coords, canvas)
        return [line] if line else []
    if geometry.geom_type == "MultiLineString":
        paths: list[tuple[str, float, str]] = []
        for line in geometry.geoms:
            paths.extend(line_path(line, canvas))
        return paths
    if geometry.geom_type == "GeometryCollection":
        paths: list[tuple[str, float, str]] = []
        for part in geometry.geoms:
            paths.extend(line_path(part, canvas))
        return paths
    return []


def project_line(points: Iterable[tuple[float, float]], canvas: Canvas) -> tuple[str, float, str] | None:
    projected = [canvas.project(float(lon), float(lat)) for lon, lat, *_ in points]
    if len(projected) < 2:
        return None
    commands = [f"M{fmt(projected[0][0])} {fmt(projected[0][1])}"]
    commands.extend(f"L{fmt(x)} {fmt(y)}" for x, y in projected[1:])
    length_px = sum(math.hypot(x2 - x1, y2 - y1) for (x1, y1), (x2, y2) in zip(projected, projected[1:]))
    key_points = tuple((round(x / RAIL_DEDUPE_PIXEL_GRID), round(y / RAIL_DEDUPE_PIXEL_GRID)) for x, y in projected)
    forward_key = "|".join(f"{x}:{y}" for x, y in key_points)
    reverse_key = "|".join(f"{x}:{y}" for x, y in reversed(key_points))
    return " ".join(commands), length_px, min(forward_key, reverse_key)


def load_scenario_territories(
    canvas: Canvas,
    manifest_path: Path = HOI4_MANIFEST,
    *,
    neutral: bool = False,
    capital_defaults_path: Path | None = None,
    tag_filter: set[str] | None = None,
    clip_bbox: tuple[float, float, float, float] | None = None,
    simplify_owner_geometry: bool = True,
) -> tuple[list[dict], dict[str, int], dict[str, Path], dict]:
    paths = scenario_paths(manifest_path, capital_defaults_path)
    countries = read_json(paths["countries"])["countries"]
    owners = read_json(paths["owners"])["owners"]
    showcase_tags = tag_filter or europe_country_tags(countries)
    # detail bbox 和 context bbox 都走同一入口，避免展示页背景国和细节国使用两套裁剪语义。
    clip = canonicalize_hero_geometry(box(*(clip_bbox or canvas.bbox)))
    by_tag: dict[str, list[BaseGeometry]] = defaultdict(list)
    source_feature_count = 0

    for feature in topology_features(paths["runtime_topology"], "political"):
        properties = feature.get("properties") or {}
        if properties.get("render_as_base_geography") is False:
            continue
        feature_id = properties.get("id") or feature.get("id")
        tag = owners.get(feature_id)
        country = countries.get(tag)
        if tag not in showcase_tags or not country:
            continue
        geometry_payload = feature.get("geometry")
        if not geometry_payload:
            continue
        geometry = canonicalize_hero_geometry(shape(geometry_payload))
        if not geometry.intersects(clip):
            continue
        clipped = canonicalize_hero_geometry(geometry.intersection(clip))
        if clipped.is_empty:
            continue
        by_tag[tag].append(clipped)
        source_feature_count += 1

    territories: list[dict] = []
    for tag, geometries in sorted(by_tag.items()):
        country = countries[tag]
        merged = canonicalize_hero_geometry(unary_union(geometries))
        # Keep the existing showcase detail budget. Hero maps retain the
        # runtime's shared edges; owner-by-owner simplification exposes seams.
        if simplify_owner_geometry:
            merged = canonicalize_hero_geometry(merged.simplify(0.055, preserve_topology=True))
        path_commands = polygon_path(merged, canvas)
        if not path_commands:
            continue
        label_point = renderable_geometry(merged).representative_point()
        label_x, label_y = canvas.project(float(label_point.x), float(label_point.y))
        territories.append(
            {
                "tag": tag,
                "name": country.get("display_name") or tag,
                "label": tag,
                "label_x": label_x,
                "label_y": label_y,
                "color": "#a9bcb0" if neutral else clamp_hex(country.get("color_hex")),
                "paths": path_commands[:HERO_TERRITORY_PATH_LIMIT_PER_TAG],
                "scenario_only": bool(country.get("scenario_only")),
                "notes": country.get("notes") or "",
            }
        )

    return territories, {"source_features": source_feature_count, "territories": len(territories)}, paths, countries


def load_political_layers(canvas: Canvas) -> tuple[list[dict], dict[str, int]]:
    territories, counts, _paths, _countries = load_scenario_territories(canvas, clip_bbox=SHOWCASE_DETAIL_BBOX)
    return territories, counts


def load_context_territories(canvas: Canvas) -> tuple[list[dict], dict[str, int]]:
    territories, counts, _paths, _countries = load_scenario_territories(
        canvas,
        tag_filter=SHOWCASE_BACKGROUND_TAGS,
        clip_bbox=SHOWCASE_BBOX,
    )
    return territories, counts


def capital_hint_entries(paths: dict[str, Path]) -> tuple[list[dict], list[Path]]:
    if "capital_hints" in paths:
        return read_json(paths["capital_hints"])["entries"], [paths["capital_hints"]]

    for key in ("capital_defaults", "city_overrides"):
        path = paths.get(key)
        if path is None or not path.exists():
            continue
        payload = read_json(path)
        hints = payload.get("capital_city_hints")
        if not isinstance(hints, dict):
            continue
        return [hint for hint in hints.values() if isinstance(hint, dict)], [path]

    return [], []


def load_scenario_capitals(
    canvas: Canvas,
    countries: dict,
    paths: dict[str, Path],
    *,
    limit: int = 22,
    clip_bbox: tuple[float, float, float, float] | None = None,
    preferred_tags: tuple[str, ...] = (),
    display_names: dict[str, str] | None = None,
    display_points: dict[str, tuple[float, float]] | None = None,
) -> tuple[list[dict], list[Path]]:
    showcase_tags = europe_country_tags(countries)
    entries, source_paths = capital_hint_entries(paths)
    min_lon, min_lat, max_lon, max_lat = clip_bbox or canvas.bbox
    preferred_index = {tag: index for index, tag in enumerate(preferred_tags)}
    capitals: list[dict] = []
    for entry in entries:
        tag = entry.get("tag")
        if preferred_tags and tag not in preferred_index:
            continue
        country = countries.get(tag)
        point_override = (display_points or {}).get(tag)
        lon = point_override[0] if point_override else entry.get("lon")
        lat = point_override[1] if point_override else entry.get("lat")
        if tag not in showcase_tags or not country or lon is None or lat is None:
            continue
        if not (min_lon <= lon <= max_lon and min_lat <= lat <= max_lat):
            continue
        x, y = canvas.project(float(lon), float(lat))
        capitals.append(
            {
                "tag": tag,
                "name": (display_names or {}).get(tag) or entry.get("city_name") or entry.get("name_ascii") or tag,
                "country": country.get("display_name") or tag,
                "lon": float(lon),
                "lat": float(lat),
                "x": x,
                "y": y,
                "focus": tag in SHOWCASE_FOCUS_TAGS,
            }
        )
    if preferred_tags:
        return sorted(capitals, key=lambda item: preferred_index[item["tag"]])[:limit], source_paths
    return sorted(capitals, key=lambda item: (not item["focus"], item["tag"]))[:limit], source_paths


def load_capitals(canvas: Canvas) -> list[dict]:
    paths = scenario_paths()
    countries = read_json(paths["countries"])["countries"]
    capitals, _source_paths = load_scenario_capitals(canvas, countries, paths, clip_bbox=SHOWCASE_DETAIL_BBOX)
    return capitals


def load_rail_paths(
    canvas: Canvas,
    clip_bbox: tuple[float, float, float, float] | None = None,
) -> tuple[list[str], int, int, dict[str, int]]:
    clip = box(*(clip_bbox or canvas.bbox))
    candidates: list[tuple[str, float, str, str]] = []
    inspected = 0
    for shard in rail_paths():
        shard_id = shard.parent.name
        for feature in topology_features(shard, "railways"):
            inspected += 1
            geometry_payload = feature.get("geometry")
            if not geometry_payload:
                continue
            geometry = valid_geometry(shape(geometry_payload))
            if not geometry.intersects(clip):
                continue
            clipped = valid_geometry(geometry.intersection(clip)).simplify(0.035, preserve_topology=True)
            for path, length_px, path_key in line_path(clipped, canvas):
                if path and length_px >= RAIL_MIN_PROJECTED_PX:
                    candidates.append((shard_id, length_px, path, path_key))
    candidates_by_shard: dict[str, list[tuple[float, str, str]]] = defaultdict(list)
    for shard_id, length_px, path, path_key in candidates:
        candidates_by_shard[shard_id].append((length_px, path, path_key))

    selected: list[str] = []
    selected_keys: set[str] = set()
    selected_by_shard: dict[str, int] = {}
    # 第一轮给每个 shard 保留最低可见线数，第二轮再按长度补满整体上限，防止长线挤掉局部铁路纹理。
    for shard_id, shard_candidates in sorted(candidates_by_shard.items()):
        shard_candidates.sort(reverse=True)
        for _length_px, path, path_key in shard_candidates:
            if selected_by_shard.get(shard_id, 0) >= RAIL_MIN_LINES_PER_SHARD:
                break
            if path_key in selected_keys:
                continue
            selected.append(path)
            selected_keys.add(path_key)
            selected_by_shard[shard_id] = selected_by_shard.get(shard_id, 0) + 1

    all_candidates = sorted(((length_px, shard_id, path, path_key) for shard_id, length_px, path, path_key in candidates), reverse=True)
    for _length_px, shard_id, path, path_key in all_candidates:
        if len(selected) >= RAIL_LINE_LIMIT:
            break
        if path_key in selected_keys:
            continue
        selected.append(path)
        selected_keys.add(path_key)
        selected_by_shard[shard_id] = selected_by_shard.get(shard_id, 0) + 1

    return selected, inspected, len(candidates), selected_by_shard


def load_urban_area_paths(
    canvas: Canvas,
    clip_bbox: tuple[float, float, float, float] | None = None,
) -> tuple[list[str], int, int]:
    clip = box(*(clip_bbox or canvas.bbox))
    candidates: list[tuple[float, str]] = []
    source_count = 0
    for feature in geojson_features(EUROPE_URBAN_AREAS):
        geometry_payload = feature.get("geometry")
        if not geometry_payload:
            continue
        source_count += 1
        geometry = valid_geometry(shape(geometry_payload))
        if not geometry.intersects(clip):
            continue
        clipped = valid_geometry(geometry.intersection(clip)).simplify(URBAN_AREA_SIMPLIFY, preserve_topology=True)
        paths = polygon_path(clipped, canvas)
        if not paths:
            continue
        area_sqkm = float((feature.get("properties") or {}).get("area_sqkm") or 0.0)
        candidates.extend((area_sqkm, path) for path in paths)

    candidates.sort(key=lambda item: item[0], reverse=True)
    selected = [path for _area, path in candidates[:URBAN_AREA_LIMIT]]
    return selected, source_count, len(candidates)


def load_river_paths(
    canvas: Canvas,
    clip_bbox: tuple[float, float, float, float] | None = None,
) -> tuple[list[str], int, int]:
    clip = box(*(clip_bbox or canvas.bbox))
    candidates: list[tuple[float, str]] = []
    source_count = 0
    for feature in geojson_features(EUROPE_RIVERS):
        geometry_payload = feature.get("geometry")
        if not geometry_payload:
            continue
        source_count += 1
        geometry = valid_geometry(shape(geometry_payload))
        if not geometry.intersects(clip):
            continue
        clipped = valid_geometry(geometry.intersection(clip)).simplify(RIVER_LINE_SIMPLIFY, preserve_topology=True)
        for path, length_px, _path_key in line_path(clipped, canvas):
            if length_px >= RIVER_MIN_PROJECTED_PX:
                candidates.append((length_px, path))

    candidates.sort(key=lambda item: item[0], reverse=True)
    selected = [path for _length_px, path in candidates[:RIVER_LINE_LIMIT]]
    return selected, source_count, len(candidates)


def load_showcase_city_lights(
    canvas: Canvas,
    clip_bbox: tuple[float, float, float, float] | None = None,
) -> tuple[list[dict], int, int]:
    candidates: list[tuple[float, dict]] = []
    seen_names: set[str] = set()
    source_count = 0
    min_lon, min_lat, max_lon, max_lat = clip_bbox or canvas.bbox
    for feature in geojson_features(WORLD_CITIES):
        geometry_payload = feature.get("geometry") or {}
        coordinates = geometry_payload.get("coordinates")
        if geometry_payload.get("type") != "Point" or not isinstance(coordinates, list) or len(coordinates) < 2:
            continue
        source_count += 1
        lon = float(coordinates[0])
        lat = float(coordinates[1])
        if not (min_lon <= lon <= max_lon and min_lat <= lat <= max_lat):
            continue
        properties = feature.get("properties") or {}
        name = str(properties.get("name_en") or properties.get("name_ascii") or properties.get("name") or "").strip()
        if not name or name in seen_names:
            continue
        seen_names.add(name)
        population = float(properties.get("population") or 0)
        is_capital = bool(properties.get("is_country_capital") or properties.get("is_capital"))
        x, y = canvas.project(lon, lat)
        rank = population + (900_000 if is_capital else 0)
        candidates.append(
            (
                rank,
                {
                    "name": name,
                    "x": x,
                    "y": y,
                    "population": population,
                    "capital": is_capital,
                    "label": is_capital or population >= 1_250_000,
                },
            )
        )

    candidates.sort(key=lambda item: item[0], reverse=True)
    selected = [item for _rank, item in candidates[:NIGHT_LIGHT_LIMIT]]
    return selected, source_count, len(candidates)


def city_label_tier(index: int) -> int:
    for tier, limit in enumerate(SHOWCASE_CITY_TIER_LIMITS):
        if index < limit:
            return tier
    return len(SHOWCASE_CITY_TIER_LIMITS) - 1


def city_label_distance_ok(candidate: dict, selected: list[dict], min_distance: float) -> bool:
    for item in selected:
        if math.hypot(candidate["x"] - item["x"], candidate["y"] - item["y"]) < min_distance:
            return False
    return True


def load_showcase_city_labels(
    canvas: Canvas,
    capitals: list[dict],
    clip_bbox: tuple[float, float, float, float] | None = None,
) -> tuple[list[dict], int, int]:
    candidates: list[tuple[float, str, dict]] = []
    seen_names: set[str] = set()
    source_count = 0
    min_lon, min_lat, max_lon, max_lat = clip_bbox or canvas.bbox

    # scenario capitals 先入候选池并给高分，保证关键首都不会被人口更高的普通城市挤出标签层。
    for index, item in enumerate(capitals):
        name = str(item["name"]).strip()
        if not name or name in seen_names:
            continue
        seen_names.add(name)
        focus_rank = 1_000_000 if item.get("focus") else 0
        candidates.append(
            (
                5_000_000_000 + focus_rank - index,
                name,
                {
                    "name": name,
                    "country": item["country"],
                    "x": item["x"],
                    "y": item["y"],
                    "population": 0.0,
                    "capital": True,
                    "source": "scenario_capital",
                    "focus": bool(item.get("focus")),
                },
            )
        )

    for feature in geojson_features(WORLD_CITIES):
        geometry_payload = feature.get("geometry") or {}
        coordinates = geometry_payload.get("coordinates")
        if geometry_payload.get("type") != "Point" or not isinstance(coordinates, list) or len(coordinates) < 2:
            continue
        source_count += 1
        lon = float(coordinates[0])
        lat = float(coordinates[1])
        if not (min_lon <= lon <= max_lon and min_lat <= lat <= max_lat):
            continue
        properties = feature.get("properties") or {}
        name = str(properties.get("name_en") or properties.get("name_ascii") or properties.get("name") or "").strip()
        if not name or name in seen_names:
            continue
        population = float(properties.get("population") or 0)
        if population < 250_000 and not properties.get("is_world_city"):
            continue
        seen_names.add(name)
        x, y = canvas.project(lon, lat)
        is_country_capital = bool(properties.get("is_country_capital"))
        is_admin_capital = bool(properties.get("is_admin_capital") or properties.get("is_capital"))
        is_world_city = bool(properties.get("is_world_city"))
        rank = population
        if is_world_city:
            rank += 800_000
        if is_country_capital:
            rank += 700_000
        elif is_admin_capital:
            rank += 180_000
        candidates.append(
            (
                rank,
                name,
                {
                    "name": name,
                    "country": str(properties.get("country_code") or ""),
                    "x": x,
                    "y": y,
                    "population": population,
                    "capital": is_country_capital,
                    "source": "world_cities",
                    "focus": False,
                },
            )
        )

    candidates.sort(key=lambda item: (-item[0], item[1]))
    selected: list[dict] = []
    for _rank, _name, candidate in candidates:
        if len(selected) >= SHOWCASE_CITY_TIER_LIMITS[-1]:
            break
        tier = city_label_tier(len(selected))
        min_distance = SHOWCASE_CITY_TIER_MIN_DISTANCE_PX[tier]
        if not city_label_distance_ok(candidate, selected, min_distance):
            continue
        candidate["tier"] = tier
        selected.append(candidate)

    return selected, source_count, len(candidates)


def graticule(canvas: Canvas) -> str:
    min_lon, min_lat, max_lon, max_lat = canvas.bbox
    lines: list[str] = []
    lon = math.ceil(min_lon / 10) * 10
    while lon < max_lon:
        x1, y1 = canvas.project(lon, min_lat)
        x2, y2 = canvas.project(lon, max_lat)
        lines.append(f'<path d="M{fmt(x1)} {fmt(y1)} L{fmt(x2)} {fmt(y2)}" />')
        lon += 10
    lat = math.ceil(min_lat / 10) * 10
    while lat < max_lat:
        x1, y1 = canvas.project(min_lon, lat)
        x2, y2 = canvas.project(max_lon, lat)
        lines.append(f'<path d="M{fmt(x1)} {fmt(y1)} L{fmt(x2)} {fmt(y2)}" />')
        lat += 10
    return "\n      ".join(lines)


def territory_nodes(territories: list[dict], include_scenario_only_class: bool = True) -> str:
    nodes: list[str] = []
    for item in territories:
        tag = validate_tag(item["tag"])
        escaped_tag = xml_escape(tag)
        focus_class = " territory--focus" if tag in SHOWCASE_FOCUS_TAGS else ""
        scenario_only_class = (
            " territory--scenario-only" if include_scenario_only_class and item["scenario_only"] else ""
        )
        for path in item["paths"]:
            nodes.append(
                f'      <path class="territory territory--{tag.lower()}{focus_class}{scenario_only_class}" '
                f'data-tag="{escaped_tag}" fill="{item["color"]}" d="{path}" />'
            )
    return "\n".join(nodes)


def context_territory_nodes(territories: list[dict]) -> str:
    nodes: list[str] = []
    for item in territories:
        tag = validate_tag(item["tag"])
        escaped_tag = xml_escape(tag)
        for path in item["paths"]:
            nodes.append(
                f'      <path class="territory-context territory-context--{tag.lower()}" '
                f'data-context-tag="{escaped_tag}" fill="{item["color"]}" d="{path}" />'
            )
    return "\n".join(nodes)


def urban_area_nodes(paths: list[str]) -> str:
    return "\n".join(f'      <path class="urban-area" d="{path}" />' for path in paths)


def river_nodes(paths: list[str]) -> str:
    return "\n".join(f'      <path class="river-line" d="{path}" />' for path in paths)


def country_label_nodes(territories: list[dict]) -> str:
    nodes: list[str] = []
    for item in territories:
        tag = validate_tag(item["tag"])
        if tag not in SHOWCASE_COUNTRY_LABEL_TAGS:
            continue
        escaped_label = xml_escape(str(item.get("label") or tag))
        escaped_name = xml_escape(str(item.get("name") or tag))
        nodes.append(
            f'      <text class="country-label" data-tag="{xml_escape(tag)}" '
            f'x="{fmt(item["label_x"])}" y="{fmt(item["label_y"])}">'
            f"<title>{escaped_name}</title>{escaped_label}</text>"
        )
    return "\n".join(nodes)


def rail_nodes(paths: list[str]) -> str:
    return "\n".join(f'      <path class="rail-line" d="{path}" />' for path in paths)


def estimated_label_width(text: str, font_size: float) -> float:
    units = 0.0
    for char in text:
        if char in "ijlI1.,'`|":
            units += 0.34
        elif char in "MW@%":
            units += 0.9
        elif char.isupper():
            units += 0.68
        else:
            units += 0.58
    return max(font_size * 1.8, units * font_size)


def boxes_intersect(first: tuple[float, float, float, float], second: tuple[float, float, float, float]) -> bool:
    return not (
        first[2] <= second[0]
        or second[2] <= first[0]
        or first[3] <= second[1]
        or second[3] <= first[1]
    )


def layout_label_boxes(
    items: list[dict],
    *,
    canvas_width: float,
    canvas_height: float,
    font_size: float,
    stroke_width: float,
    gap: float,
) -> list[dict]:
    placed: list[dict] = []
    occupied: list[tuple[float, float, float, float]] = []
    stroke_pad = stroke_width / 2.0
    for item in items:
        width = estimated_label_width(str(item["name"]), font_size)
        anchor_x = float(item["x"])
        anchor_y = float(item["y"])
        above_y = anchor_y - gap
        below_y = anchor_y + font_size + gap
        candidates = [
            (anchor_x + gap, above_y),
            (anchor_x - gap - width, above_y),
            (anchor_x + gap, below_y),
            (anchor_x - gap - width, below_y),
            (anchor_x + gap, above_y - font_size * 1.2),
            (anchor_x - gap - width, above_y - font_size * 1.2),
            (anchor_x + gap, below_y + font_size * 1.2),
            (anchor_x - gap - width, below_y + font_size * 1.2),
            (anchor_x - width / 2.0, above_y),
            (anchor_x - width / 2.0, below_y),
            (anchor_x - width / 2.0, above_y - font_size * 1.2),
            (anchor_x - width / 2.0, below_y + font_size * 1.2),
        ]
        for offset_scale in (2.4, 3.6, 4.8):
            high_y = above_y - font_size * offset_scale
            low_y = below_y + font_size * offset_scale
            candidates.extend(
                (
                    (anchor_x + gap, high_y),
                    (anchor_x - gap - width, high_y),
                    (anchor_x - width / 2.0, high_y),
                    (anchor_x + gap, low_y),
                    (anchor_x - gap - width, low_y),
                    (anchor_x - width / 2.0, low_y),
                )
            )
        chosen: tuple[float, float, tuple[float, float, float, float]] | None = None
        for text_x, text_y in candidates:
            label_box = (
                text_x - stroke_pad,
                text_y - font_size * 0.84 - stroke_pad,
                text_x + width + stroke_pad,
                text_y + font_size * 0.24 + stroke_pad,
            )
            in_bounds = (
                label_box[0] >= 2.0
                and label_box[1] >= 2.0
                and label_box[2] <= canvas_width - 2.0
                and label_box[3] <= canvas_height - 2.0
            )
            if in_bounds and all(not boxes_intersect(label_box, other) for other in occupied):
                chosen = (text_x, text_y, label_box)
                break
        if chosen is None:
            raise ValueError(
                f"Could not place label {item.get('name')!r} without overlapping another label"
            )
        laid_out = dict(item)
        laid_out["label_x"] = chosen[0]
        laid_out["label_y"] = chosen[1]
        laid_out["label_box"] = chosen[2]
        placed.append(laid_out)
        occupied.append(chosen[2])
    return placed


def label_box_attr(label_box: tuple[float, float, float, float]) -> str:
    return ",".join(fmt(value) for value in label_box)


def capital_nodes(capitals: list[dict], canvas: Canvas) -> str:
    nodes: list[str] = []
    laid_out = layout_label_boxes(
        capitals,
        canvas_width=canvas.width,
        canvas_height=canvas.height,
        font_size=14.0,
        stroke_width=4.0,
        gap=9.0,
    )
    for item in laid_out:
        tag = validate_tag(item["tag"])
        escaped_tag = xml_escape(tag)
        escaped_name = xml_escape(str(item["name"]))
        escaped_country = xml_escape(str(item["country"]))
        focus_class = " capital--focus" if item["focus"] else ""
        nodes.append(
            f'      <g class="capital{focus_class}" data-tag="{escaped_tag}" '
            f'data-label-box="{label_box_attr(item["label_box"])}">'
            f"<title>{escaped_name} · {escaped_country}</title>"
            f'<circle cx="{fmt(item["x"])}" cy="{fmt(item["y"])}" r="5.8" />'
            f'<text class="city-label" x="{fmt(item["label_x"])}" y="{fmt(item["label_y"])}">{escaped_name}</text>'
            "</g>"
        )
    return "\n".join(nodes)


def showcase_city_label_nodes(city_labels: list[dict], canvas: Canvas) -> str:
    nodes: list[str] = []
    laid_out = layout_label_boxes(
        city_labels,
        canvas_width=canvas.width,
        canvas_height=canvas.height,
        font_size=12.2,
        stroke_width=3.2,
        gap=8.4,
    )
    for item in laid_out:
        tier = int(item["tier"])
        escaped_name = xml_escape(str(item["name"]))
        escaped_country = xml_escape(str(item.get("country") or ""))
        source = xml_escape(str(item.get("source") or ""))
        capital_class = " showcase-city--capital" if item.get("capital") else ""
        focus_class = " showcase-city--focus" if item.get("focus") else ""
        radius = 4.8 if tier == 0 else 4.3 if tier == 1 else 3.8 if tier == 2 else 3.4
        nodes.append(
            f'      <g class="showcase-city showcase-city--tier-{tier}{capital_class}{focus_class}" '
            f'data-city-tier="{tier}" data-city-source="{source}" '
            f'data-label-box="{label_box_attr(item["label_box"])}">'
            f"<title>{escaped_name} · {escaped_country}</title>"
            f'<circle cx="{fmt(item["x"])}" cy="{fmt(item["y"])}" r="{fmt(radius)}" />'
            f'<text class="city-label" x="{fmt(item["label_x"])}" y="{fmt(item["label_y"])}">{escaped_name}</text>'
            "</g>"
        )
    return "\n".join(nodes)


def city_light_nodes(city_lights: list[dict]) -> str:
    nodes: list[str] = []
    for item in city_lights:
        escaped_name = xml_escape(str(item["name"]))
        population = float(item.get("population") or 0.0)
        radius = 2.6 + min(5.2, math.sqrt(max(population, 1.0)) / 850.0)
        capital_class = " ambient-night-light--capital" if item.get("capital") else ""
        nodes.append(
            f'      <circle class="ambient-night-light{capital_class}" '
            f'cx="{fmt(item["x"])}" cy="{fmt(item["y"])}" r="{fmt(radius)}">'
            f"<title>{escaped_name}</title></circle>"
        )
    return "\n".join(nodes)


def night_light_texture_nodes(city_lights: list[dict]) -> str:
    nodes: list[str] = []
    ranked = sorted(city_lights, key=lambda item: float(item.get("population") or 0.0), reverse=True)
    # 光斑只取头部城市，夜幕动画和灯光密度一起读这批节点，避免低权重点把 SVG 体积推高。
    for index, item in enumerate(ranked[:42]):
        escaped_name = xml_escape(str(item["name"]))
        population = float(item.get("population") or 0.0)
        population_scale = math.sqrt(max(population, 1.0))
        rx = 9.0 + min(24.0, population_scale / 620.0)
        ry = 3.8 + min(10.0, population_scale / 1450.0)
        name_seed = sum(ord(char) for char in escaped_name)
        angle = (name_seed % 52) - 26
        tier_class = " night-light-smear--major" if index < 12 or item.get("capital") else ""
        nodes.append(
            f'      <ellipse class="night-light-smear{tier_class}" '
            f'cx="{fmt(item["x"])}" cy="{fmt(item["y"])}" rx="{fmt(rx)}" ry="{fmt(ry)}" '
            f'transform="rotate({fmt(angle)} {fmt(item["x"])} {fmt(item["y"])})">'
            f"<title>{escaped_name}</title></ellipse>"
        )
    return "\n".join(nodes)


def night_light_belt_nodes(city_lights: list[dict]) -> str:
    candidates: list[tuple[float, str, str]] = []
    ranked = sorted(city_lights, key=lambda item: float(item.get("population") or 0.0), reverse=True)
    for index, first in enumerate(ranked):
        for second in ranked[index + 1 :]:
            dx = float(second["x"]) - float(first["x"])
            dy = float(second["y"]) - float(first["y"])
            distance = math.hypot(dx, dy)
            if distance < NIGHT_LIGHT_BELT_MIN_DISTANCE_PX or distance > NIGHT_LIGHT_BELT_MAX_DISTANCE_PX:
                continue
            first_population = math.sqrt(max(float(first.get("population") or 0.0), 1.0))
            second_population = math.sqrt(max(float(second.get("population") or 0.0), 1.0))
            score = (first_population + second_population) / (distance + 12.0)
            if first.get("capital") or second.get("capital"):
                score *= 1.18
            midpoint_x = (float(first["x"]) + float(second["x"])) / 2.0
            midpoint_y = (float(first["y"]) + float(second["y"])) / 2.0
            curve = min(16.0, max(4.0, distance * 0.16))
            direction = -1 if (sum(ord(char) for char in str(first["name"]) + str(second["name"])) % 2) else 1
            control_x = midpoint_x - (dy / distance) * curve * direction
            control_y = midpoint_y + (dx / distance) * curve * direction
            path = (
                f'M{fmt(first["x"])} {fmt(first["y"])} '
                f'Q{fmt(control_x)} {fmt(control_y)} {fmt(second["x"])} {fmt(second["y"])}'
            )
            title = xml_escape(f'{first["name"]} - {second["name"]}')
            candidates.append((score, title, path))

    candidates.sort(key=lambda item: item[0], reverse=True)
    nodes: list[str] = []
    for _score, title, path in candidates[:NIGHT_LIGHT_BELT_LIMIT]:
        nodes.append(
            f'      <path class="night-light-belt night-light-belt--halo" d="{path}"><title>{title}</title></path>'
        )
        nodes.append(f'      <path class="night-light-belt night-light-belt--core" d="{path}" />')
    return "\n".join(nodes)


def day_night_nodes(canvas: Canvas, capitals: list[dict], city_lights: list[dict]) -> str:
    shade_start = -canvas.width * 0.64
    shade_end = canvas.width * 0.64
    band_x = -canvas.width
    band_width = canvas.width * 1.32
    terminator_path = (
        f"M{fmt(canvas.width * 0.24)} {fmt(-canvas.height * 0.06)} "
        f"C{fmt(canvas.width * 0.33)} {fmt(canvas.height * 0.19)} "
        f"{fmt(canvas.width * 0.31)} {fmt(canvas.height * 0.4)} "
        f"{fmt(canvas.width * 0.39)} {fmt(canvas.height * 0.63)} "
        f"C{fmt(canvas.width * 0.44)} {fmt(canvas.height * 0.81)} "
        f"{fmt(canvas.width * 0.52)} {fmt(canvas.height * 0.92)} "
        f"{fmt(canvas.width * 0.6)} {fmt(canvas.height * 1.06)}"
    )
    night_shadow_path = (
        f"M{fmt(band_x)} {fmt(-canvas.height * 0.12)} "
        f"L{fmt(canvas.width * 0.24)} {fmt(-canvas.height * 0.06)} "
        f"C{fmt(canvas.width * 0.33)} {fmt(canvas.height * 0.19)} "
        f"{fmt(canvas.width * 0.31)} {fmt(canvas.height * 0.4)} "
        f"{fmt(canvas.width * 0.39)} {fmt(canvas.height * 0.63)} "
        f"C{fmt(canvas.width * 0.44)} {fmt(canvas.height * 0.81)} "
        f"{fmt(canvas.width * 0.52)} {fmt(canvas.height * 0.92)} "
        f"{fmt(canvas.width * 0.6)} {fmt(canvas.height * 1.06)} "
        f"L{fmt(band_x)} {fmt(canvas.height * 1.12)} Z"
    )
    nodes: list[str] = []
    for item in capitals:
        tag = validate_tag(item["tag"])
        escaped_tag = xml_escape(tag)
        radius = 7.8 if item["focus"] else 5.8
        nodes.append(
            f'      <circle class="night-light" data-tag="{escaped_tag}" '
            f'cx="{fmt(item["x"])}" cy="{fmt(item["y"])}" r="{fmt(radius)}" />'
        )
    light_nodes = "\n".join(nodes)
    ambient_nodes = city_light_nodes(city_lights)
    texture_nodes = night_light_texture_nodes(city_lights)
    belt_nodes = night_light_belt_nodes(city_lights)
    return f"""    <clipPath id="nightActivityClip" clipPathUnits="userSpaceOnUse">
      <path d="{night_shadow_path}">
        <animateTransform attributeName="transform" type="translate" values="{fmt(shade_start)} 0;{fmt(shade_end)} 0;{fmt(shade_start)} 0" dur="24s" repeatCount="indefinite" />
      </path>
    </clipPath>
    <g class="day-night-shade" aria-hidden="true">
      <animateTransform attributeName="transform" type="translate" values="{fmt(shade_start)} 0;{fmt(shade_end)} 0;{fmt(shade_start)} 0" dur="24s" repeatCount="indefinite" />
      <rect class="night-band" x="{fmt(band_x)}" y="0" width="{fmt(band_width)}" height="{fmt(canvas.height)}" />
      <path class="night-shadow-core" d="{night_shadow_path}" />
      <path class="night-shadow-texture" d="{night_shadow_path}" />
      <path class="terminator-line" d="{terminator_path}" />
    </g>
    <g class="night-light-texture" aria-hidden="true" clip-path="url(#nightActivityClip)">
{texture_nodes}
    </g>
    <g class="night-light-belts" aria-hidden="true" clip-path="url(#nightActivityClip)">
{belt_nodes}
    </g>
    <g class="ambient-night-lights" aria-hidden="true" clip-path="url(#nightActivityClip)">
{ambient_nodes}
    </g>
    <g class="night-lights" aria-hidden="true" clip-path="url(#nightActivityClip)">
{light_nodes}
    </g>"""


def blank_land_nodes(paths: list[str], coastline_paths: list[str]) -> str:
    # A continuous neutral land fill keeps independently simplified province
    # boundaries from exposing sea-coloured hairline gaps.
    underlay_nodes = "\n".join(f'      <path class="blank-land-underlay" d="{path}" />' for path in coastline_paths)
    land_nodes = "\n".join(f'      <path class="blank-land" fill-rule="evenodd" d="{path}" />' for path in paths)
    coastline_nodes = "\n".join(f'      <path class="blank-coastline" fill="none" d="{path}" />' for path in coastline_paths)
    return "\n".join(node for node in (underlay_nodes, land_nodes, coastline_nodes) if node)


def base_land_nodes(paths: list[str], coastline_paths: list[str]) -> str:
    land_nodes = "\n".join(f'      <path class="base-land" fill-rule="evenodd" d="{path}" />' for path in paths)
    coastline_nodes = "\n".join(f'      <path class="base-coastline" fill="none" d="{path}" />' for path in coastline_paths)
    return "\n".join(node for node in (land_nodes, coastline_nodes) if node)


def load_blank_coastline_paths(canvas: Canvas) -> tuple[list[str], dict[str, int]]:
    clip = box(*canvas.bbox)
    clipped_geometries: list[BaseGeometry] = []
    inspected = 0
    candidate_count = 0
    clipped_count = 0
    for feature in read_json(EUROPE_BLANK_COASTLINE).get("features", []):
        geometry_payload = feature.get("geometry")
        if not geometry_payload:
            continue
        inspected += 1
        raw_geometry = shape(geometry_payload)
        min_x, min_y, max_x, max_y = raw_geometry.bounds
        if max_x < canvas.bbox[0] or min_x > canvas.bbox[2] or max_y < canvas.bbox[1] or min_y > canvas.bbox[3]:
            continue
        candidate_count += 1
        clipped = renderable_geometry(raw_geometry.intersection(clip)).simplify(BLANK_LAND_SIMPLIFY, preserve_topology=True)
        if clipped.is_empty:
            continue
        clipped_count += 1
        clipped_geometries.append(clipped)
    coastline_paths = polygon_exterior_paths(renderable_geometry(unary_union(clipped_geometries)), canvas)
    return coastline_paths, {
        "coastline_features_inspected": inspected,
        "coastline_features_candidates": candidate_count,
        "coastline_features_clipped": clipped_count,
        "coastline_paths": len(coastline_paths),
    }


def load_blank_land_paths(canvas: Canvas) -> tuple[list[str], list[str], dict[str, int | float], list[Path]]:
    clip = box(*canvas.bbox)
    blank_paths = scenario_paths(BLANK_BASE_MANIFEST)
    blank_topology = blank_paths["runtime_topology"]
    selected_paths: list[tuple[float, str]] = []
    inspected = 0
    candidate_count = 0
    clipped_count = 0
    for feature in topology_features(blank_topology, "political"):
        geometry_payload = feature.get("geometry")
        if not geometry_payload:
            continue
        inspected += 1
        raw_geometry = shape(geometry_payload)
        min_x, min_y, max_x, max_y = raw_geometry.bounds
        if max_x < canvas.bbox[0] or min_x > canvas.bbox[2] or max_y < canvas.bbox[1] or min_y > canvas.bbox[3]:
            continue
        candidate_count += 1
        geometry = renderable_geometry(raw_geometry)
        if geometry.is_empty:
            continue
        clipped = renderable_geometry(geometry.intersection(clip)).simplify(BLANK_LAND_SIMPLIFY, preserve_topology=True)
        if clipped.is_empty:
            continue
        clipped_count += 1
        selected_paths.extend((clipped.area, path) for path in polygon_path(clipped, canvas, include_interiors=True))
    selected_paths.sort(reverse=True)
    path_commands = [path for _area, path in selected_paths[:HERO_BLANK_LAND_PATH_LIMIT]]
    coastline_paths, coastline_counts = load_blank_coastline_paths(canvas)
    limited_coastline_paths = coastline_paths[:HERO_BLANK_COASTLINE_PATH_LIMIT]
    return path_commands, limited_coastline_paths, {
        "land_features_inspected": inspected,
        "land_features_candidates": candidate_count,
        "land_features_clipped": clipped_count,
        "land_paths_available": len(selected_paths),
        "land_path_limit": HERO_BLANK_LAND_PATH_LIMIT,
        "land_paths": len(path_commands),
        "land_paths_dropped": max(0, len(selected_paths) - len(path_commands)),
        "land_simplify_tolerance": BLANK_LAND_SIMPLIFY,
        **coastline_counts,
        "coastline_path_limit": HERO_BLANK_COASTLINE_PATH_LIMIT,
        "coastline_paths": len(limited_coastline_paths),
        "coastline_paths_available": len(coastline_paths),
        "coastline_paths_dropped": max(0, len(coastline_paths) - len(limited_coastline_paths)),
    }, [BLANK_BASE_MANIFEST, blank_topology, EUROPE_BLANK_COASTLINE]


def load_tno_base_underlay_paths(canvas: Canvas) -> tuple[list[str], list[str], dict[str, int | float], list[Path]]:
    clip = box(*canvas.bbox)
    selected_paths: list[dict[str, int | float | str | bool]] = []
    inspected = 0
    candidate_count = 0
    clipped_count = 0
    for feature in topology_features(EUROPE_BLANK_TOPOLOGY, "political"):
        geometry_payload = feature.get("geometry")
        if not geometry_payload:
            continue
        inspected += 1
        raw_geometry = shape(geometry_payload)
        if not bounds_intersect(raw_geometry.bounds, canvas.bbox):
            continue
        candidate_count += 1
        geometry = renderable_geometry(raw_geometry)
        if geometry.is_empty:
            continue
        clipped = renderable_geometry(geometry.intersection(clip)).simplify(BLANK_LAND_SIMPLIFY, preserve_topology=True)
        if clipped.is_empty:
            continue
        clipped_count += 1
        for part in polygon_parts(clipped):
            path_commands = polygon_path(part, canvas, include_interiors=True)
            if not path_commands:
                continue
            selected_paths.append(
                {
                    "area": part.area,
                    "path": path_commands[0],
                    "island": intersects_mediterranean_island_bbox(part),
                }
            )

    # Only restore small Mediterranean islands that the political crop can
    # miss. Mainland underlay adds modern North Africa to the TNO-only view.
    ranked_paths = sorted(
        (item for item in selected_paths if item["island"]),
        key=lambda item: float(item["area"]), reverse=True,
    )
    chosen: list[str] = []
    seen_paths: set[str] = set()
    for item in ranked_paths[:HERO_BASE_UNDERLAY_PATH_LIMIT]:
        path = str(item["path"])
        chosen.append(path)
        seen_paths.add(path)
    island_path_count = 0
    for item in ranked_paths:
        if not bool(item["island"]):
            continue
        path = str(item["path"])
        if path in seen_paths:
            island_path_count += 1
            continue
        chosen.append(path)
        seen_paths.add(path)
        island_path_count += 1

    limited_coastline_paths: list[str] = []
    coastline_counts = {"coastline_features_inspected": 0, "coastline_features_candidates": 0,
                        "coastline_features_clipped": 0, "coastline_paths": 0}
    return chosen, limited_coastline_paths, {
        "land_features_inspected": inspected,
        "land_features_candidates": candidate_count,
        "land_features_clipped": clipped_count,
        "land_paths_available": len(selected_paths),
        "land_path_limit": HERO_BASE_UNDERLAY_PATH_LIMIT,
        "land_paths": len(chosen),
        "land_paths_dropped": max(0, len(ranked_paths) - len(chosen)),
        "mediterranean_island_paths": island_path_count,
        "land_simplify_tolerance": BLANK_LAND_SIMPLIFY,
        **coastline_counts,
        "coastline_path_limit": HERO_BASE_UNDERLAY_COASTLINE_LIMIT,
        "coastline_paths": len(limited_coastline_paths),
        "coastline_paths_available": 0,
        "coastline_paths_dropped": 0,
    }, [EUROPE_BLANK_TOPOLOGY]


def load_atlantropa_paths(canvas: Canvas) -> tuple[dict[str, list[str]], dict[str, int], Path]:
    source = TNO_1962_MANIFEST.parent / "scenario_atlantropa.topo.json"
    clip = box(*canvas.bbox)
    groups: dict[str, list[BaseGeometry]] = defaultdict(list)
    source_count = 0
    for feature in topology_features(source, "scenario_atlantropa"):
        props = feature.get("properties") or {}
        layer = props.get("atl_render_layer")
        if layer not in {"water", "land", "shoal"}:
            continue
        geometry = renderable_geometry(shape(feature["geometry"]))
        if geometry.is_empty or not geometry.intersects(clip):
            continue
        groups[layer].append(geometry.intersection(clip))
        source_count += 1
    present_land = canonicalize_hero_geometry(unary_union([
        shape(feature["geometry"]) for feature in read_json(EUROPE_BLANK_COASTLINE)["features"]
    ]))
    paths = {}
    for layer, parts in groups.items():
        geometry = canonicalize_hero_geometry(unary_union(parts))
        if layer == "land":
            geometry = canonicalize_hero_geometry(geometry.difference(present_land))
        paths[layer] = polygon_path(geometry, canvas, include_interiors=True)
    return paths, {"atlantropa_features": source_count,
                   **{f"atlantropa_{layer}_paths": len(paths.get(layer, [])) for layer in ("water", "land", "shoal")}}, source


def hero_output_paths(output_dir: Path, mode: str) -> dict[str, Path]:
    defaults = HERO_SCENARIO_OUTPUTS[mode]
    if output_dir == LANDING_ASSETS:
        return defaults
    return {
        "svg": output_dir / defaults["svg"].name,
        "metadata": output_dir / defaults["metadata"].name,
    }


def hero_source_files(
    paths: dict[str, Path],
    capital_source_paths: list[Path],
) -> list[str]:
    ordered: list[Path] = [
        paths["manifest"],
        paths["runtime_topology"],
        paths["owners"],
        paths["countries"],
    ]
    ordered.extend(capital_source_paths)
    return [repo_path(path) for path in ordered]


def build_hero_svg(
    canvas: Canvas,
    scenario: HeroScenario,
    territories: list[dict],
    capitals: list[dict],
    land_paths: list[str],
    coastline_paths: list[str] | None = None,
    atlantropa_paths: dict[str, list[str]] | None = None,
) -> str:
    title = xml_escape(scenario.title)
    if scenario.blank:
        political_layer = blank_land_nodes(land_paths, coastline_paths or [])
        capital_layer = ""
        base_layer = ""
    else:
        political_layer = territory_nodes(territories, include_scenario_only_class=False)
        capital_layer = capital_nodes(capitals, canvas)
        base_layer = base_land_nodes(land_paths, coastline_paths or [])
    atlantropa_layer = "\n".join(
        f'      <path class="atlantropa-{layer}" data-atlantropa-layer="{layer}" fill-rule="evenodd" d="{path}" />'
        for layer in ("water", "land", "shoal")
        for path in (atlantropa_paths or {}).get(layer, [])
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {canvas.width} {canvas.height}" role="img" aria-label="{title}" data-hero-scenario="{xml_escape(scenario.mode)}" data-scenario-id="{xml_escape(scenario.scenario_id)}">
  <defs>
    <radialGradient id="heroSeaGlow" cx="50%" cy="44%" r="78%">
      <stop offset="0" stop-color="#244a68" />
      <stop offset="1" stop-color="#071522" />
    </radialGradient>
    <filter id="heroCapitalGlow"><feGaussianBlur stdDeviation="7" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <style>
      .hero-graticule path {{ fill: none; stroke: rgba(255,255,255,.13); stroke-width: 1; }}
      .territory {{ stroke: #0b1725; stroke-width: .72; opacity: .9; }}
      .territory--focus {{ stroke: #0b1725; stroke-width: .72; }}
      .blank-land {{ fill: #aab9ae; stroke: #d8e2db; stroke-width: .25; vector-effect: non-scaling-stroke; opacity: .72; }}
      .blank-land-underlay {{ fill: #aab9ae; opacity: .72; }}
      .blank-coastline {{ fill: none; stroke: #edf4ee; stroke-width: .5; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; opacity: .72; }}
      .base-land {{ fill: #8ea099; stroke: #cad8d0; stroke-width: .22; vector-effect: non-scaling-stroke; opacity: .38; }}
      .base-coastline {{ stroke: #d8e7df; stroke-width: .5; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; opacity: .58; }}
      .capital circle {{ fill: #050b12; stroke: #dfeaf0; stroke-width: 2.2; filter: url(#heroCapitalGlow); opacity: .84; }}
      .capital text {{ fill: #edf7fb; font: 800 14px Arial, sans-serif; paint-order: stroke; stroke: #07111f; stroke-width: 4; opacity: .82; }}
      svg[data-hero-scenario="blank"] .hero-graticule path {{ stroke: rgba(255,255,255,.18); }}
      svg[data-hero-scenario="blank"] .blank-land {{ fill: #b6c3bb; stroke: #edf4ee; opacity: .78; }}
      svg[data-hero-scenario="blank"] .blank-coastline {{ stroke: #f7fbf7; opacity: .78; }}
      svg[data-hero-scenario="hoi4-1936"] .territory {{ opacity: .9; }}
      svg[data-hero-scenario="hoi4-1939"] .territory {{ opacity: .93; }}
      svg[data-hero-scenario="tno-1962"] .territory {{ stroke: #050b13; stroke-width: .76; opacity: .88; }}
      .atlantropa-water {{ fill: #203856; }}
      .atlantropa-land {{ fill: #c0af87; stroke: #b4a582; stroke-width: .3; }}
      .atlantropa-shoal {{ fill: #a9b6a0; opacity: .55; }}
    </style>
  </defs>
  <rect width="{canvas.width}" height="{canvas.height}" rx="28" fill="#203856" />
  <g class="hero-graticule" aria-hidden="true">
      {graticule(canvas)}
  </g>
  <g class="hero-base-land" data-layer="base-land">
{base_layer}
  </g>
  <g class="hero-political" data-layer="political">
{political_layer}
  </g>
  <g class="hero-atlantropa" data-layer="atlantropa">
{atlantropa_layer}
  </g>
  <g class="hero-capitals" data-layer="capitals">
{capital_layer}
  </g>
</svg>
"""


def build_hero_metadata(
    canvas: Canvas,
    scenario: HeroScenario,
    source_files: list[str],
    counts: dict[str, int],
    territories: list[dict],
    capitals: list[dict],
) -> dict:
    min_x, min_y, max_x, max_y = canvas.projected_bounds
    selection_policy = {
        "viewport": "Europe hero crop shared by all scenario chips",
        "blank_canvas": scenario.blank,
        "ownership_fill": not scenario.blank,
        "capital_limit": 0 if scenario.blank else (len(scenario.hero_capital_tags) or HERO_CAPITAL_LIMIT),
        "territory_path_limit_per_tag": 0 if scenario.blank else HERO_TERRITORY_PATH_LIMIT_PER_TAG,
        "capital_label_layout": "deterministic bounding-box avoidance including text stroke",
    }
    if scenario.hero_capital_tags:
        selection_policy["hero_capital_tags"] = list(scenario.hero_capital_tags)
        selection_policy["hero_capital_label_overrides"] = dict(scenario.hero_capital_labels or {})
        selection_policy["hero_capital_point_overrides"] = {
            tag: [lon, lat] for tag, (lon, lat) in (scenario.hero_capital_points or {}).items()
        }
    if scenario.scenario_id == "tno_1962":
        selection_policy.update(
            {
                "hero_geometry_source": "runtime_topology political ownership crop",
                "atlantropa_overlay": "source water, reclaimed land, and shoal geometry",
                "base_underlay": "Mediterranean island fragments only",
                "base_underlay_path_limit": HERO_BASE_UNDERLAY_PATH_LIMIT,
                "base_underlay_coastline_limit": HERO_BASE_UNDERLAY_COASTLINE_LIMIT,
            }
        )
    if scenario.blank:
        selection_policy.update(
            {
                "land_simplify_tolerance": BLANK_LAND_SIMPLIFY,
                "land_path_limit": HERO_BLANK_LAND_PATH_LIMIT,
                "land_path_ranking": "clipped geometry area descending",
                "blank_internal_stroke_width": BLANK_INTERNAL_STROKE_WIDTH,
                "coastline_stroke_width": BLANK_COASTLINE_STROKE_WIDTH,
                "coastline_path_limit": HERO_BLANK_COASTLINE_PATH_LIMIT,
                "coastline_source": "data/europe_land_bg.geojson exterior rings",
                "runtime_topology_source": repo_path(scenario_paths(BLANK_BASE_MANIFEST)["runtime_topology"]),
            }
        )
    return {
        "schema_version": 1,
        "asset_type": "landing_hero_scenario_map",
        "scenario_id": scenario.scenario_id,
        "mode": scenario.mode,
        "title": scenario.title,
        "palette_class": scenario.palette_class,
        "viewport": {
            "bbox": list(HERO_BBOX),
            "projection": "lambert_azimuthal_equal_area",
            "center_lon": PROJECTION_CENTER_LON,
            "center_lat": PROJECTION_CENTER_LAT,
            "canvas_width": canvas.width,
            "canvas_height": canvas.height,
            "canvas_padding": HERO_CANVAS_PADDING,
            "projected_bounds": [min_x, min_y, max_x, max_y],
            "scale": canvas.scale,
        },
        "source_files": source_files,
        "feature_counts": dict(counts),
        "counts": dict(counts),
        "territory_tags": sorted(item["tag"] for item in territories),
        "capital_tags": sorted(item["tag"] for item in capitals),
        "capital_points": [
            {
                "tag": item["tag"],
                "name": item["name"],
                "lon": item["lon"],
                "lat": item["lat"],
            }
            for item in capitals
        ],
        "selection_policy": selection_policy,
    }


def build_hero_scenario_maps(output_dir: Path = LANDING_ASSETS) -> None:
    canvas = Canvas.create(HERO_CANVAS_WIDTH, HERO_CANVAS_HEIGHT, HERO_BBOX, HERO_CANVAS_PADDING)
    for scenario in HERO_SCENARIOS:
        output_paths = hero_output_paths(output_dir, scenario.mode)
        land_paths: list[str] = []
        coastline_paths: list[str] = []
        atlantropa_paths: dict[str, list[str]] = {}
        if scenario.blank:
            land_paths, coastline_paths, counts, blank_source_paths = load_blank_land_paths(canvas)
            territories: list[dict] = []
            capitals: list[dict] = []
            source_files = [repo_path(path) for path in blank_source_paths]
        else:
            territories, political_counts, paths, countries = load_scenario_territories(
                canvas,
                scenario.manifest_path,
                capital_defaults_path=scenario.capital_defaults_path,
                simplify_owner_geometry=False,
            )
            capitals, capital_source_paths = load_scenario_capitals(canvas, countries, paths, limit=HERO_CAPITAL_LIMIT)
            if scenario.hero_capital_tags:
                capitals, capital_source_paths = load_scenario_capitals(
                    canvas,
                    countries,
                    paths,
                    limit=len(scenario.hero_capital_tags),
                    preferred_tags=scenario.hero_capital_tags,
                    display_names=scenario.hero_capital_labels or {},
                    display_points=scenario.hero_capital_points or {},
                )
            underlay_source_paths: list[Path] = []
            underlay_counts: dict[str, int | float] = {}
            if scenario.scenario_id == "tno_1962":
                land_paths, coastline_paths, raw_underlay_counts, _blank_source_paths = load_tno_base_underlay_paths(canvas)
                underlay_counts = {f"base_{key}": value for key, value in raw_underlay_counts.items()}
                atlantropa_paths, atlantropa_counts, atlantropa_source = load_atlantropa_paths(canvas)
                underlay_counts.update(atlantropa_counts)
                underlay_source_paths = [EUROPE_BLANK_TOPOLOGY, EUROPE_BLANK_COASTLINE, atlantropa_source]
            counts = {
                "territories": political_counts["territories"],
                "political_features": political_counts["source_features"],
                "capitals": len(capitals),
                **underlay_counts,
            }
            source_files = hero_source_files(paths, capital_source_paths + underlay_source_paths)
        write_text_lf(
            output_paths["svg"],
            build_hero_svg(
                canvas,
                scenario,
                territories,
                capitals,
                land_paths,
                coastline_paths,
                atlantropa_paths,
            ),
        )
        metadata = build_hero_metadata(canvas, scenario, source_files, counts, territories, capitals)
        write_text_lf(output_paths["metadata"], json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")


def build_svg(
    canvas: Canvas,
    context_territories: list[dict],
    territories: list[dict],
    capitals: list[dict],
    city_labels: list[dict],
    rails: list[str],
    urban_areas: list[str],
    rivers: list[str],
    city_lights: list[dict],
) -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {canvas.width} {canvas.height}" role="img" aria-label="Europe 1936 scenario showcase built from Scenario Forge data" data-active-layer="political" data-showcase-city-detail="base">
  <defs>
    <radialGradient id="seaGlow" cx="52%" cy="42%" r="76%">
      <stop offset="0" stop-color="#17395a" />
      <stop offset="1" stop-color="#081523" />
    </radialGradient>
    <linearGradient id="nightCycleGradient" x1="0%" x2="100%" y1="0%" y2="0%">
      <stop offset="0" stop-color="#04111f" stop-opacity=".9" />
      <stop offset="44%" stop-color="#071a2c" stop-opacity=".82" />
      <stop offset="56%" stop-color="#132f49" stop-opacity=".42" />
      <stop offset="72%" stop-color="#f8d77f" stop-opacity=".1" />
      <stop offset="100%" stop-color="#f8d77f" stop-opacity="0" />
    </linearGradient>
    <linearGradient id="nightShadowGradient" x1="0%" x2="100%" y1="0%" y2="0%">
      <stop offset="0" stop-color="#01050d" stop-opacity=".82" />
      <stop offset="58%" stop-color="#031020" stop-opacity=".74" />
      <stop offset="84%" stop-color="#09233c" stop-opacity=".38" />
      <stop offset="100%" stop-color="#09233c" stop-opacity="0" />
    </linearGradient>
    <filter id="capitalGlow"><feGaussianBlur stdDeviation="8" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="nightLightGlow"><feGaussianBlur stdDeviation="7" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="ambientLightGlow"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="nightLightBeltGlow"><feGaussianBlur stdDeviation="5.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="nightTexture" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency=".018 .034" numOctaves="3" seed="1936" result="noise" />
      <feColorMatrix in="noise" type="matrix" values="0 0 0 0 .12 0 0 0 0 .28 0 0 0 0 .42 0 0 0 .2 0" />
    </filter>
    <filter id="railGlow"><feGaussianBlur stdDeviation="2.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="softEdgeBlur"><feGaussianBlur stdDeviation="20" /></filter>
    <style>
      .graticule path {{ fill: none; stroke: rgba(255,255,255,.12); stroke-width: 1; }}
      .territory-context {{ stroke: #10273e; stroke-width: .7; vector-effect: non-scaling-stroke; opacity: .36; }}
      .territory {{ stroke: #091426; stroke-width: 1.05; vector-effect: non-scaling-stroke; opacity: .78; }}
      .territory--focus {{ stroke: #f8d77f; stroke-width: 1.45; opacity: .92; }}
      .territory--scenario-only {{ stroke-dasharray: 5 4; }}
      .urban-area {{ fill: #f1d891; stroke: #51351f; stroke-width: .55; opacity: .46; vector-effect: non-scaling-stroke; }}
      .river-line {{ fill: none; stroke: #8fd6f6; stroke-width: 1.65; stroke-linecap: round; opacity: .58; vector-effect: non-scaling-stroke; }}
      .rail-line {{ fill: none; stroke: #ffb969; stroke-width: 1.45; stroke-linecap: round; opacity: .24; vector-effect: non-scaling-stroke; filter: url(#railGlow); }}
      .capital circle {{ fill: #fff0af; stroke: #143044; stroke-width: 2; filter: url(#capitalGlow); opacity: .42; }}
      .capital text {{ fill: #f8fbff; font-family: Arial, sans-serif; paint-order: stroke; stroke: #07111f; opacity: .62; }}
      .showcase-city {{ opacity: 0; transition: opacity .25s ease; }}
      .showcase-city circle {{ fill: #fff0af; stroke: #143044; stroke-width: 1.8; filter: url(#capitalGlow); opacity: .78; }}
      .showcase-city--capital circle {{ fill: #fff5bc; opacity: .86; }}
      .city-label {{ fill: #f8fbff; font-family: Arial, sans-serif; font-size: 12.2px; font-weight: 800; paint-order: stroke; stroke: #07111f; stroke-width: 3.2; opacity: .78; }}
      .capital-code {{ font-size: 11px; font-weight: 800; letter-spacing: 1px; stroke-width: 3; fill: #f8d77f; }}
      .country-label {{ fill: rgba(255,255,255,.82); font: 800 17px Arial, sans-serif; letter-spacing: 1px; text-anchor: middle; paint-order: stroke; stroke: #07111f; stroke-width: 5; opacity: .62; }}
      .layer-urban, .layer-rivers, .layer-rail, .layer-country-labels, .layer-cities, .layer-day-night {{ transition: opacity .25s ease; }}
      .layer-day-night {{ opacity: 0; pointer-events: none; }}
      .night-band {{ fill: url(#nightCycleGradient); opacity: .9; }}
      .night-shadow-core {{ fill: url(#nightShadowGradient); opacity: .96; mix-blend-mode: multiply; }}
      .night-shadow-texture {{ fill: #6fb5df; opacity: .22; filter: url(#nightTexture); mix-blend-mode: screen; }}
      .terminator-line {{ fill: none; stroke: rgba(248,215,127,.82); stroke-width: 7; stroke-linecap: round; opacity: .78; filter: url(#capitalGlow); }}
      .night-light {{ fill: #ffe48a; opacity: .86; filter: url(#nightLightGlow); }}
      .ambient-night-light {{ fill: #ffd66b; opacity: .72; filter: url(#ambientLightGlow); }}
      .ambient-night-light--capital {{ fill: #fff3a8; opacity: .9; }}
      .night-light-smear {{ fill: #f9c96f; opacity: .18; filter: url(#nightLightBeltGlow); mix-blend-mode: screen; }}
      .night-light-smear--major {{ fill: #fff0a8; opacity: .26; }}
      .night-light-belt {{ fill: none; stroke-linecap: round; stroke-linejoin: round; mix-blend-mode: screen; }}
      .night-light-belt--halo {{ stroke: #f8a85c; stroke-width: 7.2; opacity: .18; filter: url(#nightLightBeltGlow); }}
      .night-light-belt--core {{ stroke: #ffe08a; stroke-width: 2.1; opacity: .58; }}
      .map-edge-fog > * {{ filter: url(#softEdgeBlur); pointer-events: none; }}
      svg[data-active-layer="political"] .territory {{ opacity: .9; }}
      svg[data-active-layer="political"] .layer-urban {{ opacity: .56; }}
      svg[data-active-layer="political"] .layer-rivers {{ opacity: .62; }}
      svg[data-active-layer="political"] .layer-rail {{ opacity: .28; }}
      svg[data-active-layer="political"] .layer-country-labels {{ opacity: .86; }}
      svg[data-active-layer="political"] .layer-cities {{ opacity: 0; }}
      svg[data-active-layer="political"] .layer-day-night {{ opacity: 0; }}
      svg[data-active-layer="rail"] .territory-context {{ opacity: .16; }}
      svg[data-active-layer="rail"] .territory {{ opacity: .34; }}
      svg[data-active-layer="rail"] .layer-urban {{ opacity: .16; }}
      svg[data-active-layer="rail"] .layer-rivers {{ opacity: .22; }}
      svg[data-active-layer="rail"] .layer-rail {{ opacity: 1; mix-blend-mode: screen; }}
      svg[data-active-layer="rail"] .rail-line {{ opacity: .96; stroke: #ffc66d; stroke-width: 1.75; }}
      svg[data-active-layer="rail"] .layer-country-labels {{ opacity: 0; }}
      svg[data-active-layer="rail"] .layer-cities {{ opacity: 0; }}
      svg[data-active-layer="rail"] .layer-day-night {{ opacity: 0; }}
      svg[data-active-layer="cities"] .territory {{ opacity: .52; }}
      svg[data-active-layer="cities"] .layer-urban {{ opacity: .72; }}
      svg[data-active-layer="cities"] .layer-rivers {{ opacity: .68; }}
      svg[data-active-layer="cities"] .layer-rail {{ opacity: .3; }}
      svg[data-active-layer="cities"] .layer-country-labels {{ opacity: .42; }}
      svg[data-active-layer="cities"] .layer-cities {{ opacity: 1; }}
      svg[data-active-layer="cities"] .showcase-city--tier-0 {{ opacity: 1; }}
      svg[data-active-layer="cities"][data-showcase-city-detail="expanded"] .showcase-city--tier-1,
      svg[data-active-layer="cities"][data-showcase-city-detail="regional"] .showcase-city--tier-1,
      svg[data-active-layer="cities"][data-showcase-city-detail="dense"] .showcase-city--tier-1 {{ opacity: 1; }}
      svg[data-active-layer="cities"][data-showcase-city-detail="regional"] .showcase-city--tier-2,
      svg[data-active-layer="cities"][data-showcase-city-detail="dense"] .showcase-city--tier-2 {{ opacity: 1; }}
      svg[data-active-layer="cities"][data-showcase-city-detail="dense"] .showcase-city--tier-3 {{ opacity: 1; }}
      svg[data-active-layer="cities"][data-showcase-city-detail="expanded"] .city-label {{ font-size: 11.5px; stroke-width: 3; }}
      svg[data-active-layer="cities"][data-showcase-city-detail="regional"] .city-label {{ font-size: 10.8px; stroke-width: 2.8; }}
      svg[data-active-layer="cities"][data-showcase-city-detail="dense"] .city-label {{ font-size: 10.2px; stroke-width: 2.6; }}
      svg[data-active-layer="cities"][data-showcase-city-detail="expanded"] .showcase-city circle {{ transform: scale(.94); transform-origin: center; }}
      svg[data-active-layer="cities"][data-showcase-city-detail="regional"] .showcase-city circle {{ transform: scale(.88); transform-origin: center; }}
      svg[data-active-layer="cities"][data-showcase-city-detail="dense"] .showcase-city circle {{ transform: scale(.82); transform-origin: center; }}
      svg[data-active-layer="cities"] .layer-day-night {{ opacity: 0; }}
      svg[data-active-layer="day-night"] .territory {{ opacity: .64; }}
      svg[data-active-layer="day-night"] .territory--focus {{ opacity: .9; }}
      svg[data-active-layer="day-night"] .layer-urban {{ opacity: .24; }}
      svg[data-active-layer="day-night"] .layer-rivers {{ opacity: .38; }}
      svg[data-active-layer="day-night"] .layer-rail {{ opacity: .46; }}
      svg[data-active-layer="day-night"] .layer-country-labels {{ opacity: .35; }}
      svg[data-active-layer="day-night"] .layer-cities {{ opacity: .78; }}
      svg[data-active-layer="day-night"] .capital circle {{ opacity: .62; }}
      svg[data-active-layer="day-night"] .capital text {{ opacity: .52; }}
      svg[data-active-layer="day-night"] .layer-day-night {{ opacity: 1; }}
    </style>
  </defs>
  <rect width="{canvas.width}" height="{canvas.height}" rx="28" fill="url(#seaGlow)" />
  <g class="viewport" data-showcase-viewport="true" transform="translate(0 0) scale(1)">
  <g class="graticule" aria-hidden="true">
      {graticule(canvas)}
  </g>
  <g class="layer layer-context-land" data-layer="context-land" aria-hidden="true">
{context_territory_nodes(context_territories)}
  </g>
  <g class="layer layer-political" data-layer="political">
{territory_nodes(territories)}
  </g>
  <g class="layer layer-urban" data-layer="urban">
{urban_area_nodes(urban_areas)}
  </g>
  <g class="layer layer-rivers" data-layer="rivers">
{river_nodes(rivers)}
  </g>
  <g class="layer layer-rail" data-layer="rail">
{rail_nodes(rails)}
  </g>
  <g class="layer layer-country-labels" data-layer="country-labels">
{country_label_nodes(territories)}
  </g>
  <g class="layer layer-cities" data-layer="cities">
{showcase_city_label_nodes(city_labels, canvas)}
  </g>
  <g class="layer layer-day-night" data-layer="day-night">
{day_night_nodes(canvas, capitals, city_lights)}
  </g>
  </g>
  <g class="map-edge-fog" aria-hidden="true">
    <rect x="-34" y="-34" width="{canvas.width + 68}" height="92" fill="#07111f" opacity=".34" />
    <rect x="-34" y="{canvas.height - 58}" width="{canvas.width + 68}" height="92" fill="#07111f" opacity=".3" />
    <rect x="-34" y="-34" width="92" height="{canvas.height + 68}" fill="#07111f" opacity=".34" />
    <rect x="{canvas.width - 58}" y="-34" width="92" height="{canvas.height + 68}" fill="#07111f" opacity=".34" />
  </g>
</svg>
"""


def build_metadata(
    canvas: Canvas,
    political_counts: dict[str, int],
    context_counts: dict[str, int],
    context_territories: list[dict],
    territories: list[dict],
    capitals: list[dict],
    city_labels: list[dict],
    selected_rail_paths: list[str],
    rail_inspected: int,
    rail_candidates: int,
    rail_selected_by_shard: dict[str, int],
    urban_paths: list[str],
    urban_source_count: int,
    urban_candidates: int,
    river_paths: list[str],
    river_source_count: int,
    river_candidates: int,
    city_lights: list[dict],
    city_source_count: int,
    city_candidates: int,
    city_label_source_count: int,
    city_label_candidates: int,
) -> dict:
    paths = scenario_paths()
    rail_paths_source = rail_paths()
    context_tags = sorted(item["tag"] for item in context_territories)
    territory_tags = sorted(item["tag"] for item in territories)
    capital_tags = sorted(item["tag"] for item in capitals)
    city_label_tier_counts = {
        str(tier): sum(1 for item in city_labels if int(item["tier"]) == tier)
        for tier in range(len(SHOWCASE_CITY_TIER_LIMITS))
    }
    min_x, min_y, max_x, max_y = canvas.projected_bounds
    return {
        "schema_version": 1,
        "scenario_id": "hoi4_1936",
        "title": "Europe 1936 homepage showcase",
        "bbox": list(SHOWCASE_BBOX),
        "detail_bbox": list(SHOWCASE_DETAIL_BBOX),
        "projection": {
            "name": "lambert_azimuthal_equal_area",
            "center_lon": PROJECTION_CENTER_LON,
            "center_lat": PROJECTION_CENTER_LAT,
            "canvas_width": canvas.width,
            "canvas_height": canvas.height,
            "canvas_padding": SHOWCASE_CANVAS_PADDING,
            "projected_bounds": [min_x, min_y, max_x, max_y],
            "scale": canvas.scale,
        },
        "selection_policy": {
            "territories": "countries with continent_id=continent_europe plus configured transregional tags inside the Europe-focused detail viewport",
            "transregional_tags": sorted(TRANSREGIONAL_EUROPE_SHOWCASE_TAGS),
            "context_tags": sorted(SHOWCASE_BACKGROUND_TAGS),
            "context_layer": "adjacent North Africa and Near East territories rendered as low-detail background color only",
            "capital_limit": 22,
            "rail_source": "full",
            "rail_limit": RAIL_LINE_LIMIT,
            "rail_min_lines_per_shard": RAIL_MIN_LINES_PER_SHARD,
            "rail_min_projected_px": RAIL_MIN_PROJECTED_PX,
            "rail_dedupe_pixel_grid": RAIL_DEDUPE_PIXEL_GRID,
            "rail_ranking_key": "clipped_projected_length_px",
            "rail_dedupe_key": "projected_path_grid_or_reverse",
            "urban_area_limit": URBAN_AREA_LIMIT,
            "urban_area_simplify": URBAN_AREA_SIMPLIFY,
            "river_line_limit": RIVER_LINE_LIMIT,
            "river_line_simplify": RIVER_LINE_SIMPLIFY,
            "river_min_projected_px": RIVER_MIN_PROJECTED_PX,
            "night_light_limit": NIGHT_LIGHT_LIMIT,
            "night_light_belt_limit": NIGHT_LIGHT_BELT_LIMIT,
            "day_night_visual_policy": "animated curved night mask with clipped deterministic texture, city-light smears, and ranked light belts",
            "city_label_source": "scenario capital hints plus world_cities major populated places",
            "city_label_layout": "deterministic bounding-box avoidance including text stroke",
            "city_label_tier_limits": list(SHOWCASE_CITY_TIER_LIMITS),
            "city_label_tier_min_distance_px": list(SHOWCASE_CITY_TIER_MIN_DISTANCE_PX),
            "country_label_source": "territory representative points",
            "country_label_tags": sorted(SHOWCASE_COUNTRY_LABEL_TAGS),
            "country_label_limit": len(SHOWCASE_COUNTRY_LABEL_TAGS),
        },
        "sources": [
            repo_path(HOI4_MANIFEST),
            repo_path(paths["runtime_topology"]),
            repo_path(paths["countries"]),
            repo_path(paths["owners"]),
            repo_path(paths["capital_hints"]),
            repo_path(RAIL_CATALOG),
            *[repo_path(path) for path in rail_paths_source],
            repo_path(EUROPE_URBAN_AREAS),
            repo_path(EUROPE_RIVERS),
            repo_path(WORLD_CITIES),
        ],
        "counts": {
            "territories": political_counts["territories"],
            "political_features": political_counts["source_features"],
            "context_territories": context_counts["territories"],
            "context_political_features": context_counts["source_features"],
            "capitals": len(capitals),
            "rail_lines_selected": len(selected_rail_paths),
            "rail_lines_candidates": rail_candidates,
            "rail_features_inspected": rail_inspected,
            "urban_source_features": urban_source_count,
            "urban_paths_candidates": urban_candidates,
            "urban_areas_rendered": len(urban_paths),
            "river_source_features": river_source_count,
            "river_paths_candidates": river_candidates,
            "river_lines_rendered": len(river_paths),
            "city_source_features": city_source_count,
            "city_light_candidates": city_candidates,
            "night_light_points_rendered": len(city_lights),
            "city_label_source_features": city_label_source_count,
            "city_label_candidates": city_label_candidates,
            "city_labels_rendered": len(city_labels),
            "city_label_tier_counts": city_label_tier_counts,
            "country_labels_rendered": sum(1 for item in territories if item["tag"] in SHOWCASE_COUNTRY_LABEL_TAGS),
        },
        "rail_selected_by_shard": dict(sorted(rail_selected_by_shard.items())),
        "context_territory_tags": context_tags,
        "territory_tags": territory_tags,
        "capital_tags": capital_tags,
        "city_label_names": [str(item["name"]) for item in city_labels],
        "focus_tags": sorted(tag for tag in SHOWCASE_FOCUS_TAGS if tag in territory_tags),
        "layers": list(SHOWCASE_LAYERS),
    }


def build_showcase() -> None:
    canvas = Canvas.create(SHOWCASE_CANVAS_WIDTH, SHOWCASE_CANVAS_HEIGHT, SHOWCASE_BBOX)
    context_territories, context_counts = load_context_territories(canvas)
    territories, political_counts = load_political_layers(canvas)
    capitals = load_capitals(canvas)
    city_labels, city_label_source_count, city_label_candidates = load_showcase_city_labels(
        canvas,
        capitals,
        SHOWCASE_DETAIL_BBOX,
    )
    rails, rail_inspected, rail_candidates, rail_selected_by_shard = load_rail_paths(canvas, SHOWCASE_DETAIL_BBOX)
    urban_paths, urban_source_count, urban_candidates = load_urban_area_paths(canvas, SHOWCASE_DETAIL_BBOX)
    river_paths, river_source_count, river_candidates = load_river_paths(canvas, SHOWCASE_DETAIL_BBOX)
    city_lights, city_source_count, city_candidates = load_showcase_city_lights(canvas, SHOWCASE_DETAIL_BBOX)
    write_text_lf(
        SHOWCASE_SVG,
        build_svg(
            canvas,
            context_territories,
            territories,
            capitals,
            city_labels,
            rails,
            urban_paths,
            river_paths,
            city_lights,
        ),
    )
    metadata = build_metadata(
        canvas,
        political_counts,
        context_counts,
        context_territories,
        territories,
        capitals,
        city_labels,
        rails,
        rail_inspected,
        rail_candidates,
        rail_selected_by_shard,
        urban_paths,
        urban_source_count,
        urban_candidates,
        river_paths,
        river_source_count,
        river_candidates,
        city_lights,
        city_source_count,
        city_candidates,
        city_label_source_count,
        city_label_candidates,
    )
    write_text_lf(SHOWCASE_METADATA, json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")


def build_landing_assets() -> None:
    build_showcase()
    build_hero_scenario_maps()


if __name__ == "__main__":
    build_landing_assets()
