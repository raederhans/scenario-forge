from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from copy import deepcopy
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.json_source import read_json_source
from map_builder.political_feature_merge_plans import ordered_plans
from scenario_builder.hoi4.crosswalk import _derive_subject_color_hex
from scenario_builder.hoi4.parser import load_hierarchy_groups
from tools.check_scenario_contracts import write_json
from tools.materialize_polar_scenarios import refresh_scenario

SCENARIOS = ("hoi4_1936", "hoi4_1939")
# Rules may also target TNO through tools/apply_tno_split_overlay.py; the CLI here stays HOI4-only.
RULE_SCENARIOS = (*SCENARIOS, "tno_1962")
SELECTORS = {"country_codes", "prefectures", "hierarchy_groups", "hoi4_states", "feature_ids",
             "owners", "bbox", "bboxes"}


def expand_merge_plans(plans, scenario):
    expanded = {}
    for _, plan in plans:
        if "scenarios" in plan and scenario not in plan["scenarios"]:
            continue
        for group in plan["groups"]:
            expanded[group["id"]] = set().union(
                *(expanded.get(member, {member}) for member in group["member_ids"])
            )
    return expanded


def make_point_lookup(topology):
    geometries = None
    points = {}

    def point_for_feature(fid):
        nonlocal geometries
        if fid not in points:
            from tools.patch_tno_1962_bundle import topology_object_to_gdf

            if geometries is None:
                frame = topology_object_to_gdf(topology, "political")
                geometries = dict(zip(frame["id"], frame.geometry))
            point = geometries[fid].representative_point()
            points[fid] = (point.x, point.y)
        return points[fid]

    return point_for_feature


def fill_prefecture_holes(prefectures, unresolved, leaves, expanded, point_for_feature):
    groups = deepcopy(prefectures)
    runtime_by_leaf = {leaf: fid for fid, children in leaves.items() for leaf in children}
    unresolved_provinces = {leaf: row["province_id"] for row in unresolved
                           for leaf in expanded.get(row["feature_id"], {row["feature_id"]})}
    group_by_leaf = {leaf: gid for gid, group in groups.items() for member in group["feature_ids"]
                     for leaf in expanded.get(member, {member})}
    candidates = {}
    for fid, children in leaves.items():
        if children & unresolved_provinces.keys():
            continue
        counts = Counter(group_by_leaf[leaf] for leaf in sorted(children) if leaf in group_by_leaf)
        if counts:
            gid = counts.most_common(1)[0][0]
            candidates.setdefault(groups[gid]["province_id"], []).append((fid, gid))
    filled = 0
    for leaf, province in unresolved_provinces.items():
        if leaf not in runtime_by_leaf:
            continue
        neighbors = candidates.get(province, [])
        if not neighbors:
            raise ValueError(f"unresolved leaf {leaf}: no resolved runtime feature in province {province}")
        x, y = point_for_feature(runtime_by_leaf[leaf])

        def distance(candidate):
            px, py = point_for_feature(candidate[0])
            return (px - x) ** 2 + (py - y) ** 2

        _, gid = min(neighbors, key=distance)
        groups[gid]["feature_ids"].append(leaf)
        filled += 1
    return groups, filled


def update_country(country, entry):
    for source, targets in (("name_en", ("display_name", "display_name_en")),
                            ("name_zh", ("display_name_zh",)),
                            ("color_hex", ("color_hex",)),
                            ("subject_kind", ("subject_kind",)), ("notes", ("notes",))):
        if source in entry:
            for target in targets:
                country[target] = entry[source]
    if "parent_owner_tag" in entry:
        country["parent_owner_tag"] = entry["parent_owner_tag"]
        country["parent_owner_tags"] = [entry["parent_owner_tag"]]
        country["entry_kind"] = "scenario_subject"
    if entry["id"] not in country.setdefault("rule_sources", []):
        country["rule_sources"].append(entry["id"])


def land_neighbors(topology):
    from tools.apply_hoi4_geometry_splits import arc_ids

    by_arc = defaultdict(set)
    neighbors = {}
    for geometry in topology["objects"]["political"]["geometries"]:
        fid = geometry["properties"]["id"]
        neighbors[fid] = set()
        for arc in arc_ids(geometry.get("arcs", [])):
            by_arc[arc].add(fid)
    for members in by_arc.values():
        for fid in members:
            neighbors[fid].update(members - {fid})
    return neighbors


