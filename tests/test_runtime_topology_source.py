from __future__ import annotations

import gzip
import hashlib
import tempfile
import unittest
from pathlib import Path

from map_builder.json_source import (
    json_source_sha256,
    read_json_bytes,
    read_json_source,
    resolve_json_source_path,
)


class RuntimeTopologySourceTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
