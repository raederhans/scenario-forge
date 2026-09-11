import unittest
from shapely.geometry import box, mapping
from shapely.ops import unary_union
from tools.atlantropa_identity import IslandIdentityError, reconcile_island_identity


def row(rid, geometry, owner="CRO"):
    return {"id": rid, "geometry": geometry, "assigned_owner_tag": owner,
            "region_id": "adriatica", "donor_province_ids": [123]}


def old(fid, geometry):
    return {"type": "Feature", "properties": {"id": fid, "donor_province_ids": [123]},
            "geometry": mapping(geometry)}


class IslandIdentityTests(unittest.TestCase):
    def reconcile(self, rows, olds, owners, support=None):
        return reconcile_island_identity(rows, olds, owners,
            source_support_by_row_id=support if support is not None else {r["id"]: r["geometry"] for r in rows})

    def test_split_only_largest_child_keeps_old_identity(self):
        rows = [row("new1", box(0, 0, 2, 1)), row("new2", box(3, 0, 4, 1))]
        previous = [old("ATLISL_old", box(0, 0, 4, 1))]
        result, diagnostics = self.reconcile(rows, previous, {"ATLISL_old": "ITA"})
        self.assertEqual(result[0]["id"], "ATLISL_old")
        self.assertNotEqual(result[1]["id"], "ATLISL_old")
        self.assertEqual(result[1]["assigned_owner_tag"], "ITA")
        self.assertEqual(result[1]["published_island_lineage"], ["ATLISL_old"])
        self.assertEqual(diagnostics["retired_island_ids"], [])
        reverse, _ = self.reconcile(list(reversed(rows)), previous, {"ATLISL_old": "ITA"})
        self.assertEqual([r["id"] for r in reverse], [r["id"] for r in reversed(result)])
        self.assertEqual(rows[0]["id"], "new1")

    def test_same_owner_merge_retires_smaller_overlap_id(self):
        previous = [old("OLD_A", box(0, 0, 2, 1)), old("OLD_B", box(2, 0, 3, 1))]
        result, diagnostics = self.reconcile([row("new", box(0, 0, 3, 1))], previous,
                                              {"OLD_A": "ITA", "OLD_B": "ITA"})
        self.assertEqual(result[0]["id"], "OLD_A")
        self.assertEqual(diagnostics["retired_to_feature_ids"], {"OLD_B": ["OLD_A"]})
        with self.assertRaises(IslandIdentityError):
            self.reconcile([row("new", box(0, 0, 3, 1))],
                           [previous[0], old("OLD_B", box(1, 0, 3, 1))], {"OLD_A": "ITA", "OLD_B": "CRO"})

    def test_disjoint_old_owners_split_and_processing_bridge_is_discarded(self):
        left, right = box(0, 0, 1, 1), box(3, 0, 4, 1)
        geometry = box(0, 0, 4, 1)
        result, diagnostics = reconcile_island_identity(
            [row("new", geometry)], [old("OLD_A", left), old("OLD_B", right)],
            {"OLD_A": "ITA", "OLD_B": "CRO"}, source_support_by_row_id={"new": geometry},
            raw_source_by_row_id={"new": unary_union([left, right])},
        )
        self.assertEqual({r["id"]: r["assigned_owner_tag"] for r in result}, {"OLD_A": "ITA", "OLD_B": "CRO"})
        self.assertTrue(unary_union([r["geometry"] for r in result]).equals(unary_union([left, right])))
        self.assertEqual(diagnostics["discarded_processing_components"][0]["area"], 2)

    def test_raw_supported_remainder_gets_config_owner_but_unsupported_child_fails(self):
        geometry = box(0, 0, 4, 1)
        previous = [old("OLD_A", box(0, 0, 1, 1)), old("OLD_B", box(3, 0, 4, 1))]
        result, _ = reconcile_island_identity(
            [row("new", geometry, "GRE")], previous, {"OLD_A": "ITA", "OLD_B": "CRO"},
            source_support_by_row_id={"new": geometry}, raw_source_by_row_id={"new": geometry},
        )
        self.assertEqual(len(result), 3)
        remainder = next(r for r in result if r["id"] not in {"OLD_A", "OLD_B"})
        self.assertEqual(remainder["assigned_owner_tag"], "GRE")
        with self.assertRaises(IslandIdentityError):
            reconcile_island_identity(
                [row("new", geometry)], previous, {"OLD_A": "ITA", "OLD_B": "CRO"},
                source_support_by_row_id={"new": geometry}, raw_source_by_row_id={"new": box(0, 0, 1, 1)},
            )

    def test_new_fragment_requires_actual_source_coverage(self):
        rows = [row("new", box(5, 5, 6, 6))]
        with self.assertRaises(IslandIdentityError):
            self.reconcile(rows, [], {}, {})
        with self.assertRaises(IslandIdentityError):
            self.reconcile(rows, [], {}, {"new": box(0, 0, 1, 1)})
        result, diagnostics = self.reconcile(rows, [], {})
        self.assertTrue(result[0]["id"].startswith("ATLISL_adriatica_source_"))
        self.assertEqual(result[0]["assigned_owner_tag"], "CRO")
        self.assertEqual(diagnostics["lineage"][0]["old_feature_ids"], [])

    def test_sub_publish_split_sliver_removed_but_whole_raw_tiny_island_survives(self):
        geometry = box(0, 0, 3, 1)
        result, diagnostics = reconcile_island_identity(
            [row("new", geometry)],
            [old("A", box(0, 0, 1, 1)), old("B", box(1 + 5e-10, 0, 3, 1))],
            {"A": "ITA", "B": "CRO"}, source_support_by_row_id={"new": geometry},
            raw_source_by_row_id={"new": geometry},
        )
        self.assertEqual({r["id"] for r in result}, {"A", "B"})
        self.assertEqual(diagnostics["discarded_processing_components"][0]["reason"],
                         "ownership_split_remainder_below_publish_floor")
        tiny = box(5, 0, 5.00001, .00001)
        left, right = box(0, 0, 1, 1), box(2, 0, 3, 1)
        merged = unary_union([geometry, tiny])
        raw = unary_union([left, right, tiny])
        result, _ = reconcile_island_identity(
            [row("new", merged)], [old("A", left), old("B", right)], {"A": "ITA", "B": "CRO"},
            source_support_by_row_id={"new": merged}, raw_source_by_row_id={"new": raw},
        )
        self.assertTrue(any(r["geometry"].equals(tiny) for r in result))
        # A published tiny island also retains its ID independently of the floor.
        retained, _ = self.reconcile([row("tiny", tiny)], [old("OLD_TINY", tiny)], {"OLD_TINY": "ITA"})
        self.assertEqual(retained[0]["id"], "OLD_TINY")


if __name__ == "__main__":
    unittest.main()
