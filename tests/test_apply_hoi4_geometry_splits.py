from copy import deepcopy
from pathlib import Path

import pytest
import shapely
from shapely.geometry import box, mapping

from map_builder.regional_geometry import _encode_exact_coverage, _decode_geometry
from tools.apply_hoi4_geometry_splits import split_topology, arc_ids
import tools.apply_hoi4_geometry_splits as geometry_splits


def fixture():
    topology = _encode_exact_coverage(["original", "neighbor"], [box(0, 0, 2, 2), box(2, 0, 3, 2)])
    topology["objects"]["political"]["geometries"][0]["properties"]["name"] = "Original"
    rules = {"area_tolerance_degrees2": 1e-9, "entries": [{
        "id": "south", "feature_ids": ["original"],
        "polygon": {"type": "Polygon", "coordinates": [[[-1, -1], [4, -1], [4, 1], [-1, 1], [-1, -1]]]},
        "inside": {"suffix": "SOUTH", "name_en": "South", "name_zh": "南"},
        "outside": {"suffix": "NORTH", "name_en": "North", "name_zh": "北"}, "sources": ["synthetic"],
    }]}
    return topology, rules


def test_area_coverage_shared_arcs_and_idempotence():
    topology, rules = fixture()
    original = deepcopy(topology)
    result, splits, report = split_topology(topology, rules)
    assert topology == original
    assert splits == {"original": ["original__SPLIT_SOUTH", "original__SPLIT_NORTH"]}
    rows = {row["properties"]["id"]: row for row in result["objects"]["political"]["geometries"]}
    south, north = [_decode_geometry(result, rows[fid]) for fid in splits["original"]]
    assert south.is_valid and north.is_valid
    assert south.intersection(north).area == 0
    assert shapely.union_all([south, north]).equals(box(0, 0, 2, 2))
    assert south.area + north.area == 4
    assert _decode_geometry(result, rows["neighbor"]).equals(box(2, 0, 3, 2))
    neighbors = set(arc_ids(rows["neighbor"]["arcs"]))
    for fid in splits["original"]:
        assert neighbors & set(arc_ids(rows[fid]["arcs"]))
        assert "Original" in rows[fid]["properties"]["aliases"]
    assert len(report) == 2 and all(row["area_km2"] > 0 for row in report)
    repeated, mapping, report = split_topology(result, rules)
    assert repeated == result and not mapping and not report


def test_incomplete_prior_split_is_rejected():
    topology, rules = fixture()
    topology["objects"]["political"]["geometries"][0]["properties"]["id"] = "original__SPLIT_SOUTH"
    with pytest.raises(ValueError, match="Missing split parent or children"):
        split_topology(topology, rules)


def test_saved_parent_mapping_and_inherited_assignments(monkeypatch):
    topology, rules = fixture()
    directory = Path(".runtime/tmp/synthetic-geometry-scenario")
    files = {
        "runtime_topology.topo.json": topology,
        "manifest.json": {"hierarchy_overrides": {"feature_merges": {"unrelated": ["a", "b"]}}},
        "owners.by_feature.json": {"owners": {"original": "JAP", "neighbor": "SOV"}},
        "cores.by_feature.json": {"cores": {"original": ["SOV", "JAP"], "neighbor": ["SOV"]}},
        "geo_locale_patch.json": {"geo": {"id::original": {"en": "Original", "zh": "原块"}}},
        "locales.json": {"geo": {}},
    }
    monkeypatch.setattr(geometry_splits, "read", lambda path: deepcopy(files[path.name]))
    def write(path, payload):
        files[path.name] = deepcopy(payload)
    monkeypatch.setattr(geometry_splits, "write", write)
    monkeypatch.setattr(geometry_splits, "write_json", write)
    calls = []
    monkeypatch.setattr(geometry_splits, "refresh_scenario", lambda directory, assignments, removed_ids:
                        calls.append((assignments, removed_ids)))
    assert geometry_splits.run_scenario(directory, rules)["changed"] == 1
    manifest = files["manifest.json"]
    assert manifest["hierarchy_overrides"]["feature_merges"] == {"unrelated": ["a", "b"]}
    children = manifest["hierarchy_overrides"]["feature_splits"]["original"]
    assert children == ["original__SPLIT_SOUTH", "original__SPLIT_NORTH"]
    assignments, removed = calls[0]
    assert removed == ["original"]
    assert all(assignments[child] == {"parent_id": "original", "owner": "JAP", "controller": "JAP", "cores": ["SOV", "JAP"]}
               for child in children)
    patch = files["geo_locale_patch.json"]
    assert patch["geo"]["id::original__SPLIT_SOUTH"] == {"en": "Original · South", "zh": "原块 · 南"}
    assert geometry_splits.run_scenario(directory, rules)["changed"] == 0
    assert len(calls) == 1


