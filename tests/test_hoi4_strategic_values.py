from __future__ import annotations

import json
import math
import tempfile
import unittest
from pathlib import Path

from scenario_builder.hoi4.models import RuntimeFeatureRecord, StateRecord
from scenario_builder.hoi4.strategic import (
    build_strategic_values_payload,
    decode_runtime_feature_centroids,
    parse_victory_point_localisation,
)


def miniature_topology() -> dict:
    return {
        "type": "Topology",
        "transform": {"scale": [1, 1], "translate": [0, 0]},
        "arcs": [
            [[0, 0], [2, 0], [0, 2], [-2, 0], [0, -2]],
            [[10, 0], [2, 0], [0, 2], [-2, 0], [0, -2]],
            [[20, 0], [2, 0], [0, 2], [-2, 0], [0, -2]],
        ],
        "objects": {
            "political": {
                "type": "GeometryCollection",
                "geometries": [
                    {"type": "Polygon", "id": "POL-A", "properties": {"id": "POL-A"}, "arcs": [[0]]},
                    {"type": "Polygon", "id": "POL-B", "properties": {"id": "POL-B"}, "arcs": [[1]]},
                    {"type": "Polygon", "id": "GER-A", "properties": {"id": "GER-A"}, "arcs": [[2]]},
                ],
            }
        },
    }


