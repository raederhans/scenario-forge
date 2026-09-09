from __future__ import annotations

import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


class TnoChinaPlaceNamesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.locales = read("data/locales.json")["geo"]
        cls.manual = read("data/i18n/manual_geo_overrides.json")
        cls.scenario_manual = read("data/scenarios/tno_1962/geo_name_overrides.manual.json")["geo"]
        cls.patches = [read("data/scenarios/tno_1962/" + name)["geo"] for name in (
            "geo_locale_patch.json", "geo_locale_patch.en.json", "geo_locale_patch.zh.json")]

    def test_historical_names_are_bilingual_and_do_not_replace_base_names(self):
        names = {
            "64529865795141": ("长春", "Hsinking", "新京"),
            "24114902469869": ("沈阳", "Mukden", "奉天"),
            "83272093468807": ("大连", "Dairen", "大連"),
            "15106805877311": ("丹东", "Antung", "安東"),
            "55723809295301": ("尚志", "Zhuhe", "珠河"),
            "13668088847896": ("靖宇县", "Mengjiang County", "濛江縣"),
            "34101037808925": ("辽源", "Xi'an", "西安"),
            "71134370106008": ("大庆", "Sartu", "薩爾圖"),
            "58561192252896": ("呼和浩特", "Houhehot", "厚和浩特"),
            "35052748065606": ("乌兰浩特", "Wangyehmiao", "王爺廟"),
            "42311251295370": ("黄骅", "Xinhai", "新海"),
            "66003162693266": ("张家口", "Kalgan", "張家口"),
        }
        for suffix, (base, en, zh) in names.items():
            feature_id = "CN_CITY_17275852B" + suffix
            with self.subTest(feature=feature_id):
                self.assertEqual(self.locales["id::" + feature_id]["zh"], base)
                self.assertEqual(self.scenario_manual[feature_id], {"en": en, "zh": zh})
                for patch in self.patches:
                    self.assertEqual(patch[feature_id], self.scenario_manual[feature_id])

    def test_same_pinyin_counties_are_corrected_by_identity(self):
        aliases = read("data/geo_aliases.json")["entries"]
        for raw_name, target_suffix, expected in (
            ("Anxixian", "38336781870813", "安西县"),
            ("Wuyuanxian", "4230864536687", "五原县"),
        ):
            target = "id::CN_CITY_17275852B" + target_suffix
            with self.subTest(name=raw_name):
                self.assertEqual(self.manual[target], expected)
                self.assertEqual(self.locales[target]["zh"], expected)
                others = [entry for entry in aliases if entry["primary_name"] == raw_name and entry["stable_key"] != target]
                self.assertTrue(others)
                for other in others:
                    # Some source polygons have no stable locale yet and still use the raw-name fallback.
                    effective = self.locales.get(other["stable_key"], self.locales[raw_name])
                    self.assertNotEqual(effective["zh"], expected)
                    self.assertNotEqual(self.manual.get(other["stable_key"]), expected)
        # The Manchurian Xi'an override must not rename the real Xi'an in Shaanxi.
        shaanxi = "CN_CITY_17275852B61934058685125"
        self.assertEqual(self.locales["id::" + shaanxi]["zh"], "西安")
        self.assertNotIn(shaanxi, self.scenario_manual)

    def test_machine_word_translations_are_fixed_in_source_startup_and_scenario(self):
        startup = read("data/scenarios/tno_1962/locales.startup.json")["geo"]
        cases = {
            "Heihe": ("85317988773277", "黑河", "黑河"),
            "Mishan": ("18460482115025", "密山", "密山"),
            "Pan": ("76401344363897", "磐石", "磐石"),
            "Jintan": ("11407259911678", "金坛", "金坛"),
            "Zalantun": ("65249545845720", "扎兰屯", "扎蘭屯"),
        }
        for raw_name, (suffix, base, flavor) in cases.items():
            feature_id = "CN_CITY_17275852B" + suffix
            with self.subTest(name=raw_name):
                self.assertEqual(self.manual["id::" + feature_id], base)
                self.assertEqual(self.locales[raw_name]["zh"], base)
                self.assertEqual(startup[raw_name]["zh"], base)
                for patch in self.patches:
                    self.assertEqual(patch[feature_id]["zh"], flavor)


if __name__ == "__main__":
    unittest.main()
