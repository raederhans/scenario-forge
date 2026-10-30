from __future__ import annotations

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.json_source import read_json_source
from map_builder.scenario_family_palette import WIDE_FAMILIES, family_palette
from tools.check_scenario_contracts import write_json

SCENARIO_DIR = ROOT / "data/scenarios/tno_1962"
OVERLAY_PATH = ROOT / "data/scenario-rules/tno_1962.split_overlay.json"
PILOTS = (
    ("JTWN", "Taiwan Government-General", "台湾总督府", "JAP", "colony", "taiwan"),
    ("JHAW", "Hawaii Occupation Government", "夏威夷占领政府", "JAP", "colonial_government", "hawaii"),
    ("CRI", "Reichsgau Gotenland", "哥特兰帝国大区", "GER", "colonial_government", "gotengau"),
)


def D(tag, district_id, districts, owners):
    return sorted(fid for fid in districts["tags"][tag]["districts"][district_id]["feature_ids"]
                  if owners.get(fid) == tag)


def build_overlay(districts, owners, countries, existing_overlay):
    entries = list(existing_overlay["entries"])
    existing_ids = {entry["id"] for entry in entries}
    family_countries = {**countries, **{entry["tag"]: entry for entry in entries}}
    for tag, en, zh, parent, kind, district in PILOTS:
        entry_id = f"tno_{tag.lower()}"
        if entry_id in existing_ids:
            continue
        feature_ids = D(parent, district, districts, owners)
        if not feature_ids:
            raise ValueError(f"entry {entry_id}: empty district selection")
        color = family_palette(
            family_countries[parent]["color_hex"], 1,
            existing_colors=[country["color_hex"] for country in family_countries.values()
                             if country.get("parent_owner_tag") == parent],
            **WIDE_FAMILIES.get(parent, {}),
        )[0]
        entry = {"id": entry_id, "scenarios": ["tno_1962"], "tag": tag,
         "name_en": en, "name_zh": zh, "parent_owner_tag": parent,
         "subject_kind": kind, "cores": "keep", "only_from_owners": [parent],
         "select": {"feature_ids": feature_ids}, "color_hex": color}
        entries.append(entry)
        family_countries[tag] = entry
    return {**existing_overlay, "entries": entries}


def main():
    existing_overlay = read_json_source(OVERLAY_PATH)
    overlay = build_overlay(
        read_json_source(SCENARIO_DIR / "district_groups.manual.json"),
        read_json_source(SCENARIO_DIR / "owners.by_feature.json")["owners"],
        read_json_source(SCENARIO_DIR / "countries.json")["countries"],
        existing_overlay,
    )
    if overlay != existing_overlay:
        write_json(OVERLAY_PATH, overlay)
    print(json.dumps({e["tag"]: len(e["select"]["feature_ids"]) for e in overlay["entries"]}))


if __name__ == "__main__":
    main()
