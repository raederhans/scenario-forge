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


def test_bas_rhin_and_trentino_with_native_states(tmp_path):
    regions = [r for r in build.read(build.PREFIX.with_suffix(".regions.json"))
               if r["region_id"] in {"alsace_lorraine", "south_tyrol_trentino"}]
    config, rules = tmp_path / "regions.json", tmp_path / "rules.json"
    build.write(config, regions)
    build.main(["--regions", str(config), "--rules", str(rules), "--sources", str(tmp_path / "masks.geojson")])
    entries = {e["id"]: apply.entry_parts(e) for e in build.read(rules)["entries"]}
    assert set(entries) == {fid for region in regions for fid in region["parent_ids"]}
    assert all(len(parts) >= 2 for parts in entries.values())
    assert {"Rovereto", "Trentino", "North Trentino", "West Trentino"} <= {p["name_en"] for p in entries["ITH20"]}
    assert not {"Bassano Del Grappa", "Cittadella", "Possagno"} & {p["name_en"] for p in entries["ITH20"]}
