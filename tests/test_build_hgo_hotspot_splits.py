from itertools import combinations

import numpy as np
import pytest
import shapely
from shapely.geometry import box

from map_builder.regional_geometry import _decode_geometry, _encode_exact_coverage
from tools import apply_hoi4_geometry_splits as apply
from tools import build_hgo_hotspot_splits as build


def test_partition_through_application(tmp_path):
    parent = box(8, 50, 8.30, 50.20)
    west, east = box(8, 50, 8.14, 50.20), box(8.16, 50, 8.30, 50.20)
    scrap = box(8.24, 50.08, 8.25, 50.09)
    assert apply.area_km2(scrap) < 3
    states = {1: west.union(scrap), 2: east.difference(scrap), 3: box(7, 49, 8.001, 50.001)}
    parts = build.partition(parent, states)
    assert set(parts) == {1, 2}
    assert parts[2].covers(scrap)
    assert all(apply.area_km2(p) >= 3 for g in parts.values() for p in build.polygons(g))

    names = {1: ("Öst", "东部"), 2: ("Ost", "奥斯特")}
    entry, masks = build.build_entry("P", parts, names, "masks.geojson")
    rules = {"entries": [entry], "area_tolerance_degrees2": 1e-9}
    build.write(tmp_path / "masks.geojson", {"type": "FeatureCollection", "features": masks})
    assert {p["name_en"]: p["suffix"] for p in apply.entry_parts(entry)} == {"Öst": "OST", "Ost": "OST_2"}
    topology = _encode_exact_coverage(["P"], [parent])
    compiled = apply.compile_external_parts(rules, tmp_path, topology)
    result, splits, _ = apply.split_topology(topology, compiled)
    rows = result["objects"]["political"]["geometries"]
    actual = [_decode_geometry(result, r) for r in rows]
    assert len(splits["P"]) == len(actual) == 2
    assert shapely.union_all(actual).equals(parent)
    assert shapely.coverage_is_valid(actual)
    assert all(a.intersection(b).area == 0 for a, b in combinations(actual, 2))
    assert {row["properties"]["name_zh"] for row in rows} == {"东部", "奥斯特"}


def test_single_eligible_state_emits_no_entry():
    parent = box(0, 0, 1, 1)
    small = box(0.5, 0.5, 0.505, 0.505)
    parts = build.partition(parent, {1: parent.difference(small), 2: small})
    assert build.build_entry("P", parts, {}, "masks.geojson") == (None, [])


def test_scraps_edge_strips_and_duplicate_city_names():
    parent = box(0, 0, 0.3, 0.1)
    west, east = box(0, 0, 0.15, 0.1), box(0.15, 0, 0.3, 0.1)
    scrap = box(0.24, 0.04, 0.25, 0.05)
    strip = box(0, 0.09, 0.15, 0.1)
    parts = {1: west.difference(strip).union(scrap), 2: east.difference(scrap), 3: strip}
    assert apply.area_km2(scrap) < 3 < apply.area_km2(strip)
    assert build.merge_scraps(parent, parts) == 2
    assert parts[1].equals(west) and parts[2].equals(east)
    points = shapely.STRtree([shapely.Point(0.03, 0.03), shapely.Point(0.06, 0.06)])
    cities = [dict(properties=dict(id="a", name_en="Small", population=100, name_zh="小城")),
              dict(properties=dict(id="b", name_en="Ortelsburg", population=200, name_zh="奥尔特尔斯堡"))]
    names = build.part_names(parts, {1: ("A", "甲"), 2: ("Ortelsburg", "奥尔特尔斯堡")}, points, cities)
    assert names == {1: ("West Ortelsburg", "西奥尔特尔斯堡"), 2: ("East Ortelsburg", "东奥尔特尔斯堡")}


def test_detached_parent_island_belongs_to_remainder():
    west, east = box(0, 0, 0.2, 0.1), box(0.2, 0, 0.3, 0.1)
    island = box(0.31, 0.04, 0.32, 0.05)
    parts = {1: west, 2: east.union(island)}
    parent = shapely.union_all(list(parts.values()))
    assert build.merge_scraps(parent, parts) == 1
    assert parts[1].equals(west.union(island))
    assert parts[2].equals(east)


