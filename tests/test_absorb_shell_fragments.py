import json

import pytest
from shapely.geometry import box

from map_builder.json_source import json_source_sha256
from map_builder.regional_geometry import _decode_geometry, _encode_exact_coverage
from tools.absorb_shell_fragments import absorb_topology, process_scenario, protected_ids
from tools.fill_political_coverage_gaps import area_km2, shared_arc_lengths


def topology(items):
    result = _encode_exact_coverage([i for i, _ in items], [g for _, g in items])
    for row in result["objects"]["political"]["geometries"]:
        row["id"] = row["properties"]["id"]
        row["properties"].update(name=row["id"], cntr_code="AA", metadata={"keep": [1, 2]})
    return result


def geometries(t):
    return {row["id"]: _decode_geometry(t, row) for row in t["objects"]["political"]["geometries"]}


def test_chain_attributes_shared_arcs_and_replay():
    h, a, b, n = "host", "RU_ARCTIC_FB_3064", "DE_SHELL_FB_012", "neighbor"
    t = topology([(b, box(.2, 0, .3, .1)), (n, box(-.1, 0, 0, .1)),
                  (a, box(.1, 0, .2, .1)), (h, box(0, 0, .1, .1))])
    before = geometries(t)
    rows = t["objects"]["political"]["geometries"]
    properties = dict(rows[-1]["properties"])
    shared = shared_arc_lengths(t)[(h, n)]
    owners = {h: "AA", a: "AA", b: "AA", n: "BB"}
    mapping, report = absorb_topology(t, owners)
    assert mapping == {a: h, b: h}
    after = geometries(t)
    assert set(after) == {h, n}
    assert after[h].equals(box(0, 0, .3, .1))
    assert after[n].wkb == before[n].wkb
    assert rows[-1]["properties"] == properties
    assert shared_arc_lengths(t)[(h, n)] == shared
    assert report["features_before"] == 4 and report["features_after"] == 2
    assert report["absorbed"] == 2 and report["hosts"] == 1
    assert report["absorbed_km2"] == round(area_km2(before[a]) + area_km2(before[b]), 6)
    snapshot = json.dumps(t)
    assert absorb_topology(t, owners)[1]["absorbed"] == 0
    assert json.dumps(t) == snapshot


def test_longest_boundary_and_ownership():
    f = "DE_SHELL_FB_2"
    items = [("foreign", box(0, -.2, .2, 0)), ("short", box(-.1, 0, 0, .1)),
             ("long", box(0, .1, .2, .2)), (f, box(0, 0, .2, .1))]
    t = topology(items)
    assert absorb_topology(t, {"foreign": "BB", "short": "AA", "long": "AA", f: "AA"})[0] == {f: "long"}
    t = topology(items[:1] + items[-1:])
    before = json.dumps(t)
    assert absorb_topology(t, {"foreign": "BB", f: "AA"})[1]["retained_by_reason"]["no_host"] == 1
    assert json.dumps(t) == before


def test_named_and_large_fragments(tmp_path):
    small, large = "GB_SHELL_FB_1", "RU_ARCTIC_FB_11"
    path = tmp_path / "scenarios/other/special_zone_layers.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"groups": [{"feature_ids": [small]}]}))
    t = topology([("host", box(0, 0, .1, .1)), (small, box(0, .1, .1, .2)),
                  (large, box(.1, 0, 1.1, 1))])
    before = json.dumps(t)
    mapping, report = absorb_topology(t, named=protected_ids(tmp_path))
    assert mapping == {}
    assert report["retained_by_reason"] == {"no_host": 0, "over_area": 1, "named": 1, "validation": 0}
    assert json.dumps(t) == before


