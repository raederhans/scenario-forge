"""Derive an applied political feature merge plan from candidate groups.

A candidate group is only merged where every scenario assigns its members
identically: owners, cores, HOI4 strategic-value buckets, hierarchy groups and
every quick-fill level. Inconsistent candidates are split into the largest
consistent subsets that remain contiguous; singletons stay unmerged.

With ``--scenarios`` the plan applies only to those scenarios: owners, cores and
HOI4 states are read from them alone, and only their runtime topologies are
rewritten. Hierarchy, quick-fill, China prefecture and protection rules stay
global, because the shared hierarchy keeps the unmerged members.
"""
from __future__ import annotations

import argparse
import functools
import gzip
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OWNERSHIP_SCENARIOS = ("hoi4_1936", "hoi4_1939", "modern_world", "tno_1962")
ALL_SCENARIOS = ("blank_base", *OWNERSHIP_SCENARIOS)
STRATEGIC_SCENARIOS = ("hoi4_1936", "hoi4_1939")
RIVER_PARTITIONS = DATA / "river_partitions"
CHINA_CROSSWALK = DATA / "quick_fill/china_prefecture_crosswalk.v1.json"
ADJACENCY_TOPOLOGY = DATA / "scenarios/tno_1962/runtime_topology.topo.json.gz"
# Every topology the apply tool rewrites. A merge must not mix precision and ordinary
# parcels, and every member must be valid there: the apply tool unions without repair.
REWRITTEN_TOPOLOGIES = (DATA / "europe_topology.na_v2.json", DATA / "europe_topology.runtime_political_v1.json",
                        *sorted(DATA.glob("scenarios/*/runtime_topology.topo.json*")))


def scenario_topology(scenario: str) -> Path:
    path = DATA / f"scenarios/{scenario}/runtime_topology.topo.json"
    return path if path.exists() else path.with_name(path.name + ".gz")


def rewritten_topologies(scenarios: tuple[str, ...] | None) -> tuple[Path, ...]:
    """Topologies a plan rewrites: all of them, or only the scoped scenarios' runtime topologies."""
    return REWRITTEN_TOPOLOGIES if scenarios is None else tuple(scenario_topology(s) for s in scenarios)


def read_json(path: Path):
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return json.load(handle)
    return json.loads(path.read_text(encoding="utf-8"))


@functools.cache
def rewritten_topology(path: Path) -> dict:
    return read_json(path)


def invalid_geometry_ids(feature_ids: set[str], topologies: tuple[Path, ...] = REWRITTEN_TOPOLOGIES) -> set[str]:
    """Candidate members whose geometry is invalid in any rewritten topology."""
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from map_builder.regional_geometry import _decode_geometry

    invalid: set[str] = set()
    for path in topologies:
        topology = rewritten_topology(path)
        for row in topology["objects"]["political"]["geometries"]:
            feature_id = str((row.get("properties") or {}).get("id") or row.get("id"))
            if feature_id in feature_ids and feature_id not in invalid:
                try:
                    valid = _decode_geometry(topology, row).is_valid
                except ValueError:
                    valid = False
                if not valid:
                    invalid.add(feature_id)
    return invalid


def merged_feature_id(member_ids: list[str]) -> str:
    country = member_ids[0][:2].upper()
    digest = hashlib.sha256("|".join(sorted(member_ids)).encode("utf-8")).hexdigest()[:12]
    return f"{country}_MRG_{digest}"


def group_memberships(hierarchy: dict) -> dict[str, list[str]]:
    """Feature id -> sorted list of every hierarchy/quick-fill group containing it."""
    memberships: dict[str, set[str]] = {}
    for group_id, members in (hierarchy.get("groups") or {}).items():
        for feature_id in members:
            memberships.setdefault(feature_id, set()).add(f"group:{group_id}")
    for country, entry in ((hierarchy.get("quick_fill") or {}).get("countries") or {}).items():
        for level_id, level in (entry.get("levels") or {}).items():
            for group_id, group in (level.get("groups") or {}).items():
                for feature_id in group.get("feature_ids") or []:
                    memberships.setdefault(feature_id, set()).add(f"quick_fill:{country}:{level_id}:{group_id}")
    return {key: sorted(value) for key, value in memberships.items()}


def load_assignment_tables(scenarios: tuple[str, ...] | None = None) -> dict[str, dict]:
    tables: dict[str, dict] = {}
    for scenario in scoped(OWNERSHIP_SCENARIOS, scenarios):
        for kind in ("owners", "cores"):
            payload = read_json(DATA / f"scenarios/{scenario}/{kind}.by_feature.json")
            tables[f"{scenario}:{kind}"] = payload.get(kind, payload) if isinstance(payload, dict) else payload
    for scenario in scoped(STRATEGIC_SCENARIOS, scenarios):
        payload = read_json(DATA / f"scenarios/{scenario}/strategic_values.by_feature.json")
        tables[f"{scenario}:strategic_bucket"] = payload["bucket_by_feature"]
    for path in rewritten_topologies(scenarios):
        precision = rewritten_topology(path).get("political_precision_feature_ids")
        if precision is not None:
            tables[f"{path.relative_to(DATA).as_posix()}:precision"] = dict.fromkeys(precision, True)
    tables["china_prefecture"] = china_prefectures()
    return tables


