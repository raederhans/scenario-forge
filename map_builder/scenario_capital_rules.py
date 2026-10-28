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
    "GP": ("1159143181", "Basse-Terre", "巴斯特尔"),
    "HK": ("1159151629", "Hong Kong", "香港"),
    "JP": ("1159151609", "Tokyo", "东京"),
    "KZ": ("1159150965", "Astana", "阿斯塔纳"),
    "LK": ("1159149593", "Sri Jayawardenepura Kotte", "斯里贾亚瓦德纳普拉科特"),
    "MC": ("1159149077", "Monaco", "摩纳哥"),
    "MM": ("1159151179", "Naypyidaw", "内比都"),
    "MO": ("1159149085", "Macau", "澳门"),
    "NG": ("1159150799", "Abuja", "阿布贾"),
    "NL": ("1159151519", "Amsterdam", "阿姆斯特丹"),
    "PH": ("1159151525", "Manila", "马尼拉"),
    "PM": ("CITY::gn::3424934", "Saint-Pierre", "圣皮埃尔"),
    "SH": ("CITY::gn::3370903", "Jamestown", "詹姆斯敦"),
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
    "SIK": ("1159151531", "Dihua", "迪化"),
    "TAI": ("1159151567", "Taihoku", "台北"),
    "TAN": ("1159149621", "Kyzyl", "克孜勒"),
    "TIB": ("1159150879", "Lhasa", "拉萨"),
    "GF": ("1159150911", "Cayenne", "卡宴"),
    "GP": ("1159143181", "Basse-Terre", "巴斯特尔"),
    "MQ": ("1159140257", "Fort-de-France", "法兰西堡"),
    "RE": ("1159150179", "Saint-Denis", "圣但尼"),
    "YT": ("1159146067", "Dzaoudzi", "藻德济"),
}
# Capitals of the post-build HOI4 split overlay (data/scenario-rules/hoi4_split_overlay.json).
# Debug-oriented seats inside each split's current territory, not historical claims.
HOI4_SPLIT_CAPITALS = {
    "FRO": ("1159146943", "Tórshavn", "托尔斯港"),
    "DOD": ("1159142253", "Rhodes", "罗德岛"),
    "SML": ("CITY::gn::57289", "Hargeysa", "哈尔格萨"),
    "NFL": ("1159151071", "St. John's", "圣约翰斯"),
    "GOA": ("1159122667", "Panaji", "帕纳吉"),
    "MCO": ("1159149077", "Monaco", "摩纳哥"),
    "AND": ("1159149089", "Andorra la Vella", "安道尔城"),
    "LIE": ("1159146061", "Vaduz", "瓦杜兹"),
    "SMN": ("1159146051", "San Marino", "圣马力诺"),
    "DNZ": ("1159149707", "Gdańsk", "但泽"),
    "TGR": ("1159148063", "Tangier", "坦吉尔"),
    "SMR": ("CITY::gn::2528910", "Tétouan", "得土安"),
    "IFN": ("CITY::gn::2534515", "Sidi Ifni", "西迪伊夫尼"),
    "KWW": ("1159149797", "Fort Bayard", "广州湾"),
    "RHO": ("1159150573", "Harare", "索尔兹伯里"),
    "NRH": ("1159150571", "Lusaka", "卢萨卡"),
    "NYS": ("1159148499", "Zomba", "松巴"),
    "BAS": ("1159150831", "Maseru", "马塞卢"),
    "SWZ": ("1159149413", "Mbabane", "姆巴巴内"),
    "HKG": ("1159151629", "Hong Kong", "香港"),
    "BHO": ("1159144449", "Belize City", "伯利兹城"),
    "BGU": ("1159150585", "Georgetown", "乔治敦"),
    "BAH": ("1159150451", "Manama", "麦纳麦"),
    "QAT": ("1159149469", "Doha", "多哈"),
    "TRU": ("1159151497", "Dubai", "迪拜"),
    "MLT": ("1159151199", "Valletta", "瓦莱塔"),
    "CYP": ("1159151209", "Nicosia", "尼科西亚"),
    "JAM": ("1159150855", "Kingston", "金斯敦"),
    "TRI": ("1159149307", "Port of Spain", "西班牙港"),
    "BHM": ("1159151207", "Nassau", "拿骚"),
    "MUR": ("1159150443", "Port Louis", "路易港"),
    "FLK": ("1159151183", "Stanley", "斯坦利"),
    "BWA": ("1159151591", "Lagos", "拉各斯"),
    "GLD": ("1159151403", "Accra", "阿克拉"),
    "SIE": ("1159150625", "Freetown", "弗里敦"),
    "GAM": ("1159149997", "Banjul", "巴瑟斯特"),
    "BEA": ("1159151597", "Nairobi", "内罗毕"),
    "UGA": ("1159135399", "Entebbe", "恩德培"),
    "TGN": ("1159151305", "Dar es Salaam", "达累斯萨拉姆"),
    "ZAN": ("1159150789", "Zanzibar City", "桑给巴尔"),
    "HYD": ("1159151407", "Hyderabad", "海得拉巴"),
    "KSH": ("1159150001", "Srinagar", "斯利那加"),
    "MYR": ("1159150017", "Mysore", "迈索尔"),
    "TRV": ("1159150007", "Thiruvananthapuram", "特里凡得琅"),
    "SKM": ("1159130849", "Gangtok", "甘托克"),
    "STR": ("1159151627", "Singapore", "新加坡"),
    "SRW": ("1159149803", "Kuching", "古晋"),
    "NBO": ("1159148333", "Sandakan", "山打根"),
    "BRU": ("1159151083", "Bandar Seri Begawan", "斯里巴加湾市"),
    "AOF": ("1159151513", "Dakar", "达喀尔"),
    "TOG": ("1159150535", "Lomé", "洛美"),
    "FCM": ("1159151115", "Yaoundé", "雅温得"),
    "DJI": ("1159149869", "Djibouti", "吉布提"),
    "VIN": ("1159151251", "Hanoi", "河内"),
    "CPV": ("1159151205", "Praia", "普拉亚"),
    "PGU": ("1159150803", "Bissau", "比绍"),
    "STP": ("1159151195", "São Tomé", "圣多美"),
    "TMR": ("1159150577", "Dili", "帝力"),
    "MCU": ("1159149085", "Macau", "澳门"),
    "SUR": ("1159150597", "Paramaribo", "帕拉马里博"),
    "RUA": ("1159150427", "Bujumbura", "乌松布拉"),
    "ALK": ("1159150555", "Juneau", "朱诺"),
    "HAW": ("1159151221", "Honolulu", "檀香山"),
    "KWT": ("1159149913", "Dalian", "大连"),
    "UKR": ("1159151495", "Kyiv", "基辅"),
    "CRM": ("CITY::gn::693805", "Simferopol", "辛菲罗波尔"),
    "BLR": ("1159151149", "Minsk", "明斯克"),
    "TSC": ("1159150961", "Tbilisi", "第比利斯"),
    "GEO": ("1159150961", "Tbilisi", "第比利斯"),
    "ARM": ("1159151119", "Yerevan", "埃里温"),
    "AZR": ("1159151123", "Baku", "巴库"),
    "KAZ": ("1159150969", "Almaty", "阿拉木图"),
    "KYR": ("1159150813", "Bishkek", "伏龙芝"),
    "UZB": ("1159151501", "Tashkent", "塔什干"),
    "KKP": ("1159149341", "Nukus", "努库斯"),
    "TMS": ("1159150567", "Ashgabat", "阿什哈巴德"),
    "TAJ": ("1159150609", "Dushanbe", "斯大林纳巴德"),
    "TAT": ("1159150705", "Kazan", "喀山"),
    "BSH": ("1159150699", "Ufa", "乌法"),
    "CVS": ("1159146557", "Cheboksary", "切博克萨雷"),
    "MRE": ("1159137563", "Yoshkar-Ola", "约什卡尔奥拉"),
    "UDM": ("1159148141", "Izhevsk", "伊热夫斯克"),
    "MRD": ("1159137403", "Saransk", "萨兰斯克"),
    "KOM": ("1159146551", "Syktyvkar", "瑟克特夫卡尔"),
    "YAK": ("1159150745", "Yakutsk", "雅库茨克"),
    "BYA": ("1159149623", "Ulan-Ude", "乌兰乌德"),
    "KRL": ("1159149535", "Petrozavodsk", "彼得罗扎沃茨克"),
    "DAG": ("1159146589", "Makhachkala", "马哈奇卡拉"),
    "KAL": ("1159148145", "Elista", "埃利斯塔"),
    "KBA": ("1159149521", "Nalchik", "纳尔奇克"),
    "NOS": ("1159137065", "Vladikavkaz", "奥尔忠尼启则"),
    "CHE": ("1159149587", "Grozny", "格罗兹尼"),
    "BOM": ("1159151359", "Prague", "布拉格"),
    "ALB": ("1159151117", "Tirana", "地拉那"),
    "EHC": ("1159147045", "Tangshan", "唐山"),
    "HBC": ("1159151595", "Beijing", "北平"),
    "HNN": ("1159151369", "Changsha", "长沙"),
    "SIC": ("CITY::gn::1787816", "Ya'an", "雅安"),
    "KHM": ("1159150883", "Hotan", "和阗"),
    "NCP": ("1159151595", "Beijing", "北平"),
    "CNZ": ("1159147043", "Zhangjiakou", "张家口"),
    "JBZ": ("1159146991", "Datong", "大同"),
    "RGC": ("1159151385", "Nanjing", "南京"),
    "JCC": ("1159151367", "Wuhan", "汉口"),
    "JSC": ("1159151331", "Guangzhou", "广州"),
    'AUNS': ('CITY::ne::1159151623', 'Sydney', '悉尼'),
    'AUQL': ('CITY::ne::1159151169', 'Brisbane', '布里斯班'),
    'AUSA': ('CITY::ne::1159151165', 'Adelaide', '阿德莱德'),
    'AUTS': ('CITY::ne::1159151171', 'Hobart', '霍巴特'),
    'AUVI': ('CITY::ne::1159151565', 'Melbourne', '墨尔本'),
    'AUWA': ('CITY::ne::1159151475', 'Perth', '珀斯'),
    'ADN': ('CITY::ne::1159150595', 'Aden', '亚丁'),
    'SEY': ('CITY::ne::1159151191', 'Victoria', '维多利亚'),
    'SWA': ('CITY::ne::1159150785', 'Windhoek', '温得和克'),
    'PAP': ('CITY::ne::1159150663', 'Port Moresby', '莫尔兹比港'),
    'NGN': ('CITY::ne::1159149499', 'Rabaul', '拉包尔'),
    'SUM': ('CITY::ne::1159151307', 'Medan', '棉兰'),
    'BOR': ('CITY::ne::1159150841', 'Banjarmasin', '马辰'),
    'CEL': ('CITY::ne::1159150843', 'Makassar', '望加锡'),
    'LSI': ('CITY::ne::1159139831', 'Singaraja', '新加拉惹'),
    'MLK': ('CITY::ne::1159149745', 'Ambon', '安汶'),
    'WNG': ('CITY::ne::1159148503', 'Manokwari', '马诺夸里'),
    'ERI': ('CITY::ne::1159150873', 'Asmara', '阿斯马拉'),
    'SOM': ('CITY::ne::1159150715', 'Mogadishu', '摩加迪休'),
    'NEA': ('CITY::ne::1159139615', 'Pingliang', '平凉'),
    'GSG': ('CITY::ne::1159151321', 'Lanzhou', '兰州'),
    'CDX': ('CITY::ne::1159151533', 'Chengdu', '成都'),
    'CSZ': ('CITY::ne::1159149899', 'Mianyang', '绵阳'),
    'CYS': ('CITY::gn::1799194', "Guang'an", '广安'),
    'NWA': ('CITY::ne::1159151363', "Xi'an", '西安'),
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
        **HOI4_SPLIT_CAPITALS,
        "CHI": ("1159151385", "Nanjing", "南京"),
        "LUQ": ("1159151379", "Jinan", "济南"),
        "YUE": ("1159151331", "Guangzhou", "广州"),
        "CHU": ("1159151327", "Chongqing", "重庆"),
        "GMA": ("1159149769", "Wuwei", "武威"),
        "PRC": ("CITY::gn::1791706", "Wayaobu", "瓦窑堡"),
        "SIC": ("CITY::gn::1802171", "Kangding", "康定"),
    },
    "hoi4_1939": {
        **HOI4_CAPITALS,
        **HOI4_SPLIT_CAPITALS,
        "CHI": ("1159151327", "Chongqing", "重庆"),
        "SHX": ("CITY::gn::13512505", "Lishi", "离石"),
        "GXC": ("1159150821", "Guilin", "桂林"),
    },
    "tno_1962": TNO_CAPITALS,
}
NO_CAPITAL_TAGS = {
    "hoi4_1936": {"DMC", "CDE"},
    "hoi4_1939": {"JCJ", "THG"},
    "tno_1962": {"AFA", "RFA", "ATL", "AQ", "SPR"},
    # Neutral/uninhabited regions or administrations seated outside the mapped
    # territory have no in-territory civilian capital marker.
    "modern_world": {"AQ", "HM", "IO", "TF"},
}

