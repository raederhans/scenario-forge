from __future__ import annotations

import unittest
import gzip
import hashlib
import json
import tempfile
from pathlib import Path

from tools import build_pages_dist
from tools.pages_artifact_root import resolve_pages_artifact_root


REPO_ROOT = Path(__file__).resolve().parents[1]
PAGES_DIST_ROOT = resolve_pages_artifact_root(repo_root=REPO_ROOT)
DIST_ROOT_INDEX = PAGES_DIST_ROOT / "index.html"
DIST_APP_INDEX = PAGES_DIST_ROOT / "app" / "index.html"
DIST_MANIFEST = PAGES_DIST_ROOT / "pages-dist-manifest.json"


def import_landing_builder(module_name: str):
    try:
        module = __import__(f"tools.{module_name}", fromlist=[module_name])
    except ModuleNotFoundError as exc:
        missing_name = exc.name or ""
        if missing_name.split(".", 1)[0] in {"shapely", "topojson", "PIL"}:
            raise unittest.SkipTest(f"landing asset builder dependency is unavailable: {missing_name}") from exc
        raise
    return module


class PagesDistStartupShellTest(unittest.TestCase):
    def test_native_hgo_has_closed_assets_and_separate_navigation(self):
        native = PAGES_DIST_ROOT / "hgo"
        self.assertTrue((native / "index.html").is_file())
        self.assertIn('href="../app/"', (native / "index.html").read_text(encoding="utf-8"))
        self.assertIn('href="../hgo/"', DIST_APP_INDEX.read_text(encoding="utf-8"))
        self.assertIn('href="./hgo/"', DIST_ROOT_INDEX.read_text(encoding="utf-8"))
        dataset = json.loads((native / "assets/default/manifest.json").read_bytes())
        self.assertEqual(dataset["format"], "hgo-native-dataset")
        self.assertEqual(dataset["coordinateSpace"]["kind"], "pixel")
        for asset in dataset["assets"].values():
            data = (native / "assets/default" / asset["url"]).read_bytes()
            self.assertEqual(len(data), asset["byteLength"])
            self.assertEqual(hashlib.sha256(data).hexdigest(), asset["sha256"])
        self.assertFalse((native / "tools").exists())
        self.assertFalse((native / "tests").exists())
        self.assertFalse((PAGES_DIST_ROOT / "app/data/hgo_runtime").exists())
        self.assertFalse((PAGES_DIST_ROOT / "app/data/scenarios/hgo_1936").exists())

    def test_chunked_gzip_runtime_exclusion_and_unpublished_url_stripping(self) -> None:
        from unittest.mock import patch
        runtime = REPO_ROOT / ".runtime/tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as temporary:
            app = Path(temporary)
            scenarios = app / "data/scenarios"
            scenario = scenarios / "gzip_fixture"
            scenario.mkdir(parents=True)
            runtime_url = "data/scenarios/gzip_fixture/runtime_topology.topo.json.gz"
            payload = {"detail_chunk_manifest_url": "data/scenarios/gzip_fixture/detail_chunks.manifest.json", "runtime_topology_url": runtime_url}
            (scenario / "manifest.json").write_text(json.dumps(payload), encoding="utf-8")
            bundle = scenario / "startup.bundle.en.json"
            bundle.write_text(json.dumps({"manifest_subset": payload}), encoding="utf-8")
            bundle.with_suffix(".json.gz").write_bytes(gzip.compress(bundle.read_bytes(), mtime=0))
            policy = build_pages_dist.build_pages_production_publication_policy(scenarios)
            for path in (runtime_url, runtime_url.removesuffix(".gz")):
                self.assertFalse(policy.allows(path))
                self.assertFalse(policy.allows("app/" + path))
            self.assertTrue(policy.allows("data/scenarios/gzip_fixture/runtime_topology.bootstrap.topo.json"))
            with patch.object(build_pages_dist, "APP_DIST_ROOT", app):
                build_pages_dist.strip_scenario_publish_audit_urls(scenarios)
            self.assertNotIn("runtime_topology_url", json.loads((scenario / "manifest.json").read_text(encoding="utf-8")))
            self.assertNotIn("runtime_topology_url", json.loads(bundle.read_text(encoding="utf-8"))["manifest_subset"])
            self.assertEqual(json.loads(gzip.decompress(bundle.with_suffix(".json.gz").read_bytes())), json.loads(bundle.read_bytes()))

    def test_pages_dist_manifest_payload_rejects_missing_static_import(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            dist_root = Path(tmpdir)
            source_paths = {
                "hgo/index.html": '<script type="module" src="./src/main.js"></script>',
                "hgo/src/main.js": "export const native = true;",
                "index.html": '<script type="module" src="./app/js/main.js"></script>',
                "app/index.html": '<script type="module" src="./js/main.js"></script>',
                "app/js/main.js": 'import "./missing.js";',
            }
            for relative_path, source_text in source_paths.items():
                path = dist_root / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(source_text, encoding="utf-8")
            unresolved_graph = build_pages_dist.build_pages_module_graph(
                dist_root=dist_root,
                available_paths=set(source_paths),
                dynamic_import_registry=(),
            )
        records = [
            {"path": path, "size_bytes": len(source_text.encode("utf-8")), "source_kind": "dist"}
            for path, source_text in source_paths.items()
        ]
        with self.assertRaisesRegex(ValueError, "unresolved_references=1"):
            build_pages_dist.build_dist_manifest_payload(
                records,
                sum(record["size_bytes"] for record in records),
                module_graph=unresolved_graph,
            )

    def test_dist_app_index_keeps_pages_startup_contract(self) -> None:
        if not DIST_APP_INDEX.exists():
            self.skipTest("dist/app/index.html is only available after build_pages_dist runs")
        html = DIST_APP_INDEX.read_text(encoding="utf-8")

        self.assertIn('<meta name="default-scenario" content="tno_1962" />', html)
        self.assertIn('<meta name="robots" content="noindex,nofollow" />', html)
        self.assertIn('<link rel="icon" href="../assets/favicon.svg" type="image/svg+xml" />', html)
        self.assertIn('<link rel="alternate icon" href="../assets/favicon.png" type="image/png" />', html)
        # The published editor loads the esbuild bundle (tools/build_editor_bundle.mjs).
        self.assertIn('<link rel="modulepreload" href="js/bundle/main.js" />', html)
        self.assertIn('<script type="module" src="js/bundle/main.js"></script>', html)
        self.assertTrue((DIST_APP_INDEX.parent / "js" / "bundle" / "main.js").is_file())
        self.assertIn('<link rel="preload" href="data/scenarios/index.json" as="fetch" crossorigin />', html)
        self.assertNotIn('data-startup-bundle-preload', html)
        self.assertNotIn('startup.bundle.${language}', html)
        self.assertNotIn('<link rel="preload" href="data/europe_topology.json" as="fetch" crossorigin />', html)
        self.assertNotIn('href="data/locales.startup.json"', html)
        self.assertNotIn('href="data/geo_aliases.startup.json"', html)

    def test_dist_runtime_registry_references_only_published_files(self) -> None:
        if not DIST_MANIFEST.exists():
            self.skipTest("dist/pages-dist-manifest.json is only available after build_pages_dist runs")
        payload = json.loads(DIST_MANIFEST.read_text(encoding="utf-8"))
        dist_paths = {record["path"] for record in payload["files"]}
        registry_path = PAGES_DIST_ROOT / "app" / "data" / "runtime_asset_registry.json"
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
        missing: list[str] = []

        for asset_key, asset in (registry.get("assets") or {}).items():
            runtime_url = asset.get("url") if isinstance(asset, dict) else None
            if isinstance(runtime_url, str) and runtime_url.startswith("data/"):
                dist_path = f"app/{runtime_url}"
                if dist_path not in dist_paths or not (PAGES_DIST_ROOT / dist_path).is_file():
                    missing.append(f"{asset_key} -> {runtime_url}")

        self.assertFalse(missing[:20], missing[:20])

    def test_dist_transport_manifests_reference_only_published_pack_files(self) -> None:
        transport_root = PAGES_DIST_ROOT / "app" / "data" / "transport_layers"
        if not transport_root.exists():
            self.skipTest("dist transport layers are only available after build_pages_dist runs")
        missing: list[str] = []
        for manifest_path in transport_root.rglob("manifest.json"):
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            path_sections = [manifest.get("paths", {})]
            variants = manifest.get("variants", {})
            if isinstance(variants, dict):
                path_sections.extend(
                    variant.get("paths", {}) for variant in variants.values() if isinstance(variant, dict)
                )
            for path_section in path_sections:
                if not isinstance(path_section, dict):
                    continue
                for mode in ("preview", "full"):
                    mode_paths = path_section.get(mode, {})
                    if not isinstance(mode_paths, dict):
                        continue
                    for runtime_path in mode_paths.values():
                        if isinstance(runtime_path, str) and runtime_path.startswith("data/transport_layers/"):
                            if not (PAGES_DIST_ROOT / "app" / runtime_path).is_file():
                                missing.append(f"{manifest_path.relative_to(transport_root)} -> {runtime_path}")

        self.assertFalse(missing[:20], missing[:20])

    def test_dist_scenario_manifests_reference_only_published_runtime_files(self) -> None:
        if not DIST_MANIFEST.exists():
            self.skipTest("dist/pages-dist-manifest.json is only available after build_pages_dist runs")
        payload = json.loads(DIST_MANIFEST.read_text(encoding="utf-8"))
        dist_paths = {record["path"] for record in payload["files"]}
        scenario_manifest_paths = sorted(
            path for path in dist_paths
            if path.startswith("app/data/scenarios/") and path.endswith("/manifest.json")
        )
        self.assertGreater(len(scenario_manifest_paths), 0)
        checked_urls = 0
        for manifest_path in scenario_manifest_paths:
            manifest = json.loads((PAGES_DIST_ROOT / manifest_path).read_text(encoding="utf-8"))
            with self.subTest(manifest_path=manifest_path):
                for key, value in manifest.items():
                    if key.endswith("_url") and isinstance(value, str) and value.startswith("data/scenarios/"):
                        checked_urls += 1
                        self.assertIn(f"app/{value}", dist_paths)
                detail_manifest_url = manifest.get("detail_chunk_manifest_url")
                if isinstance(detail_manifest_url, str) and detail_manifest_url:
                    detail_manifest = json.loads((PAGES_DIST_ROOT / "app" / detail_manifest_url).read_text(encoding="utf-8"))
                    for chunk in detail_manifest.get("chunks", []):
                        chunk_url = chunk.get("url") if isinstance(chunk, dict) else ""
                        if isinstance(chunk_url, str) and chunk_url:
                            checked_urls += 1
                            self.assertIn(f"app/{chunk_url}", dist_paths)
                if manifest.get("startup_bundle_url_en"):
                    self.assertEqual(manifest["startup_bundle_url_en"], manifest["startup_bundle_url_zh"])
                    bundles = list((PAGES_DIST_ROOT / manifest_path).parent.glob("startup.bundle.*"))
                    self.assertEqual([p.name for p in bundles], ["startup.bundle.en.json.gz"])
                for language in ("en", "zh"):
                    bundle_url = manifest.get(f"startup_bundle_url_{language}")
                    if not isinstance(bundle_url, str) or not bundle_url:
                        continue
                    bundle_path = build_pages_dist.published_startup_bundle_path(PAGES_DIST_ROOT / "app" / bundle_url)
                    bundle = json.loads(gzip.decompress(bundle_path.read_bytes()) if bundle_path.suffix == ".gz" else bundle_path.read_bytes())
                    manifest_subset = bundle.get("manifest_subset")
                    self.assertIsInstance(manifest_subset, dict)
                    for key, value in manifest_subset.items():
                        if key.endswith("_url") and isinstance(value, str) and value.startswith("data/scenarios/"):
                            checked_urls += 1
                            self.assertIn(f"app/{value}", dist_paths)
        self.assertGreater(checked_urls, 0)

    def test_political_raster_dist_checks_payloads_and_rejects_corruption(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            previous = build_pages_dist.APP_DIST_ROOT
            build_pages_dist.APP_DIST_ROOT = Path(directory)
            try:
                payload = b"political raster fixture"
                digest = hashlib.sha256(payload).hexdigest()
                tile_path = Path(directory) / f"{digest}.pidr.gz"
                compressed = gzip.compress(payload, mtime=0)
                tile_path.write_bytes(compressed)
                tile = {"identity": "political-id-raster:v1:" + "0" * 64,
                        "url": f"./{digest}.pidr.gz", "compression": "gzip", "sha256": digest,
                        "byteLength": len(payload), "compressedByteLength": len(compressed)}
                manifest_path = Path(directory) / "manifest.json"
                manifest = {"schemaVersion": 1, "scenarioId": "sample", "tiles": [tile]}
                manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
                build_pages_dist.validate_dist_political_id_raster_manifest("manifest.json", "sample")
                with self.assertRaises(ValueError):
                    build_pages_dist.validate_dist_political_id_raster_manifest("manifest.json", "other")
                tile["byteLength"] -= 1
                manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
                with self.assertRaises(ValueError):
                    build_pages_dist.validate_dist_political_id_raster_manifest("manifest.json", "sample")
                tile["byteLength"] += 1
                tile["url"] = "../outside.pidr.gz"
                manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
                with self.assertRaises(ValueError):
                    build_pages_dist.validate_dist_political_id_raster_manifest("manifest.json", "sample")
                tile["url"] = f"./{digest}.pidr.gz"
                manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
                tile_path.write_bytes(compressed[:-1])
                with self.assertRaises(ValueError):
                    build_pages_dist.validate_dist_political_id_raster_manifest("manifest.json", "sample")
                tile_path.unlink()
                with self.assertRaises(FileNotFoundError):
                    build_pages_dist.validate_dist_political_id_raster_manifest("manifest.json", "sample")
            finally:
                build_pages_dist.APP_DIST_ROOT = previous


if __name__ == "__main__":
    unittest.main()