def multipart_fixture():
    topology, rules = fixture()
    entry = rules["entries"][0]
    del entry["polygon"], entry["inside"], entry["outside"]
    entry["parts"] = [
        {"polygon": mapping(box(-1, -1, 4, 0.5)), "suffix": "SOUTH", "name_en": "South", "name_zh": "南"},
        {"polygon": mapping(box(-1, 0.5, 4, 1.5)), "suffix": "MIDDLE", "name_en": "Middle", "name_zh": "中"},
    ]
    entry["remainder"] = {"suffix": "NORTH", "name_en": "North", "name_zh": "北"}
    return topology, rules


def test_three_parts_coverage_shared_arcs_and_idempotence():
    topology, rules = multipart_fixture()
    before = deepcopy(topology)
    result, splits, report = split_topology(topology, rules)
    assert topology == before
    children = ["original__SPLIT_" + suffix for suffix in ("SOUTH", "MIDDLE", "NORTH")]
    assert splits == {"original": children}
    rows = {row["properties"]["id"]: row for row in result["objects"]["political"]["geometries"]}
    parts = [_decode_geometry(result, rows[child]) for child in children]
    assert all(part.is_valid for part in parts)
    assert all(a.intersection(b).area == 0 for i, a in enumerate(parts) for b in parts[i + 1:])
    assert shapely.union_all(parts).equals(box(0, 0, 2, 2))
    assert sum(part.area for part in parts) == 4
    arcs = [set(arc_ids(rows[child]["arcs"])) for child in children]
    assert arcs[0] & arcs[1]
    assert arcs[1] & arcs[2]
    neighbor_arcs = set(arc_ids(rows["neighbor"]["arcs"]))
    assert all(child_arcs & neighbor_arcs for child_arcs in arcs)
    assert _decode_geometry(result, rows["neighbor"]).equals(box(2, 0, 3, 2))
    assert [row["child_id"] for row in report] == children
    assert all(row["area_km2"] > 0 and row["overlap_degrees2"] == 0 for row in report)
    assert rows[children[1]]["properties"]["name_en"] == "Original · Middle"
    repeated, mapping_result, report = split_topology(result, rules)
    assert repeated == result and not mapping_result and not report


def test_parts_cover_parent_without_remainder():
    topology, rules = multipart_fixture()
    entry = rules["entries"][0]
    del entry["remainder"]
    entry["parts"][1]["polygon"] = mapping(box(-1, 0.5, 4, 3))
    result, splits, report = split_topology(topology, rules)
    assert splits["original"] == ["original__SPLIT_SOUTH", "original__SPLIT_MIDDLE"]
    parts = [_decode_geometry(result, row) for row in result["objects"]["political"]["geometries"]
             if row["properties"]["id"] in splits["original"]]
    assert shapely.union_all(parts).equals(box(0, 0, 2, 2))
    assert sum(row["area_degrees2"] for row in report) == 4
    assert split_topology(result, rules) == (result, {}, [])


