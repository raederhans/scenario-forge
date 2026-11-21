from __future__ import annotations

import argparse
from collections import defaultdict
import gzip
import json
import os
from pathlib import Path
import sys

import numpy as np
import shapely
from pyproj import Geod
from shapely.affinity import affine_transform
from shapely.geometry import mapping

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from map_builder.regional_geometry import _absolute_topology, _decode_geometry
from tools.apply_hoi4_geometry_splits import area_km2, validate_partition_plan
from tools.build_hoi4_water_shape_splits import code, polygons
from tools.rebuild_polar_assets import read

DATA = ROOT / "data"
ASSETS = ROOT / "apps/hgo/assets"
PREFIX = DATA / "scenario-rules/hoi4_hgo_hotspots"
GEOD = Geod(ellps="WGS84")

# Geographically identified out-of-region candidates would stretch the fallback extent.
OUTSIDE_REGION = {
    "south_tyrol_trentino": {4802, 7538, 7539, 7540, 7542, 7543, 7544, 7545, 7546, 7547},  # Ötztal and Veneto
    "carinthia": {1229, 4150, 4115, 4152, 5952, 8407},  # East Tyrol and Styria
}

# HGO label anchors for towns and the two provincial seats. Merano has two
# different HGO labels for the same town, so neither is a registration control.
STATE_CITY_CONTROLS = {
    "alsace_lorraine": {2059: "Metz", 2061: "Thionville", 5359: "Strasbourg",
                        5360: "Haguenau", 5573: "Colmar", 5587: "Hayange"},
    "south_tyrol_trentino": {39: "Bolzano", 975: "Trento", 4801: "Brunico",
                             7533: "Rovereto", 8410: "Laces", 8411: "Melago"},
}
# Approximate town centres absent from the editor city layer, in lon/lat.
ALPINE_TOWNS = {"BRUNICO": [[11.94, 46.80]], "LACES": [[10.86, 46.62]],
                "MELAGO": [[10.66, 46.84]]}

