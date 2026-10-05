import json
from pathlib import Path
import unittest
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import MultiPolygon, box
import topojson as tp

from map_builder import config as cfg
from map_builder.json_source import read_json_source
from map_builder.processors import africa_admin1
from tools.build_runtime_political_topology import _compose_political_features

REPO_ROOT = Path(__file__).resolve().parents[1]
TNO_RUNTIME_TOPOLOGY = REPO_ROOT / "data" / "scenarios" / "tno_1962" / "runtime_topology.topo.json"
TNO_COARSE_POLITICAL_CHUNK = REPO_ROOT / "data" / "scenarios" / "tno_1962" / "chunks" / "political.coarse.r0c0.json"

EXPECTED_FR_RETENTION_RULES = {
    "GF": {
        "id": "GF_PRIMARY",
        "name": "French Guiana",
        "bounds": (-55.0, 1.5, -51.0, 6.5),
    },
    "GP": {
        "id": "GP_PRIMARY",
        "name": "Guadeloupe",
        "bounds": (-62.2, 15.5, -60.6, 16.8),
    },
    "MQ": {
        "id": "MQ_PRIMARY",
        "name": "Martinique",
        "bounds": (-61.4, 14.2, -60.7, 15.1),
    },
    "RE": {
        "id": "RE_PRIMARY",
        "name": "Reunion",
        "bounds": (55.0, -21.6, 56.1, -20.7),
    },
    "YT": {
        "id": "YT_PRIMARY",
        "name": "Mayotte",
        "bounds": (44.8, -13.2, 45.5, -12.4),
    },
}


def _political_topology(gdf: gpd.GeoDataFrame) -> dict:
    return tp.Topology(
        [gdf],
        object_name=["political"],
        topology=True,
        prequantize=False,
    ).to_dict()


