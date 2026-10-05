from __future__ import annotations

import gzip
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from map_builder.json_source import (
    json_source_sha256, read_json_bytes, read_json_source,
    resolve_json_source_path, write_runtime_topology_source,
)


class RuntimeTopologySourceTest(unittest.TestCase):
    def test_source_module_imports_without_geopandas(self):
        code = "import sys; import map_builder.json_source; assert 'geopandas' not in sys.modules"
        subprocess.run([sys.executable, "-c", code], check=True)

    def test_resolver_only_falls_back_for_missing_canonical_plain(self):
        with tempfile.TemporaryDirectory() as d:
            plain = Path(d) / "runtime_topology.topo.json"
            compressed = plain.with_name(plain.name + ".gz")
            compressed.write_bytes(gzip.compress(b'{}', mtime=0))
            self.assertEqual(resolve_json_source_path(plain), compressed)
            self.assertEqual(read_json_source(plain), {})
            plain.write_bytes(b'{"plain":true}')
            self.assertEqual(resolve_json_source_path(plain), plain)
            self.assertEqual(read_json_bytes(plain), plain.read_bytes())
            compressed.unlink()
            with self.assertRaises(FileNotFoundError):
                read_json_source(compressed)
            other = Path(d) / "other.json"
            other.with_name("other.json.gz").write_bytes(gzip.compress(b'{}'))
            with self.assertRaises(FileNotFoundError):
                read_json_bytes(other)

    def test_explicit_gzip_rejects_plain_and_reads_bom(self):
        with tempfile.TemporaryDirectory() as d:
            source = Path(d) / "source.json.gz"
            source.write_bytes(b'{}')
            with self.assertRaises(gzip.BadGzipFile):
                read_json_bytes(source)
            raw = b'\xef\xbb\xbf{"label":"test"}'
            source.write_bytes(gzip.compress(raw))
            self.assertEqual(read_json_bytes(source), raw)
            self.assertEqual(read_json_source(source), {"label": "test"})
            self.assertEqual(json_source_sha256(source), hashlib.sha256(source.read_bytes()).hexdigest())

    def test_writer_preserves_coordinates_and_removes_stale_representations(self):
        with tempfile.TemporaryDirectory() as d:
            directory = Path(d)
            payload = {"type": "Topology", "arcs": [[[1.1234567890123, -0.0], [2.0, 3.0]]],
                       "objects": {}, "label": "中文" * 200}
            raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
            plain = write_runtime_topology_source(directory, payload, max_bytes=len(raw) + 1)
            self.assertEqual(plain.read_bytes(), raw)
            gz = write_runtime_topology_source(directory, payload, max_bytes=len(raw))
            self.assertEqual(gz.name, "runtime_topology.topo.json.gz")
            self.assertFalse(plain.exists())
            self.assertEqual(gzip.decompress(gz.read_bytes()), raw)
            self.assertEqual(gz.read_bytes()[4:8], b'\0' * 4)
            self.assertEqual(gz.read_bytes()[9], 255)
            self.assertEqual(json_source_sha256(plain), hashlib.sha256(gz.read_bytes()).hexdigest())
            previous = gz.read_bytes()
            write_runtime_topology_source(directory, payload, max_bytes=len(raw))
            self.assertEqual(gz.read_bytes(), previous)
            plain = write_runtime_topology_source(directory, payload, max_bytes=len(raw) + 1)
            self.assertFalse(gz.exists())
            self.assertEqual(plain.read_bytes(), raw)

    def test_failed_size_or_nan_validation_preserves_existing_source(self):
        with tempfile.TemporaryDirectory() as d:
            plain = write_runtime_topology_source(d, {})
            with self.assertRaisesRegex(ValueError, "storage"):
                write_runtime_topology_source(d, {}, max_bytes=1)
            self.assertEqual(plain.read_bytes(), b'{}')
            with self.assertRaises(ValueError):
                write_runtime_topology_source(d, {"invalid": float("nan")})
            self.assertEqual(plain.read_bytes(), b'{}')

if __name__ == "__main__":
    unittest.main()