def test_district_constraint_applies_to_final_host():
    first, second = "RU_ARCTIC_FB_7", "RU_ARCTIC_FB_8"
    t = topology([("same", box(-.1, 0, 0, .05)), ("long", box(0, -.1, .2, 0)),
                  (first, box(0, 0, .2, .1)), (second, box(.05, .1, .1, .2))])
    a, b = ("SOV", "state_1"), ("SOV", "state_2")
    districts = {"same": {a}, "long": {b}, first: {a}, second: {b}}
    assert absorb_topology(t, memberships=districts)[0] == {first: "same"}
    assert second in geometries(t)
    chain = topology([("same", box(0, 0, .1, .1)), (first, box(.1, 0, .2, .1)),
                      (second, box(.2, 0, .3, .1))])
    assert absorb_topology(chain, memberships={"same": {a}, second: {a}})[0] == {
        first: "same", second: "same"}


def test_neighboring_hosts_inherit_the_shared_fragment_edge():
    left, right = "DE_SHELL_FB_1", "CZ_SHELL_FB_1"
    t = topology([("DE", box(0, 0, .1, .1)), ("CZ", box(.1, 0, .2, .1)),
                  (left, box(0, .1, .1, .2)), (right, box(.1, .1, .2, .2))])
    before = shared_arc_lengths(t)
    assert absorb_topology(t, {"DE": "DE", left: "DE", "CZ": "CZ", right: "CZ"})[0] == {
        left: "DE", right: "CZ"}
    assert shared_arc_lengths(t)["CZ", "DE"] == pytest.approx(before["CZ", "DE"] + before[right, left])


def test_transfer_external_edge_and_inherit_only_existing_foreign_overlap():
    member = "DE_SHELL_FB_11"
    t = topology([("host", box(0, 0, .1, .1)), (member, box(.1, 0, .2, .1)),
                  ("north", box(.1, .1, .2, .2)), ("foreign", box(.13, .05, .18, .15))])
    owners = {"host": "DE", member: "DE", "north": "CZ", "foreign": "CZ"}
    before = geometries(t)
    old_shared = shared_arc_lengths(t)
    footprint = before["host"].union(before[member])
    assert before[member].intersection(before["foreign"]).area > 0
    assert absorb_topology(t, owners)[0] == {member: "host"}
    after = geometries(t)
    assert after["host"].equals(footprint)
    assert after["host"].intersection(after["foreign"]).equals(footprint.intersection(before["foreign"]))
    assert shared_arc_lengths(t)["host", "north"] == old_shared[member, "north"]
    assert after["north"].wkb == before["north"].wkb and after["foreign"].wkb == before["foreign"].wkb


def test_collinear_union_vertex_leaves_external_arc_coordinates_intact():
    member = "DE_SHELL_FB_12"
    t = topology([("host", box(-.1, .05, .08, .1)), (member, box(0, 0, .2, .1)),
                  ("third", box(0, .1, .2, .2))])
    before = geometries(t)
    assert absorb_topology(t, {"host": "DE", member: "DE", "third": "CZ"})[0] == {member: "host"}
    after = geometries(t)
    assert after["host"].equals(before["host"].union(before[member]))
    assert after["third"].wkb == before["third"].wkb
    assert shared_arc_lengths(t)["host", "third"] > 0


def test_partial_group_keeps_bad_fragment_and_its_dependent_chain():
    good, bad, child = ("DE_SHELL_FB_" + str(j) for j in range(3))
    t = topology([("host", box(0, 0, .1, .1)), (bad, box(.1, 0, .2, .1)),
                  (child, box(.2, 0, .3, .1)), (good, box(-.1, 0, 0, .1)),
                  ("third", box(.1, 0, .2, .1))])
    owners = {k: "DE" for k in ("host", good, bad, child)}
    owners["third"] = "CZ"
    before = geometries(t)
    mapping, report = absorb_topology(t, owners)
    assert mapping == {good: "host"}
    assert report["validation_by_reason"] == {"shared boundary lost": 1, "rejected connecting fragment": 1}
    after = geometries(t)
    assert after["host"].equals(before["host"].union(before[good]))
    for key in (bad, child, "third"):
        assert after[key].wkb == before[key].wkb
    snapshot = json.dumps(t)
    assert absorb_topology(t, owners)[0] == {} and json.dumps(t) == snapshot


