"""Selection and compatibility checks for offline river partition builds.

These checks do not authenticate or approve a pack for the runtime loader.
"""
from __future__ import annotations

from collections import Counter
import json
from pathlib import Path


def unique_values(values, label, *, casefold=False):
    if not isinstance(values, list) or any(not isinstance(v, str) or not v.strip() for v in values):
        raise ValueError(f"{label} must be a list of nonempty strings")
    cleaned = [v.strip() for v in values]
    counts = Counter(v.casefold() if casefold else v for v in cleaned)
    duplicates = sorted(v for v, count in counts.items() if count > 1)
    if duplicates:
        raise ValueError(f"Duplicate {label}: {duplicates}")
    return cleaned


def read_selections(paths: list[Path], parents, rivers, *, scene_id, source):
    """Combine explicit scopes; reject accidental duplicate parents across files.

    River names are a union across regional files, but duplicates within a file
    or repeated CLI arguments are rejected. Sharing a river between regions is
    expected; sharing ownership of a parent is not.
    """
    parents = unique_values(parents, "parent IDs")
    rivers = unique_values(rivers, "river names", casefold=True)
    for path in paths:
        selection = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(selection, dict) or type(selection.get("schemaVersion")) is not int or selection["schemaVersion"] != 1:
            raise ValueError(f"{path}: selection schemaVersion must be 1")
        unknown = set(selection) - {"schemaVersion", "sceneId", "source", "parents", "rivers"}
        if unknown:
            raise ValueError(f"{path}: unknown selection fields: {sorted(unknown)}")
        if selection.get("sceneId") != scene_id:
            raise ValueError(f"{path}: selection sceneId differs from --scene-id")
        expected = selection.get("source")
        if not isinstance(expected, dict) or not {"landDigest", "riverDigest"} <= set(expected):
            raise ValueError(f"{path}: source requires landDigest and riverDigest")
        unknown = set(expected) - {"landDigest", "riverDigest", "landObject", "includeLakeCenterlines", "baseCommit", "baselineHash"}
        if unknown:
            raise ValueError(f"{path}: unknown source identity fields: {sorted(unknown)}")
        for key, value in expected.items():
            if type(value) is not type(source.get(key)) or value != source.get(key):
                raise ValueError(f"{path}: source identity mismatch: {key}")
        file_parents = unique_values(selection.get("parents"), "parent IDs")
        file_rivers = unique_values(selection.get("rivers"), "river names", casefold=True)
        if not file_parents or not file_rivers:
            raise ValueError(f"{path}: explicit selection needs at least one parent and river")
        parents = unique_values(parents + file_parents, "parent IDs")
        # Preserve deterministic spelling without counting shared rivers twice.
        by_name = {name.casefold(): name for name in rivers}
        for name in file_rivers:
            by_name.setdefault(name.casefold(), name)
        rivers = list(by_name.values())
    if not rivers:
        raise ValueError("At least one --river or selection river is required")
    return sorted(parents), sorted(rivers)


def _records(items, key, label):
    if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
        raise ValueError(f"Invalid {label} records")
    unique_values([item.get(key) for item in items], label)
    return {item[key]: item for item in items}


def validate_comparison_source(baseline, *, scene_id, source):
    if not isinstance(baseline, dict) or baseline.get("kind") != "river-paint-partitions" or type(baseline.get("schemaVersion")) is not int or baseline.get("schemaVersion") != 1:
        raise ValueError("Comparison input must be a schema-1 river partition pack")
    if baseline.get("sceneId") != scene_id:
        raise ValueError("Comparison source identity mismatch: sceneId")
    old_source = baseline.get("source", {})
    if not isinstance(old_source, dict):
        raise ValueError("Invalid comparison source identity")
    for key in ("landDigest", "riverDigest", "includeLakeCenterlines"):
        if key not in old_source or key not in source or old_source[key] != source[key]:
            raise ValueError(f"Comparison source identity mismatch: {key}")
    old_names = unique_values(old_source.get("riverNames"), "comparison river names", casefold=True)
    if {n.casefold() for n in old_names} - {n.casefold() for n in source["riverNames"]}:
        raise ValueError("Comparison requires all previously selected river names")
    old = _records(baseline.get("parents"), "parentId", "comparison parent IDs")
    support = _records(baseline.get("support", []), "parentId", "comparison support IDs")
    if not old or old.keys() & support.keys():
        raise ValueError("Comparison requires nonempty parents disjoint from support")
    for parent in old.values():
        if not parent.get("parentGeometry") or not parent.get("parentFingerprint") or not parent.get("cells"):
            raise ValueError(f"Incomplete comparison parent: {parent['parentId']}")
        cells = _records(parent["cells"], "id", "comparison cell IDs")
        if any(not c.get("geometry") or not c.get("geometryFingerprint") for c in cells.values()):
            raise ValueError(f"Incomplete comparison cells: {parent['parentId']}")


def _exact(value):
    # No coordinate rounding: fingerprints alone would miss sub-grid changes.
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def compare_packs(pack, baseline):
    validate_comparison_source(baseline, scene_id=pack["sceneId"], source=pack["source"])
    if baseline["source"].get("landObject", "political") != pack["source"].get("landObject", "political"):
        raise ValueError("Comparison source identity mismatch: landObject")
    for key in ("algorithmVersion", "coordinateIdentityPrecision", "geometryWinding"):
        if pack.get(key) != baseline.get(key):
            raise ValueError(f"Comparison contract mismatch: {key}")
    old = _records(baseline["parents"], "parentId", "comparison parent IDs")
    new = _records(pack["parents"], "parentId", "built parent IDs")
    missing = sorted(old.keys() - new.keys())
    changed = []
    for fid in sorted(old.keys() & new.keys()):
        before, after = old[fid], new[fid]
        reasons = []
        for key in ("parentGeometry", "parentFingerprint"):
            if _exact(before[key]) != _exact(after[key]):
                reasons.append(key)
        old_cells = _records(before["cells"], "id", "comparison cell IDs")
        new_cells = _records(after["cells"], "id", "built cell IDs")
        if old_cells.keys() != new_cells.keys():
            reasons.append("cellIds")
        for key in ("geometry", "geometryFingerprint"):
            if any(_exact(old_cells[cid][key]) != _exact(new_cells[cid][key]) for cid in old_cells.keys() & new_cells.keys()):
                reasons.append("cell" + key[0].upper() + key[1:])
        if reasons:
            changed.append({"parentId": fid, "changes": reasons})
    old_support = _records(baseline.get("support", []), "parentId", "comparison support IDs")
    new_support = _records(pack.get("support", []), "parentId", "built support IDs")
    return {
        "passed": not missing and not changed,
        "baselinePackId": baseline.get("packId"),
        "oldParentCount": len(old), "retainedParentCount": len(old.keys() & new.keys()),
        "unchangedParentCount": len(old.keys() & new.keys()) - len(changed),
        "newParentCount": len(new.keys() - old.keys()),
        "missingParents": missing, "changedParents": changed,
        "supportComparison": {
            "oldCount": len(old_support), "newCount": len(new_support),
            "added": sorted(new_support.keys() - old_support.keys()),
            "removed": sorted(old_support.keys() - new_support.keys()),
            "promotedToParent": sorted((old_support.keys() - new_support.keys()) & new.keys()),
            "changed": sorted(fid for fid in old_support.keys() & new_support.keys()
                              if _exact(old_support[fid]) != _exact(new_support[fid])),
            "affectsParentStabilityVerdict": False,
        },
    }
