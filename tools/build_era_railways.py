"""从 HOI4 地图源文件提取时代铁路与补给枢纽，生成剧本可选图层数据。

源数据（不入库）：HOI4 安装目录下 map/ 中的 provinces.bmp、definition.csv、
unitstacks.txt、railways.txt、supply_nodes.txt。只提取线路走向、等级与枢纽位置
这类事实信息，不复制任何美术资产。

配准思路：
- HOI4 原版地图横向是等距经度（x 与经度线性），纵向有手绘形变，没有解析公式。
- 控制点取剧本战略值里"胜利点省份 → 已匹配城市经纬度"的高置信度记录，省份像素位置用
  unitstacks.txt 中类型 38 的省份锚点（胜利点/城市标记所在处）。
- 用薄板样条把像素坐标映射到经纬度，迭代剔除名称误匹配造成的离群控制点。
- 胜利点省份直接使用真实城市坐标；落在海里的顶点吸附到最近的剧本陆地地块。

大改地图的模组（profile tno）：
- TNO 地图 5120×2560，x 同样与经度线性，纬度是 y 的一维单调函数；省份 ID 大多沿用原版。
- 与原版共用 ID 且经度一致的陆地省份视为未改动，直接沿用原版配准位置；以这些省份为样本
  拟合"x 线性 + y 保形插值"的柱面模型，用于模组新增或改动的省份（含亚特兰托帕）。
- 吸附陆地时把剧本的亚特兰托帕几何一并算作陆地。

用法：
  python tools/build_era_railways.py --profile hoi4   # 写 data/transport_layers/hoi4_era_rail
  python tools/build_era_railways.py --profile tno    # 写 data/transport_layers/tno_era_rail
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scenario_builder.hoi4.parser import discover_hoi4_source_root  # noqa: E402

EARTH_RADIUS_KM = 6371.0
# unitstacks.txt 中每个省份都有的锚点类型（胜利点 / 城市标记位置）。
PROVINCE_ANCHOR_STACK_TYPE = "38"
# 控制点留一误差超过该值视为名称误匹配，剔除后重新拟合。
OUTLIER_THRESHOLD_KM = 350.0
# 胜利点城市坐标与样条预测相差不超过该值时，直接采用城市坐标。
CITY_SNAP_MAX_KM = 60.0
COORD_DECIMALS = 3
LAYER_VERSION = 1
# 原版配准的控制点与陆地来自 HOI4 1936 剧本（1939 共用同一张原版地图）。
HOI4_CONTROL_SCENARIO_DIR = Path("data/scenarios/hoi4_1936")
PROFILES = {
    "hoi4": {
        "output_dir": "data/transport_layers/hoi4_era_rail",
        "register": ("hoi4_1936", "hoi4_1939"),
    },
    "tno": {
        "output_dir": "data/transport_layers/tno_era_rail",
        "register": ("tno_1962",),
        "mod_root": "C:/Program Files (x86)/Steam/steamapps/workshop/content/394360/2438003901",
        "topology": "data/scenarios/tno_1962/runtime_topology.topo.json",
        # 亚特兰托帕新陆地也算陆地，避免线路被吸回旧海岸。
        "land_objects": ("political", "scenario_atlantropa"),
    },
}


@dataclass(frozen=True)
class RailwaySegment:
    level: int
    province_ids: tuple[int, ...]


def parse_railways(path: Path) -> list[RailwaySegment]:
    """railways.txt：每行 "等级 省份数 省份ID…"。"""
    segments: list[RailwaySegment] = []
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        values = [int(token) for token in line.split()]
        if len(values) < 3:
            continue
        level, count, provinces = values[0], values[1], values[2:]
        if count != len(provinces):
            raise ValueError(f"railways.txt 行的省份数与声明不符：{raw!r}")
        segments.append(RailwaySegment(level=level, province_ids=tuple(provinces)))
    return segments


def parse_supply_nodes(path: Path) -> list[int]:
    """supply_nodes.txt：每行 "等级 省份ID"，返回去重且保持顺序的省份。"""
    provinces: list[int] = []
    seen: set[int] = set()
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        values = line.split()
        if len(values) < 2:
            continue
        province_id = int(values[1])
        if province_id not in seen:
            seen.add(province_id)
            provinces.append(province_id)
    return provinces


def parse_province_anchors(path: Path, map_height: int) -> dict[int, tuple[float, float]]:
    """unitstacks.txt：province;type;x;y;z;rotation;offset，z 从地图底边算起。"""
    anchors: dict[int, tuple[float, float]] = {}
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        parts = raw.strip().split(";")
        if len(parts) < 5 or parts[1].strip() != PROVINCE_ANCHOR_STACK_TYPE:
            continue
        anchors[int(parts[0])] = (float(parts[2]), float(map_height) - float(parts[4]))
    return anchors


def read_bmp_size(path: Path) -> tuple[int, int]:
    header = path.read_bytes()[:26]
    if header[:2] != b"BM":
        raise ValueError(f"不是 BMP 文件：{path}")
    width = int.from_bytes(header[18:22], "little", signed=True)
    height = int.from_bytes(header[22:26], "little", signed=True)
    return abs(width), abs(height)


def haversine_km(lon1, lat1, lon2, lat2):
    lon1, lat1, lon2, lat2 = map(np.radians, (lon1, lat1, lon2, lat2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


def load_victory_point_controls(
    strategic_values_path: Path,
    anchors: dict[int, tuple[float, float]],
) -> list[dict]:
    payload = json.loads(strategic_values_path.read_text(encoding="utf-8"))
    controls: list[dict] = []
    seen: set[int] = set()
    for record in payload.get("victory_points") or []:
        if record.get("confidence") != "high":
            continue
        province_id = int(record.get("province_id") or 0)
        if province_id in seen or province_id not in anchors:
            continue
        lon, lat = record.get("lon"), record.get("lat")
        if not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)):
            continue
        seen.add(province_id)
        x, y = anchors[province_id]
        controls.append({"province_id": province_id, "name": record.get("name", ""), "x": x, "y": y, "lon": float(lon), "lat": float(lat)})
    return controls


class PixelGeoreference:
    """像素 → 经纬度的薄板样条映射，带离群控制点剔除。"""

    def __init__(self, controls: list[dict], *, smoothing: float = 2.0, folds: int = 10):
        from scipy.interpolate import RBFInterpolator

        if len(controls) < 50:
            raise ValueError(f"控制点过少：{len(controls)}")
        xy = np.array([[c["x"], c["y"]] for c in controls], dtype=float)
        lonlat = np.array([[c["lon"], c["lat"]] for c in controls], dtype=float)
        # 经度在 x 方向线性；先线性拟合再把控制点经度展开到连续区间，避免日期变更线两侧跳变。
        slope, intercept = np.polyfit(xy[:, 0], lonlat[:, 0], 1)
        predicted_lon = slope * xy[:, 0] + intercept
        lonlat[:, 0] += 360.0 * np.round((predicted_lon - lonlat[:, 0]) / 360.0)

        keep = np.ones(len(controls), dtype=bool)
        cv_errors = np.full(len(controls), np.nan)
        rng = np.random.default_rng(0)
        for _ in range(6):
            cv_errors = np.full(len(controls), np.nan)
            for fold in np.array_split(rng.permutation(np.flatnonzero(keep)), folds):
                train = keep.copy()
                train[fold] = False
                model = RBFInterpolator(xy[train], lonlat[train], kernel="thin_plate_spline", smoothing=smoothing)
                predicted = model(xy[fold])
                cv_errors[fold] = haversine_km(predicted[:, 0], predicted[:, 1], lonlat[fold, 0], lonlat[fold, 1])
            model = RBFInterpolator(xy[keep], lonlat[keep], kernel="thin_plate_spline", smoothing=smoothing)
            predicted = model(xy)
            full_errors = haversine_km(predicted[:, 0], predicted[:, 1], lonlat[:, 0], lonlat[:, 1])
            next_keep = np.where(keep, cv_errors < OUTLIER_THRESHOLD_KM, full_errors < OUTLIER_THRESHOLD_KM)
            if np.array_equal(next_keep, keep):
                break
            keep = next_keep
        self._model = RBFInterpolator(xy[keep], lonlat[keep], kernel="thin_plate_spline", smoothing=smoothing)
        kept_errors = cv_errors[keep]
        self.stats = {
            "control_point_count": int(len(controls)),
            "kept_control_point_count": int(keep.sum()),
            "dropped_control_points": sorted(str(controls[i]["name"]) for i in np.flatnonzero(~keep)),
            "cross_validation_km": {
                "median": round(float(np.nanmedian(kept_errors)), 1),
                "p90": round(float(np.nanpercentile(kept_errors, 90)), 1),
                "p99": round(float(np.nanpercentile(kept_errors, 99)), 1),
            },
        }

    def to_lonlat(self, points: np.ndarray) -> np.ndarray:
        result = self._model(np.asarray(points, dtype=float))
        result[:, 0] = (result[:, 0] + 180.0) % 360.0 - 180.0
        return result


class LandSnapper:
    """顶点落在剧本陆地之外时，吸附到最近陆地地块内侧。"""

    def __init__(self, topology_path: Path, object_names: tuple[str, ...] = ("political",)):
        from shapely import STRtree

        from map_builder.population_spatial import decode_topology

        topology = json.loads(topology_path.read_text(encoding="utf-8"))
        geometries = [
            item["geometry"]
            for object_name in object_names
            if object_name in topology.get("objects", {})
            for item in decode_topology(topology, object_name)
            if not item["geometry"].is_empty
        ]
        self._geometries = geometries
        self._tree = STRtree(geometries)

    def is_land(self, lon: float, lat: float) -> bool:
        from shapely.geometry import Point

        point = Point(lon, lat)
        return any(self._geometries[i].covers(point) for i in self._tree.query(point))

    def snap(self, lon: float, lat: float) -> tuple[tuple[float, float], bool]:
        from shapely.geometry import Point
        from shapely.ops import nearest_points

        if self.is_land(lon, lat):
            return (lon, lat), False
        point = Point(lon, lat)
        index = int(self._tree.nearest(point))
        target = nearest_points(self._geometries[index], point)[0]
        # 朝陆地内侧再挪一点，避免正好压在海岸线上。
        dx, dy = target.x - lon, target.y - lat
        length = math.hypot(dx, dy) or 1.0
        inset = 0.02
        return (target.x + dx / length * inset, target.y + dy / length * inset), True


def round_coord(value: float) -> float:
    return round(float(value), COORD_DECIMALS)


@dataclass
class VanillaGeoreference:
    """原版 HOI4 省份 → 经纬度：胜利点省份用真实城市坐标，其余用薄板样条。"""

    anchors: dict[int, tuple[float, float]]
    georef: PixelGeoreference
    city_by_province: dict[int, dict]

    @classmethod
    def build(cls, vanilla_root: Path, strategic_values_path: Path) -> "VanillaGeoreference":
        map_dir = vanilla_root / "map"
        _width, height = read_bmp_size(map_dir / "provinces.bmp")
        anchors = parse_province_anchors(map_dir / "unitstacks.txt", height)
        controls = load_victory_point_controls(strategic_values_path, anchors)
        return cls(anchors=anchors, georef=PixelGeoreference(controls), city_by_province={c["province_id"]: c for c in controls})

    def positions(self, province_ids: list[int]) -> tuple[dict[int, tuple[float, float]], set[int]]:
        """返回位置与"采用了城市坐标"的省份集合；没有锚点的省份不返回。"""
        known = [pid for pid in province_ids if pid in self.anchors]
        if not known:
            return {}, set()
        predicted = self.georef.to_lonlat(np.array([self.anchors[pid] for pid in known]))
        result: dict[int, tuple[float, float]] = {}
        from_city: set[int] = set()
        for pid, (lon, lat) in zip(known, predicted):
            city = self.city_by_province.get(pid)
            if city and float(haversine_km(lon, lat, city["lon"], city["lat"])) <= CITY_SNAP_MAX_KM:
                result[pid] = (city["lon"], city["lat"])
                from_city.add(pid)
            else:
                result[pid] = (float(lon), float(lat))
        return result, from_city


def load_mod_sources(source_root: Path) -> tuple[dict[int, tuple[float, float]], list[RailwaySegment], list[int], tuple[int, int]]:
    map_dir = source_root / "map"
    width, height = read_bmp_size(map_dir / "provinces.bmp")
    anchors = parse_province_anchors(map_dir / "unitstacks.txt", height)
    segments = parse_railways(map_dir / "railways.txt")
    supply_provinces = parse_supply_nodes(map_dir / "supply_nodes.txt")
    needed = {pid for segment in segments for pid in segment.province_ids} | set(supply_provinces)
    missing = sorted(pid for pid in needed if pid not in anchors)
    if missing:
        raise ValueError(f"省份缺少锚点：{missing[:20]}")
    return anchors, segments, supply_provinces, (width, height)


def build_era_railway_layer(
    *,
    source_root: Path,
    strategic_values_path: Path,
    topology_path: Path,
) -> tuple[dict, dict]:
    """原版 HOI4：直接用原版配准。"""
    _anchors, segments, supply_provinces, _size = load_mod_sources(source_root)
    vanilla = VanillaGeoreference.build(source_root, strategic_values_path)
    snapper = LandSnapper(topology_path)
    needed = sorted({pid for segment in segments for pid in segment.province_ids} | set(supply_provinces))
    raw_positions, from_city = vanilla.positions(needed)
    positions, land_snapped = snap_positions(raw_positions, from_city, snapper)
    layer, layer_stats = assemble_layer(segments, supply_provinces, positions, snapper)
    audit = {
        "georeference": vanilla.georef.stats,
        **layer_stats,
        "province_vertex_count": len(needed),
        "city_coordinate_vertices": len(from_city),
        "land_snapped_vertices": land_snapped,
    }
    return layer, audit


class ModCylindricalGeoreference:
    """模组地图 → 经纬度：x 与经度线性，纬度是 y 的一维单调函数。

    控制点取模组与原版共用 ID、且经度一致的陆地省份（原版位置已配准），
    以此识别出未被模组改动的省份；ID 被重用到别处的省份会因经度不一致被排除。
    """

    LON_AGREEMENT_DEG = 0.6
    LAT_BIN_PX = 16.0

    def __init__(self, mod_anchors: dict[int, tuple[float, float]], vanilla_positions: dict[int, tuple[float, float]], *, width: int):
        from scipy.interpolate import PchipInterpolator

        shared = sorted(pid for pid in mod_anchors if pid in vanilla_positions)
        if len(shared) < 200:
            raise ValueError(f"与原版共享的省份过少：{len(shared)}")
        x = np.array([mod_anchors[pid][0] for pid in shared])
        y = np.array([mod_anchors[pid][1] for pid in shared])
        lon = np.array([vanilla_positions[pid][0] for pid in shared])
        lat = np.array([vanilla_positions[pid][1] for pid in shared])
        # 经度：先按"整幅图覆盖 360°"取初值，再用一致的控制点做线性回归。
        slope, intercept = 360.0 / width, -180.0
        for _ in range(3):
            residual = (slope * x + intercept - lon + 180.0) % 360.0 - 180.0
            consistent = np.abs(residual) < self.LON_AGREEMENT_DEG
            unwrapped = lon + 360.0 * np.round((slope * x + intercept - lon) / 360.0)
            slope, intercept = np.polyfit(x[consistent], unwrapped[consistent], 1)
        residual = (slope * x + intercept - lon + 180.0) % 360.0 - 180.0
        consistent = np.abs(residual) < self.LON_AGREEMENT_DEG
        self.slope, self.intercept = float(slope), float(intercept)
        # 纬度：按 y 分箱取中位数，再用保形分段三次插值（单调、不振荡）。
        bins = np.floor(y[consistent] / self.LAT_BIN_PX).astype(int)
        centers, medians = [], []
        for b in np.unique(bins):
            mask = bins == b
            if mask.sum() >= 3:
                centers.append(float(np.median(y[consistent][mask])))
                medians.append(float(np.median(lat[consistent][mask])))
        order = np.argsort(centers)
        centers_arr = np.array(centers)[order]
        medians_arr = np.minimum.accumulate(np.array(medians)[order])  # y 向下纬度单调递减
        self._lat = PchipInterpolator(centers_arr, medians_arr, extrapolate=True)
        self._y_range = (float(centers_arr[0]), float(centers_arr[-1]))
        self.consistent_ids = {pid for pid, ok in zip(shared, consistent) if ok}
        predicted_lat = self._lat(y[consistent])
        lat_error_km = np.abs(predicted_lat - lat[consistent]) * 111.2
        self.stats = {
            "shared_province_count": len(shared),
            "consistent_province_count": len(self.consistent_ids),
            "lon_per_px": round(self.slope, 6),
            "lon_at_x0": round(self.intercept, 4),
            "lat_residual_km": {
                "median": round(float(np.median(lat_error_km)), 1),
                "p90": round(float(np.percentile(lat_error_km, 90)), 1),
            },
        }

    def to_lonlat(self, x: float, y: float) -> tuple[float, float]:
        lon = (self.slope * x + self.intercept + 180.0) % 360.0 - 180.0
        lat = float(np.clip(self._lat(np.clip(y, *self._y_range)), -89.0, 89.0))
        return float(lon), lat


def build_mod_era_railway_layer(
    *,
    mod_root: Path,
    vanilla_root: Path,
    strategic_values_path: Path,
    mod_topology_path: Path,
    land_object_names: tuple[str, ...],
) -> tuple[dict, dict]:
    """大改地图的模组（如 TNO）：借原版配准识别未改动省份，其余用模组地图自身的柱面模型。"""
    mod_anchors, segments, supply_provinces, (width, _height) = load_mod_sources(mod_root)
    vanilla = VanillaGeoreference.build(vanilla_root, strategic_values_path)
    from scenario_builder.hoi4.parser import parse_definition_csv

    vanilla_defs = parse_definition_csv(vanilla_root / "map" / "definition.csv")
    mod_defs = parse_definition_csv(mod_root / "map" / "definition.csv")
    shared_land = sorted(
        pid for pid in mod_anchors
        if pid in vanilla.anchors
        and getattr(vanilla_defs.get(pid), "province_type", "") == "land"
        and getattr(mod_defs.get(pid), "province_type", "") == "land"
    )
    vanilla_positions, vanilla_from_city = vanilla.positions(shared_land)
    model = ModCylindricalGeoreference(mod_anchors, vanilla_positions, width=width)
    snapper = LandSnapper(mod_topology_path, land_object_names)

    needed = sorted({pid for segment in segments for pid in segment.province_ids} | set(supply_provinces))
    raw_positions: dict[int, tuple[float, float]] = {}
    from_city: set[int] = set()
    reused = 0
    for pid in needed:
        if pid in model.consistent_ids:
            raw_positions[pid] = vanilla_positions[pid]
            reused += 1
            if pid in vanilla_from_city:
                from_city.add(pid)
        else:
            raw_positions[pid] = model.to_lonlat(*mod_anchors[pid])
    positions, land_snapped = snap_positions(raw_positions, from_city, snapper)
    layer, layer_stats = assemble_layer(segments, supply_provinces, positions, snapper)
    audit = {
        "georeference": {"vanilla": vanilla.georef.stats, "mod_cylindrical": model.stats},
        **layer_stats,
        "province_vertex_count": len(needed),
        "vanilla_position_vertices": reused,
        "mod_model_vertices": len(needed) - reused,
        "city_coordinate_vertices": len(from_city),
        "land_snapped_vertices": land_snapped,
    }
    return layer, audit


def snap_positions(
    positions: dict[int, tuple[float, float]],
    keep_exact: set[int],
    snapper: LandSnapper,
) -> tuple[dict[int, tuple[float, float]], int]:
    """城市坐标保持原样，其余落海的顶点吸附到陆地。"""
    result: dict[int, tuple[float, float]] = {}
    moved_count = 0
    for pid, (lon, lat) in positions.items():
        if pid in keep_exact:
            result[pid] = (lon, lat)
            continue
        result[pid], moved = snapper.snap(lon, lat)
        moved_count += int(moved)
    return result, moved_count


def assemble_layer(
    segments: list[RailwaySegment],
    supply_provinces: list[int],
    position_by_province: dict[int, tuple[float, float]],
    snapper: LandSnapper,
) -> tuple[dict, dict]:
    features: list[dict] = []
    level_counts: dict[str, int] = {}
    midpoint_fixes = 0
    for segment in segments:
        coordinates: list[list[float]] = []
        for previous, current in zip((None, *segment.province_ids[:-1]), segment.province_ids):
            lon, lat = position_by_province[current]
            if previous is not None:
                prev_lon, prev_lat = position_by_province[previous]
                mid_lon, mid_lat = (prev_lon + lon) / 2, (prev_lat + lat) / 2
                if abs(lon - prev_lon) < 180 and not snapper.is_land(mid_lon, mid_lat):
                    # 相邻陆地省份连线跨过海湾时，经由吸附到陆地的中点绕行。
                    (fix_lon, fix_lat), _ = snapper.snap(mid_lon, mid_lat)
                    coordinates.append([round_coord(fix_lon), round_coord(fix_lat)])
                    midpoint_fixes += 1
            point = [round_coord(lon), round_coord(lat)]
            if not coordinates or coordinates[-1] != point:
                coordinates.append(point)
        if len(coordinates) < 2:
            continue
        level = max(1, min(5, int(segment.level)))
        level_counts[str(level)] = level_counts.get(str(level), 0) + 1
        features.append({
            "type": "Feature",
            "properties": {"kind": "railway", "level": level},
            "geometry": {"type": "LineString", "coordinates": coordinates},
        })
    for pid in supply_provinces:
        lon, lat = position_by_province[pid]
        features.append({
            "type": "Feature",
            "properties": {"kind": "supply_node"},
            "geometry": {"type": "Point", "coordinates": [round_coord(lon), round_coord(lat)]},
        })

    layer = {"type": "FeatureCollection", "version": LAYER_VERSION, "features": features}
    stats = {
        "railway_segment_count": sum(level_counts.values()),
        "railway_level_counts": dict(sorted(level_counts.items())),
        "supply_node_count": len(supply_provinces),
        "sea_crossing_midpoint_fixes": midpoint_fixes,
    }
    return layer, stats


def write_json(path: Path, payload: dict, *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    else:
        text = json.dumps(payload, ensure_ascii=False, indent=2)
    path.write_text(text + "\n", encoding="utf-8", newline="\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--profile", choices=sorted(PROFILES), default="hoi4")
    parser.add_argument("--source-root", default=None, help="HOI4 原版安装目录（默认自动探测）")
    parser.add_argument("--mod-root", default=None, help="模组目录（mod 类 profile 使用，默认取 profile 预设）")
    parser.add_argument("--output-dir", default=None)
    parser.add_argument(
        "--register-scenario",
        action="append",
        default=None,
        help="把图层登记到这些剧本 manifest 的 era_railways_url（可重复；默认取 profile 预设）",
    )
    args = parser.parse_args(argv)
    profile = PROFILES[args.profile]
    register_scenarios = args.register_scenario or list(profile["register"])
    output_rel = args.output_dir or profile["output_dir"]

    vanilla_root = discover_hoi4_source_root(args.source_root)
    output_dir = (ROOT / output_rel).resolve()
    strategic_values_path = ROOT / HOI4_CONTROL_SCENARIO_DIR / "strategic_values.by_feature.json"
    if args.profile == "hoi4":
        source_root = vanilla_root
        layer, audit = build_era_railway_layer(
            source_root=vanilla_root,
            strategic_values_path=strategic_values_path,
            topology_path=ROOT / HOI4_CONTROL_SCENARIO_DIR / "runtime_topology.topo.json",
        )
    else:
        source_root = Path(args.mod_root or profile["mod_root"])
        layer, audit = build_mod_era_railway_layer(
            mod_root=source_root,
            vanilla_root=vanilla_root,
            strategic_values_path=strategic_values_path,
            mod_topology_path=ROOT / profile["topology"],
            land_object_names=tuple(profile["land_objects"]),
        )
    write_json(output_dir / "era_rail.geojson", layer, compact=True)
    write_json(output_dir / "build_audit.json", {"profile": args.profile, **audit})
    write_json(output_dir / "manifest.json", build_transport_manifest(
        output_dir=output_dir,
        source_root=source_root,
        audit=audit,
        build_command=f"python tools/build_era_railways.py --profile {args.profile}",
    ))
    layer_url = f"{output_dir.relative_to(ROOT).as_posix()}/era_rail.geojson"
    for scenario_id in register_scenarios:
        register_scenario_manifest(ROOT / "data" / "scenarios" / scenario_id / "manifest.json", layer_url)
    print(json.dumps(audit, ensure_ascii=False, indent=2))
    return 0


def register_scenario_manifest(manifest_path: Path, layer_url: str) -> None:
    """构建后登记：剧本重建会重写 manifest，因此由本工具负责写回 era_railways_url。"""
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("era_railways_url") == layer_url:
        return
    keys_were_sorted = list(manifest) == sorted(manifest)
    manifest["era_railways_url"] = layer_url
    if keys_were_sorted:
        manifest = dict(sorted(manifest.items()))
    write_json(manifest_path, manifest)


def build_transport_manifest(*, output_dir: Path, source_root: Path, audit: dict, build_command: str) -> dict:
    """交通层治理用 manifest：登记产物路径、要素数和源文件签名（源文件本身不入库）。"""
    import hashlib
    from datetime import datetime, timezone

    rel_dir = output_dir.relative_to(ROOT).as_posix()
    layer_path = f"{rel_dir}/era_rail.geojson"
    feature_counts = {
        "railways": int(audit["railway_segment_count"]),
        "supply_nodes": int(audit["supply_node_count"]),
    }
    source_signature = {}
    for name in ("railways.txt", "supply_nodes.txt", "unitstacks.txt", "provinces.bmp"):
        path = source_root / "map" / name
        source_signature[name] = {
            "filename": f"map/{name}",
            "size_bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
    paths = {"era_rail": layer_path, "build_audit": f"{rel_dir}/build_audit.json"}
    return {
        "adapter_id": f"{output_dir.name}_v{LAYER_VERSION}",
        "family": "era_rail",
        # 线路与补给枢纽同在一个文件，几何类型为线+点混合。
        "geometry_kind": "mixed",
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "recipe_version": f"era_rail_v{LAYER_VERSION}",
        "source_policy": "local_game_files_facts_only",
        "distribution_tier": "scenario_optional_layer",
        "paths": paths,
        "default_variant": "default",
        "variants": {
            "default": {
                "distribution_tier": "scenario_optional_layer",
                "paths": {"era_rail": layer_path},
                "feature_counts": feature_counts,
            },
        },
        "feature_counts": feature_counts,
        "source_signature": source_signature,
        "build_command": build_command,
        "runtime_consumer": "scenario_optional_layer:erarailways",
    }


if __name__ == "__main__":
    raise SystemExit(main())