def china_prefectures() -> dict[str, str]:
    """China leaf -> crosswalk prefecture, including provinces not yet released to quick-fill."""
    crosswalk = read_json(CHINA_CROSSWALK)
    prefectures = {feature_id: key for key, record in crosswalk["groups"].items() for feature_id in record["feature_ids"]}
    prefectures.update({row["feature_id"]: "unresolved" for row in crosswalk["unresolved"]})
    return prefectures


def assignment_signature(feature_id: str, tables: dict[str, dict], memberships: dict[str, list[str]]) -> str:
    values = {key: table.get(feature_id) for key, table in tables.items() if key != "china_prefecture"}
    values["hierarchy"] = memberships.get(feature_id, [])
    values["china_prefecture"] = tables["china_prefecture"].get(feature_id)
    return json.dumps(values, sort_keys=True, ensure_ascii=False)


def scoped(names: tuple[str, ...], scenarios: tuple[str, ...] | None) -> list[str]:
    return [name for name in names if scenarios is None or name in scenarios]


def load_adjacency(path: Path = ADJACENCY_TOPOLOGY) -> tuple[dict[str, set[str]], dict[str, str]]:
    """Neighbor graph (TNO by default), plus each feature's source name as the last-resort label."""
    political = read_json(path)["objects"]["political"]
    ids = [str((row.get("properties") or {}).get("id") or row.get("id")) for row in political["geometries"]]
    source_names = {feature_id: str((row.get("properties") or {}).get("name") or "")
                    for feature_id, row in zip(ids, political["geometries"])}
    adjacency = {feature_id: set() for feature_id in ids}
    for index, neighbors in enumerate(political["computed_neighbors"]):
        for other in neighbors:
            adjacency[ids[index]].add(ids[other])
            adjacency[ids[other]].add(ids[index])
    return adjacency, source_names


def connected_components(members: list[str], adjacency: dict[str, set[str]]) -> list[list[str]]:
    remaining, components = set(members), []
    for start in members:
        if start not in remaining:
            continue
        stack, component = [start], []
        remaining.discard(start)
        while stack:
            current = stack.pop()
            component.append(current)
            for other in adjacency.get(current, ()):
                if other in remaining:
                    remaining.discard(other)
                    stack.append(other)
        components.append(sorted(component, key=members.index))
    return components


LANGUAGE_SEPARATORS = {"en": " + ", "zh": "、"}


def load_name_sources() -> tuple[list[dict], dict]:
    """ID-keyed names (global locales, then scenario locale patches), plus raw-name locales.

    Scenario patches name leaves whose raw names are ambiguous; leaves with no
    ID-keyed name fall back to the raw-name locale, as the runtime does.
    """
    geo = read_json(DATA / "locales.json").get("geo") or {}
    sources = [{key[4:]: entry for key, entry in geo.items() if key.startswith("id::")}]
    for path in sorted(DATA.glob("scenarios/*/geo_locale_patch.json")):
        sources.append(read_json(path).get("geo") or {})
    return sources, geo


def member_name(feature_id: str, name_sources: tuple[list[dict], dict], source_names: dict[str, str]) -> dict:
    by_id, raw_names = name_sources
    source_name = source_names.get(feature_id) or ""
    names = {}
    for language in LANGUAGE_SEPARATORS:
        names[language] = next((source[feature_id][language] for source in by_id
                                if isinstance(source.get(feature_id), dict) and source[feature_id].get(language)), None)
        names[language] = names[language] or (raw_names.get(source_name) or {}).get(language)
    fallback = source_name or feature_id
    return {language: name or names.get("en") or fallback for language, name in names.items()}


def compose_names(member_names: dict[str, dict]) -> dict:
    return {language: separator.join(names[language] for names in member_names.values())
            for language, separator in LANGUAGE_SEPARATORS.items()}


def fragment_camouflage_feature_ids() -> set[str]:
    """Features with their own fragment-camouflage display rule; a merge would widen or drop it."""
    policies = read_json(DATA / "country_feature_policies.json")
    rules = ((policies.get("display") or {}).get("fragmentCamouflage") or {}).get("rules") or []
    return {str(feature_id) for rule in rules for feature_id in rule.get("featureIds") or []}


