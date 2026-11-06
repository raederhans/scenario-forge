from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from tools import apply_modern_world_split_overlay as overlay
from tools import materialize_polar_scenarios as materialize


class ModernWorldOverlayTests(unittest.TestCase):
    def setUp(self):
        runtime = Path(__file__).resolve().parents[1] / ".runtime/tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        temp = TemporaryDirectory(dir=runtime)
        self.addCleanup(temp.cleanup)
        self.directory = Path(temp.name) / "modern_world"
        self.directory.mkdir()
        payloads = {
            "runtime_topology.topo.json": {"objects": {"political": {"geometries": [
                {"properties": {"id": fid, "cntr_code": "AA"}} for fid in ("a", "b")]}}},
            "owners.by_feature.json": {"owners": {"a": "AA", "b": "AA"}, "baseline_hash": "old"},
            "cores.by_feature.json": {"cores": {"a": ["AA"], "b": ["AA"]}, "baseline_hash": "old"},
            "countries.json": {"countries": {"AA": {"tag": "AA", "color_hex": "#123456",
                "source_type": "canonical_baseline", "source": "canonical_baseline",
                "quality": "direct_country_copy", "feature_count": 2}}},
            "manifest.json": {"default_country": "AA", "baseline_hash": "old", "summary": {
                "feature_count": 2, "quality_counts": {"direct_country_copy": 2},
                "source_counts": {"canonical_baseline": 2}}},
        }
        for name, payload in payloads.items():
            (self.directory / name).write_text(json.dumps(payload), encoding="utf-8")
        self.rules = {"version": 1, "entries": [{"id": "new", "scenarios": ["modern_world"],
            "tag": "NEW", "name_en": "New", "name_zh": "新", "parent_owner_tag": "AA",
            "select": {"feature_ids": ["a"]}, "cores": ["AA"]}]}
        self.repairs = self.enterContext(patch.object(materialize, "apply_safe_scenario_contract_repairs",
                                                     return_value=[]))
        self.enterContext(patch.object(materialize, "synchronize_scenario_snapshot"))

    def read(self, name):
        return json.loads((self.directory / name).read_text(encoding="utf-8"))

    def run_overlay(self, rules=None, **kwargs):
        return overlay.run_scenario(self.rules if rules is None else rules, self.directory,
                                    load_plans=lambda _: [], load_hierarchy=lambda _: ({}, {}), **kwargs)

    def test_assignments_counts_summary_and_idempotence(self):
        self.assertEqual(self.run_overlay()["changed_count"], 1)
        self.assertEqual(self.read("owners.by_feature.json")["owners"], {"a": "NEW", "b": "AA"})
        self.assertEqual(self.read("cores.by_feature.json")["cores"]["a"], ["AA"])
        countries = self.read("countries.json")["countries"]
        self.assertEqual(countries["NEW"]["source_type"], "scenario_extension")
        self.assertEqual(countries["NEW"]["feature_count"], 1)
        self.assertEqual(countries["AA"]["feature_count"], 1)
        manifest = self.read("manifest.json")
        self.assertEqual(manifest["summary"]["quality_counts"], {"direct_country_copy": 1, "manual_reviewed": 1})
        self.assertEqual(manifest["summary"]["source_counts"], {"canonical_baseline": 1, "manual_rule": 1})
        self.assertNotEqual(manifest["baseline_hash"], "old")
        self.assertEqual(manifest["baseline_hash"], self.read("cores.by_feature.json")["baseline_hash"])
        before = {p.name: p.read_bytes() for p in self.directory.iterdir()}
        self.assertEqual(self.run_overlay()["changed_count"], 0)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.directory.iterdir()})
        self.repairs.assert_called_once()

    def test_dry_run_writes_nothing(self):
        before = {p.name: p.read_bytes() for p in self.directory.iterdir()}
        self.assertEqual(self.run_overlay(dry_run=True)["changed_count"], 1)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.directory.iterdir()})
        self.repairs.assert_not_called()

    def test_supersedes(self):
        rules = deepcopy(self.rules)
        rules["entries"].insert(0, {**rules["entries"][0], "id": "old", "tag": "OLD"})
        rules["entries"][1]["supersedes"] = ["old"]
        self.assertEqual(len(self.run_overlay(rules)["entries"]), 1)
        self.assertNotIn("OLD", self.read("countries.json")["countries"])

    def test_canonical_summary_refresh(self):
        materialize.refresh_scenario(self.directory, {}, removed_ids=())
        summary = self.read("manifest.json")["summary"]
        self.assertEqual(summary["quality_counts"], {"direct_country_copy": 2})
        self.assertEqual(summary["source_counts"], {"canonical_baseline": 2})


class ModernBatchTwoIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[1]
        cls.directory = cls.root / 'data/scenarios/modern_world'
        cls.owners = json.loads((cls.directory/'owners.by_feature.json').read_text())['owners']
        cls.cores = json.loads((cls.directory/'cores.by_feature.json').read_text())['cores']
        cls.countries = json.loads((cls.directory/'countries.json').read_text())['countries']

    def test_owners_cores_and_autonomy(self):
        samples = {
            'CY000__SPLIT_NORTHERN_CYPRUS':('NCY','CY'),
            'CY000__SPLIT_REMAINDER':('CY','CY'),
            'GEO-3039__SPLIT_SOUTH_OSSETIA':('SOS','GE'),
            'GEO-3039__SPLIT_REMAINDER':('GE','GE'),
            'ISR-3056__SPLIT_GOLAN_HEIGHTS':('IL','SY'),
            'ISR-3056__SPLIT_REMAINDER':('IL','IL'),
            'SYR-137__SPLIT_KOBANI':('SDF','SY'),
            'SYR-137__SPLIT_DEIR_HAFIR_MASKANAH':('SDF','SY'),
            'SYR-137__SPLIT_ALEPPO_NEIGHBORHOODS':('SDF','SY'),
            'SYR-137__SPLIT_REMAINDER':('SY','SY'),
            'CD_ADM1_COD-1898__SPLIT_RUTSHURU_MASISI_GOMA':('M23','CD'),
            'CD_ADM1_COD-1894__SPLIT_KALEHE_BUKAVU_UVIRA':('M23','CD'),
            'CD_ADM1_COD-1894__SPLIT_REMAINDER':('CD','CD'),
            'MMR-3277__SPLIT_PANGSANG':('WAS','MM'),
            'MMR-3277__SPLIT_LAUKKAING':('KOK','MM'),
            'MMR-3277__SPLIT_REMAINDER':('MM','MM'),
            'MMR-3273__SPLIT_SITTWE':('MM','MM'),
            'MMR-3274__SPLIT_HAKHA':('MM','MM'),
            'MMR-3274__SPLIT_PALETWA':('ARK','MM'),
            'MMR-3274__SPLIT_FALAM':('CHR','MM'),
            'MMR-3296__SPLIT_MYITKYINA':('MM','MM'),
            'MMR-3296__SPLIT_REMAINDER':('KIO','MM'),
        }
        for fid,(owner,core) in samples.items():
            with self.subTest(feature=fid):
                self.assertEqual(self.owners[fid],owner)
                self.assertEqual(self.cores[fid],[core])
        for tag,parent in [('ACE','ID'),('ADJ','GE'),('NUN','CA')]:
            self.assertEqual(self.countries[tag]['presentation'],'parent_merged')
            self.assertEqual(self.countries[tag]['parent_owner_tag'],parent)
            self.assertEqual(self.countries[tag]['color_hex'],self.countries[parent]['color_hex'])
        for tag in ['NCY','SOS','WAS','KOK','M23']:
            self.assertFalse(self.countries[tag].get('parent_owner_tag'))
            self.assertNotEqual(self.countries[tag].get('presentation'),'parent_merged')

    def test_overlay_replay_has_no_assignments(self):
        rules = json.loads((self.root/'data/scenario-rules/modern_world.split_overlay.json').read_text())
        report = overlay.run_scenario(rules,dry_run=True)
        self.assertEqual(report['changed_count'],0)
        self.assertTrue(all(row['changed_count']==0 for row in report['entries']))
