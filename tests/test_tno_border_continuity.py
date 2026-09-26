"""Asset regression for the Algerian shared-edge break observed at 28-29N."""
import json
from pathlib import Path
import unittest

import shapely
from shapely.geometry import LineString, MultiLineString
from map_builder.coverage_validation import coverage_is_valid_exact
from map_builder.regional_geometry import _absolute_topology, _decode_geometry

ROOT = Path(__file__).resolve().parents[1]


class TnoBorderContinuityTests(unittest.TestCase):
    def test_current_manifest_keeps_algerian_source_seam_in_all_display_lods(self):
        read = lambda path: json.loads((ROOT / path).read_text(encoding='utf-8'))
        manifest = read('data/scenarios/tno_1962/manifest.json')
        topology = _absolute_topology(read(manifest['runtime_topology_url']))
        dz = {str(g['properties']['id']): _decode_geometry(topology, g)
              for g in topology['objects']['political']['geometries']
              if str(g['properties']['id']).startswith('DZA-')}
        self.assertEqual(len(dz), 48)
        self.assertTrue(coverage_is_valid_exact(dz.values()), 'source provinces must share edges without overlapping')
        a, b = dz['DZA-2143'], dz['DZA-2189']
        for lat in (28, 29):
            cross = LineString([(-9, lat), (12, lat)])
            self.assertAlmostEqual(a.intersection(cross).bounds[2], b.intersection(cross).bounds[0], places=9)
        owners = read(manifest['owners_url'])['owners']
        regions = {tag: shapely.union_all([g for fid, g in dz.items() if owners[fid] == tag])
                   for tag in ('ALC', 'IAL')}
        self.assertLessEqual(regions['ALC'].intersection(regions['IAL']).area, 1e-10)
        shared = regions['ALC'].boundary.intersection(regions['IAL'].boundary)
        pack = read(manifest['mesh_pack_url'])['meshes']['opening_owner_borders']
        local = MultiLineString([line for line in pack['coordinates'] if any(-10 < x < 14 and 17 < y < 39 for x,y in line)])
        self.assertLess(shared.difference(local.buffer(1e-8)).length, 1e-6)
        chunks = read(manifest['detail_chunk_manifest_url'])['chunks']
        coarse = next(c for c in chunks if c['layer'] == 'political' and c['lod'] == 'coarse')
        coarse_dz = {f['properties']['id']: shapely.geometry.shape(f['geometry'])
                     for f in read(coarse['url'])['features'] if f['properties']['id'] in dz}
        self.assertEqual(set(coarse_dz), set(dz))
        self.assertTrue(coverage_is_valid_exact(coarse_dz.values()))
        for lat in (28, 29):
            cross = LineString([(-9, lat), (12, lat)])
            self.assertAlmostEqual(coarse_dz['DZA-2143'].intersection(cross).bounds[2],
                                   coarse_dz['DZA-2189'].intersection(cross).bounds[0], places=9)


if __name__ == '__main__':
    unittest.main()
