import unittest
from shapely.geometry import box, Polygon
from map_builder.geo.source_coverage_repair import repair_source_coverage


class SourceCoverageRepairTests(unittest.TestCase):
    def test_repairs_enclosed_gap_and_overlap_from_source_ids(self):
        source = {'west': box(0, 0, 1, 3), 'east': box(1, 0, 2, 3)}
        old = {'west': Polygon([(0,0),(1,0),(.9,1),(1.1,2),(1,3),(0,3)]),
               'east': Polygon([(1,0),(2,0),(2,3),(1,3),(.95,2),(1.05,1)])}
        repaired, report = repair_source_coverage(old, source)
        self.assertEqual(set(repaired), set(old))
        for fid in source:
            self.assertTrue(repaired[fid].equals(source[fid]))
        self.assertTrue(report['coverage_valid'])
        self.assertGreater(report['filled_holes'], 0)

    def test_protected_water_is_not_filled(self):
        lake = box(.9, 1, 1.1, 2)
        source = {'a': box(0, 0, 1, 3), 'b': box(1, 0, 2, 3)}
        old = {fid: g.difference(lake) for fid, g in source.items()}
        repaired, _ = repair_source_coverage(old, source, protected=lake)
        self.assertTrue(all(g.intersection(lake).area == 0 for g in repaired.values()))

    def test_original_source_hole_remains(self):
        lake = box(.9, 1, 1.1, 2)
        source = {'a': box(0, 0, 1, 3).difference(lake), 'b': box(1, 0, 2, 3).difference(lake)}
        repaired, report = repair_source_coverage(source, source)
        self.assertEqual(report['filled_holes'], 0)
        self.assertTrue(all(repaired[fid].equals(g) for fid, g in source.items()))

    def test_overlapping_source_and_id_drift_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'same nonempty'):
            repair_source_coverage({'a': box(0,0,1,1)}, {'b': box(0,0,1,1)})
        with self.assertRaisesRegex(ValueError, 'valid shared coverage'):
            repair_source_coverage({'a': box(0,0,1,1), 'b': box(1,0,2,1)},
                                   {'a': box(0,0,1.1,1), 'b': box(1,0,2,1)})

    def test_existing_outer_extension_uses_only_existing_source_parents(self):
        source = {'a': box(0, 1, 1, 2), 'b': box(1, 1, 2, 2)}
        old = {'a': box(0, 0, 1.2, 2), 'b': box(1, 0, 2, 2)}
        repaired, report = repair_source_coverage(old, source)
        self.assertTrue(repaired['a'].equals(box(0, 0, 1, 2)))
        self.assertTrue(repaired['b'].equals(box(1, 0, 2, 2)))
        self.assertEqual(report['source_extension_overlap_resolutions'][0]['receiver'], 'b')


if __name__ == '__main__':
    unittest.main()
