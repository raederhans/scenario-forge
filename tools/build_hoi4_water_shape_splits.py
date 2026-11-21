from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
import gzip
import json
from pathlib import Path
import re
import sys
import unicodedata

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from shapely.affinity import affine_transform
from shapely.geometry import mapping, shape

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from map_builder.regional_geometry import _absolute_topology, _decode_geometry
from tools.apply_hoi4_geometry_splits import area_km2
from tools.rebuild_polar_assets import read

DATA = ROOT / "data"
SCENARIO = DATA / "scenarios/hoi4_1936"
MASK_FILE = "hoi4_water_shapes.sources.geojson"
RESERVOIR = "Natural Earth (global_lakes)"
HISTORIC = "Natural Earth (historic lakes)"
PLAYA = "Natural Earth (playas)"
ARAL = "Natural Earth (historic Aral Sea) / HGO states"
POLDER = "HGO Zuiderzee states"


@dataclass
class Candidate:
    suffix: str
    name_en: str
    name_zh: str
    source: str
    geometry: shapely.Geometry
    parent: str | None = None


def code(name):
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub("[^A-Z0-9]+", "_", ascii_name.upper()).strip("_")


def polygons(geometry):
    if geometry.geom_type == "Polygon" and not geometry.is_empty:
        yield geometry
    elif hasattr(geometry, "geoms"):
        for child in geometry.geoms:
            yield from polygons(child)


def lake_visible(props, year):
    return props.get("year_built", 0) <= year < props.get("year_removed", float("inf"))


def hgo_pixels():
    assets = ROOT / "apps/hgo/assets"
    core = read(assets / "default/core.json")
    folder = assets / "overlays/geography"
    spec = read(folder / "georeference.json")["inverseGrid"]
    h, w = spec["height"], spec["width"]
    step = np.array(spec["nativePixelStep"])
    grid = np.frombuffer(gzip.decompress((folder / "inverse-lonlat.f32.gz").read_bytes()),
                         "<f4").reshape(h, w, 2)
    raster = np.frombuffer(gzip.decompress((assets / "default/ids.u16.gz").read_bytes()),
                           "<u2").reshape(h * step[1], w * step[0])
    # Raster values index the parallel provinceIds and provinceStateIds arrays.
    states = np.array(core["provinceStateIds"])
    cells = defaultdict(list)
    for state in core["states"]:
        sid = state["id"]
        if sid not in {8441, *range(8996, 9002), *range(9244, 9251), *range(9816, 9820)}:
            continue
        left, top, right, bottom = state["bounds"]
        y, x = np.where(states[raster[top:bottom+1, left:right+1]] == sid)
        corners = np.stack((x + left, y + top), axis=-1)[:, None, :] + np.array(
            [(0, 0), (1, 0), (1, 1), (0, 1)])
        uv = corners / step - 0.5
        ix, iy = np.moveaxis(np.floor(uv).astype(int), -1, 0)
        fx, fy = np.moveaxis(uv - np.floor(uv), -1, 0)
        coords = np.zeros(corners.shape)
        for dx, dy in ((0, 0), (1, 0), (1, 1), (0, 1)):
            weight = (fx if dx else 1-fx) * (fy if dy else 1-fy)
            coords += grid[iy+dy, ix+dx] * weight[:, :, None]
        valid = np.isfinite(coords).all(axis=(1, 2))
        cells[state["name"]].extend(shapely.polygons(coords[valid]))
    return cells


def fit_bands(groups, target):
    all_cells = [cell for cells in groups.values() for cell in cells]
    x, y, x2, y2 = shapely.total_bounds(all_cells)
    a, b, a2, b2 = target.bounds
    sx, sy = (a2-a)/(x2-x), (b2-b)/(y2-y)
    transform = [sx, 0, 0, sy, a-x*sx, b-y*sy]
    footprints, centers, labels = {}, [], []
    for label, cells in groups.items():
        aligned = [affine_transform(cell, transform) for cell in cells]
        footprints[label] = shapely.union_all(aligned)
        centers.extend(shapely.centroid(aligned))
        labels.extend([label] * len(cells))

    # Extend the edge pixels across unmatched shoreline by nearest pixel center.
    gap = target.difference(shapely.union_all(list(footprints.values())))
    voronoi = shapely.voronoi_polygons(shapely.MultiPoint(centers), extend_to=target.envelope,
                                      ordered=True)
    extensions = defaultdict(list)
    for label, cell in zip(labels, voronoi.geoms):
        if gap.intersects(cell):
            extensions[label].append(gap.intersection(cell))
    remaining = target
    bands = {}
    for index, (label, footprint) in enumerate(footprints.items()):
        if index == len(footprints)-1:
            bands[label] = remaining
        else:
            mask = shapely.union_all([footprint, *extensions[label]])
            bands[label] = remaining.intersection(mask)
            remaining = remaining.difference(mask)
    return bands