def smooth_enclaves(owners, topology, tags, max_area_km2):
    from map_builder.regional_geometry import _absolute_topology, _decode_geometry
    from tools.apply_hoi4_geometry_splits import area_km2

    neighbors = land_neighbors(topology)
    absolute = _absolute_topology(topology)
    areas = {g["properties"]["id"]: area_km2(_decode_geometry(absolute, g))
             for g in absolute["objects"]["political"]["geometries"]
             if owners[g["properties"]["id"]] in tags}
    changed = set()
    while True:
        moved = False
        for fid in sorted(areas):
            if areas[fid] > max_area_km2:
                continue
            adjacent_tags = {owners[n] for n in neighbors[fid]}
            if len(adjacent_tags) == 1:
                target = next(iter(adjacent_tags))
                if target in tags and target != owners[fid]:
                    owners[fid] = target
                    changed.add(fid)
                    moved = True
        if not moved:
            return len(changed)


def apply_overlay(overlay, scenario, *, features, owners, cores, countries,
                  default_country, hierarchy_groups, country_meta, prefectures,
                  bucket_by_feature, plans, unresolved=(), point_for_feature=None, feature_splits=None,
                  topology=None):
    if overlay.get("version") != 1:
        raise ValueError("overlay version must be 1")
    ids = set()
    for entry in overlay["entries"]:
        eid = entry.get("id")
        if not eid or eid in ids:
            raise ValueError(f"entry {eid}: missing or duplicate id")
        ids.add(eid)
        if not entry.get("scenarios") or not set(entry["scenarios"]) <= set(RULE_SCENARIOS):
            raise ValueError(f"entry {eid}: invalid scenarios")
        if "smooth_enclaves" in entry:
            continue
        if not re.fullmatch(r"[A-Z0-9]{2,4}", entry.get("tag", "")):
            raise ValueError(f"entry {eid}: invalid tag")
        if "select" not in entry:
            raise ValueError(f"entry {eid}: missing select")
    entries = [e for e in overlay["entries"] if scenario in e["scenarios"]]
    declared = set(countries) | {e["tag"] for e in entries if "tag" in e}
    result_countries = deepcopy(countries)
    result_owners, result_cores = dict(owners), deepcopy(cores)
    expanded = expand_merge_plans(plans, scenario)
    split_leaves, split_expanded = {}, {}
    for parent, children in (feature_splits or {}).items():
        source_leaves = expanded.get(parent, {parent})
        for leaf in source_leaves:
            split_leaves[leaf] = {(child, leaf) for child in children}
        for child in children:
            split_expanded[child] = {(child, leaf) for leaf in source_leaves}
        split_expanded[parent] = set().union(*(split_expanded[child] for child in children))
    expanded = {fid: set().union(*(split_leaves.get(leaf, {leaf}) for leaf in leaves))
                for fid, leaves in expanded.items()}
    expanded.update(split_leaves)
    expanded.update(split_expanded)
    leaves = {fid: expanded.get(fid, {fid}) for fid in features}
    known_ids = set(features) | set(expanded) | set().union(*expanded.values())
    filled = 0
    if unresolved:
        prefectures, filled = fill_prefecture_holes(
            prefectures, unresolved, leaves, expanded, point_for_feature)
    report = {"entries": [], "partial_merged": [], "retired_tags": [],
              "filled_prefecture_leaf_count": filled}

    def select(selector, eid, field):
        unknown = set(selector) - SELECTORS
        if unknown:
            raise ValueError(f"entry {eid}: unknown selector {sorted(unknown)}")
        direct, selected_leaves = set(), set()
        direct.update(fid for fid, props in features.items()
                      if props.get("cntr_code") in selector.get("country_codes", []))
        direct.update(fid for fid in features if result_owners[fid] in selector.get("owners", []))
        for state in selector.get("hoi4_states", []):
            matches = {fid for fid in features if bucket_by_feature.get(fid) == f"s{state}"}
            if not matches:
                raise ValueError(f"entry {eid}: unknown state {state}")
            direct.update(matches)
        members = list(selector.get("feature_ids", []))
        for group in selector.get("hierarchy_groups", []):
            if group not in hierarchy_groups:
                raise ValueError(f"entry {eid}: unknown hierarchy group {group}")
            members.extend(hierarchy_groups[group])
        for query in selector.get("prefectures", []):
            matches = ([prefectures[query]] if query in prefectures else
                       [g for g in prefectures.values() if g["label"] == query])
            if len(matches) != 1:
                raise ValueError(f"entry {eid}: unknown or ambiguous prefecture {query}")
            members.extend(matches[0]["feature_ids"])
        for fid in selector.get("feature_ids", []):
            if fid not in known_ids:
                raise ValueError(f"entry {eid}: unknown feature {fid}")
        for member in members:
            selected_leaves.update(expanded.get(member, {member}))
        for fid, children in leaves.items():
            ratio = len(children & selected_leaves) / len(children)
            if 0 < ratio < 1:
                report["partial_merged"].append({"entry_id": eid, "runtime_id": fid,
                                                  "ratio": ratio, "selector": field})
            if ratio >= 0.5:
                direct.add(fid)
        if "bbox" in selector or "bboxes" in selector:
            boxes = list(selector.get("bboxes", []))
            if "bbox" in selector:
                boxes.append(selector["bbox"])
            candidates = direct if set(selector) - {"bbox", "bboxes"} else set(features)
            within = set()
            for fid in candidates:
                x, y = point_for_feature(fid)
                if any(left <= x <= right and bottom <= y <= top
                       for left, bottom, right, top in boxes):
                    within.add(fid)
            direct = within
        if not direct and field == "select":
            raise ValueError(f"entry {eid}: empty {field} selection")
        return direct

    for entry in entries:
        if "smooth_enclaves" in entry:
            changed = smooth_enclaves(result_owners, topology, **entry["smooth_enclaves"])
            report["entries"].append({"entry_id": entry["id"], "changed_count": changed})
            continue
        eid, tag = entry["id"], entry["tag"]
        selected = select(entry["select"], eid, "select")
        if "exclude" in entry:
            selected -= select(entry["exclude"], eid, "exclude")
        if "only_from_owners" in entry:
            selected = {fid for fid in selected if result_owners[fid] in entry["only_from_owners"]}
        if not selected:
            report["entries"].append({"entry_id": eid, "selected_count": 0, "changed_count": 0,
                                      "empty_after_filter": True})
            # A re-run filters out parcels the tag already holds; its metadata
            # (names, colour, parent) must still follow the overlay.
            if tag in result_countries:
                update_country(result_countries[tag], entry)
            continue
        mode = entry.get("cores", "owner")
        if isinstance(mode, list):
            if any(core not in declared for core in mode):
                raise ValueError(f"entry {eid}: undeclared core tag")
        elif mode not in ("owner", "keep"):
            raise ValueError(f"entry {eid}: invalid cores mode")
        if tag not in result_countries:
            if not entry.get("name_en") or not entry.get("name_zh"):
                raise ValueError(f"entry {eid}: new tag requires name_en and name_zh")
            parent = entry.get("parent_owner_tag", "")
            color = entry.get("color_hex")
            if not color:
                if not parent or parent not in result_countries:
                    raise ValueError(f"entry {eid}: new tag requires color or declared parent")
                color = _derive_subject_color_hex(result_countries[parent]["color_hex"], tag,
                                                  entry.get("subject_kind", ""))
            base = entry.get("base_iso2") or Counter(
                features[fid]["cntr_code"] for fid in sorted(selected)
            ).most_common(1)[0][0]
            result_countries[tag] = {
                "tag": tag, "color_hex": color, "base_iso2": base, "lookup_iso2": base,
                "provenance_iso2": base,
                **{key: country_meta.get(base, {}).get(key, "") for key in
                   ("continent_id", "continent_label", "subregion_id", "subregion_label")},
                "entry_kind": "scenario_subject" if parent else "",
                "parent_owner_tag": parent, "parent_owner_tags": [parent] if parent else [],
                "subject_kind": entry.get("subject_kind", ""), "featured": False,
                "historical_fidelity": "extended", "historical_fidelity_summary": ["extended"],
                "notes": entry.get("notes", ""), "primary_rule_source": eid, "rule_sources": [],
                "quality": "manual_reviewed", "source": "manual_rule",
                "source_type": "scenario_extension", "source_types": ["scenario_extension"],
                "scenario_only": True, "synthetic_owner": False, "capital_state_id": None,
                "feature_count": 0, "controller_feature_count": 0,
            }
        update_country(result_countries[tag], entry)
        changed = 0
        for fid in sorted(selected):
            new_cores = ([tag] if mode == "owner" else result_cores[fid] if mode == "keep" else list(mode))
            changed += result_owners[fid] != tag or result_cores[fid] != new_cores
            result_owners[fid], result_cores[fid] = tag, new_cores
        report["entries"].append({"entry_id": eid, "selected_count": len(selected), "changed_count": changed})

    before, after = Counter(owners.values()), Counter(result_owners.values())
    retired = {tag for tag in result_countries if before[tag] > 0 and after[tag] == 0}
    containers = set()
    while True:
        parents = {country.get("parent_owner_tag") for tag, country in result_countries.items()
                   if tag not in retired or tag in containers}
        added = retired & parents - containers
        if not added:
            break
        containers.update(added)
    for tag in containers:
        result_countries[tag]["entry_kind"] = "scenario_container"
    retired -= containers
    # A tag that still names a parent or a core of any parcel must stay declared.
    protected = ({default_country}
                 | {c.get("parent_owner_tag") for tag, c in result_countries.items() if tag not in retired}
                 | {core for feature_cores in result_cores.values() for core in feature_cores})
    if retired & protected:
        raise ValueError(f"entries {[e['id'] for e in entries]}: cannot retire protected tags {sorted(retired & protected)}")
    for tag in retired:
        del result_countries[tag]
    report["retired_tags"] = sorted(retired)
    assignments = {fid: {"parent_id": fid, "owner": result_owners[fid],
                         "controller": result_owners[fid], "cores": result_cores[fid]}
                   for fid in features if owners[fid] != result_owners[fid] or cores[fid] != result_cores[fid]}
    report["changed_count"] = len(assignments)
    return result_countries, assignments, report


