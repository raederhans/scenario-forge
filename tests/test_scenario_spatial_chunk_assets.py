from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

import geopandas as gpd
from topojson import Topology

from map_builder.contracts import sha256_path
from tools import scenario_chunk_assets


def _synthetic_topojson(features: list[dict]) -> dict:
    gdf = gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")
    return Topology(
        gdf,
        object_name="political",
        prequantize=False,
        topoquantize=False,
        presimplify=False,
        toposimplify=False,
        shared_coords=False,
    ).to_dict()


class ScenarioSpatialChunkAssetsTest(unittest.TestCase):
    def test_partition_oversized_splits_deterministically_without_loss(self) -> None:
        # Create 4 features along X axis and use tight budgets so they must split
        features = [
            {
                "type": "Feature",
                "properties": {"id": f"GER-{i}"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[i * 2, 0], [i * 2 + 1, 0], [i * 2 + 1, 1], [i * 2, 1], [i * 2, 0]]],
                },
            }
            for i in range(4)
        ]
        entries = [
            (f["properties"]["id"], f, scenario_chunk_assets._feature_bounds(f))
            for f in features
        ]
        # Force split with tight max_compact_bytes or max_path_cost
        shards_1 = scenario_chunk_assets.partition_political_detail_features(
            entries,
            max_compact_bytes=350,
            max_path_cost=15,
        )
        shards_2 = scenario_chunk_assets.partition_political_detail_features(
            entries,
            max_compact_bytes=350,
            max_path_cost=15,
        )
        # Deterministic
        self.assertEqual(
            [[e[0] for e in s] for s in shards_1],
            [[e[0] for e in s] for s in shards_2],
        )
        # More than 1 shard
        self.assertGreater(len(shards_1), 1)
        # Every feature appears exactly once
        flat_ids = [e[0] for s in shards_1 for e in s]
        self.assertEqual(sorted(flat_ids), ["GER-0", "GER-1", "GER-2", "GER-3"])
        # Original coordinates preserved unmodified
        for shard in shards_1:
            for fid, feat, _bounds in shard:
                orig = next(f for f in features if f["properties"]["id"] == fid)
                self.assertEqual(feat["geometry"]["coordinates"], orig["geometry"]["coordinates"])

    def test_partition_oversized_singleton_allowed(self) -> None:
        # A single feature that by itself exceeds the budget
        big_feature = {
            "type": "Feature",
            "properties": {"id": "BIG-1"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
            },
        }
        entries = [("BIG-1", big_feature, scenario_chunk_assets._feature_bounds(big_feature))]
        shards = scenario_chunk_assets.partition_political_detail_features(
            entries,
            max_compact_bytes=10,  # lower than feature compact size
            max_path_cost=1,       # lower than feature path cost
        )
        self.assertEqual(len(shards), 1)
        self.assertEqual(len(shards[0]), 1)
        self.assertEqual(shards[0][0][0], "BIG-1")

    def test_partition_full_bounds_covers_overseas_territory(self) -> None:
        # France-like feature with European mainland and overseas territory
        overseas_feature = {
            "type": "Feature",
            "properties": {"id": "FRA-METRO_AND_OVERSEAS"},
            "geometry": {
                "type": "MultiPolygon",
                "coordinates": [
                    # Mainland (approx Europe: 2E..5E, 45N..48N)
                    [[[2.0, 45.0], [5.0, 45.0], [5.0, 48.0], [2.0, 48.0], [2.0, 45.0]]],
                    # Overseas (approx Guiana / Reunion: -53W..-52W, 4N..5N)
                    [[[-53.0, 4.0], [-52.0, 4.0], [-52.0, 5.0], [-53.0, 5.0], [-53.0, 4.0]]],
                ],
            },
        }
        bounds = scenario_chunk_assets._feature_bounds(overseas_feature)
        self.assertEqual(bounds, [-53.0, 4.0, 5.0, 48.0])

        entries = [("FRA-METRO_AND_OVERSEAS", overseas_feature, bounds)]
        shards = scenario_chunk_assets.partition_political_detail_features(entries)
        self.assertEqual(len(shards), 1)
        shard_entries = shards[0]
        shard_bounds = [
            min(e[2][0] for e in shard_entries),
            min(e[2][1] for e in shard_entries),
            max(e[2][2] for e in shard_entries),
            max(e[2][3] for e in shard_entries),
        ]
        self.assertEqual(shard_bounds, [-53.0, 4.0, 5.0, 48.0])

    def _owner_features(self, scenario_dir):
        features = [
            {"type": "Feature", "properties": {"id": fid, "cntr_code": "FRA"},
             "geometry": {"type": "Polygon", "coordinates": [
                 [[x, 0.0], [x+1, 0.0], [x+1, 1.0], [x, 1.0], [x, 0.0]]
             ]}}
            for fid, x in (("FRA-1", 0.0), ("FRA-2", 10.0))
        ]
        (scenario_dir / "owners.by_feature.json").write_text(
            json.dumps({"version": 1, "owners": {"FRA-1": "FRA", "FRA-2": "FRA"}}), encoding="utf-8"
        )
        return features

    def test_reusable_political_chunks_never_reuses_stale_whole_chunk_after_split(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "test_scenario"
            scenario_dir.mkdir(parents=True)
            chunks_dir = scenario_dir / "chunks"
            chunks_dir.mkdir(parents=True)

            features = self._owner_features(scenario_dir)

            # Fabricate an old whole-owner chunk on disk and in reusable map
            old_chunk_id = "political.detail.country.fra"
            old_chunk_file = chunks_dir / f"{old_chunk_id}.json"
            old_payload = {"type": "FeatureCollection", "features": features}
            old_chunk_file.write_text(json.dumps(old_payload), encoding="utf-8")

            stale_reusable = {
                old_chunk_id: {
                    "id": old_chunk_id,
                    "layer": "political",
                    "lod": "detail",
                    "url": f"data/scenarios/test_scenario/chunks/{old_chunk_id}.json",
                    "min_zoom": 1.35,
                    "max_zoom": 99.0,
                    "byte_size": old_chunk_file.stat().st_size,
                    "sha256": sha256_path(old_chunk_file),
                    "country_codes": ["FRA"],
                }
            }

            runtime_topology = _synthetic_topojson(features)
            startup_topology = _synthetic_topojson(features)

            # Build with partition budget that splits FRA into 2 shards
            result = scenario_chunk_assets.build_and_write_scenario_chunk_assets(
                scenario_dir=scenario_dir,
                manifest_payload={"scenario_id": "test_scenario", "generated_at": "2026-09-13T00:00:00Z"},
                startup_topology_payload=startup_topology,
                runtime_topology_payload=runtime_topology,
                reusable_political_chunks=stale_reusable,
                detail_shard_max_compact_bytes=250,
                detail_shard_max_path_cost=12,
            )

            pchunks = [
                c for c in result["detail_chunk_manifest"]["chunks"]
                if c.get("layer") == "political" and c.get("lod") == "detail"
            ]
            ids = [c["id"] for c in pchunks]
            # Must NOT reuse old whole chunk
            self.assertNotIn(old_chunk_id, ids)
            self.assertEqual(
                sorted(ids),
                ["political.detail.country.fra.part.0", "political.detail.country.fra.part.1"],
            )
            # Source recovery stays available; the publisher prunes unreferenced files.
            self.assertTrue(old_chunk_file.exists())

    def test_reusable_political_chunks_partial_shard_set_not_reused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "test_scenario"
            scenario_dir.mkdir(parents=True)
            chunks_dir = scenario_dir / "chunks"
            chunks_dir.mkdir(parents=True)

            features = self._owner_features(scenario_dir)

            # Only provide part.0 in reusable_map (missing part.1)
            part0_id = "political.detail.country.fra.part.0"
            part0_file = chunks_dir / f"{part0_id}.json"
            part0_payload = {"type": "FeatureCollection", "features": [features[0]]}
            part0_file.write_text(json.dumps(part0_payload), encoding="utf-8")

            partial_reusable = {
                part0_id: {
                    "id": part0_id,
                    "layer": "political",
                    "lod": "detail",
                    "url": f"data/scenarios/test_scenario/chunks/{part0_id}.json",
                    "min_zoom": 1.35,
                    "max_zoom": 99.0,
                    "byte_size": part0_file.stat().st_size,
                    "sha256": sha256_path(part0_file),
                    "country_codes": ["FRA"],
                }
            }

            runtime_topology = _synthetic_topojson(features)
            startup_topology = _synthetic_topojson(features)

            # Both shards should be rebuilt from scratch because partial set cannot be reused
            result = scenario_chunk_assets.build_and_write_scenario_chunk_assets(
                scenario_dir=scenario_dir,
                manifest_payload={"scenario_id": "test_scenario", "generated_at": "2026-09-13T00:00:00Z"},
                startup_topology_payload=startup_topology,
                runtime_topology_payload=runtime_topology,
                reusable_political_chunks=partial_reusable,
                detail_shard_max_compact_bytes=250,
                detail_shard_max_path_cost=12,
            )

            pchunks = [
                c for c in result["detail_chunk_manifest"]["chunks"]
                if c.get("layer") == "political" and c.get("lod") == "detail"
            ]
            self.assertEqual(len(pchunks), 2)
            self.assertEqual(
                sorted(c["id"] for c in pchunks),
                ["political.detail.country.fra.part.0", "political.detail.country.fra.part.1"],
            )


if __name__ == "__main__":
    unittest.main()
