from copy import deepcopy
import json
import pytest
import shapely
from shapely.geometry import box, mapping

from map_builder.regional_geometry import _encode_exact_coverage, _decode_geometry
from tools.apply_hoi4_geometry_splits import split_topology, arc_ids
import tools.apply_hoi4_geometry_splits as geometry_splits
import tools.rebind_city_hosts as city_hosts


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


def test_saved_parent_mapping_and_inherited_assignments(tmp_path, monkeypatch):
    topology, rules = fixture()
    directory = tmp_path / "data/scenarios/fixture"
    directory.mkdir(parents=True)
    files = {
        "runtime_topology.topo.json": topology,
        "manifest.json": {"hierarchy_overrides": {"feature_merges": {"unrelated": ["a", "b"]}}},
        "owners.by_feature.json": {"owners": {"original": "JAP", "neighbor": "SOV"}},
        "cores.by_feature.json": {"cores": {"original": ["SOV", "JAP"], "neighbor": ["SOV"]}},
        "geo_locale_patch.json": {"geo": {"id::original": {"en": "Original", "zh": "原块"}}},
        "city_overrides.json": {"version": 1, "cities": {}},
    }
    for name, payload in files.items():
        (directory / name).write_text(json.dumps(payload), encoding="utf-8")
    (tmp_path / "data/locales.json").write_text(json.dumps({"geo": {}}), encoding="utf-8")
    (tmp_path / "data/world_cities.geojson").write_text(json.dumps({"features": [{
        "type": "Feature", "geometry": {"type": "Point", "coordinates": [0.5, 0.5]},
        "properties": {"id": "city", "stable_key": "id::city", "lon": 0.5, "lat": 0.5,
                       "host_feature_id": "original"},
    }]}), encoding="utf-8")
    monkeypatch.setattr(geometry_splits, "ROOT", tmp_path)
    monkeypatch.setattr(city_hosts, "ROOT", tmp_path)
    calls = []
    monkeypatch.setattr(geometry_splits, "refresh_scenario", lambda directory, assignments, removed_ids:
                        calls.append((assignments, removed_ids)))
    assert geometry_splits.run_scenario(directory, rules)["changed"] == 1
    manifest = geometry_splits.read(directory / "manifest.json")
    assert manifest["hierarchy_overrides"]["feature_merges"] == {"unrelated": ["a", "b"]}
    children = manifest["hierarchy_overrides"]["feature_splits"]["original"]
    assert children == ["original__SPLIT_SOUTH", "original__SPLIT_NORTH"]
    assignments, removed = calls[0]
    assert removed == ["original"]
    assert all(assignments[child] == {"parent_id": "original", "owner": "JAP", "controller": "JAP", "cores": ["SOV", "JAP"]}
               for child in children)
    patch = geometry_splits.read(directory / "geo_locale_patch.json")
    assert patch["geo"]["id::original__SPLIT_SOUTH"] == {"en": "Original · South", "zh": "原块 · 南"}
    assert geometry_splits.read(directory / "city_overrides.json")["cities"]["city"] == {
        "city_id": "city", "stable_key": "id::city", "host_feature_id": "original__SPLIT_SOUTH",
    }
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


def test_missing_remainder_with_uncovered_area_is_rejected():
    topology, rules = multipart_fixture()
    del rules["entries"][0]["remainder"]
    with pytest.raises(ValueError, match="south.*original"):
        split_topology(topology, rules)
