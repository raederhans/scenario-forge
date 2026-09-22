from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from xml.sax.saxutils import escape as xml_escape

from shapely.geometry import box, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union
from shapely.validation import make_valid
from topojson.utils import serialize_as_geojson


REPO_ROOT = Path(__file__).resolve().parents[1]
LANDING_ASSETS = REPO_ROOT / "landing" / "assets"

TNO_DIR = REPO_ROOT / "data" / "scenarios" / "tno_1962"
HOI4_1936_DIR = REPO_ROOT / "data" / "scenarios" / "hoi4_1936"
HOI4_1939_DIR = REPO_ROOT / "data" / "scenarios" / "hoi4_1939"
JAPAN_TRANSPORT_DIR = REPO_ROOT / "data" / "transport_layers"

WORK_OUTPUTS = {
    "alt_history": {
        "svg": LANDING_ASSETS / "work-alt-history-med.svg",
        "metadata": LANDING_ASSETS / "work-alt-history-med.json",
        "width": 1120,
        "height": 720,
        "bbox": (-10.5, 30.0, 38.5, 47.8),
    },
    "scenario_switch": {
        "svg": LANDING_ASSETS / "work-scenario-switch-europe.svg",
        "metadata": LANDING_ASSETS / "work-scenario-switch-europe.json",
        "width": 680,
        "height": 440,
        "bbox": (7.0, 44.0, 33.0, 57.5),
    },
    "japan_corridor": {
        "svg": LANDING_ASSETS / "work-atlas-japan-corridor.svg",
        "metadata": LANDING_ASSETS / "work-atlas-japan-corridor.json",
        "width": 680,
        "height": 440,
        "bbox": (134.1, 33.2, 141.5, 36.8),
    },
}


PALETTE = {
    "sea": "#dceceb",
    "deep_sea": "#c5dedf",
    "paper": "#d8d2bd",
    "coast": "#e7ddbf",
    "salt": "#d8c48e",
    "shoal": "#9fb7a1",
    "water": "#2e6f83",
    "border": "#132332",
    "ink": "#f7ead0",
    "orange": "#d98a43",
    "rail": "#f0c95e",
    "road": "#e96d46",
    "city": "#fff0a6",
}

COUNTRY_FALLBACKS = {
    "GER": "#6b6a60",
    "POL": "#b85b55",
    "CZE": "#7c9cb0",
    "SOV": "#7f2d2a",
    "ROM": "#d29b44",
    "HUN": "#6c8e5a",
    "FRA": "#4066d3",
    "ITA": "#3f8f65",
    "ENG": "#9d6257",
    "YUG": "#8a6fa8",
    "RKU": "#7e7763",
    "RKM": "#8c8061",
    "IBR": "#c0a15c",
    "BRG": "#403b44",
    "ATL": "#d8c48e",
}


@dataclass(frozen=True)
class Canvas:
    width: int
    height: int
    bbox: tuple[float, float, float, float]
    padding: int = 30

    def project(self, lon: float, lat: float) -> tuple[float, float]:
        min_lon, min_lat, max_lon, max_lat = self.bbox
        usable_width = self.width - self.padding * 2
        usable_height = self.height - self.padding * 2
        # Regional Mercator: one scale on both axes preserves local angles.
        # Fit the entire requested extent, centering any spare canvas space.
        def northing(latitude: float) -> float:
            return math.degrees(math.log(math.tan(math.pi / 4 + math.radians(latitude) / 2)))

        south, north = northing(min_lat), northing(max_lat)
        scale = min(usable_width / (max_lon - min_lon), usable_height / (north - south))
        x = self.width / 2 + (lon - (min_lon + max_lon) / 2) * scale
        y = self.height / 2 - (northing(lat) - (south + north) / 2) * scale
        return x, y


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