def test_blank_base_country_fallback():
    fragment = "GB_SHELL_FB_1"
    t = topology([("UK01", box(-.1, 0, 0, .05)), ("DE_A", box(0, -.1, .2, 0)),
                  (fragment, box(0, 0, .2, .1))])
    for row in t["objects"]["political"]["geometries"]:
        del row["properties"]["cntr_code"]
    assert absorb_topology(t)[0] == {fragment: "UK01"}

    for country, expected in [("EL", "GR1"), ("G2", "parent")]:
        t = topology([("GR1", box(-.1, 0, 0, .05)), ("parent", box(0, -.1, .2, 0)),
                      (fragment, box(0, 0, .2, .1))])
        rows = t["objects"]["political"]["geometries"]
        for row in rows:
            del row["properties"]["cntr_code"]
        rows[1]["properties"]["CNTR"] = "G2"
        rows[2]["properties"]["ISO_A2_EH"] = country
        assert absorb_topology(t)[0] == {fragment: expected}

    t = topology([("ZZ_1", box(0, 0, .1, .1)), ("ZZ_SHELL_FB_1", box(.1, 0, .2, .1))])
    for row in t["objects"]["political"]["geometries"]:
        row["properties"]["cntr_code"] = "XX"
    assert absorb_topology(t)[1]["retained_by_reason"]["no_host"] == 1


def test_offset_partial_edge_closes_only_the_gap():
    f = "RU_ARCTIC_FB_42"
    t = topology([("host", box(0, 0, .1, .3)), (f, box(.1005, .1, .2, .2))])
    assert absorb_topology(t)[0] == {f: "host"}
    merged = geometries(t)["host"]
    expected = box(0, 0, .1, .3).union(box(.1, .1, .2, .2))
    assert merged.geom_type == "Polygon"
    assert merged.symmetric_difference(expected).area < 1e-15


def test_foreign_land_in_gap_keeps_host_and_fragment_intact():
    f = "RU_ARCTIC_FB_7"
    t = topology([("host", box(0, 0, .1, .1)), (f, box(.1005, 0, .2, .1)),
                  ("foreign", box(.1001, 0, .1004, .1))])
    before = json.dumps(t)
    mapping, report = absorb_topology(t, {"host": "AA", f: "AA", "foreign": "BB"})
    assert mapping == {}
    assert report["retained_by_reason"]["validation"] == 1
    assert json.dumps(t) == before


