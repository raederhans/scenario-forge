from __future__ import annotations

import argparse
from collections import defaultdict
import gzip
import json
import os
from pathlib import Path
import sys

import numpy as np
import shapely
from pyproj import Geod
from shapely.affinity import affine_transform, scale
from shapely.geometry import mapping

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from map_builder.regional_geometry import _absolute_topology, _decode_geometry
from tools.apply_hoi4_geometry_splits import area_km2, validate_partition_plan
from tools.build_hoi4_water_shape_splits import code, polygons
from tools.rebuild_polar_assets import read

DATA = ROOT / "data"
ASSETS = ROOT / "apps/hgo/assets"
PREFIX = DATA / "scenario-rules/hoi4_hgo_hotspots"
GEOD = Geod(ellps="WGS84")

# These desert controls cluster on settled margins. Preserve the native grid scale inland.
TRANSLATION_ONLY = {"western_desert", "fezzan", "spanish_sahara_frontier", "iraq_neutral_zones"}

# Geographically identified out-of-region candidates would stretch the fallback extent.
OUTSIDE_REGION = {
    "western_desert": {3869},  # Giza
    "fezzan": {6898},  # The Im Anguel footprint extends west to central Algeria.
    "spanish_sahara_frontier": {1633, 6025},  # Southern Spanish Sahara and Adrar
    "syrian_jazira": {1886, 2049, 3297, 3568, 5677, 6984},  # Hama, Mardin and Iraq
    "maan_aqaba_hejaz": {3350, 6963, 6964, 6965, 8083, 9033},  # Rutba, Arar and Medina
    "iraq_neutral_zones": {3273, 3356},  # Kuwait
    "iranian_azerbaijan": {1079, 7040, 7121, 9865},  # Şırnak, Zangilan, Ağrı and Soran
    "buraimi_abu_dhabi": {5613, 5614, 6649},  # Oman and Saudi Arabia
    "bosnia_drina": {810, 1311, 3460, 3652, 4980, 7343, 7345, 7346, 7622, 7623},
    "lapland_arctic": {2777, 2781, 2930, 2935, 3848, 4912},  # Kola, Nordland and the southern counties
    "cilicia": {11854, 11859},  # Ermenek and Kadirli
    "friuli": {1229, 5940},  # East Tyrol and the Gulf of Trieste
    "burgenland_sopron": {7946, 10534},  # Pápa and Rusovce
    "backa_baranja_srem": {5369, 7620, 7992},  # Slatina, Taraš and Szolnok
    "upper_hungary_ruthenia": {2495, 4823, 7984},  # Chop, Eger and Gyöngyös
    "grodno_bialystok_polesie": {4836},  # Zamość
    "kars_ardahan": {2033, 2034, 3400, 7103, 7122, 7123, 7127},  # Adjara, Rize, Ağrı and Muş
    "mosul_vilayet": {1376, 3347, 5895, 5896, 6980, 6981, 9028, 9862},  # Anbar and central Iraq
    "sandzak": {3649, 8438, 8439},  # Požega and Kosovo
    "negev_sinai": {1205, 2305, 3376, 3386, 3405},  # Jerusalem, Gaza and the West Bank
    "south_tyrol_trentino": {4802, 7538, 7539, 7540, 7542, 7543, 7544, 7545, 7546, 7547},  # Ötztal and Veneto
    "carinthia": {1229, 4150, 4115, 4152, 5952, 8407},  # East Tyrol and Styria
}

# HGO label anchors for towns and the two provincial seats. Merano has two
# different HGO labels for the same town, so neither is a registration control.
STATE_CITY_CONTROLS = {
    "western_desert": {451: "Derna", 6365: "Siwa", 6954: "Sallum"},
    "fezzan": {6924: "Sinawin", 6919: "Wazin"},
    "spanish_sahara_frontier": {7898: "Assa", 6910: "Figuig"},
    "syrian_jazira": {350: "Siverek", 5693: "Tall Tamr", 5696: "Al-Bab", 6983: "Hajin", 5705: "Urfa"},
    "maan_aqaba_hejaz": {5670: "Shobak", 5674: "Umm El-Jimaal", 5882: "Tayma", 9241: "Duba", 1177: "Haql"},
    "iraq_neutral_zones": {1373: "Basra", 6962: "Rafha", 6965: "Arar", 3358: "Rawdat Habbas", 4994: "Shafi"},
    "iranian_azerbaijan": {419: "Tabriz", 2179: "Maku", 4986: "Khoy", 5898: "Oshnavieh", 5708: "Gevas"},
    "buraimi_abu_dhabi": {3389: "Abu Dhabi", 3390: "Al Ain", 5615: "Al Wagan", 5795: "Asab"},
    "bosnia_drina": {2175: "Drvar", 2787: "Novi Grad", 5150: "Bijeljina", 5151: "Stolac", 7364: "Livno"},
    "lapland_arctic": {1102: "Kittila", 2779: "Vuotso", 2927: "Haparanda", 4903: "Ajos", 4909: "Pajala",
                       4910: "Lulea", 2946: "Vardo", 8026: "Tana", 8027: "Olderdalen"},
    "cilicia": {344: "Adana", 345: "Tarsus", 5166: "Kozan", 7143: "Elbistan", 7183: "Silifke", 11855: "Mut"},
    "friuli": {1309: "Tarvisio", 5942: "Valbruna", 5943: "Dogna", 7548: "Marano Lagunare",
               7549: "Pocenia", 2284: "Gorizia"},
    "burgenland_sopron": {793: "Oberwart", 2471: "Sopron", 4819: "Eisenstadt", 4820: "Fertod",
                          7400: "Abda", 7948: "Tet", 7949: "Vasvar"},
    "sandzak": {1801: "Novi Pazar", 3641: "Andrijevica", 7628: "Konjuhe", 7630: "Petnjica"},
    "alsace_lorraine": {2059: "Metz", 2061: "Thionville", 5359: "Strasbourg",
                        5360: "Haguenau", 5573: "Colmar", 5587: "Hayange"},
    "south_tyrol_trentino": {39: "Bolzano", 975: "Trento", 7533: "Rovereto"},
    "backa_baranja_srem": {818: "Osijek", 2207: "Baja", 3201: "Vinkovci", 5040: "Vukovar",
                           7377: "Sremska Mitrovica", 7382: "Becej", 7384: "Sombor", 7991: "Kecskemet"},
    "upper_hungary_ruthenia": {4824: "Nyiregyhaza", 7396: "Galanta",
                               7983: "Miskolc", 7994: "Mezokovesd", 8004: "Levice"},
    "latgale": {3542: "Daugavpils", 4847: "Jekabpils", 5789: "Rezekne"},
    "grodno_bialystok_polesie": {92: "Lublin", 95: "Nowogrodek", 97: "Bialystok",
                                 2227: "Pinsk", 4841: "Slonim", 5559: "Lukow"},
    "kars_ardahan": {353: "Pasinler", 1139: "Ardahan", 3398: "Erzurum", 4982: "Horasan",
                     7101: "Artvin", 7102: "Hopa", 7111: "Oltu", 7112: "Kars", 7114: "Kagizman"},
    "mosul_vilayet": {676: "Mosul", 1362: "Arbil", 1363: "Kirkuk", 4989: "Soran", 6985: "Tal Afar"},
    "ulster_border": {1827: "Donegal", 1828: "Belfast", 4970: "Sligo"},
    "southern_bukovina": {5344: "Suceava", 5537: "Roznov", 5538: "Ceahlau", 5539: "Varatec"},
    "negev_sinai": {6795: "Rafah", 454: "Dimona", 453: "Nekhel", 6796: "Ezuz",
                    6797: "Yeruham", 6798: "Tlalim", 6936: "Bir Al-Abed"},
}

