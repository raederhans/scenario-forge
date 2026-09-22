import json
from pathlib import Path

import pytest
from shapely.geometry import shape
from shapely.ops import unary_union

from tools.scenario_chunk_assets import (
    _optimize_political_coarse_payload,
    _reusable_detail_entries_match_owner,
    _topology_object_to_feature_collection,
    build_and_write_scenario_chunk_assets,
)


@pytest.mark.parametrize("explicit_ids", [False, True])
def test_actual_builder_preserves_each_detail_shard_boundary(tmp_path: Path, explicit_ids):
    ids = ["US_CNTY_01001", "US_CNTY_01003", "US_CNTY_01005"]
    topology = {
        "type": "Topology",
        "arcs": [
            [[0, 0], [0, 1], [1, 1], [1.000001, .5], [1, 0], [0, 0]],
            [[1, 0], [1.000001, .5], [1, 1], [2, 1], [2.000001, .5], [2, 0], [1, 0]],
            [[2, 0], [2.000001, .5], [2, 1], [3, 1], [3, 0], [2, 0]],
        ],
        "objects": {"political": {"type": "GeometryCollection", "geometries": [
            {"type": "Polygon", "arcs": [[index]], "properties": {"id": fid, "cntr_code": "US"}}
            for index, fid in enumerate(ids)
        ]}},
        **({"political_precision_feature_ids": ids} if explicit_ids else {"political_precision_source_countries": ["US"]}),
    }
    source = _topology_object_to_feature_collection(topology, "political")
    owners = dict.fromkeys(ids, "US")
    (tmp_path / "owners.by_feature.json").write_text(json.dumps({"owners": owners}), encoding="utf-8")
    # Three entries cost 17,18,17; median bisection yields one singleton and a pair.
    build_and_write_scenario_chunk_assets(
        scenario_dir=tmp_path, manifest_payload={"scenario_id": "test"},
        startup_topology_payload=topology, runtime_topology_payload=topology,
        detail_shard_max_path_cost=38,
    )
    manifest = json.loads((tmp_path / "detail_chunks.manifest.json").read_text(encoding="utf-8"))
    detail_shards, coarse = [], {}
    for entry in manifest["chunks"]:
        if entry["layer"] != "political":
            continue
        payload = json.loads((tmp_path / "chunks" / Path(entry["url"]).name).read_text(encoding="utf-8"))
        geometries = {f["properties"]["id"]: shape(f["geometry"]) for f in payload["features"]}
        if entry["lod"] == "coarse":
            coarse.update(geometries)
        else:
            detail_shards.append(geometries)
    assert sorted(map(len, detail_shards)) == [1, 2]
    original = {f["properties"]["id"]: shape(f["geometry"]) for f in source["features"]}
    for shard in detail_shards:
        assert all(geom.equals_exact(original[fid], 0) for fid, geom in shard.items())
        assert unary_union(list(shard.values())).equals(unary_union([coarse[fid] for fid in shard]))
    assert sum(len(g.exterior.coords) for g in coarse.values()) < sum(len(g.exterior.coords) for g in original.values())

    # The previous owner-only grouping preserves the country but changes shard edges.
    owner_only = _optimize_political_coarse_payload(
        source, owner_buckets_by_feature_id=owners,
        political_precision_feature_ids=set(ids),
    )
    old_coarse = {f["properties"]["id"]: shape(f["geometry"]) for f in owner_only["features"]}
    assert unary_union(list(old_coarse.values())).equals(unary_union(list(original.values())))
    assert any(not unary_union(list(shard.values())).equals(unary_union([old_coarse[fid] for fid in shard]))
               for shard in detail_shards)


def test_reuse_requires_current_per_shard_membership(tmp_path: Path):
    (tmp_path / "chunks").mkdir()
    entries = []
    for chunk_id, fid in [("one", "a"), ("two", "b")]:
        (tmp_path / "chunks" / f"{chunk_id}.json").write_text(
            json.dumps({"features": [{"properties": {"id": fid}}]}), encoding="utf-8")
        entries.append({"id": chunk_id, "url": f"chunks/{chunk_id}.json"})
    assert _reusable_detail_entries_match_owner(tmp_path, entries, {"a", "b"}, {"one": {"a"}, "two": {"b"}})
    assert not _reusable_detail_entries_match_owner(tmp_path, entries, {"a", "b"}, {"one": {"b"}, "two": {"a"}})