class Hoi4StrategicValuesTest(unittest.TestCase):
    def test_parse_victory_point_localisation_collects_tag_aliases(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "victory_points_l_english.yml"
            path.write_text(
                """
                l_english:
                  VICTORY_POINTS_3544: "Warsaw"
                  GER_VICTORY_POINTS_3544: "Warschau"
                """,
                encoding="utf-8-sig",
            )
            self.assertEqual(parse_victory_point_localisation(path), {3544: ["Warsaw", "Warschau"]})

    def test_decode_runtime_feature_centroids_handles_topojson_arcs(self) -> None:
        centroids = decode_runtime_feature_centroids(miniature_topology())

        # 代表点必须落在各自的 2×2 方块内（带 transform 的增量弧线）。
        for feature_id, (x0, y0) in {"POL-A": (0, 0), "POL-B": (10, 0), "GER-A": (20, 0)}.items():
            x, y = centroids[feature_id]
            self.assertTrue(x0 < x < x0 + 2 and y0 < y < y0 + 2, (feature_id, x, y))

    def test_decode_runtime_feature_centroids_handles_absolute_coordinate_arcs(self) -> None:
        # 当前运行时拓扑不带 transform，弧线是绝对经纬度浮点坐标。
        topology = {
            "type": "Topology",
            "arcs": [[[2.25, 48.8], [2.45, 48.8], [2.45, 48.9], [2.25, 48.9], [2.25, 48.8]]],
            "objects": {"political": {"type": "GeometryCollection", "geometries": [
                {"type": "Polygon", "properties": {"id": "PARIS"}, "arcs": [[0]]},
            ]}},
        }
        lon, lat = decode_runtime_feature_centroids(topology)["PARIS"]
        self.assertTrue(2.25 < lon < 2.45 and 48.8 < lat < 48.9, (lon, lat))

    def test_real_hoi4_runtime_topology_centroids_are_geographic(self) -> None:
        root = Path(__file__).resolve().parents[1]
        manifest = json.loads((root / "data/scenarios/hoi4_1936/manifest.json").read_text(encoding="utf-8"))
        topology = json.loads((root / manifest["runtime_topology_url"]).read_text(encoding="utf-8"))
        centroids = decode_runtime_feature_centroids(topology)
        self.assertGreater(len(centroids), 20000)
        outside = [fid for fid, (lon, lat) in centroids.items() if not (-180 <= lon <= 180 and -90 <= lat <= 90)]
        self.assertEqual(outside, [])
        # 巴黎所在地块（FR_ARR_75001）的代表点应在巴黎市中心 15 km 内。
        lon, lat = centroids["FR_ARR_75001"]
        self.assertLess(math.hypot((lon - 2.35) * math.cos(math.radians(48.86)), lat - 48.86) * 111, 15)

    def test_build_payload_attributes_features_and_metrics(self) -> None:
        states = {
            10: StateRecord(
                state_id=10,
                file_name="10-Poland.txt",
                owner_tag="POL",
                controller_tag="POL",
                core_tags=["POL"],
                province_ids=[3544],
                state_category="city",
                manpower=3000000,
                victory_points=[(3544, 25)],
                resources={"steel": 6},
                buildings={"infrastructure": 7, "arms_factory": 2, "industrial_complex": 3},
            ),
            11: StateRecord(
                state_id=11,
                file_name="11-Poland.txt",
                owner_tag="POL",
                controller_tag="POL",
                core_tags=["POL"],
                province_ids=[5000],
                state_category="rural",
                manpower=1000000,
                resources={"oil": 3},
                buildings={"infrastructure": 4},
            ),
            12: StateRecord(
                state_id=12,
                file_name="12-Germany.txt",
                owner_tag="GER",
                controller_tag="GER",
                core_tags=["GER"],
                province_ids=[6000],
                state_category="rural",
                manpower=500000,
                resources={"steel": 2},
            ),
        }
        cities = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [1, 1]},
                    "properties": {
                        "city_id": "CITY::warsaw",
                        "stable_key": "id::warsaw",
                        "name": "Warsaw",
                        "name_ascii": "Warsaw",
                        "host_feature_id": "POL-A",
                        "population": 1000000,
                    },
                }
            ],
        }
        payload = build_strategic_values_payload(
            scenario_id="hoi4_test",
            baseline_hash="abc123",
            as_of_date="1936.1.1.12",
            states_by_id=states,
            runtime_features=[
                RuntimeFeatureRecord(feature_id="POL-A", country_code="PL", name="A"),
                RuntimeFeatureRecord(feature_id="POL-B", country_code="PL", name="B"),
                RuntimeFeatureRecord(feature_id="GER-A", country_code="DE", name="C"),
            ],
            assignments={"POL-A": "POL", "POL-B": "POL", "GER-A": "GER"},
            runtime_topology_payload=miniature_topology(),
            vp_localisation={3544: ["Warsaw"]},
            world_cities_payload=cities,
        )

        self.assertEqual(payload["scenario_id"], "hoi4_test")
        self.assertEqual(payload["baseline_hash"], "abc123")
        self.assertEqual(payload["victory_points"][0]["match_method"], "name_owner_match")
        self.assertEqual(payload["bucket_by_feature"]["POL-A"], "s10")
        self.assertEqual(payload["bucket_by_feature"]["POL-B"], "s10")
        self.assertEqual(payload["bucket_by_feature"]["GER-A"], "pool:GER")
        self.assertEqual(payload["buckets"]["s10"]["military_factories"], 2)
        self.assertEqual(payload["buckets"]["s10"]["civilian_factories"], 3)
        self.assertEqual(payload["buckets"]["s10"]["factories_total"], 5)
        self.assertEqual(payload["buckets"]["pool:POL"]["infrastructure"], 4)
        self.assertEqual(payload["buckets"]["pool:GER"]["infrastructure"], 0)
        self.assertGreaterEqual(payload["metrics"]["manpower"]["p95"], 3000000)
        self.assertEqual(payload["metrics"]["infrastructure"]["max"], 7)
        self.assertEqual(payload["diagnostics"]["vp_total"], 1)
        self.assertEqual(payload["diagnostics"]["vp_matched"], 1)
        self.assertEqual(payload["diagnostics"]["states_anchored"], 1)
        self.assertEqual(payload["diagnostics"]["states_pooled"], 2)
        resources = payload["resource_points"]["features"]
        self.assertTrue(any(feature["properties"]["resource"] == "steel" for feature in resources))
        pooled_resources = [
            feature["properties"]
            for feature in resources
            if feature["properties"].get("attribution") == "country_pooled"
        ]
        self.assertTrue(
            any(
                properties["resource"] == "oil"
                and properties["owner_tag"] == "POL"
                and properties["state_ids"] == [11]
                and properties["anchor_kind"] == "owner_feature_centroid"
                for properties in pooled_resources
            )
        )
        self.assertTrue(
            any(
                properties["resource"] == "steel"
                and properties["owner_tag"] == "GER"
                and properties["state_ids"] == [12]
                and properties["anchor_kind"] == "owner_feature_centroid"
                for properties in pooled_resources
            )
        )


if __name__ == "__main__":
    unittest.main()