# Small town seats absent from the world city index, in longitude/latitude order.
LOCAL_SEATS = {
    "western_desert": {"Sallum": (25.16, 31.55)},
    "fezzan": {"Sinawin": (10.60, 31.02), "Wazin": (10.66, 31.95)},
    "spanish_sahara_frontier": {"Assa": (-9.43, 28.61), "Figuig": (-1.23, 32.11)},
    "syrian_jazira": {"Tall Tamr": (40.37, 36.66), "Hajin": (40.83, 34.69)},
    "maan_aqaba_hejaz": {"Umm El-Jimaal": (36.37, 32.33), "Haql": (34.95, 29.29),
                         "Shobak": (35.56, 30.52), "Tayma": (38.55, 27.63), "Duba": (35.69, 27.35)},
    "iraq_neutral_zones": {"Rawdat Habbas": (44.34, 29.64), "Shafi": (47.62, 30.90)},
    "iranian_azerbaijan": {"Maku": (44.52, 39.29), "Khoy": (44.95, 38.55), "Oshnavieh": (45.10, 37.04),
                           "Gevas": (43.11, 38.30)},
    "buraimi_abu_dhabi": {"Al Wagan": (55.42, 23.61), "Asab": (54.30, 23.29)},
    "bosnia_drina": {"Drvar": (16.38, 44.37), "Novi Grad": (16.38, 45.05), "Stolac": (17.96, 43.08),
                     "Livno": (17.01, 43.83), "Bijeljina": (19.22, 44.76)},
    "lapland_arctic": {"Kittila": (24.91, 67.65), "Lulea": (22.15, 65.58), "Ajos": (24.52, 65.67),
                       "Vuotso": (27.12, 68.09), "Pajala": (23.37, 67.21), "Tana": (28.19, 70.20),
                       "Vardo": (31.10, 70.37), "Olderdalen": (20.53, 69.60)},
    "friuli": {"Tarvisio": (13.58, 46.51), "Valbruna": (13.49, 46.49), "Dogna": (13.32, 46.45),
               "Marano Lagunare": (13.17, 45.76), "Pocenia": (13.10, 45.84),
               "Cividale del Friuli": (13.43, 46.09), "Manzano": (13.38, 45.99),
               "San Giorgio di Nogaro": (13.21, 45.83), "Osoppo": (13.08, 46.26), "Pulfero": (13.48, 46.17)},
    "burgenland_sopron": {"Oberwart": (16.20, 47.29), "Fertod": (16.87, 47.62), "Abda": (17.54, 47.69),
                          "Tet": (17.52, 47.52), "Vasvar": (16.80, 47.05), "Güssing": (16.32, 47.06),
                          "Loipersbach im Burgenland": (16.48, 47.695)},
    "mosul_vilayet": {"Hawija": (43.77, 35.33), "Rabia": (42.10, 36.81)},
    "upper_hungary_ruthenia": {"Encs": (21.12, 48.33), "Želiezovce": (18.65, 48.05)},
    "latgale": {"Līvāni": (26.18, 56.35), "Subate": (25.91, 56.00), "Viļāni": (26.92, 56.55)},
    "grodno_bialystok_polesie": {"Brańsk": (22.84, 52.74), "Ciechanowiec": (22.50, 52.68)},
    "kars_ardahan": {"Garnarrich": (43.62, 41.07), "Meghrashat": (43.66, 40.95)},
    "sandzak": {"Berane": (19.86, 42.84), "Andrijevica": (19.79, 42.74), "Konjuhe": (19.74, 42.69),
                "Petnjica": (19.96, 42.91), "Raška": (20.62, 43.29), "Ušće": (20.61, 43.47),
                "Jošanička Banja": (20.75, 43.39)},
    "southern_bukovina": {"Roznov": (26.51, 46.84), "Ceahlau": (25.97, 47.05), "Varatec": (26.28, 47.14)},
    "negev_sinai": {"Dimona": (35.033, 31.071), "Mitzpe Ramon": (34.80, 30.61), "Nitzana": (34.42, 30.89),
                    "Nekhel": (33.75, 29.91), "Ezuz": (34.47, 30.79), "Yeruham": (34.93, 30.99),
                    "Tlalim": (34.77, 30.99), "Bir Al-Abed": (33.01, 31.02)},
}

# Name corrections from the regional review: (parent, suffix) -> (English, Chinese).
NAME_FIXES = {
    ('LBY-2987', 'DERNA'): ('Tobruk', '托卜鲁克'),
    ('LBY-2965', 'remainder'): ('Kufrah', '库夫拉'),
    ('MR_ADM1_MRT-2783', 'BIR_MOGHREIN'): ('Bir Moghrein', '比尔莫格兰'),
    ('MR_ADM1_MRT-2783', 'EAST_BIN_MOHGREIN'): ('East Bir Moghrein', '东比尔莫格兰'),
    ('MR_ADM1_MRT-2783', 'remainder'): ('Fort Trinquet', '特兰凯堡'),
    ('DZA-2150', 'SOUTHWEST_TINDOUF'): ('Tindouf', '廷杜夫'),
    ('DZA-2150', 'TINDOUF'): ('Northeast Tindouf', '东北廷杜夫'),
    ('DZA-2150', 'WEST_TINDOUF'): ('West Tindouf', '西廷杜夫'),
    ('DZA-2150', 'remainder'): ('East Tindouf', '东廷杜夫'),
    ('IRQ-3223', 'remainder'): ('Al Hajara', '哈贾拉'),
    ('IRN-3237', 'MAKU'): ('Maku', '马库'),
    ('SE332', 'LANNAVAARA'): ('Lannavaara', '兰纳瓦拉'),
    ('ARE-349', 'REMAH'): ('Remah', '里马'),
    ('LV005', 'BALVI'): ('Viļaka', '维利亚卡'),
    ('RS123', 'SYRMIA'): ('Titel', '蒂特尔'),
    ('RS123', 'KULA'): ('Bač', '巴奇'),
    ('RS127', 'KUSMIN'): ('Kuzmin', '库兹明'),
    ('ITH42', 'FRIULI'): ('Codroipo', '科德罗伊波'),
    ('ITH42', 'NORTH_GORIZIA'): ('Cividale del Friuli', '奇维达莱德尔弗留利'),
    ('ITH42', 'VKENTZI'): ('Cave del Predil', '卡韦德尔普雷迪尔'),
    ('ITH41', 'remainder'): ('Maniago', '马尼亚戈'),
    ('TRA11', 'HORASAN'): ('Narman', '纳尔曼'),
    ('GEO-3038', 'SAMTSKHE'): ('Borjomi', '博尔若米'),
    ('GB_NUTS1_UKN', 'ARMAGH'): ('Armagh', '阿马'),
    ('GB_NUTS1_UKN', 'NORTHERN_IRELAND'): ('Londonderry-Tyrone', '伦敦德里-蒂龙'),
    ('IE041', 'MANORHAMILTON'): ('Carrick-on-Shannon', '香农河畔卡里克'),
    ('EGY-1558', 'HASNA'): ('Al Kuntillah', '昆提拉'),
    ('EGY-1558', 'SOUTH_ARISH'): ('Al Hasana', '哈萨纳'),
    ('EGY-1558', 'WEST_RAFAH'): ('East Arish', '东阿里什'),
    ('ISR-3053', 'LAHAV'): ('Kiryat Gat', '基里亚特加特'),
    ('IRQ-3051', 'MOSUL'): ('Mosul', '摩苏尔'),
    ('IRQ-3051', 'SHAYKHAN'): ('Fishkhabur', '菲什哈布尔'),
    ('IRQ-3051', 'BARDARASH'): ('Zummar', '祖马尔'),
    ('IRQ-3051', 'HATRA'): ('Hatra', '哈特拉'),
    ('IRQ-3050', 'SHAQLAWA'): ('Barzan', '巴尔赞'),
    ('IRQ-3050', 'SOUTH_SHAQLAWA'): ('Shaqlawa', '沙克拉瓦'),
    ('PL_POW_0601', 'WEST_CHELM'): ('Biala Podlaska', '比亚瓦波德拉斯卡'),
    ('PL_POW_0601', 'EAST_OKUNINKA'): ('Terespol', '泰雷斯波尔'),
    ('SK_ADM2_56367889B15407569919112', 'SURANY'): ('Tekovské Lužany', '泰科夫斯凯卢扎尼'),
    ('HU323', 'CIGAND'): ('Kemecse', '凯梅切'),
    ('SK_ADM2_56367889B4918056975771', 'GALANTA'): ('Selice', '塞利采'),
}

