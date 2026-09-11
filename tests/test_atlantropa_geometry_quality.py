from copy import deepcopy
import unittest

from shapely.geometry import MultiPolygon, box, mapping, shape

from tools.atlantropa_geometry_quality import (
    GeometryConflictError, exclude_land_from_sea, normalize_land_features, remove_processing_encroachments,
)


def feature(feature_id, geometry, owner="ATL"):
    return {"type": "Feature", "properties": {"id": feature_id, "owner_tag": owner, "atl_render_layer": "land"},
            "geometry": mapping(geometry) if geometry is not None else None}


class AtlantropaGeometryQualityTests(unittest.TestCase):
    def test_processing_encroachment_preserves_shared_source_and_islands(self):
        sources = {"FRA": box(0, 0, 2, 2), "ITA": box(1, 0, 3, 2)}
        island = box(9, 9, 9.00001, 9.00001)
        inputs = [feature("ATLPRV_1", MultiPolygon([box(0, 0, 3, 2), island]), "FRA")]
        snapshot = deepcopy(inputs)
        result, diagnostics = remove_processing_encroachments(inputs, sources)
        geometry = shape(result[0]["geometry"])
        self.assertEqual(inputs, snapshot)
        self.assertTrue(geometry.covers(island))
        self.assertTrue(geometry.covers(box(1, 0, 2, 2)))  # genuine shared source stays
        self.assertEqual(geometry.intersection(box(2, 0, 3, 2)).area, 0)
        self.assertEqual(diagnostics["processing_encroachments"][0]["removed_area"], 2)
        self.assertEqual(remove_processing_encroachments(result, sources)[0], result)
        self.assertEqual(remove_processing_encroachments(inputs, dict(reversed(list(sources.items()))))[0], result)

    def test_processing_encroachment_requires_own_source(self):
        inputs = [feature("ATLPRV_1", box(0, 0, 2, 2), "FRA")]
        result, diagnostics = remove_processing_encroachments(inputs, {"ITA": box(0, 0, 3, 3)})
        self.assertEqual(result, inputs)
        self.assertEqual(diagnostics["missing_source_features"][0]["feature_id"], "ATLPRV_1")
        result, diagnostics = remove_processing_encroachments(inputs, {"FRA": box(0, 0, 1, 1)})
        self.assertEqual(result, inputs)  # no other owner's exclusive source

    def test_processing_encroachment_only_retires_explicit_helpers(self):
        sources = {"FRA": box(5, 5, 6, 6), "ITA": box(0, 0, 2, 2)}
        for fid in ("ATLPRV_1", "ATLISL_1"):
            with self.assertRaises(GeometryConflictError):
                remove_processing_encroachments([feature(fid, box(0, 0, 1, 1), "FRA")], sources,
                                               allow_retire_helper=True)
        helper = feature("ATLWLD_1", box(0, 0, 1, 1), "FRA")
        with self.assertRaises(GeometryConflictError):
            remove_processing_encroachments([helper], sources)
        result, diagnostics = remove_processing_encroachments([helper], sources, allow_retire_helper=True)
        self.assertEqual(result, [])
        self.assertEqual(diagnostics["retired_helper_ids"], ["ATLWLD_1"])

    def test_duplicate_component_removed_without_losing_islands_or_ids(self):
        island = box(20, 20, 20.00001, 20.00001)
        inputs = [feature("ATLPRV_18256", MultiPolygon([box(0, 0, 1, 1), box(3, 0, 4, 1), island])),
                  feature("ATLPRV_18247", box(0, 0, 2, 2))]
        snapshot = deepcopy(inputs)
        result, diagnostics = normalize_land_features(inputs)
        self.assertEqual(inputs, snapshot)
        self.assertEqual([f["properties"]["id"] for f in result], ["ATLPRV_18256", "ATLPRV_18247"])
        repaired = shape(result[0]["geometry"])
        self.assertTrue(repaired.covers(island))
        self.assertEqual(repaired.intersection(shape(result[1]["geometry"])).area, 0)
        self.assertEqual(diagnostics["overlaps"][0]["area"], 1)
        self.assertTrue(any(row["distance_to_largest"] > 10 for row in diagnostics["components"]))
        self.assertEqual(normalize_land_features(result)[0], result)
        reordered, _ = normalize_land_features(list(reversed(inputs)))
        self.assertEqual(list(reversed(reordered)), result)

    def test_different_and_unknown_owners_fail_without_mutation(self):
        for owner in ("ITA", ""):
            inputs = [feature("A", box(0, 0, 2, 2)), feature("B", box(1, 0, 3, 2), owner)]
            snapshot = deepcopy(inputs)
            with self.assertRaises(GeometryConflictError) as caught:
                normalize_land_features(inputs)
            self.assertEqual(inputs, snapshot)
            self.assertEqual(caught.exception.diagnostics["owner_conflicts"][0]["feature_ids"], ["A", "B"])

    def test_whole_duplicate_requires_provenance_decision(self):
        with self.assertRaisesRegex(GeometryConflictError, "stable land ID"):
            normalize_land_features([feature("A", box(0, 0, 2, 2)), feature("B", box(0, 0, 1, 1))])

    def test_only_explicitly_enabled_fully_covered_helpers_retire(self):
        land = feature("ATLPRV_1", box(0, 0, 2, 2))
        helper = feature("ATLWLD_1", box(0, 0, 1, 1))
        inputs = [helper, land]
        snapshot = deepcopy(inputs)
        with self.assertRaises(GeometryConflictError):
            normalize_land_features(inputs)
        result, diagnostics = normalize_land_features(inputs, allow_retire_helper=True)
        self.assertEqual(inputs, snapshot)
        self.assertEqual(result, [land])
        self.assertEqual(diagnostics["retired_helper_ids"], ["ATLWLD_1"])
        self.assertEqual(diagnostics["retired_features"][0]["covered_by_feature_ids"], ["ATLPRV_1"])
        self.assertEqual(diagnostics["retired_features"][0]["owner"], "ATL")
        self.assertEqual(normalize_land_features(result, allow_retire_helper=True)[0], result)
        partial = feature("ATLWLD_2", box(1, 0, 3, 1))
        result, diagnostics = normalize_land_features([land, partial], allow_retire_helper=True)
        self.assertEqual(len(result), 2)
        self.assertEqual(diagnostics["retired_helper_ids"], [])
        for protected_id in ("ATLPRV_2", "ATLISL_2"):
            with self.assertRaises(GeometryConflictError):
                normalize_land_features([feature("A", box(0, 0, 2, 2)),
                                         feature(protected_id, box(0, 0, 1, 1))], allow_retire_helper=True)
        with self.assertRaises(GeometryConflictError):
            normalize_land_features([land, feature("ATLWLD_1", box(0, 0, 1, 1), "ITA")],
                                    allow_retire_helper=True)

    def test_explicit_priority_resolves_ownership_with_provenance(self):
        inputs = [feature("A", box(0, 0, 2, 2)), feature("B", box(1, 0, 3, 2), "ITA")]
        options = {"priority": {"B": 0, "A": 1}, "priority_source": "verified_published_paint_order"}
        result, diagnostics = normalize_land_features(inputs, **options)
        self.assertEqual(result[1], inputs[1])
        self.assertEqual(shape(result[0]["geometry"]).area, 2)
        conflict = diagnostics["owner_conflicts"][0]
        self.assertTrue(conflict["resolved"])
        self.assertEqual(conflict["kept_feature_id"], "B")
        self.assertEqual(conflict["priority_source"], options["priority_source"])
        self.assertEqual(normalize_land_features(result, **options)[0], result)
        self.assertEqual(normalize_land_features(list(reversed(inputs)), **options)[0], list(reversed(result)))
        for priority in ({"A": 0}, {"A": 0, "B": 0}):
            with self.assertRaises(GeometryConflictError):
                normalize_land_features(inputs, priority=priority, priority_source="incomplete")
        with self.assertRaises(ValueError):
            normalize_land_features(inputs, priority={"A": 0, "B": 1})

    def test_published_owners_override_synthetic_source_defaults(self):
        inputs = [feature("A", box(0, 0, 2, 2)), feature("B", box(1, 0, 3, 2))]
        with self.assertRaises(GeometryConflictError) as caught:
            normalize_land_features(inputs, owner_by_feature_id={"A": "FRA", "B": "ITA"})
        self.assertEqual(caught.exception.diagnostics["owner_conflicts"][0]["owners"], ["FRA", "ITA"])
        with self.assertRaises(GeometryConflictError):
            normalize_land_features(inputs, owner_by_feature_id={"A": "FRA"})

    def test_sea_exclusion_preserves_land_join_and_water_elsewhere(self):
        land = [feature("LAND", box(0, 0, 2, 1))]
        sea = [feature("SEA", box(1, -1, 3, 2))]
        snapshot = deepcopy(land)
        result, diagnostics = exclude_land_from_sea(sea, land)
        repaired = shape(result[0]["geometry"])
        self.assertEqual(land, snapshot)
        self.assertEqual(repaired.intersection(shape(land[0]["geometry"])).area, 0)
        self.assertTrue(repaired.equals(box(1, -1, 3, 2).difference(box(0, 0, 2, 1))))
        self.assertEqual(diagnostics["land_sea_overlaps"][0]["area"], 1)
        self.assertEqual(exclude_land_from_sea(result, land)[0], result)
        self.assertEqual(result[0]["properties"], sea[0]["properties"])

    def test_touching_boundary_is_unchanged(self):
        inputs = [feature("A", box(0, 0, 1, 1)), feature("B", box(1, 0, 2, 1), "ITA")]
        self.assertEqual(normalize_land_features(inputs)[0], inputs)

    def test_shoals_are_not_land_and_prefix_classification_works(self):
        land = feature("ATLPRV_1", box(0, 0, 1, 1))
        del land["properties"]["atl_render_layer"]
        shoal = feature("ATLSHL_1", box(0, 0, 3, 1))
        shoal["properties"]["atl_render_layer"] = "shoal"
        inputs = [shoal, land]
        self.assertEqual(normalize_land_features(inputs)[0], inputs)
        sea = [feature("ATLSEA_1", box(0, 0, 4, 1))]
        result, _ = exclude_land_from_sea(sea, inputs)
        self.assertEqual(shape(result[0]["geometry"]).area, 3)

    def test_roundoff_tolerance_does_not_filter_tiny_islands(self):
        island = box(20, 20, 20.00000001, 20.00000001)
        inputs = [feature("A", MultiPolygon([box(0, 0, 1, 1), island]))]
        self.assertEqual(normalize_land_features(inputs)[0], inputs)
        touching = [feature("B", box(1 - 1e-15, 0, 2, 1), "ITA")]
        self.assertEqual(normalize_land_features(inputs + touching)[0], inputs + touching)

    def test_empty_inputs_and_invalid_geometry_or_ids(self):
        self.assertEqual(normalize_land_features([])[0], [])
        self.assertEqual(exclude_land_from_sea([], [feature("A", box(0, 0, 1, 1))])[0], [])
        for inputs in ([feature("A", None)], [feature("", box(0, 0, 1, 1))],
                       [feature("A", box(0, 0, 1, 1)), feature("A", box(2, 0, 3, 1))]):
            with self.assertRaises(GeometryConflictError):
                normalize_land_features(inputs)
        with self.assertRaisesRegex(GeometryConflictError, "stable sea ID"):
            exclude_land_from_sea([feature("SEA", box(0, 0, 1, 1))], [feature("LAND", box(0, 0, 2, 2))])


if __name__ == "__main__":
    unittest.main()