def topology_features(path: Path, object_name: str) -> list[dict]:
    collection = serialize_as_geojson(read_json(path), objectname=object_name)
    features = collection.get("features") if isinstance(collection, dict) else None
    return [feature for feature in features or [] if isinstance(feature, dict)]


def geojson_features(path: Path) -> list[dict]:
    features = read_json(path).get("features")
    return [feature for feature in features or [] if isinstance(feature, dict)]


def safe_geometry(feature: dict) -> BaseGeometry | None:
    geometry = feature.get("geometry")
    if not geometry:
        return None
    try:
        return make_valid(shape(geometry))
    except Exception:
        return None


def feature_id(feature: dict) -> str:
    props = feature.get("properties") or {}
    return str(feature.get("id") or props.get("id") or props.get("feature_id") or "")


def feature_tag(feature: dict, owners: dict[str, str] | None = None) -> str:
    props = feature.get("properties") or {}
    fid = feature_id(feature)
    return str((owners or {}).get(fid) or props.get("cntr_code") or props.get("tag") or "UNK").upper()


def color_for_tag(tag: str, countries: dict[str, dict] | None = None) -> str:
    country = (countries or {}).get(tag)
    if isinstance(country, dict) and isinstance(country.get("color_hex"), str):
        return country["color_hex"]
    if tag in COUNTRY_FALLBACKS:
        return COUNTRY_FALLBACKS[tag]
    digest = hashlib.sha1(tag.encode("utf-8")).hexdigest()
    hue = int(digest[:2], 16)
    return f"#{90 + hue % 105:02x}{92 + int(digest[2:4], 16) % 95:02x}{86 + int(digest[4:6], 16) % 95:02x}"


def fmt(value: float) -> str:
    return f"{value:.1f}".rstrip("0").rstrip(".")


def ring_path(coords: Iterable[tuple[float, float]], canvas: Canvas, stride: int = 1) -> str:
    points: list[tuple[float, float]] = []
    for index, point in enumerate(coords):
        if index % stride:
            continue
        x, y = canvas.project(float(point[0]), float(point[1]))
        if -canvas.width * 0.2 <= x <= canvas.width * 1.2 and -canvas.height * 0.2 <= y <= canvas.height * 1.2:
            points.append((x, y))
    if len(points) < 3:
        return ""
    commands = [f"M{fmt(points[0][0])} {fmt(points[0][1])}"]
    commands.extend(f"L{fmt(x)} {fmt(y)}" for x, y in points[1:])
    commands.append("Z")
    return " ".join(commands)


def line_path(coords: Iterable[tuple[float, float]], canvas: Canvas, stride: int = 1) -> str:
    points: list[tuple[float, float]] = []
    for index, point in enumerate(coords):
        if index % stride:
            continue
        x, y = canvas.project(float(point[0]), float(point[1]))
        if -canvas.width * 0.2 <= x <= canvas.width * 1.2 and -canvas.height * 0.2 <= y <= canvas.height * 1.2:
            points.append((x, y))
    if len(points) < 2:
        return ""
    commands = [f"M{fmt(points[0][0])} {fmt(points[0][1])}"]
    commands.extend(f"L{fmt(x)} {fmt(y)}" for x, y in points[1:])
    return " ".join(commands)


def polygon_paths(geometry: BaseGeometry, canvas: Canvas, stride: int = 1, *, include_interiors: bool = True) -> list[str]:
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        path = ring_path(geometry.exterior.coords, canvas, stride)
        if include_interiors:
            path += "".join(" " + ring_path(ring.coords, canvas, stride) for ring in geometry.interiors)
        return [path] if path else []
    if geometry.geom_type == "MultiPolygon":
        paths: list[str] = []
        for part in geometry.geoms:
            paths.extend(polygon_paths(part, canvas, stride, include_interiors=include_interiors))
        return paths
    if hasattr(geometry, "geoms"):
        paths: list[str] = []
        for part in geometry.geoms:
            paths.extend(polygon_paths(part, canvas, stride, include_interiors=include_interiors))
        return paths
    return []