@pytest.mark.parametrize("polygon", [box(4, 4, 5, 5), box(2, 0, 3, 2)])
def test_empty_or_nonpolygonal_part_is_rejected(polygon):
    topology, rules = multipart_fixture()
    rules["entries"][0]["parts"][0]["polygon"] = mapping(polygon)
    with pytest.raises(ValueError, match="south.*original"):
        split_topology(topology, rules)


def test_declared_empty_remainder_is_rejected():
    topology, rules = multipart_fixture()
    rules["entries"][0]["parts"][1]["polygon"] = mapping(box(-1, 0.5, 4, 3))
    with pytest.raises(ValueError, match="south.*original"):
        split_topology(topology, rules)


def test_missing_remainder_with_uncovered_area_is_rejected():
    topology, rules = multipart_fixture()
    del rules["entries"][0]["remainder"]
    with pytest.raises(ValueError, match="south.*original"):
        split_topology(topology, rules)


def test_mixed_rule_formats_are_rejected():
    topology, rules = fixture()
    rules["entries"][0]["parts"] = multipart_fixture()[1]["entries"][0]["parts"]
    with pytest.raises(ValueError, match="south"):
        split_topology(topology, rules)


def test_missing_rule_formats_are_rejected():
    topology, rules = fixture()
    entry = rules["entries"][0]
    del entry["polygon"], entry["inside"], entry["outside"]
    with pytest.raises(ValueError, match="south"):
        split_topology(topology, rules)


def test_overlapping_polygons_assign_overlap_to_first_part():
    topology, rules = multipart_fixture()
    rules["entries"][0]["parts"][1]["polygon"] = mapping(box(-1, 0.25, 4, 1.5))
    result, splits, _ = split_topology(topology, rules)
    rows = {row["properties"]["id"]: row for row in result["objects"]["political"]["geometries"]}
    first, second, remainder = [_decode_geometry(result, rows[child]) for child in splits["original"]]
    assert first.equals(box(0, 0, 2, 0.5))
    assert second.equals(box(0, 0.5, 2, 1.5))
    assert remainder.equals(box(0, 1.5, 2, 2))


@pytest.mark.parametrize("make_fixture, suffixes", [
    (fixture, ["SOUTH", "NORTH"]),
    (multipart_fixture, ["SOUTH", "MIDDLE", "NORTH"]),
])
def test_main_writes_ordered_child_ids(monkeypatch, make_fixture, suffixes):
    _, rules = make_fixture()
    rules["scenarios"] = []
    monkeypatch.setattr(geometry_splits, "read", lambda path: rules)
    writes = []
    monkeypatch.setattr(geometry_splits, "write_json", lambda path, payload: writes.append((path, payload)))
    geometry_splits.main([])
    assert writes[0][0].name == "hoi4_feature_splits.v1.json"
    assert writes[0][1]["feature_splits"] == {"original": ["original__SPLIT_" + suffix for suffix in suffixes]}


def test_main_uses_requested_rules_scenarios_and_migration_output(monkeypatch):
    _, rules = fixture()
    rules["scenarios"] = ["hoi4_1936"]
    reads, writes, runs = [], [], []
    monkeypatch.setattr(geometry_splits, "read", lambda path: reads.append(path) or rules)
    monkeypatch.setattr(geometry_splits, "write_json", lambda path, payload: writes.append((path, payload)))
    monkeypatch.setattr(geometry_splits, "run_scenario", lambda path, payload:
                        runs.append((path, payload)) or {"changed": 0, "measurements": []})
    geometry_splits.main(["--rules", "tno.rules.json", "--scenarios", "tno_1962",
                          "--migration-output", "tno.migration.json"])
    assert str(reads[0]) == "tno.rules.json"
    assert str(writes[0][0]) == "tno.migration.json"
    assert writes[0][1]["scenarios"] == ["tno_1962"]
    assert [path.name for path, _ in runs] == ["tno_1962"]