# Exclude state footprints that spill across a border into the neighbouring parent.
OUTSIDE_PARENT = {
    "western_desert": {
        "LBY-2987": {3434, 3882, 6364, 6931, 6932, 6953, 6954},
        "EGY-1540": {860, 6052, 6066, 6067},
        "LBY-2983": {856, 6052, 6054},
        "LBY-2965": {6052},
    },
    "fezzan": {
        "LBY-2882": {6379, 8126, 10189, 10192},
        "DZA-2188": {859, 6045, 10189},
    },
    "spanish_sahara_frontier": {
        "MR_ADM1_MRT-2783": {1844, 2144},
        "DZA-2150": {1844, 2216, 5337, 5338, 6754, 6755, 6756, 6758, 6905, 6950, 7669, 7670, 7898, 8135, 9213},
        "MAR-3457__SPLIT_REST": {6901, 6904, 8140},
        "DZA-2148": {6910, 7655},
    },
    "syrian_jazira": {
        "SYR-141": {7134},
        "SYR-137": {3571, 5705},
        "SYR-136": {3618, 5705, 7134},
        "TRC21": {5693, 5694, 6989},
    },
    "maan_aqaba_hejaz": {
        "JOR-853": {959, 1175, 3351, 3352, 3369, 6961},
        "JOR-850": {959, 6961},
        "SAU-862": {1176, 3353, 5884},
    },
    "iraq_neutral_zones": {
        "IRQ-3223": {1105, 2212, 3358, 3359, 5621, 5887, 8078, 8079},
    },
    "iranian_azerbaijan": {
        "IRN-3238": {4986, 5899},
        "TRB21": {2179, 4012, 4014, 4986, 5897, 6995, 6996},
    },
    "bosnia_drina": {
        "RS211": {2089, 2263, 4041, 5490, 7344, 7353, 7621},
    },
    "lapland_arctic": {
        "FI1D7": {940, 1239, 2778, 2927, 2944, 4909, 8026, 8027},
        "NO074": {1101, 1244, 2778, 2780, 2928},
        "SE332": {1102, 1244, 2944, 4903},
    },
    "cilicia": {"TR621": {345, 3299, 3521}, "TR622": {344, 11857}},
    "southern_bukovina": {"RO215": {5537, 5538, 5539}},  # Neamț seats supply registration controls only.
    "burgenland_sopron": {
        "AT113": {7639, 7950},
        "AT112": {4820},
        "HU221": {4819},
    },
    "backa_baranja_srem": {
        "HU331": {7374, 7384},
        "RS123": {5040, 5041, 7377, 7378, 7379},
        "RS121": {2207, 5041, 7373},
        "HR026": {5041, 7375},
        "RS127": {5040},
    },
    "upper_hungary_ruthenia": {
        "HU311": {664, 1221},
        "HU323": {7983},
    },
    "grodno_bialystok_polesie": {
        "BY_RAY_67162791B59963656038120": {5734},
        "PL_MRG_c5cfb391c06f": {5733},
    },
    "kars_ardahan": {
        "TRA11": {2487, 7112},
        "TRA22": {4982, 7111},
        "TRA24": {2486, 7111, 7112},
        "TR905": {7106, 7111},
        "ARM-1555": {2035, 4142, 7113},
    },
    "mosul_vilayet": {
        "IRQ-3051": {1362, 4989, 5680, 9029},
        "IRQ-3050": {5893, 5894},
    },
    "ulster_border": {
        "IE041": {119, 4961},
        "GB_NUTS1_UKN": {1832, 6091, 7482},
    },
    "sandzak": {
        "RS217": {7630},
    },
    "negev_sinai": {
        "EGY-1558": {1204, 3366, 3375, 9830},
        "ISR-3053": {3366, 3367, 6795},
    },
}