TRANSLATIONS = {
    76: "塞克勒地区", 83: "克里沙纳", 736: "普拉", 779: "奥伊彭-马尔梅迪",
    802: "内乌姆", 806: "伊德里亚", 821: "北伊庇鲁斯", 828: "乔尔卢",
    1009: "格但斯克波美拉尼亚", 1111: "弗尔克拉马克特", 1201: "哈尔基季基", 1218: "奥拉迪亚县",
    1219: "北特兰西瓦尼亚", 1229: "利恩茨", 1232: "穆尔维察", 1235: "伊普萨拉",
    1238: "迪米特洛夫格勒", 1277: "基尔运河东段", 1430: "马林韦尔德", 1439: "马祖里",
    1490: "阿普塞尼山脉", 1730: "奥古斯图夫", 1764: "什塔宾", 1765: "奥什米亚内",
    1791: "克拉根福郊区", 1798: "德斯卡蒂", 1799: "桑丹斯基", 2064: "莱纳茨霍夫",
    2084: "海尔斯贝格", 2136: "蒙基", 2172: "图尔盖什山口", 2173: "沃尔坎山口",
    2174: "铁门峡谷", 2197: "卡桑德拉", 2201: "萨诺斯", 2202: "奥雷斯蒂亚达",
    2203: "奥尔梅尼奥", 2204: "凯末尔", 2205: "普雷斯帕", 2206: "卡斯托里亚",
    2271: "托姆纳蒂克", 2272: "蒂米什瓦拉", 2275: "卡雷伊", 2290: "普拉夫尼克岛",
    2296: "韦尔尼采", 2298: "阿尔斯岛", 2371: "达尔马提亚群岛", 2413: "北蒙基",
    2432: "富伦", 2435: "马尔丁根", 2462: "贾乌多沃", 2466: "西石勒苏益格",
    2762: "博亚内", 2782: "沃尔夫斯贝格", 2783: "波斯托伊纳", 2790: "格鲁琼兹",
    3202: "芒德朗", 3212: "凯尔米斯", 3329: "西德斯卡蒂", 3459: "梅里奇",
    3553: "戈乌达普", 3564: "南伊德里亚", 3565: "西南蒂罗尔", 3776: "纳波卡",
    3872: "马尔马齐耶伊", 4026: "泽尔瓦", 4033: "维尼", 4061: "奥尔特尔斯堡",
    4063: "帕森海姆", 4065: "舍恩费尔德", 4069: "布劳恩斯贝格", 4089: "施瓦茨达默科",
    4090: "赖赫斯霍斯特", 4091: "卡尔图济", 4111: "拉斯滕堡", 4115: "莱布尼茨",
    4150: "菲尔根", 4152: "拉豪", 4346: "萨莫色雷斯岛", 4347: "锡索尼亚",
    4766: "北科罗布奇齐", 4767: "南科罗布奇齐", 4801: "布鲁尼科", 4802: "泽尔登",
    4828: "科查尼", 4839: "别尔什蒂", 4841: "斯洛尼姆", 5031: "斯尔布",
    5156: "梅特科维奇", 5213: "东卡斯托里亚", 5345: "马贾罗沃", 5346: "德温",
    5360: "阿格诺", 5367: "科雷尼察", 5384: "马尔多伊滕", 5385: "加尔迪嫩",
    5495: "瓦韦尔卡", 5535: "罗希亚", 5536: "博尔卡", 5537: "罗兹诺夫",
    5538: "切赫勒乌", 5540: "格涅夫", 5542: "谢利吉", 5544: "利森",
    5545: "什奇特诺", 5561: "因杜拉", 5562: "比亚罗扎夫卡", 5563: "巴克什蒂",
    5573: "科尔马", 5574: "纳茨维莱尔", 5586: "卡特农", 5587: "阿扬日",
    5729: "乌尊克普吕", 5731: "凯尚", 5773: "拉斯滕堡", 5779: "上维谢乌",
    5786: "阿莱什德", 5787: "博格丹德", 5792: "斯莫尔贡", 5834: "艾德施泰特",
    5835: "伦茨堡", 5836: "达姆普", 5837: "滕德", 5838: "胡苏姆",
    5910: "斯维伦格勒", 5911: "胡赫拉", 5912: "西曼特罗", 5918: "埃莱兹汉",
    5932: "坎法纳罗", 5933: "梅杜林", 5935: "日米尼", 5936: "瓦尔达尔萨",
    5952: "瓦格纳", 5953: "埃布里亚赫", 5954: "加利齐恩", 5955: "吕克斯多夫",
    5956: "泰纳赫", 5957: "格拉芬施泰因", 5959: "埃本塔尔", 5969: "瓦皮",
    5976: "夏诺沃", 5978: "基谢利采", 5989: "博罗维基", 5990: "曼奇基",
    5991: "阿斯特里纳", 5992: "皮耶斯基", 5993: "库里洛维奇", 5994: "斯塔凯",
    5995: "克雷沃伊", 5996: "贡恰雷", 5997: "察茨基", 5998: "波拉斯利",
    5999: "齐博雷", 6001: "别尼亚科尼", 6002: "戈尔沙内", 7232: "卡拉布伦",
    7239: "托勒迈达", 7240: "迪斯皮利奥", 7241: "科扎尼", 7242: "格雷韦纳",
    7243: "梅措沃", 7244: "科尼察", 7245: "帕尔加", 7246: "普雷韦扎",
    7278: "维斯", 7281: "班斯科", 7282: "多斯帕特", 7303: "卡兰塞贝什",
    7305: "奥采卢罗舒", 7306: "佩奇卡", 7307: "蒂米什山口东部", 7308: "图尔盖什山口北部",
    7309: "拉德纳", 7310: "菲比什", 7311: "萨特基内兹", 7314: "图尔达",
    7315: "多巴", 7317: "卡夫尼克", 7318: "耶乌德", 7319: "博尔沙",
    7330: "克里瓦帕兰卡", 7352: "西杜布罗夫尼克", 7361: "斯塔里格勒", 7362: "卡尔洛巴格",
    7363: "采蒂纳", 7408: "莫斯特", 7415: "安格堡", 7416: "勒岑",
    7417: "达尔克门", 7421: "普鲁士艾劳", 7423: "勒塞尔", 7424: "阿里斯",
    7425: "森斯堡", 7427: "尼古拉肯", 7428: "奥尔特尔斯堡", 7429: "霍恩施泰因",
    7431: "沃尔姆迪特", 7432: "古特施塔特", 7434: "普沃希尼察", 7435: "库尔基",
    7438: "苏什", 7450: "东比托夫", 7470: "萨尔堡", 7471: "阿蒂尼",
    7473: "金茨海姆", 7533: "罗韦雷托", 7534: "梅拉诺-梅兰", 7538: "奇塔代拉", 7539: "蒙泰贝卢纳",
    7540: "格拉帕山麓巴萨诺", 7542: "波萨尼奥", 7543: "格拉帕山麓博尔索", 7544: "科穆达",
    7545: "奥尼戈", 7546: "佩代罗巴", 7547: "皮亚韦河畔阿拉诺", 7551: "弗肯齐",
    7624: "梅尔达里", 7625: "绍尔塔岛", 7632: "乌德尼什特", 7633: "普雷斯帕",
    7634: "加利奇察", 7637: "布鲁什卡", 7999: "莫伊内什蒂", 8002: "贝卢什",
    8003: "胡埃丁", 8036: "科罗布奇齐中部", 8037: "东阿斯特里纳", 8039: "北卡梅涅茨",
    8040: "西皮耶斯基", 8041: "因杜拉中部", 8042: "南因杜拉", 8043: "西博罗维基",
    8045: "东索尔道", 8061: "南卡尔图济", 8062: "北库亚维", 8088: "北耶乌德",
    8089: "南博尔沙", 8104: "帕德堡", 8105: "鲁德伯尔", 8407: "福伊茨贝格",
    8409: "梅拉诺", 8410: "拉切斯", 8411: "梅拉戈", 11894: "南达姆普",
}


