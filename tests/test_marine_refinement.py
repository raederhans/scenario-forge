from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from shapely.geometry import Polygon, box, mapping, shape
from shapely.ops import unary_union

from map_builder.geo import marine_refinement as marine


def feature(feature_id, geometry, **props):
    return {"type": "Feature", "properties": {"id": feature_id, **props}, "geometry": mapping(geometry)}


class MarineRefinementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_root = marine.ROOT / ".runtime/tmp"
        cls.temp_root.mkdir(parents=True, exist_ok=True)

    def test_source_seam_reconciliation_is_order_independent_and_keeps_union(self):
        a = feature("marine_north_sea", box(0, 0, 5, 5))
        b = feature("marine_norwegian_sea", box(0, 4, 5, 8))
        first = marine.reconcile_marine_source_boundaries({"features": [a, b]})
        second = marine.reconcile_marine_source_boundaries({"features": [b, a]})
        geometries = {f["properties"]["id"]: shape(f["geometry"]) for f in first["features"]}
        for f in second["features"]:
            self.assertTrue(shape(f["geometry"]).equals(geometries[f["properties"]["id"]]))
        left, right = geometries.values()
        self.assertEqual(left.intersection(right).area, 0)
        self.assertTrue(left.union(right).equals(box(0, 0, 5, 8)))

    def test_new_source_seams_keep_union_for_base_and_scenario_ids(self):
        for prefix in ("marine_", "tno_"):
            with self.subTest(prefix=prefix):
                inputs = [feature(prefix + "barents_sea", box(0, 0, 5, 5)),
                          feature(prefix + "kara_sea", box(4, 0, 7, 5))]
                result = marine.reconcile_marine_source_boundaries({"features": inputs})
                left, right = [shape(f["geometry"]) for f in result["features"]]
                self.assertEqual(left.intersection(right).area, 0)
                self.assertTrue(left.union(right).equals(box(0, 0, 7, 5)))
                self.assertEqual(inputs[0]["geometry"], mapping(box(0, 0, 5, 5)))

    def test_refresh_rejects_http_200_wrong_ids_in_either_layer_or_any_record(self):
        from tools import build_marine_refinement_sources as builder

        cases = (
            (False, [{"mrgid_sr": "24021"}]),
            (False, [{"mrgid": 24020}]),
            (True, [{"mrgid": 32381}]),
            (True, [{"mrgid_sr": "32380"}]),
            (True, [{"mrgid": 32380}, {"mrgid": 32381}]),
            (True, [{"mrgid": True}]),
        )
        for world, records in cases:
            with self.subTest(world=world, records=records), TemporaryDirectory(dir=self.temp_root) as directory:
                slug, record = ("fixture_world_bay", "32380") if world else ("white_sea", "24020")
                path = Path(directory) / "rejected.geojson"
                response = Mock(status_code=200, url=builder.WFS,
                                json=Mock(return_value={"features": [feature(str(index), box(0, 0, 1, 1), **props)
                                                                      for index, props in enumerate(records)]}))
                with patch.object(builder, "ADDITIONAL_SOURCE_PATH", path), \
                        patch.object(builder, "ADDITIONAL_SEAS", ((slug, "Fixture", "测试", record, "bay"),)), \
                        patch.object(builder, "OCEAN_SECTORS", ()), \
                        patch.object(marine, "WORLD_BAY_GULF_SLUGS", frozenset({slug}) if world else frozenset()), \
                        patch.object(builder.requests, "get", return_value=response) as get:
                    with self.assertRaises(ValueError):
                        builder.refresh()
                self.assertEqual(get.call_count, 1)
                response.raise_for_status.assert_called_once()
                self.assertFalse(path.exists(), "A mismatched public response must not be published")

    def test_small_bay_precision_survives_refresh_and_named_preparation(self):
        from tools import build_marine_refinement_sources as builder
        from tools import patch_tno_1962_bundle as bundle

        # A 0.001-degree inlet survives the reviewed .0005 tolerance and would
        # be erased by the standard .005 macro tolerance at either build stage.
        raw = Polygon([(0, 0), (0.02, 0), (0.02, 0.02), (0.01, 0.021), (0, 0.02), (0, 0)])
        fine, coarse = raw.simplify(0.0005), raw.simplify(0.005)
        self.assertFalse(fine.equals(coarse))
        row = next(row for row in marine.ADDITIONAL_SEAS if row[0] == "tudor_creek")
        spec = next(spec for spec in marine.tno_additional_specs() if spec["id"] == "tno_tudor_creek")
        response = Mock(status_code=200, url=builder.WFS,
                        json=Mock(return_value={"features": [feature("fixture", raw, mrgid=int(row[3]))]}))
        with TemporaryDirectory(dir=self.temp_root) as directory:
            path = Path(directory) / "source.geojson"
            with patch.object(builder, "ADDITIONAL_SOURCE_PATH", path), \
                    patch.object(builder, "ADDITIONAL_SEAS", (row,)), \
                    patch.object(builder, "OCEAN_SECTORS", ()), \
                    patch.object(builder.requests, "get", return_value=response):
                builder.refresh()
            source = json.loads(path.read_text(encoding="utf-8"))["features"][0]
        self.assertTrue(shape(source["geometry"]).equals(fine))
        self.assertEqual(source["properties"]["source_simplify_degrees"], 0.0005)
        snapshot = deepcopy(source)
        snapshot["properties"]["id"] = spec["id"]
        with patch.object(bundle, "load_global_water_regions_feature_index", return_value={}), \
                patch.object(bundle, "additional_snapshot_features", return_value=[]), \
                patch.object(bundle, "TNO_NAMED_MARGINAL_WATER_SPECS", (spec,)):
            prepared, _ = bundle.build_tno_named_marginal_water_features({"features": [snapshot]})
        self.assertTrue(shape(prepared[0]["geometry"]).equals(fine))
        self.assertEqual(marine.additional_source_simplify_degrees("cape_cod_bay"), 0.004)
        self.assertEqual(marine.additional_source_simplify_degrees("massachusetts_bay"), 0.005)

    def test_named_preparer_carves_north_sea_children_before_generic_compile_in_any_order(self):
        from tools import patch_tno_1962_bundle as bundle

        all_specs = {spec["id"]: spec for spec in bundle.TNO_NAMED_MARGINAL_WATER_SPECS}
        parent = deepcopy(all_specs["tno_north_sea"])
        selected = [parent, *(deepcopy(all_specs[feature_id]) for feature_id in parent["subtract_named_ids"])]
        parent_geometry = box(0, 0, 30, 30)
        inputs = [feature(parent["id"], parent_geometry, source_record_ids=["mrgid:2350"])]
        for index, spec in enumerate(selected[1:]):
            # Keep the production parent's complete child queue; unrelated child
            # dependencies/base subtraction are outside this focused fixture.
            spec["subtract_named_ids"] = ()
            spec["subtract_base_ids"] = ()
            inputs.append(feature(spec["id"], box(1 + index % 5 * 5, 1 + index // 5 * 5,
                                                  3 + index % 5 * 5, 3 + index // 5 * 5),
                                  source_record_ids=[spec["source_query"]]))
        parent["subtract_base_ids"] = ()
        snapshot = {"features": inputs}
        original = deepcopy(snapshot)
        outputs = []
        with patch.object(bundle, "load_global_water_regions_feature_index", return_value={}), \
                patch.object(bundle, "additional_snapshot_features", return_value=[]):
            for ordered in (selected, list(reversed(selected))):
                with patch.object(bundle, "TNO_NAMED_MARGINAL_WATER_SPECS", tuple(ordered)):
                    prepared, _ = bundle.build_tno_named_marginal_water_features(snapshot)
                outputs.append({f["properties"]["id"]: shape(f["geometry"]) for f in prepared})
        children_union = unary_union([shape(f["geometry"]) for f in inputs[1:]])
        probe = shape(inputs[1]["geometry"]).representative_point()
        self.assertFalse(outputs[0][parent["id"]].covers(probe))
        self.assertGreater(outputs[0][parent["id"]].area, 0)
        self.assertEqual(outputs[0][parent["id"]].intersection(children_union).area, 0)
        self.assertTrue(unary_union(list(outputs[0].values())).equals(parent_geometry))
        for feature_id, geometry in outputs[0].items():
            self.assertTrue(geometry.equals(outputs[1][feature_id]), feature_id)
        self.assertEqual(snapshot, original)

    def test_published_marine_partitions_do_not_overlap_across_hierarchy_levels(self):
        from shapely.strtree import STRtree
        for relative in ("data/water_regions.geojson", "data/scenarios/tno_1962/water_regions.geojson"):
            collection = marine.load_collection(marine.ROOT / relative)
            features = [f for f in collection["features"] if f["properties"].get("region_group") in {"marine_macro", "marine_detail", "ocean_macro"}]
            geometries = [shape(f["geometry"]) for f in features]
            tree = STRtree(geometries)
            prefix = "tno_" if "tno_1962" in relative else "marine_"
            ids = {f["properties"]["id"] for f in features}
            self.assertTrue({prefix + row[0] for row in marine.ADDITIONAL_SEAS} <= ids)
            for index, geometry in enumerate(geometries):
                self.assertTrue(geometry.is_valid, features[index]["properties"]["id"])
                self.assertFalse(geometry.is_empty, features[index]["properties"]["id"])
                for other in tree.query(geometry, predicate="intersects"):
                    if other <= index:
                        continue
                    # Integer-grid encoding may move a shared edge by one cell.
                    # Check exclusive interiors beyond that measured resolution,
                    # not exact floating-point equality at serialized boundaries.
                    grid = collection.get("water_geometry_quantization", {}).get("grid_degrees", [1e-9, 1e-9])
                    margin = (grid[0] ** 2 + grid[1] ** 2) ** 0.5
                    overlap = geometry.intersection(geometries[other]).buffer(-margin).area
                    self.assertLessEqual(overlap, 1e-8, (relative, features[index]["properties"]["id"], features[other]["properties"]["id"], overlap))


if __name__ == "__main__":
    unittest.main()