TRANSLATIONS = {
    350: "锡韦雷克", 675: "哈贾拉", 856: "库夫拉", 857: "杰格布卜",
    858: "盖特龙", 859: "奥巴里", 860: "瓦特", 861: "萨拉",
    1079: "贝伊蒂谢巴普", 1104: "伊拉克中立区", 1105: "沙特中立区", 1143: "哈塞克",
    1175: "卡夫", 1176: "图拜克", 1177: "哈克勒", 1239: "挪威",
    1243: "南瓦朗厄尔", 1379: "祖拜尔", 1633: "阿古尼特", 1843: "特兰凯堡",
    1844: "比尔莱赫卢", 2089: "巴斯塔西", 2152: "米古瓦", 2153: "瓦特",
    2175: "德尔瓦尔", 2176: "布戈伊诺", 2178: "斯泰彭", 2179: "马库",
    2212: "穆萨纳", 2213: "贾弗尔", 2216: "朱比角内陆", 2263: "塞族地区",
    2267: "伊利扎", 2346: "赫利格斯科根", 2777: "斯韦特雷", 2778: "兰纳瓦拉",
    2779: "沃措", 2780: "波卡", 2781: "比耶克维克", 2787: "诺维格勒",
    2788: "波多维", 2927: "哈帕兰达", 2928: "里特瑟姆", 2929: "梅尔克内斯",
    2930: "泰尔纳比", 2944: "迪维河谷", 2945: "瓦格", 2946: "瓦尔德",
    2947: "库内斯", 3299: "阿夫欣", 3348: "阿卢瓦", 3350: "西鲁特拜",
    3351: "南卡夫", 3352: "东哈克勒", 3353: "西图拜克", 3356: "祖尔",
    3358: "劳达特哈巴斯", 3359: "西穆萨纳", 3360: "舒巴克", 3369: "哈拉特阿马尔",
    3392: "里马", 3434: "西迪拜拉尼", 3521: "格克孙", 3522: "马克纳",
    3568: "南奥贝迪", 3570: "迈亚丁", 3571: "苏鲁奇", 3573: "泰基尔",
    3618: "苏莱曼沙阿陵墓", 3645: "布罗达雷沃", 3646: "普里耶波列", 3651: "莫克拉戈拉",
    3652: "洛兹尼察", 3848: "库萨莫", 4012: "杜斯坦", 4014: "拉维扬",
    4041: "梅斯特雷瓦茨", 4042: "扎瓦伊特", 4903: "阿约斯", 4904: "洛韦",
    4905: "纳尔考斯", 4906: "卢奥斯托", 4907: "库尔苏", 4909: "帕亚拉",
    4911: "皮特奥", 4912: "布雷奥", 4987: "马兰德", 4994: "沙菲",
    5151: "斯托拉茨", 5152: "莫斯科村", 5153: "索科拉茨", 5154: "察津",
    5155: "泽贝", 5337: "艾因本提利", 5368: "扎洛姆", 5490: "梅久雷切",
    5613: "莱赫韦尔", 5614: "苏奈纳", 5615: "瓦甘", 5616: "苏韦汉",
    5621: "沙亚", 5664: "瓦西", 5665: "比尔伊本希尔马斯", 5668: "贾弗尔",
    5670: "舒巴克", 5673: "哈拉巴特堡", 5674: "乌姆吉马勒", 5677: "加伊姆",
    5690: "鲁萨法", 5691: "马丹", 5692: "泰勒伊尔凡", 5693: "泰勒泰米尔",
    5694: "穆纳吉尔", 5695: "萨菲拉", 5696: "巴卜", 5697: "阿纳丹",
    5698: "达比克", 5701: "马拉什", 5702: "埃基诺聚", 5703: "沙特尔许于克",
    5704: "凯奇布尔朱", 5705: "乌尔法", 5707: "巴什卡莱", 5708: "盖瓦什",
    5795: "阿萨卜", 5882: "泰马", 5884: "穆达瓦拉", 5887: "盖苏马",
    5888: "萨勒曼", 5891: "伊本达拉希姆堡", 5897: "舒特", 5898: "奥什纳维耶",
    5899: "纳纳斯", 6015: "尼埃尔夫", 6046: "东盖特龙", 6049: "东萨拉",
    6051: "东库夫拉", 6053: "杰格布卜中部", 6054: "塔济尔布", 6055: "贾哈拉德",
    6056: "西塔济尔布", 6059: "东瓦特", 6063: "梅基利", 6064: "阿德姆",
    6065: "北杰格布卜", 6364: "北梅基利", 6366: "卡拉", 6380: "沃丹",
    6391: "萨拉中部", 6649: "北巴特哈", 6756: "南艾因本提利", 6757: "东比尔莫格兰",
    6758: "北图林", 6766: "姆西德", 6767: "阿卜泰赫", 6769: "乌姆阿塞勒",
    6770: "东乌姆阿塞勒", 6790: "图林中部", 6802: "北图拜克", 6803: "东贾弗尔",
    6804: "贾弗尔中部", 6881: "西图林", 6898: "伊姆安盖勒", 6905: "扎格",
    6906: "南姆西德", 6909: "杰尼安布雷兹格", 6910: "菲吉格", 6919: "瓦津",
    6921: "提吉", 6923: "塔巴盖", 6924: "西纳温", 6925: "东北艾季达比耶",
    6926: "西梅基利", 6927: "扎勒坦", 6928: "贾卢", 6929: "东贾卢",
    6930: "南贾哈拉德", 6931: "北库夫拉", 6932: "东北库夫拉", 6933: "东杰格布卜",
    6934: "北卡拉", 6950: "谢加中部", 6954: "塞卢姆", 6955: "南塞卢姆",
    6961: "盖利拜", 6963: "鲁特拜外围", 6964: "鲁特拜中部", 6969: "巴特哈",
    6970: "杰拜希", 6983: "哈金", 6984: "辛贾尔", 6987: "盖尔泽罗",
    6989: "科巴尼", 6990: "阿布凯马勒", 6991: "塔卜卡", 6992: "南马丹",
    6993: "马尔卡达", 6994: "阿布哈曼", 6995: "阿瓦吉克", 6996: "卡普特",
    6997: "萨汉德", 7040: "明吉万", 7118: "北马兰德", 7119: "南马兰德",
    7121: "迪亚丁", 7134: "维兰谢希尔", 7143: "埃尔比斯坦", 7184: "阿纳穆尔",
    7255: "萨拉内陆", 7257: "焦什", 7266: "拉斯拉努夫", 7345: "戈兰斯科",
    7351: "北杜布尼察", 7353: "北斯泰彭", 7354: "北索科拉茨", 7356: "北布戈伊诺",
    7358: "西德尔瓦尔", 7364: "利夫诺", 7621: "佩蒂内", 7655: "南菲吉格",
    7665: "图林内陆", 7668: "东图林", 7897: "瓦提亚", 7898: "阿萨",
    8026: "塔纳", 8027: "奥尔德达伦", 8076: "西里马", 8081: "泰马外围",
    8082: "南盖利拜", 8126: "东奥巴里", 8133: "图林中西部", 8135: "艾因本提利中部",
    8571: "南盖塔拉", 8572: "盖塔拉运河拟址", 8573: "东盖塔拉", 9025: "纳西里耶",
    9030: "鲁赛法", 9031: "阿兹拉克", 9032: "鲁韦希德", 9213: "塔塔",
    9241: "杜巴", 9242: "舒瓦克", 9263: "北伊镇", 9264: "北肯佩莱",
    9265: "北瓦拉", 9784: "博格阿拉伯", 9847: "东德尔纳", 9850: "南阿纳丹",
    9851: "南巴卜", 9865: "东索兰", 9871: "西纳纳斯", 9940: "南萨拉",
    10176: "梅基利中西部", 10177: "梅基利中部", 10178: "贾卢中部", 10179: "梅基利外围",
    10183: "盖特龙中部", 10185: "东北盖特龙", 10189: "奥巴里中部", 10192: "东奥巴里内陆",
    10193: "北盖尔迈", 10194: "沃丹外围", 10196: "西富盖哈", 10197: "东因萨拉赫",
    10234: "西图林内陆", 10237: "图林中西部外围", 10343: "南阿卢瓦", 10348: "南因萨拉赫",
    10349: "南因阿迈纳斯", 10350: "东因阿迈纳斯", 10351: "因阿迈纳斯外围", 10504: "南阿布凯马勒",
    10505: "南迈亚丁", 10588: "耶尼斯科斯基", 11042: "北斯托拉茨", 11854: "埃尔梅内克",
    11855: "穆特", 11856: "博尔卡尔山", 11857: "阿拉达", 11858: "费凯",
    11859: "卡迪尔利", 11860: "杰伊汉",
    76: "塞克勒地区", 83: "克里沙纳", 736: "普拉", 779: "奥伊彭-马尔梅迪",
    802: "内乌姆", 806: "伊德里亚", 821: "北伊庇鲁斯", 828: "乔尔卢",
    1009: "格但斯克波美拉尼亚", 1111: "弗尔克拉马克特", 1201: "哈尔基季基", 1218: "奥拉迪亚县",
    1219: "北特兰西瓦尼亚", 1229: "利恩茨", 1232: "穆尔维察", 1235: "伊普萨拉",
    1238: "迪米特洛夫格勒", 1277: "基尔运河东段", 1430: "马林韦尔德", 1439: "马祖里",
    1490: "阿普塞尼山脉", 1730: "奥古斯图夫", 1764: "什塔宾", 1765: "奥什米亚内",
    1791: "克拉根福郊区", 1798: "德斯卡蒂", 1799: "桑丹斯基", 2064: "莱纳茨霍夫",
    2084: "海尔斯贝格", 2136: "蒙基", 2172: "图尔盖什山口", 2173: "沃尔坎山口",
    2174: "铁门峡谷", 2197: "卡桑德拉", 2201: "萨诺斯", 2202: "奥雷斯蒂亚达",
    2203: "奥尔梅尼奥", 2204: "凯末尔", 2205: "普雷斯帕", 2206: "卡斯托里亚",
    2271: "托姆纳蒂克", 2272: "蒂米什瓦拉", 2275: "卡雷伊", 2290: "普拉夫尼克岛",
    2296: "韦尔尼采", 2298: "阿尔斯岛", 2371: "达尔马提亚群岛", 2413: "北蒙基",
    2432: "富伦", 2435: "马尔丁根", 2462: "贾乌多沃", 2466: "西石勒苏益格",
    2762: "博亚内", 2782: "沃尔夫斯贝格", 2783: "波斯托伊纳", 2790: "格鲁琼兹",
    3202: "芒德朗", 3212: "凯尔米斯", 3329: "西德斯卡蒂", 3459: "梅里奇",
    3553: "戈乌达普", 3564: "南伊德里亚", 3565: "西南蒂罗尔", 3776: "纳波卡",
    3872: "马尔马齐耶伊", 4026: "泽尔瓦", 4033: "维尼", 4061: "奥尔特尔斯堡",
    4063: "帕森海姆", 4065: "舍恩费尔德", 4069: "布劳恩斯贝格", 4089: "施瓦茨达默科",
    4090: "赖赫斯霍斯特", 4091: "卡尔图济", 4111: "拉斯滕堡", 4115: "莱布尼茨",
    4150: "菲尔根", 4152: "拉豪", 4346: "萨莫色雷斯岛", 4347: "锡索尼亚",
    4766: "北科罗布奇齐", 4767: "南科罗布奇齐", 4801: "布鲁尼科", 4802: "泽尔登",
    4828: "科查尼", 4839: "别尔什蒂", 4841: "斯洛尼姆", 5031: "斯尔布",
    5156: "梅特科维奇", 5213: "东卡斯托里亚", 5345: "马贾罗沃", 5346: "德温",
    5360: "阿格诺", 5367: "科雷尼察", 5384: "马尔多伊滕", 5385: "加尔迪嫩",
    5495: "瓦韦尔卡", 5535: "罗希亚", 5536: "博尔卡", 5537: "罗兹诺夫",
    5538: "切赫勒乌", 5540: "格涅夫", 5542: "谢利吉", 5544: "利森",
    5545: "什奇特诺", 5561: "因杜拉", 5562: "比亚罗扎夫卡", 5563: "巴克什蒂",
    5573: "科尔马", 5574: "纳茨维莱尔", 5586: "卡特农", 5587: "阿扬日",
    5729: "乌尊克普吕", 5731: "凯尚", 5773: "拉斯滕堡", 5779: "上维谢乌",
    5786: "阿莱什德", 5787: "博格丹德", 5792: "斯莫尔贡", 5834: "艾德施泰特",
    5835: "伦茨堡", 5836: "达姆普", 5837: "滕德", 5838: "胡苏姆",
    5910: "斯维伦格勒", 5911: "胡赫拉", 5912: "西曼特罗", 5918: "埃莱兹汉",
    5932: "坎法纳罗", 5933: "梅杜林", 5935: "日米尼", 5936: "瓦尔达尔萨",
    5952: "瓦格纳", 5953: "埃布里亚赫", 5954: "加利齐恩", 5955: "吕克斯多夫",
    5956: "泰纳赫", 5957: "格拉芬施泰因", 5959: "埃本塔尔", 5969: "瓦皮",
    5976: "夏诺沃", 5978: "基谢利采", 5989: "博罗维基", 5990: "曼奇基",
    5991: "阿斯特里纳", 5992: "皮耶斯基", 5993: "库里洛维奇", 5994: "斯塔凯",
    5995: "克雷沃伊", 5996: "贡恰雷", 5997: "察茨基", 5998: "波拉斯利",
    5999: "齐博雷", 6001: "别尼亚科尼", 6002: "戈尔沙内", 7232: "卡拉布伦",
    7239: "托勒迈达", 7240: "迪斯皮利奥", 7241: "科扎尼", 7242: "格雷韦纳",
    7243: "梅措沃", 7244: "科尼察", 7245: "帕尔加", 7246: "普雷韦扎",
    7278: "维斯", 7281: "班斯科", 7282: "多斯帕特", 7303: "卡兰塞贝什",
    7305: "奥采卢罗舒", 7306: "佩奇卡", 7307: "蒂米什山口东部", 7308: "图尔盖什山口北部",
    7309: "拉德纳", 7310: "菲比什", 7311: "萨特基内兹", 7314: "图尔达",
    7315: "多巴", 7317: "卡夫尼克", 7318: "耶乌德", 7319: "博尔沙",
    7330: "克里瓦帕兰卡", 7352: "西杜布罗夫尼克", 7361: "斯塔里格勒", 7362: "卡尔洛巴格",
    7363: "采蒂纳", 7408: "莫斯特", 7415: "安格堡", 7416: "勒岑",
    7417: "达尔克门", 7421: "普鲁士艾劳", 7423: "勒塞尔", 7424: "阿里斯",
    7425: "森斯堡", 7427: "尼古拉肯", 7428: "奥尔特尔斯堡", 7429: "霍恩施泰因",
    7431: "沃尔姆迪特", 7432: "古特施塔特", 7434: "普沃希尼察", 7435: "库尔基",
    7438: "苏什", 7450: "东比托夫", 7470: "萨尔堡", 7471: "阿蒂尼",
    7473: "金茨海姆", 7533: "罗韦雷托", 7534: "梅拉诺-梅兰", 7538: "奇塔代拉", 7539: "蒙泰贝卢纳",
    7540: "格拉帕山麓巴萨诺", 7542: "波萨尼奥", 7543: "格拉帕山麓博尔索", 7544: "科穆达",
    7545: "奥尼戈", 7546: "佩代罗巴", 7547: "皮亚韦河畔阿拉诺", 7551: "弗肯齐",
    7624: "梅尔达里", 7625: "绍尔塔岛", 7632: "乌德尼什特", 7633: "普雷斯帕",
    7634: "加利奇察", 7637: "布鲁什卡", 7999: "莫伊内什蒂", 8002: "贝卢什",
    8003: "胡埃丁", 8036: "科罗布奇齐中部", 8037: "东阿斯特里纳", 8039: "北卡梅涅茨",
    8040: "西皮耶斯基", 8041: "因杜拉中部", 8042: "南因杜拉", 8043: "西博罗维基",
    8045: "东索尔道", 8061: "南卡尔图济", 8062: "北库亚维", 8088: "北耶乌德",
    8089: "南博尔沙", 8104: "帕德堡", 8105: "鲁德伯尔", 8407: "福伊茨贝格",
    8409: "梅拉诺", 8410: "拉切斯", 8411: "梅拉戈", 11894: "南达姆普",
    94: "波列西耶", 95: "新格鲁多克", 353: "帕辛莱尔", 453: "奈赫勒",
    454: "迪莫纳", 792: "南布科维纳", 814: "斯雷姆", 1212: "奥托克",
    1213: "南尼特拉", 1221: "索特马尔切凯", 1293: "斯克鲁达列纳", 1309: "塔尔维西奥",
    1374: "奥达拉尔", 1376: "加伊姆", 1733: "谢尼察", 1801: "新帕扎尔",
    1832: "卡文-莫纳亨", 1886: "谢汉", 2034: "胡洛", 2035: "贾瓦赫季",
    2207: "鲍姚", 2276: "内摩尔多瓦", 2295: "杜布尼察", 2305: "贝特谢梅什",
    2381: "马卡拉瓦", 2487: "优素费利", 2495: "乔普地区", 3201: "温科夫齐",
    3205: "斯威利湾", 3229: "西海乌姆", 3296: "阿什卡莱", 3347: "奥贝迪",
    3367: "哈斯纳", 3378: "恩戈地", 3381: "拉哈夫", 3386: "梅沃霍龙",
    3400: "瓦尔托", 3491: "戈尼翁兹", 3649: "波热加", 4142: "卡尔察希",
    4756: "萨姆茨赫", 4820: "费尔特德", 4838: "奥库宁卡", 4961: "恩尼斯基林",
    4982: "霍拉桑", 4989: "索兰", 5040: "武科瓦尔", 5041: "萨尔瓦什",
    5369: "斯拉蒂纳", 5497: "卢西诺", 5498: "马尔科维奇", 5499: "霍特尼奇",
    5500: "维戈诺希", 5501: "科萨瓦", 5503: "奥戈罗德尼基", 5505: "多布罗梅斯利",
    5539: "沃勒泰克", 5559: "武库夫", 5678: "阿希克村", 5679: "巴尔达拉什",
    5680: "沙克拉瓦", 5733: "弗沃达瓦", 5734: "科罗卢夫卡", 5736: "亚努夫卡",
    5737: "普瓦特尼察", 5739: "纳古尔基", 5740: "弗沃德基", 5741: "波普基",
    5742: "姆希武耶", 5790: "蒂尔扎", 5893: "舍尔加特", 5894: "哈特拉",
    5895: "奈拜", 5896: "拜莱德", 5923: "德拉加", 5924: "格鲁贝蒂采",
    5940: "杜伊诺", 5942: "瓦尔布鲁纳", 5943: "多尼亚", 5944: "奥帕",
    5984: "穆哈韦茨", 5985: "梅德诺", 5986: "德姆纳", 5987: "杜比奇诺",
    5988: "切尔尼亚内", 6019: "齐甘德", 6091: "克洛尼斯", 6794: "扎拉尼克",
    6795: "拉法", 6796: "埃祖兹", 6797: "耶鲁哈姆", 6798: "特拉利姆",
    6936: "比尔阿卜德", 6937: "东比尔阿卜德", 6980: "北拜莱德", 6981: "北哈迪塞",
    7094: "萨卢特", 7095: "蒂尔克格聚", 7096: "科尔柯伊", 7097: "彻尔德尔",
    7098: "巴什柯伊", 7099: "克拉奇", 7100: "卡拉卡莱", 7102: "霍帕",
    7103: "帕扎尔", 7106: "伊斯皮尔", 7110: "帕扎尔约卢", 7111: "奥尔图",
    7113: "迪戈尔", 7114: "卡厄兹曼", 7122: "埃莱什基尔特", 7123: "图塔克",
    7127: "马拉兹吉尔特", 7335: "克拉列沃", 7372: "伊洛克", 7373: "埃尔杜特",
    7374: "里吉察", 7375: "亚梅纳", 7376: "库兹明", 7377: "斯雷姆斯卡米特罗维察",
    7378: "伊里格", 7379: "贝什卡", 7381: "阿达", 7382: "贝切伊",
    7383: "泰梅林", 7384: "松博尔", 7385: "库拉", 7390: "瓦莫什米科洛",
    7392: "波德海斯卡", 7393: "舒拉尼", 7395: "沙拉", 7396: "加兰塔",
    7400: "奥布道", 7482: "马诺哈密尔顿", 7548: "马拉诺拉古纳雷", 7549: "波切尼亚",
    7550: "莫尔泰利亚诺", 7593: "萨勒卡默什", 7620: "塔拉什", 7628: "科纽赫",
    7630: "佩特尼察", 7639: "佐洛勒沃", 7641: "瓦莫绍鲍迪", 7946: "帕波",
    7948: "泰特", 7949: "沃什堡", 7950: "卡姆", 7975: "赫拉尼",
    7984: "珍珠市", 7990: "雷姆", 7994: "迈泽克韦什德", 8004: "莱维采",
    8044: "南蒙基", 8052: "北沃尔钦", 8438: "伊斯托格", 8439: "乌恰",
    9028: "东加伊姆", 9029: "东哈特拉", 9842: "东奥库宁卡", 9859: "南辛贾尔",
    9862: "南舍尔加特", 9863: "南沙克拉瓦", 9881: "西拉法", 10534: "奥罗斯堡",
}


