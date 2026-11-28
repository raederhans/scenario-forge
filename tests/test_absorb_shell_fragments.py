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
