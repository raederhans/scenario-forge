"""Reviewed capital identities, separate from population-based city selection.

Stable IDs identify real points in world_cities, including same-name cities.
Evidence and intentional gaps are recorded in docs/data/scenario-capitals.md.
These rules are defaults; explicit scenario mutations remain authoritative.
"""
from __future__ import annotations

import copy


# tag: (Natural Earth city ID, or full stable city ID, English label, Chinese label).
MODERN_CAPITALS = {
    "BI": ("1159146001", "Gitega", "基特加"),
    "BJ": ("1159150345", "Porto-Novo", "波多诺伏"),
    "CI": ("1159150999", "Yamoussoukro", "亚穆苏克罗"),
    "CL": ("1159151615", "Santiago", "圣地亚哥"),
    "HK": ("1159151629", "Hong Kong", "香港"),
    "JP": ("1159151609", "Tokyo", "东京"),
    "KZ": ("1159150965", "Astana", "阿斯塔纳"),
    "MC": ("1159149077", "Monaco", "摩纳哥"),
    "MM": ("1159151179", "Naypyidaw", "内比都"),
    "MO": ("1159149085", "Macau", "澳门"),
    "NG": ("1159150799", "Abuja", "阿布贾"),
    "NL": ("1159151519", "Amsterdam", "阿姆斯特丹"),
    "PH": ("1159151525", "Manila", "马尼拉"),
    "TW": ("1159151567", "Taipei", "台北"),
    "TZ": ("1159149731", "Dodoma", "多多马"),
    "ZA": ("1159150661", "Pretoria", "比勒陀利亚"),
}
HOI4_CAPITALS = {
    "AEF": ("1159150993", "Brazzaville", "布拉柴维尔"),
    "AST": ("1159151161", "Canberra", "堪培拉"),
    "BRA": ("1159151619", "Rio de Janeiro", "里约热内卢"),
    "CHL": MODERN_CAPITALS["CL"],
    "HOL": MODERN_CAPITALS["NL"],
    "JAP": MODERN_CAPITALS["JP"],
    "LIT": ("1159136375", "Kaunas", "考纳斯"),
    "MAN": ("1159151393", "Hsinking", "新京"),
    "MEN": ("1159147139", "Xilinhot", "锡林浩特"),
    "PHI": MODERN_CAPITALS["PH"],
    "SAF": MODERN_CAPITALS["ZA"],
    "TAI": ("1159151567", "Taihoku", "台北"),
    "TAN": ("1159149621", "Kyzyl", "克孜勒"),
    "TIB": ("1159150879", "Lhasa", "拉萨"),
    "GF": ("1159150911", "Cayenne", "卡宴"),
    "GP": ("1159143181", "Basse-Terre", "巴斯特尔"),
    "MQ": ("1159140257", "Fort-de-France", "法兰西堡"),
    "RE": ("1159150179", "Saint-Denis", "圣但尼"),
    "YT": ("1159146067", "Dzaoudzi", "藻德济"),
}
TNO_CAPITALS = {
    "ALT": ("1159149615", "Abakan", "阿巴坎"),
    "BKR": ("1159150775", "Perm", "彼尔姆"),
    "BOP": ("1159137605", "Ivdel", "伊夫杰利"),
    "BRY": ("1159149623", "Ulan-Ude", "乌兰乌德"),
    "BZ": ("1159144449", "Belize City", "伯利兹城"),
    "CAM": ("1159151127", "Phnom Penh", "金边"),
    "CHI": ("1159151385", "Nanjing", "南京"),
    "CHL": MODERN_CAPITALS["CL"],
    "CHT": ("1159150737", "Chita", "赤塔"),
    "FFR": ("1159151439", "Abidjan", "阿比让"),
    "GCE": ("CITY::gn::2635412", "Truro", "特鲁罗"),
    "GER": ("1159151529", "Germania", "日耳曼尼亚"),
    "GNG": ("1159151331", "Kōshū", "廣州"),
    "GOR": ("1159146557", "Cheboksary", "切博克萨雷"),
    "GUI": ("1159151325", "Guiyang", "贵阳"),
    "GY": ("1159150585", "Georgetown", "乔治敦"),
    "IRK": ("1159150731", "Irkutsk", "伊尔库茨克"),
    "JAP": ("1159151609", "Tōkyō", "东京"),
    "KAZ": ("1159150969", "Alma-Ata", "阿拉木图"),
    "KOM": ("1159146551", "Syktyvkar", "瑟克特夫卡尔"),
    "KRS": ("1159150733", "Krasnoyarsk", "克拉斯诺亚尔斯克"),
    "LAO": ("1159139147", "Luang Prabang", "琅勃拉邦"),
    "MAG": ("1159149559", "Magnitogorsk", "马格尼托哥尔斯克"),
    "MAN": ("1159151393", "Xinjing", "新京"),
    "MC": MODERN_CAPITALS["MC"],
    "NIE": ("1159149369", "Belfast", "贝尔法斯特"),
    "ONG": ("1159148101", "Onega", "奥涅加"),
    "ORN": ("1159149571", "Orenburg", "奥伦堡"),
    "ORS": ("1159146559", "Orsk", "奥尔斯克"),
    "OUR": ("1159146525", "Sterlitamak", "斯捷尔利塔马克"),
    "PHI": MODERN_CAPITALS["PH"],
    "PRM": ("CITY::scenario::cherdyn", "Cherdyn", "切尔登"),
    "RGC": ("1159151533", "Chengdu", "成都"),
    "RKO": ("1159150811", "Riga", "里加"),
    "RKP": ("1159149709", "Krakau", "克拉科夫"),
    "SBA": ("1159146637", "Kansk", "坎斯克"),
    "SCO": ("1159146365", "Edinburgh", "爱丁堡"),
    "SVR": ("1159150701", "Sverdlovsk", "斯维尔德洛夫斯克"),
    "TAN": ("1159149621", "Kyzyl", "克孜勒"),
    "TIB": ("1159150879", "Lhasa", "拉萨"),
    "TOM": ("1159146491", "Kolpashevo", "科尔帕舍沃"),
    "URA": ("1159146569", "Khanty-Mansiysk", "汉特-曼西斯克"),
    "VIN": ("1159147549", "Huế", "顺化"),
    "VOK": ("1159149563", "Vorkuta", "沃尔库塔"),
    "VOL": ("1159148095", "Velsk", "韦利斯克"),
    "VYT": ("1159148141", "Izhevsk", "伊热夫斯克"),
    "WRS": ("1159146517", "Severodvinsk", "北德文斯克"),
    "XIK": ("CITY::gn::1810604", "Litang", "理塘"),
    "XIN": ("1159151531", "Dihua", "迪化"),
    "YAK": ("1159150745", "Yakutsk", "雅库茨克"),
    # Current-border fallback: Zlatoust is held by SVR and former fallback Kungur by BKR.
    # Chusovoy is within ZLT; this does not assert a historical ZLT capital.
    "ZLT": ("1159139121", "Chusovoy", "丘索沃伊"),
}
REVIEWED_CAPITALS = {
    "blank_base": MODERN_CAPITALS,
    "modern_world": MODERN_CAPITALS,
    "hoi4_1936": {
        **HOI4_CAPITALS,
        "CHI": ("1159151385", "Nanjing", "南京"),
        "LUQ": ("1159151379", "Jinan", "济南"),
        "YUE": ("1159151331", "Guangzhou", "广州"),
    },
    "hoi4_1939": {**HOI4_CAPITALS, "CHI": ("1159151327", "Chongqing", "重庆")},
    "tno_1962": TNO_CAPITALS,
}
NO_CAPITAL_TAGS = {"tno_1962": {"AFA", "RFA", "ATL", "AQ", "SPR"}}