def project(points, grid, step):
    uv = points / step - 0.5
    ix, iy = np.floor(uv).astype(int).T
    fx, fy = (uv - np.floor(uv)).T
    result = np.zeros_like(uv)
    for dx, dy in ((0, 0), (0, 1), (1, 0), (1, 1)):
        weight = (fx if dx else 1-fx) * (fy if dy else 1-fy)
        result += grid[iy+dy, ix+dx] * weight[:, None]
    return result


def footprints(regions, core, grid, step):
    ids = {sid for region in regions for sid in region["hgo_state_ids"]}
    h, w = grid.shape[:2]
    raster = np.frombuffer(gzip.decompress((ASSETS / "default/ids.u16.gz").read_bytes()),
                           "<u2").reshape(h * step[1], w * step[0])
    labels = np.array([sid or 0 for sid in core["provinceStateIds"]])
    shapes = {}
    for state in core["states"]:
        sid = state["id"]
        if sid not in ids:
            continue
        left, top, right, bottom = state["bounds"]
        y, x = np.where(labels[raster[top:bottom+1, left:right+1]] == sid)
        corners = np.column_stack((x + left, y + top))[:, None, :] + np.array(
            [(0, 0), (1, 0), (1, 1), (0, 1)])
        coords = project(corners.reshape(-1, 2), grid, step).reshape(-1, 4, 2)
        valid = np.isfinite(coords).all(axis=(1, 2))
        shapes[sid] = shapely.coverage_union_all(shapely.polygons(coords[valid]))
    return shapes


