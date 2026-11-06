import json
from pathlib import Path
import unittest

import shapely
from shapely.geometry import Point
from map_builder.regional_geometry import _absolute_topology, _decode_geometry, _encode_exact_coverage
from tools.apply_hoi4_geometry_splits import compile_external_parts, split_topology

ROOT = Path(__file__).resolve().parents[1]


def regional_partition(filename):
    rules = json.loads((ROOT / "data/scenario-rules" / filename).read_text())
    topology = _absolute_topology(json.loads((ROOT / "data/scenarios/modern_world/runtime_topology.topo.json").read_text()))
    rows = {r["properties"]["id"]: r for r in topology["objects"]["political"]["geometries"]}
    manifest = json.loads((ROOT / "data/scenarios/modern_world/manifest.json").read_text())
    lineage = manifest.get("hierarchy_overrides", {}).get("feature_splits", {})
    parents = [p for e in rules["entries"] for p in e["feature_ids"]]
    geometries = [shapely.union_all([_decode_geometry(topology, rows[c]) for c in lineage[p]])
                  if p in lineage else _decode_geometry(topology, rows[p]) for p in parents]
    original = _encode_exact_coverage(parents, geometries)
    plan = compile_external_parts(rules, ROOT / "data/scenario-rules", original)
    result, splits, report = split_topology(original, plan)
    decoded = {r["properties"]["id"]: _decode_geometry(result, r) for r in result["objects"]["political"]["geometries"]}
    return original, rules, result, splits, report, decoded


class RegionalGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original, cls.rules, cls.result, cls.splits, cls.report, cls.geometries = regional_partition("modern_world.geometry_splits.json")

    def test_positive_and_negative_samples(self):
        samples = [
            (33.36,35.19,"NORTHERN_CYPRUS"),(33.36,35.16,"REMAINDER"),
            (43.97,42.23,"SOUTH_OSSETIA"),(44.11,41.98,"REMAINDER"),
            (35.69,32.99,"GOLAN_HEIGHTS"),(35.3,32.7,"REMAINDER"),
            (38.35,36.89,"KOBANI"),(37.95,36.53,"REMAINDER"),
            (37.15,36.235,"ALEPPO_NEIGHBORHOODS"),(37.16,36.2,"REMAINDER"),
            (37.95,36.07,"DEIR_HAFIR_MASKANAH"),(36.87,36.51,"REMAINDER"),
            (38.01,36.82,"REMAINDER"),
            (29.22845,-1.67409,"RUTSHURU_MASISI_GOMA"),(29.14,-3.4,"KALEHE_BUKAVU_UVIRA"),
            (29.47,.49,"REMAINDER"),(29.28,.13,"REMAINDER"),(27.34,-2.7,"REMAINDER")]
        for lon,lat,suffix in samples:
            with self.subTest(lon=lon,lat=lat):
                hits = [fid for fid,g in self.geometries.items() if g.covers(Point(lon,lat))]
                self.assertEqual(len(hits),1)
                self.assertTrue(hits[0].endswith("__SPLIT_"+suffix), hits)

    def test_conservation_and_replay(self):
        for parent,children in self.splits.items():
            parts = [self.geometries[c] for c in children]
            self.assertAlmostEqual(sum(g.area for g in parts),shapely.union_all(parts).area,places=8)
        plan = compile_external_parts(self.rules,ROOT / "data/scenario-rules",self.result,self.splits)
        self.assertEqual(split_topology(self.result,plan),(self.result,{},[]))
