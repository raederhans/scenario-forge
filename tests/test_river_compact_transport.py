import copy
import json
import math
from pathlib import Path
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
import io

from tools.river_partitions.compact_transport import encode_transport, decode_transport, main


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
    def test_actual_wave3_exact_round_trip_and_size(self):
        text = (ROOT / "data/river_partitions/modern_world_wave3.json").read_text(encoding="utf-8")
        pack = json.loads(text)
        before = copy.deepcopy(pack)
        wrapper = encode_transport(pack)
        self.assertEqual(pack, before)
        self.assertEqual(decode_transport(wrapper), pack)
        self.assertEqual(len(wrapper["coordinates"]), 18993)
        payload = json.dumps(wrapper, separators=(",", ":"), ensure_ascii=False) + "\n"
        self.assertEqual(len(payload.encode("utf-8")), 1193430)
        self.assertLess(len(payload.encode("utf-8")), len(text.encode("utf-8")) * .61)

    def test_old_canonical_packs_pass_through(self):
        for name in ("modern_world_pilot", "modern_world_wave2", "modern_world_wave3"):
            pack = json.loads((ROOT / f"data/river_partitions/{name}.json").read_text(encoding="utf-8"))
            self.assertIs(decode_transport(pack), pack)
            self.assertEqual(decode_transport(encode_transport(pack)), pack)

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

    def test_invalid_contract_indices_points_and_unknown_fields(self):
        for index in (-1, 3, .5, "0", True, None, float("inf")):
            wrapper = encode_transport(fixture())
            wrapper["pack"]["parents"][0]["parentGeometry"]["coordinates"][0][0] = index
            with self.assertRaisesRegex(ValueError, "coordinate index"):
                decode_transport(wrapper)
        for point in ([float("nan"), 0], [0, float("inf")], [181, 0], [0, 81], [0], [0, 0, 0], [False, 0]):
            wrapper = encode_transport(fixture())
            wrapper["coordinates"][0] = point
            with self.assertRaises(ValueError):
                decode_transport(wrapper)
        for key, value in (("transportVersion", 2), ("transportVersion", True), ("kind", "future"), ("__proto__", {})):
            wrapper = encode_transport(fixture()); wrapper[key] = value
            with self.assertRaises(ValueError):
                decode_transport(wrapper)
        wrapper = encode_transport(fixture()); wrapper["pack"]["source"]["constructor"] = {}
        with self.assertRaises(ValueError):
            decode_transport(wrapper)
        pack = fixture(); pack["parents"][0]["parentGeometry"]["coordinates"][0][0] = [float("nan"), 0]
        with self.assertRaises(ValueError):
            encode_transport(pack)

    def test_coordinate_expansion_and_table_bounds(self):
        wrapper = encode_transport(fixture())
        wrapper["coordinates"] = [[0, 0] for _ in range(250000)]
        wrapper["pack"]["parents"][0]["parentGeometry"]["coordinates"][0] = [0] * 249992
        self.assertEqual(len(decode_transport(wrapper)["parents"][0]["parentGeometry"]["coordinates"][0]), 249992)
        wrapper["pack"]["parents"][0]["parentGeometry"]["coordinates"][0].append(0)
        with self.assertRaisesRegex(ValueError, "count"):
            decode_transport(wrapper)
        wrapper["coordinates"].append([0, 0])
        with self.assertRaisesRegex(ValueError, "coordinate table count"):
            decode_transport(wrapper)
        wrapper = encode_transport(fixture())
        wrapper["pack"]["parents"][0]["parentGeometry"]["coordinates"][0] = [0] * 249993
        with self.assertRaisesRegex(ValueError, "count"):
            decode_transport(wrapper)

    def test_parent_and_cell_ceilings(self):
        wrapper = encode_transport(fixture()); parent = wrapper["pack"]["parents"][0]
        wrapper["pack"]["parents"] = [copy.deepcopy(parent) for _ in range(512)]
        self.assertEqual(len(decode_transport(wrapper)["parents"]), 512)
        wrapper["pack"]["parents"].append(parent)
        with self.assertRaisesRegex(ValueError, "parent count"):
            decode_transport(wrapper)
        wrapper = encode_transport(fixture())
        parent = wrapper["pack"]["parents"][0]
        parent["cells"] = [copy.deepcopy(parent["cells"][0]) for _ in range(128)]
        wrapper["pack"]["parents"] = [copy.deepcopy(parent) for _ in range(64)]
        self.assertEqual(sum(len(p["cells"]) for p in decode_transport(wrapper)["parents"]), 8192)
        wrapper["pack"]["parents"].append(parent)
        with self.assertRaisesRegex(ValueError, "cell budget"):
            decode_transport(wrapper)

    def test_cli_separate_output_and_canonical_input_preserved(self):
        with tempfile.TemporaryDirectory(dir=ROOT / ".runtime") as tmp:
            source, output = Path(tmp) / "canonical.json", Path(tmp) / "transport.json"
            source.write_text(json.dumps(fixture()).replace("[[[0, 0]", "[[[-0, 0]", 1), encoding="utf-8")
            before = source.read_bytes()
            with redirect_stdout(io.StringIO()):
                main([str(source), str(output)])
            self.assertEqual(source.read_bytes(), before)
            self.assertEqual(decode_transport(json.loads(output.read_bytes())), fixture())
            self.assertEqual(math.copysign(1, json.loads(output.read_bytes())["coordinates"][0][0]), -1)
            self.assertTrue(output.read_bytes().endswith(b"\n"))
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    main([str(source), str(source)])


if __name__ == "__main__":
    unittest.main()
