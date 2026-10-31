from __future__ import annotations

from collections import Counter
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.json_source import read_json_source
from map_builder.political_feature_merge_plans import ordered_plans
from map_builder.scenario_district_groups_service import build_district_groups_payload_in_context
from scenario_builder.hoi4.parser import load_hierarchy_groups
from tools.apply_hoi4_split_overlay import apply_overlay, make_point_lookup
from tools import build_tno_district_groups as districts_builder
from tools.check_scenario_contracts import write_json
from tools.materialize_polar_scenarios import refresh_scenario, synchronize_scenario_snapshot


def rebuild_districts(scenario_dir):
    tags, _ = districts_builder.build_tags(
        read_json_source(districts_builder.DEFAULT_SPEC), districts_builder.load_features(scenario_dir))
    mutations_path = scenario_dir / "scenario_mutations.json"
    mutations = read_json_source(mutations_path)
    countries = read_json_source(scenario_dir / "countries.json")["countries"]
    for tag in list(mutations["district_groups"]):
        if tag not in countries or countries[tag].get("entry_kind") == "scenario_container":
            del mutations["district_groups"][tag]
    mutations["district_groups"].update(tags)
    context = {"scenarioId": "tno_1962", "countriesPath": scenario_dir / "countries.json",
               "ownersPath": scenario_dir / "owners.by_feature.json",
               "districtGroupsPath": scenario_dir / "district_groups.manual.json"}
    payload = build_district_groups_payload_in_context(context, mutations)
    payload["generated_at"] = ""
    write_json(mutations_path, mutations)
    write_json(context["districtGroupsPath"], payload)


def update_country_geography(countries, owners, features, base_features, country_meta, tags):
    counts = {tag: Counter() for tag in tags}
    for fid in sorted(features):
        tag = owners[fid]
        if tag in counts:
            code = base_features.get(fid, features[fid])["cntr_code"]
            counts[tag][code] += 1
    for tag, codes in counts.items():
        if not codes:
            continue
        code = codes.most_common(1)[0][0]
        countries[tag].update({key: code for key in ("lookup_iso2", "base_iso2", "provenance_iso2")})
        countries[tag].update({key: country_meta.get(code, {}).get(key, "") for key in
                              ("continent_id", "continent_label", "subregion_id", "subregion_label")})


def expand_reclamation_entries(overlay, cores):
    entries = []
    for entry in overlay["entries"]:
        if entry.get("cores") != "parent_if_single_child":
            entries.append(entry)
            continue
        child = entry["only_from_owners"][0]
        for mode in ("owner", "keep"):
            ids = [fid for fid in entry["select"]["feature_ids"]
                   if (cores[fid] == [child]) == (mode == "owner")]
            if ids:
                entries.append({**entry, "id": f"{entry['id']}_{mode}", "cores": mode,
                                "select": {"feature_ids": ids}})
    return {**overlay, "entries": entries}