class PoliticalTopologyGapContractTests(unittest.TestCase):
    def test_runtime_composition_keeps_norwegian_islands_without_duplicate_mainland(self) -> None:
        mainland = box(5.0, 58.0, 12.0, 71.0)
        covered_island = box(15.0, 68.0, 16.0, 69.0)
        svalbard_west = box(10.0, 77.0, 16.0, 80.0)
        svalbard_east = box(20.0, 78.0, 24.0, 81.0)
        primary = gpd.GeoDataFrame(
            [{
                "id": "NO",
                "name": "Norway",
                "cntr_code": "NO",
                "geometry": MultiPolygon([mainland, covered_island, svalbard_west, svalbard_east]),
            }],
            crs="EPSG:4326",
        )
        detail = gpd.GeoDataFrame(
            [
                {"id": "NO_MAINLAND", "name": "Norway detail", "cntr_code": "NO", "geometry": mainland},
                {"id": "NO_COVERED_ISLAND", "name": "Covered island", "cntr_code": "NO", "geometry": covered_island},
            ],
            crs="EPSG:4326",
        )

        result = _compose_political_features(
            _political_topology(primary),
            _political_topology(detail),
            override_collection=None,
        )

        ids = list(result["id"].astype(str))
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(set(ids) - {"NO_MAINLAND", "NO_COVERED_ISLAND"}, {
            "NO_PRIMARY_GAP_3", "NO_PRIMARY_GAP_4",
        })
        gaps = result.loc[result["id"].str.startswith("NO_PRIMARY_GAP_")]
        self.assertTrue(all(gaps["cntr_code"] == "NO"))
        self.assertTrue(all(gaps["__source"] == "primary_gap"))
        self.assertGreaterEqual(gaps.geometry.total_bounds[3], 81.0)
        self.assertTrue(all(geometry.intersection(mainland.union(covered_island)).is_empty for geometry in gaps.geometry))

    def test_checked_in_tno_runtime_keeps_guyana_somaliland_and_russian_arctic_geometry(self) -> None:
        topology = read_json_source(TNO_RUNTIME_TOPOLOGY)
        political_geometries = topology["objects"]["political"]["geometries"]

        def feature_id(geometry: dict) -> str:
            return str((geometry.get("properties") or {}).get("id") or "")

        def country_code(geometry: dict) -> str:
            return str((geometry.get("properties") or {}).get("cntr_code") or "").upper()

        by_country = {
            code: [geometry for geometry in political_geometries if country_code(geometry) == code]
            for code in ("GY", "SO")
        }
        ru_arctic_runtime = [
            geometry for geometry in political_geometries
            if feature_id(geometry).startswith("RU_ARCTIC_FB_")
        ]

        self.assertEqual(len(by_country["GY"]), 10)
        self.assertEqual(len(by_country["SO"]), 18)
        self.assertGreaterEqual(len(ru_arctic_runtime), 50)
        self.assertTrue(all((geometry.get("arcs") or geometry.get("coordinates")) for geometry in by_country["GY"]))
        self.assertTrue(all((geometry.get("arcs") or geometry.get("coordinates")) for geometry in by_country["SO"]))
        self.assertTrue(all((geometry.get("arcs") or geometry.get("coordinates")) for geometry in ru_arctic_runtime))

        chunk = json.loads(TNO_COARSE_POLITICAL_CHUNK.read_text(encoding="utf-8"))
        ru_arctic_chunk = [
            feature for feature in chunk["features"]
            if str((feature.get("properties") or {}).get("id") or "").startswith("RU_ARCTIC_FB_")
        ]
        self.assertEqual(len(ru_arctic_chunk), len(ru_arctic_runtime))
        self.assertTrue(all(
            (feature.get("properties") or {}).get("scenario_helper_kind") == "shell_fallback"
            for feature in ru_arctic_chunk
        ))

    def test_runtime_composition_keeps_uncovered_french_overseas_components(self) -> None:
        overseas_boxes = {
            "GF": box(-54.6, 2.1, -51.6, 5.8),
            "GP": box(-61.6, 16.1, -61.5, 16.3),
            "GP_EXTRA": box(-61.4, 15.9, -61.3, 16.0),
            "MQ": box(-61.2, 14.4, -60.9, 14.8),
            "RE": box(55.2, -21.3, 55.8, -20.9),
            "YT": box(45.0, -13.0, 45.2, -12.6),
        }
        primary = gpd.GeoDataFrame(
            [
                {
                    "id": "FR",
                    "name": "France",
                    "cntr_code": "FR",
                    "geometry": MultiPolygon(
                        [box(0.0, 0.0, 4.0, 4.0), *overseas_boxes.values()]
                    ),
                }
            ],
            crs="EPSG:4326",
        )
        detail = gpd.GeoDataFrame(
            [
                {
                    "id": "FR_DETAIL",
                    "name": "France detail",
                    "cntr_code": "FR",
                    "geometry": box(0.0, 0.0, 4.0, 4.0),
                }
            ],
            crs="EPSG:4326",
        )

        result = _compose_political_features(
            _political_topology(primary),
            _political_topology(detail),
            override_collection=None,
        )

        codes = set(result["cntr_code"].astype(str))
        self.assertIn("FR", codes)
        configured = {
            str(rule["code"]): {
                "id": rule["id"],
                "name": rule["name"],
                "bounds": tuple(rule["bounds"]),
            }
            for rule in cfg.RUNTIME_PRIMARY_COMPONENT_RETENTION_RULES["FR"]
        }
        self.assertEqual(configured, EXPECTED_FR_RETENTION_RULES)
        for code, rule in EXPECTED_FR_RETENTION_RULES.items():
            self.assertIn(code, codes)
            row = result.loc[result["cntr_code"] == code].iloc[0]
            self.assertEqual(row["id"], rule["id"])
            self.assertEqual(row["name"], rule["name"])
            self.assertEqual(row["__source"], "primary_gap")
            min_x, min_y, max_x, max_y = rule["bounds"]
            rep = row.geometry.representative_point()
            self.assertLessEqual(min_x, rep.x)
            self.assertLessEqual(min_y, rep.y)
            self.assertGreaterEqual(max_x, rep.x)
            self.assertGreaterEqual(max_y, rep.y)
        gp = result.loc[result["cntr_code"] == "GP"].iloc[0]
        self.assertEqual(gp.geometry.geom_type, "MultiPolygon")
        self.assertLessEqual(gp.geometry.bounds[0], -61.59)
        self.assertGreaterEqual(gp.geometry.bounds[2], -61.31)

    def test_runtime_composition_drops_primary_component_with_meaningful_detail_overlap(self) -> None:
        primary = gpd.GeoDataFrame(
            [
                {
                    "id": "FR",
                    "name": "France",
                    "cntr_code": "FR",
                    "geometry": MultiPolygon(
                        [
                            box(0.0, 0.0, 4.0, 4.0),
                            box(10.0, 0.0, 12.0, 2.0),
                        ]
                    ),
                }
            ],
            crs="EPSG:4326",
        )
        detail = gpd.GeoDataFrame(
            [
                {
                    "id": "FR_DETAIL",
                    "name": "France detail",
                    "cntr_code": "FR",
                    "geometry": box(0.0, 0.0, 4.0, 4.0),
                },
                {
                    "id": "FR_OVERLAP_DETAIL",
                    "name": "France overlap detail",
                    "cntr_code": "FR",
                    "geometry": box(10.0, 0.0, 10.5, 2.0),
                },
            ],
            crs="EPSG:4326",
        )

        result = _compose_political_features(
            _political_topology(primary),
            _political_topology(detail),
            override_collection=None,
        )

        retained_ids = set(result["id"].astype(str))
        self.assertNotIn("FR_PRIMARY_GAP_2", retained_ids)

    def test_geoboundaries_override_uses_source_union_shell(self) -> None:
        source = gpd.GeoDataFrame(
            [
                {
                    "shapeID": "SANAAG",
                    "shapeName": "Sanaag",
                    "geometry": box(0.0, 0.0, 4.0, 4.0),
                }
            ],
            crs="EPSG:4326",
        )
        spec = {
            "url": "memory://som",
            "filename": "geoBoundaries-SOM-ADM1.geojson",
            "expected_count": 1,
        }

        with patch.object(africa_admin1, "fetch_or_load_geojson", return_value=source):
            result = africa_admin1._build_geo_boundaries_features("SO", spec)

        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0]["id"], "SO_ADM1_SANAAG")
        self.assertEqual(result.iloc[0]["name"], "Sanaag")
        self.assertGreaterEqual(result.geometry.iloc[0].bounds[2], 3.99)


if __name__ == "__main__":
    unittest.main()