# Non-capital historical names use the same stable identities as the capital
# rules. Keep these scenario-scoped: the base world layer is modern, and TNO
# has its own political naming policy. Evidence: docs/data/scenario-capitals.md.
HOI4_CITY_NAMES = {
    "1159151531": ("Dihua", "迪化"),
    "1159150965": ("Akmolinsk", "阿克莫林斯克"),
    "1159150969": ("Alma-Ata", "阿拉木图"),
    "1159151523": ("Keijō", "京城"),
}
REVIEWED_CITY_NAMES = {
    "hoi4_1936": {**HOI4_CITY_NAMES, "1159151595": ("Beiping", "北平")},
    "hoi4_1939": {**HOI4_CITY_NAMES, "1159151595": ("Beiping", "北平")},
    # Local TNO victory-point names, resolved against this project's ownership:
    # KOR is a Japanese residency, KAZ is independent, and Taipei is held by CHI.
    "tno_1962": {
        "1159151523": ("Keijō", "京城"),
        "1159150965": ("Akmola", "阿克莫拉"),
        "1159151567": ("Taipei", "台北"),
    },
}

# Small settlements absent from the population-filtered world layer. Coordinates
# are sourced, not territory centroids; see the evidence document.
ADDITIONAL_CAPITAL_CITIES = {
    'CITY::gn::1800675': {'id': 'CITY::gn::1800675', 'name': 'Mengyin', 'name_en': 'Mengyin', 'name_zh': '蒙阴', 'lon': 117.92639, 'lat': 35.70694, 'country_code': 'CN', 'population': 65889, 'base_tier': 'regional', 'capital_kind': 'admin_capital', 'source': 'geonames'},
    'CITY::gn::1794825': {'id': 'CITY::gn::1794825', 'name': 'Shizilu', 'name_en': 'Shizilu', 'name_zh': '十字路', 'lon': 118.82889, 'lat': 35.17111, 'country_code': 'CN', 'population': 86749, 'base_tier': 'regional', 'capital_kind': 'admin_capital', 'source': 'geonames'},

    "CITY::gn::3424934": {
        "id": "CITY::gn::3424934", "name": "Saint-Pierre", "name_en": "Saint-Pierre", "name_zh": "圣皮埃尔",
        "lon": -56.17730, "lat": 46.77914, "country_code": "PM", "population": 6200,
        "base_tier": "regional", "capital_kind": "country_capital", "source": "geonames",
    },
    "CITY::gn::3370903": {
        "id": "CITY::gn::3370903", "name": "Jamestown", "name_en": "Jamestown", "name_zh": "詹姆斯敦",
        "lon": -5.71816, "lat": -15.92488, "country_code": "SH", "population": 637,
        "base_tier": "regional", "capital_kind": "country_capital", "source": "geonames",
    },
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
    for ne_id, (en, zh) in REVIEWED_CITY_NAMES.get(scenario_id, {}).items():
        city_id = f"CITY::ne::{ne_id}"
        if city_id not in city_rows:
            if strict:
                raise ValueError(f"{scenario_id}: missing reviewed city {city_id}")
            continue
        cities[city_id] = {
            **cities.get(city_id, {}), "city_id": city_id, "stable_key": f"id::{city_id}",
            "display_name": {"en": en, "zh": zh},
        }
        # Existing hints for regional capitals must agree with their labels.
        for hint in hints.values():
            if hint.get("city_id") == city_id:
                hint["city_name"] = en
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