def candidates(lakes, flevoland):
    for props, geometry in lakes:
        if props.get("year_built", 0) >= 1940 and area_km2(geometry) >= 1000:
            name = props["name"]
            yield Candidate(code(name), name + " site", (props.get("name_zh") or name) + "库址",
                            RESERVOIR, geometry.simplify(0.005))

    pixels = hgo_pixels()
    for row in gpd.read_file(DATA / "ne_10m_lakes_historic.zip").itertuples():
        target = shapely.make_valid(row.geometry)
        if row.name == "Aral Sea":
            groups = defaultdict(list)
            for name, cells in pixels.items():
                if "Aral Sea" in name:
                    year = re.search(r"\d{4}$", name)
                    groups[year.group() if year else "BASIN"].extend(cells)
            for year, geometry in fit_bands(groups, target).items():
                en = "residual basin" if year == "BASIN" else f"dried by {year}"
                zh = "残余湖盆" if year == "BASIN" else f"{year} 年前"
                yield Candidate("ARAL"+year, f"Aral seabed ({en})", f"咸海干涸湖床（{zh}）",
                                ARAL, geometry)
        else:
            zh = {"Lake Chad": "乍得湖", "Lake Texcoco": "特斯科科湖", "Lop Nur": "罗布泊"}[row.name]
            yield Candidate(code(row.name), row.name + " lakebed", zh + "故湖床",
                            HISTORIC, target.simplify(0.005))

    translations = {"Rann of Kutch": "卡奇沼泽", "Salar de Uyuni": "乌尤尼盐沼",
                    "Etosha Pan": "埃托沙盐沼", "Chott el Djerid": "杰里德盐湖",
                    "Chott el Fejaj": "费贾杰盐湖", "Makgadikgadi Pans": "马卡迪卡迪盐沼",
                    "Aralkum Desert": "阿拉尔库姆沙漠"}
    playas = defaultdict(list)
    for row in gpd.read_file(DATA / "ne_10m_playas.zip").itertuples():
        geometry = shapely.make_valid(row.geometry)
        if area_km2(geometry) >= 500:
            name = row.name if pd.notna(row.name) else f"Salt flat {row.Index+1}"
            zh = translations.get(name, row.name_zh if pd.notna(row.name_zh) else f"盐沼{row.Index+1}")
            playas[name, zh].append(geometry)
    for (name, zh), pieces in playas.items():
        yield Candidate("PLAYA_"+code(name), name, zh, PLAYA, shapely.union_all(pieces).simplify(0.005))

    groups = {"Noordoostpolder": pixels["Northern Flevoland"] + pixels["Northern Zuiderzee"],
              "Flevopolder": pixels["Flevoland"] + pixels["South Zuiderzee"]}
    names = {"Noordoostpolder": "东北圩田", "Flevopolder": "弗莱福圩田"}
    for name, geometry in fit_bands(groups, flevoland).items():
        yield Candidate(code(name), name, names[name], POLDER, geometry, "NL230")


# Natural Earth name_zh mixes traditional characters and literal translations.
ZH_CHARS = str.maketrans("賓庫薩馬諾亞爾蘇瑪麗鎮壩紐邁鹽連窪澤羅", "宾库萨马诺亚尔苏玛丽镇坝纽迈盐连洼泽罗")
ZH_OVERRIDES = {
    "Votkinsk Reservoir site": "沃特金斯克水库库址", "Réservoir Manicouagan site": "马尼夸根水库库址",
    "Khantayskoye Reservoir site": "汉泰水库库址", "Kainji Reservoir site": "卡因吉水库库址",
    "Professor Doctor Ingenieur W. J. Van Blommestein Meer site": "布罗科蓬多水库库址",
    "Represa Três Marias site": "三玛丽亚斯水库库址", "Lago Rincón del Bonete site": "里孔德尔博内特水库库址",
    "Fortescue River Floodout": "福特斯库河泛滥平原", "Daryacheh-ye Sistan": "锡斯坦湖",
    "Kevir-e Namak": "纳马克盐漠", "Hamun-e Jaz Murian": "贾兹穆里安湖", "Gowd-e Zereh": "泽雷洼地",
    "Chott Melrhir": "迈勒吉尔盐湖", "Chott ech Chergui": "谢尔吉盐湖", "Kavir-e Abarkuh": "阿巴尔库盐漠",
    "Namakzar-e Shadad": "沙达德盐沼", "Lake Sakakawea site": "萨卡卡维亚湖库址",
}
EN_OVERRIDES = {"Professor Doctor Ingenieur W. J. Van Blommestein Meer site": "Brokopondo Reservoir site"}