def run_scenario(overlay, scenario_dir=ROOT / "data/scenarios/tno_1962", *,
                 data_dir=ROOT / "data", refresh=refresh_scenario,
                 rebuild=rebuild_districts, synchronize=synchronize_scenario_snapshot,
                 load_plans=ordered_plans, load_hierarchy=load_hierarchy_groups):
    scenario_dir = Path(scenario_dir)
    superseded = {entry_id for entry in overlay["entries"] for entry_id in entry.get("supersedes", [])}
    overlay = {**overlay, "entries": [entry for entry in overlay["entries"] if entry["id"] not in superseded]}
    topology = read_json_source(scenario_dir / "runtime_topology.topo.json")
    owners = read_json_source(scenario_dir / "owners.by_feature.json")["owners"]
    payload = read_json_source(scenario_dir / "countries.json")
    manifest = read_json_source(scenario_dir / "manifest.json")
    geometries = [g for name in ("political", "scenario_atlantropa")
                  for g in topology["objects"][name]["geometries"]
                  if g["properties"]["id"] in owners]
    editable_topology = {**topology, "objects": {"political": {
        "type": "GeometryCollection", "geometries": geometries}}}
    groups, meta = load_hierarchy(data_dir / "hierarchy.json")
    cores = read_json_source(scenario_dir / "cores.by_feature.json")["cores"]
    countries, assignments, report = apply_overlay(
        expand_reclamation_entries(overlay, cores), "tno_1962",
        features={g["properties"]["id"]: g["properties"] for g in geometries},
        owners=owners, cores=cores,
        countries=payload["countries"], default_country=manifest["default_country"],
        hierarchy_groups=groups, country_meta=meta, prefectures={}, bucket_by_feature={},
        plans=load_plans(data_dir),
        feature_splits=manifest.get("hierarchy_overrides", {}).get("feature_splits", {}),
        topology=editable_topology, point_for_feature=make_point_lookup(editable_topology),
    )
    result_owners = {**owners, **{fid: row["owner"] for fid, row in assignments.items()}}
    base_topology = read_json_source(data_dir / "europe_topology.runtime_political_v1.json")
    update_country_geography(
        countries, result_owners,
        {g["properties"]["id"]: g["properties"] for g in geometries},
        {g["properties"]["id"]: g["properties"]
         for g in base_topology["objects"]["political"]["geometries"]},
        meta, {entry["tag"] for entry in overlay["entries"]} & countries.keys(),
    )
    counts = Counter(result_owners.values())
    for tag, country in countries.items():
        country["feature_count"] = counts[tag]
        if "controller_feature_count" in country:
            country["controller_feature_count"] = counts[tag]
    manual_path = scenario_dir / "scenario_manual_overrides.json"
    mutations_path = scenario_dir / "scenario_mutations.json"
    manual = read_json_source(manual_path)
    mutations = read_json_source(mutations_path)
    source_changed = False
    for entry in overlay["entries"]:
        if entry.get("cores") == "parent_if_single_child":
            countries[entry["tag"]].pop("entry_kind", None)
            mutations["countries"].get(entry["tag"], {}).pop("entry_kind", None)
    for tag in report["retired_tags"]:
        manual["countries"].pop(tag, None)
        mutations["countries"].pop(tag, None)
        mutations.get("capitals", {}).pop(tag, None)
    for tag in sorted(({entry["tag"] for entry in overlay["entries"]} & countries.keys()) | {
        tag for tag, country in countries.items() if country.get("entry_kind") == "scenario_container"
    }):
        country = countries[tag]
        if "display_name_en" not in country or "display_name_zh" not in country:
            names = read_json_source(scenario_dir / "locales.startup.json")["geo"][country["display_name"]]
            country.update(display_name_en=names["en"], display_name_zh=names["zh"])
        mutation = {**mutations["countries"].get(tag, {}), "mode": "create",
                    **{key: country[key] for key in
                       ("display_name", "display_name_en", "display_name_zh", "color_hex",
                        "parent_owner_tag", "subject_kind", "entry_kind") if key in country}, "color_policy": "locked"}
        source_changed |= manual["countries"].get(tag) != country or mutations["countries"].get(tag) != mutation
        manual["countries"][tag] = country
        mutations["countries"][tag] = mutation
    if assignments or countries != payload["countries"] or source_changed:
        for name in ("city_overrides.json", "capital_defaults.partial.json"):
            path = scenario_dir / name
            if path.exists() and report["retired_tags"]:
                cities = read_json_source(path)
                for tag in report["retired_tags"]:
                    for key in ("capitals_by_tag", "capital_city_hints"):
                        cities.get(key, {}).pop(tag, None)
                write_json(path, cities)
        write_json(scenario_dir / "countries.json", {**payload, "countries": countries})
        write_json(manual_path, manual)
        write_json(mutations_path, mutations)
        refresh(scenario_dir, assignments, removed_ids=())
        rebuild(scenario_dir)
        synchronize(scenario_dir)
    return report


def main():
    overlay = read_json_source(ROOT / "data/scenario-rules/tno_1962.split_overlay.json")
    print(json.dumps(run_scenario(overlay), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
