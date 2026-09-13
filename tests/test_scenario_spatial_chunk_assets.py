from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

import geopandas as gpd
from shapely.geometry import MultiPolygon, Polygon
from topojson import Topology

from map_builder.contracts import sha256_path
from tools import check_scenario_contracts, scenario_chunk_assets


def _square(x: float, y: float, size: float = 1.0) -> Polygon:
    return Polygon([
        (x, y),
        (x + size, y),
        (x + size, y + size),
        (x, y + size),
    ])


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
    def test_political_detail_chunk_ids(self) -> None:
        self.assertEqual(scenario_chunk_assets.political_detail_chunk_ids("FRA", 0), [])
        self.assertEqual(
            scenario_chunk_assets.political_detail_chunk_ids("FRA", 1),
            ["political.detail.country.fra"],
        )
        self.assertEqual(
            scenario_chunk_assets.political_detail_chunk_ids("fra", 3),
            [
                "political.detail.country.fra.part.0",
                "political.detail.country.fra.part.1",
                "political.detail.country.fra.part.2",
            ],
        )

    def test_partition_small_owner_retains_single_shard(self) -> None:
        # 3 small features well below default budgets (2 MiB / 100k coords)
        features = [
            {
                "type": "Feature",
                "properties": {"id": f"AAA-{i}"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[i, 0], [i + 1, 0], [i + 1, 1], [i, 1], [i, 0]]],
                },
            }
            for i in range(3)
        ]
        entries = [
            (f["properties"]["id"], f, scenario_chunk_assets._feature_bounds(f))
            for f in features
        ]
        shards = scenario_chunk_assets.partition_political_detail_features(entries)
        self.assertEqual(len(shards), 1)
        self.assertEqual(len(shards[0]), 3)
        self.assertEqual([e[0] for e in shards[0]], ["AAA-0", "AAA-1", "AAA-2"])

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

    def test_build_and_write_scenario_chunk_assets_adaptive_partitioning_end_to_end(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "test_scenario"
            scenario_dir.mkdir(parents=True)

            # Define 2 owners:
            # - AAA: small owner with 1 feature
            # - BBB: oversized owner with 4 features (split into shards)
            features = [
                {
                    "type": "Feature",
                    "properties": {"id": "AAA-1", "cntr_code": "AAA"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0], [0.0, 0.0]]],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {"id": "BBB-west-1", "cntr_code": "BBB"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[10.0, 0.0], [11.0, 0.0], [11.0, 1.0], [10.0, 1.0], [10.0, 0.0]]],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {"id": "BBB-west-2", "cntr_code": "BBB"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[11.0, 0.0], [12.0, 0.0], [12.0, 1.0], [11.0, 1.0], [11.0, 0.0]]],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {"id": "BBB-east-1", "cntr_code": "BBB"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[30.0, 0.0], [31.0, 0.0], [31.0, 1.0], [30.0, 1.0], [30.0, 0.0]]],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {"id": "BBB-east-2", "cntr_code": "BBB"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[31.0, 0.0], [32.0, 0.0], [32.0, 1.0], [31.0, 1.0], [31.0, 0.0]]],
                    },
                },
            ]

            (scenario_dir / "owners.by_feature.json").write_text(
                json.dumps({
                    "version": 1,
                    "owners": {
                        "AAA-1": "AAA",
                        "BBB-west-1": "BBB",
                        "BBB-west-2": "BBB",
                        "BBB-east-1": "BBB",
                        "BBB-east-2": "BBB",
                    },
                }),
                encoding="utf-8",
            )

            runtime_topology = _synthetic_topojson(features)
            startup_topology = _synthetic_topojson(features)

            # Build with low threshold so BBB splits into 2 shards, AAA stays 1 chunk
            result = scenario_chunk_assets.build_and_write_scenario_chunk_assets(
                scenario_dir=scenario_dir,
                manifest_payload={"scenario_id": "test_scenario", "generated_at": "2026-09-13T00:00:00Z"},
                startup_topology_payload=startup_topology,
                runtime_topology_payload=runtime_topology,
                startup_topology_url="data/scenarios/test_scenario/runtime_topology.bootstrap.topo.json",
                runtime_topology_url="data/scenarios/test_scenario/runtime_topology.topo.json",
                detail_shard_max_compact_bytes=500,
                detail_shard_max_path_cost=40,
            )

            manifest_chunks = result["detail_chunk_manifest"]["chunks"]
            political_chunks = [
                c for c in manifest_chunks
                if c.get("layer") == "political" and c.get("lod") == "detail"
            ]

            # AAA has 1 chunk, BBB has 2 shards
            chunk_ids = [c["id"] for c in political_chunks]
            self.assertIn("political.detail.country.aaa", chunk_ids)
            self.assertIn("political.detail.country.bbb.part.0", chunk_ids)
            self.assertIn("political.detail.country.bbb.part.1", chunk_ids)
            self.assertEqual(len(chunk_ids), 3)

            # Check explicit metadata
            for chunk in political_chunks:
                self.assertIn("owner_code", chunk)
                self.assertIn("country_codes", chunk)
                self.assertIn("decoded_byte_size", chunk)
                self.assertIn("feature_bounds", chunk)
                if "bbb" in chunk["id"]:
                    self.assertEqual(chunk["owner_code"], "BBB")
                    self.assertEqual(chunk["country_codes"], ["BBB"])
                elif "aaa" in chunk["id"]:
                    self.assertEqual(chunk["owner_code"], "AAA")
                    self.assertEqual(chunk["country_codes"], ["AAA"])

            # Verify chunk files on disk and feature coverage
            all_features_seen = set()
            for chunk in political_chunks:
                chunk_path = scenario_dir / "chunks" / f"{chunk['id']}.json"
                self.assertTrue(chunk_path.exists())
                self.assertEqual(chunk["byte_size"], chunk_path.stat().st_size)
                self.assertEqual(chunk["sha256"], sha256_path(chunk_path))
                payload = json.loads(chunk_path.read_text(encoding="utf-8"))
                self.assertEqual(chunk['feature_bounds'], [scenario_chunk_assets._feature_bounds(f) for f in payload['features']])
                fids = [f["properties"]["id"] for f in payload["features"]]
                # Ensure no duplicate across shards
                self.assertEqual(len(all_features_seen.intersection(fids)), 0)
                all_features_seen.update(fids)

            self.assertEqual(
                all_features_seen,
                {"AAA-1", "BBB-west-1", "BBB-west-2", "BBB-east-1", "BBB-east-2"},
            )

            # Strict contract validation passes with 0 errors
            errors: list[str] = []
            runtime_feature_ids = {"AAA-1", "BBB-west-1", "BBB-west-2", "BBB-east-1", "BBB-east-2"}
            owners_by_feature_id = {
                "AAA-1": "AAA",
                "BBB-west-1": "BBB",
                "BBB-west-2": "BBB",
                "BBB-east-1": "BBB",
                "BBB-east-2": "BBB",
            }
            check_scenario_contracts._validate_detail_chunk_manifest(
                scenario_dir,
                scenario_dir / "detail_chunks.manifest.json",
                runtime_feature_ids,
                owners_by_feature_id,
                errors,
            )
            self.assertEqual(errors, [])

    def test_reusable_political_chunks_reused_safely(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "test_scenario"
            scenario_dir.mkdir(parents=True)

            features = [
                {
                    "type": "Feature",
                    "properties": {"id": "AAA-1", "cntr_code": "AAA"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0], [0.0, 0.0]]],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {"id": "BBB-1", "cntr_code": "BBB"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[10.0, 0.0], [11.0, 0.0], [11.0, 1.0], [10.0, 1.0], [10.0, 0.0]]],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {"id": "BBB-2", "cntr_code": "BBB"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[20.0, 0.0], [21.0, 0.0], [21.0, 1.0], [20.0, 1.0], [20.0, 0.0]]],
                    },
                },
            ]

            (scenario_dir / "owners.by_feature.json").write_text(
                json.dumps({
                    "version": 1,
                    "owners": {"AAA-1": "AAA", "BBB-1": "BBB", "BBB-2": "BBB"},
                }),
                encoding="utf-8",
            )

            runtime_topology = _synthetic_topojson(features)
            startup_topology = _synthetic_topojson(features)

            # Build first time
            res1 = scenario_chunk_assets.build_and_write_scenario_chunk_assets(
                scenario_dir=scenario_dir,
                manifest_payload={"scenario_id": "test_scenario", "generated_at": "2026-09-13T00:00:00Z"},
                startup_topology_payload=startup_topology,
                runtime_topology_payload=runtime_topology,
                detail_shard_max_compact_bytes=250,
                detail_shard_max_path_cost=12,
            )

            manifest_1 = res1["detail_chunk_manifest"]["chunks"]
            reusable_map = {
                c["id"]: c
                for c in manifest_1
                if c.get("layer") == "political" and c.get("lod") == "detail"
            }

            # Build second time with reusable_political_chunks provided
            res2 = scenario_chunk_assets.build_and_write_scenario_chunk_assets(
                scenario_dir=scenario_dir,
                manifest_payload={"scenario_id": "test_scenario", "generated_at": "2026-09-13T01:00:00Z"},
                startup_topology_payload=startup_topology,
                runtime_topology_payload=runtime_topology,
                reusable_political_chunks=reusable_map,
                detail_shard_max_compact_bytes=250,
                detail_shard_max_path_cost=12,
            )

            manifest_2 = res2["detail_chunk_manifest"]["chunks"]
            pchunks_2 = [c for c in manifest_2 if c.get("layer") == "political" and c.get("lod") == "detail"]
            self.assertEqual(len(pchunks_2), 3)  # AAA + BBB.part.0 + BBB.part.1
            self.assertEqual(
                sorted(c["id"] for c in pchunks_2),
                sorted(reusable_map.keys()),
            )

    def test_reusable_political_chunks_never_reuses_stale_whole_chunk_after_split(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "test_scenario"
            scenario_dir.mkdir(parents=True)
            chunks_dir = scenario_dir / "chunks"
            chunks_dir.mkdir(parents=True)

            features = [
                {
                    "type": "Feature",
                    "properties": {"id": "FRA-1", "cntr_code": "FRA"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0], [0.0, 0.0]]],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {"id": "FRA-2", "cntr_code": "FRA"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[10.0, 0.0], [11.0, 0.0], [11.0, 1.0], [10.0, 1.0], [10.0, 0.0]]],
                    },
                },
            ]

            (scenario_dir / "owners.by_feature.json").write_text(
                json.dumps({"version": 1, "owners": {"FRA-1": "FRA", "FRA-2": "FRA"}}),
                encoding="utf-8",
            )

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

    def test_strict_checker_detects_shard_violations(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "test_scenario"
            chunks_dir = scenario_dir / "chunks"
            chunks_dir.mkdir(parents=True)

            features_part0 = [
                {
                    "type": "Feature",
                    "properties": {"id": "FRA-1"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0], [0.0, 0.0]]],
                    },
                }
            ]
            features_part2 = [
                {
                    "type": "Feature",
                    "properties": {"id": "FRA-2"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[10.0, 0.0], [11.0, 0.0], [11.0, 1.0], [10.0, 1.0], [10.0, 0.0]]],
                    },
                }
            ]

            (chunks_dir / "political.detail.country.fra.part.0.json").write_text(
                json.dumps({"type": "FeatureCollection", "features": features_part0}), encoding="utf-8"
            )
            (chunks_dir / "political.detail.country.fra.part.2.json").write_text(
                json.dumps({"type": "FeatureCollection", "features": features_part2}), encoding="utf-8"
            )

            (scenario_dir / "owners.by_feature.json").write_text(
                json.dumps({"version": 1, "owners": {"FRA-1": "FRA", "FRA-2": "FRA"}}), encoding="utf-8"
            )

            # Create a manifest with missing part.1 (has part.0 and part.2) and wrong owner_code on part.2
            path0 = chunks_dir / "political.detail.country.fra.part.0.json"
            path2 = chunks_dir / "political.detail.country.fra.part.2.json"
            manifest = {
                "version": 1,
                "scenario_id": "test_scenario",
                "chunks": [
                    {
                        "id": "political.detail.country.fra.part.0",
                        "layer": "political",
                        "lod": "detail",
                        "url": "data/scenarios/test_scenario/chunks/political.detail.country.fra.part.0.json",
                        "bounds": [0.0, 0.0, 1.0, 1.0],
                        "feature_count": 1,
                        "byte_size": path0.stat().st_size,
                        "sha256": sha256_path(path0),
                        "country_codes": ["FRA"],
                        "owner_code": "FRA",
                    },
                    {
                        "id": "political.detail.country.fra.part.2",
                        "layer": "political",
                        "lod": "detail",
                        "url": "data/scenarios/test_scenario/chunks/political.detail.country.fra.part.2.json",
                        "bounds": [10.0, 0.0, 11.0, 1.0],
                        "feature_count": 1,
                        "byte_size": path2.stat().st_size,
                        "sha256": sha256_path(path2),
                        "country_codes": ["FRA"],
                        "owner_code": "GER",  # Mismatch!
                    },
                ],
            }
            manifest_path = scenario_dir / "detail_chunks.manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            errors: list[str] = []
            check_scenario_contracts._validate_detail_chunk_manifest(
                scenario_dir,
                manifest_path,
                {"FRA-1", "FRA-2"},
                {"FRA-1": "FRA", "FRA-2": "FRA"},
                errors,
            )

            # Verify errors were caught:
            # 1. owner_code GER doesn't match chunk bucket FRA
            # 2. non-contiguous shard indices ([0, 2] instead of [0, 1])
            self.assertTrue(any("owner_code GER must match" in e for e in errors), str(errors))
            self.assertTrue(any("contiguous 0-indexed" in e for e in errors), str(errors))

    def test_reusable_political_chunks_partial_shard_set_not_reused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "test_scenario"
            scenario_dir.mkdir(parents=True)
            chunks_dir = scenario_dir / "chunks"
            chunks_dir.mkdir(parents=True)

            features = [
                {
                    "type": "Feature",
                    "properties": {"id": "FRA-1", "cntr_code": "FRA"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0], [0.0, 0.0]]],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {"id": "FRA-2", "cntr_code": "FRA"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[10.0, 0.0], [11.0, 0.0], [11.0, 1.0], [10.0, 1.0], [10.0, 0.0]]],
                    },
                },
            ]

            (scenario_dir / "owners.by_feature.json").write_text(
                json.dumps({"version": 1, "owners": {"FRA-1": "FRA", "FRA-2": "FRA"}}),
                encoding="utf-8",
            )

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

    def test_strict_checker_detects_bounds_enclosure_violation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "test_scenario"
            chunks_dir = scenario_dir / "chunks"
            chunks_dir.mkdir(parents=True)

            # Feature coordinates span 0..10
            feature = {
                "type": "Feature",
                "properties": {"id": "FRA-1"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]]],
                },
            }
            chunk_file = chunks_dir / "political.detail.country.fra.json"
            chunk_file.write_text(
                json.dumps({"type": "FeatureCollection", "features": [feature]}),
                encoding="utf-8",
            )
            (scenario_dir / "owners.by_feature.json").write_text(
                json.dumps({"version": 1, "owners": {"FRA-1": "FRA"}}), encoding="utf-8"
            )

            # Manifest specifies bounds [0, 0, 5, 5] which does not enclose [0, 0, 10, 10]
            manifest = {
                "version": 1,
                "scenario_id": "test_scenario",
                "chunks": [
                    {
                        "id": "political.detail.country.fra",
                        "layer": "political",
                        "lod": "detail",
                        "url": "data/scenarios/test_scenario/chunks/political.detail.country.fra.json",
                        "bounds": [0.0, 0.0, 5.0, 5.0],  # Too small!
                        "feature_count": 1,
                        "byte_size": chunk_file.stat().st_size,
                        "sha256": sha256_path(chunk_file),
                        "country_codes": ["FRA"],
                        "owner_code": "FRA",
                    }
                ],
            }
            manifest_path = scenario_dir / "detail_chunks.manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            errors: list[str] = []
            check_scenario_contracts._validate_detail_chunk_manifest(
                scenario_dir,
                manifest_path,
                {"FRA-1"},
                {"FRA-1": "FRA"},
                errors,
            )
            self.assertTrue(any("do not enclose feature" in e for e in errors), str(errors))

    def test_strict_checker_detects_invalid_shard_identifier(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "test_scenario"
            chunks_dir = scenario_dir / "chunks"
            chunks_dir.mkdir(parents=True)

            f1 = {"type": "Feature", "properties": {"id": "FRA-1"}, "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}}
            p1 = chunks_dir / "political.detail.country.fra.part.invalid.json"
            p1.write_text(json.dumps({"type": "FeatureCollection", "features": [f1]}), encoding="utf-8")

            (scenario_dir / "owners.by_feature.json").write_text(
                json.dumps({"version": 1, "owners": {"FRA-1": "FRA"}}), encoding="utf-8"
            )

            manifest = {
                "version": 1,
                "scenario_id": "test_scenario",
                "chunks": [
                    {
                        "id": "political.detail.country.fra.part.invalid",
                        "layer": "political",
                        "lod": "detail",
                        "url": f"data/scenarios/test_scenario/chunks/{p1.name}",
                        "bounds": [0, 0, 1, 1],
                        "feature_count": 1,
                        "byte_size": p1.stat().st_size,
                        "sha256": sha256_path(p1),
                        "country_codes": ["FRA"],
                        "owner_code": "FRA",
                    },
                ],
            }
            manifest_path = scenario_dir / "detail_chunks.manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            errors: list[str] = []
            check_scenario_contracts._validate_detail_chunk_manifest(
                scenario_dir,
                manifest_path,
                {"FRA-1"},
                {"FRA-1": "FRA"},
                errors,
            )
            self.assertTrue(any("shard identifier must use" in e for e in errors), str(errors))

    def test_strict_checker_detects_mixed_sharded_and_unsharded(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "test_scenario"
            chunks_dir = scenario_dir / "chunks"
            chunks_dir.mkdir(parents=True)

            f1 = {"type": "Feature", "properties": {"id": "FRA-1"}, "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}}
            f2 = {"type": "Feature", "properties": {"id": "FRA-2"}, "geometry": {"type": "Polygon", "coordinates": [[[2, 0], [3, 0], [3, 1], [2, 1], [2, 0]]]}}

            p1 = chunks_dir / "political.detail.country.fra.json"
            p2 = chunks_dir / "political.detail.country.fra.part.0.json"
            p1.write_text(json.dumps({"type": "FeatureCollection", "features": [f1]}), encoding="utf-8")
            p2.write_text(json.dumps({"type": "FeatureCollection", "features": [f2]}), encoding="utf-8")

            (scenario_dir / "owners.by_feature.json").write_text(
                json.dumps({"version": 1, "owners": {"FRA-1": "FRA", "FRA-2": "FRA"}}), encoding="utf-8"
            )

            manifest = {
                "version": 1,
                "scenario_id": "test_scenario",
                "chunks": [
                    {
                        "id": "political.detail.country.fra",
                        "layer": "political",
                        "lod": "detail",
                        "url": f"data/scenarios/test_scenario/chunks/{p1.name}",
                        "bounds": [0, 0, 1, 1],
                        "feature_count": 1,
                        "byte_size": p1.stat().st_size,
                        "sha256": sha256_path(p1),
                        "country_codes": ["FRA"],
                        "owner_code": "FRA",
                    },
                    {
                        "id": "political.detail.country.fra.part.0",
                        "layer": "political",
                        "lod": "detail",
                        "url": f"data/scenarios/test_scenario/chunks/{p2.name}",
                        "bounds": [2, 0, 3, 1],
                        "feature_count": 1,
                        "byte_size": p2.stat().st_size,
                        "sha256": sha256_path(p2),
                        "country_codes": ["FRA"],
                        "owner_code": "FRA",
                    },
                ],
            }
            manifest_path = scenario_dir / "detail_chunks.manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            errors: list[str] = []
            check_scenario_contracts._validate_detail_chunk_manifest(
                scenario_dir,
                manifest_path,
                {"FRA-1", "FRA-2"},
                {"FRA-1": "FRA", "FRA-2": "FRA"},
                errors,
            )
            self.assertTrue(any("mixes sharded and un-sharded" in e for e in errors), str(errors))


if __name__ == "__main__":
    unittest.main()
