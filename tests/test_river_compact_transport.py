import copy
import json
import math
from pathlib import Path
import unittest

from tools.river_partitions.compact_transport import encode_transport, decode_transport


ROOT = Path(__file__).resolve().parents[1]
DIGEST = "sha256:" + "1" * 64


def fixture():
    def geometry():
        return {"type": "Polygon", "coordinates": [[[0, 0], [0, 1], [1, 0], [0, 0]]]}
    return {"schemaVersion": 1, "kind": "river-paint-partitions", "packId": DIGEST, "sceneId": "modern_world",
            "algorithmVersion": "river-joint-noding-v1", "coordinateIdentityPrecision": 7,
            "geometryWinding": "d3-clockwise-exterior", "source": {}, "parents": [
                {"parentId": "P", "parentFingerprint": DIGEST, "parentGeometry": geometry(), "cells": [
                    {"id": f"C{i}", "geometryFingerprint": DIGEST, "geometry": geometry()} for i in range(2)]}], "support": []}


class RiverCompactTransportTests(unittest.TestCase):
    def test_actual_wave3_exact_round_trip(self):
        text = (ROOT / "data/river_partitions/modern_world_wave3.json").read_text(encoding="utf-8")
        pack = json.loads(text)
        before = copy.deepcopy(pack)
        wrapper = encode_transport(pack)
        self.assertEqual(pack, before)
        self.assertEqual(decode_transport(wrapper), pack)

    def test_multipolygon_holes_and_exact_signed_zero(self):
        pack = fixture()
        tiny = math.nextafter(0.0, 1.0)
        ring = [[-0.0, 0], [tiny, 1], [1, -0.0], [0.0, 0], [-0.0, 0]]
        pack["parents"][0]["parentGeometry"] = {"type": "MultiPolygon", "coordinates": [[ring, copy.deepcopy(ring)], [copy.deepcopy(ring)]]}
        wrapper = encode_transport(pack)
        decoded = decode_transport(json.loads(json.dumps(wrapper)))
        result = decoded["parents"][0]["parentGeometry"]["coordinates"][0][0]
        self.assertEqual(result, ring)
        self.assertEqual(math.copysign(1, result[0][0]), -1)
        self.assertEqual(math.copysign(1, result[3][0]), 1)
        self.assertEqual(result[1][0], tiny)
        result[0][0] = 10
        self.assertEqual(math.copysign(1, wrapper["coordinates"][0][0]), -1)
        self.assertEqual(decoded["parents"][0]["parentGeometry"]["coordinates"][0][1][0][0], -0.0)

    def test_invalid_coordinate_indices(self):
        for index in (-1, 3, .5, "0", True, None, float("inf")):
            wrapper = encode_transport(fixture())
            wrapper["pack"]["parents"][0]["parentGeometry"]["coordinates"][0][0] = index
            with self.assertRaisesRegex(ValueError, "coordinate index"):
                decode_transport(wrapper)


if __name__ == "__main__":
    unittest.main()