def city_index(features):
    index = defaultdict(list)
    for f in features:
        props = f["properties"]
        for key in {code(n) for n in [props["name"], props["name_en"], *props["aliases"]]} - {""}:
            index[key].append(f["geometry"]["coordinates"])
    return index


def registration(shapes, target, places, cities, grid, step, state_anchors=(), translation_only=False):
    src, dst = [], []
    extent = shapely.box(*shapely.total_bounds(list(shapes.values())))
    for p in [*places, *state_anchors]:
        xy = project(np.array([[p["x"], p["y"]]]), grid, step)[0]
        if not np.isfinite(xy).all() or not extent.covers(shapely.Point(xy)):
            continue
        nearby = []
        for lon, lat in cities.get(code(p["name"]), []):
            meters = GEOD.inv(*xy, lon, lat)[2]
            if meters <= 80000 and (p["stateId"] in shapes or target.covers(shapely.Point(lon, lat))):
                nearby.append((meters, lon, lat))
        if nearby:
            _, lon, lat = min(nearby)
            src.append([*xy, 1])
            dst.append([lon, lat])
    matrix = None
    if translation_only and src:
        offset = (np.array(dst) - np.array(src)[:, :2]).mean(axis=0)
        matrix = [1, 0, 0, 1, *offset]
        method = "city/state-anchor translation"
    elif len(src) >= 3:
        fit, _, rank, _ = np.linalg.lstsq(src, dst, rcond=None)
        if rank == 3 and (not state_anchors or np.linalg.det(fit[:2]) > 0):
            matrix = [*fit[:2, 0], *fit[:2, 1], *fit[2]]
            method = "city/state-anchor affine" if state_anchors else "city affine"
    if matrix is None:
        x, y, xx, yy = shapely.total_bounds(list(shapes.values()))
        a, b, aa, bb = target.bounds
        sx, sy = (aa-a)/(xx-x), (bb-b)/(yy-y)
        matrix = [sx, 0, 0, sy, a-x*sx, b-y*sy]
        method = "bbox"
    residual = "n/a"
    if src:
        a, b, c, d, e, f = matrix
        fitted = np.array(src) @ np.array([[a, c], [b, d], [e, f]])
        distances = GEOD.inv(*fitted.T, *np.array(dst).T)[2]
        residual = f"{np.sqrt(np.mean(distances**2))/1000:.2f} km"
    return matrix, f"{method}, cities={len(src)}, RMS={residual}"


def edge_strip(piece, parent):
    if not piece.boundary.intersection(parent.boundary).length:
        return False
    km = scale(piece, xfact=111.32 * np.cos(np.deg2rad(piece.centroid.y)), yfact=111.13)
    sides = np.linalg.norm(np.diff(km.minimum_rotated_rectangle.exterior.coords, axis=0), axis=1)
    return min(sides) <= 3.5 and max(sides) >= 4 * min(sides)


def merge_scraps(parent, parts):
    merged = 0
    detached = []
    while len(parts) > 1:
        moved = False
        for sid in list(parts):
            for piece in polygons(parts[sid]):
                small = area_km2(piece) < 3
                if not small and not edge_strip(piece, parent):
                    continue
                edges = {k: part.boundary.intersection(piece.boundary).length
                         for k, part in parts.items() if k != sid}
                other = max(edges, key=edges.get)
                if edges[other] > 0:
                    parts[other] = parts[other].union(piece)
                    merged += 1
                elif small:
                    detached.append((sid, piece))
                else:
                    continue
                parts[sid] = parts[sid].difference(piece)
                if parts[sid].is_empty:
                    del parts[sid]
                moved = True
                break
            if moved:
                break
        if not moved:
            break
    remainder = max(parts, key=lambda k: parts[k].area)
    parts[remainder] = shapely.union_all([parts[remainder], *(p for _, p in detached)])
    return merged + sum(sid != remainder for sid, _ in detached)