def river_paint_feature_ids() -> set[str]:
    """Parents and contour supports of reviewed river-paint packs.

    Their geometry fingerprints are part of each approved pack identity, so
    merging them would invalidate reviewed river cells.
    """
    ids: set[str] = set()
    for path in sorted(RIVER_PARTITIONS.glob("*.json")):
        if path.name.endswith(".transport.json"):
            continue
        pack = read_json(path)
        for key in ("parents", "support"):
            ids.update(str(row["parentId"]) for row in pack.get(key) or [])
    return ids


def scoped_adjacency(scenarios: tuple[str, ...]) -> tuple[dict[str, set[str]], dict[str, str]]:
    """Neighbors in every scoped scenario, so a group is contiguous wherever it is applied."""
    adjacency, source_names = load_adjacency(scenario_topology(scenarios[0]))
    for scenario in scenarios[1:]:
        other, _ = load_adjacency(scenario_topology(scenario))
        adjacency = {feature_id: neighbors & other[feature_id] for feature_id, neighbors in adjacency.items() if feature_id in other}
    return adjacency, source_names


def build_plan(candidates_path: Path, scenarios: tuple[str, ...] | None = None) -> dict:
    if scenarios is not None and (not scenarios or not set(scenarios) <= set(ALL_SCENARIOS)):
        raise ValueError(f"Unknown or empty scenario scope: {scenarios}")
    candidates = read_json(candidates_path)
    tables, hierarchy = load_assignment_tables(scenarios), read_json(DATA / "hierarchy.json")
    adjacency, source_names = load_adjacency() if scenarios is None else scoped_adjacency(scenarios)
    memberships, name_sources = group_memberships(hierarchy), load_name_sources()
    protected = set(candidates.get("protected_feature_ids") or []) | river_paint_feature_ids() | fragment_camouflage_feature_ids()
    protected |= invalid_geometry_ids({member for candidate in candidates["candidates"] for member in candidate["member_ids"]},
                                      rewritten_topologies(scenarios))
    groups, splits = [], []
    for candidate in candidates["candidates"]:
        members = [feature_id for feature_id in candidate["member_ids"] if feature_id not in protected]
        missing = [feature_id for feature_id in members if feature_id not in adjacency]
        if missing:
            raise ValueError(f"Candidate members missing from the adjacency topology: {missing}")
        by_signature: dict[str, list[str]] = {}
        for feature_id in members:
            by_signature.setdefault(assignment_signature(feature_id, tables, memberships), []).append(feature_id)
        kept = [component for subset in by_signature.values() for component in connected_components(subset, adjacency) if len(component) > 1]
        if len(kept) != 1 or len(kept[0]) != len(candidate["member_ids"]):
            splits.append({"candidate": candidate["member_ids"], "applied": kept})
        for component in kept:
            member_names = {feature_id: member_name(feature_id, name_sources, source_names) for feature_id in component}
            groups.append({
                "id": merged_feature_id(component),
                "member_ids": component,
                "parent_id": candidate.get("parent_id"),
                "names": compose_names(member_names),
                "member_names": member_names,
            })
    seen: dict[str, str] = {}
    for group in groups:
        for feature_id in group["member_ids"]:
            if feature_id in seen:
                raise ValueError(f"{feature_id} appears in {seen[feature_id]} and {group['id']}")
            seen[feature_id] = group["id"]
    return {
        "schema_version": 1,
        "plan_id": candidates_path.name.replace(".candidates.json", ".v1"),
        "candidate_source": candidates_path.relative_to(ROOT).as_posix(),
        **({} if scenarios is None else {"scenarios": list(scenarios)}),
        "constraints": ["owners", "cores", "strategic_value_buckets", "hierarchy_groups", "quick_fill_groups",
                        "china_crosswalk_prefecture", "precision_tier", "valid_member_geometry",
                        "fragment_camouflage_unchanged",
                        "river_paint_parcels_unchanged", "contiguous"],
        "ownership_scenarios": scoped(OWNERSHIP_SCENARIOS, scenarios),
        "strategic_scenarios": scoped(STRATEGIC_SCENARIOS, scenarios),
        "counts": {"candidates": len(candidates["candidates"]), "groups": len(groups),
                   "merged_members": len(seen), "features_removed": len(seen) - len(groups), "split_or_reduced_candidates": len(splits)},
        "groups": groups,
        "split_or_reduced_candidates": splits,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidates", default="data/political_feature_merges/europe_de_fr.candidates.json")
    parser.add_argument("--output", default="data/political_feature_merges/europe_de_fr.v1.json")
    parser.add_argument("--scenarios", nargs="+", choices=ALL_SCENARIOS,
                        help="Apply only to these scenarios (default: every scenario and the base topologies).")
    args = parser.parse_args()
    plan = build_plan(ROOT / args.candidates, tuple(args.scenarios) if args.scenarios else None)
    (ROOT / args.output).write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(plan["counts"]))


if __name__ == "__main__":
    main()