def project(points, grid, step):
    uv = points / step - 0.5
    ix, iy = np.floor(uv).astype(int).T
    fx, fy = (uv - np.floor(uv)).T
    result = np.zeros_like(uv)
    for dx, dy in ((0, 0), (0, 1), (1, 0), (1, 1)):
        weight = (fx if dx else 1-fx) * (fy if dy else 1-fy)
        result += grid[iy+dy, ix+dx] * weight[:, None]
    return result


def footprints(regions, core, grid, step):
    ids = {sid for region in regions for sid in region["hgo_state_ids"]}
    h, w = grid.shape[:2]
    raster = np.frombuffer(gzip.decompress((ASSETS / "default/ids.u16.gz").read_bytes()),
                           "<u2").reshape(h * step[1], w * step[0])
    labels = np.array([sid or 0 for sid in core["provinceStateIds"]])
    shapes = {}
    for state in core["states"]:
        sid = state["id"]
        if sid not in ids:
            continue
        left, top, right, bottom = state["bounds"]
        y, x = np.where(labels[raster[top:bottom+1, left:right+1]] == sid)
        corners = np.column_stack((x + left, y + top))[:, None, :] + np.array(
            [(0, 0), (1, 0), (1, 1), (0, 1)])
        coords = project(corners.reshape(-1, 2), grid, step).reshape(-1, 4, 2)
        valid = np.isfinite(coords).all(axis=(1, 2))
        shapes[sid] = shapely.coverage_union_all(shapely.polygons(coords[valid]))
    return shapes


def city_index(features):
    index = defaultdict(list)
    for f in features:
        props = f["properties"]
        for key in {code(n) for n in [props["name"], props["name_en"], *props["aliases"]]} - {""}:
            index[key].append(f["geometry"]["coordinates"])
    return index


