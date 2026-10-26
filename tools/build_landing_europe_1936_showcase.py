from __future__ import annotations

import json
import sys
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
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from map_builder.json_source import read_json_source
from tools.scenario_topology_decode import topology_object_to_geojson

LANDING_ASSETS = REPO_ROOT / "landing" / "assets"
HOI4_MANIFEST = REPO_ROOT / "data" / "scenarios" / "hoi4_1936" / "manifest.json"
HOI4_1939_MANIFEST = REPO_ROOT / "data" / "scenarios" / "hoi4_1939" / "manifest.json"
TNO_1962_MANIFEST = REPO_ROOT / "data" / "scenarios" / "tno_1962" / "manifest.json"
BLANK_BASE_MANIFEST = REPO_ROOT / "data" / "scenarios" / "blank_base" / "manifest.json"
EUROPE_BLANK_TOPOLOGY = REPO_ROOT / "data" / "europe_topology.runtime_political_v1.json"
EUROPE_BLANK_COASTLINE = REPO_ROOT / "data" / "europe_land_bg.geojson"
WORLD_CITIES = REPO_ROOT / "data" / "world_cities.geojson"

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
RAIL_DEDUPE_PIXEL_GRID = 2.0
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
TRANSREGIONAL_EUROPE_SHOWCASE_TAGS = {"TUR"}
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
    if path.name in {"runtime_topology.topo.json", "runtime_topology.topo.json.gz"}:
        payload = read_json_source(path)
        if not isinstance(payload, dict):
            raise ValueError(f"Expected JSON object in {path}")
        return payload
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
    collection = topology_object_to_geojson(payload, object_name)
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


def polygon_path(
    geometry: BaseGeometry,
    canvas: Canvas,
    include_interiors: bool = False,
    canonical_ring_start: bool = False,
) -> list[str]:
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        rings = [ring_path(geometry.exterior.coords, canvas, canonical_start=canonical_ring_start)]
        if include_interiors:
            rings.extend(
                ring_path(interior.coords, canvas, canonical_start=canonical_ring_start)
                for interior in geometry.interiors
            )
        path = " ".join(ring for ring in rings if ring)
        return [path] if path else []
    if geometry.geom_type == "MultiPolygon":
        paths: list[str] = []
        for polygon in sorted(geometry.geoms, key=lambda item: item.area, reverse=True):
            paths.extend(polygon_path(polygon, canvas, include_interiors, canonical_ring_start))
        return [path for path in paths if path]
    if geometry.geom_type == "GeometryCollection":
        paths: list[str] = []
        for part in sorted(polygon_parts(geometry), key=lambda item: item.area, reverse=True):
            paths.extend(polygon_path(part, canvas, include_interiors, canonical_ring_start))
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


def polygon_exterior_paths(
    geometry: BaseGeometry, canvas: Canvas, canonical_ring_start: bool = False
) -> list[str]:
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        path = ring_path(geometry.exterior.coords, canvas, canonical_start=canonical_ring_start)
        return [path] if path else []
    if geometry.geom_type == "MultiPolygon":
        paths: list[str] = []
        for polygon in sorted(geometry.geoms, key=lambda item: item.area, reverse=True):
            paths.extend(polygon_exterior_paths(polygon, canvas, canonical_ring_start))
        return [path for path in paths if path]
    if geometry.geom_type == "GeometryCollection":
        paths: list[str] = []
        for part in geometry.geoms:
            paths.extend(polygon_exterior_paths(part, canvas, canonical_ring_start))
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


def ring_path(
    points: Iterable[tuple[float, float]], canvas: Canvas, canonical_start: bool = False
) -> str:
    projected = [
        (fmt(x), fmt(y))
        for lon, lat, *_ in points
        for x, y in [canvas.project(float(lon), float(lat))]
    ]
    # Vertices closer than the output precision collapse to one point. Which of
    # them survive simplification differs across platforms' floating point.
    projected = [vertex for index, vertex in enumerate(projected) if index == 0 or vertex != projected[index - 1]]
    if len(projected) < 3:
        return ""
    if canonical_start and projected[0] == projected[-1]:
        projected.pop()
        # GEOS may choose a different first vertex for the same closed ring.
        # Compare the complete rotation when rounded projected vertices tie.
        first_vertex = min(projected, key=lambda xy: (float(xy[0]), float(xy[1])))
        start = min(
            (index for index, vertex in enumerate(projected) if vertex == first_vertex),
            key=lambda index: projected[index:] + projected[:index],
        )
        projected = projected[start:] + projected[:start] + [projected[start]]
    commands = [f"M{projected[0][0]} {projected[0][1]}"]
    commands.extend(f"L{x} {y}" for x, y in projected[1:])
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
    coastline_paths = polygon_exterior_paths(
        renderable_geometry(unary_union(clipped_geometries)), canvas, canonical_ring_start=True
    )
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
        selected_paths.extend(
            (clipped.area, path)
            for path in polygon_path(clipped, canvas, include_interiors=True, canonical_ring_start=True)
        )
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


def build_landing_assets() -> None:
    build_hero_scenario_maps()


if __name__ == "__main__":
    build_landing_assets()
