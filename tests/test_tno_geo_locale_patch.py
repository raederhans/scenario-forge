from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tools.build_tno_1962_geo_locale_patch import build_patch


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_locale_fixture(locales_path: Path, raw_name: str, zh_name: str) -> None:
    _write_json(
        locales_path,
        {
            "geo": {
                raw_name: {
                    "en": raw_name,
                    "zh": zh_name,
                }
            }
        },
    )


class TnoGeoLocalePatchTest(unittest.TestCase):
    def test_reviewed_special_land_survives_rebuild_without_copying_placeholders(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir)
            island_id = "ATLISL_sicily_tunis_sicily"
            reviewed_name = {"en": "Sicilia", "zh": "西西里岛"}
            _write_json(scenario_dir / "runtime_topology.topo.json", {
                "objects": {
                    "political": {"geometries": []},
                    "scenario_atlantropa": {"geometries": [
                        {"properties": {"id": island_id, "name": "Sicily Rebuilt Island"}},
                        {"id": "ATLPRV_reviewed", "properties": {}},
                        {"properties": {"id": "ATLPRV_unreviewed", "name": "Boolean Weld 1"}},
                    ]},
                },
            })
            _write_json(scenario_dir / "owners.by_feature.json", {"owners": {}})
            _write_json(scenario_dir / "locales.json", {"geo": {}})
            _write_json(scenario_dir / "manual.json", {"geo": {
                island_id: reviewed_name,
                "ATLPRV_reviewed": reviewed_name,
                "ATLPRV_absent": reviewed_name,
                "Sicily Rebuilt Island": reviewed_name,
            }})
            payload = build_patch(
                scenario_id="tno_1962", scenario_dir=scenario_dir,
                locales_path=scenario_dir / "locales.json",
                manual_overrides_path=scenario_dir / "manual.json",
                reviewed_exceptions_path=scenario_dir / "missing.json",
                output_path=scenario_dir / "geo_locale_patch.json",
            )
            expected = {island_id: reviewed_name, "ATLPRV_reviewed": reviewed_name}
            self.assertEqual(payload["geo"], expected)
            for language in ("en", "zh"):
                variant = json.loads((scenario_dir / f"geo_locale_patch.{language}.json").read_text(encoding="utf-8"))
                self.assertEqual(variant["geo"], {key: {language: value[language]} for key, value in expected.items()})

    def test_reviewed_city_identity_survives_rebuild_without_political_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir)
            _write_json(scenario_dir / "runtime_topology.topo.json", {
                "objects": {"political": {"geometries": []}},
            })
            _write_json(scenario_dir / "owners.by_feature.json", {"owners": {}})
            _write_json(scenario_dir / "locales.json", {"geo": {}})
            city_key = "id::CITY::ne::1159150701"
            reviewed_name = {"en": "Sverdlovsk", "zh": "斯维尔德洛夫斯克"}
            _write_json(scenario_dir / "manual.json", {"geo": {
                city_key: reviewed_name,
                "Yekaterinburg": reviewed_name,
                "absent-region": reviewed_name,
            }})
            payload = build_patch(
                scenario_id="tno_1962", scenario_dir=scenario_dir,
                locales_path=scenario_dir / "locales.json",
                manual_overrides_path=scenario_dir / "manual.json",
                reviewed_exceptions_path=scenario_dir / "missing.json",
                output_path=scenario_dir / "geo_locale_patch.json",
            )
            self.assertEqual(payload["geo"], {city_key: reviewed_name})
            for language in ("en", "zh"):
                variant = json.loads((scenario_dir / f"geo_locale_patch.{language}.json").read_text(encoding="utf-8"))
                self.assertEqual(variant["geo"], {city_key: {language: reviewed_name[language]}})

    def test_checked_in_tno_china_toponym_fixes_stay_synced(self) -> None:
        root = Path(__file__).resolve().parents[1]
        locales = json.loads((root / "data" / "locales.json").read_text(encoding="utf-8"))["geo"]
        startup_locales = json.loads(
            (root / "data" / "scenarios" / "tno_1962" / "locales.startup.json").read_text(encoding="utf-8")
        )["geo"]
        patch = json.loads(
            (root / "data" / "scenarios" / "tno_1962" / "geo_locale_patch.json").read_text(encoding="utf-8")
        )["geo"]
        zh_patch = json.loads(
            (root / "data" / "scenarios" / "tno_1962" / "geo_locale_patch.zh.json").read_text(encoding="utf-8")
        )["geo"]

        expected = {
            "Antuxian": ("CN_CITY_17275852B10463544903813", "安图县"),
            "Huizhexian": ("CN_CITY_17275852B10474076998029", "会泽县"),
            "Linyi": ("CN_CITY_17275852B67564907021397", "临沂"),
            "Luohuoxian": ("CN_CITY_17275852B11052099771689", "炉霍县"),
            "Celexian": ("CN_CITY_17275852B11484115656970", "策勒县"),
            "Ledonglizuzizhixian": ("CN_CITY_17275852B50589627480209", "乐东黎族自治县"),
        }
        retained_ambiguous = {
            "Gongyanxian": ("CN_CITY_17275852B1257312703969", "公彦贤"),
            "Xixian": ("CN_CITY_17275852B18660143588191", "西贤"),
        }

        for english_name, (feature_id, zh_name) in expected.items():
            with self.subTest(english_name=english_name):
                self.assertEqual(locales[english_name]["zh"], zh_name)
                self.assertEqual(locales[f"id::{feature_id}"]["zh"], zh_name)
                self.assertEqual(startup_locales[english_name]["zh"], zh_name)
                self.assertEqual(patch[feature_id]["zh"], zh_name)
                self.assertEqual(zh_patch[feature_id]["zh"], zh_name)

        # These names are still ambiguous or malformed in TNO romanization, so this pass leaves them for manual review.
        for english_name, (feature_id, zh_name) in retained_ambiguous.items():
            with self.subTest(retained=english_name):
                self.assertEqual(locales[english_name]["zh"], zh_name)
                self.assertEqual(patch[feature_id]["zh"], zh_name)

    def test_checked_in_tno_france_germany_toponym_fixes_stay_synced(self) -> None:
        root = Path(__file__).resolve().parents[1]
        locales = json.loads((root / "data" / "locales.json").read_text(encoding="utf-8"))["geo"]
        startup_locales = json.loads(
            (root / "data" / "scenarios" / "tno_1962" / "locales.startup.json").read_text(encoding="utf-8")
        )["geo"]
        patch = json.loads(
            (root / "data" / "scenarios" / "tno_1962" / "geo_locale_patch.json").read_text(encoding="utf-8")
        )["geo"]
        zh_patch = json.loads(
            (root / "data" / "scenarios" / "tno_1962" / "geo_locale_patch.zh.json").read_text(encoding="utf-8")
        )["geo"]

        expected = {
            "Gap": ("FR_ARR_05002", "加普"),
            "Nice": ("FR_ARR_06002", "尼斯"),
            "Condom": ("FR_ARR_32002", "孔东"),
            "Tours": ("FR_ARR_37002", "图尔"),
            "Provins": ("FR_ARR_77003", "普罗万"),
            "Gorzów Wielkopolski": ("PL_POW_0861", "瓦尔特河畔兰茨贝格"),
            "Słupsk": ("PL_POW_2263", "施托尔普"),
            "Gusevsky District": ("RU_RAY_50074027B27880509956465", "贡宾嫩"),
            "Chernyakhovsky District": ("RU_RAY_50074027B90959697167325", "因斯特堡"),
        }

        for english_name, (feature_id, zh_name) in expected.items():
            with self.subTest(english_name=english_name):
                self.assertEqual(locales[english_name]["zh"], zh_name)
                self.assertEqual(locales[f"id::{feature_id}"]["zh"], zh_name)
                self.assertEqual(startup_locales[english_name]["zh"], zh_name)
                self.assertEqual(patch[feature_id]["zh"], zh_name)
                self.assertEqual(zh_patch[feature_id]["zh"], zh_name)

        context_specific = {
            "id::RU_RAY_50074027B93509676978918": ("Советский городской округ", "蒂尔西特"),
            "id::RU_RAY_50074027B78200612798540": ("Пионерский городской округ", "诺伊库伦"),
        }
        for locale_key, (english_name, zh_name) in context_specific.items():
            feature_id = locale_key.removeprefix("id::")
            with self.subTest(context_specific=feature_id):
                self.assertEqual(locales[locale_key]["zh"], zh_name)
                self.assertEqual(startup_locales[english_name]["zh"], zh_name)
                self.assertEqual(patch[feature_id]["zh"], zh_name)
                self.assertEqual(zh_patch[feature_id]["zh"], zh_name)

    def test_checked_in_tno_rest_of_europe_toponym_fixes_stay_synced(self) -> None:
        root = Path(__file__).resolve().parents[1]
        locales = json.loads((root / "data" / "locales.json").read_text(encoding="utf-8"))["geo"]
        startup_locales = json.loads(
            (root / "data" / "scenarios" / "tno_1962" / "locales.startup.json").read_text(encoding="utf-8")
        )["geo"]
        patch = json.loads(
            (root / "data" / "scenarios" / "tno_1962" / "geo_locale_patch.json").read_text(encoding="utf-8")
        )["geo"]
        zh_patch = json.loads(
            (root / "data" / "scenarios" / "tno_1962" / "geo_locale_patch.zh.json").read_text(encoding="utf-8")
        )["geo"]

        expected = {
            "Tovuz": ("AZE-1687", "托武兹"),
            "Masallı": ("AZE-1708", "马萨雷"),
            "Видин": ("BG311", "维丁"),
            "Ungheni": ("MDA-1623", "温盖尼"),
            "łaski": ("PL_POW_1003", "瓦斯克"),
            "Vaslui": ("RO216", "瓦斯卢伊"),
            "District of Bansks Bystrica": ("SK_ADM2_56367889B14109704827124", "班斯卡-比斯特里察"),
            "District of Nova Mesto nad Va*": ("SK_ADM2_56367889B79509103276820", "瓦赫河畔新梅斯托"),
            "District of Partizonske": ("SK_ADM2_56367889B98642751890096", "帕尔蒂赞斯凯"),
            "Bursa": ("TR411", "布尔萨"),
            "Turka": ("UA_RAY_74538382B48347776111848", "图尔卡"),
            "Liubeshiv": ("UA_RAY_74538382B51989583187875", "柳别希夫"),
        }

        for english_name, (feature_id, zh_name) in expected.items():
            with self.subTest(english_name=english_name):
                self.assertEqual(locales[english_name]["zh"], zh_name)
                self.assertEqual(locales[f"id::{feature_id}"]["zh"], zh_name)
                self.assertEqual(startup_locales[english_name]["zh"], zh_name)
                self.assertEqual(patch[feature_id]["zh"], zh_name)
                self.assertEqual(zh_patch[feature_id]["zh"], zh_name)

        variants = {
            "Bursa (TR)": "布尔萨",
            "District of Bansks Bystrica (SK)": "班斯卡-比斯特里察",
            "District of Bansks Bystrica [Banskobystrický kraj]": "班斯卡-比斯特里察",
        }
        for locale_key, zh_name in variants.items():
            with self.subTest(variant=locale_key):
                self.assertEqual(locales[locale_key]["zh"], zh_name)

    def test_build_patch_writes_locale_specific_variants(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            scenario_dir = tmp_path / "scenario"
            _write_json(
                scenario_dir / "runtime_topology.topo.json",
                {
                    "objects": {
                        "political": {
                            "geometries": [
                                {"id": "FEATURE-1", "properties": {"id": "FEATURE-1", "name": "Pool"}},
                            ]
                        }
                    }
                },
            )
            _write_json(
                scenario_dir / "owners.by_feature.json",
                {
                    "owners": {
                        "FEATURE-1": "AEF",
                    }
                },
            )
            locales_path = tmp_path / "locales.json"
            _write_locale_fixture(locales_path, "Pool", "普尔")
            output_path = scenario_dir / "geo_locale_patch.json"

            payload = build_patch(
                scenario_id="tno_1962",
                scenario_dir=scenario_dir,
                locales_path=locales_path,
                manual_overrides_path=scenario_dir / "missing.manual.json",
                reviewed_exceptions_path=scenario_dir / "missing.reviewed.json",
                output_path=output_path,
            )

            en_payload = json.loads((scenario_dir / "geo_locale_patch.en.json").read_text(encoding="utf-8"))
            zh_payload = json.loads((scenario_dir / "geo_locale_patch.zh.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["geo"]["FEATURE-1"], {"en": "Pool", "zh": "普尔"})
            self.assertEqual(en_payload["language"], "en")
            self.assertEqual(en_payload["geo"]["FEATURE-1"], {"en": "Pool"})
            self.assertEqual(zh_payload["language"], "zh")
            self.assertEqual(zh_payload["geo"]["FEATURE-1"], {"zh": "普尔"})

    def test_manual_override_replaces_data_not_available_feature_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            scenario_dir = tmp_path / "scenario"
            feature_id = "IN_ADM2_76128533B2782141712775"
            _write_json(
                scenario_dir / "runtime_topology.topo.json",
                {
                    "objects": {
                        "political": {
                            "geometries": [
                                {"id": feature_id, "properties": {"id": feature_id, "name": "DATA NOT AVAILABLE"}},
                            ]
                        }
                    }
                },
            )
            _write_json(
                scenario_dir / "owners.by_feature.json",
                {"owners": {feature_id: "RAJ"}},
            )
            _write_json(
                tmp_path / "locales.json",
                {"geo": {"DATA NOT AVAILABLE": {"en": "DATA NOT AVAILABLE", "zh": "数据不可用"}}},
            )
            manual_path = scenario_dir / "geo_name_overrides.manual.json"
            _write_json(
                manual_path,
                {
                    "version": 1,
                    "scenario_id": "tno_1962",
                    "geo": {
                        feature_id: {"en": "Northern Areas", "zh": "北部地区"},
                    },
                },
            )

            payload = build_patch(
                scenario_id="tno_1962",
                scenario_dir=scenario_dir,
                locales_path=tmp_path / "locales.json",
                manual_overrides_path=manual_path,
                reviewed_exceptions_path=scenario_dir / "missing.reviewed.json",
                output_path=scenario_dir / "geo_locale_patch.json",
            )

            en_payload = json.loads((scenario_dir / "geo_locale_patch.en.json").read_text(encoding="utf-8"))
            zh_payload = json.loads((scenario_dir / "geo_locale_patch.zh.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["geo"][feature_id], {"en": "Northern Areas", "zh": "北部地区"})
            self.assertEqual(en_payload["geo"][feature_id], {"en": "Northern Areas"})
            self.assertEqual(zh_payload["geo"][feature_id], {"zh": "北部地区"})
            self.assertEqual(payload["audit"]["manual_feature_overrides"], 1)

    def test_split_clone_duplicates_are_safe_copied(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            scenario_dir = tmp_path / "scenario"
            _write_json(
                scenario_dir / "runtime_topology.topo.json",
                {
                    "objects": {
                        "political": {
                            "geometries": [
                                {"id": "CG_ADM1_COG-3341__tno1962_1", "properties": {"id": "CG_ADM1_COG-3341__tno1962_1", "name": "Pool"}},
                                {"id": "CG_ADM1_COG-3341__tno1962_2", "properties": {"id": "CG_ADM1_COG-3341__tno1962_2", "name": "Pool"}},
                            ]
                        }
                    }
                },
            )
            _write_json(
                scenario_dir / "owners.by_feature.json",
                {
                    "owners": {
                        "CG_ADM1_COG-3341__tno1962_1": "AEF",
                        "CG_ADM1_COG-3341__tno1962_2": "AEF",
                    }
                },
            )
            locales_path = tmp_path / "locales.json"
            _write_locale_fixture(locales_path, "Pool", "普尔")

            payload = build_patch(
                scenario_id="tno_1962",
                scenario_dir=scenario_dir,
                locales_path=locales_path,
                manual_overrides_path=scenario_dir / "missing.manual.json",
                reviewed_exceptions_path=scenario_dir / "missing.reviewed.json",
                output_path=scenario_dir / "geo_locale_patch.json",
            )

            self.assertEqual(set(payload["geo"].keys()), {"CG_ADM1_COG-3341__tno1962_1", "CG_ADM1_COG-3341__tno1962_2"})
            self.assertEqual(payload["audit"]["split_clone_safe_copy_count"], 2)
            self.assertEqual(payload["audit"]["collision_candidate_count"], 0)
            self.assertEqual(payload["audit"]["duplicate_raw_name_count"], 1)
            self.assertEqual(payload["audit"]["ambiguous_raw_name_count"], 0)

    def test_cross_base_duplicates_remain_collisions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            scenario_dir = tmp_path / "scenario"
            _write_json(
                scenario_dir / "runtime_topology.topo.json",
                {
                    "objects": {
                        "political": {
                            "geometries": [
                                {"id": "CG_ADM1_COG-3341__tno1962_1", "properties": {"id": "CG_ADM1_COG-3341__tno1962_1", "name": "Pool"}},
                                {"id": "FR_ADM1_0001__tno1962_1", "properties": {"id": "FR_ADM1_0001__tno1962_1", "name": "Pool"}},
                            ]
                        }
                    }
                },
            )
            _write_json(
                scenario_dir / "owners.by_feature.json",
                {
                    "owners": {
                        "CG_ADM1_COG-3341__tno1962_1": "AEF",
                        "FR_ADM1_0001__tno1962_1": "FRA",
                    }
                },
            )
            locales_path = tmp_path / "locales.json"
            _write_locale_fixture(locales_path, "Pool", "普尔")

            payload = build_patch(
                scenario_id="tno_1962",
                scenario_dir=scenario_dir,
                locales_path=locales_path,
                manual_overrides_path=scenario_dir / "missing.manual.json",
                reviewed_exceptions_path=scenario_dir / "missing.reviewed.json",
                output_path=scenario_dir / "geo_locale_patch.json",
            )

            self.assertEqual(payload["geo"], {})
            self.assertEqual(payload["audit"]["collision_candidate_count"], 2)
            self.assertEqual(payload["audit"]["cross_base_collision_count"], 2)
            self.assertEqual(payload["audit"]["duplicate_raw_name_count"], 1)
            self.assertEqual(payload["audit"]["ambiguous_raw_name_count"], 1)
            sample = payload["audit"]["collision_candidates"][0]
            self.assertEqual(len(sample["matching_base_feature_ids"]), 2)

    def test_reviewed_collision_exceptions_are_tracked_but_do_not_remain_unresolved(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            scenario_dir = tmp_path / "scenario"
            _write_json(
                scenario_dir / "runtime_topology.topo.json",
                {
                    "objects": {
                        "political": {
                            "geometries": [
                                {"id": "F-1", "properties": {"id": "F-1", "name": "Pool"}},
                                {"id": "F-2", "properties": {"id": "F-2", "name": "Pool"}},
                            ]
                        }
                    }
                },
            )
            _write_json(
                scenario_dir / "owners.by_feature.json",
                {
                    "owners": {
                        "F-1": "AAA",
                        "F-2": "BBB",
                    }
                },
            )
            _write_locale_fixture(tmp_path / "locales.json", "Pool", "泳池")
            reviewed_path = scenario_dir / "geo_locale_reviewed_exceptions.json"
            _write_json(
                reviewed_path,
                {
                    "version": 1,
                    "scenario_id": "tno_1962",
                    "reviewed_collision_feature_ids": ["F-1", "F-2"],
                    "excluded_feature_prefixes": [],
                },
            )

            payload = build_patch(
                scenario_id="tno_1962",
                scenario_dir=scenario_dir,
                locales_path=tmp_path / "locales.json",
                manual_overrides_path=scenario_dir / "missing.manual.json",
                reviewed_exceptions_path=reviewed_path,
                output_path=scenario_dir / "geo_locale_patch.json",
            )

            self.assertEqual(payload["audit"]["collision_candidate_count"], 0)
            self.assertEqual(payload["audit"]["reviewed_collision_exception_count"], 2)
            self.assertEqual(len(payload["audit"]["reviewed_collision_candidates"]), 2)

    def test_excluded_feature_prefixes_skip_synthetic_features_from_locale_decision_surface(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            scenario_dir = tmp_path / "scenario"
            _write_json(
                scenario_dir / "runtime_topology.topo.json",
                {
                    "objects": {
                        "political": {
                            "geometries": [
                                {
                                    "id": "ATLSEA_FILL_demo_1",
                                    "properties": {"id": "ATLSEA_FILL_demo_1", "name": "Synthetic Sea Fill"},
                                },
                                {"id": "FEATURE-1", "properties": {"id": "FEATURE-1", "name": "Pool"}},
                            ]
                        }
                    }
                },
            )
            _write_json(
                scenario_dir / "owners.by_feature.json",
                {
                    "owners": {
                        "ATLSEA_FILL_demo_1": "ATL",
                        "FEATURE-1": "AAA",
                    }
                },
            )
            _write_locale_fixture(tmp_path / "locales.json", "Pool", "泳池")
            reviewed_path = scenario_dir / "geo_locale_reviewed_exceptions.json"
            _write_json(
                reviewed_path,
                {
                    "version": 1,
                    "scenario_id": "tno_1962",
                    "reviewed_collision_feature_ids": [],
                    "excluded_feature_prefixes": ["ATLSEA_FILL_"],
                },
            )

            payload = build_patch(
                scenario_id="tno_1962",
                scenario_dir=scenario_dir,
                locales_path=tmp_path / "locales.json",
                manual_overrides_path=scenario_dir / "missing.manual.json",
                reviewed_exceptions_path=reviewed_path,
                output_path=scenario_dir / "geo_locale_patch.json",
            )

            self.assertEqual(payload["geo"]["FEATURE-1"], {"en": "Pool", "zh": "泳池"})
            self.assertEqual(payload["audit"]["excluded_feature_count"], 1)
            self.assertEqual(payload["audit"]["omitted_feature_count"], 0)
            self.assertEqual(payload["audit"]["excluded_features"][0]["feature_id"], "ATLSEA_FILL_demo_1")

    def test_reviewed_exceptions_reject_mismatched_scenario_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            scenario_dir = tmp_path / "scenario"
            _write_json(
                scenario_dir / "runtime_topology.topo.json",
                {
                    "objects": {
                        "political": {
                            "geometries": [
                                {"id": "FEATURE-1", "properties": {"id": "FEATURE-1", "name": "Pool"}},
                            ]
                        }
                    }
                },
            )
            _write_json(
                scenario_dir / "owners.by_feature.json",
                {
                    "owners": {
                        "FEATURE-1": "AEF",
                    }
                },
            )
            _write_locale_fixture(tmp_path / "locales.json", "Pool", "泡池")
            reviewed_path = scenario_dir / "geo_locale_reviewed_exceptions.json"
            _write_json(
                reviewed_path,
                {
                    "version": 1,
                    "scenario_id": "other_scenario",
                    "reviewed_collision_feature_ids": [],
                    "excluded_feature_prefixes": [],
                },
            )

            with self.assertRaises(ValueError) as exc_info:
                build_patch(
                    scenario_id="tno_1962",
                    scenario_dir=scenario_dir,
                    locales_path=tmp_path / "locales.json",
                    manual_overrides_path=scenario_dir / "missing.manual.json",
                    reviewed_exceptions_path=reviewed_path,
                    output_path=scenario_dir / "geo_locale_patch.json",
                )

            self.assertIn("must target scenario `tno_1962`", str(exc_info.exception))


if __name__ == "__main__":
    unittest.main()