def registration(shapes, target, places, cities, grid, step, state_anchors=()):
    src, dst = [], []
    extent = shapely.box(*shapely.total_bounds(list(shapes.values())))
    for p in [*places, *state_anchors]:
        xy = project(np.array([[p["x"], p["y"]]]), grid, step)[0]
        if not np.isfinite(xy).all() or not extent.covers(shapely.Point(xy)):
            continue
        nearby = []
        for lon, lat in cities.get(code(p["name"]), []):
            meters = GEOD.inv(*xy, lon, lat)[2]
            if meters <= 80000 and (p["stateId"] in shapes or target.covers(shapely.Point(lon, lat))):
                nearby.append((meters, lon, lat))
        if nearby:
            _, lon, lat = min(nearby)
            src.append([*xy, 1])
            dst.append([lon, lat])
    matrix = None
    if len(src) >= 3:
        fit, _, rank, _ = np.linalg.lstsq(src, dst, rcond=None)
        if rank == 3:
            matrix = [*fit[:2, 0], *fit[:2, 1], *fit[2]]
            method = "city/state-anchor affine" if state_anchors else "city affine"
    if matrix is None:
        x, y, xx, yy = shapely.total_bounds(list(shapes.values()))
        a, b, aa, bb = target.bounds
        sx, sy = (aa-a)/(xx-x), (bb-b)/(yy-y)
        matrix = [sx, 0, 0, sy, a-x*sx, b-y*sy]
        method = "bbox"
    residual = "n/a"
    if src:
        a, b, c, d, e, f = matrix
        fitted = np.array(src) @ np.array([[a, c], [b, d], [e, f]])
        distances = GEOD.inv(*fitted.T, *np.array(dst).T)[2]
        residual = f"{np.sqrt(np.mean(distances**2))/1000:.2f} km"
    return matrix, f"{method}, cities={len(src)}, RMS={residual}"


def partition(parent, states, pixel_counts=None):
    # Leave a narrow collar. Triangulating it preserves the parent's original arc vertices.
    interior = parent.buffer(-0.002)
    seeds = {}
    simplified = shapely.coverage_simplify(list(states.values()), 0.002)
    for (sid, state), mask in zip(states.items(), simplified):
        clipped = parent.intersection(state)
        minimum = min(0.3 * state.area, 0.2 * parent.area)
        if pixel_counts is not None:
            minimum = min(minimum, state.area / pixel_counts[sid])
        if clipped.area < minimum or clipped.area == 0:
            continue
        cut = interior.intersection(mask, grid_size=1e-7)
        large = [p for p in polygons(cut) if area_km2(p) >= 3]
        if large:
            seeds[sid] = shapely.union_all(large)
    if len(seeds) < 2:
        return {}
    additions = defaultdict(list)
    boundaries = shapely.union_all([parent.boundary, *(g.boundary for g in seeds.values())])
    for face in shapely.polygonize(shapely.get_parts(boundaries)).geoms:
        inside = face.representative_point()
        if not parent.covers(inside):
            continue
        owner = next((sid for sid, seed in seeds.items() if seed.covers(inside)), None)
        if owner is not None:
            additions[owner].append(face)
            continue
        for tri in shapely.constrained_delaunay_triangles(face).geoms:
            point = tri.centroid
            sid = min(seeds, key=lambda k: seeds[k].distance(point))
            additions[sid].append(tri)
    parts = {sid: shapely.union_all(additions[sid]) for sid in seeds}
    # Move detached scraps to the part with the longest common edge.
    for sid in parts:
        for scrap in list(polygons(parts[sid])):
            if area_km2(scrap) >= 3:
                continue
            edges = {k: parts[k].boundary.intersection(scrap.boundary).length for k in parts if k != sid}
            other = max(edges, key=edges.get) if any(edges.values()) else min(
                seeds, key=lambda k: seeds[k].distance(scrap))
            if other == sid:
                continue
            parts[sid] = parts[sid].difference(scrap)
            parts[other] = parts[other].union(scrap)
    return parts


def build_entry(parent_id, parts, names, source_path):
    if len(parts) < 2:
        return None, []
    entry = dict(id=parent_id, feature_ids=[parent_id], parts=[],
                 sources=["HGO states (Historic Geographical Overhaul)"])
    features, suffixes = [], set()
    remainder = max(parts, key=lambda sid: parts[sid].area)
    for sid, geom in parts.items():
        en, zh = names[sid]
        suffix = code(en)
        if suffix in suffixes:
            suffix += f"_{sid}"
        suffixes.add(suffix)
        part = dict(suffix=suffix, name_en=en, name_zh=zh, full_name=True)
        if sid == remainder:
            entry["remainder"] = part
        else:
            unit = f"{parent_id}_{sid}"
            part["polygon_source"] = dict(path=source_path, property="unit", values=[unit])
            entry["parts"].append(part)
            features.append(dict(type="Feature", properties=dict(unit=unit), geometry=mapping(geom)))
    return entry, features


