"""Apply a political feature merge plan to every runtime asset.

The plan (tools/build_political_feature_merge_plan.py) only contains groups
whose members share owners, cores, strategic buckets, hierarchy and quick-fill
groups in every scenario. This tool:

1. merges member geometries in each base and scenario topology, keeping arcs
   shared with neighbours and verifying the exact geometric union;
2. refreshes each scenario through tools.materialize_polar_scenarios, which
   delegates derived chunks, startup bundles and snapshots to the existing
   scenario contract builder;
3. projects member IDs to merged IDs in every other runtime reference, failing
   on any conflicting many-to-one value that has no explicit merge rule.

Upstream rebuilds that regenerate these assets must run this tool again;
tests/political_feature_merges_contract.test.mjs rejects merged-away IDs.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from shapely.geometry import shape  # noqa: E402
from shapely.ops import unary_union  # noqa: E402

from map_builder.json_source import read_json_source, write_runtime_topology_source  # noqa: E402
from map_builder.regional_geometry import (  # noqa: E402
    _compact_arcs,
    _decode_geometry,
    _encode_exact_coverage,
    _offset_arcs,
)
from tools.check_scenario_contracts import load_json, write_json  # noqa: E402
from tools.materialize_polar_scenarios import refresh_scenario  # noqa: E402

DATA = ROOT / "data"
SCENARIOS = ("blank_base", "hoi4_1936", "hoi4_1939", "modern_world", "tno_1962")
BASE_TOPOLOGIES = ("europe_topology.na_v2.json", "europe_topology.runtime_political_v1.json")
NAME_KEYS = {"id", "name", "name_local", "legacy_name", "anchor_county_name", "adm1_name"}
# Generated or assignment files handled by refresh_scenario / the contract builder.
SCENARIO_MANAGED = {
    "runtime_topology.topo.json", "runtime_topology.topo.json.gz", "owners.by_feature.json",
    "cores.by_feature.json", "manifest.json", "audit.json",
    "scenario_manual_overrides.json", "strategic_values.by_feature.json",
}
SCENARIO_DERIVED_PREFIXES = ("chunks/", "startup.bundle.", "runtime_topology.bootstrap.", "political_id_raster/",
                             "locales.startup.", "geo_aliases.startup.", "detail_chunks.manifest.", "runtime_meta.")
GLOBAL_PROJECTED = (
    "country_feature_policies.json", "world_cities.geojson", "europe_urban.geojson",
    "releasables/hoi4_vanilla.internal.phase1.catalog.json", "releasables/hoi4_vanilla.internal.phase1.source.json",
    "releasables/tno_1962.internal.phase1.catalog.json", "releasables/tno_1962.internal.phase1.source.json",
)
# Scenarios that read each projected global file. A scoped plan projects a file only
# when it covers every reader; cities keep their members and fall back to the scenario tag.
GLOBAL_READERS = {
    "releasables/tno_1962.internal.phase1.catalog.json": ("tno_1962",),
    "releasables/tno_1962.internal.phase1.source.json": ("tno_1962",),
}
SCOPED_UNPROJECTED = ("world_cities.geojson", "europe_urban.geojson")
CHINA_CROSSWALK = "quick_fill/china_prefecture_crosswalk.v1.json"
POPULATION_FEATURES = "thematic_layers/population/ghsl_population_2020_v1/features"
LANGUAGE_SEPARATORS = {"en": " + ", "zh": "、"}
# ID lists that annotate each feature independently (audit samples, reviewed
# name collisions) rather than define a set, so a lone merged member is valid.
PER_FEATURE_ANNOTATIONS = ("$.audit.", "$.reviewed_collision_feature_ids")


class Merges:
    def __init__(self, plan: dict):
        self.groups = plan["groups"]
        # A plan without "scenarios" also rewrites the base topologies and shared hierarchy.
        self.scoped = "scenarios" in plan
        self.scenarios = tuple(plan["scenarios"]) if self.scoped else SCENARIOS
        if not self.scenarios or not set(self.scenarios) <= set(SCENARIOS):
            raise ValueError(f"Unknown or empty scenario scope: {self.scenarios}")
        self.by_id = {group["id"]: group for group in self.groups}
        self.remap = {member: group["id"] for group in self.groups for member in group["member_ids"]}

    def map_id(self, value: str) -> str:
        if value in self.remap:
            return self.remap[value]
        if value.startswith("id::") and value[4:] in self.remap:
            return "id::" + self.remap[value[4:]]
        return value

    def compose_member_names(self, value: dict) -> dict:
        """Collapse member name entries ({en, zh}) into one merged entry.

        Each language joins the members' names from this same mapping, so
        scenario-specific names survive; absent members use the plan names.
        """
        for prefix in ("", "id::"):
            for group in self.groups:
                keys = [prefix + member for member in group["member_ids"] if prefix + member in value]
                entries = [value[key] for key in keys]
                if not keys or not all(isinstance(entry, dict) and set(entry) & set(LANGUAGE_SEPARATORS)
                                       and all(isinstance(text, str) for text in entry.values()) for entry in entries):
                    continue
                merged = {}
                for language, separator in LANGUAGE_SEPARATORS.items():
                    if not any(language in entry for entry in entries):
                        continue
                    names = [((value.get(prefix + member) or {}).get(language)
                              or group["member_names"][member][language]) for member in group["member_ids"]]
                    merged[language] = separator.join(names)
                value = {key: item for key, item in value.items() if key not in keys}
                value[prefix + group["id"]] = merged
        return value

    def project(self, value, at: str = "$"):
        """Map IDs in keys, values and string lists; conflicting merged keys raise."""
        if isinstance(value, str):
            return self.map_id(value)
        if isinstance(value, list):
            if value and all(isinstance(item, str) for item in value) and not at.startswith(PER_FEATURE_ANNOTATIONS):
                present = {item[4:] if item.startswith("id::") else item for item in value}
                for group in self.groups:
                    found = present.intersection(group["member_ids"])
                    if found and len(found) != len(group["member_ids"]):
                        raise ValueError(f"{at}: ID list contains only part of {group['id']}: {sorted(found)}")
            projected = [self.project(item, f"{at}[]") for item in value]
            if projected and all(isinstance(item, str) for item in projected):
                return list(dict.fromkeys(projected))
            return projected
        if not isinstance(value, dict):
            return value
        value = self.compose_member_names(value)
        result: dict = {}
        for key, item in value.items():
            mapped_key, mapped = self.map_id(key), self.project(item, f"{at}.{key}")
            if mapped_key in result and result[mapped_key] != mapped:
                raise ValueError(f"Conflicting many-to-one value at {at}.{mapped_key}")
            result[mapped_key] = mapped
        return result


def read_any(path: Path):
    return read_json_source(path)


def run_arc_merge(topology_path: Path, merges: Merges) -> dict:
    with tempfile.TemporaryDirectory() as directory:
        groups_path, output_path = Path(directory, "groups.json"), Path(directory, "merged.json")
        groups_path.write_text(json.dumps([{"id": g["id"], "member_ids": g["member_ids"]} for g in merges.groups]), encoding="utf-8")
        subprocess.run(["node", str(ROOT / "tools/merge_political_topology_arcs.mjs"), str(topology_path), str(groups_path), str(output_path)],
                       check=True, cwd=ROOT)
        return json.loads(output_path.read_text(encoding="utf-8"))


def feature_id(row: dict) -> str:
    return str((row.get("properties") or {}).get("id") or row.get("id"))


def merge_topology(topology: dict, merges: Merges, arc_merged: dict) -> list[str]:
    """Merge plan groups present in ``topology`` in place; return applied group IDs."""
    political = topology["objects"]["political"]
    original_rows = political["geometries"]
    rows_by_id = {feature_id(row): row for row in original_rows}
    applied: dict[str, dict] = {}
    for group in merges.groups:
        present = [member for member in group["member_ids"] if member in rows_by_id]
        if not present:
            continue
        if len(present) != len(group["member_ids"]):
            raise ValueError(f"{group['id']}: partial membership {present}")
        members = [rows_by_id[member] for member in present]
        properties = copy.deepcopy(members[0].get("properties") or {})
        for other in members[1:]:
            for key in set(properties) | set(other.get("properties") or {}):
                if key not in NAME_KEYS and properties.get(key) != (other.get("properties") or {}).get(key):
                    raise ValueError(f"{group['id']}: member property {key!r} differs")
        for key in NAME_KEYS - {"id", "name"}:
            if key in properties and any((m.get("properties") or {}).get(key) != properties[key] for m in members[1:]):
                properties[key] = ""
        properties.update({"id": group["id"], "name": group["names"]["en"]})
        expected = unary_union([_decode_geometry(topology, member) for member in members])
        geometry = copy.deepcopy(arc_merged.get(group["id"]))
        if geometry is not None:
            try:
                decoded = _decode_geometry(topology, geometry)
            except ValueError:  # mergeArcs can also leave a ring with fewer than four points
                decoded = None
            if decoded is None or not decoded.is_valid or not decoded.equals(expected):
                geometry = None
        if geometry is None:
            # mergeArcs can keep a self-touching ring; encode the exact union
            # instead without repair, rounding or simplification.
            encoded = _encode_exact_coverage([group["id"]], [expected])
            geometry = encoded["objects"]["political"]["geometries"][0]
            geometry["arcs"] = _offset_arcs(geometry["arcs"], len(topology["arcs"]))
            topology["arcs"].extend(encoded["arcs"])
        geometry["properties"] = properties
        if "id" in members[0]:
            geometry["id"] = group["id"]
        actual = _decode_geometry(topology, geometry)
        if not actual.is_valid or not actual.symmetric_difference(expected).is_empty:
            raise ValueError(f"{group['id']}: merged geometry is not the exact member union")
        applied[group["id"]] = geometry

    old_ids = [feature_id(row) for row in original_rows]
    rows, seen = [], set()
    for row, old in zip(original_rows, old_ids):
        new = merges.remap.get(old, old) if merges.remap.get(old) in applied else old
        if new in seen:
            continue
        seen.add(new)
        rows.append(applied.get(new, row))
    if "computed_neighbors" in political:
        index = {feature_id(row): position for position, row in enumerate(rows)}
        neighbors = [set() for _ in rows]
        for position, adjacent in enumerate(political["computed_neighbors"]):
            source = index[merges.remap.get(old_ids[position], old_ids[position]) if merges.remap.get(old_ids[position]) in applied else old_ids[position]]
            for other_position in adjacent:
                other_id = old_ids[other_position]
                target = index[merges.remap.get(other_id, other_id) if merges.remap.get(other_id) in applied else other_id]
                if target != source:
                    neighbors[source].add(target)
        political["computed_neighbors"] = [sorted(item) for item in neighbors]
    political["geometries"] = rows
    if applied:
        if "political_precision_feature_ids" in topology:
            topology["political_precision_feature_ids"] = merges.project(topology["political_precision_feature_ids"])
        for name, obj in topology["objects"].items():
            if name != "political":
                for row in obj.get("geometries") or []:
                    if row.get("properties"):
                        row["properties"] = merges.project(row["properties"])
        _compact_arcs(topology)
    return list(applied)


def _fully_sorted(value) -> bool:
    if isinstance(value, dict):
        keys = list(value)
        return keys == sorted(keys) and all(_fully_sorted(item) for item in value.values())
    if isinstance(value, list):
        return all(_fully_sorted(item) for item in value)
    return True


def write_like(path: Path, payload, original: bytes) -> None:
    """Rewrite JSON with the original file's indentation, key order and newline."""
    newline = b"\n"
    indented = original.lstrip()[1:2] == newline
    sort_keys = _fully_sorted(json.loads(original))
    ascii_only = all(byte < 128 for byte in original)
    text = json.dumps(payload, ensure_ascii=ascii_only, sort_keys=sort_keys, allow_nan=False,
                      indent=2 if indented else None, separators=None if indented else (",", ":"))
    path.write_bytes(text.encode("utf-8") + (newline if original.endswith(newline) else b""))


