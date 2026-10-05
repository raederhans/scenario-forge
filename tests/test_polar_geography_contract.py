"""Published geography must not regress to the retired 73-degree crop."""
import json
from pathlib import Path
import unittest

from map_builder.processors.arctic_recovery import _read
from map_builder.json_source import read_json_source
from map_builder.regional_geometry import _absolute_topology

ROOT = Path(__file__).resolve().parents[1]
MINIMUM_NORTH = {
    'RU_RAY_50074027B10379539839705': 73.5,
    'RU_RAY_50074027B29535697880201': 74.5,
    'RU_RAY_50074027B57421544908828': 73.45,
    'RU_RAY_50074027B66849950652275': 81.2,
    'RU_RAY_50074027B6686274683844': 81.8,
    'RU_RAY_50074027B84622469833682': 76.95,
    'RU_RAY_50074027B99340686489203': 76.7,
}


class PolarGeographyContract(unittest.TestCase):
    def test_published_polar_coverage_and_assignments(self):
        paths = [('runtime', ROOT / 'data/europe_topology.runtime_political_v1.json')]
        paths += [(sid, ROOT / 'data/scenarios' / sid / 'runtime_topology.topo.json')
                  for sid in ('modern_world', 'hoi4_1936', 'hoi4_1939', 'tno_1962', 'blank_base')]
        for sid, path in paths:
            with self.subTest(scenario=sid):
                topology = _absolute_topology(read_json_source(path) if path.name == 'runtime_topology.topo.json' else json.loads(path.read_text(encoding='utf-8')))
                rows = topology['objects']['political']['geometries']
                by_id = {row['properties']['id']: row for row in rows}
                self.assertEqual(len(by_id), len(rows))
                for fid, minimum in MINIMUM_NORTH.items():
                    # Blank already has another editable geometry covering Novaya Zemlya.
                    if sid == 'blank_base' and fid.endswith('84622469833682'):
                        continue
                    family = [r for rid, r in by_id.items()
                              if rid == fid or r['properties'].get('parent_id') == fid]
                    self.assertTrue(family, (sid, fid))
                    geoms = [_read(topology, r) for r in family]
                    self.assertTrue(all(g.is_valid and not g.is_empty for g in geoms), (sid, fid))
                    self.assertGreater(max(g.bounds[3] for g in geoms), minimum, (sid, fid))
                islands = {fid: r for fid, r in by_id.items() if fid.startswith('NO_PRIMARY_GAP_')}
                self.assertEqual(len(islands), 9)
                self.assertGreater(max(_read(topology, r).bounds[3] for r in islands.values()), 80.4)
                self.assertGreater(_read(topology, by_id['GL']).bounds[3], 83.5)
                antarctica = [r for fid, r in by_id.items() if fid == 'AQ' or fid.startswith('AQ_')]
                self.assertTrue(antarctica)
                self.assertLess(min(_read(topology, r).bounds[1] for r in antarctica), -89.9)
                if sid == 'runtime':
                    continue
                owners = json.loads((path.parent / 'owners.by_feature.json').read_text(encoding='utf-8'))['owners']
                cores = json.loads((path.parent / 'cores.by_feature.json').read_text(encoding='utf-8'))['cores']
                if sid == 'blank_base':
                    self.assertEqual(owners, {})
                    self.assertEqual(cores, {})
                else:
                    expected = {'modern_world': 'NO', 'hoi4_1936': 'NOR', 'hoi4_1939': 'NOR', 'tno_1962': 'RKNO'}[sid]
                    self.assertTrue(all(owners[fid] == expected for fid in islands))
                    self.assertTrue(all(cores[fid] == [expected] for fid in islands))


if __name__ == '__main__':
    unittest.main()
