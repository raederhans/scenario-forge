from __future__ import annotations

import gzip
import json
import tempfile
import unittest
from pathlib import Path

from tools.startup_topology_codec import decode_topology
from tools import (
    build_startup_bootstrap_assets,
    build_hoi4_scenario,
    build_startup_bundle,
)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


class StartupBootstrapAssetsTest(unittest.TestCase):
    def test_chunk_builder_preserves_gzip_runtime_url_and_reads_gzip_only(self) -> None:
        from unittest.mock import patch
        from tools import build_scenario_chunk_assets as builder
        runtime = Path(__file__).resolve().parents[1] / ".runtime/tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as temporary:
            root = Path(temporary)
            scenario = root / "data/scenarios/gzip_fixture"
            scenario.mkdir(parents=True)
            topology = {"type": "Topology", "objects": {"political": {"type": "GeometryCollection", "geometries": []}}, "arcs": []}
            (scenario / "runtime_topology.topo.json.gz").write_bytes(gzip.compress(json.dumps(topology).encode(), mtime=0))
            for suffix in (".json", ".json.gz"):
                with self.subTest(manifest_suffix=suffix):
                    _write_json(scenario / "manifest.json", {"scenario_id": "gzip_fixture", "runtime_topology_url": "data/scenarios/gzip_fixture/runtime_topology.topo" + suffix})
                    with patch.object(builder, "PROJECT_ROOT", root), patch("sys.argv", ["chunks", "--scenario-dir", str(scenario)]), patch.object(builder, "build_and_write_scenario_chunk_assets") as build:
                        self.assertEqual(builder.main(), 0)
                    self.assertEqual(build.call_args.kwargs["runtime_topology_payload"], topology)
                    self.assertEqual(build.call_args.kwargs["runtime_topology_url"], "data/scenarios/gzip_fixture/runtime_topology.topo.json.gz")
                    self.assertEqual(json.loads((scenario / "manifest.json").read_bytes())["runtime_topology_url"], "data/scenarios/gzip_fixture/runtime_topology.topo.json.gz")

    def test_gzip_only_runtime_builds_bootstrap_and_startup_support(self) -> None:
        runtime = Path(__file__).resolve().parents[1] / ".runtime/tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as temporary:
            root = Path(temporary)
            scenario = root / "data/scenarios/gzip_fixture"
            scenario.mkdir(parents=True)
            topology = {"type": "Topology", "objects": {"political": {"type": "GeometryCollection", "geometries": []}, "scenario_coastline": {"type": "LineString", "arcs": [0]}}, "arcs": [[[1, 2], [3, 4]]]}
            compressed = scenario / "runtime_topology.topo.json.gz"
            compressed.write_bytes(gzip.compress(json.dumps(topology).encode(), mtime=0))
            _write_json(scenario / "manifest.json", {"scenario_id": "gzip_fixture", "runtime_topology_url": "data/scenarios/gzip_fixture/runtime_topology.topo.json.gz"})
            _write_json(root / "base.json", {"type": "Topology", "objects": {}, "arcs": []})
            _write_json(root / "locales.json", {"ui": {"ok": "OK"}, "geo": {"A": {"en": "A"}}})
            _write_json(root / "aliases.json", {"alias_to_stable_key": {"alias-A": "A"}})
            _write_json(scenario / "geo_locale_patch.json", {"scenario_id": "gzip_fixture", "geo": {"A": {"en": "A"}}})
            for path in (compressed, compressed.with_suffix("")):
                with self.subTest(runtime_path=path):
                    build_startup_bootstrap_assets.build_startup_bootstrap_assets(
                        base_topology_path=root / "base.json", full_locales_path=root / "locales.json", full_geo_aliases_path=root / "aliases.json",
                        full_runtime_topology_path=path, scenario_geo_patch_path=scenario / "geo_locale_patch.json",
                        runtime_bootstrap_output_path=scenario / "runtime_topology.bootstrap.topo.json",
                        startup_locales_output_path=scenario / "locales.startup.json", startup_geo_aliases_output_path=scenario / "geo_aliases.startup.json",
                    )
                    shell = json.loads((scenario / "runtime_topology.bootstrap.topo.json").read_bytes())
                    self.assertEqual(shell["arcs"], topology["arcs"])
                    self.assertEqual(shell["objects"]["scenario_coastline"], topology["objects"]["scenario_coastline"])

    def test_bootstrap_preserves_dedicated_coastline_arcs_and_transform(self) -> None:
        full = {
            "objects": {
                "political": {"type": "GeometryCollection", "geometries": [
                    {"type": "Polygon", "properties": {"id": "RU_ARCTIC_FB_1"}, "arcs": [[2]]}
                ]},
                "scenario_coastline": {"type": "GeometryCollection", "geometries": [
                    {"type": "MultiPolygon", "arcs": [[[3], [-2]], [[3]]]}
                ]},
            },
            "arcs": [[[99, 99]], [[1, 1]], [[2, 2]], [[3, 3]]],
            "transform": {"scale": [0.1, 0.1], "translate": [1, 2]},
        }
        shell = build_startup_bootstrap_assets.build_bootstrap_runtime_topology(full)
        self.assertEqual(shell["arcs"], [[[2, 2]], [[3, 3]], [[1, 1]]])
        self.assertEqual(shell["objects"]["scenario_coastline"]["geometries"][0]["arcs"], [[[1], [-3]], [[1]]])
        self.assertEqual(shell["transform"], full["transform"])
        self.assertEqual(shell["objects"]["land_mask"]["geometries"], [])
        # The localized startup bundle compacts the bootstrap once more.
        # It must keep the same coast through that second loading path.
        bundle_shell = build_startup_bundle.build_startup_runtime_shell(shell)
        self.assertEqual(bundle_shell["objects"]["scenario_coastline"], shell["objects"]["scenario_coastline"])
        self.assertEqual(bundle_shell["arcs"], shell["arcs"])
        self.assertEqual(bundle_shell["transform"], shell["transform"])

    def test_build_bootstrap_runtime_topology_keeps_runtime_shell_only(self) -> None:
        full_topology = {
            "type": "Topology",
            "objects": {
                "political": {
                    "type": "GeometryCollection",
                    "geometries": [
                        {"type": "Polygon", "properties": {"id": "AAA-1"}, "arcs": [[0]]},
                        {
                            "type": "Polygon",
                            "properties": {
                                "id": "RU_ARCTIC_FB_001",
                                "scenario_helper_kind": "shell_fallback",
                                "scenario_shell_owner_hint": "RFA",
                                "unused": "x",
                            },
                            "arcs": [[1]],
                        },
                    ],
                },
                "land_mask": {"type": "GeometryCollection", "geometries": [{"type": "Polygon", "properties": {"id": "mask-1"}, "arcs": [[1]]}]},
                "context_land_mask": {"type": "GeometryCollection", "geometries": [{"type": "Polygon", "properties": {"id": "context-mask-1"}, "arcs": [[2]]}]},
                "scenario_water": {"type": "GeometryCollection", "geometries": [{"type": "Polygon", "properties": {"id": "water-1"}, "arcs": [[3]]}]},
                "scenario_special_land": {"type": "GeometryCollection", "geometries": [{"type": "Polygon", "properties": {"id": "special-1"}, "arcs": [[4]]}]},
            },
            "arcs": [[], [], [], [], []],
            "bbox": [-1, -1, 1, 1],
        }

        shell = build_startup_bootstrap_assets.build_bootstrap_runtime_topology(full_topology)

        self.assertEqual(
            list(shell["objects"].keys()),
            ["political", "land_mask", "context_land_mask", "scenario_water", "scenario_special_land", "scenario_atlantropa"],
        )
        self.assertEqual(shell["arcs"], [[]])
        shell_political = shell["objects"]["political"]["geometries"]
        self.assertEqual([geometry["properties"]["id"] for geometry in shell_political], ["RU_ARCTIC_FB_001"])
        self.assertEqual(shell_political[0]["properties"]["scenario_shell_owner_hint"], "RFA")
        self.assertNotIn("unused", shell_political[0]["properties"])
        self.assertEqual(shell["objects"]["scenario_water"]["geometries"], [])

    def test_hoi4_geo_locale_language_patches_derive_from_base_patch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "hoi4_1939"
            scenario_dir.mkdir(parents=True)
            _write_json(
                scenario_dir / "geo_locale_patch.json",
                {
                    "version": 1,
                    "scenario_id": "hoi4_1939",
                    "generated_at": "now",
                    "geo": {
                        "id::AAA-1": {"en": "Alpha", "zh": "阿尔法"},
                        "id::BBB-1": {"en": "Beta"},
                        "id::CCC-1": {"zh": "伽马"},
                    },
                },
            )

            build_hoi4_scenario.ensure_geo_locale_patch_inputs(scenario_dir, "hoi4_1939")

            en_payload = json.loads((scenario_dir / "geo_locale_patch.en.json").read_text(encoding="utf-8"))
            zh_payload = json.loads((scenario_dir / "geo_locale_patch.zh.json").read_text(encoding="utf-8"))
            self.assertEqual(sorted(en_payload["geo"].keys()), ["id::AAA-1", "id::BBB-1"])
            self.assertEqual(sorted(zh_payload["geo"].keys()), ["id::AAA-1", "id::CCC-1"])
            self.assertEqual(en_payload["geo"]["id::AAA-1"]["en"], "Alpha")
            self.assertEqual(zh_payload["geo"]["id::AAA-1"]["zh"], "阿尔法")

    def test_startup_bundle_topology_decodes_with_transform_and_arc_references(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            topology_path = root / "topology.json"
            topology = {
                "type": "Topology", "arcs": [[[12, -5], [4, 0]]],
                "transform": {"scale": [0.1, 0.1], "translate": [-180.0, -90.0]},
                "objects": {"political": {"type": "GeometryCollection", "geometries": [{
                    "type": "Polygon", "arcs": [[0]], "properties": {
                        "id": "RU_ARCTIC_FB_RFA_001", "scenario_helper_kind": "shell_fallback",
                        "scenario_shell_owner_hint": "RFA",
                    },
                }]}},
            }
            _write_json(topology_path, topology)
            for key in ("countries", "owners", "cores"):
                _write_json(root / f"{key}.json", {key: {}})

            payload = build_startup_bundle.build_startup_bundle_payload(
                language="en",
                scenario_manifest={"scenario_id": "tno_1962", "generated_at": "now", "baseline_hash": "base"},
                data_manifest={"version": 1, "generated_at": "now"},
                topology_primary_path=topology_path,
                full_runtime_topology_path=topology_path,
                runtime_bootstrap_topology_path=topology_path,
                countries_path=root / "countries.json",
                owners_path=root / "owners.json",
                cores_path=root / "cores.json",
            )
            for encoded_topology in (payload["base"]["topology_primary"], payload["scenario"]["runtime_topology_bootstrap"]):
                decoded_topology = decode_topology(encoded_topology)
                self.assertEqual(decoded_topology["arcs"], [[[12, -5], [4, 0]]])
                self.assertEqual(decoded_topology["transform"], encoded_topology["transform"])
                self.assertEqual(decoded_topology["objects"]["political"]["geometries"][0]["arcs"], [[0]])


if __name__ == "__main__":
    unittest.main()
