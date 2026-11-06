import gzip
import json
from pathlib import Path

from tools import rebind_city_hosts as rebind


def test_rebind_split_hosts_and_preserve_valid_hosts(tmp_path, monkeypatch):
    directory = tmp_path / "data/scenarios/fixture"
    directory.mkdir(parents=True)
    monkeypatch.setattr(rebind, "ROOT", tmp_path)
    rows = []
    for city_id, lon, host in [("split", 0.5, "parent"), ("valid", 1.5, "right"),
                               ("coast", -0.01, "parent"), ("gap", -0.03, "parent")]:
        rows.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, 0.5]},
                     "properties": {"id": city_id, "stable_key": f"id::{city_id}", "lon": lon,
                                    "lat": 0.5, "host_feature_id": host, "name_en": city_id,
                                    "name_zh": city_id}})
    (tmp_path / "data/world_cities.geojson").write_text(json.dumps({"features": rows}), encoding="utf-8")
    valid = {"city_id": "valid", "host_feature_id": "left", "display_name": {"en": "Keep"}}
    original = {"cities": {"valid": valid, "extra": {
        "city_id": "extra", "lon": 1.5, "lat": 0.5, "host_feature_id": "parent",
        "display_name": {"en": "Extra"}}}}
    topology = {"type": "Topology", "objects": {"political": {
        "type": "GeometryCollection", "geometries": [
            {"type": "Polygon", "properties": {"id": fid}, "arcs": [[i]]}
            for i, fid in enumerate(["left", "right"])]}},
        "arcs": [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]] for x in [0, 1]]}
    for name, payload in {"runtime_topology.topo.json": topology, "city_overrides.json": original,
                          "city_assets.partial.json": {}, "manifest.json": {"scenario_id": "fixture"},
                          "build_snapshot.json": {}, "audit.json": {}}.items():
        path = directory / name
        path.write_text(json.dumps(payload), encoding="utf-8")
        Path(str(path) + ".gz").write_bytes(gzip.compress(path.read_bytes()))
    result = rebind.rebind_city_hosts(directory)
    assert result["rebound_count"] == 3
    assert result["skipped"] == [{"city_id": "gap", "host_feature_id": "parent"}]
    payload = rebind.read(directory / "city_overrides.json")
    assert payload["cities"]["split"]["host_feature_id"] == "left"
    assert payload["cities"]["coast"]["host_feature_id"] == "left"
    for city_id in ("split", "coast"):
        assert "display_name" not in payload["cities"][city_id]
        assert set(payload["cities"][city_id]) == {"city_id", "stable_key", "host_feature_id"}
    assert payload["cities"]["extra"] == {**original["cities"]["extra"], "host_feature_id": "right"}
    assert payload["cities"]["valid"] == valid
    assert rebind.read(directory / "city_assets.partial.json")["cities"] == payload["cities"]
    for name in ("city_overrides.json", "city_assets.partial.json", "manifest.json", "build_snapshot.json", "audit.json"):
        assert gzip.decompress((directory / (name + ".gz")).read_bytes()) == (directory / name).read_bytes()
    before = {path.name: path.read_bytes() for path in directory.iterdir()}
    assert rebind.rebind_city_hosts(directory)["rebound_count"] == 0
    assert before == {path.name: path.read_bytes() for path in directory.iterdir()}


def test_modern_world_city_owners_after_backfill():
    directory = rebind.ROOT / "data/scenarios/modern_world"
    cities = rebind.read(directory / "city_overrides.json")["cities"]
    owners = rebind.read(directory / "owners.by_feature.json")["owners"]
    expected = {"Bukavu": "M23", "Uvira": "M23", "Famagusta": "NCY"}
    checked = set()
    for feature in rebind.read(rebind.ROOT / "data/world_cities.geojson")["features"]:
        row = feature["properties"]
        if row["name_en"] in expected:
            host = cities[row["id"]]["host_feature_id"]
            assert owners[host] == expected[row["name_en"]]
            checked.add(row["name_en"])
    assert checked == set(expected)
