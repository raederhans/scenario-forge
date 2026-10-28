from copy import deepcopy
from pathlib import Path

import pytest
import shapely
from shapely.geometry import box

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