def line_paths(geometry: BaseGeometry, canvas: Canvas, stride: int = 1) -> list[str]:
    if geometry.is_empty:
        return []
    if geometry.geom_type == "LineString":
        path = line_path(geometry.coords, canvas, stride)
        return [path] if path else []
    if geometry.geom_type == "MultiLineString":
        paths: list[str] = []
        for part in geometry.geoms:
            paths.extend(line_paths(part, canvas, stride))
        return paths
    if hasattr(geometry, "geoms"):
        paths: list[str] = []
        for part in geometry.geoms:
            paths.extend(line_paths(part, canvas, stride))
        return paths
    return []


def clipped_features(
    features: Iterable[dict],
    bbox_value: tuple[float, float, float, float],
    *,
    min_area: float = 0,
) -> list[tuple[dict, BaseGeometry]]:
    clip = box(*bbox_value)
    selected: list[tuple[dict, BaseGeometry]] = []
    for feature in features:
        geometry = safe_geometry(feature)
        if geometry is None or geometry.is_empty or not geometry.intersects(clip):
            continue
        clipped = make_valid(geometry.intersection(clip))
        if clipped.is_empty:
            continue
        if min_area and clipped.area < min_area:
            continue
        selected.append((feature, clipped))
    return selected


def bounds_intersect(left: Iterable[float], right: tuple[float, float, float, float]) -> bool:
    left_min_lon, left_min_lat, left_max_lon, left_max_lat = [float(value) for value in left]
    right_min_lon, right_min_lat, right_max_lon, right_max_lat = right
    return not (
        left_max_lon < right_min_lon
        or left_min_lon > right_max_lon
        or left_max_lat < right_min_lat
        or left_min_lat > right_max_lat
    )


def tno_political_detail_chunk_paths(bbox_value: tuple[float, float, float, float]) -> list[Path]:
    manifest = read_json(TNO_DIR / "detail_chunks.manifest.json")
    paths: list[Path] = []
    for chunk in manifest.get("chunks") or []:
        if not isinstance(chunk, dict):
            continue
        chunk_id = str(chunk.get("id") or "")
        if not chunk_id.startswith("political.detail.country."):
            continue
        if chunk.get("lod") != "detail" or chunk.get("layer") != "political":
            continue
        bounds = chunk.get("bounds")
        url = chunk.get("url")
        if not isinstance(bounds, list) or len(bounds) != 4 or not isinstance(url, str):
            continue
        if not bounds_intersect(bounds, bbox_value):
            continue
        path = REPO_ROOT / url
        if path.exists():
            paths.append(path)
    return sorted(set(paths))


def dissolved_tno_countries(
    bbox_value: tuple[float, float, float, float],
    owners: dict[str, str],
) -> tuple[list[tuple[str, BaseGeometry]], list[Path], int]:
    groups: dict[str, list[BaseGeometry]] = {}
    seen_feature_ids: set[str] = set()
    source_paths = tno_political_detail_chunk_paths(bbox_value)
    for path in source_paths:
        for feature, geometry in clipped_features(geojson_features(path), bbox_value):
            fid = feature_id(feature)
            if fid and fid in seen_feature_ids:
                continue
            if fid:
                seen_feature_ids.add(fid)
            tag = feature_tag(feature, owners)
            groups.setdefault(tag, []).append(geometry)

    dissolved: list[tuple[str, BaseGeometry]] = []
    for tag, geometries in groups.items():
        merged = make_valid(unary_union(geometries))
        if not merged.is_empty:
            dissolved.append((tag, merged))
    dissolved.sort(key=lambda item: item[1].area, reverse=True)
    return dissolved, source_paths, len(seen_feature_ids)


