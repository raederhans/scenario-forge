"""Supplement synchronization preserves evidence and unrelated ownership in fixtures."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from tools import sync_marine_refinement as sync
from tools.patch_tno_1962_bundle import collect_marine_regions_source_record_ids


class SyncMarineRefinementTests(unittest.TestCase):
    def setUp(self):
        temporary_root = Path(__file__).resolve().parents[1] / ".runtime/tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        temporary = TemporaryDirectory(dir=temporary_root)
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.scenario = self.root / "data/scenarios/tno_1962"
        self.feature = {
            "type": "Feature", "properties": {
                "id": "tno_fixture_sea", "name": "Fixture Sea", "label": "Fixture Sea",
                "name_zh": "测试海", "source_layer": "seavox_v19", "source_query": "mrgid_sr='123'",
                "source_record_ids": ["mrgid_sr:123", "mrgid_sr:124"],
                "source_standard": "marine_regions_seavox_v19", "source_feature_count": 2,
                "source_url": "https://example.test/polygon", "source_simplify_degrees": 0.005,
            },
            "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]]},
        }
        marine = deepcopy(self.feature)
        marine["properties"]["id"] = "marine_fixture_sea"
        for name in ("additional", "refined"):
            self.write(f"data/marine_regions.{name}.source.geojson", {"features": [marine]})
        self.write("data/source_ledger.json", [
            {"local_path": f"data/marine_regions.{name}.source.geojson", "current_local_sha256": "old", "extension": name}
            for name in ("additional", "refined")
        ] + [{"local_path": "data/unrelated.bin", "current_local_sha256": "keep"}])
        self.write("data/locales.json", {"geo": {
            "Fixture Sea": {"en": "old", "zh": "old", "fr": "Mer"},
            "Unrelated": {"en": "Unrelated", "zh": "保留"},
        }, "ui": {"keep": "value"}, "extension": True})
        self.write("data/manifest.json", {"outputs": {
            "marine_regions.refined.source.geojson": {"owner": "source-builder", "extension": 1},
            "locales.json": {"owner": "locales-builder"},
            "unrelated.json": {"sha256": "keep"},
        }, "extension": True})
        previous = deepcopy(self.feature)
        previous["properties"]["extension"] = "retained"
        self.write("data/scenarios/tno_1962/derived/marine_regions_named_waters.snapshot.geojson",
                   {"features": [previous], "extension": "snapshot"})
        old_extract = {"id": "tno_fixture_sea", "source_feature_count": 1, "extension": "extract"}
        for relative in ("derived/water_regions.provenance.json", "water_regions.provenance.json"):
            self.write(f"data/scenarios/tno_1962/{relative}", {
                "generated_at": "2026-01-01T00:00:00Z", "water_extracts": [old_extract],
                "local_clone_extracts": [{"id": "clone"}], "source_datasets": [{"id": "seavox"}],
                "diagnostics": {"extension": "diagnostics"}, "extension": relative,
            })
        self.write("data/scenarios/tno_1962/water_regions.geojson", {"features": [self.feature]})
        self.write("data/scenarios/tno_1962/audit.json", {"diagnostics": {
            "named_water_source_diagnostics": {"tno_fixture_sea": {"extension": "named"}},
            "atlantropa": "keep",
        }, "extension": "audit"})
        self.spec = {
            "id": "tno_fixture_sea", "name": "Fixture Sea", "source_layer": "seavox_v19",
            "source_query": "mrgid_sr='123'", "source_standard": "marine_regions_seavox_v19",
            "clip_open_ocean_ids": ("tno_indian_ocean",),
        }

    def write(self, relative, payload):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    def read(self, relative):
        return sync.read(self.root / relative)

    def bytes(self):
        return {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob("*.json")}

    def test_updated_compact_geojson_keeps_key_order_and_trailing_newline(self):
        payload = {"type": "FeatureCollection", "features": [deepcopy(self.feature)],
                   "extension": {"z": 1, "a": 2}}
        path = self.root / "compact.geojson"
        for trailing_newline in (False, True):
            with self.subTest(trailing_newline=trailing_newline):
                original = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
                path.write_text(original + ("\n" if trailing_newline else ""), encoding="utf-8")
                updated = deepcopy(payload)
                updated["features"][0]["properties"]["name_zh"] = "更新测试海"
                sync._write_changed(path, updated)
                expected = json.dumps(updated, ensure_ascii=False, separators=(",", ":"))
                self.assertEqual(path.read_text(encoding="utf-8"), expected + ("\n" if trailing_newline else ""))
                self.assertEqual(list(sync.read(path)), ["type", "features", "extension"])
                self.assertEqual(list(sync.read(path)["extension"]), ["z", "a"])
                before = path.read_bytes()
                sync._write_changed(path, updated)
                self.assertEqual(path.read_bytes(), before)

    def test_updated_pretty_json_keeps_indentation_key_order_and_newline(self):
        path = self.root / "pretty.json"
        for trailing_newline in (False, True):
            with self.subTest(trailing_newline=trailing_newline):
                payload = {"z": {"second": 1, "first": 2}, "a": 3}
                path.write_text(json.dumps(payload, indent=2) + ("\n" if trailing_newline else ""), encoding="utf-8")
                payload["z"]["second"] = 4
                sync._write_changed(path, payload)
                self.assertEqual(path.read_text(encoding="utf-8"),
                                 json.dumps(payload, indent=2) + ("\n" if trailing_newline else ""))

    def test_shared_hashes_and_translations_are_scoped_and_idempotent(self):
        sync.sync_shared_source_metadata(self.root)
        ledger = self.read("data/source_ledger.json")
        for row in ledger[:2]:
            self.assertEqual(row["current_local_sha256"], hashlib.sha256(
                (self.root / row["local_path"]).read_bytes()).hexdigest())
            self.assertIn("extension", row)
        self.assertEqual(ledger[2], {"local_path": "data/unrelated.bin", "current_local_sha256": "keep"})
        locales = self.read("data/locales.json")
        self.assertEqual(locales["geo"]["Fixture Sea"], {"en": "Fixture Sea", "zh": "测试海", "fr": "Mer"})
        manifest = self.read("data/manifest.json")
        self.assertEqual(manifest["outputs"]["unrelated.json"], {"sha256": "keep"})
        self.assertEqual(manifest["outputs"]["locales.json"]["geo_entry_count"], 2)
        self.assertEqual(manifest["outputs"]["marine_regions.refined.source.geojson"]["extension"], 1)
        before = self.bytes()
        sync.sync_shared_source_metadata(self.root)
        self.assertEqual(self.bytes(), before)

    def test_locale_geo_sync_preserves_mixed_ui_and_extension_text_and_manifest_identity(self):
        path = self.root / "data/locales.json"
        prefix = ('{\r\n  "extension" : {"message": "a geo word and \\\"geo\\\": { inside a string",'
                  ' "z" : 1},\r\n  "ui": {\r\n'
                  '    "Geo label": {"en": "geo", "zh":"地理"},\r\n'
                  '    "Keep": {\r\n      "en": "Keep"\r\n    }\r\n  },\r\n  "geo" : ')
        original_geo = '{\r\n    "Existing": {"en":"Existing", "zh":"已有"}\r\n  }'
        suffix = ',\r\n  "after" : [ "geo", {"geo": "nested extension"} ]\r\n}\r\n'
        path.write_bytes((prefix + original_geo + suffix).encode("utf-8"))
        sync.sync_shared_source_metadata(self.root)
        updated = path.read_bytes().decode("utf-8")
        self.assertTrue(updated.startswith(prefix))
        self.assertTrue(updated.endswith(suffix))
        locales = json.loads(updated)
        self.assertEqual(locales["geo"]["Fixture Sea"], {"en": "Fixture Sea", "zh": "测试海"})
        self.assertEqual(locales["geo"]["Existing"], {"en": "Existing", "zh": "已有"})
        self.assertEqual(list(locales), ["extension", "ui", "geo", "after"])
        self.assertIn('\r\n    "Existing": {\r\n', updated)
        metadata = self.read("data/manifest.json")["outputs"]["locales.json"]
        self.assertEqual(metadata["sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertEqual(metadata["size_bytes"], len(path.read_bytes()))
        self.assertEqual(metadata["geo_entry_count"], 2)
        self.assertEqual(metadata["ui_entry_count"], 2)
        before = self.bytes()
        sync.sync_shared_source_metadata(self.root)
        self.assertEqual(self.bytes(), before)

    def test_compact_locales_geo_sync_preserves_surrounding_inline_members(self):
        path = self.root / "data/locales.json"
        prefix = '{ "ui" : {"en": "geo"}, "extension": "geo", "geo": '
        suffix = ', "after" : {"geo": "keep"} }'
        path.write_bytes((prefix + '{"old":{"en":"Old"}}' + suffix).encode("utf-8"))
        geo = {"old": {"en": "Old"}, "new": {"en": "New", "zh": "新"}}
        sync._write_locales_geo(path, geo)
        expected = prefix + json.dumps(geo, ensure_ascii=False, separators=(",", ":")) + suffix
        self.assertEqual(path.read_bytes(), expected.encode("utf-8"))
        self.assertEqual(sync.read(path)["geo"], geo)
        before = path.read_bytes()
        sync._write_locales_geo(path, geo)
        self.assertEqual(path.read_bytes(), before)

    def test_snapshot_provenance_and_audit_keep_extensions_and_source_counts(self):
        water_before = (self.scenario / "water_regions.geojson").read_bytes()
        sync.sync_tno_source_metadata(self.root, [self.feature], [self.spec])
        snapshot = self.read("data/scenarios/tno_1962/derived/marine_regions_named_waters.snapshot.geojson")
        self.assertEqual(len(snapshot["features"]), 1)
        self.assertEqual(snapshot["features"][0]["properties"]["extension"], "retained")
        for name in ("derived/water_regions.provenance.json", "water_regions.provenance.json"):
            provenance = sync.read(self.scenario / name)
            self.assertEqual(provenance["extension"], name)
            self.assertEqual(provenance["generated_at"], "2026-01-01T00:00:00Z")
            self.assertEqual(provenance["water_extracts"][0]["source_feature_count"], 2)
            self.assertEqual(provenance["water_extracts"][0]["extension"], "extract")
            self.assertEqual(provenance["diagnostics"]["source_feature_count"], 2)
        audit = sync.read(self.scenario / "audit.json")
        diagnostics = audit["diagnostics"]
        self.assertEqual(diagnostics["atlantropa"], "keep")
        self.assertEqual(diagnostics["tno_water_region_ids"], ["tno_fixture_sea"])
        row = diagnostics["named_water_source_diagnostics"]["tno_fixture_sea"]
        self.assertEqual(row["source_record_ids"], ["mrgid_sr:123", "mrgid_sr:124"])
        self.assertEqual(row["geometry_area"], 2)
        self.assertEqual(row["extension"], "named")
        self.assertEqual((self.scenario / "water_regions.geojson").read_bytes(), water_before)
        before = self.bytes()
        sync.sync_tno_source_metadata(self.root, [self.feature], [self.spec])
        self.assertEqual(self.bytes(), before)

    def test_missing_promoted_water_fails_before_metadata_writes(self):
        before = self.bytes()
        with self.assertRaisesRegex(ValueError, "Promote water geometry"):
            sync.sync_tno_source_metadata(self.root, [self.feature], [{**self.spec, "id": "missing"}])
        self.assertEqual(self.bytes(), before)

    def test_new_sibling_appends_once_and_keeps_historical_evidence(self):
        addition = deepcopy(self.feature)
        addition["properties"].update(id="tno_new_sea", name="New Sea", label="New Sea")
        self.write("data/scenarios/tno_1962/water_regions.geojson", {"features": [self.feature, addition]})
        specs = [self.spec, {**self.spec, "id": "tno_new_sea", "name": "New Sea"}]
        sync.sync_tno_source_metadata(self.root, [addition], specs)
        snapshot = self.read("data/scenarios/tno_1962/derived/marine_regions_named_waters.snapshot.geojson")
        self.assertEqual([f["properties"]["id"] for f in snapshot["features"]],
                         ["tno_fixture_sea", "tno_new_sea"])
        provenance = sync.read(self.scenario / "water_regions.provenance.json")
        self.assertEqual(provenance["water_extracts"][0]["source_feature_count"], 1)
        self.assertEqual(provenance["water_extracts"][1]["source_feature_count"], 2)
        self.assertEqual(provenance["diagnostics"]["snapshot_feature_count"], 2)
        self.assertEqual(provenance["diagnostics"]["source_feature_count"], 3)
        before = self.bytes()
        sync.sync_tno_source_metadata(self.root, [addition], specs)
        self.assertEqual(self.bytes(), before)

    def test_world_bay_gulf_record_id_uses_its_official_mrgid_field(self):
        self.assertEqual(collect_marine_regions_source_record_ids(
            "world_bay_gulf", [{"properties": {"mrgid": 24238}}]), ["mrgid:24238"])

    def test_world_dataset_metadata_merges_by_layer_and_is_idempotent(self):
        addition = deepcopy(self.feature)
        addition["properties"].update(
            id="tno_world_bay_gulf", name="World Bay Gulf", label="World Bay Gulf",
            source_layer="world_bay_gulf", source_query="mrgid=24238",
            source_record_ids=["mrgid:24238"],
            source_standard="marine_regions_world_bay_gulf",
        )
        world_spec = {
            "id": "tno_world_bay_gulf", "name": "World Bay Gulf",
            "source_layer": "world_bay_gulf", "source_query": "mrgid=24238",
            "source_standard": "marine_regions_world_bay_gulf",
            "clip_open_ocean_ids": ("tno_indian_ocean",),
        }
        self.write("data/scenarios/tno_1962/water_regions.geojson",
                   {"features": [self.feature, addition]})
        existing_datasets = [
            {"source_layer": "seavox_v19", "dataset_name": "stale SeaVoX",
             "legacy_extension": {"keep": True}},
            {"source_layer": "iho", "dataset_name": "Existing IHO",
             "iho_extension": "keep"},
        ]
        provenance_relatives = ("derived/water_regions.provenance.json",
                                "water_regions.provenance.json")
        for relative in provenance_relatives:
            provenance = self.read(f"data/scenarios/tno_1962/{relative}")
            provenance["source_datasets"] = deepcopy(existing_datasets)
            self.write(f"data/scenarios/tno_1962/{relative}", provenance)

        sync.sync_tno_source_metadata(
            self.root, [addition], [self.spec, world_spec])
        for relative in provenance_relatives:
            datasets = self.read(f"data/scenarios/tno_1962/{relative}")["source_datasets"]
            by_layer = {row["source_layer"]: row for row in datasets}
            self.assertEqual(set(by_layer), {"seavox_v19", "iho", "world_bay_gulf"})
            self.assertEqual(by_layer["seavox_v19"]["dataset_name"], "stale SeaVoX")
            self.assertEqual(by_layer["seavox_v19"]["legacy_extension"], {"keep": True})
            self.assertEqual(by_layer["iho"]["dataset_name"], "Existing IHO")
            self.assertEqual(by_layer["iho"]["iho_extension"], "keep")
            world = by_layer["world_bay_gulf"]
            self.assertEqual(world["layer"], "MarineRegions:world_bay_gulf")
            self.assertEqual(world["endpoint"], sync.MARINE_REGIONS_DATASET_META[
                "world_bay_gulf"]["endpoint"])
            self.assertNotIn("version", world)
            self.assertNotIn("doi", world)
            extracts = self.read(f"data/scenarios/tno_1962/{relative}")["water_extracts"]
            world_extract = next(row for row in extracts if row["id"] == "tno_world_bay_gulf")
            self.assertEqual(world_extract["source_record_ids"], ["mrgid:24238"])

        # A stale row with the same layer identity is refreshed in place; custom
        # fields survive and the next run produces no byte changes.
        for relative in provenance_relatives:
            path = self.scenario / relative
            provenance = sync.read(path)
            world = next(row for row in provenance["source_datasets"]
                         if row["source_layer"] == "world_bay_gulf")
            world["dataset_name"] = "stale World Bay/Gulf"
            world["custom_extension"] = "retain"
            sync._write_changed(path, provenance)
        sync.sync_tno_source_metadata(self.root, [addition], [self.spec, world_spec])
        for relative in provenance_relatives:
            datasets = self.read(f"data/scenarios/tno_1962/{relative}")["source_datasets"]
            world_rows = [row for row in datasets if row.get("source_layer") == "world_bay_gulf"]
            self.assertEqual(len(world_rows), 1)
            self.assertEqual(world_rows[0]["dataset_name"], "Marine Regions World Bay/Gulf")
            self.assertEqual(world_rows[0]["custom_extension"], "retain")
        before = self.bytes()
        sync.sync_tno_source_metadata(self.root, [addition], [self.spec, world_spec])
        self.assertEqual(self.bytes(), before)

    def test_source_ledger_requires_existing_unique_registrations(self):
        self.write("data/source_ledger.json", [{"local_path": "data/unrelated.bin"}])
        before = self.bytes()
        with self.assertRaisesRegex(ValueError, "Expected one source ledger registration"):
            sync.sync_shared_source_metadata(self.root)
        self.assertEqual(self.bytes(), before)


if __name__ == "__main__":
    unittest.main()
