from __future__ import annotations

import json
from math import sin
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from shapely.geometry import Polygon, mapping, shape
from shapely.ops import unary_union

from tools import scenario_chunk_assets as assets


def fixture():
    edge = [(1 + (0.001 * sin(i) if 0 < i < 40 else 0), i / 40) for i in range(41)]
    geometries = [
        Polygon([(0, 0), *edge, (0, 1), (0, 0)]),
        Polygon([(2, 0), (2, 1), *edge[::-1], (2, 0)],
                holes=[[(1.3, .2), (1.5, .2), (1.5, .4), (1.3, .4), (1.3, .2)]]),
    ]
    return [{"type": "Feature", "id": fid, "meta": {"source": "coarse"},
             "properties": {"id": fid, "owner": "X", "country": "original"},
             "geometry": mapping(geometry)} for fid, geometry in zip(("a", "b"), geometries)]


class ScenarioWorldDisplayLodTests(unittest.TestCase):
    def setUp(self):
        output_root = Path(__file__).resolve().parents[1] / ".runtime" / "tmp"
        output_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="world-display-lod-test-", dir=output_root)
        self.addCleanup(self.temp.cleanup)
        self.scenario = Path(self.temp.name) / "tno_1962"
        (self.scenario / "chunks").mkdir(parents=True)

    def write_chunk(self, chunk_id, features, lod, *, topology=False):
        path = self.scenario / "chunks" / f"{chunk_id}.json"
        payload = {"type": "FeatureCollection", "source": "original-source",
                   "meta": {"tier": "original"}, "features": features}
        if topology:
            payload = {"type": "FeatureCollection", "features": [
                {key: value for key, value in feature.items() if key != "meta"}
                for feature in features
            ]}
        wire = assets.feature_collection_to_topology(payload) if topology else payload
        assets._write_minified_json(path, wire)
        geometry_cost = assets._summarize_payload_geometry_cost(payload)
        cost = assets._build_chunk_cost_summary(payload, path)
        return {"id": chunk_id, "layer": "political", "lod": lod,
                "url": f"data/scenarios/tno_1962/chunks/{chunk_id}.json",
                "global_coverage": lod == "coarse", "bounds": [-180, -90, 180, 90],
                "data_format": "topojson" if topology else "geojson",
                "cache_byte_size": assets._minified_json_byte_size(payload),
                "country_codes": ["X"], "feature_count": len(features),
                "lod_diagnostics": assets._build_political_coarse_lod_diagnostics(
                    {**geometry_cost, "byte_size": cost["byte_size"]},
                    {**geometry_cost, "byte_size": cost["byte_size"]},
                ), **cost}

    def path(self, entry):
        return self.scenario / "chunks" / f"{entry['id']}.json"

    def apply(self, chunks):
        return assets._apply_tno_world_display_lod(scenario_dir=self.scenario, all_chunks=chunks)

    def test_shared_interiors_reduce_points_and_preserve_union_perimeter_and_holes(self):
        features = fixture()
        coarse = self.write_chunk("world", list(reversed(features)), "coarse")
        detail = self.write_chunk("X.detail", features, "detail")
        source = json.loads(self.path(coarse).read_text(encoding="utf-8"))
        updated, _ = self.apply([coarse, detail])
        result = json.loads(self.path(coarse).read_text(encoding="utf-8"))
        before_union = unary_union([shape(feature["geometry"]) for feature in source["features"]])
        after_union = unary_union([shape(feature["geometry"]) for feature in result["features"]])
        self.assertTrue(before_union.equals(after_union))
        self.assertTrue(before_union.boundary.equals(after_union.boundary))
        self.assertEqual(len(shape(result["features"][0]["geometry"]).interiors), 1)
        self.assertLess(updated["coord_count"], coarse["coord_count"])

    def assert_output_costs(self, updated):
        wire = json.loads(self.path(updated).read_text(encoding="utf-8"))
        expanded = assets.decode_political_chunk(wire)
        byte_size = self.path(updated).stat().st_size
        expanded_size = assets._minified_json_byte_size(expanded)
        self.assertEqual(updated["data_format"], "topojson" if wire["type"] == "Topology" else "geojson")
        self.assertEqual(updated["byte_size"], byte_size)
        self.assertEqual(updated["decoded_byte_size"], byte_size)
        self.assertEqual(updated["cache_byte_size"], expanded_size)
        for field, value in assets._build_chunk_cost_summary(expanded, self.path(updated)).items():
            self.assertEqual(updated[field], value)
        lod = updated["lod_diagnostics"]
        self.assertEqual(lod["optimized_byte_size"], byte_size)
        self.assertEqual(lod["wire_byte_size"], byte_size)
        self.assertEqual(lod["expanded_geojson_byte_size"], expanded_size)
        self.assertEqual(lod["world_display_stage"]["after"]["wire_byte_size"], byte_size)
        self.assertEqual(lod["world_display_stage"]["after"]["expanded_geojson_byte_size"], expanded_size)
        return wire, expanded

    def test_topology_can_return_to_geojson_without_stale_wire_metadata(self):
        coarse = self.write_chunk("world", fixture(), "coarse", topology=True)
        coarse["lod_diagnostics"].update(wire_byte_size=1, expanded_geojson_byte_size=2)
        detail = self.write_chunk("X.detail", fixture(), "detail")
        with patch.object(assets, "POLITICAL_COARSE_TOPOLOGY_MIN_BYTES", 10**9):
            updated, report = self.apply([coarse, detail])
        self.assertEqual(report["status"], "simplified")
        wire, _expanded = self.assert_output_costs(updated)
        self.assertEqual(wire["type"], "FeatureCollection")
        self.assertEqual(updated["byte_size"], updated["cache_byte_size"])

    def test_encoding_failure_does_not_write(self):
        coarse = self.write_chunk("world", fixture(), "coarse", topology=True)
        detail = self.write_chunk("X.detail", fixture(), "detail")
        before = self.path(coarse).read_bytes()
        with patch.object(assets, "_encode_political_coarse_wire", side_effect=ValueError("bad encoding")):
            updated, report = self.apply([coarse, detail])
        self.assertIsNone(updated)
        self.assertEqual(report["reason"], "invalid-world-output")
        self.assertEqual(self.path(coarse).read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
