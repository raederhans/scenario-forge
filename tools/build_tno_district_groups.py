"""按人工审核的规格为 tno_1962 生成剧本大区（district_groups.manual.json）。

规格文件：tools/district_specs/tno_1962.json
- tags.<TAG>.districts 是有序列表；每个大区用 match 子句描述成员。
- 子句内各字段为“且”，多个子句之间为“或”。可用字段：
  cntr（cntr_code 列表）、prov（省级键列表，支持 fnmatch 通配）、
  id（地块 ID 列表）、id_prefix（ID 前缀列表，合并块按多数成员判断）、name / name_prefix（名称或名称前缀列表）、
  bbox（[minLon, minLat, maxLon, maxLat]，按质心判断）、atl（Atlantropa 区域组列表）。
- 匹配顺序：先看所有大区的 id 显式指派，再按大区列表顺序取第一个命中的子句。
- 仍未命中的地块（离岛、飞地、无省级信息的合并块）挂到同一 TAG 中质心最近的已指派地块所在大区。

省级键（prov）按以下顺序解析：
hierarchy.json 分组 → 合并块成员（合并计划累计记录 + manifest）的多数分组 → `<cntr>_<admin1_group>`（非字母数字替换为 _） → PL_POW 编码推出的省。

输出：scenario_mutations.json 的 district_groups（编辑源）与物化后的 district_groups.manual.json。
合并地块 ID 变化后直接重跑：
  python tools/build_tno_district_groups.py
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.scenario_context import (  # noqa: E402
    load_scenario_context,
    load_scenario_mutations_payload,
    write_json_transaction,
)
from map_builder.scenario_district_groups_service import build_district_groups_payload_in_context  # noqa: E402

SCENARIO_DIR = ROOT / "data" / "scenarios" / "tno_1962"
DEFAULT_SPEC = ROOT / "tools" / "district_specs" / "tno_1962.json"

# TERYT 省代码 → hierarchy.json 中的波兰省分组名
PL_TERYT_VOIVODESHIPS = {
    "02": "PL_Lower_Silesian", "04": "PL_Kuyavian_Pomeranian", "06": "PL_Lublin",
    "08": "PL_Lubusz", "10": "PL_Lodz", "12": "PL_Lesser_Poland", "14": "PL_Masovian",
    "16": "PL_Opole", "18": "PL_Subcarpathian", "20": "PL_Podlaskie", "22": "PL_Pomeranian",
    "24": "PL_Silesian", "26": "PL_Holy_Cross", "28": "PL_Warmian_Masurian",
    "30": "PL_Greater_Poland", "32": "PL_West_Pomeranian",
}


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def ring_points(arcs, arc_refs):
    points = []
    for ref in arc_refs:
        arc = arcs[ref] if ref >= 0 else arcs[~ref]
        points.extend(arc)
    return points


def geometry_points_topo(arcs, geometry):
    kind = geometry.get("type")
    if kind == "Polygon":
        polygons = [geometry["arcs"]]
    elif kind == "MultiPolygon":
        polygons = geometry["arcs"]
    else:
        return []
    points = []
    for polygon in polygons:
        if polygon:
            points.extend(ring_points(arcs, polygon[0]))
    return points


def geometry_points_geojson(geometry):
    kind = (geometry or {}).get("type")
    if kind == "Polygon":
        polygons = [geometry["coordinates"]]
    elif kind == "MultiPolygon":
        polygons = geometry["coordinates"]
    else:
        return []
    points = []
    for polygon in polygons:
        if polygon:
            points.extend(polygon[0])
    return points


def centroid(points):
    if not points:
        return None
    # 经度跨越反子午线时按 0–360 计算，避免质心落到地图另一侧。
    lons = [p[0] for p in points]
    if max(lons) - min(lons) > 180:
        lons = [lon + 360 if lon < 0 else lon for lon in lons]
    lon = sum(lons) / len(lons)
    if lon > 180:
        lon -= 360
    return [lon, sum(p[1] for p in points) / len(points)]


def load_features(scenario_dir: Path = SCENARIO_DIR):
    """返回 {feature_id: record}，覆盖 owners.by_feature.json 中的全部地块。"""
    owners = read_json(scenario_dir / "owners.by_feature.json")["owners"]
    topo = read_json(scenario_dir / "runtime_topology.topo.json")
    hierarchy = read_json(ROOT / "data" / "hierarchy.json").get("groups", {})
    manifest = read_json(scenario_dir / "manifest.json")
    # 合并成员：全局/按剧本合并计划的累计记录 + 剧本 manifest 声明的合并。
    merges = {}
    migrations = read_json(ROOT / "data" / "feature-migrations" / "political_feature_merges.v1.json")
    for plan in migrations.get("plans", []):
        scenarios = plan.get("scenarios")
        if scenarios is None or scenario_dir.name in scenarios:
            merges.update(plan.get("groups") or {})
    merges.update((manifest.get("hierarchy_overrides") or {}).get("feature_merges") or {})

    hier_by_id = {}
    for group_id, children in hierarchy.items():
        for child in children or []:
            hier_by_id.setdefault(str(child), group_id)

    def merged_leaves(feature_id, seen=None):
        seen = seen or set()
        if feature_id in seen:
            return []
        seen.add(feature_id)
        members = merges.get(feature_id)
        if not members:
            return [feature_id]
        leaves = []
        for member in members:
            leaves.extend(merged_leaves(member, seen))
        return leaves

    def resolve_prov(feature_id, cntr, admin1):
        if feature_id in hier_by_id:
            return hier_by_id[feature_id]
        if feature_id in merges:
            votes = Counter(hier_by_id[leaf] for leaf in merged_leaves(feature_id) if leaf in hier_by_id)
            if votes:
                return votes.most_common(1)[0][0]
        if admin1:
            return f"{cntr}_" + re.sub(r"[^A-Za-z0-9]", "_", admin1)
        if feature_id.startswith("PL_POW_"):
            return PL_TERYT_VOIVODESHIPS.get(feature_id[7:9], "")
        return ""

    props_by_id = {}
    points_by_id = {}
    arcs = topo["arcs"]
    for object_name in ("political", "scenario_atlantropa"):
        for geometry in topo["objects"].get(object_name, {}).get("geometries", []):
            props = geometry.get("properties") or {}
            feature_id = str(props.get("id") or "")
            if not feature_id:
                continue
            props_by_id[feature_id] = {**props, "__object": object_name}
            points_by_id[feature_id] = geometry_points_topo(arcs, geometry)

    # 拓扑里的政治几何是简化版，质心优先用 detail chunks 的原始坐标。
    for chunk_path in sorted((scenario_dir / "chunks").glob("political.detail.*.json")):
        for feature in read_json(chunk_path).get("features", []):
            feature_id = str((feature.get("properties") or {}).get("id") or "")
            if feature_id in owners:
                points = geometry_points_geojson(feature.get("geometry"))
                if points:
                    points_by_id[feature_id] = points

    records = {}
    for feature_id, tag in owners.items():
        props = props_by_id.get(feature_id, {})
        cntr = str(props.get("cntr_code") or "").upper()
        admin1 = str(props.get("admin1_group") or "")
        records[feature_id] = {
            "id": feature_id,
            "tag": str(tag).upper(),
            "cntr": cntr,
            "admin1": admin1,
            "name": str(props.get("name") or ""),
            "prov": resolve_prov(feature_id, cntr, admin1),
            "leaves": merged_leaves(feature_id) if feature_id in merges else [],
            "atl": str(props.get("atl_region_group") or "") if props.get("__object") == "scenario_atlantropa" else "",
            "center": centroid(points_by_id.get(feature_id, [])),
        }
    return records


def id_has_prefix(record, prefix):
    if record["id"].startswith(prefix):
        return True
    # 合并块 ID 不带 NUTS 编码，按多数成员的前缀判断。
    leaves = record["leaves"]
    return bool(leaves) and sum(leaf.startswith(prefix) for leaf in leaves) * 2 > len(leaves)


def clause_matches(clause, record):
    if "cntr" in clause and record["cntr"] not in clause["cntr"]:
        return False
    if "prov" in clause and not any(fnmatch.fnmatchcase(record["prov"], pattern) for pattern in clause["prov"]):
        return False
    if "id" in clause and record["id"] not in clause["id"]:
        return False
    if "id_prefix" in clause and not any(id_has_prefix(record, prefix) for prefix in clause["id_prefix"]):
        return False
    if "name" in clause and record["name"] not in clause["name"]:
        return False
    if "name_prefix" in clause and not any(record["name"].startswith(prefix) for prefix in clause["name_prefix"]):
        return False
    if "atl" in clause and record["atl"] not in clause["atl"]:
        return False
    if "bbox" in clause:
        center = record["center"]
        if not center:
            return False
        min_lon, min_lat, max_lon, max_lat = clause["bbox"]
        if not (min_lon <= center[0] <= max_lon and min_lat <= center[1] <= max_lat):
            return False
    return True


def distance(a, b):
    if not a or not b:
        return math.inf
    dlon = abs(a[0] - b[0])
    dlon = min(dlon, 360 - dlon) * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot(dlon, a[1] - b[1])


def assign_tag(tag, tag_spec, records):
    districts = tag_spec["districts"]
    district_ids = [district["id"] for district in districts]
    if len(set(district_ids)) != len(district_ids):
        raise ValueError(f"{tag}: 大区 id 重复")
    members = [record for record in records.values() if record["tag"] == tag]
    assignment = {}
    explicit = {}
    for district in districts:
        for clause in district.get("match", []):
            if set(clause) == {"id"}:
                for feature_id in clause["id"]:
                    if feature_id in explicit and explicit[feature_id] != district["id"]:
                        raise ValueError(f"{tag}: {feature_id} 被显式指派到多个大区")
                    explicit[feature_id] = district["id"]
    for record in members:
        if record["id"] in explicit:
            assignment[record["id"]] = (explicit[record["id"]], "explicit")
            continue
        for district in districts:
            if any(clause_matches(clause, record) for clause in district.get("match", [])):
                assignment[record["id"]] = (district["id"], "rule")
                break
    unmatched = [record for record in members if record["id"] not in assignment]
    anchors = [(records[feature_id]["center"], district_id) for feature_id, (district_id, _) in assignment.items()]
    for record in unmatched:
        best = min(anchors, key=lambda anchor: distance(anchor[0], record["center"]), default=None)
        if best is None or best[0] is None or record["center"] is None:
            raise ValueError(f"{tag}: {record['id']} 无法就近归入大区")
        assignment[record["id"]] = (best[1], "nearest")
    return assignment


def build_tags(spec, records):
    """按规格生成 {TAG: {tag, districts}}，记录格式与 scenario_district_groups_service 一致。"""
    tags = {}
    report = {}
    empty = []
    for tag, tag_spec in spec["tags"].items():
        assignment = assign_tag(tag, tag_spec, records)
        by_district = defaultdict(list)
        sources = Counter()
        for feature_id, (district_id, source) in assignment.items():
            by_district[district_id].append(feature_id)
            sources[source] += 1
        districts = {}
        for district in tag_spec["districts"]:
            feature_ids = sorted(by_district.get(district["id"], []))
            if not feature_ids:
                empty.append(f"{tag}::{district['id']}")
                continue
            districts[district["id"]] = {
                "district_id": district["id"],
                "name_en": district["name_en"],
                "name_zh": district["name_zh"],
                "feature_ids": feature_ids,
            }
        tags[tag] = {"tag": tag, "districts": districts}
        report[tag] = {
            "features": len(assignment),
            "districts": {district_id: len(ids) for district_id, ids in sorted(by_district.items())},
            "sources": dict(sources),
            "nearest": sorted(feature_id for feature_id, (_, source) in assignment.items() if source == "nearest"),
        }
    if empty:
        raise ValueError(f"以下大区没有任何地块，请检查规则：{', '.join(empty)}")
    return tags, report


def materialize(tags, scenario_id="tno_1962"):
    """把生成的大区并入 scenario_mutations.json 的 district_groups（编辑源），
    再用项目自身的物化逻辑得到 district_groups.manual.json。
    规格之外的 TAG 保持原样，开发工作区之后保存大区也不会丢失这些数据。"""
    context = load_scenario_context(scenario_id)
    mutations = load_scenario_mutations_payload(context)
    mutations["district_groups"] = {**mutations["district_groups"], **tags}
    payload = build_district_groups_payload_in_context(context, mutations)
    # 保持重跑无差异：不写入时间戳。
    payload["generated_at"] = ""
    return context, mutations, payload


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--report", type=Path, help="把各大区地块数与就近归入清单写成 JSON")
    parser.add_argument("--dump-features", type=Path, help="导出地块属性表（用于编写规则）后退出")
    args = parser.parse_args(argv)

    records = load_features()
    if args.dump_features:
        args.dump_features.parent.mkdir(parents=True, exist_ok=True)
        args.dump_features.write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding="utf-8")
        return 0

    tags, report = build_tags(read_json(args.spec), records)
    context, mutations, payload = materialize(tags)
    write_json_transaction([
        (Path(context["mutationsPath"]), mutations),
        (Path(context["districtGroupsPath"]), payload),
    ])
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    for tag, info in report.items():
        print(f"{tag}: {info['features']} 地块 / {len(info['districts'])} 大区 / 来源 {info['sources']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
