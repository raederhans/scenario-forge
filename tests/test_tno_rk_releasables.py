import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_rk_districts_are_available_but_not_released():
    scenario = ROOT / "data/scenarios/tno_1962"
    countries = json.loads((scenario / "countries.json").read_text(encoding="utf-8"))["countries"]
    owners = json.loads((scenario / "owners.by_feature.json").read_text(encoding="utf-8"))["owners"]
    catalog = json.loads((ROOT / "data/releasables/tno_1962.internal.phase1.catalog.json").read_text(encoding="utf-8"))
    entries = {entry["tag"]: entry for entry in catalog["entries"]}
    source = json.loads((ROOT / "data/releasables/tno_1962.internal.phase1.source.json").read_text(encoding="utf-8"))
    definitions = {entry["tag"]: entry for entry in source["entries"]}
    for prefix, parent, count in (("UK", "RKU", 9), ("MS", "RKM", 9), ("KC", "RKK", 6)):
        assert countries[parent].get("entry_kind") != "scenario_container"
        assert countries[parent]["feature_count"] > 0
        for index in range(count):
            tag = f"{prefix}{index:02}"
            assert tag not in countries
            assert tag not in owners.values()
            entry = entries[tag]
            assert entry["parent_owner_tag"] == parent
            assert entry["color_hex"] == definitions[tag]["color_hex_override"]
            assert definitions[tag]["display_name_en"]
            assert definitions[tag]["display_name_zh"]
            assert entry["validation_status"] == "ok"
            assert entry["preset_source"]["feature_ids"]
            assert all(owners[fid] == parent for fid in entry["preset_source"]["feature_ids"])


def test_rk_capitals_use_the_restored_occupation_names():
    payload = json.loads((ROOT / "data/scenarios/tno_1962/city_overrides.json").read_text(encoding="utf-8"))
    for tag, city in (("RKU", "Kiew"), ("RKM", "Moskau"), ("RKK", "Tiflis")):
        assert payload["capital_city_hints"][tag]["city_name"] == city
    retired = {f"{prefix}{index:02}" for prefix, count in (("UK", 9), ("MS", 9), ("KC", 6))
               for index in range(count)}
    assert not retired.intersection(payload["capitals_by_tag"])
    assert not retired.intersection(payload["capital_city_hints"])
