from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path

from shapely.geometry import GeometryCollection, shape

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.scenario_topology_decode import topology_object_to_geojson

SCENARIO_IDS = ("hoi4_1936", "hoi4_1939")
LOCALISATION_DIR = Path(
    "C:/Program Files (x86)/Steam/steamapps/common/Hearts of Iron IV/localisation"
)
FOREIGN_FRAGMENT_MAX_MEMBERS = 5
FOREIGN_FRAGMENT_MIN_DISTANCE_KM = 500
MANUAL_DISTRICT_OVERRIDES = {
    scenario_id: {
        "ENG": {"state_136": {"name_en": "Scotland", "name_zh": "苏格兰"}},
        "JAP": {
            "state_409": {"name_en": "Southern Kurils", "name_zh": "南千岛"},
            "state_874": {"name_en": "Northern Kurils", "name_zh": "北千岛"},
        },
        "RAJ": {"state_293": {"name_en": "Aden", "name_zh": "亚丁"}},
    }
    for scenario_id in SCENARIO_IDS
}


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def json_text(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def load_state_names(language: str) -> dict[int, str]:
    path = LOCALISATION_DIR / language / f"state_names_l_{language}.yml"
    pattern = re.compile(r'^\s*STATE_(\d+):\d*\s*"((?:\\.|[^"\\])*)"', re.MULTILINE)
    return {
        int(state): name.replace('\\"', '"')
        for state, name in pattern.findall(path.read_text(encoding="utf-8-sig"))
    }


def arc_indices(refs):
    for ref in refs:
        if isinstance(ref, list):
            yield from arc_indices(ref)
        else:
            yield ref if ref >= 0 else ~ref


def load_geometry(scenario_dir: Path, owners: dict):
    topology = read_json(scenario_dir / "runtime_topology.topo.json")
    arc_members = defaultdict(set)
    for feature in topology["objects"]["political"]["geometries"]:
        feature_id = feature["properties"]["id"]
        for index in set(arc_indices(feature["arcs"])):
            arc_members[index].add(feature_id)
    adjacency = {feature_id: {} for feature_id in owners}
    transform = topology.get("transform")
    for index, members in sorted(arc_members.items()):
        if len(members) < 2:
            continue
        arc = topology["arcs"][index]
        if transform:
            sx, sy = transform["scale"]
            length = sum(math.hypot(dx * sx, dy * sy) for dx, dy in arc[1:])
        else:
            length = sum(math.dist(a, b) for a, b in zip(arc, arc[1:]))
        if length == 0:
            continue
        for left, right in combinations(sorted(members), 2):
            if owners[left] == owners[right]:
                adjacency[left][right] = adjacency[left].get(right, 0) + length
                adjacency[right][left] = adjacency[right].get(left, 0) + length
    features = topology_object_to_geojson(topology, "political")["features"]
    geometries = {
        feature["properties"]["id"]: shape(feature["geometry"])
        for feature in features
    }
    return adjacency, geometries


def connected_components(members: set[str], adjacency: dict) -> list[set[str]]:
    remaining = set(members)
    components = []
    while remaining:
        start = min(remaining)
        remaining.remove(start)
        component = {start}
        pending = [start]
        while pending:
            current = pending.pop()
            neighbors = remaining.intersection(adjacency[current])
            remaining.difference_update(neighbors)
            component.update(neighbors)
            pending.extend(sorted(neighbors))
        components.append(component)
    return components


def adjacent_state(members: set[str], assignments: dict, adjacency: dict, excluded=None):
    lengths = defaultdict(float)
    for feature_id in sorted(members):
        for neighbor, length in sorted(adjacency[feature_id].items()):
            state = assignments.get(neighbor)
            if state is not None and state != excluded:
                lengths[state] += length
    return min(lengths, key=lambda state: (-lengths[state], state)) if lengths else None


def assign_tag(feature_ids: list[str], buckets: dict, adjacency: dict, geometries: dict):
    regular_ids = [feature_id for feature_id in feature_ids if "_SHELL_FB_" not in feature_id]
    base_ids = regular_ids or feature_ids
    fill_ids = sorted(set(feature_ids) - set(base_ids))
    groups = defaultdict(set)
    assignments = {}
    unassigned = []
    for feature_id in sorted(base_ids):
        match = re.fullmatch(r"s(\d+)", buckets.get(feature_id, ""))
        if match:
            state = int(match[1])
            groups[state].add(feature_id)
            assignments[feature_id] = state
        else:
            unassigned.append(feature_id)
    if not groups:
        return {}, 0, 0
    points = {feature_id: geometries[feature_id].representative_point() for feature_id in feature_ids}
    for feature_id in unassigned:
        state = adjacent_state({feature_id}, assignments, adjacency)
        if state is None:
            state = min(
                groups,
                key=lambda candidate: (
                    min(points[feature_id].distance(points[member]) for member in groups[candidate]),
                    candidate,
                ),
            )
        groups[state].add(feature_id)
        assignments[feature_id] = state
    corrections = 0
    changed = True
    while changed:
        changed = False
        for state in sorted(groups):
            components = connected_components(groups[state], adjacency)
            components.sort(key=lambda component: (
                -sum(geometries[feature_id].area for feature_id in sorted(component)),
                min(component),
            ))
            for component in components[1:]:
                target = adjacent_state(component, assignments, adjacency, excluded=state)
                if target is None:
                    continue
                groups[state].difference_update(component)
                groups[target].update(component)
                for feature_id in component:
                    assignments[feature_id] = target
                corrections += 1
                changed = True
    base_groups = {state: set(members) for state, members in groups.items()}
    for feature_id in fill_ids:
        state = adjacent_state({feature_id}, assignments, adjacency)
        if state is None:
            state = min(
                base_groups,
                key=lambda candidate: (
                    min(points[feature_id].distance(points[member]) for member in base_groups[candidate]),
                    candidate,
                ),
            )
        groups[state].add(feature_id)
    merged = len(unassigned) + sum(
        re.fullmatch(r"s(\d+)", buckets.get(feature_id, "")) is None
        for feature_id in fill_ids
    )
    return dict(groups), merged, corrections


def merge_antarctic_groups(groups: dict, geometries: dict):
    antarctic_states = sorted(
        state for state, members in groups.items()
        if all(geometries[feature_id].bounds[3] <= -60 for feature_id in members)
    )
    if not antarctic_states:
        return None
    target = antarctic_states[0]
    for state in antarctic_states[1:]:
        groups[target].update(groups.pop(state))
    return target


def merge_foreign_fragments(groups, tag, state_buckets, scenario_tags, keep_states, adjacency, geometries, state_points):
    """小块（≤5 地块）被分到另一个现存国家的游戏州、且离该州胜利点很远时，州名会误导
    （如西北领地出现“萨斯喀彻温”、阿拉斯加出现“华盛顿”），并入同 tag 中相邻或最近的组。
    离州胜利点近的（如苏联各自治共和国的小组）是真实的地理归属，保留。人工覆盖与南极组除外。"""
    def foreign(state):
        owner = (state_buckets.get(f"s{state}") or {}).get("owner_tag")
        if (state in keep_states or not owner or owner == tag or owner not in scenario_tags
                or len(groups[state]) > FOREIGN_FRAGMENT_MAX_MEMBERS or state not in state_points):
            return False
        centroid = GeometryCollection([geometries[member] for member in sorted(groups[state])]).centroid
        return distance_km(state_points[state], (centroid.x, centroid.y)) > FOREIGN_FRAGMENT_MIN_DISTANCE_KM
    merged = 0
    for state in sorted(groups):
        if state not in groups or not foreign(state) or len(groups) < 2:
            continue
        members = groups[state]
        assignments = {feature_id: other for other, ids in groups.items() if other != state for feature_id in ids}
        target = adjacent_state(members, assignments, adjacency, excluded=state)
        if target is None:
            point = geometries[min(members)].representative_point()
            target = min(
                (other for other in groups if other != state),
                key=lambda other: (min(point.distance(geometries[member].representative_point()) for member in groups[other]), other),
            )
        groups[target].update(groups.pop(state))
        merged += 1
    return merged


def distance_km(left: tuple[float, float], right: tuple[float, float]) -> float:
    lon1, lat1 = map(math.radians, left)
    lon2, lat2 = map(math.radians, right)
    haversine = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * 6371.0088 * math.asin(min(1, math.sqrt(haversine)))


def find_suspicious(scenario_id, tag, districts, feature_ids, geometries, buckets, state_points):
    suspicious = []
    for district_id, district in districts.items():
        members = set(district["feature_ids"])
        state = int(district_id.removeprefix("state_"))
        game_owner = buckets[f"s{state}"]["owner_tag"]
        reasons = []
        if game_owner != tag:
            rest = GeometryCollection([
                geometries[feature_id] for feature_id in sorted(set(feature_ids) - members)
            ]).centroid
            distance = distance_km(state_points[state], (rest.x, rest.y))
            if distance > 1500:
                reasons.append(f"游戏归属 {game_owner} 与当前 {tag} 不同，距其余地块质心 {distance:.1f} km")
        fill_count = sum("_SHELL_FB_" in feature_id for feature_id in members)
        if fill_count / len(members) >= 0.8:
            reasons.append(f"补洞地块占比 {fill_count}/{len(members)}（≥80%）")
        if len(members) == 1:
            reasons.append("单地块组")
        if reasons:
            suspicious.append({
                "scenario_id": scenario_id,
                "tag": tag,
                "district_id": district_id,
                "name_en": district["name_en"],
                "name_zh": district["name_zh"],
                "member_count": len(members),
                "reasons": reasons,
            })
    return suspicious


def build_scenario(scenario_id: str) -> tuple[dict, dict]:
    scenario_dir = ROOT / "data" / "scenarios" / scenario_id
    owners = read_json(scenario_dir / "owners.by_feature.json")["owners"]
    strategic = read_json(scenario_dir / "strategic_values.by_feature.json")
    buckets = strategic["bucket_by_feature"]
    state_points = {}
    located_points = [point for point in strategic["victory_points"] if point["match_method"] != "unmatched"]
    for point in sorted(located_points, key=lambda point: (-point["value"], point["province_id"])):
        state_points.setdefault(point["state_id"], (point["lon"], point["lat"]))
    scenario_tags = set(read_json(scenario_dir / "countries.json")["countries"])
    english = load_state_names("english")
    chinese = load_state_names("simp_chinese")
    adjacency, geometries = load_geometry(scenario_dir, owners)
    by_tag = defaultdict(list)
    for feature_id, tag in owners.items():
        by_tag[tag].append(feature_id)
    payload = {"version": 1, "generated_at": "", "scenario_id": scenario_id, "tags": {}}
    report = {"scenario_id": scenario_id, "tags": {}, "suspicious": []}
    for tag in sorted(by_tag):
        groups, merged, corrections = assign_tag(by_tag[tag], buckets, adjacency, geometries)
        antarctic_state = merge_antarctic_groups(groups, geometries)
        overridden = {
            int(district_id.removeprefix("state_"))
            for district_id in MANUAL_DISTRICT_OVERRIDES.get(scenario_id, {}).get(tag, {})
        }
        merge_foreign_fragments(
            groups, tag, strategic["buckets"], scenario_tags,
            overridden | ({antarctic_state} if antarctic_state is not None else set()), adjacency, geometries,
            state_points,
        )
        districts = {}
        missing_zh = []
        for state in sorted(groups):
            district_id = f"state_{state}"
            name_en = english[state]
            name_zh = chinese.get(state) or name_en
            if not chinese.get(state):
                missing_zh.append(f"STATE_{state}")
            districts[district_id] = {
                "district_id": district_id,
                "name_en": name_en,
                "name_zh": name_zh,
                "feature_ids": sorted(groups[state]),
            }
            districts[district_id].update(
                MANUAL_DISTRICT_OVERRIDES.get(scenario_id, {}).get(tag, {}).get(district_id, {})
            )
            if state == antarctic_state:
                districts[district_id].update(name_en="Antarctic Territory", name_zh="南极属地")
        for field in ("name_en", "name_zh"):
            counts = Counter(district[field] for district in districts.values())
            seen = Counter()
            for district in districts.values():
                name = district[field]
                if counts[name] > 1:
                    seen[name] += 1
                    district[field] = f"{name} ({seen[name]})"
        if len(districts) >= 2:
            payload["tags"][tag] = {"tag": tag, "districts": districts}
            report["suspicious"].extend(find_suspicious(
                scenario_id, tag, districts, by_tag[tag], geometries, strategic["buckets"], state_points,
            ))
        report["tags"][tag] = {
            "group_count": len(districts),
            "merged_pool_feature_count": merged,
            "fragment_correction_count": corrections,
            "single_feature_groups": [
                district_id for district_id, district in districts.items()
                if len(district["feature_ids"]) == 1
            ],
            "missing_zh_names": missing_zh,
        }
    return payload, report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    matches = True
    for scenario_id in SCENARIO_IDS:
        payload, report = build_scenario(scenario_id)
        scenario_dir = ROOT / "data" / "scenarios" / scenario_id
        output_path = scenario_dir / "district_groups.manual.json"
        manifest_path = scenario_dir / "manifest.json"
        manifest = read_json(manifest_path)
        url = f"data/scenarios/{scenario_id}/district_groups.manual.json"
        if args.check:
            matched = (
                output_path.exists()
                and read_json(output_path) == payload
                and manifest.get("district_groups_url") == url
            )
            matches = matches and matched
            print(f"{scenario_id}: {'OK' if matched else 'MISMATCH'}")
        else:
            output_path.write_text(json_text(payload), encoding="utf-8")
            manifest["district_groups_url"] = url
            manifest_path.write_text(json_text(manifest), encoding="utf-8")
            report_path = ROOT / ".runtime" / "reports" / "generated" / f"hoi4_state_districts_{scenario_id}.json"
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(json_text(report), encoding="utf-8")
            print(f"{scenario_id}: {len(payload['tags'])} tags, {output_path}")
    return 0 if matches else 1


if __name__ == "__main__":
    raise SystemExit(main())