def partition(parent, states, pixel_counts=None, merge_counts=None):
    # Leave a narrow collar. Triangulating it preserves the parent's original arc vertices.
    interior = parent.buffer(-0.002)
    seeds = {}
    simplified = shapely.coverage_simplify(list(states.values()), 0.002)
    for (sid, state), mask in zip(states.items(), simplified):
        clipped = parent.intersection(state)
        minimum = min(0.3 * state.area, 0.2 * parent.area)
        if pixel_counts is not None:
            minimum = min(minimum, state.area / pixel_counts[sid])
        if clipped.area < minimum or clipped.area == 0:
            continue
        cut = interior.intersection(mask, grid_size=1e-7)
        large = [p for p in polygons(cut) if area_km2(p) >= 3]
        if large:
            seeds[sid] = shapely.union_all(large)
    if len(seeds) < 2:
        return {}
    additions = defaultdict(list)
    boundaries = shapely.union_all([parent.boundary, *(g.boundary for g in seeds.values())])
    for face in shapely.polygonize(shapely.get_parts(boundaries)).geoms:
        inside = face.representative_point()
        if not parent.covers(inside):
            continue
        owner = next((sid for sid, seed in seeds.items() if seed.covers(inside)), None)
        if owner is not None:
            additions[owner].append(face)
            continue
        for tri in shapely.constrained_delaunay_triangles(face).geoms:
            point = tri.centroid
            sid = min(seeds, key=lambda k: seeds[k].distance(point))
            additions[sid].append(tri)
    parts = {sid: shapely.union_all(additions[sid]) for sid in seeds}
    merged = merge_scraps(parent, parts)
    if merge_counts is not None:
        merge_counts.append(merged)
    return parts if len(parts) >= 2 else {}


STATE_NAMES = {
    778: ("East Prussia", "东普鲁士"), 2061: ("Thionville", "蒂永维尔"),
    3509: ("Briey", "布里耶"), 7352: ("West Dubrovnik", "西杜布罗夫尼克"),
    2272: ("Timișoara", "蒂米什瓦拉"),
    7395: ("Šaľa", "沙拉"), 7630: ("Petnjica", "佩特尼察"),
}

CITY_ZH = {
    "Batabo": "巴塔布", "Jarabulus": "杰拉布卢斯", "Subaykhan": "苏拜汉", "Birecik": "比雷吉克",
    "Ar Rumaythah": "鲁迈萨", "Al Basrah al Qadimah": "巴士拉旧城", "Al Qurnah": "古尔奈",
    "Bukan": "布坎", "Poldasht": "波勒达什特", "Salmas": "萨勒马斯", "Oshnaviyeh": "奥什纳维耶",
    "Shahin Dezh": "沙欣代日", "Takab": "塔卡布", "Miandoab": "米扬杜阿卜", "Sarab": "萨拉卜",
    "Mianeh": "米亚内", "Musaffah": "穆萨法", "Trebinje": "特雷比涅", "Doboj": "多博伊",
    "Gorazde": "戈拉日代", "Bosanska Krupa": "波斯尼亚克鲁帕", "Bihac": "比哈奇",
    "Gradacac": "格拉达查茨", "Uzice": "乌日策", "Tornio": "托尔尼奥",
    "Yesilova": "耶希洛瓦", "Erdemli": "埃尔代姆利", "Goeksun": "格克孙",
    "Caglayancerit": "恰拉扬杰里特", "Pazarcik": "帕扎尔哲克",
    "Cividale del Friuli": "弗留利地区奇维达莱", "Manzano": "曼扎诺",
    "San Giorgio di Nogaro": "圣乔尔焦迪诺加罗", "Oberwart": "上瓦特",
    "Güssing": "居辛", "Loipersbach im Burgenland": "布尔根兰州洛伊珀斯巴赫",
    "Hawija": "哈维杰", "Rabia": "拉比亚", "Encs": "恩奇", "Želiezovce": "热列佐夫采",
    "Līvāni": "利瓦尼", "Subate": "苏巴特", "Viļāni": "维利亚尼",
    "Raška": "拉什卡", "Berane": "贝拉内", "Ušće": "乌什切", "Jošanička Banja": "约沙尼奇卡矿泉镇",
    "Brańsk": "布兰斯克", "Ciechanowiec": "切哈诺维茨", "Garnarrich": "加尔纳里奇",
    "Mitzpe Ramon": "米茨佩拉蒙", "Nitzana": "尼察纳", "Osoppo": "奥索波", "Pulfero": "普尔费罗",
    "Meghrashat": "梅格拉沙特",
    "Pordenone": "波代诺内", "Mosonmagyarovar": "莫雄马扎尔古堡", "Sarvar": "沙尔堡",
    "Kiskunfelegyhaza": "基什孔费莱吉哈佐", "Kiskunhalas": "基什孔豪洛什", "Backa Palanka": "巴奇卡帕兰卡",
    "Vrbas": "弗尔巴斯", "Apatin": "阿帕廷", "Ruma": "鲁马", "Tiszaujvaros": "蒂萨新城",
    "Satoraljaujhely": "沙托劳尔尧乌伊海伊", "Mateszalka": "马泰绍尔考",
    "Ivanovo": "伊万诺沃", "Ivatsevichi": "伊瓦采维奇", "Bielsk Podlaski": "波德拉谢地区别尔斯克",
    "Zambrow": "赞布鲁夫", "Lomza": "沃姆扎", "Lubartow": "卢巴尔图夫", "Pulawy": "普瓦维",
    "Miedzyrzec Podlaski": "波德拉谢地区缅济热茨", "Hinis": "赫内斯", "Artik": "阿尔蒂克",
    "Akhaltsikhe": "阿哈尔齐赫", "Al Mawsil al Jadidah": "新摩苏尔", "Sinjar": "辛贾尔",
    "Al-Hamdaniya": "哈姆达尼耶", "Tallkayf": "泰勒凯夫", "'Aqrah": "阿克拉", "Koysinceq": "科伊桑贾克",
    "Letterkenny": "莱特肯尼", "Londonderry County Borough": "伦敦德里", "Craigavon": "克雷加文",
    "Ash Shaykh Zuwayd": "谢赫祖韦德",
    "Bi'r al 'Abd": "比尔阿卜德", "Ashdod": "阿什杜德",
    "Sarreguemines": "萨尔格米讷", "Selestat": "塞莱斯塔", "Sonderborg": "森讷堡",
    "Tonder": "滕德", "Heide": "海德", "Eckernfoerde": "埃肯弗德",
    "Bressanone": "布雷萨诺内", "Gorizia": "戈里齐亚", "Koper": "科佩尔",
    "Solin": "索林", "Villach": "菲拉赫", "Lidzbark Warminski": "瓦尔米亚地区利兹巴克",
    "Gizycko": "吉日茨科", "Mragowo": "姆龙戈沃", "Braniewo": "布拉涅沃",
    "Gierloz": "盖尔沃日", "Starogard Gdanski": "格但斯克旧城", "Koscierzyna": "科希切日纳",
    "Chojnice": "霍伊尼采", "Swiecie": "希维切", "Bytow": "比图夫", "Grudziądz": "格鲁琼兹",
    "Smarhon": "斯莫尔贡", "Novogrudok": "新格鲁多克", "Volkovysk": "沃尔科维斯克",
    "Oshmyany": "奥什米亚内", "Shchuchyn": "舒钦", "Sighetu Marmatiei": "锡盖图马尔马切伊",
    "Baia Sprie": "巴亚斯普列", "Miercurea-Ciuc": "米耶尔库雷亚丘克",
    "Targu Secuiesc": "特尔古塞奎斯克", "Lugoj": "卢戈日", "Veroia": "韦里亚",
    "Centar Zupa": "中茹帕", "Ohrid": "奥赫里德", "Brvenica": "布尔韦尼察",
    "Gostivar": "戈斯蒂瓦尔", "Kumanovo": "库马诺沃", "Kriva Palanka": "克里瓦帕兰卡",
    "Blagoevgrad": "布拉戈耶夫格勒", "Harmanli": "哈曼利", "Dimitrovgrad": "季米特洛夫格勒",
}