def dissolve_by_property(
    features: Iterable[tuple[dict, BaseGeometry]],
    property_name: str,
) -> list[tuple[str, BaseGeometry]]:
    groups: dict[str, list[BaseGeometry]] = {}
    for feature, geometry in features:
        props = feature.get("properties") or {}
        key = str(props.get(property_name) or "default")
        groups.setdefault(key, []).append(geometry)

    dissolved: list[tuple[str, BaseGeometry]] = []
    for key, geometries in groups.items():
        merged = make_valid(unary_union(geometries))
        if not merged.is_empty:
            dissolved.append((key, merged))
    dissolved.sort(key=lambda item: item[1].area, reverse=True)
    return dissolved


def svg_shell(width: int, height: int, title: str, body: str, defs: str = "") -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-label="{xml_escape(title)}">
  <defs>
    <linearGradient id="seaGradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{PALETTE['deep_sea']}"/><stop offset="1" stop-color="{PALETTE['sea']}"/></linearGradient>
    <filter id="softGlow"><feGaussianBlur stdDeviation="6" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
{defs}
  </defs>
  <rect width="{width}" height="{height}" fill="url(#seaGradient)" />
  <style>text{{font-family:Arial,sans-serif;fill:#243f49}}path{{fill-rule:evenodd}}</style>
{body}
</svg>
"""


def graticule(canvas: Canvas, step: int = 4) -> str:
    min_lon, min_lat, max_lon, max_lat = canvas.bbox
    lines: list[str] = []
    lon = math.floor(min_lon / step) * step
    while lon <= max_lon:
        x1, y1 = canvas.project(lon, min_lat)
        x2, y2 = canvas.project(lon, max_lat)
        lines.append(f'<path d="M{fmt(x1)} {fmt(y1)} L{fmt(x2)} {fmt(y2)}" />')
        lon += step
    lat = math.floor(min_lat / step) * step
    while lat <= max_lat:
        x1, y1 = canvas.project(min_lon, lat)
        x2, y2 = canvas.project(max_lon, lat)
        lines.append(f'<path d="M{fmt(x1)} {fmt(y1)} L{fmt(x2)} {fmt(y2)}" />')
        lat += step
    return "\n".join(lines)


def build_alt_history_med() -> None:
    output = WORK_OUTPUTS["alt_history"]
    canvas = Canvas(output["width"], output["height"], output["bbox"], padding=34)
    bbox_value = output["bbox"]
    countries = read_json(TNO_DIR / "countries.json").get("countries", {})
    owners = read_json(TNO_DIR / "owners.by_feature.json").get("owners", {})
    dissolved_countries, political_sources, political_source_features = dissolved_tno_countries(bbox_value, owners)
    atlantropa = clipped_features(topology_features(TNO_DIR / "scenario_atlantropa.topo.json", "scenario_atlantropa"), bbox_value)

    source_atlantropa_features = len(atlantropa)
    atlantropa = sorted(atlantropa, key=lambda item: item[1].area, reverse=True)
    atlantropa_layers = dissolve_by_property(atlantropa, "atl_render_layer")

    nodes: list[str] = [
        '  <g class="graticule" fill="none" stroke="#6aa1b2" stroke-width=".8" opacity=".18">',
        graticule(canvas, step=5),
        "  </g>",
    ]

    nodes.append('  <g class="political-countries" stroke-linejoin="round">')
    for tag, geometry in dissolved_countries:
        color = color_for_tag(tag, countries)
        for path in polygon_paths(geometry, canvas, stride=1):
            nodes.append(f'    <path d="{path}" fill="{color}" />')
        # Preserve source holes as water/gaps without making every tiny inland
        # ring a bright country border at card resolution.
        for path in polygon_paths(geometry, canvas, include_interiors=False):
            nodes.append(f'    <path d="{path}" fill="none" stroke="#f7f4e9" stroke-width=".8" />')
    nodes.append("  </g>")

    nodes.append('  <g class="atlantropa-land" stroke-linejoin="round">')
    for layer, geometry in atlantropa_layers:
        if layer == "water":
            continue
        fill = PALETTE["salt"] if layer == "land" else PALETTE["shoal"] if layer == "shoal" else PALETTE["water"]
        opacity = ".96" if layer == "land" else ".76"
        stroke = "#e7ddbf" if layer == "land" else "#b8cba6" if layer == "shoal" else "none"
        stroke_width = ".8" if layer == "land" else ".55" if layer == "shoal" else "0"
        for path in polygon_paths(geometry, canvas, stride=1):
            nodes.append(
                f'    <path d="{path}" fill="{fill}" stroke="{stroke}" stroke-width="{stroke_width}" opacity="{opacity}" />'
            )
    nodes.append("  </g>")

    nodes.extend([
        '<text x="40" y="48" font-size="15" letter-spacing="2.5">SCENARIO STUDY / 1962</text>',
        '<text x="40" y="82" font-size="29" font-weight="600">An altered Mediterranean</text>',
        '<text x="40" y="680" font-size="14">TNO / ATLANTROPA</text>',
        '<text x="1080" y="680" text-anchor="end" font-size="13">Scenario land reclamation / owner boundaries</text>',
    ])
    svg = svg_shell(output["width"], output["height"], "TNO Atlantropa Mediterranean local work map", "\n".join(nodes))
    write_text_lf(output["svg"], svg)
    write_metadata(
        output["metadata"],
        "work_alt_history_med",
        "TNO 1962 Atlantropa Mediterranean",
        bbox_value,
        [
            TNO_DIR / "detail_chunks.manifest.json",
            *political_sources,
            TNO_DIR / "scenario_atlantropa.topo.json",
            TNO_DIR / "owners.by_feature.json",
            TNO_DIR / "countries.json",
        ],
        {
            "political_source_features": political_source_features,
            "dissolved_country_owners": len(dissolved_countries),
            "political_detail_chunks": len(political_sources),
            "source_atlantropa_features": source_atlantropa_features,
            "rendered_atlantropa_features": len(atlantropa),
            "rendered_atlantropa_layers": len([layer for layer, _geometry in atlantropa_layers if layer != "water"]),
        },
        "Full Mediterranean bbox rendered from TNO detail political chunks dissolved by owner, with Atlantropa land and shoal layers dissolved to avoid internal block boundaries.",
    )


def polygon_boundary(geometry: BaseGeometry) -> BaseGeometry:
    if geometry.geom_type in {"Polygon", "MultiPolygon"}:
        return geometry.boundary
    return unary_union([polygon_boundary(part) for part in getattr(geometry, "geoms", [])])


def scenario_panel(
    scenario_dir: Path,
    canvas: Canvas,
    bbox_value: tuple[float, float, float, float],
    panel_x: int,
    title: str,
) -> tuple[list[str], dict[str, int]]:
    countries = read_json(scenario_dir / "countries.json").get("countries", {})
    owners = read_json(scenario_dir / "owners.by_feature.json").get("owners", {})
    features = clipped_features(topology_features(scenario_dir / "runtime_topology.topo.json", "political"), bbox_value)
    groups: dict[str, list[BaseGeometry]] = {}
    for feature, geometry in features:
        groups.setdefault(feature_tag(feature, owners), []).append(geometry)
    panel_nodes = [
        f'  <g transform="translate({panel_x} 0)">',
        f'    <rect x="20" y="58" width="300" height="354" rx="8" fill="#eef3ed" stroke="#a6c0c1" />',
        f'    <g clip-path="url(#clip-{title.lower().replace(" ", "-")})">',
        f'      <rect x="20" y="96" width="300" height="316" fill="#d3e5e4" />',
        '      <g transform="translate(20 96)">',
    ]
    local_canvas = Canvas(300, 316, bbox_value, padding=8)
    labels: list[str] = []
    country_geometries: list[BaseGeometry] = []
    for tag, parts in sorted(groups.items()):
        geometry = make_valid(unary_union(parts))
        country_geometries.append(geometry)
        fill = color_for_tag(tag, countries)
        for path in polygon_paths(geometry, local_canvas):
            panel_nodes.append(f'        <path data-owner="{tag}" d="{path}" fill="{fill}" />')
        if tag in {"GER", "POL", "ROM", "SOV"}:
            largest = max(geometry.geoms, key=lambda part: part.area) if geometry.geom_type == "MultiPolygon" else geometry
            point = largest.representative_point()
            x, y = local_canvas.project(point.x, point.y)
            name = {"GER": "Germany", "POL": "Poland", "ROM": "Romania", "SOV": "USSR"}[tag]
            labels.append(f'<text x="{fmt(x)}" y="{fmt(y)}" text-anchor="middle" font-size="10" font-weight="600" stroke="#f7f4e9" stroke-width="2" paint-order="stroke">{name}</text>')
    # Only actual shared country edges are political borders. Tiny gaps in the
    # source remain untouched but must not acquire an oversized white outline.
    for index, left in enumerate(country_geometries):
        for right in country_geometries[index + 1:]:
            if not left.intersects(right):
                continue
            boundary = polygon_boundary(left).intersection(polygon_boundary(right))
            for path in line_paths(boundary, local_canvas):
                panel_nodes.append(f'<path d="{path}" fill="none" stroke="#f8f5e9" stroke-width=".65" />')
    panel_nodes.extend(labels)
    panel_nodes.extend(
        [
            "      </g>",
            "    </g>",
            f'    <text x="36" y="83" font-size="18" font-weight="600">{xml_escape(title)}</text>',
            "  </g>",
        ]
    )
    return panel_nodes, {"political_features": len(features)}


def build_scenario_switch_europe() -> None:
    output = WORK_OUTPUTS["scenario_switch"]
    bbox_value = output["bbox"]
    defs = """
    <clipPath id="clip-hoi4-1936"><rect x="20" y="28" width="300" height="384" rx="14"/></clipPath>
    <clipPath id="clip-hoi4-1939"><rect x="20" y="28" width="300" height="384" rx="14"/></clipPath>
"""
    canvas = Canvas(output["width"], output["height"], bbox_value)
    left_nodes, left_counts = scenario_panel(HOI4_1936_DIR, canvas, bbox_value, 0, "HOI4 1936")
    right_nodes, right_counts = scenario_panel(HOI4_1939_DIR, canvas, bbox_value, 340, "HOI4 1939")
    nodes = [
        '  <g class="comparison-grid" fill="none" stroke="#6aa1b2" stroke-width=".7" opacity=".18">',
        graticule(canvas, step=5),
        "  </g>",
        *left_nodes,
        *right_nodes,
        '  <text x="22" y="34" font-size="14" font-weight="600" letter-spacing="1.5">CENTRAL EUROPE / TWO STARTING POINTS</text>',
    ]
    svg = svg_shell(output["width"], output["height"], "HOI4 1936 and 1939 Central Europe scenario switch map", "\n".join(nodes), defs=defs)
    write_text_lf(output["svg"], svg)
    write_metadata(
        output["metadata"],
        "work_scenario_switch_europe",
        "HOI4 Central Europe Scenario Switch",
        bbox_value,
        [
            HOI4_1936_DIR / "runtime_topology.topo.json",
            HOI4_1936_DIR / "owners.by_feature.json",
            HOI4_1936_DIR / "countries.json",
            HOI4_1939_DIR / "runtime_topology.topo.json",
            HOI4_1939_DIR / "owners.by_feature.json",
            HOI4_1939_DIR / "countries.json",
        ],
        {
            "hoi4_1936_political_features": left_counts["political_features"],
            "hoi4_1939_political_features": right_counts["political_features"],
        },
        "Same Central/Eastern Europe bbox rendered from 1936 and 1939 scenario ownership.",
    )


def build_japan_corridor() -> None:
    output = WORK_OUTPUTS["japan_corridor"]
    bbox_value = output["bbox"]
    canvas = Canvas(output["width"], output["height"], bbox_value, padding=42)
    roads = clipped_features(topology_features(JAPAN_TRANSPORT_DIR / "japan_road" / "roads.preview.topo.json", "roads"), bbox_value)
    rail = clipped_features(topology_features(JAPAN_TRANSPORT_DIR / "japan_rail" / "railways.preview.topo.json", "railways"), bbox_value)
    stations = clipped_features(geojson_features(JAPAN_TRANSPORT_DIR / "japan_rail" / "rail_stations_major.preview.geojson"), bbox_value)
    contours = clipped_features(topology_features(REPO_ROOT / "data" / "global_contours.major.topo.json", "contours"), bbox_value)
    rivers = clipped_features(geojson_features(REPO_ROOT / "data" / "global_rivers.geojson"), bbox_value)
    cities = clipped_features(geojson_features(REPO_ROOT / "data" / "world_cities.geojson"), bbox_value)

    roads = sorted(roads, key=lambda item: item[1].length, reverse=True)[:95]
    rail = sorted(rail, key=lambda item: item[1].length, reverse=True)[:70]
    contours = sorted(contours, key=lambda item: item[1].length, reverse=True)[:20]
    rivers = sorted(rivers, key=lambda item: item[1].length, reverse=True)[:12]
    cities = sorted(cities, key=lambda item: (item[0].get("properties") or {}).get("population", 0), reverse=True)[:24]
    stations = sorted(stations, key=lambda item: (item[0].get("properties") or {}).get("rank", 0), reverse=True)[:18]

    carrier_path = JAPAN_TRANSPORT_DIR / "japan_corridor" / "carrier.json"
    carrier = read_json(carrier_path)
    land = make_valid(shape(carrier["frames"]["main"]["fitGeometry"])).intersection(box(*bbox_value))
    nodes: list[str] = ['<g class="land" fill="#f3efdf" stroke="#96aaa0" stroke-width=".8">']
    for path in polygon_paths(land, canvas):
        nodes.append(f'<path d="{path}" />')
    nodes.extend([
        '</g>',
        '  <g class="terrain" fill="none" stroke="#91a184" stroke-width=".55" opacity=".3">',
    ])
    for _feature, geometry in contours:
        for path in line_paths(geometry, canvas):
            nodes.append(f'    <path d="{path}" />')
    nodes.append("  </g>")
    nodes.append('  <g class="rivers" fill="none" stroke="#7bbfd7" stroke-width="1.1" opacity=".58">')
    for _feature, geometry in rivers:
        for path in line_paths(geometry, canvas):
            nodes.append(f'    <path d="{path}" />')
    nodes.append("  </g>")
    nodes.append('  <g class="roads" fill="none" stroke="#ce9173" stroke-width=".85" opacity=".7">')
    for _feature, geometry in roads:
        for path in line_paths(geometry, canvas):
            nodes.append(f'    <path d="{path}" />')
    nodes.append("  </g>")
    nodes.append('  <g class="rail" fill="none" stroke="#386c74" stroke-width="1.25" opacity=".9">')
    for _feature, geometry in rail:
        for path in line_paths(geometry, canvas):
            nodes.append(f'    <path d="{path}" />')
    nodes.append("  </g>")
    nodes.append('  <g class="urban-anchors" fill="#ca6e49" stroke="#fffcf0" stroke-width="1">')
    for feature, geometry in cities[:18]:
        point = geometry.representative_point()
        x, y = canvas.project(point.x, point.y)
        population = (feature.get("properties") or {}).get("population", 0) or 0
        radius = 1.8 + min(2.2, math.sqrt(float(population)) / 2000)
        nodes.append(f'    <circle cx="{fmt(x)}" cy="{fmt(y)}" r="{fmt(radius)}" />')
    nodes.append("  </g>")
    nodes.append('  <g class="stations" fill="#f8fafc" stroke="#143047" stroke-width="1">')
    for _feature, geometry in stations:
        point = geometry.representative_point()
        x, y = canvas.project(point.x, point.y)
        nodes.append(f'    <circle cx="{fmt(x)}" cy="{fmt(y)}" r="1.8" />')
    nodes.append("  </g>")
    for name, lon, lat, dx, dy in [
        ("Osaka", 135.5023, 34.6937, -14, 22),
        ("Nagoya", 136.9066, 35.1815, -18, -12),
        ("Tokyo", 139.6917, 35.6895, 12, 0),
    ]:
        x, y = canvas.project(lon, lat)
        nodes.append(f'<text x="{fmt(x + dx)}" y="{fmt(y + dy)}" font-size="13" font-weight="600" stroke="#f5f2e6" stroke-width="3" paint-order="stroke">{name}</text>')
    nodes.extend([
        '<text x="28" y="32" font-size="14" font-weight="600" letter-spacing="1.2">CENTRAL JAPAN TRANSPORT ATLAS</text>',
        '<text x="28" y="412" font-size="12">Roads / railways / stations / cities</text>',
        '<text x="645" y="370" text-anchor="end" font-size="13" letter-spacing="2" opacity=".6">PACIFIC OCEAN</text>',
        '<path d="M440 408h24" stroke="#ce9173" stroke-width="2"/><text x="470" y="412" font-size="11">Road</text>',
        '<path d="M538 408h24" stroke="#386c74" stroke-width="2"/><text x="568" y="412" font-size="11">Rail</text>',
    ])
    svg = svg_shell(output["width"], output["height"], "Central Japan local transport atlas with roads rail stations cities and terrain", "\n".join(nodes))
    write_text_lf(output["svg"], svg)
    write_metadata(
        output["metadata"],
        "work_atlas_japan_corridor",
        "Central Japan Local Transport Atlas",
        bbox_value,
        [
            carrier_path,
            JAPAN_TRANSPORT_DIR / "japan_road" / "roads.preview.topo.json",
            JAPAN_TRANSPORT_DIR / "japan_rail" / "railways.preview.topo.json",
            JAPAN_TRANSPORT_DIR / "japan_rail" / "rail_stations_major.preview.geojson",
            REPO_ROOT / "data" / "global_contours.major.topo.json",
            REPO_ROOT / "data" / "global_rivers.geojson",
            REPO_ROOT / "data" / "world_cities.geojson",
        ],
        {
            "road_lines": len(roads),
            "rail_lines": len(rail),
            "major_stations": len(stations),
            "urban_anchor_points": len(cities[:18]),
            "city_points": len(cities),
            "terrain_lines": len(contours),
            "river_lines": len(rivers),
        },
        "Central Japan local bbox combining real roads, railways, stations, terrain, rivers, and population-ranked city anchors; no singled-out corridor geometry.",
    )


def write_metadata(
    path: Path,
    asset_id: str,
    title: str,
    bbox_value: tuple[float, float, float, float],
    sources: list[Path],
    counts: dict[str, int],
    selection_note: str,
) -> None:
    metadata = {
        "schema_version": 1,
        "asset_type": "landing_work_card_map",
        "asset_id": asset_id,
        "title": title,
        "scope": {
            "bbox": list(bbox_value),
            "projection": "regional_mercator_uniform_fit",
        },
        "sources": [repo_path(source) for source in sources],
        "counts": counts,
        "selection_policy": {
            "note": selection_note,
            "ranking": "intersect bbox, clip, sort by area or length, keep top visible features",
        },
    }
    write_text_lf(path, json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")


def main() -> None:
    LANDING_ASSETS.mkdir(parents=True, exist_ok=True)
    build_alt_history_med()
    build_scenario_switch_europe()
    build_japan_corridor()
    print("[build_landing_work_maps] wrote 3 SVG assets and metadata files")


if __name__ == "__main__":
    main()