# Small settlements absent from the population-filtered world layer. Coordinates
# are sourced, not territory centroids; see the evidence document.
ADDITIONAL_CAPITAL_CITIES = {
    "CITY::scenario::cherdyn": {
        "id": "CITY::scenario::cherdyn", "name": "Cherdyn", "name_en": "Cherdyn", "name_zh": "切尔登",
        "lon": 56.516667, "lat": 60.4, "country_code": "RU", "population": 0,
        "base_tier": "regional", "capital_kind": "admin_capital", "source": "reviewed_settlement",
    },
    "CITY::gn::1810604": {
        "id": "CITY::gn::1810604", "name": "Litang", "name_en": "Litang", "name_zh": "理塘",
        "lon": 100.269403, "lat": 29.988143, "country_code": "CN", "population": 0,
        "base_tier": "regional", "capital_kind": "admin_capital", "source": "geonames",
    },
}


def apply_reviewed_capitals(payload, countries, city_rows, *, scenario_id, strict=False):
    """Apply only reviewed defaults, preserving unrelated city edits and metadata.

    The build can operate on a partial city fixture; the repair CLI uses strict
    mode so a missing real city fails before any artifacts are written.
    """
    result = copy.deepcopy(payload)
    capitals = result.setdefault("capitals_by_tag", {})
    hints = result.setdefault("capital_city_hints", {})
    cities = result.setdefault("cities", {})
    applied = set()
    for tag, (ne_id, en, zh) in REVIEWED_CAPITALS.get(scenario_id, {}).items():
        if tag not in countries:
            continue
        city_id = ne_id if ne_id.startswith("CITY::") else f"CITY::ne::{ne_id}"
        city = city_rows.get(city_id) or ADDITIONAL_CAPITAL_CITIES.get(city_id)
        if city is None:
            if strict:
                raise ValueError(f"{scenario_id}/{tag}: missing reviewed city {city_id}")
            continue
        country = countries[tag]
        hint = {key: copy.deepcopy(city.get(key)) for key in (
            "country_code", "host_feature_id", "urban_match_id", "lon", "lat",
            "population", "base_tier", "source",
        )}
        hint.update({
            "tag": tag, "city_id": city_id, "stable_key": f"id::{city_id}",
            "city_name": en, "name_ascii": city.get("name_ascii", en),
            "display_name": country.get("display_name", tag),
            "lookup_iso2": country.get("lookup_iso2", ""),
            "base_iso2": country.get("base_iso2", ""),
            "capital_state_id": country.get("capital_state_id"),
            "capital_kind": "country_capital", "resolution_method": "reviewed_capital",
            "confidence": "high", "candidate_count": 1,
        })
        if scenario_id == "tno_1962" and tag == "ZLT":
            hint["selection_note"] = "Current-border fallback: Zlatoust belongs to SVR and Kungur to BKR."
        capitals[tag] = city_id
        hints[tag] = hint
        cities[city_id] = {
            **cities.get(city_id, {}), "city_id": city_id, "stable_key": f"id::{city_id}",
            "display_name": {"en": en, "zh": zh},
        }
        if city_id not in city_rows:
            cities[city_id].update({**city, "city_id": city_id, "add_city": True})
        applied.add(tag)
    for tag in NO_CAPITAL_TAGS.get(scenario_id, set()):
        if tag in countries:
            capitals.pop(tag, None)
            hints[tag] = {"tag": tag, "city_id": "", "resolution_method": "no_capital"}
            applied.add(tag)
    # Existing diagnostics must not continue to report repaired entries as missing.
    audit = result.setdefault("audit", {})
    for list_key, count_key in (
        ("unresolved_capitals", "unresolved_capital_count"),
        ("unresolved_manual_capitals", "unresolved_manual_capital_count"),
        ("featured_runtime_missing_tags", "featured_runtime_missing_count"),
        ("default_capital_missing_tags", "default_capital_missing_tag_count"),
        ("default_featured_runtime_missing_tags", "default_featured_runtime_missing_count"),
        ("default_rejected_candidates", "default_rejected_candidate_count"),
    ):
        if list_key in audit:
            audit[list_key] = [e for e in audit[list_key] if (e.get("tag") if isinstance(e, dict) else e) not in applied]
            audit[count_key] = len(audit[list_key])
    for key, value in (("manual_capital_count", len(capitals)), ("capital_hint_count", len(hints)),
                       ("default_capital_entry_count", len(capitals))):
        if key in audit:
            audit[key] = value
    return result
