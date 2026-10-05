from __future__ import annotations

import argparse
import gzip
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import geopandas as gpd

from tools import build_tno_1962_russia_audit as subject


class RussiaAuditGzipSourceTest(unittest.TestCase):
    def test_main_reads_gzip_only_runtime_topology(self) -> None:
        runtime_tmp = Path(__file__).resolve().parents[1] / ".runtime/tmp"
        runtime_tmp.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime_tmp) as temp_dir:
            root = Path(temp_dir)
            scenario = root / "scenario"
            scenario.mkdir()
            runtime = {
                "type": "Topology",
                "objects": {
                    "political": {
                        "type": "GeometryCollection",
                        "geometries": [{"type": "Polygon", "id": "RU_TEST"}],
                    }
                },
                "arcs": [],
            }
            (scenario / "runtime_topology.topo.json.gz").write_bytes(
                gzip.compress(json.dumps(runtime).encode("utf-8"), mtime=0)
            )
            (scenario / "countries.json").write_text('{"countries":{}}', encoding="utf-8")
            (scenario / "owners.by_feature.json").write_text(
                '{"owners":{"RU_TEST":"RUS"}}', encoding="utf-8"
            )
            captured: list[dict[str, object]] = []

            def topology_frame(payload: dict[str, object], _object_name: str) -> gpd.GeoDataFrame:
                captured.append(payload)
                return gpd.GeoDataFrame({"id": []}, geometry=[], crs="EPSG:4326")

            args = argparse.Namespace(
                tno_root=str(root),
                as_of_date="1962.1.1.1",
                rules_output=str(root / "rules.json"),
                report_json=str(root / "report.json"),
                report_md=str(root / "report.md"),
            )
            with (
                patch.object(subject, "SCENARIO_DIR", scenario),
                patch.object(subject, "parse_args", return_value=args),
                patch.object(subject, "resolve_tno_root", return_value=root),
                patch.object(subject, "parse_country_histories", return_value={}),
                patch.object(subject, "parse_states", return_value={}),
                patch.object(subject, "load_hgo_context", return_value={}),
                patch.object(subject, "load_palette_entries", return_value={}),
                patch.object(subject, "topology_object_to_gdf", side_effect=topology_frame),
                patch.object(subject, "SCOPE_TAGS", []),
            ):
                self.assertEqual(subject.main(), 0)

            self.assertEqual(len(captured), 1)
            self.assertEqual(captured[0]["objects"]["political"]["geometries"][0]["id"], "RU_TEST")
            report = json.loads((root / "report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["summary"]["audited_tag_count"], 0)


if __name__ == "__main__":
    unittest.main()
