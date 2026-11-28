from __future__ import annotations

import unittest
from scenario_builder.hoi4.models import RuntimeFeatureRecord, StateRecord
from scenario_builder.hoi4.strategic import build_strategic_values_payload, decode_runtime_feature_centroids


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


if __name__ == "__main__":
    unittest.main()