def part_names(parts, states, city_tree, city_features, local_seats=()):
    by_name = {code(en.casefold()): (en, zh) for en, zh in states.values()}
    labels = {}
    for sid, geom in parts.items():
        cities = (city_features[i]["properties"] for i in city_tree.query(geom, predicate="covers"))
        city = max(cities, key=lambda p: (p["population"], p["id"]), default=None)
        if city is None:
            labels[sid] = states[sid]
            for name, point in local_seats:
                if geom.covers(point):
                    match = by_name.get(code(name.casefold()))
                    labels[sid] = match or (name, CITY_ZH[name])
                    break
            continue
        en = city["name_en"] or city["name_ascii"]
        match = by_name.get(code(en.casefold()))
        if match:
            labels[sid] = match
        else:
            zh = city["name_zh"]
            if not any("\u4e00" <= char <= "\u9fff" for char in zh) or en in CITY_ZH:
                zh = CITY_ZH[en]
            labels[sid] = en, zh

    # Split each collision along the axis on which the parts are furthest apart.
    for language in (0, 1):
        while True:
            groups = defaultdict(list)
            for sid, label in labels.items():
                key = code(label[0].casefold()) if language == 0 else label[1]
                groups[key].append(sid)
            group = next((ids for ids in groups.values() if len(ids) > 1), None)
            if group is None:
                break
            centers = np.array([[parts[i].centroid.x, parts[i].centroid.y] for i in group])
            centers[:, 0] *= np.cos(np.deg2rad(centers[:, 1].mean()))
            axis = np.argmax(np.ptp(centers, axis=0))
            directions = (("West", "西"), ("East", "东")) if axis == 0 else (("South", "南"), ("North", "北"))
            for rank, j in enumerate(np.argsort(centers[:, axis], kind="stable")):
                sid = group[j]
                en, zh = labels[sid]
                prefix, chinese = directions[int(rank >= len(group) // 2)]
                labels[sid] = f"{prefix} {en}", chinese + zh
    return labels


def build_entry(parent_id, parts, names, source_path, state_rows=None):
    if len(parts) < 2:
        return None, []
    entry = dict(id=parent_id, feature_ids=[parent_id], parts=[],
                 sources=["HGO states (Historic Geographical Overhaul)"])
    features, suffixes = [], set()
    remainder = max(parts, key=lambda sid: parts[sid].area)
    for sid, geom in parts.items():
        en, zh = names[sid]
        suffix = code(state_rows[sid]["name"] if state_rows is not None else en)
        if suffix in suffixes:
            suffix += f"_{sid}"
        suffixes.add(suffix)
        part = dict(suffix=suffix, name_en=en, name_zh=zh, full_name=True)
        if sid == remainder:
            entry["remainder"] = part
        else:
            unit = f"{parent_id}_{sid}"
            part["polygon_source"] = dict(path=source_path, property="unit", values=[unit])
            entry["parts"].append(part)
            features.append(dict(type="Feature", properties=dict(unit=unit), geometry=mapping(geom)))
    return entry, features


def write(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8", newline="\n")


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--regions", type=Path, default=PREFIX.with_suffix(".regions.json"))
    parser.add_argument("--rules", type=Path, default=PREFIX.with_suffix(".geometry_splits.json"))
    parser.add_argument("--sources", type=Path, default=PREFIX.with_suffix(".sources.geojson"))
    args = parser.parse_args(argv)
    regions = read(args.regions)
    for region in regions:
        ids = region["hgo_state_ids"]
        if region["region_id"] == "south_tyrol_trentino" and 975 in ids and 7533 not in ids:
            ids.append(7533)  # Include the Rovereto state alongside Trentino.
    core = read(ASSETS / "default/core.json")
    state_rows = {s["id"]: s for s in core["states"]}
    folder = ASSETS / "overlays/geography"
    spec = read(folder / "georeference.json")["inverseGrid"]
    step = np.array(spec["nativePixelStep"])
    grid = np.frombuffer(gzip.decompress((folder / "inverse-lonlat.f32.gz").read_bytes()),
                         "<f4").reshape(spec["height"], spec["width"], 2)
    shapes = footprints(regions, core, grid, step)
    locale = read(ASSETS / "overlays/localization/index.json")["states"]
    catalog = read(DATA / "hgo_catalogs/hgo_place_names.json")["entries"]
    names = {}
    for s in core["states"]:
        sid = s["id"]
        if sid in shapes:
            zh = catalog.get(s["nameKey"], {}).get("names", {}).get("zh") or locale[str(sid)].get("zh")
            names[sid] = STATE_NAMES.get(sid, (s["name"], zh or TRANSLATIONS[sid]))
    city_features = read(DATA / "world_cities.geojson")["features"]
    cities = city_index(city_features)
    city_tree = shapely.STRtree([shapely.Point(f["geometry"]["coordinates"]) for f in city_features])
    places = read(ASSETS / "default/places.json")["places"]
    topology = _absolute_topology(read(DATA / "scenarios/hoi4_1936/runtime_topology.topo.json"))
    rows = {r["properties"]["id"]: r for r in topology["objects"]["political"]["geometries"]}
    rules = dict(version=1, scenarios=["hoi4_1936", "hoi4_1939"], area_tolerance_degrees2=1e-9, entries=[])
    features = []
    source_path = Path(os.path.relpath(args.sources, args.rules.parent)).as_posix()
    for region in regions:
        parents = {fid: _decode_geometry(topology, rows[fid]) for fid in region["parent_ids"]}
        seats = LOCAL_SEATS.get(region["region_id"], {})
        seat_points = [(name, shapely.Point(xy)) for name, xy in seats.items()]
        outside = OUTSIDE_REGION.get(region["region_id"], set())
        states = {sid: shapes[sid] for sid in region["hgo_state_ids"] if sid not in outside}
        controls = STATE_CITY_CONTROLS.get(region["region_id"], {})
        anchors = [dict(name=name, stateId=sid, x=state_rows[sid]["anchor"][0], y=state_rows[sid]["anchor"][1])
                   for sid, name in controls.items() if sid in states]
        local_cities = cities | {code(name): [xy] for name, xy in seats.items()} if seats else cities
        matrix, report = registration(states, shapely.union_all(list(parents.values())),
                                      places, local_cities, grid, step, anchors,
                                      translation_only=region["region_id"] in TRANSLATION_ONLY)
        pixel_counts = {sid: state_rows[sid]["pixelCount"] for sid in states} if controls else None
        states = {sid: affine_transform(g, matrix) for sid, g in states.items()}
        count, skipped, merge_counts = 0, [], []
        outside_parents = OUTSIDE_PARENT.get(region["region_id"], {})
        for fid, parent in parents.items():
            candidates = {sid: geom for sid, geom in states.items() if sid not in outside_parents.get(fid, ())}
            parts = partition(parent, candidates, pixel_counts, merge_counts)
            labels = part_names(parts, {sid: names[sid] for sid in states}, city_tree, city_features, seat_points)
            entry, masks = build_entry(fid, parts, labels, source_path, state_rows)
            if entry:
                named = [(p["suffix"], p) for p in entry["parts"]]
                if entry.get("remainder"):
                    named.append(("remainder", entry["remainder"]))
                for suffix, part in named:
                    if (fid, suffix) in NAME_FIXES:
                        part["name_en"], part["name_zh"] = NAME_FIXES[(fid, suffix)]
            if entry:
                rules["entries"].append(entry)
                features.extend(masks)
                count += len(parts)
            else:
                skipped.append(fid)
        print(f"{region['region_id']}: parents={len(parents)}, parts={count}, "
              f"net={count-len(parents)+len(skipped)}, merged={sum(merge_counts)}, {report}, skipped (<2)={skipped}", flush=True)
    validate_partition_plan(rules)
    write(args.rules, rules)
    write(args.sources, dict(type="FeatureCollection", features=features))
    print(f"{args.sources.name}: {args.sources.stat().st_size} bytes")


if __name__ == "__main__":
    main()