def test_materialized_sidecars_and_dry_run(tmp_path):
    data = tmp_path / "data"
    scene = data / "scenarios/modern_world"
    scene.mkdir(parents=True)
    member, host = "DE_SHELL_FB_012", "host"
    source = topology([(member, box(.1, 0, .2, .1)), (host, box(0, 0, .1, .1))])
    documents = {
        "runtime_topology.topo.json": source,
        "manifest.json": {"generated_at": "2026-01-01", "scenario_id": scene.name, "summary": {}},
        "owners.by_feature.json": {"owners": {host: "AA", member: "AA"}},
        "cores.by_feature.json": {"cores": {host: ["AA"], member: ["AA"]}},
        "countries.json": {"countries": {"AA": {"quality": "reviewed", "source": "baseline"}}},
        "audit.json": {"feature_changes": [{"feature_id": host}, {"feature_id": member}]},
        "strategic_values.by_feature.json": {"bucket_by_feature": {host: "H", member: "F"},
                                            "victory_points": [{"host_feature_id": member}]},
        "city_overrides.json": {"cities": {"local": {"host_feature_id": member}}},
        "district_groups.manual.json": {"tags": {"AA": {"districts": {"one": {
            "feature_ids": [member, host], "name": "One"}}}}, "version": 1},
        "geo_locale_patch.json": {"geo": {host: {"en": "Host", "zh": "甲"}, "id::" + member: {"en": "Old"}}},
    }
    for name, payload in documents.items():
        (scene / name).write_text(json.dumps(payload))
    (data / "world_cities.geojson").write_text(json.dumps({"features": [
        {"properties": {"id": "world", "stable_key": "id::world", "host_feature_id": member}}]}))
    layer = data / "thematic_layers/population/example"
    (layer / "features").mkdir(parents=True)
    path = layer / "features/modern_world.json"
    path.write_text(json.dumps({"features": {
        host: {"population": 15, "land_area_km2": 5, "coverage_fraction": 1, "status": "ok"},
        member: {"population": 9, "land_area_km2": 3, "coverage_fraction": 1, "status": "ok"}}}))
    (layer / "manifest.json").write_text(json.dumps({"scenarios": {
        scene.name: {"feature_count": 2, "core_feature_count": 2}}}))

    def snapshot():
        return {p: p.read_bytes() for p in data.rglob("*") if p.is_file()}

    before = snapshot()
    named = protected_ids(data)
    report = process_scenario(scene, named, 3000, True)
    assert report["absorbed"] == 1 and snapshot() == before
    path.write_text(json.dumps({"features": {}}))
    incomplete = snapshot()
    with pytest.raises(KeyError, match=member):
        process_scenario(scene, named, 3000, False)
    assert snapshot() == incomplete
    path.write_bytes(before[path])
    assert process_scenario(scene, named, 3000, False) == report

    def read(name):
        return json.loads((scene / name).read_bytes())

    assert read("owners.by_feature.json")["owners"] == {host: "AA"}
    assert read("cores.by_feature.json")["cores"] == {host: ["AA"]}
    assert read("audit.json")["feature_changes"] == [{"feature_id": host}]
    assert read("district_groups.manual.json") == {"tags": {"AA": {"districts": {"one": {
        "feature_ids": [host], "name": "One"}}}}, "version": 1}
    assert read("geo_locale_patch.json")["geo"] == {host: {"en": "Host", "zh": "甲"}}
    assert read("strategic_values.by_feature.json")["bucket_by_feature"] == {host: "H"}
    assert read("strategic_values.by_feature.json")["victory_points"] == [{"host_feature_id": host}]
    cities = read("city_overrides.json")["cities"]
    assert cities["local"]["host_feature_id"] == cities["world"]["host_feature_id"] == host
    population = json.loads(path.read_bytes())
    assert population["features"] == {host: {"population": 24, "land_area_km2": 8, "coverage_fraction": 1,
                                            "status": "ok", "density": 3}}
    assert population["geometry_version"] == json_source_sha256(scene / "runtime_topology.topo.json")
    assert population["feature_count"] == 1
    assert read("build_snapshot.json")["snapshot_fingerprint"] == read("manifest.json")["snapshot_fingerprint"]
    after = snapshot()
    assert process_scenario(scene, named, 3000, False)["absorbed"] == 0
    assert snapshot() == after


def test_locked_host_is_skipped_for_the_next_best_neighbour(tmp_path):
    from tools.absorb_shell_fragments import river_pack_parcels
    f = "RU_ARCTIC_FB_001"
    t = topology([("river", box(0, 0, .1, .2)), (f, box(.1, 0, .2, .2)), ("plain", box(.2, 0, .3, .1))])
    before = geometries(t)["river"].wkb
    assert absorb_topology(t, locked_hosts={"river"})[0] == {f: "plain"}
    assert geometries(t)["river"].wkb == before
    only = topology([("river", box(0, 0, .1, .2)), (f, box(.1, 0, .2, .2))])
    assert absorb_topology(only, locked_hosts={"river"})[1]["retained_by_reason"]["no_host"] == 1
    packs = tmp_path / "river_partitions"
    packs.mkdir()
    (packs / "a.json").write_text(json.dumps({"sceneId": "modern_world", "parents": [{"parentId": "river"}],
                                              "support": [{"parentId": "bank"}]}), encoding="utf-8")
    (packs / "b.json").write_text(json.dumps({"sceneId": "hoi4_1936", "parents": [{"parentId": "other"}]}), encoding="utf-8")
    assert river_pack_parcels(tmp_path, "modern_world") == {"river", "bank"}