def rewrite(path: Path, transform) -> bool:
    original = path.read_bytes()
    payload = json.loads(original)
    updated = transform(payload)
    if updated == payload:
        return False
    write_like(path, updated, original)
    return True


def write_compact(path: Path, payload) -> None:
    path.write_bytes(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8"))


def apply_base_topologies(merges: Merges) -> dict[str, int]:
    applied = {}
    for name in BASE_TOPOLOGIES:
        path = DATA / name
        topology = read_any(path)
        applied[name] = len(merge_topology(topology, merges, run_arc_merge(path, merges)))
        write_compact(path, topology)
    return applied


def scenario_assignments(scenario_dir: Path, merges: Merges, applied: list[str]) -> dict:
    if scenario_dir.name == "blank_base":
        return {}
    owners = load_json(scenario_dir / "owners.by_feature.json")["owners"]
    cores = load_json(scenario_dir / "cores.by_feature.json")["cores"]
    mutations_path = scenario_dir / "scenario_mutations.json"
    mutations = load_json(mutations_path).get("assignments_by_feature_id", {}) if mutations_path.exists() else {}
    assignments = {}
    for group_id in applied:
        first = merges.by_id[group_id]["member_ids"][0]
        if first not in owners:
            continue
        owner = owners[first]
        controller = (mutations.get(first) or {}).get("controller") or owner
        assignments[group_id] = {"parent_id": first, "owner": owner, "controller": controller, "cores": list(cores[first])}
    return assignments


def project_files(paths: list[Path], merges: Merges, special=None) -> list[str]:
    changed = []
    for path in paths:
        payload = load_json(path)
        projected = special(path, payload) if special else merges.project(payload)
        if projected != payload:
            write_json(path, projected) if path.suffix == ".json" and path.read_text(encoding="utf-8").startswith("{\n") else write_compact(path, projected)
            changed.append(path.relative_to(ROOT).as_posix())
    return changed


def apply_scenario_extras(scenario_dir: Path, merges: Merges) -> list[str]:
    changed = []
    member_tokens = [f'"{member}"' for member in merges.remap]
    for path in sorted(scenario_dir.rglob("*.json")):
        relative = path.relative_to(scenario_dir).as_posix()
        if relative in SCENARIO_MANAGED or relative.startswith(SCENARIO_DERIVED_PREFIXES) or relative.startswith("derived/"):
            continue
        text = path.read_text(encoding="utf-8")
        if not any(token in text for token in member_tokens) and "id::" not in text:
            continue
        if relative == "scenario_mutations.json":
            # Assignments are refreshed with the scenario; other sections map IDs.
            def mutate(_p, payload):
                result = merges.project({k: v for k, v in payload.items() if k != "assignments_by_feature_id"})
                result["assignments_by_feature_id"] = payload["assignments_by_feature_id"]
                return result
            changed += project_files([path], merges, mutate)
        else:
            changed += project_files([path], merges)
    return changed


def record_scenario_feature_merges(manifest_path: Path, merges: Merges, applied: list[str]) -> None:
    """Record scoped merges for js/core/scenario_hierarchy.js, which projects the shared hierarchy.

    Members are expressed in shared-hierarchy IDs: an earlier scoped merge that
    is merged again is replaced by its own members.
    """
    manifest = load_json(manifest_path)
    recorded = dict((manifest.get("hierarchy_overrides") or {}).get("feature_merges") or {})
    for group_id in applied:
        members = merges.by_id[group_id]["member_ids"]
        recorded[group_id] = [leaf for member in members for leaf in recorded.pop(member, [member])]
    manifest.setdefault("hierarchy_overrides", {})["feature_merges"] = dict(sorted(recorded.items()))
    write_json(manifest_path, manifest)


def apply_scenario(scenario_id: str, merges: Merges) -> dict:
    scenario_dir = DATA / "scenarios" / scenario_id
    topology_path = scenario_dir / "runtime_topology.topo.json"
    source_path = topology_path if topology_path.exists() else topology_path.with_name(topology_path.name + ".gz")
    topology = read_any(source_path)
    applied = merge_topology(topology, merges, run_arc_merge(source_path, merges))
    assignments = scenario_assignments(scenario_dir, merges, applied)
    removed = sorted(member for group_id in applied for member in merges.by_id[group_id]["member_ids"])
    strategic_path = scenario_dir / "strategic_values.by_feature.json"
    extras = apply_scenario_extras(scenario_dir, merges)
    if merges.scoped and applied:
        record_scenario_feature_merges(scenario_dir / "manifest.json", merges, applied)
    write_runtime_topology_source(scenario_dir, topology)
    fixes = refresh_scenario(scenario_dir, assignments, removed)
    if strategic_path.exists():
        strategic = load_json(strategic_path)
        strategic["victory_points"] = merges.project(strategic["victory_points"])
        write_json(strategic_path, strategic)
    return {"groups": len(applied), "removed": len(removed), "extras": extras, "fixes": fixes}


def apply_locales(merges: Merges) -> None:
    def transform(payload: dict) -> dict:
        # Scoped plans add merged names; other scenarios still name the members.
        payload = copy.deepcopy(payload) if merges.scoped else merges.project(payload)
        # Members with no ID-keyed name used the raw-name fallback; the merged name has none.
        for group in merges.groups:
            payload["geo"].setdefault("id::" + group["id"], dict(group["names"]))
        return payload

    rewrite(DATA / "locales.json", transform)


def apply_hierarchy(merges: Merges) -> None:
    rewrite(DATA / "hierarchy.json", merges.project)


def apply_china_crosswalk(merges: Merges) -> None:
    """Project the prefecture crosswalk and re-pin it to the merged leaves.

    Plans only merge China leaves that share one crosswalk prefecture (or are
    all unresolved), so membership is unchanged; the input signatures follow
    tools/build_china_prefecture_crosswalk.py over the merged topology.
    """
    hierarchy = load_json(DATA / "hierarchy.json")
    parents = {key: sorted(members) for key, members in sorted(hierarchy["groups"].items()) if key.startswith("CN_")}
    topology = load_json(DATA / "europe_topology.runtime_political_v1.json")
    rows = sorted((str(row["id"]), str(row.get("name", ""))) for row in
                  (geometry.get("properties") or {} for geometry in topology["objects"]["political"]["geometries"])
                  if str(row.get("cntr_code", "")).upper() == "CN")

    def transform(crosswalk: dict) -> dict:
        crosswalk = copy.deepcopy(crosswalk)
        for record in crosswalk["groups"].values():
            record["feature_ids"] = sorted(dict.fromkeys(merges.map_id(member) for member in record["feature_ids"]))
        unresolved: dict[str, dict] = {}
        for row in crosswalk["unresolved"]:
            group_id = merges.remap.get(row["feature_id"])
            if not group_id:
                unresolved[row["feature_id"]] = row
                continue
            merged = unresolved.setdefault(group_id, {**row, "feature_id": group_id,
                                                      "name": merges.by_id[group_id]["names"]["en"], "candidates": []})
            merged["candidates"] = sorted(set(merged["candidates"]) | set(row["candidates"]))
        crosswalk["unresolved"] = sorted(unresolved.values(), key=lambda row: row["feature_id"])
        for province, summary in crosswalk["provinces"].items():
            summary["total"] = len(parents.get(province, []))
            summary["matched"] = sum(len(record["feature_ids"]) for record in crosswalk["groups"].values()
                                     if record["province_id"] == province)
            summary["unresolved"] = sum(row["province_id"] == province for row in crosswalk["unresolved"])
        crosswalk["input_parent_signature"] = hashlib.sha256(
            json.dumps(parents, ensure_ascii=True, separators=(",", ":")).encode()).hexdigest()
        crosswalk["input_feature_signature"] = hashlib.sha256(
            json.dumps(rows, ensure_ascii=True, separators=(",", ":")).encode()).hexdigest()
        return crosswalk

    rewrite(DATA / CHINA_CROSSWALK, transform)


def apply_quick_fill() -> None:
    """Rebuild hierarchy quick-fill metadata from the projected crosswalk and every applied plan."""
    from map_builder.quick_fill_hierarchy import build_quick_fill_metadata, load_crosswalk, load_feature_merge_members

    topology = load_json(DATA / "europe_topology.runtime_political_v1.json")
    properties = [row.get("properties", {}) for row in topology["objects"]["political"]["geometries"]]

    def transform(hierarchy: dict) -> dict:
        return {**hierarchy, "quick_fill": build_quick_fill_metadata(
            hierarchy, properties, load_crosswalk(DATA), load_feature_merge_members(DATA))}

    rewrite(DATA / "hierarchy.json", transform)


def manifest_in_sync() -> list[str]:
    """Manifest outputs whose committed (HEAD) file matches the committed evidence."""
    def head_blobs(paths: list[str]) -> list[bytes | None]:
        request = "".join(f"HEAD:{path}\n" for path in paths).encode()
        output = subprocess.run(["git", "cat-file", "--batch"], input=request, capture_output=True, check=True, cwd=ROOT).stdout
        blobs, offset = [], 0
        for _ in paths:
            header_end = output.index(b"\n", offset)
            header = output[offset:header_end].split()
            if header[-1] == b"missing":
                blobs.append(None)
                offset = header_end + 1
                continue
            size = int(header[2])
            blobs.append(output[header_end + 1:header_end + 1 + size])
            offset = header_end + 1 + size + 1
        return blobs

    manifest_blob, = head_blobs(["data/manifest.json"])
    outputs = {name: entry for name, entry in json.loads(manifest_blob)["outputs"].items()
               if isinstance(entry, dict) and entry.get("sha256")}
    names = list(outputs)
    return [name for name, blob in zip(names, head_blobs([f"data/{name}" for name in names]))
            if blob is not None and hashlib.sha256(blob).hexdigest() == outputs[name]["sha256"]]


def refresh_manifest(in_sync: list[str]) -> list[str]:
    """Re-record evidence for outputs this tool changed, using the manifest writer's own fields.

    Only outputs that were in sync at HEAD are touched; unrelated stale
    entries stay for their owners to refresh.
    """
    import init_map_data

    path = DATA / "manifest.json"
    original = path.read_bytes()
    manifest = json.loads(original)
    # Other registrars (e.g. population) may already have re-recorded their outputs.
    changed = [name for name in in_sync
               if hashlib.sha256((DATA / name).read_bytes()).hexdigest() != manifest["outputs"][name]["sha256"]]
    if not changed:
        return []
    try:
        init_map_data.write_data_manifest(DATA)
        regenerated = load_json(path)["outputs"]
    finally:
        path.write_bytes(original)
    for name in changed:
        entry = manifest["outputs"][name]
        for key, value in regenerated[name].items():
            if key in ("sha256", "size_bytes") or (key in entry and isinstance(value, int) and not isinstance(value, bool)):
                entry[key] = value
    write_like(path, manifest, original)
    return changed


def apply_geo_aliases(merges: Merges) -> None:
    rewrite(DATA / "geo_aliases.json", lambda payload: merge_geo_aliases(copy.deepcopy(payload), merges))


def merge_geo_aliases(payload: dict, merges: Merges) -> dict:
    entries, merged_entries = [], {}
    for entry in payload["entries"]:
        group_id = merges.remap.get(entry.get("feature_id"))
        if not group_id or merges.scoped:
            # Scoped plans keep member entries for the scenarios where they stay separate.
            entries.append(entry)
        if not group_id:
            continue
        group = merges.by_id[group_id]
        target = merged_entries.setdefault(group_id, {
            "stable_key": f"id::{group_id}", "feature_id": group_id, "country_code": entry.get("country_code"),
            "primary_name": group["names"]["en"], "aliases": [group["names"]["en"]], "search_only_aliases": [],
        })
        for key in ("aliases", "search_only_aliases"):
            target[key] = list(dict.fromkeys(target[key] + list(entry.get(key) or [])))
    entries.extend(merged_entries.values())
    payload["entries"] = entries
    keep = (lambda key: key) if merges.scoped else merges.map_id
    aliases = {alias: keep(key) for alias, key in payload["alias_to_stable_key"].items()}
    for group_id, entry in merged_entries.items():
        aliases.setdefault(entry["primary_name"], f"id::{group_id}")
    payload["alias_to_stable_key"] = aliases
    # A sample of aliases shared by several features; a merged member keeps its row under the merged key.
    for row in payload.get("ambiguous_aliases_sample") or []:
        row["stable_keys"] = list(dict.fromkeys(keep(key) for key in row["stable_keys"]))
    payload["entry_count"], payload["alias_count"] = len(entries), len(aliases)
    return payload


def apply_population(merges: Merges) -> list[str]:
    """Merge feature rows, then re-bind each document to its rewritten topology."""
    import hashlib
    layer_path = DATA / POPULATION_FEATURES.rsplit("/", 1)[0] / "manifest.json"
    layer_original = layer_path.read_bytes()
    layer = json.loads(layer_original)
    changed = []
    for scenario_id, descriptor in layer["scenarios"].items():
        if scenario_id not in merges.scenarios:
            continue
        path = ROOT / descriptor["features_url"]
        scenario_manifest = load_json(DATA / "scenarios" / scenario_id / "manifest.json")
        geometry_version = hashlib.sha256((ROOT / scenario_manifest["runtime_topology_url"]).read_bytes()).hexdigest()

        def transform(payload, scenario_id=scenario_id, geometry_version=geometry_version):
            payload = merge_population(copy.deepcopy(payload), merges, scenario_id)
            payload["geometry_version"] = geometry_version
            payload["feature_count"] = len(payload["features"])
            return payload

        if rewrite(path, transform):
            changed.append(path.relative_to(ROOT).as_posix())
        document = load_json(path)
        removed = descriptor["feature_count"] - document["feature_count"]
        descriptor["geometry_version"] = geometry_version
        descriptor["feature_count"] = document["feature_count"]
        descriptor["core_feature_count"] -= removed
    write_like(layer_path, layer, layer_original)
    subprocess.run([sys.executable, str(ROOT / "tools/register_population_spatial_assets.py")], check=True, cwd=ROOT)
    return changed


def merge_population(payload: dict, merges: Merges, name: str) -> dict:
    """Population and area are additive; density and coverage are re-derived."""
    features = payload["features"]
    for group in merges.groups:
        rows = [features.get(member) for member in group["member_ids"]]
        if not any(rows):
            continue
        if not all(rows):
            raise ValueError(f"{name}: partial population rows for {group['id']}")
        # The registrar's contract: "ok" has a density, "partial_coverage" a population
        # but no density, and any other status leaves both unknown.
        unknown = next((row["status"] for row in rows if row.get("population") is None), None)
        if unknown:
            merged = dict(next(row for row in rows if row.get("population") is None))
        else:
            population = sum(float(row["population"]) for row in rows)
            area = sum(float(row["land_area_km2"]) for row in rows)
            status = "ok" if all(row.get("status") == "ok" for row in rows) else "partial_coverage"
            merged = dict(rows[0])
            merged.update({
                "population": population,
                "land_area_km2": area,
                "density": (population / area if area else 0.0) if status == "ok" else None,
                **{key: sum(float(row[key]) * float(row["land_area_km2"]) for row in rows) / area if area else 0.0
                   for key in ("coverage_fraction", "overlap_fraction", "raw_coverage_fraction") if key in rows[0]},
                "status": status,
            })
        for member in group["member_ids"]:
            features.pop(member)
        features[group["id"]] = merged
    return payload


def global_projected_paths(merges: Merges) -> list[Path]:
    """Global files to project; a scoped plan refuses to touch one that other scenarios also read."""
    paths = [DATA / name for name in GLOBAL_PROJECTED if (DATA / name).exists()]
    if not merges.scoped:
        return paths
    selected = []
    for path in paths:
        name = path.relative_to(DATA).as_posix()
        if set(GLOBAL_READERS.get(name, SCENARIOS)) <= set(merges.scenarios):
            selected.append(path)
        elif name not in SCOPED_UNPROJECTED:
            text = path.read_text(encoding="utf-8")
            touched = sorted(member for member in merges.remap if f'"{member}"' in text)
            if touched:
                raise ValueError(f"{name} is read by scenarios outside {merges.scenarios}: {touched[:5]}")
    return selected


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--plan", default="data/political_feature_merges/europe_de_fr.v1.json")
    parser.add_argument("--scenario", action="append", choices=SCENARIOS, help="Limit scenario processing (default: all).")
    parser.add_argument("--skip-global", action="store_true")
    parser.add_argument("--population-only", action="store_true", help="Only re-bind population features (after scenarios).")
    parser.add_argument("--quick-fill-only", action="store_true", help="Only rebuild hierarchy quick-fill metadata.")
    parser.add_argument("--manifest-only", action="store_true", help="Only refresh data/manifest.json evidence.")
    args = parser.parse_args()
    merges = Merges(load_json(ROOT / args.plan))
    if args.quick_fill_only:
        apply_quick_fill()
        return
    if args.manifest_only:
        print(json.dumps({"manifest": refresh_manifest(manifest_in_sync())}))
        return
    if args.population_only:
        print(json.dumps({"population": apply_population(merges)}))
        return
    report = {}
    in_sync = manifest_in_sync()
    if not args.skip_global and not merges.scoped:
        report["base_topologies"] = apply_base_topologies(merges)
        apply_hierarchy(merges)
        apply_china_crosswalk(merges)
        apply_quick_fill()
    if not args.skip_global:
        apply_locales(merges)
        apply_geo_aliases(merges)
        report["global"] = project_files(global_projected_paths(merges), merges)
    for scenario_id in [scenario for scenario in args.scenario or SCENARIOS if scenario in merges.scenarios]:
        report[scenario_id] = apply_scenario(scenario_id, merges)
        print(json.dumps({scenario_id: {k: v for k, v in report[scenario_id].items() if k != "fixes"}}, ensure_ascii=False), flush=True)
    if not args.skip_global:
        report["population"] = apply_population(merges)
        report["manifest"] = refresh_manifest(in_sync)
    print(json.dumps({key: value for key, value in report.items() if key not in SCENARIOS}, ensure_ascii=False))


if __name__ == "__main__":
    main()
