"""Derive an applied political feature merge plan from candidate groups.

A candidate group is only merged where every scenario assigns its members
identically: owners, cores, HOI4 strategic-value buckets, hierarchy groups and
every quick-fill level. Inconsistent candidates are split into the largest
consistent subsets that remain contiguous; singletons stay unmerged.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OWNERSHIP_SCENARIOS = ("hoi4_1936", "hoi4_1939", "modern_world", "tno_1962")
STRATEGIC_SCENARIOS = ("hoi4_1936", "hoi4_1939")
RIVER_PARTITIONS = DATA / "river_partitions"
ADJACENCY_TOPOLOGY = DATA / "scenarios/tno_1962/runtime_topology.topo.json.gz"


def read_json(path: Path):
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return json.load(handle)
    return json.loads(path.read_text(encoding="utf-8"))


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


def load_assignment_tables() -> dict[str, dict]:
    tables: dict[str, dict] = {}
    for scenario in OWNERSHIP_SCENARIOS:
        for kind in ("owners", "cores"):
            payload = read_json(DATA / f"scenarios/{scenario}/{kind}.by_feature.json")
            tables[f"{scenario}:{kind}"] = payload.get(kind, payload) if isinstance(payload, dict) else payload
    for scenario in STRATEGIC_SCENARIOS:
        payload = read_json(DATA / f"scenarios/{scenario}/strategic_values.by_feature.json")
        tables[f"{scenario}:strategic_bucket"] = payload["bucket_by_feature"]
    return tables


def assignment_signature(feature_id: str, tables: dict[str, dict], memberships: dict[str, list[str]]) -> str:
    values = {key: table.get(feature_id) for key, table in tables.items()}
    values["hierarchy"] = memberships.get(feature_id, [])
    return json.dumps(values, sort_keys=True, ensure_ascii=False)


def load_adjacency() -> dict[str, set[str]]:
    political = read_json(ADJACENCY_TOPOLOGY)["objects"]["political"]
    ids = [str((row.get("properties") or {}).get("id") or row.get("id")) for row in political["geometries"]]
    adjacency = {feature_id: set() for feature_id in ids}
    for index, neighbors in enumerate(political["computed_neighbors"]):
        for other in neighbors:
            adjacency[ids[index]].add(ids[other])
            adjacency[ids[other]].add(ids[index])
    return adjacency


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


def member_name(feature_id: str, locales: dict) -> dict:
    entry = (locales.get("geo") or {}).get(f"id::{feature_id}") or {}
    return {language: entry.get(language) or feature_id for language in LANGUAGE_SEPARATORS}


def compose_names(member_names: dict[str, dict]) -> dict:
    return {language: separator.join(names[language] for names in member_names.values())
            for language, separator in LANGUAGE_SEPARATORS.items()}


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


def build_plan(candidates_path: Path) -> dict:
    candidates = read_json(candidates_path)
    tables, hierarchy = load_assignment_tables(), read_json(DATA / "hierarchy.json")
    memberships, adjacency, locales = group_memberships(hierarchy), load_adjacency(), read_json(DATA / "locales.json")
    protected = set(candidates.get("protected_feature_ids") or []) | river_paint_feature_ids()
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
            member_names = {feature_id: member_name(feature_id, locales) for feature_id in component}
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
        "constraints": ["owners", "cores", "strategic_value_buckets", "hierarchy_groups", "quick_fill_groups",
                        "river_paint_parcels_unchanged", "contiguous"],
        "ownership_scenarios": list(OWNERSHIP_SCENARIOS),
        "strategic_scenarios": list(STRATEGIC_SCENARIOS),
        "counts": {"candidates": len(candidates["candidates"]), "groups": len(groups),
                   "merged_members": len(seen), "features_removed": len(seen) - len(groups), "split_or_reduced_candidates": len(splits)},
        "groups": groups,
        "split_or_reduced_candidates": splits,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidates", default="data/political_feature_merges/europe_de_fr.candidates.json")
    parser.add_argument("--output", default="data/political_feature_merges/europe_de_fr.v1.json")
    args = parser.parse_args()
    plan = build_plan(ROOT / args.candidates)
    (ROOT / args.output).write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(plan["counts"]))


if __name__ == "__main__":
    main()