def run_scenario(overlay, scenario_dir, *, data_dir=ROOT / "data", dry_run=False,
                 read=read_json_source, write=write_json, refresh=refresh_scenario,
                 load_plans=ordered_plans, load_hierarchy=load_hierarchy_groups,
                 point_lookup_factory=make_point_lookup):
    scenario_dir = Path(scenario_dir)
    topology = read(scenario_dir / "runtime_topology.topo.json")
    payload = read(scenario_dir / "countries.json")
    manifest = read(scenario_dir / "manifest.json")
    groups, meta = load_hierarchy(data_dir / "hierarchy.json")
    crosswalk = read(data_dir / "quick_fill/china_prefecture_crosswalk.v1.json")
    countries, assignments, report = apply_overlay(
        overlay, scenario_dir.name,
        features={g["properties"]["id"]: g["properties"] for g in topology["objects"]["political"]["geometries"]},
        owners=read(scenario_dir / "owners.by_feature.json")["owners"],
        cores=read(scenario_dir / "cores.by_feature.json")["cores"],
        countries=payload["countries"],
        default_country=manifest["default_country"],
        feature_splits=manifest.get("hierarchy_overrides", {}).get("feature_splits", {}),
        topology=topology,
        hierarchy_groups=groups, country_meta=meta,
        prefectures=crosswalk["groups"], unresolved=crosswalk.get("unresolved", []),
        point_for_feature=point_lookup_factory(topology),
        bucket_by_feature=read(scenario_dir / "strategic_values.by_feature.json")["bucket_by_feature"],
        plans=load_plans(data_dir),
    )
    if not dry_run and (assignments or countries != payload["countries"]):
        write(scenario_dir / "countries.json", {**payload, "countries": countries})
        refresh(scenario_dir, assignments, removed_ids=())
    return report


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--overlay", type=Path, default=ROOT / "data/scenario-rules/hoi4_split_overlay.json")
    parser.add_argument("--scenario", choices=(*SCENARIOS, "all"), default="all")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(argv)
    overlay = read_json_source(args.overlay)
    report = {scenario: run_scenario(overlay, ROOT / "data/scenarios" / scenario, dry_run=args.dry_run)
              for scenario in (SCENARIOS if args.scenario == "all" else (args.scenario,))}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.report:
        write_json(args.report, report)
    return report


if __name__ == "__main__":
    main()
