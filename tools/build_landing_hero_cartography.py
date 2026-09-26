from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tools.scenario_topology_decode import topology_object_to_geojson

LANDING_ASSETS = REPO_ROOT / "landing" / "assets"
EUROPE_TOPOLOGY = REPO_ROOT / "data" / "europe_topology.json"

EUROPE_BBOX = (-12.5, 34.0, 41.5, 72.5)


def write_svg(path: Path, svg: str) -> None:
    path.write_bytes(svg.replace("\r\n", "\n").encode("utf-8"))


@dataclass(frozen=True)
class Canvas:
    width: int
    height: int
    bbox: tuple[float, float, float, float]

    def project(self, lon: float, lat: float) -> tuple[float, float]:
        min_lon, min_lat, max_lon, max_lat = self.bbox
        x = (lon - min_lon) / (max_lon - min_lon) * self.width
        y = (max_lat - lat) / (max_lat - min_lat) * self.height
        return x, y


def read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return payload


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
    return features if isinstance(features, list) else []


def fmt(value: float) -> str:
    return f"{value:.1f}".rstrip("0").rstrip(".")


def ring_to_path(points: Iterable[tuple[float, float]], canvas: Canvas, stride: int = 2) -> str:
    projected: list[tuple[float, float]] = []
    for index, point in enumerate(points):
        if index % stride != 0:
            continue
        x, y = canvas.project(float(point[0]), float(point[1]))
        if -canvas.width * 0.1 <= x <= canvas.width * 1.1 and -canvas.height * 0.1 <= y <= canvas.height * 1.1:
            projected.append((x, y))
    if len(projected) < 3:
        return ""
    commands = [f"M{fmt(projected[0][0])} {fmt(projected[0][1])}"]
    commands.extend(f"L{fmt(x)} {fmt(y)}" for x, y in projected[1:])
    commands.append("Z")
    return " ".join(commands)


def line_to_path(points: Iterable[tuple[float, float]], canvas: Canvas, stride: int = 4) -> str:
    projected: list[tuple[float, float]] = []
    for index, point in enumerate(points):
        if index % stride != 0:
            continue
        x, y = canvas.project(float(point[0]), float(point[1]))
        if -canvas.width * 0.15 <= x <= canvas.width * 1.15 and -canvas.height * 0.15 <= y <= canvas.height * 1.15:
            projected.append((x, y))
    if len(projected) < 2:
        return ""
    commands = [f"M{fmt(projected[0][0])} {fmt(projected[0][1])}"]
    commands.extend(f"L{fmt(x)} {fmt(y)}" for x, y in projected[1:])
    return " ".join(commands)


def polygon_paths(geometry: BaseGeometry, canvas: Canvas, stride: int = 3) -> list[str]:
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [path for path in [ring_to_path(geometry.exterior.coords, canvas, stride)] if path]
    if geometry.geom_type == "MultiPolygon":
        paths: list[str] = []
        for polygon in geometry.geoms:
            paths.extend(polygon_paths(polygon, canvas, stride))
        return paths
    return []


def line_paths(geometry: BaseGeometry, canvas: Canvas, stride: int = 8) -> list[str]:
    if geometry.is_empty:
        return []
    if geometry.geom_type == "LineString":
        return [path for path in [line_to_path(geometry.coords, canvas, stride)] if path]
    if geometry.geom_type == "MultiLineString":
        paths: list[str] = []
        for line in geometry.geoms:
            paths.extend(line_paths(line, canvas, stride))
        return paths
    return []


def svg_path_elements(paths: Iterable[str], class_name: str, limit: int | None = None) -> str:
    selected = list(paths)
    if limit is not None:
        selected = selected[:limit]
    return "\n".join(f'      <path class="{class_name}" d="{path}" />' for path in selected)