def display_names(site):
    en = EN_OVERRIDES.get(site.name_en, site.name_en)
    zh = ZH_OVERRIDES.get(site.name_en, site.name_zh).translate(ZH_CHARS)
    if en.startswith("Salt flat "):
        en, zh = "Salt flat", "盐沼"
    return en, zh


def build_rules(parents, lakes, sites):
    ids = list(parents)
    tree = shapely.STRtree([parents[fid][1] for fid in ids])
    visible = [g for p, g in lakes if any(lake_visible(p, year) for year in (1936, 1939))]
    waters = shapely.STRtree(visible)
    occupied = []
    entries, features = {}, []
    counts, parts, touched = Counter(), Counter(), defaultdict(set)
    for site in sites:
        counts[site.source] += 1
        mask = shapely.make_valid(site.geometry)
        exclusions = [visible[i] for i in waters.query(mask, predicate="intersects")]
        exclusions.extend(g for g in occupied if g.intersects(mask))
        if exclusions:
            mask = mask.difference(shapely.union_all(exclusions))
        occupied.append(mask)
        for i in sorted(tree.query(mask, predicate="intersects")):
            fid = ids[i]
            if site.parent and fid != site.parent:
                continue
            names, parent = parents[fid]
            pieces = [g for g in polygons(mask.intersection(parent)) if area_km2(g) >= 30]
            if not pieces:
                continue
            key = fid + "__" + site.suffix
            features.append(dict(type="Feature", properties={"unit": key},
                                 geometry=mapping(shapely.union_all(pieces))))
            entry = entries.setdefault(fid, dict(id="water_shapes_"+fid, feature_ids=[fid], parts=[],
                                                  remainder=dict(suffix="REST", full_name=True, **names),
                                                  sources=[]))
            name_en, name_zh = display_names(site)
            # Parts carry the parent name as prefix: one reservoir spans many parcels.
            entry["parts"].append(dict(suffix=site.suffix, name_en=name_en, name_zh=name_zh,
                                       polygon_source=dict(path=MASK_FILE, property="unit",
                                                                           values=[key])))
            if site.source not in entry["sources"]:
                entry["sources"].append(site.source)
            parts[site.source] += 1
            touched[site.source].add(fid)
    for source in counts:
        print(f"{source}: candidates={counts[source]} entries={len(touched[source])} parts={parts[source]}")
    print(f"Total: candidates={sum(counts.values())} entries={len(entries)} parts={len(features)}")
    rules = dict(version=1, scenarios=["hoi4_1936", "hoi4_1939"], area_tolerance_degrees2=1e-9,
                 entries=[entries[fid] for fid in sorted(entries)])
    return rules, dict(type="FeatureCollection", features=features)


def main():
    topology = _absolute_topology(read(SCENARIO / "runtime_topology.topo.json"))
    locales = read(DATA / "locales.json")["geo"]
    patch = read(SCENARIO / "geo_locale_patch.json")["geo"]
    lakes = [(f["properties"], shapely.make_valid(shape(f["geometry"])))
             for f in read(DATA / "global_lakes.geojson")["features"]]
    flevoland = next(r for r in topology["objects"]["political"]["geometries"]
                     if r["properties"]["id"] == "NL230")
    sites = list(candidates(lakes, _decode_geometry(topology, flevoland)))
    site_bounds = shapely.STRtree([site.geometry.envelope for site in sites])
    arc_bounds = [shapely.total_bounds(shapely.points(arc)) for arc in topology["arcs"]]
    parents = {}
    for row in topology["objects"]["political"]["geometries"]:
        props = row["properties"]
        fid = props["id"]
        rings = row["arcs"] if row["type"] == "MultiPolygon" else [row["arcs"]]
        bounds = np.array([arc_bounds[i if i >= 0 else ~i] for polygon in rings for i in polygon[0]])
        envelope = shapely.box(*bounds[:, :2].min(axis=0), *bounds[:, 2:].max(axis=0))
        if not len(site_bounds.query(envelope)):
            continue
        names = patch.get("id::"+fid) or patch.get(fid) or locales.get("id::"+fid, {})
        en = names.get("en") or props.get("name_en") or props.get("name") or fid
        zh = names.get("zh") or props.get("name_zh") or en
        parents[fid] = (dict(name_en=en, name_zh=zh), shapely.make_valid(_decode_geometry(topology, row)))
    rules, masks = build_rules(parents, lakes, sites)
    for filename, payload in [("hoi4_water_shapes.geometry_splits.json", rules), (MASK_FILE, masks)]:
        (DATA / "scenario-rules" / filename).write_text(json.dumps(payload, ensure_ascii=False, indent=2)
                                                       + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