def test_local_registration():
    grid = np.stack(np.meshgrid(np.arange(5), np.arange(5)), axis=-1).astype(float)
    coords = [(1, 1), (2, 1), (1, 2)]
    places = [dict(stateId=1, x=x+0.5, y=y+0.5, name=str(i)) for i, (x, y) in enumerate(coords)]
    cities = {str(i): [[x+0.1, y-0.1]] for i, (x, y) in enumerate(coords)}
    states = {1: box(0, 0, 3, 3)}
    target = box(0.1, -0.1, 3.1, 2.9)
    for subset, expected in [(places, "city affine"), (places[:2], "bbox")]:
        matrix, report = build.registration(states, target, subset, cities, grid, np.ones(2))
        assert matrix == pytest.approx([1, 0, 0, 1, 0.1, -0.1])
        assert expected in report
    grid[1, 1] = np.nan
    assert np.isnan(build.project(np.array([[1.75, 1.75]]), grid, np.ones(2))).all()


def test_bas_rhin_and_trentino_with_native_states():
    # The generator reads the pre-split topology, which the replay consumes, so
    # check the checked-in rules it produced instead of regenerating them.
    regions = [r for r in build.read(build.PREFIX.with_suffix(".regions.json"))
               if r["region_id"] in {"alsace_lorraine", "south_tyrol_trentino"}]
    wanted = {fid for region in regions for fid in region["parent_ids"]}
    rules = {"entries": [e for e in build.read(build.PREFIX.with_suffix(".geometry_splits.json"))["entries"]
                         if set(e["feature_ids"]) & wanted]}
    entries = {e["feature_ids"][0]: apply.entry_parts(e) for e in rules["entries"]}
    assert set(entries) == wanted
    assert all(len(parts) >= 2 for parts in entries.values())
    assert "Trento" in {p["name_en"] for p in entries["ITH20"]}
    assert any(p["name_en"].endswith("Rovereto") for p in entries["ITH20"])
    assert not {"Bassano Del Grappa", "Cittadella", "Possagno"} & {p["name_en"] for p in entries["ITH20"]}


def test_second_batch_parent_coverage_and_names():
    prefix = build.PREFIX.with_name("hoi4_hgo_hotspots_2")
    regions = build.read(prefix.with_suffix(".regions.json"))
    entries = build.read(prefix.with_suffix(".geometry_splits.json"))["entries"]
    parents = [fid for entry in entries for fid in entry["feature_ids"]]
    assert sorted(parents) == sorted(fid for region in regions for fid in region["parent_ids"])
    for entry in entries:
        parts = apply.entry_parts(entry)
        assert len(parts) >= 2, entry["id"]
        for language in ("name_en", "name_zh"):
            names = [part[language].strip().casefold() for part in parts]
            assert all(names) and len(set(names)) == len(parts), entry["id"]


def test_third_batch_parent_coverage_and_border_names():
    prefix = build.PREFIX.with_name("hoi4_hgo_hotspots_3")
    regions = build.read(prefix.with_suffix(".regions.json"))
    entries = build.read(prefix.with_suffix(".geometry_splits.json"))["entries"]
    parts = {fid: apply.entry_parts(entry) for entry in entries for fid in entry["feature_ids"]}
    assert set(parts) == {fid for region in regions for fid in region["parent_ids"]}
    for fid, children in parts.items():
        assert len(children) >= 2, fid
        for language in ("name_en", "name_zh"):
            labels = [child[language].strip().casefold() for child in children]
            assert all(labels) and len(set(labels)) == len(labels), fid

    names = {fid: {p["name_en"] for p in children} for fid, children in parts.items()}
    assert {"Jarabub", "Tobruk"} <= names["LBY-2987"]
    assert {"Maku", "Khoy"} <= names["IRN-3237"]
    assert names["TRB21"] == {"Van", "Baskale", "Gevas"}
    assert {"Inari", "Kittila"} <= names["FI1D7"]
    assert {"Inari", "Kittila"}.isdisjoint(names["SE332"] | names["NO074"])
    assert "Iraq Neutral Zone" in names["IRQ-3223"]
    assert "Saudi Neutral Zone" in names["SAU-861"]


def test_desert_registration_preserves_scale_away_from_controls():
    grid = np.stack(np.meshgrid(np.arange(5), np.arange(5)), axis=-1).astype(float)
    states = {1: box(0, 0, 3, 3)}
    anchors = [dict(stateId=1, x=1.5, y=1.5, name="A"), dict(stateId=1, x=2.5, y=1.5, name="B")]
    cities = {"A": [(1.1, 0.9)], "B": [(2.3, 0.9)]}
    matrix, _ = build.registration(states, box(0, 0, 4, 4), [], cities, grid, np.ones(2),
                                   anchors, translation_only=True)
    assert matrix == pytest.approx([1, 0, 0, 1, 0.2, -0.1])