def graticule(canvas: Canvas) -> str:
    min_lon, min_lat, max_lon, max_lat = canvas.bbox
    lines: list[str] = []
    lon = int(min_lon // 10 * 10)
    while lon <= max_lon:
        x1, y1 = canvas.project(lon, min_lat)
        x2, y2 = canvas.project(lon, max_lat)
        lines.append(f'<path class="graticule" d="M{fmt(x1)} {fmt(y1)} L{fmt(x2)} {fmt(y2)}" />')
        lon += 10
    lat = int(min_lat // 10 * 10)
    while lat <= max_lat:
        x1, y1 = canvas.project(min_lon, lat)
        x2, y2 = canvas.project(max_lon, lat)
        lines.append(f'<path class="graticule" d="M{fmt(x1)} {fmt(y1)} L{fmt(x2)} {fmt(y2)}" />')
        lat += 10
    return "\n      ".join(lines)


def europe_political_paths(canvas: Canvas, stride: int = 3) -> list[tuple[str, str]]:
    paths: list[tuple[str, str]] = []
    for feature in topology_features(EUROPE_TOPOLOGY, "political"):
        geometry_payload = feature.get("geometry")
        if not geometry_payload:
            continue
        geometry = shape(geometry_payload).intersection(shape_bbox(canvas.bbox))
        code = str(feature.get("properties", {}).get("cntr_code") or feature.get("id") or "region").lower()
        for path in polygon_paths(geometry, canvas, stride):
            paths.append((code, path))
    return paths


def shape_bbox(bbox: tuple[float, float, float, float]) -> BaseGeometry:
    from shapely.geometry import box

    return box(*bbox)


def build_hero_asset() -> None:
    canvas = Canvas(980, 680, EUROPE_BBOX)
    political = europe_political_paths(canvas, stride=3)
    labels = {
        "fr": (-1.2, 46.4, "FR"),
        "de": (10.4, 51.0, "DE"),
        "it": (12.5, 42.5, "IT"),
        "pl": (19.1, 52.0, "PL"),
        "tr": (32.6, 39.0, "TR"),
        "ua": (30.5, 49.0, "UA"),
        "es": (-3.7, 40.2, "ES"),
        "se": (15.0, 61.0, "SE"),
    }
    territory = "\n".join(
        # 首页首屏 hero 只需要稳定抽样；完整政治拓扑继续留给编辑器运行时。
        f'      <path class="territory territory--{code[:2]}" d="{path}" />' for code, path in political[:260]
    )
    label_nodes = []
    for lon, lat, text in labels.values():
        x, y = canvas.project(lon, lat)
        label_nodes.append(f'<text x="{fmt(x)}" y="{fmt(y)}">{text}</text>')
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {canvas.width} {canvas.height}" role="img" aria-label="Generated Scenario Forge political map preview">
  <defs>
    <linearGradient id="sea" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#0b1726"/><stop offset="1" stop-color="#12373a"/></linearGradient>
    <linearGradient id="paper" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#f7edd7"/><stop offset="1" stop-color="#6dd3bd"/></linearGradient>
    <filter id="softGlow"><feGaussianBlur stdDeviation="9" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="{canvas.width}" height="{canvas.height}" rx="36" fill="url(#sea)" />
  <g opacity=".24">
      {graticule(canvas)}
  </g>
  <g class="territories" fill="url(#paper)" stroke="#122238" stroke-width=".9">
{territory}
  </g>
  <g class="route-lines" fill="none" stroke-linecap="round">
    <path d="M138 485 C260 378 390 322 550 250 C650 206 740 154 864 98" />
    <path d="M238 438 C348 356 474 308 610 292 C718 280 804 236 898 174" />
    <path d="M262 214 C398 252 522 260 652 198 C738 158 814 150 902 118" />
  </g>
  <g class="city-glows" filter="url(#softGlow)">
    <circle cx="362" cy="383" r="9" /><circle cx="418" cy="303" r="8" /><circle cx="510" cy="323" r="7" />
    <circle cx="585" cy="252" r="8" /><circle cx="695" cy="272" r="7" /><circle cx="760" cy="198" r="6" />
  </g>
  <g class="labels">{''.join(label_nodes)}</g>
</svg>
"""
    write_svg(LANDING_ASSETS / "hero-cartography.svg", svg)


def build_template_assets() -> None:
    canvas = Canvas(560, 360, EUROPE_BBOX)
    # 模板缩略图共用同一批真实路径，只换 palette，避免各模板的地理范围互相漂移。
    political = europe_political_paths(canvas, stride=5)[:110]
    palettes = {
        "blank": ("#eff3ec", "#b7c3a7", "#48564c", "#faf8ef"),
        "modern": ("#d9eee7", "#46b6a8", "#223c46", "#f7f4df"),
        "hoi4": ("#efe3c8", "#b7854b", "#3b3328", "#f7efe0"),
        "tno": ("#171b20", "#e0bd78", "#687070", "#f2e8d4"),
        "showcase": ("#0b111c", "#5ed4bd", "#e5ae63", "#f7ead0"),
    }
    for name, (sea, fill, stroke, highlight) in palettes.items():
        paths = []
        for index, (_code, path) in enumerate(political):
            color = highlight if index % 9 == 0 else fill
            paths.append(f'  <path d="{path}" fill="{color}" stroke="{stroke}" stroke-width="1" />')
        label = name.upper() if name != "showcase" else "SCENARIO FORGE"
        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {canvas.width} {canvas.height}" role="img" aria-label="{label} scenario map">
  <rect width="{canvas.width}" height="{canvas.height}" rx="18" fill="{sea}" />
  <g opacity=".2">{graticule(canvas)}</g>
{chr(10).join(paths)}
  <path d="M72 272 C170 210 278 192 390 128 C450 94 496 78 526 54" fill="none" stroke="#f97316" stroke-width="4" stroke-linecap="round" opacity=".78" />
  <text x="28" y="326" fill="{highlight}" font-family="Arial, sans-serif" font-size="24" font-weight="800" letter-spacing="2">{label}</text>
</svg>
"""
        output_name = "showcase-final-map.svg" if name == "showcase" else f"template-{name}.svg"
        write_svg(LANDING_ASSETS / output_name, svg)


def main() -> None:
    LANDING_ASSETS.mkdir(parents=True, exist_ok=True)
    build_hero_asset()
    build_template_assets()


if __name__ == "__main__":
    main()