def write(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8", newline="\n")


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--regions", type=Path, default=PREFIX.with_suffix(".regions.json"))
    parser.add_argument("--rules", type=Path, default=PREFIX.with_suffix(".geometry_splits.json"))
    parser.add_argument("--sources", type=Path, default=PREFIX.with_suffix(".sources.geojson"))
    args = parser.parse_args(argv)
    regions = read(args.regions)
    for region in regions:
        ids = region["hgo_state_ids"]
        if region["region_id"] == "south_tyrol_trentino" and 975 in ids and 7533 not in ids:
            ids.append(7533)  # Include the Rovereto state alongside Trentino.
    core = read(ASSETS / "default/core.json")
    state_rows = {s["id"]: s for s in core["states"]}
    folder = ASSETS / "overlays/geography"
    spec = read(folder / "georeference.json")["inverseGrid"]
    step = np.array(spec["nativePixelStep"])
    grid = np.frombuffer(gzip.decompress((folder / "inverse-lonlat.f32.gz").read_bytes()),
                         "<f4").reshape(spec["height"], spec["width"], 2)
    shapes = footprints(regions, core, grid, step)
    locale = read(ASSETS / "overlays/localization/index.json")["states"]
    catalog = read(DATA / "hgo_catalogs/hgo_place_names.json")["entries"]
    names = {}
    for s in core["states"]:
        sid = s["id"]
        if sid in shapes:
            zh = catalog.get(s["nameKey"], {}).get("names", {}).get("zh") or locale[str(sid)].get("zh")
            names[sid] = s["name"], zh or TRANSLATIONS[sid]
    cities = city_index(read(DATA / "world_cities.geojson")["features"])
    places = read(ASSETS / "default/places.json")["places"]
    topology = _absolute_topology(read(DATA / "scenarios/hoi4_1936/runtime_topology.topo.json"))
    rows = {r["properties"]["id"]: r for r in topology["objects"]["political"]["geometries"]}
    rules = dict(version=1, scenarios=["hoi4_1936", "hoi4_1939"], area_tolerance_degrees2=1e-9, entries=[])
    features = []
    source_path = Path(os.path.relpath(args.sources, args.rules.parent)).as_posix()
    for region in regions:
        parents = {fid: _decode_geometry(topology, rows[fid]) for fid in region["parent_ids"]}
        outside = OUTSIDE_REGION.get(region["region_id"], set())
        states = {sid: shapes[sid] for sid in region["hgo_state_ids"] if sid not in outside}
        controls = STATE_CITY_CONTROLS.get(region["region_id"], {})
        anchors = [dict(name=name, stateId=sid, x=state_rows[sid]["anchor"][0], y=state_rows[sid]["anchor"][1])
                   for sid, name in controls.items() if sid in states]
        city_points = ALPINE_TOWNS | cities if region["region_id"] == "south_tyrol_trentino" else cities
        matrix, report = registration(states, shapely.union_all(list(parents.values())),
                                      places, city_points, grid, step, anchors)
        pixel_counts = {sid: state_rows[sid]["pixelCount"] for sid in states} if controls else None
        states = {sid: affine_transform(g, matrix) for sid, g in states.items()}
        count, skipped = 0, []
        for fid, parent in parents.items():
            parts = partition(parent, states, pixel_counts)
            entry, masks = build_entry(fid, parts, names, source_path)
            if entry:
                rules["entries"].append(entry)
                features.extend(masks)
                count += len(parts)
            else:
                skipped.append(fid)
        print(f"{region['region_id']}: parents={len(parents)}, parts={count}, "
              f"net={count-len(parents)+len(skipped)}, {report}, skipped (<2)={skipped}", flush=True)
    validate_partition_plan(rules)
    write(args.rules, rules)
    write(args.sources, dict(type="FeatureCollection", features=features))
    print(f"{args.sources.name}: {args.sources.stat().st_size} bytes")


if __name__ == "__main__":
    main()
