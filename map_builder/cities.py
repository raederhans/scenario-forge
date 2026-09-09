"""City asset generation helpers for the map build pipeline."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import re
import unicodedata
import zipfile
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

from map_builder import config as cfg
from map_builder.city_contract import validate_city_features
from map_builder.io.fetch import fetch_or_cache_binary
from map_builder.io.readers import load_populated_places, read_json_optional
from map_builder.io.writers import write_json_atomic
from map_builder.scenario_city_overrides_composer import (
    compose_city_overrides_payload,
)


GEONAMES_COLUMNS = [
    "geonameid",
    "name",
    "asciiname",
    "alternatenames",
    "latitude",
    "longitude",
    "feature_class",
    "feature_code",
    "country_code",
    "cc2",
    "admin1_code",
    "admin2_code",
    "admin3_code",
    "admin4_code",
    "population",
    "elevation",
    "dem",
    "timezone",
    "modification_date",
]

COUNTRY_CAPITAL_CODES = {"PPLC"}
ADMIN_CAPITAL_CODES = {"PPLA", "PPLA2", "PPLA3", "PPLA4"}
ALIAS_LIMIT = 24
ALIAS_SAMPLE_LIMIT = 200
CITY_TIER_WEIGHT = {"minor": 1, "regional": 2, "major": 3}
CITY_SOURCE_PRIORITY = {"merged": 0, "natural_earth": 1, "geonames": 2}
# Deprecated: use SCENARIO_MANUAL_CAPITALS instead.
TNO_MANUAL_CAPITALS = {
    "GER": "Berlin",
    "USA": "Washington, D.C.",
    "RKM": "Moscow",
    "SAM": "Samara",
    "OMS": "Omsk",
    "PRM": "Perm",
    "NOV": "Novosibirsk",
    "TOM": "Tomsk",
    "TYM": "Tyumen",
    "ORE": "Orenburg",
    "KOM": "Syktyvkar",
    "SBA": "Novosibirsk",
}
# Deprecated: use SCENARIO_CITY_RENAMES instead.
TNO_CITY_RENAMES = {
    "Saint Petersburg": {
        "display_name": {"en": "Leningrad", "zh": "列宁格勒"},
        "aliases": ["Leningrad"],
        "tier": "major",
        "hidden": False,
    },
    "Nizhniy Novgorod": {
        "display_name": {"en": "Gorky", "zh": "高尔基"},
        "aliases": ["Gorky"],
        "tier": "regional",
        "hidden": False,
    },
    "Yekaterinburg": {
        "display_name": {"en": "Sverdlovsk", "zh": "斯维尔德洛夫斯克"},
        "aliases": ["Sverdlovsk"],
        "tier": "regional",
        "hidden": False,
    },
}


SCENARIO_MANUAL_CAPITALS = {
    "tno_1962": {
        "GER": "Berlin",
        "USA": "Washington, D.C.",
        "RKM": "Moscow",
        "SAM": "Samara",
        "OMS": "Omsk",
        "PRM": "Perm",
        "NOV": "Novosibirsk",
        "TOM": "Tomsk",
        "TYM": "Tyumen",
        "ORE": "Orenburg",
        "OUR": "Orenburg",
        "KOM": "Syktyvkar",
        "SBA": "Novosibirsk",
        "RUR": "Kemerovo",
        "RKP": "Warsaw",
        "RKNO": "Oslo",
        "AST": "Canberra",
        "SAF": "Pretoria",
        "HOL": "Paramaribo",
        "GEA": "Dar es Salaam",
        "GCO": "Kinshasa",
        "GSW": "Windhoek",
        "ARE": "Abu Dhabi",
        "BHR": "Manama",
        "QAT": "Doha",
        "PAK": "Islamabad",
        "RSF": "Magadan",
        "PFC": "Petropavlovsk-Kamchatsky",
        "FIC": "Tynda",
    },
}
SOVIET_ERA_CITY_RENAMES = {
    "Saint Petersburg": {
        "display_name": {"en": "Leningrad", "zh": "列宁格勒"},
        "aliases": ["Leningrad"],
        "tier": "major",
        "hidden": False,
    },
    "Nizhniy Novgorod": {
        "display_name": {"en": "Gorky", "zh": "高尔基"},
        "aliases": ["Gorky"],
        "tier": "regional",
        "hidden": False,
    },
    "Yekaterinburg": {
        "display_name": {"en": "Sverdlovsk", "zh": "斯维尔德洛夫斯克"},
        "aliases": ["Sverdlovsk"],
        "tier": "regional",
        "hidden": False,
    },
    "Volgograd": {
        "display_name": {"en": "Stalingrad", "zh": "斯大林格勒"},
        "aliases": ["Stalingrad"],
        "tier": "major",
        "hidden": False,
    },
}
SCENARIO_CITY_RENAMES = {
    # Reviewed stable city IDs prevent a regional or neighbouring city name from leaking into labels.
    "tno_1962": {
        "CITY::gn::1024694": {"display_name": {"en": "Mocuba", "zh": "莫屈巴"}},
        "CITY::gn::1024699": {"display_name": {"en": "Mocímboa da Praia", "zh": "濱海莫辛布瓦區"}},
        "CITY::gn::1040989": {"display_name": {"en": "Manhica", "zh": "曼希萨"}},
        "CITY::gn::1045512": {"display_name": {"en": "Gurue", "zh": "古鲁埃"}},
        "CITY::gn::1048364": {"display_name": {"en": "Vila Trigo de Morais", "zh": "维拉·特里戈·德·莫赖斯"}},
        "CITY::gn::10627325": {"display_name": {"en": "Ingombota", "zh": "因贡博塔"}},
        "CITY::gn::1085510": {"display_name": {"en": "Epworth", "zh": "埃普沃思"}},
        "CITY::gn::11111027": {"display_name": {"en": "Shengavit", "zh": "Shengavit"}},
        "CITY::gn::11776362": {"display_name": {"en": "Demiyivka", "zh": "Demiyivka"}},
        "CITY::gn::11778464": {"display_name": {"en": "Borshchahivka", "zh": "Borshchahivka"}},
        "CITY::gn::12047617": {"display_name": {"en": "Osiedle Kosmonautow", "zh": "Osiedle Kosmonautow"}},
        "CITY::gn::12047623": {"display_name": {"en": "Rejon placu Grunwaldzkiego", "zh": "Rejon placu Grunwaldzkiego"}},
        "CITY::gn::12047628": {"display_name": {"en": "Rejon ulicy Traugutta", "zh": "Rejon ulicy Traugutta"}},
        "CITY::gn::12047636": {"display_name": {"en": "Kozanow", "zh": "Kozanow"}},
        "CITY::gn::12047644": {"display_name": {"en": "Rejon placu Swietego Macieja", "zh": "Rejon placu Swietego Macieja"}},
        "CITY::gn::12047651": {"display_name": {"en": "Rozanka-Polanka", "zh": "Rozanka-Polanka"}},
        "CITY::gn::12500938": {"display_name": {"en": "Oleksiyivka", "zh": "Oleksiyivka"}},
        "CITY::gn::13100477": {"display_name": {"en": "Orunia Gorna-Gdansk Poludnie", "zh": "Orunia Gorna-Gdansk Poludnie"}},
        "CITY::gn::13535745": {"display_name": {"en": "Pechersk", "zh": "Pechersk"}},
        "CITY::gn::13535747": {"display_name": {"en": "Svyatoshyn", "zh": "Svyatoshyn"}},
        "CITY::gn::13546341": {"display_name": {"en": "Rangel", "zh": "兰热尔"}},
        "CITY::gn::13546343": {"display_name": {"en": "Sambizanga", "zh": "桑比赞加"}},
        "CITY::gn::13546518": {"display_name": {"en": "Dniprovskyi", "zh": "Dniprovskyi"}},
        "CITY::gn::13546519": {"display_name": {"en": "Desna", "zh": "Desna"}},
        "CITY::gn::13546520": {"display_name": {"en": "Solomyansk", "zh": "Solomyansk"}},
        "CITY::gn::13546521": {"display_name": {"en": "Shevchenkivskyi", "zh": "Shevchenkivskyi"}},
        "CITY::gn::13546522": {"display_name": {"en": "Zhulyany", "zh": "Zhulyany"}},
        "CITY::gn::13561777": {"display_name": {"en": "Podil", "zh": "Podil"}},
        "CITY::gn::13561778": {"display_name": {"en": "Kyivskyi", "zh": "Kyivskyi"}},
        "CITY::gn::13561779": {"display_name": {"en": "Shevchenko", "zh": "Shevchenko"}},
        "CITY::gn::13561808": {"display_name": {"en": "Rayon KTZ", "zh": "Rayon KTZ"}},
        "CITY::gn::13562332": {"display_name": {"en": "Srodmiescie", "zh": "Srodmiescie"}},
        "CITY::gn::13562335": {"display_name": {"en": "Psie Pole", "zh": "Psie Pole"}},
        "CITY::gn::13580041": {"display_name": {"en": "Nyvky", "zh": "Nyvky"}},
        "CITY::gn::13580094": {"display_name": {"en": "Pozniaky", "zh": "Pozniaky"}},
        "CITY::gn::13580095": {"display_name": {"en": "Darnytsya", "zh": "Darnytsya"}},
        "CITY::gn::13580096": {"display_name": {"en": "Berezniaky", "zh": "Berezniaky"}},
        "CITY::gn::13580098": {"display_name": {"en": "Voskresenka", "zh": "Voskresenka"}},
        "CITY::gn::13580099": {"display_name": {"en": "Stare Misto", "zh": "Stare Misto"}},
        "CITY::gn::13580102": {"display_name": {"en": "Lypky", "zh": "Lypky"}},
        "CITY::gn::13580113": {"display_name": {"en": "Vidradnyi", "zh": "Vidradnyi"}},
        "CITY::gn::13580115": {"display_name": {"en": "Chokolivka", "zh": "Chokolivka"}},
        "CITY::gn::13580117": {"display_name": {"en": "Darnytskyi Masyv", "zh": "Darnytskyi Masyv"}},
        "CITY::gn::13580121": {"display_name": {"en": "Rayduzhnyi Masyv", "zh": "Rayduzhnyi Masyv"}},
        "CITY::gn::13580126": {"display_name": {"en": "Syrets", "zh": "Syrets"}},
        "CITY::gn::13580127": {"display_name": {"en": "Kurenivka", "zh": "Kurenivka"}},
        "CITY::gn::13580129": {"display_name": {"en": "Tatarka", "zh": "Tatarka"}},
        "CITY::gn::13580130": {"display_name": {"en": "Shulyavka", "zh": "Shulyavka"}},
        "CITY::gn::13580132": {"display_name": {"en": "Galagany", "zh": "Galagany"}},
        "CITY::gn::13580135": {"display_name": {"en": "Lukyanivka", "zh": "Lukyanivka"}},
        "CITY::gn::13580316": {"display_name": {"en": "Mykilska Borshchahivka", "zh": "Mykilska Borshchahivka"}},
        "CITY::gn::13580317": {"display_name": {"en": "Kharkivskyi Masyv", "zh": "Kharkivskyi Masyv"}},
        "CITY::gn::13580318": {"display_name": {"en": "Pivnichni Osokorky", "zh": "Pivnichni Osokorky"}},
        "CITY::gn::13580319": {"display_name": {"en": "Klov", "zh": "Klov"}},
        "CITY::gn::13580320": {"display_name": {"en": "Zvirynets", "zh": "Zvirynets"}},
        "CITY::gn::13580322": {"display_name": {"en": "Kybalchych", "zh": "Kybalchych"}},
        "CITY::gn::13580323": {"display_name": {"en": "Pivnichno-Brovarskyi Masyv", "zh": "Pivnichno-Brovarskyi Masyv"}},
        "CITY::gn::13580324": {"display_name": {"en": "Rusanivka", "zh": "Rusanivka"}},
        "CITY::gn::13589474": {"display_name": {"en": "Saperna Slobidka", "zh": "Saperna Slobidka"}},
        "CITY::gn::145778": {"display_name": {"en": "Chitato", "zh": "希塔托"}},
        "CITY::gn::148942": {"display_name": {"en": "Vwawa", "zh": "夫瓦瓦"}},
        "CITY::gn::149581": {"display_name": {"en": "Tarime", "zh": "塔里梅"}},
        "CITY::gn::160892": {"display_name": {"en": "Bunda", "zh": "本达"}},
        "CITY::gn::161218": {"display_name": {"en": "Bariadi", "zh": "巴里亚迪"}},
        "CITY::gn::174875": {"display_name": {"en": "Kapan", "zh": "卡潘"}},
        "CITY::gn::201463": {"display_name": {"en": "Rwamagana", "zh": "鲁瓦马加纳"}},
        "CITY::gn::2229798": {"display_name": {"en": "Kousseri", "zh": "库塞里"}},
        "CITY::gn::2239076": {"display_name": {"en": "N'dalatando", "zh": "恩达拉坦多"}},
        "CITY::gn::2239888": {"display_name": {"en": "Maianga", "zh": "迈安加"}},
        "CITY::gn::225835": {"display_name": {"en": "Yumbe", "zh": "永贝"}},
        "CITY::gn::225964": {"display_name": {"en": "Wakiso", "zh": "瓦基索"}},
        "CITY::gn::226600": {"display_name": {"en": "Rukungiri", "zh": "鲁昆吉里"}},
        "CITY::gn::226690": {"display_name": {"en": "Rubanda", "zh": "鲁班达"}},
        "CITY::gn::227843": {"display_name": {"en": "Ngora", "zh": "恩戈拉"}},
        "CITY::gn::228094": {"display_name": {"en": "Namutumba", "zh": "纳穆通巴"}},
        "CITY::gn::228853": {"display_name": {"en": "Mukono", "zh": "穆科诺"}},
        "CITY::gn::229292": {"display_name": {"en": "Mayuge", "zh": "马尤盖"}},
        "CITY::gn::229746": {"display_name": {"en": "Luwero", "zh": "卢韦罗"}},
        "CITY::gn::230299": {"display_name": {"en": "Kyenjojo", "zh": "基延乔乔"}},
        "CITY::gn::230331": {"display_name": {"en": "Kyegegwa", "zh": "基耶盖格瓦"}},
        "CITY::gn::230617": {"display_name": {"en": "Kotido", "zh": "科蒂多"}},
        "CITY::gn::230725": {"display_name": {"en": "Koboko", "zh": "科博科"}},
        "CITY::gn::2309332": {"display_name": {"en": "Ebebiyin", "zh": "埃贝比因"}},
        "CITY::gn::232235": {"display_name": {"en": "Kapchorwa", "zh": "卡普乔鲁瓦"}},
        "CITY::gn::232287": {"display_name": {"en": "Kanungu", "zh": "卡农古"}},
        "CITY::gn::232371": {"display_name": {"en": "Kamwenge", "zh": "卡姆文盖"}},
        "CITY::gn::232526": {"display_name": {"en": "Kaliro", "zh": "卡利罗"}},
        "CITY::gn::232619": {"display_name": {"en": "Kakumiro", "zh": "卡卡米罗"}},
        "CITY::gn::232834": {"display_name": {"en": "Kagadi", "zh": "卡加迪"}},
        "CITY::gn::233299": {"display_name": {"en": "Ibanda", "zh": "伊班达"}},
        "CITY::gn::233312": {"display_name": {"en": "Hoima", "zh": "霍伊马"}},
        "CITY::gn::233840": {"display_name": {"en": "Buyende", "zh": "布延德"}},
        "CITY::gn::234004": {"display_name": {"en": "Butaleja", "zh": "布塔莱贾"}},
        "CITY::gn::234178": {"display_name": {"en": "Bundibugyo", "zh": "本迪布焦"}},
        "CITY::gn::2342192": {"display_name": {"en": "Gamboru", "zh": "甘博鲁"}},
        "CITY::gn::234565": {"display_name": {"en": "Bugiri", "zh": "布吉里"}},
        "CITY::gn::234658": {"display_name": {"en": "Budaka", "zh": "布达卡"}},
        "CITY::gn::235130": {"display_name": {"en": "Apac", "zh": "阿帕克"}},
        "CITY::gn::2383523": {"display_name": {"en": "Paoua", "zh": "保阿"}},
        "CITY::gn::2388873": {"display_name": {"en": "Bimbo", "zh": "比姆博"}},
        "CITY::gn::2389422": {"display_name": {"en": "Begoua", "zh": "贝古阿"}},
        "CITY::gn::2389691": {"display_name": {"en": "Batangafo", "zh": "巴坦加福"}},
        "CITY::gn::2428228": {"display_name": {"en": "Massakory", "zh": "马萨科里"}},
        "CITY::gn::2429605": {"display_name": {"en": "Koumra", "zh": "库姆拉"}},
        "CITY::gn::243787": {"display_name": {"en": "Goz Beida", "zh": "戈兹贝达"}},
        "CITY::gn::2591949": {"display_name": {"en": "Cazenga", "zh": "卡曾加"}},
        "CITY::gn::2591976": {"display_name": {"en": "Talatona", "zh": "塔拉托纳"}},
        "CITY::gn::2593460": {"display_name": {"en": "Masina", "zh": "马西纳"}},
        "CITY::gn::2783081": {"display_name": {"en": "Zwijndrecht", "zh": "兹韦因德雷赫特"}},
        "CITY::gn::2783089": {"display_name": {"en": "Zwevegem", "zh": "兹韦海姆"}},
        "CITY::gn::2783175": {"display_name": {"en": "Zottegem", "zh": "佐特海姆"}},
        "CITY::gn::2783188": {"display_name": {"en": "Zonhoven", "zh": "宗霍芬"}},
        "CITY::gn::2783197": {"display_name": {"en": "Zolder", "zh": "佐尔德尔"}},
        "CITY::gn::2783274": {"display_name": {"en": "Zemst", "zh": "泽姆斯特"}},
        "CITY::gn::2783293": {"display_name": {"en": "Zele", "zh": "泽勒"}},
        "CITY::gn::2783308": {"display_name": {"en": "Zedelgem", "zh": "泽德尔海姆"}},
        "CITY::gn::2783310": {"display_name": {"en": "Zaventem", "zh": "扎芬特姆"}},
        "CITY::gn::2783456": {"display_name": {"en": "Wondelgem", "zh": "翁德尔海姆"}},
        "CITY::gn::2783476": {"display_name": {"en": "Woluwe-Saint-Lambert", "zh": "圣兰伯特-沃吕韦"}},
        "CITY::gn::2783615": {"display_name": {"en": "Wilrijk", "zh": "维尔赖克"}},
        "CITY::gn::2783632": {"display_name": {"en": "Willebroek", "zh": "威勒布鲁克"}},
        "CITY::gn::2783759": {"display_name": {"en": "Wevelgem", "zh": "韦弗海姆"}},
        "CITY::gn::2783763": {"display_name": {"en": "Wetteren", "zh": "韦特伦"}},
        "CITY::gn::2783801": {"display_name": {"en": "Westerlo", "zh": "韦斯特洛"}},
        "CITY::gn::2783820": {"display_name": {"en": "Wervik", "zh": "韦尔维克"}},
        "CITY::gn::2783941": {"display_name": {"en": "Wavre", "zh": "瓦夫尔"}},
        "CITY::gn::2783979": {"display_name": {"en": "Watermael-Boitsfort", "zh": "沃特马尔-博茨福特"}},
        "CITY::gn::2783985": {"display_name": {"en": "Waterloo", "zh": "滑铁卢"}},
        "CITY::gn::2784068": {"display_name": {"en": "Waregem", "zh": "瓦勒海姆"}},
        "CITY::gn::2784189": {"display_name": {"en": "Walcourt", "zh": "瓦尔库尔"}},
        "CITY::gn::2784548": {"display_name": {"en": "Vise", "zh": "维塞"}},
        "CITY::gn::2784604": {"display_name": {"en": "Vilvoorde", "zh": "维尔福德"}},
        "CITY::gn::2784821": {"display_name": {"en": "Velwisch", "zh": "费尔维施"}},
        "CITY::gn::2785123": {"display_name": {"en": "Uccle", "zh": "于克勒"}},
        "CITY::gn::2785141": {"display_name": {"en": "Turnhout", "zh": "图恩豪特"}},
        "CITY::gn::2785169": {"display_name": {"en": "Tubize", "zh": "蒂比兹"}},
        "CITY::gn::2785341": {"display_name": {"en": "Dornick", "zh": "多尔尼克"}},
        "CITY::gn::2785364": {"display_name": {"en": "Torhout", "zh": "托尔豪特"}},
        "CITY::gn::2785389": {"display_name": {"en": "Tongern", "zh": "通厄恩"}},
        "CITY::gn::2785470": {"display_name": {"en": "Tienen", "zh": "蒂嫩"}},
        "CITY::gn::2785476": {"display_name": {"en": "Thielt", "zh": "蒂尔特"}},
        "CITY::gn::2785612": {"display_name": {"en": "Tessenderlo", "zh": "泰森德洛"}},
        "CITY::gn::2785622": {"display_name": {"en": "Tervuren", "zh": "特尔菲伦"}},
        "CITY::gn::2785778": {"display_name": {"en": "Temse", "zh": "特姆瑟"}},
        "CITY::gn::2786087": {"display_name": {"en": "Stekene", "zh": "斯泰克内"}},
        "CITY::gn::2786229": {"display_name": {"en": "Stabroek", "zh": "斯塔布鲁克"}},
        "CITY::gn::2786344": {"display_name": {"en": "Soumagne", "zh": "苏马涅"}},
        "CITY::gn::2786420": {"display_name": {"en": "Zinnik", "zh": "济尼克"}},
        "CITY::gn::2786545": {"display_name": {"en": "Sint-Truiden", "zh": "圣特赖登"}},
        "CITY::gn::2786559": {"display_name": {"en": "Sint-Pieters-Leeuw", "zh": "圣彼得斯-吕乌"}},
        "CITY::gn::2786578": {"display_name": {"en": "Sankt Nikolaus", "zh": "圣尼古劳斯"}},
        "CITY::gn::2786634": {"display_name": {"en": "Sint-Kruis", "zh": "圣克吕伊斯"}},
        "CITY::gn::2786641": {"display_name": {"en": "Sint-Katelijne-Waver", "zh": "圣卡特莱讷-瓦弗尔"}},
        "CITY::gn::2786694": {"display_name": {"en": "Sint-Gillis-Waas", "zh": "圣希利斯-瓦斯"}},
        "CITY::gn::2786700": {"display_name": {"en": "Sint-Genesius-Rode", "zh": "圣赫内修斯-罗德"}},
        "CITY::gn::2786739": {"display_name": {"en": "Sint-Andries", "zh": "圣安德里斯"}},
        "CITY::gn::2786743": {"display_name": {"en": "Sint-Amandsberg", "zh": "圣阿曼兹贝赫"}},
        "CITY::gn::2786824": {"display_name": {"en": "Seraing", "zh": "瑟兰"}},
        "CITY::gn::2786963": {"display_name": {"en": "Schoten", "zh": "斯霍滕"}},
        "CITY::gn::2787048": {"display_name": {"en": "Schilde", "zh": "斯希尔德"}},
        "CITY::gn::2787149": {"display_name": {"en": "Schaerbeek", "zh": "斯哈尔贝克"}},
        "CITY::gn::2787356": {"display_name": {"en": "Saint-Nicolas", "zh": "圣尼古拉"}},
        "CITY::gn::2787387": {"display_name": {"en": "Saint-Josse-ten-Noode", "zh": "圣约斯-滕-诺德"}},
        "CITY::gn::2787413": {"display_name": {"en": "Saint-Gilles", "zh": "圣吉尔"}},
        "CITY::gn::2787416": {"display_name": {"en": "Saint-Ghislain", "zh": "圣吉斯兰"}},
        "CITY::gn::2787662": {"display_name": {"en": "Rotselaar", "zh": "罗特瑟拉尔"}},
        "CITY::gn::2787769": {"display_name": {"en": "Ronse", "zh": "龙瑟"}},
        "CITY::gn::2787889": {"display_name": {"en": "Russelaere", "zh": "吕瑟拉勒"}},
        "CITY::gn::2787989": {"display_name": {"en": "Rixensart", "zh": "里克桑萨尔"}},
        "CITY::gn::2788088": {"display_name": {"en": "Riemst", "zh": "里姆斯特"}},
        "CITY::gn::2788348": {"display_name": {"en": "Ranst", "zh": "兰斯特"}},
        "CITY::gn::2788499": {"display_name": {"en": "Quaregnon", "zh": "卡雷尼翁"}},
        "CITY::gn::2788506": {"display_name": {"en": "Puurs", "zh": "普尔斯"}},
        "CITY::gn::2788521": {"display_name": {"en": "Putte", "zh": "普特"}},
        "CITY::gn::2788726": {"display_name": {"en": "Poperinge", "zh": "波珀灵厄"}},
        "CITY::gn::2788765": {"display_name": {"en": "Pont-a-Celles", "zh": "蓬塔塞勒"}},
        "CITY::gn::2789162": {"display_name": {"en": "Peruwelz", "zh": "佩吕韦尔"}},
        "CITY::gn::2789232": {"display_name": {"en": "Peer", "zh": "佩尔"}},
        "CITY::gn::2789413": {"display_name": {"en": "Overijse", "zh": "奥弗赖瑟"}},
        "CITY::gn::2789471": {"display_name": {"en": "Oupeye", "zh": "乌佩耶"}},
        "CITY::gn::2789529": {"display_name": {"en": "Oudenaarde", "zh": "奥德纳尔德"}},
        "CITY::gn::2789751": {"display_name": {"en": "Oostkamp", "zh": "奥斯特坎普"}},
        "CITY::gn::2789786": {"display_name": {"en": "Ostend", "zh": "奥斯坦德"}},
        "CITY::gn::2790101": {"display_name": {"en": "Nivelles", "zh": "尼韦尔"}},
        "CITY::gn::2790114": {"display_name": {"en": "Ninove", "zh": "尼诺弗"}},
        "CITY::gn::2790135": {"display_name": {"en": "Nijlen", "zh": "奈伦"}},
        "CITY::gn::2790357": {"display_name": {"en": "Neerpelt", "zh": "尼尔佩尔特"}},
        "CITY::gn::2790595": {"display_name": {"en": "Mouscron", "zh": "穆斯克龙"}},
        "CITY::gn::2790676": {"display_name": {"en": "Mortsel", "zh": "莫尔特塞尔"}},
        "CITY::gn::2790697": {"display_name": {"en": "Morlanwelz-Mariemont", "zh": "莫尔朗韦尔-马里耶蒙"}},
        "CITY::gn::2790796": {"display_name": {"en": "Montignies-sur-Sambre", "zh": "桑布尔河畔蒙蒂尼"}},
        "CITY::gn::2791018": {"display_name": {"en": "Molenbeek-Saint-Jean", "zh": "圣扬斯-莫伦贝克"}},
        "CITY::gn::2791067": {"display_name": {"en": "Mol", "zh": "莫尔"}},
        "CITY::gn::2791194": {"display_name": {"en": "Middelkerke", "zh": "米德尔克尔克"}},
        "CITY::gn::2791301": {"display_name": {"en": "Merksem", "zh": "梅尔克瑟姆"}},
        "CITY::gn::2791315": {"display_name": {"en": "Merelbeke", "zh": "梅勒贝克"}},
        "CITY::gn::2791343": {"display_name": {"en": "Menen", "zh": "梅嫩"}},
        "CITY::gn::2791424": {"display_name": {"en": "Meise", "zh": "梅瑟"}},
        "CITY::gn::2791534": {"display_name": {"en": "Mechelen-aan-de-Maas", "zh": "默赫伦-安德马斯"}},
        "CITY::gn::2791537": {"display_name": {"en": "Mecheln", "zh": "梅赫伦"}},
        "CITY::gn::2791700": {"display_name": {"en": "Mariakerke", "zh": "马里亚克尔克"}},
        "CITY::gn::2791726": {"display_name": {"en": "Marcinelle", "zh": "马尔西内勒"}},
        "CITY::gn::2791735": {"display_name": {"en": "Marchienne-au-Pont", "zh": "桥畔马尔希耶讷"}},
        "CITY::gn::2791744": {"display_name": {"en": "Marche-en-Famenne", "zh": "马尔什昂法梅讷"}},
        "CITY::gn::2791814": {"display_name": {"en": "Manage", "zh": "马纳热"}},
        "CITY::gn::2791857": {"display_name": {"en": "Maldegem", "zh": "马尔德海姆"}},
        "CITY::gn::2791961": {"display_name": {"en": "Maasmechelen", "zh": "马斯梅赫伦"}},
        "CITY::gn::2791964": {"display_name": {"en": "Maaseik", "zh": "马瑟克"}},
        "CITY::gn::2792073": {"display_name": {"en": "Louvain-la-Neuve", "zh": "新鲁汶"}},
        "CITY::gn::2792179": {"display_name": {"en": "Lommel", "zh": "洛默尔"}},
        "CITY::gn::2792196": {"display_name": {"en": "Lokeren", "zh": "洛克伦"}},
        "CITY::gn::2792235": {"display_name": {"en": "Lochristi", "zh": "洛赫里斯蒂"}},
        "CITY::gn::2792360": {"display_name": {"en": "Lille", "zh": "里勒"}},
        "CITY::gn::2792397": {"display_name": {"en": "Lier", "zh": "利尔"}},
        "CITY::gn::2792482": {"display_name": {"en": "Löwen", "zh": "勒汶"}},
        "CITY::gn::2792567": {"display_name": {"en": "Lessines", "zh": "莱塞讷"}},
        "CITY::gn::2793077": {"display_name": {"en": "Lede", "zh": "莱德"}},
        "CITY::gn::2793144": {"display_name": {"en": "Lebbeke", "zh": "莱贝克"}},
        "CITY::gn::2793446": {"display_name": {"en": "Lanaken", "zh": "拉纳肯"}},
        "CITY::gn::2793508": {"display_name": {"en": "La Louviere", "zh": "拉卢维耶尔"}},
        "CITY::gn::2794055": {"display_name": {"en": "Kortreik", "zh": "科特赖克"}},
        "CITY::gn::2794070": {"display_name": {"en": "Kortenberg", "zh": "科滕贝赫"}},
        "CITY::gn::2794117": {"display_name": {"en": "Kontich", "zh": "孔蒂赫"}},
        "CITY::gn::2794166": {"display_name": {"en": "Koksijde", "zh": "科克赛德"}},
        "CITY::gn::2794179": {"display_name": {"en": "Koersel", "zh": "库尔瑟尔"}},
        "CITY::gn::2794190": {"display_name": {"en": "Koekelberg", "zh": "库克尔贝格"}},
        "CITY::gn::2794210": {"display_name": {"en": "Knokke-Heist", "zh": "克诺克-海斯特"}},
        "CITY::gn::2794507": {"display_name": {"en": "Kessel-Lo", "zh": "凯塞尔洛"}},
        "CITY::gn::2794663": {"display_name": {"en": "Kasterlee", "zh": "卡斯特莱"}},
        "CITY::gn::2794730": {"display_name": {"en": "Kapellen", "zh": "卡佩伦"}},
        "CITY::gn::2794788": {"display_name": {"en": "Kalmthout", "zh": "卡尔姆特豪特"}},
        "CITY::gn::2794860": {"display_name": {"en": "Jumet", "zh": "朱梅"}},
        "CITY::gn::2794914": {"display_name": {"en": "Jette", "zh": "热特"}},
        "CITY::gn::2794981": {"display_name": {"en": "Jambes", "zh": "雅姆布"}},
        "CITY::gn::2795009": {"display_name": {"en": "Izegem", "zh": "伊泽海姆"}},
        "CITY::gn::2795011": {"display_name": {"en": "Ixelles", "zh": "伊克塞尔"}},
        "CITY::gn::2795100": {"display_name": {"en": "Ypern", "zh": "伊珀恩"}},
        "CITY::gn::2795113": {"display_name": {"en": "Hoei", "zh": "胡伊"}},
        "CITY::gn::2795261": {"display_name": {"en": "Houthalen", "zh": "豪塔伦"}},
        "CITY::gn::2795398": {"display_name": {"en": "Hoogstraten", "zh": "霍赫斯特拉滕"}},
        "CITY::gn::2795730": {"display_name": {"en": "Hoboken", "zh": "霍博肯"}},
        "CITY::gn::2795783": {"display_name": {"en": "Heverlee", "zh": "海弗尔利"}},
        "CITY::gn::2795795": {"display_name": {"en": "Heusy", "zh": "赫西"}},
        "CITY::gn::2795800": {"display_name": {"en": "Heusden", "zh": "海斯登"}},
        "CITY::gn::2795908": {"display_name": {"en": "Herzele", "zh": "赫尔泽勒"}},
        "CITY::gn::2795912": {"display_name": {"en": "Herve", "zh": "埃尔弗"}},
        "CITY::gn::2795930": {"display_name": {"en": "Herstal", "zh": "赫尔斯塔尔"}},
        "CITY::gn::2796009": {"display_name": {"en": "Herentals", "zh": "赫伦塔尔斯"}},
        "CITY::gn::2796012": {"display_name": {"en": "Herent", "zh": "赫伦特"}},
        "CITY::gn::2796132": {"display_name": {"en": "Helchteren", "zh": "赫尔赫特伦"}},
        "CITY::gn::2796153": {"display_name": {"en": "Heist-op-den-Berg", "zh": "海斯特奥普登贝尔赫"}},
        "CITY::gn::2796542": {"display_name": {"en": "Harelbeke", "zh": "哈勒贝克"}},
        "CITY::gn::2796637": {"display_name": {"en": "Hamme", "zh": "哈默"}},
        "CITY::gn::2796696": {"display_name": {"en": "Halle", "zh": "哈勒"}},
        "CITY::gn::2796833": {"display_name": {"en": "Haaltert", "zh": "哈尔特尔特"}},
        "CITY::gn::2797096": {"display_name": {"en": "Grivegnee", "zh": "格里弗涅"}},
        "CITY::gn::2797114": {"display_name": {"en": "Grimbergen", "zh": "格里姆贝亨"}},
        "CITY::gn::2797532": {"display_name": {"en": "Gilly", "zh": "吉利"}},
        "CITY::gn::2797638": {"display_name": {"en": "Geraardsbergen", "zh": "赫拉尔兹贝亨"}},
        "CITY::gn::2797652": {"display_name": {"en": "Gentbrugge", "zh": "根特布鲁赫"}},
        "CITY::gn::2797670": {"display_name": {"en": "Genk", "zh": "亨克"}},
        "CITY::gn::2797713": {"display_name": {"en": "Gembloux", "zh": "热姆布卢"}},
        "CITY::gn::2797779": {"display_name": {"en": "Geel", "zh": "海尔"}},
        "CITY::gn::2797844": {"display_name": {"en": "Ganshoren", "zh": "甘肖伦"}},
        "CITY::gn::2798023": {"display_name": {"en": "Frameries", "zh": "弗拉梅里"}},
        "CITY::gn::2798139": {"display_name": {"en": "Forest", "zh": "福雷"}},
        "CITY::gn::2798297": {"display_name": {"en": "Fleurus", "zh": "弗勒吕斯"}},
        "CITY::gn::2798301": {"display_name": {"en": "Fleron", "zh": "弗莱龙"}},
        "CITY::gn::2798307": {"display_name": {"en": "Flemalle-Haute", "zh": "上弗莱马勒"}},
        "CITY::gn::2798551": {"display_name": {"en": "Evergem", "zh": "埃弗海姆"}},
        "CITY::gn::2798554": {"display_name": {"en": "Evere", "zh": "埃韦尔"}},
        "CITY::gn::2798573": {"display_name": {"en": "Eupen", "zh": "欧本"}},
        "CITY::gn::2798578": {"display_name": {"en": "Etterbeek", "zh": "埃特贝克"}},
        "CITY::gn::2798873": {"display_name": {"en": "Ekeren", "zh": "埃克伦"}},
        "CITY::gn::2798987": {"display_name": {"en": "Eeklo", "zh": "埃克洛"}},
        "CITY::gn::2799007": {"display_name": {"en": "Edegem", "zh": "埃德海姆"}},
        "CITY::gn::2799090": {"display_name": {"en": "Duffel", "zh": "达菲尔"}},
        "CITY::gn::2799226": {"display_name": {"en": "Dour", "zh": "杜尔"}},
        "CITY::gn::2799365": {"display_name": {"en": "Dilbeek", "zh": "迪尔贝克"}},
        "CITY::gn::2799369": {"display_name": {"en": "Diksmuide", "zh": "迪克斯迈德"}},
        "CITY::gn::2799397": {"display_name": {"en": "Diest", "zh": "迪斯特"}},
        "CITY::gn::2799412": {"display_name": {"en": "Diepenbeek", "zh": "迪彭贝克"}},
        "CITY::gn::2799478": {"display_name": {"en": "Deurne", "zh": "德尔讷"}},
        "CITY::gn::2799496": {"display_name": {"en": "Destelbergen", "zh": "德斯特尔贝亨"}},
        "CITY::gn::2799645": {"display_name": {"en": "Dendermünde", "zh": "登德明德"}},
        "CITY::gn::2799647": {"display_name": {"en": "Denderleeuw", "zh": "登德尔勒乌"}},
        "CITY::gn::2799746": {"display_name": {"en": "Deinze", "zh": "丹泽"}},
        "CITY::gn::2800063": {"display_name": {"en": "Courcelles", "zh": "库塞勒"}},
        "CITY::gn::2800220": {"display_name": {"en": "Colfontaine", "zh": "科尔丰丹"}},
        "CITY::gn::2800438": {"display_name": {"en": "Chaudfontaine", "zh": "肖德方丹"}},
        "CITY::gn::2800445": {"display_name": {"en": "Chatelineau", "zh": "沙泰利诺"}},
        "CITY::gn::2800448": {"display_name": {"en": "Chatelet", "zh": "沙特莱"}},
        "CITY::gn::2801117": {"display_name": {"en": "Brasschaat", "zh": "布拉斯哈特"}},
        "CITY::gn::2801150": {"display_name": {"en": "Braine-le-Comte", "zh": "布赖讷勒孔特"}},
        "CITY::gn::2801154": {"display_name": {"en": "Braine-l'Alleud", "zh": "布赖讷拉勒"}},
        "CITY::gn::2801226": {"display_name": {"en": "Boussu", "zh": "布苏"}},
        "CITY::gn::2801447": {"display_name": {"en": "Bornem", "zh": "博尔内姆"}},
        "CITY::gn::2801471": {"display_name": {"en": "Borgerhout", "zh": "博赫豪特"}},
        "CITY::gn::2801494": {"display_name": {"en": "Boom", "zh": "博姆"}},
        "CITY::gn::2801824": {"display_name": {"en": "Blauwput", "zh": "布劳普特"}},
        "CITY::gn::2801858": {"display_name": {"en": "Blankenberge", "zh": "布兰肯贝赫"}},
        "CITY::gn::2801922": {"display_name": {"en": "Binche", "zh": "宾什"}},
        "CITY::gn::2801924": {"display_name": {"en": "Bilzen", "zh": "比尔岑"}},
        "CITY::gn::2802031": {"display_name": {"en": "Beveren", "zh": "贝弗伦"}},
        "CITY::gn::2802039": {"display_name": {"en": "Bevere", "zh": "贝弗勒"}},
        "CITY::gn::2802170": {"display_name": {"en": "Beringen", "zh": "贝林根"}},
        "CITY::gn::2802247": {"display_name": {"en": "Berchem-Sainte-Agathe", "zh": "圣阿加特-贝尔赫姆"}},
        "CITY::gn::2802249": {"display_name": {"en": "Berchem", "zh": "贝尔赫姆"}},
        "CITY::gn::2802433": {"display_name": {"en": "Beersel", "zh": "贝尔瑟尔"}},
        "CITY::gn::2802435": {"display_name": {"en": "Beerse", "zh": "贝尔瑟"}},
        "CITY::gn::2802743": {"display_name": {"en": "Balen", "zh": "巴伦"}},
        "CITY::gn::2802960": {"display_name": {"en": "Auderghem", "zh": "奥德尔海姆"}},
        "CITY::gn::2803010": {"display_name": {"en": "Aat", "zh": "阿特"}},
        "CITY::gn::2803030": {"display_name": {"en": "Assebroek", "zh": "阿瑟布鲁克"}},
        "CITY::gn::2803033": {"display_name": {"en": "Asse", "zh": "阿瑟"}},
        "CITY::gn::2803160": {"display_name": {"en": "Ans", "zh": "安斯"}},
        "CITY::gn::2803201": {"display_name": {"en": "Anderlecht", "zh": "安德莱赫特"}},
        "CITY::gn::2803204": {"display_name": {"en": "Andenne", "zh": "安登"}},
        "CITY::gn::2803429": {"display_name": {"en": "Aarschot", "zh": "阿尔斯霍特"}},
        "CITY::gn::2803443": {"display_name": {"en": "Aalter", "zh": "阿尔特尔"}},
        "CITY::gn::2803448": {"display_name": {"en": "Aalst", "zh": "阿尔斯特"}},
        "CITY::gn::2967421": {"display_name": {"en": "Wattrelos", "zh": "瓦特勒洛"}},
        "CITY::gn::2967438": {"display_name": {"en": "Wasquehal", "zh": "瓦斯克哈尔"}},
        "CITY::gn::2967856": {"display_name": {"en": "Vitry-le-Francois", "zh": "维特里勒弗朗索瓦"}},
        "CITY::gn::2968368": {"display_name": {"en": "Villers-les-Nancy", "zh": "维莱莱南锡"}},
        "CITY::gn::2969562": {"display_name": {"en": "Vesoul", "zh": "维苏尔"}},
        "CITY::gn::2969958": {"display_name": {"en": "Verden an der Maas", "zh": "马斯河畔韦尔登"}},
        "CITY::gn::2970797": {"display_name": {"en": "Vandoeuvre-les-Nancy", "zh": "旺德夫尔莱南锡"}},
        "CITY::gn::2971041": {"display_name": {"en": "Schwanenthal", "zh": "施瓦嫩塔尔"}},
        "CITY::gn::2972284": {"display_name": {"en": "Tourcoing", "zh": "图尔宽"}},
        "CITY::gn::2972350": {"display_name": {"en": "Tull", "zh": "图尔"}},
        "CITY::gn::2973146": {"display_name": {"en": "Tergnier", "zh": "泰尔尼耶"}},
        "CITY::gn::2974494": {"display_name": {"en": "Sin-le-Noble", "zh": "锡南勒诺布勒"}},
        "CITY::gn::2975349": {"display_name": {"en": "Sedan", "zh": "色当"}},
        "CITY::gn::2977295": {"display_name": {"en": "Saint-Quentin", "zh": "圣康坦"}},
        "CITY::gn::2977388": {"display_name": {"en": "Saint-Pol-sur-Mer", "zh": "滨海圣波勒"}},
        "CITY::gn::2977845": {"display_name": {"en": "Sint-Omaars", "zh": "圣奥马尔斯"}},
        "CITY::gn::2980816": {"display_name": {"en": "Saint-Dizier", "zh": "圣迪济耶"}},
        "CITY::gn::2980827": {"display_name": {"en": "Saint-Die-des-Vosges", "zh": "孚日圣迪耶"}},
        "CITY::gn::2981839": {"display_name": {"en": "Saint-Amand-les-Eaux", "zh": "圣阿芒莱索"}},
        "CITY::gn::2982681": {"display_name": {"en": "Roubaix", "zh": "鲁贝"}},
        "CITY::gn::2982944": {"display_name": {"en": "Ronchin", "zh": "龙尚"}},
        "CITY::gn::2986302": {"display_name": {"en": "Pontarlier", "zh": "蓬塔利耶"}},
        "CITY::gn::2986306": {"display_name": {"en": "Pont-a-Mousson", "zh": "蓬塔穆松"}},
        "CITY::gn::2988936": {"display_name": {"en": "Outreau", "zh": "乌特罗"}},
        "CITY::gn::2992938": {"display_name": {"en": "Mömpelgard", "zh": "蒙佩尔加德"}},
        "CITY::gn::2993207": {"display_name": {"en": "Mons-en-Baroeul", "zh": "蒙桑巴勒"}},
        "CITY::gn::2995150": {"display_name": {"en": "Maubeuge", "zh": "莫伯日"}},
        "CITY::gn::2995908": {"display_name": {"en": "Marcq-en-Baroeul", "zh": "马克昂巴勒尔"}},
        "CITY::gn::2997110": {"display_name": {"en": "Luneville", "zh": "吕内维尔"}},
        "CITY::gn::2997620": {"display_name": {"en": "Loos", "zh": "洛斯"}},
        "CITY::gn::2997803": {"display_name": {"en": "Lomme", "zh": "洛姆"}},
        "CITY::gn::2998431": {"display_name": {"en": "Lievin", "zh": "列万"}},
        "CITY::gn::3003093": {"display_name": {"en": "Lens", "zh": "朗斯"}},
        "CITY::gn::3005417": {"display_name": {"en": "Laxou", "zh": "拉克苏"}},
        "CITY::gn::3007477": {"display_name": {"en": "Laon", "zh": "拉昂"}},
        "CITY::gn::3008218": {"display_name": {"en": "Lambersart", "zh": "兰贝萨尔"}},
        "CITY::gn::3008379": {"display_name": {"en": "La Madeleine", "zh": "拉马德莱娜"}},
        "CITY::gn::3013525": {"display_name": {"en": "Henin-Beaumont", "zh": "埃南-博蒙"}},
        "CITY::gn::3013549": {"display_name": {"en": "Hem", "zh": "埃姆"}},
        "CITY::gn::3013619": {"display_name": {"en": "Hazebrouck", "zh": "阿泽布鲁克"}},
        "CITY::gn::3013681": {"display_name": {"en": "Hautmont", "zh": "欧蒙"}},
        "CITY::gn::3013862": {"display_name": {"en": "Haubourdin", "zh": "奥布尔丹"}},
        "CITY::gn::3014034": {"display_name": {"en": "Halluin", "zh": "哈吕安"}},
        "CITY::gn::3015160": {"display_name": {"en": "Grande-Synthe", "zh": "大桑特"}},
        "CITY::gn::3019153": {"display_name": {"en": "Faches-Thumesnil", "zh": "法什-蒂梅尼勒"}},
        "CITY::gn::3020035": {"display_name": {"en": "Spinneln", "zh": "施平嫩"}},
        "CITY::gn::3020686": {"display_name": {"en": "Dünkirchen", "zh": "敦基兴"}},
        "CITY::gn::3021000": {"display_name": {"en": "Dowaai", "zh": "多瓦伊"}},
        "CITY::gn::3021605": {"display_name": {"en": "Denain", "zh": "德南"}},
        "CITY::gn::3022376": {"display_name": {"en": "Croix", "zh": "克鲁瓦"}},
        "CITY::gn::3023356": {"display_name": {"en": "Coudekerque-Branche", "zh": "古德凯尔克-布朗什"}},
        "CITY::gn::3025892": {"display_name": {"en": "Chaumont", "zh": "肖蒙"}},
        "CITY::gn::3026613": {"display_name": {"en": "Charleville-Mezieres", "zh": "沙勒维尔-梅济耶尔"}},
        "CITY::gn::3027487": {"display_name": {"en": "Chalons-en-Champagne", "zh": "香槟沙隆"}},
        "CITY::gn::3028486": {"display_name": {"en": "Carvin", "zh": "卡尔万"}},
        "CITY::gn::3029030": {"display_name": {"en": "Kamerich", "zh": "卡默里希"}},
        "CITY::gn::3029825": {"display_name": {"en": "Bruay-la-Buissiere", "zh": "布吕埃拉比西耶尔"}},
        "CITY::gn::3031133": {"display_name": {"en": "Bonen", "zh": "博嫩"}},
        "CITY::gn::3033002": {"display_name": {"en": "Betun", "zh": "贝蒂讷"}},
        "CITY::gn::3033415": {"display_name": {"en": "Berck", "zh": "贝尔克"}},
        "CITY::gn::3033416": {"display_name": {"en": "Berck-Plage", "zh": "贝尔克海滩"}},
        "CITY::gn::3034911": {"display_name": {"en": "Herzogenbar", "zh": "黑尔措根巴尔"}},
        "CITY::gn::3035667": {"display_name": {"en": "Avion", "zh": "阿维翁"}},
        "CITY::gn::3036240": {"display_name": {"en": "Audincourt", "zh": "欧丹库尔"}},
        "CITY::gn::3036903": {"display_name": {"en": "Armentieres", "zh": "阿尔芒蒂耶尔"}},
        "CITY::gn::3038789": {"display_name": {"en": "Abbeville", "zh": "阿布维尔"}},
        "CITY::gn::3080985": {"display_name": {"en": "Zabrze", "zh": "扎布热"}},
        "CITY::gn::3081318": {"display_name": {"en": "Wrzeszcz", "zh": "Wrzeszcz"}},
        "CITY::gn::3083271": {"display_name": {"en": "Thorn", "zh": "托恩"}},
        "CITY::gn::3085128": {"display_name": {"en": "Sosnowitz", "zh": "索斯诺维茨"}},
        "CITY::gn::3089823": {"display_name": {"en": "Osowa", "zh": "Osowa"}},
        "CITY::gn::3098171": {"display_name": {"en": "Grzegorzki", "zh": "Grzegorzki"}},
        "CITY::gn::3100946": {"display_name": {"en": "Tschenstochau", "zh": "琴斯托霍瓦"}},
        "CITY::gn::3103402": {"display_name": {"en": "Bielitz", "zh": "比利茨"}},
        "CITY::gn::3351500": {"display_name": {"en": "Caala", "zh": "卡阿拉"}},
        "CITY::gn::3354021": {"display_name": {"en": "Oshakati", "zh": "奥沙卡蒂"}},
        "CITY::gn::423549": {"display_name": {"en": "Rumonge", "zh": "鲁蒙盖"}},
        "CITY::gn::430021": {"display_name": {"en": "Cibitoke", "zh": "锡比托克"}},
        "CITY::gn::453754": {"display_name": {"en": "Wolmar", "zh": "沃尔马尔"}},
        "CITY::gn::457954": {"display_name": {"en": "Libau", "zh": "利包"}},
        "CITY::gn::459201": {"display_name": {"en": "Jurmala", "zh": "尤尔马拉"}},
        "CITY::gn::459283": {"display_name": {"en": "Jakobstadt", "zh": "雅各布施塔特"}},
        "CITY::gn::460570": {"display_name": {"en": "Cesis", "zh": "采西斯"}},
        "CITY::gn::584923": {"display_name": {"en": "Sumqayit", "zh": "苏姆盖特"}},
        "CITY::gn::585514": {"display_name": {"en": "Mingachevir", "zh": "明盖恰乌尔"}},
        "CITY::gn::585915": {"display_name": {"en": "Khirdalan", "zh": "Khirdalan"}},
        "CITY::gn::589947": {"display_name": {"en": "Nomme", "zh": "诺梅"}},
        "CITY::gn::590447": {"display_name": {"en": "Maardu", "zh": "马尔杜"}},
        "CITY::gn::593672": {"display_name": {"en": "Utena", "zh": "乌田纳"}},
        "CITY::gn::593926": {"display_name": {"en": "Telsiai", "zh": "特尔希艾"}},
        "CITY::gn::593959": {"display_name": {"en": "Taurage", "zh": "陶拉盖"}},
        "CITY::gn::597231": {"display_name": {"en": "Marijampole", "zh": "马里扬波莱"}},
        "CITY::gn::598272": {"display_name": {"en": "Kedainiai", "zh": "凯代尼艾"}},
        "CITY::gn::598818": {"display_name": {"en": "Jonava", "zh": "约纳瓦"}},
        "CITY::gn::601084": {"display_name": {"en": "Alytus", "zh": "阿利图斯"}},
        "CITY::gn::610824": {"display_name": {"en": "Zugdidi", "zh": "祖格迪迪"}},
        "CITY::gn::611694": {"display_name": {"en": "Telavi", "zh": "泰拉维"}},
        "CITY::gn::613988": {"display_name": {"en": "Khashuri", "zh": "哈舒里"}},
        "CITY::gn::614455": {"display_name": {"en": "Gori", "zh": "哥里"}},
        "CITY::gn::616062": {"display_name": {"en": "Vagharshapat", "zh": "瓦加尔沙帕特"}},
        "CITY::gn::616629": {"display_name": {"en": "Hrazdan", "zh": "赫拉兹丹"}},
        "CITY::gn::617026": {"display_name": {"en": "Abovyan", "zh": "阿博维扬"}},
        "CITY::gn::618800": {"display_name": {"en": "Horad Zhodzina", "zh": "若季诺"}},
        "CITY::gn::618806": {"display_name": {"en": "Zhlobin", "zh": "日洛宾"}},
        "CITY::gn::621074": {"display_name": {"en": "Svetlogorsk", "zh": "斯韦特洛戈尔斯克"}},
        "CITY::gn::621741": {"display_name": {"en": "Slutsk", "zh": "斯卢茨克"}},
        "CITY::gn::622428": {"display_name": {"en": "Soligorsk", "zh": "索利戈尔斯克"}},
        "CITY::gn::622794": {"display_name": {"en": "Retschiza", "zh": "雷奇察"}},
        "CITY::gn::624784": {"display_name": {"en": "Novopolotsk", "zh": "新波洛茨克"}},
        "CITY::gn::627145": {"display_name": {"en": "Kobryn", "zh": "科布林"}},
        "CITY::gn::6543862": {"display_name": {"en": "Villeneuve-d'Ascq", "zh": "阿斯克新城"}},
        "CITY::gn::6545326": {"display_name": {"en": "Ursynow", "zh": "Ursynow"}},
        "CITY::gn::6545347": {"display_name": {"en": "Praga Polnoc", "zh": "Praga Polnoc"}},
        "CITY::gn::6545348": {"display_name": {"en": "Praga Poludnie", "zh": "Praga Poludnie"}},
        "CITY::gn::6722148": {"display_name": {"en": "Saltivka", "zh": "Saltivka"}},
        "CITY::gn::6723020": {"display_name": {"en": "Zhuravlivka", "zh": "Zhuravlivka"}},
        "CITY::gn::6723024": {"display_name": {"en": "Pivnichna Saltivka", "zh": "Pivnichna Saltivka"}},
        "CITY::gn::687432": {"display_name": {"en": "Zdolbuniv", "zh": "Zdolbuniv"}},
        "CITY::gn::688758": {"display_name": {"en": "Vyhurivshchyna-Troieshchyna", "zh": "Vyhurivshchyna-Troieshchyna"}},
        "CITY::gn::691605": {"display_name": {"en": "Terny", "zh": "Terny"}},
        "CITY::gn::692909": {"display_name": {"en": "Stara Darnytsya", "zh": "Stara Darnytsya"}},
        "CITY::gn::693805": {"display_name": {"en": "Gotenburg", "zh": "哥滕堡"}},
        "CITY::gn::694423": {"display_name": {"en": "Theoderichshafen", "zh": "狄奥多里希港"}},
        "CITY::gn::697488": {"display_name": {"en": "Pisochyn", "zh": "Pisochyn"}},
        "CITY::gn::698709": {"display_name": {"en": "Ihren", "zh": "Ihren"}},
        "CITY::gn::699871": {"display_name": {"en": "Nova Darnytsya", "zh": "Nova Darnytsya"}},
        "CITY::gn::700022": {"display_name": {"en": "Nyzhnyodniprovsk", "zh": "Nyzhnyodniprovsk"}},
        "CITY::gn::704885": {"display_name": {"en": "Korostyshiv", "zh": "Korostyshiv"}},
        "CITY::gn::706369": {"display_name": {"en": "Khmelnytskyi", "zh": "Khmelnytskyi"}},
        "CITY::gn::707155": {"display_name": {"en": "Kalynivka", "zh": "Kalynivka"}},
        "CITY::gn::711562": {"display_name": {"en": "Bortnychi", "zh": "Bortnychi"}},
        "CITY::gn::712631": {"display_name": {"en": "Bilychi", "zh": "Bilychi"}},
        "CITY::gn::753142": {"display_name": {"en": "Zoliborz", "zh": "Zoliborz"}},
        "CITY::gn::755330": {"display_name": {"en": "Wola", "zh": "Wola"}},
        "CITY::gn::755475": {"display_name": {"en": "Wlochy", "zh": "Wlochy"}},
        "CITY::gn::756092": {"display_name": {"en": "Wawer", "zh": "Wawer"}},
        "CITY::gn::756320": {"display_name": {"en": "Ursus", "zh": "Ursus"}},
        "CITY::gn::757065": {"display_name": {"en": "Targowek", "zh": "Targowek"}},
        "CITY::gn::758470": {"display_name": {"en": "Srodmiescie", "zh": "Srodmiescie"}},
        "CITY::gn::760503": {"display_name": {"en": "Rembertow", "zh": "Rembertow"}},
        "CITY::gn::760778": {"display_name": {"en": "Radom", "zh": "拉多姆"}},
        "CITY::gn::763442": {"display_name": {"en": "Ochota", "zh": "Ochota"}},
        "CITY::gn::764484": {"display_name": {"en": "Mokotow", "zh": "Mokotow"}},
        "CITY::gn::7670934": {"display_name": {"en": "Malatia-Sebastia", "zh": "Malatia-Sebastia"}},
        "CITY::gn::7670941": {"display_name": {"en": "Kentron", "zh": "Kentron"}},
        "CITY::gn::769893": {"display_name": {"en": "Kabaty", "zh": "Kabaty"}},
        "CITY::gn::775984": {"display_name": {"en": "Bienczyce", "zh": "Bienczyce"}},
        "CITY::gn::776029": {"display_name": {"en": "Bielany", "zh": "Bielany"}},
        "CITY::gn::776103": {"display_name": {"en": "Bialoleka", "zh": "Bialoleka"}},
        "CITY::gn::776251": {"display_name": {"en": "Bemowo", "zh": "Bemowo"}},
        "CITY::gn::7911405": {"display_name": {"en": "Isingiro", "zh": "伊辛吉罗"}},
        "CITY::gn::7911406": {"display_name": {"en": "Manafwa", "zh": "马纳夫瓦"}},
        "CITY::gn::8425958": {"display_name": {"en": "Gajowice", "zh": "Gajowice"}},
        "CITY::gn::8425959": {"display_name": {"en": "Gadow-Popowice Poludniowe", "zh": "Gadow-Popowice Poludniowe"}},
        "CITY::gn::8425966": {"display_name": {"en": "Pilczyce-Kozanow-Popowice Polnocne", "zh": "Pilczyce-Kozanow-Popowice Polnocne"}},
        "CITY::gn::8425969": {"display_name": {"en": "Gaj", "zh": "Gaj"}},
        "CITY::gn::8425970": {"display_name": {"en": "Huby", "zh": "Huby"}},
        "CITY::gn::8425972": {"display_name": {"en": "Krzyki-Partynice", "zh": "Krzyki-Partynice"}},
        "CITY::gn::8425974": {"display_name": {"en": "Osiedle Powstancow Slaskich", "zh": "Osiedle Powstancow Slaskich"}},
        "CITY::gn::8425975": {"display_name": {"en": "Przedmiescie Olawskie", "zh": "Przedmiescie Olawskie"}},
        "CITY::gn::8425978": {"display_name": {"en": "Karlowice-Rozanka", "zh": "Karlowice-Rozanka"}},
        "CITY::gn::8425982": {"display_name": {"en": "Psie Pole Zawidawie", "zh": "Psie Pole Zawidawie"}},
        "CITY::gn::8425986": {"display_name": {"en": "Szczepin", "zh": "Szczepin"}},
        "CITY::gn::8425987": {"display_name": {"en": "Biskupin-Sepolno-Dabie-Bartoszowice", "zh": "Biskupin-Sepolno-Dabie-Bartoszowice"}},
        "CITY::gn::8425988": {"display_name": {"en": "Nadodrze", "zh": "Nadodrze"}},
        "CITY::gn::8425989": {"display_name": {"en": "Olbin", "zh": "Olbin"}},
        "CITY::gn::8426032": {"display_name": {"en": "Chelm", "zh": "Chelm"}},
        "CITY::gn::8426039": {"display_name": {"en": "Piecki-Migowo", "zh": "Piecki-Migowo"}},
        "CITY::gn::8426041": {"display_name": {"en": "Przymorze Wielkie", "zh": "Przymorze Wielkie"}},
        "CITY::gn::8426045": {"display_name": {"en": "Srodmiescie", "zh": "Srodmiescie"}},
        "CITY::gn::8426046": {"display_name": {"en": "Ujescisko-Lostowice", "zh": "Ujescisko-Lostowice"}},
        "CITY::gn::8426048": {"display_name": {"en": "Wrzeszcz Dolny", "zh": "Wrzeszcz Dolny"}},
        "CITY::gn::8426050": {"display_name": {"en": "Wrzeszcz Gorny", "zh": "Wrzeszcz Gorny"}},
        "CITY::gn::8426082": {"display_name": {"en": "Drzetowo-Grabowo", "zh": "Drzetowo-Grabowo"}},
        "CITY::gn::8426094": {"display_name": {"en": "Swierczewo", "zh": "Swierczewo"}},
        "CITY::gn::8461573": {"display_name": {"en": "Mwene", "zh": "姆韦内"}},
        "CITY::gn::8519916": {"display_name": {"en": "Obolon", "zh": "Obolon"}},
        "CITY::gn::8521334": {"display_name": {"en": "Nkayi", "zh": "恩卡伊"}},
        "CITY::gn::866152": {"display_name": {"en": "Erebuni", "zh": "Erebuni"}},
        "CITY::gn::866153": {"display_name": {"en": "Nor Nork", "zh": "Nor Nork"}},
        "CITY::gn::886990": {"display_name": {"en": "Marondera", "zh": "马龙德拉"}},
        "CITY::gn::895061": {"display_name": {"en": "Bindura", "zh": "宾杜拉"}},
        "CITY::gn::924102": {"display_name": {"en": "Rumphi", "zh": "伦菲"}},
        "CITY::gn::928534": {"display_name": {"en": "Kasungu", "zh": "卡松古"}},
        "CITY::gn::931865": {"display_name": {"en": "Balaka", "zh": "巴拉卡"}},
        "CITY::ne::1159113727": {"display_name": {"en": "Kumi Town", "zh": "库米"}},
        "CITY::ne::1159113745": {"display_name": {"en": "Kaberamaido", "zh": "卡贝拉马伊多"}},
        "CITY::ne::1159113777": {"display_name": {"en": "Iganga", "zh": "伊加加"}},
        "CITY::ne::1159113795": {"display_name": {"en": "Kamuli", "zh": "卡穆利"}},
        "CITY::ne::1159113815": {"display_name": {"en": "Pallisa", "zh": "帕利萨"}},
        "CITY::ne::1159113945": {"display_name": {"en": "Masindi", "zh": "马辛迪"}},
        "CITY::ne::1159113959": {"display_name": {"en": "Fort Portal", "zh": "波特爾堡"}},
        "CITY::ne::1159113985": {"display_name": {"en": "Kibaale", "zh": "基巴莱"}},
        "CITY::ne::1159114003": {"display_name": {"en": "Sironko", "zh": "錫龍科"}},
        "CITY::ne::1159114009": {"display_name": {"en": "Busia", "zh": "布西亚"}},
        "CITY::ne::1159114039": {"display_name": {"en": "Katakwi", "zh": "卡塔奎"}},
        "CITY::ne::1159114181": {"display_name": {"en": "Ntungamo", "zh": "恩通加莫"}},
        "CITY::ne::1159114209": {"display_name": {"en": "Kisoro", "zh": "基索罗"}},
        "CITY::ne::1159116779": {"display_name": {"en": "Omaruru", "zh": "奥马鲁鲁"}},
        "CITY::ne::1159116805": {"display_name": {"en": "Karibib", "zh": "卡里比布"}},
        "CITY::ne::1159116825": {"display_name": {"en": "Otavi", "zh": "奥塔维"}},
        "CITY::ne::1159116843": {"display_name": {"en": "Gobabis", "zh": "戈巴比斯"}},
        "CITY::ne::1159116863": {"display_name": {"en": "Wete", "zh": "韋提"}},
        "CITY::ne::1159116883": {"display_name": {"en": "Kibaha", "zh": "基巴哈"}},
        "CITY::ne::1159116901": {"display_name": {"en": "Mkokotoni", "zh": "姆科科托尼"}},
        "CITY::ne::1159118229": {"display_name": {"en": "Buluko", "zh": "布鲁科"}},
        "CITY::ne::1159118269": {"display_name": {"en": "Machinga", "zh": "马钦加"}},
        "CITY::ne::1159118337": {"display_name": {"en": "Chiradzulu", "zh": "奇拉祖卢"}},
        "CITY::ne::1159118357": {"display_name": {"en": "Nsanje", "zh": "恩桑杰"}},
        "CITY::ne::1159118375": {"display_name": {"en": "Mwanza", "zh": "姆万扎"}},
        "CITY::ne::1159118389": {"display_name": {"en": "Mulanje", "zh": "姆兰杰"}},
        "CITY::ne::1159119035": {"display_name": {"en": "Ebebiyín", "zh": "埃贝比因"}},
        "CITY::ne::1159119065": {"display_name": {"en": "Tchibanga", "zh": "奇班加"}},
        "CITY::ne::1159119097": {"display_name": {"en": "Madingou", "zh": "馬丁古"}},
        "CITY::ne::1159119899": {"display_name": {"en": "Buea", "zh": "布埃亚"}},
        "CITY::ne::1159120321": {"display_name": {"en": "Bergen", "zh": "贝亨"}},
        "CITY::ne::1159120339": {"display_name": {"en": "Hasselt", "zh": "哈瑟尔特"}},
        "CITY::ne::1159121119": {"display_name": {"en": "Arel", "zh": "阿雷尔"}},
        "CITY::ne::1159121233": {"display_name": {"en": "Cankuzo", "zh": "尚库佐"}},
        "CITY::ne::1159121251": {"display_name": {"en": "Karuzi", "zh": "卡鲁齐"}},
        "CITY::ne::1159121345": {"display_name": {"en": "Ngozi", "zh": "恩戈齊"}},
        "CITY::ne::1159122433": {"display_name": {"en": "Laï", "zh": "拉伊"}},
        "CITY::ne::1159122685": {"display_name": {"en": "Gustavstadt", "zh": "古斯塔夫城"}},
        "CITY::ne::1159126699": {"display_name": {"en": "Nikolajew", "zh": "尼古拉耶夫"}},
        "CITY::ne::1159126717": {"display_name": {"en": "Tschernigow", "zh": "切尔尼戈夫"}},
        "CITY::ne::1159126729": {"display_name": {"en": "Proskurow", "zh": "普罗斯库罗夫"}},
        "CITY::ne::1159126797": {"display_name": {"en": "Browary", "zh": "布罗瓦雷"}},
        "CITY::ne::1159126851": {"display_name": {"en": "Kriwoi Rog", "zh": "克里沃罗格"}},
        "CITY::ne::1159128255": {"display_name": {"en": "Schaulen", "zh": "绍伦"}},
        "CITY::ne::1159130525": {"display_name": {"en": "Atrecht", "zh": "阿特雷赫特"}},
        "CITY::ne::1159130531": {"display_name": {"en": "Bisanz", "zh": "比桑茨"}},
        "CITY::ne::1159130705": {"display_name": {"en": "Kutaissi", "zh": "库塔伊西"}},
        "CITY::ne::1159132155": {"display_name": {"en": "Gent", "zh": "根特"}},
        "CITY::ne::1159132163": {"display_name": {"en": "Gandscha", "zh": "甘贾"}},
        "CITY::ne::1159132305": {"display_name": {"en": "Polazk", "zh": "波洛茨克"}},
        "CITY::ne::1159132333": {"display_name": {"en": "Lüttich", "zh": "吕蒂希"}},
        "CITY::ne::1159134151": {"display_name": {"en": "Kertsch", "zh": "刻赤"}},
        "CITY::ne::1159134155": {"display_name": {"en": "Gotenburg", "zh": "哥滕堡"}},
        "CITY::ne::1159134159": {"display_name": {"en": "Cherson", "zh": "赫尔松"}},
        "CITY::ne::1159134173": {"display_name": {"en": "Rowno", "zh": "罗夫诺"}},
        "CITY::ne::1159134181": {"display_name": {"en": "Stanislau", "zh": "斯坦尼斯劳"}},
        "CITY::ne::1159134187": {"display_name": {"en": "Tarnopol", "zh": "塔尔诺波尔"}},
        "CITY::ne::1159134205": {"display_name": {"en": "Eichhornburg", "zh": "艾希霍恩堡"}},
        "CITY::ne::1159134213": {"display_name": {"en": "Winnizia", "zh": "文尼察"}},
        "CITY::ne::1159134241": {"display_name": {"en": "Lugansk", "zh": "卢甘斯克"}},
        "CITY::ne::1159134245": {"display_name": {"en": "Poltawa", "zh": "波尔塔瓦"}},
        "CITY::ne::1159134253": {"display_name": {"en": "Ost-Germania", "zh": "东日耳曼尼亚"}},
        "CITY::ne::1159134699": {"display_name": {"en": "Kawambwa", "zh": "卡萬布瓦"}},
        "CITY::ne::1159134703": {"display_name": {"en": "Nchelenge", "zh": "恩切倫戈"}},
        "CITY::ne::1159134709": {"display_name": {"en": "Chinsali", "zh": "欽薩利"}},
        "CITY::ne::1159134727": {"display_name": {"en": "Chingola", "zh": "欽戈拉"}},
        "CITY::ne::1159134731": {"display_name": {"en": "Chililabombwe", "zh": "奇利拉邦布韦"}},
        "CITY::ne::1159134749": {"display_name": {"en": "Mwinilunga", "zh": "姆維尼倫加"}},
        "CITY::ne::1159134753": {"display_name": {"en": "Kasempa", "zh": "卡森帕"}},
        "CITY::ne::1159134757": {"display_name": {"en": "Solwezi", "zh": "索卢韦齐"}},
        "CITY::ne::1159134775": {"display_name": {"en": "Sesheke", "zh": "塞謝凱"}},
        "CITY::ne::1159134793": {"display_name": {"en": "Mazowe", "zh": "马佐埃"}},
        "CITY::ne::1159134799": {"display_name": {"en": "Shamva", "zh": "沙姆瓦"}},
        "CITY::ne::1159134803": {"display_name": {"en": "Victoria Falls", "zh": "維多利亞瀑布（津巴布韋）"}},
        "CITY::ne::1159134807": {"display_name": {"en": "Shabani", "zh": "沙巴尼"}},
        "CITY::ne::1159134811": {"display_name": {"en": "Kwekwe", "zh": "奎奎"}},
        "CITY::ne::1159134817": {"display_name": {"en": "Plumtree", "zh": "普拉姆特里"}},
        "CITY::ne::1159134821": {"display_name": {"en": "Beitbridge", "zh": "貝特橋"}},
        "CITY::ne::1159134825": {"display_name": {"en": "Gwanda", "zh": "關達"}},
        "CITY::ne::1159134829": {"display_name": {"en": "Chiredzi", "zh": "奇雷济"}},
        "CITY::ne::1159134835": {"display_name": {"en": "Fort Victoria", "zh": "维多利亚堡"}},
        "CITY::ne::1159134841": {"display_name": {"en": "Karoi", "zh": "卡萊伊"}},
        "CITY::ne::1159134845": {"display_name": {"en": "Sinoia", "zh": "锡诺亚"}},
        "CITY::ne::1159134851": {"display_name": {"en": "Kariba", "zh": "卡里巴"}},
        "CITY::ne::1159135379": {"display_name": {"en": "Jinja", "zh": "金贾"}},
        "CITY::ne::1159135383": {"display_name": {"en": "Soroti", "zh": "索羅提"}},
        "CITY::ne::1159135399": {"display_name": {"en": "Böhmstadt", "zh": "贝姆城"}},
        "CITY::ne::1159135421": {"display_name": {"en": "Masindi Port", "zh": "马辛迪港"}},
        "CITY::ne::1159135427": {"display_name": {"en": "Mbale", "zh": "姆巴莱"}},
        "CITY::ne::1159135431": {"display_name": {"en": "Tororo", "zh": "托罗罗"}},
        "CITY::ne::1159135481": {"display_name": {"en": "Tunduma", "zh": "通杜马"}},
        "CITY::ne::1159135485": {"display_name": {"en": "Tukuyu", "zh": "图库尤"}},
        "CITY::ne::1159135489": {"display_name": {"en": "Sumbawanga", "zh": "鲁夸"}},
        "CITY::ne::1159135493": {"display_name": {"en": "Mpanda", "zh": "姆潘达"}},
        "CITY::ne::1159135499": {"display_name": {"en": "Kipili", "zh": "基皮利"}},
        "CITY::ne::1159135503": {"display_name": {"en": "Karema", "zh": "卡雷马"}},
        "CITY::ne::1159135511": {"display_name": {"en": "Nyahanga", "zh": "尼亚汉加"}},
        "CITY::ne::1159135517": {"display_name": {"en": "Kahama", "zh": "卡哈馬"}},
        "CITY::ne::1159135521": {"display_name": {"en": "Shinyanga", "zh": "欣延加"}},
        "CITY::ne::1159135525": {"display_name": {"en": "Nzega", "zh": "恩泽加"}},
        "CITY::ne::1159135529": {"display_name": {"en": "Sikonge", "zh": "锡孔盖"}},
        "CITY::ne::1159135535": {"display_name": {"en": "Biharamulo", "zh": "比哈拉穆洛"}},
        "CITY::ne::1159135539": {"display_name": {"en": "Bukoba", "zh": "布科巴"}},
        "CITY::ne::1159135543": {"display_name": {"en": "Ngara", "zh": "恩加拉"}},
        "CITY::ne::1159135553": {"display_name": {"en": "Kakonko", "zh": "卡孔科"}},
        "CITY::ne::1159135557": {"display_name": {"en": "Kasulu", "zh": "卡蘇盧"}},
        "CITY::ne::1159135561": {"display_name": {"en": "Kanyato", "zh": "卡尼亚托"}},
        "CITY::ne::1159135565": {"display_name": {"en": "Uvinza", "zh": "乌温扎"}},
        "CITY::ne::1159135575": {"display_name": {"en": "Katwe", "zh": "卡特威"}},
        "CITY::ne::1159135579": {"display_name": {"en": "Mbarara", "zh": "姆巴拉拉"}},
        "CITY::ne::1159135583": {"display_name": {"en": "Kabale", "zh": "卡巴莱"}},
        "CITY::ne::1159135589": {"display_name": {"en": "Mikumi", "zh": "米库米"}},
        "CITY::ne::1159135593": {"display_name": {"en": "Ifakara", "zh": "伊法卡拉"}},
        "CITY::ne::1159135597": {"display_name": {"en": "Kilosa", "zh": "基洛萨"}},
        "CITY::ne::1159135601": {"display_name": {"en": "Chake-Chake", "zh": "查凱查凱"}},
        "CITY::ne::1159135607": {"display_name": {"en": "Kibiti", "zh": "基比蒂"}},
        "CITY::ne::1159135611": {"display_name": {"en": "Bagamoyo", "zh": "巴加莫約"}},
        "CITY::ne::1159135615": {"display_name": {"en": "Kilindoni", "zh": "基林多尼"}},
        "CITY::ne::1159135619": {"display_name": {"en": "Mpwapwa", "zh": "姆普瓦普瓦"}},
        "CITY::ne::1159135625": {"display_name": {"en": "Njombe Mjini", "zh": "恩琼贝"}},
        "CITY::ne::1159135633": {"display_name": {"en": "Masasi", "zh": "马萨西"}},
        "CITY::ne::1159135643": {"display_name": {"en": "Tunduru", "zh": "通杜鲁"}},
        "CITY::ne::1159135647": {"display_name": {"en": "Mbamba Bay", "zh": "姆巴巴湾"}},
        "CITY::ne::1159135651": {"display_name": {"en": "Manyoni", "zh": "马尼奥尼"}},
        "CITY::ne::1159135655": {"display_name": {"en": "Itigi", "zh": "伊蒂吉"}},
        "CITY::ne::1159135661": {"display_name": {"en": "Singida", "zh": "辛吉達"}},
        "CITY::ne::1159135665": {"display_name": {"en": "Ngorongoro", "zh": "恩戈罗恩戈罗"}},
        "CITY::ne::1159135669": {"display_name": {"en": "Oldeani", "zh": "奥尔德阿尼"}},
        "CITY::ne::1159135673": {"display_name": {"en": "Mbulu", "zh": "姆布卢"}},
        "CITY::ne::1159135679": {"display_name": {"en": "Babati", "zh": "巴巴蒂"}},
        "CITY::ne::1159135683": {"display_name": {"en": "Same", "zh": "萨梅"}},
        "CITY::ne::1159135687": {"display_name": {"en": "Moshi", "zh": "莫希"}},
        "CITY::ne::1159135691": {"display_name": {"en": "Musoma", "zh": "穆索马"}},
        "CITY::ne::1159135697": {"display_name": {"en": "Korogwe", "zh": "科罗圭"}},
        "CITY::ne::1159136347": {"display_name": {"en": "Windau", "zh": "温道"}},
        "CITY::ne::1159136351": {"display_name": {"en": "Memel", "zh": "梅梅尔"}},
        "CITY::ne::1159136375": {"display_name": {"en": "Kauen", "zh": "考恩"}},
        "CITY::ne::1159136381": {"display_name": {"en": "Mitau", "zh": "米陶"}},
        "CITY::ne::1159136621": {"display_name": {"en": "Moatize", "zh": "莫阿蒂澤"}},
        "CITY::ne::1159136625": {"display_name": {"en": "Luangwa", "zh": "盧安戈瓦"}},
        "CITY::ne::1159136629": {"display_name": {"en": "Manica", "zh": "馬尼卡"}},
        "CITY::ne::1159136635": {"display_name": {"en": "Espungabera", "zh": "埃斯蓬加貝拉"}},
        "CITY::ne::1159136663": {"display_name": {"en": "Neu-Baden", "zh": "新巴登"}},
        "CITY::ne::1159136669": {"display_name": {"en": "Mocímboa da Praia", "zh": "濱海莫辛布瓦區"}},
        "CITY::ne::1159136673": {"display_name": {"en": "Marrupa", "zh": "馬魯帕"}},
        "CITY::ne::1159136677": {"display_name": {"en": "Neue Esche", "zh": "新白蜡树"}},
        "CITY::ne::1159136681": {"display_name": {"en": "Ligonha", "zh": "利戈尼亚"}},
        "CITY::ne::1159136709": {"display_name": {"en": "Macia", "zh": "馬希亞"}},
        "CITY::ne::1159136713": {"display_name": {"en": "Massangena", "zh": "马桑热纳"}},
        "CITY::ne::1159136717": {"display_name": {"en": "Mapai", "zh": "马帕伊"}},
        "CITY::ne::1159136959": {"display_name": {"en": "Dondo", "zh": "棟多"}},
        "CITY::ne::1159136963": {"display_name": {"en": "Chiramba", "zh": "希兰巴"}},
        "CITY::ne::1159136967": {"display_name": {"en": "Mocuba", "zh": "莫庫巴"}},
        "CITY::ne::1159136971": {"display_name": {"en": "Nicuadala", "zh": "尼夸达拉"}},
        "CITY::ne::1159136977": {"display_name": {"en": "Fort Johnston", "zh": "约翰斯顿堡"}},
        "CITY::ne::1159136985": {"display_name": {"en": "Maxixe", "zh": "馬希謝"}},
        "CITY::ne::1159136989": {"display_name": {"en": "Panda", "zh": "潘达"}},
        "CITY::ne::1159136995": {"display_name": {"en": "Zavala", "zh": "薩瓦拉"}},
        "CITY::ne::1159136999": {"display_name": {"en": "Vilankulo", "zh": "维兰库洛"}},
        "CITY::ne::1159139051": {"display_name": {"en": "Breslau", "zh": "布雷斯劳"}},
        "CITY::ne::1159139055": {"display_name": {"en": "Stettin", "zh": "斯德丁"}},
        "CITY::ne::1159139065": {"display_name": {"en": "Posen", "zh": "波森"}},
        "CITY::ne::1159139087": {"display_name": {"en": "Kieltz", "zh": "凯尔采"}},
        "CITY::ne::1159139101": {"display_name": {"en": "Reichshof", "zh": "赖希斯霍夫"}},
        "CITY::ne::1159139217": {"display_name": {"en": "Karasburg", "zh": "卡拉斯堡"}},
        "CITY::ne::1159139221": {"display_name": {"en": "Bethanie", "zh": "贝塔尼"}},
        "CITY::ne::1159139227": {"display_name": {"en": "Oranjemund", "zh": "奥兰治蒙德"}},
        "CITY::ne::1159139231": {"display_name": {"en": "Mariental", "zh": "马林塔尔"}},
        "CITY::ne::1159139235": {"display_name": {"en": "Rehoboth", "zh": "里霍博斯"}},
        "CITY::ne::1159139239": {"display_name": {"en": "Outjo", "zh": "奧喬"}},
        "CITY::ne::1159139245": {"display_name": {"en": "Ohopoho", "zh": "奥霍波霍"}},
        "CITY::ne::1159139249": {"display_name": {"en": "Usakos", "zh": "烏薩科斯"}},
        "CITY::ne::1159139253": {"display_name": {"en": "Okahandja", "zh": "奥卡汉贾"}},
        "CITY::ne::1159139257": {"display_name": {"en": "Otjiwarongo", "zh": "奥奇瓦龙戈"}},
        "CITY::ne::1159139263": {"display_name": {"en": "Oshikango", "zh": "奧希坎戈"}},
        "CITY::ne::1159139267": {"display_name": {"en": "Cuangar", "zh": "寬加爾"}},
        "CITY::ne::1159139271": {"display_name": {"en": "Katima Mulilo", "zh": "卡蒂马穆利洛"}},
        "CITY::ne::1159139275": {"display_name": {"en": "Mucusso", "zh": "穆库索"}},
        "CITY::ne::1159139429": {"display_name": {"en": "Mbaïki", "zh": "姆拜基"}},
        "CITY::ne::1159139433": {"display_name": {"en": "Carnot", "zh": "卡諾"}},
        "CITY::ne::1159139437": {"display_name": {"en": "Bozoum", "zh": "博祖姆"}},
        "CITY::ne::1159139443": {"display_name": {"en": "Kaga-Bandoro", "zh": "卡加班多罗"}},
        "CITY::ne::1159139573": {"display_name": {"en": "Zemio", "zh": "泽米奥"}},
        "CITY::ne::1159139577": {"display_name": {"en": "Yakossi", "zh": "亚科西"}},
        "CITY::ne::1159140335": {"display_name": {"en": "Mongo", "zh": "蒙戈"}},
        "CITY::ne::1159140341": {"display_name": {"en": "Doba", "zh": "多巴"}},
        "CITY::ne::1159140345": {"display_name": {"en": "Pala", "zh": "帕拉"}},
        "CITY::ne::1159140349": {"display_name": {"en": "Bongor", "zh": "邦戈爾"}},
        "CITY::ne::1159140353": {"display_name": {"en": "Kélo", "zh": "凯洛"}},
        "CITY::ne::1159140489": {"display_name": {"en": "Yangambi", "zh": "扬甘比"}},
        "CITY::ne::1159140493": {"display_name": {"en": "Aketi", "zh": "阿凱蒂"}},
        "CITY::ne::1159140497": {"display_name": {"en": "Mongbwalu", "zh": "蒙布瓦卢"}},
        "CITY::ne::1159140503": {"display_name": {"en": "Bafwasende", "zh": "巴富瓦森代"}},
        "CITY::ne::1159140507": {"display_name": {"en": "Bunia", "zh": "布尼亞"}},
        "CITY::ne::1159140511": {"display_name": {"en": "Wamba Territory", "zh": "万巴"}},
        "CITY::ne::1159140515": {"display_name": {"en": "Basoko", "zh": "巴索科"}},
        "CITY::ne::1159141409": {"display_name": {"en": "Moanda", "zh": "姆安达"}},
        "CITY::ne::1159141413": {"display_name": {"en": "Kimpese", "zh": "金佩塞"}},
        "CITY::ne::1159141417": {"display_name": {"en": "Kasangulu", "zh": "卡桑古卢"}},
        "CITY::ne::1159141423": {"display_name": {"en": "Nkamba", "zh": "姆班扎恩古恩古"}},
        "CITY::ne::1159141427": {"display_name": {"en": "Tshela", "zh": "特色拉"}},
        "CITY::ne::1159141433": {"display_name": {"en": "Mwenga", "zh": "姆文加"}},
        "CITY::ne::1159141439": {"display_name": {"en": "Kampene", "zh": "坎佩内"}},
        "CITY::ne::1159141443": {"display_name": {"en": "Kalima", "zh": "卡利马"}},
        "CITY::ne::1159141447": {"display_name": {"en": "Lubutu", "zh": "卢布图"}},
        "CITY::ne::1159141475": {"display_name": {"en": "Dilolo", "zh": "迪洛洛"}},
        "CITY::ne::1159141479": {"display_name": {"en": "Nyunzu", "zh": "尼温祖"}},
        "CITY::ne::1159141483": {"display_name": {"en": "Kasaji", "zh": "卡萨吉"}},
        "CITY::ne::1159141487": {"display_name": {"en": "Luanza", "zh": "卢安扎"}},
        "CITY::ne::1159141493": {"display_name": {"en": "Moba", "zh": "莫巴"}},
        "CITY::ne::1159141497": {"display_name": {"en": "Bukama", "zh": "布卡马"}},
        "CITY::ne::1159141501": {"display_name": {"en": "Kaniama", "zh": "卡尼亚马"}},
        "CITY::ne::1159141505": {"display_name": {"en": "Kipushi", "zh": "基普希"}},
        "CITY::ne::1159141511": {"display_name": {"en": "Kambove", "zh": "坎博韋"}},
        "CITY::ne::1159141515": {"display_name": {"en": "Kongolo", "zh": "孔戈洛"}},
        "CITY::ne::1159141519": {"display_name": {"en": "Kabalo", "zh": "卡巴洛"}},
        "CITY::ne::1159141523": {"display_name": {"en": "Erichsdorf", "zh": "埃里希斯多夫"}},
        "CITY::ne::1159141673": {"display_name": {"en": "Mékambo", "zh": "梅坎博"}},
        "CITY::ne::1159141677": {"display_name": {"en": "Makokou", "zh": "马科库"}},
        "CITY::ne::1159141681": {"display_name": {"en": "Mitzic", "zh": "米齐克"}},
        "CITY::ne::1159141685": {"display_name": {"en": "Bitam", "zh": "比塔姆"}},
        "CITY::ne::1159141891": {"display_name": {"en": "Lambaréné", "zh": "兰巴雷内"}},
        "CITY::ne::1159141895": {"display_name": {"en": "Bifoun", "zh": "比丰"}},
        "CITY::ne::1159141899": {"display_name": {"en": "Ndendé", "zh": "恩代恩代"}},
        "CITY::ne::1159141903": {"display_name": {"en": "Mouila", "zh": "穆伊拉"}},
        "CITY::ne::1159141909": {"display_name": {"en": "Omboué", "zh": "翁布埃"}},
        "CITY::ne::1159141913": {"display_name": {"en": "Moanda", "zh": "莫安达"}},
        "CITY::ne::1159141917": {"display_name": {"en": "Okondja", "zh": "奥孔贾"}},
        "CITY::ne::1159141921": {"display_name": {"en": "Koulamoutou", "zh": "库拉穆图"}},
        "CITY::ne::1159142047": {"display_name": {"en": "Kalen", "zh": "卡伦"}},
        "CITY::ne::1159142061": {"display_name": {"en": "Nanzig", "zh": "南齐希"}},
        "CITY::ne::1159142169": {"display_name": {"en": "Sembé", "zh": "森贝"}},
        "CITY::ne::1159142999": {"display_name": {"en": "Owando", "zh": "奥旺多"}},
        "CITY::ne::1159143005": {"display_name": {"en": "Makoua", "zh": "馬夸"}},
        "CITY::ne::1159143009": {"display_name": {"en": "Sibiti", "zh": "錫比提"}},
        "CITY::ne::1159143013": {"display_name": {"en": "Mossendjo", "zh": "莫森焦"}},
        "CITY::ne::1159143017": {"display_name": {"en": "Dolisie", "zh": "多利西"}},
        "CITY::ne::1159144005": {"display_name": {"en": "Kumba", "zh": "昆巴"}},
        "CITY::ne::1159144009": {"display_name": {"en": "Eyumodjock", "zh": "埃尤莫乔克"}},
        "CITY::ne::1159144015": {"display_name": {"en": "Limbe", "zh": "林贝"}},
        "CITY::ne::1159144019": {"display_name": {"en": "Beutlersstadt", "zh": "博伊特勒城"}},
        "CITY::ne::1159144027": {"display_name": {"en": "Sibut", "zh": "锡布"}},
        "CITY::ne::1159144033": {"display_name": {"en": "Bossangoa", "zh": "博桑戈阿"}},
        "CITY::ne::1159144037": {"display_name": {"en": "Birao", "zh": "比勞"}},
        "CITY::ne::1159144051": {"display_name": {"en": "Ouadda", "zh": "瓦达"}},
        "CITY::ne::1159144055": {"display_name": {"en": "Bangassou", "zh": "班加蘇"}},
        "CITY::ne::1159144463": {"display_name": {"en": "Bossembélé", "zh": "博森贝莱"}},
        "CITY::ne::1159144475": {"display_name": {"en": "Wum", "zh": "武姆"}},
        "CITY::ne::1159144481": {"display_name": {"en": "Kumbo", "zh": "昆博"}},
        "CITY::ne::1159144517": {"display_name": {"en": "Meiganga", "zh": "梅甘加"}},
        "CITY::ne::1159144521": {"display_name": {"en": "Ngaoundéré", "zh": "恩冈代雷"}},
        "CITY::ne::1159144525": {"display_name": {"en": "Tibati", "zh": "蒂巴蒂"}},
        "CITY::ne::1159144529": {"display_name": {"en": "Kontcha", "zh": "孔查"}},
        "CITY::ne::1159144553": {"display_name": {"en": "Brügge", "zh": "布吕格"}},
        "CITY::ne::1159144557": {"display_name": {"en": "Namen", "zh": "纳门"}},
        "CITY::ne::1159144561": {"display_name": {"en": "Karolingen", "zh": "卡罗林根"}},
        "CITY::ne::1159144685": {"display_name": {"en": "Lucapa", "zh": "卢卡帕"}},
        "CITY::ne::1159144687": {"display_name": {"en": "Capenda-Camulemba", "zh": "卡彭達-卡穆倫巴"}},
        "CITY::ne::1159144689": {"display_name": {"en": "Saurimo", "zh": "绍里莫"}},
        "CITY::ne::1159144691": {"display_name": {"en": "Muconda", "zh": "穆孔達"}},
        "CITY::ne::1159144693": {"display_name": {"en": "Cacolo", "zh": "卡科洛"}},
        "CITY::ne::1159144697": {"display_name": {"en": "Caxito", "zh": "卡西托"}},
        "CITY::ne::1159144699": {"display_name": {"en": "Ambaca", "zh": "安巴卡"}},
        "CITY::ne::1159144701": {"display_name": {"en": "N'dalatando", "zh": "恩达拉坦多"}},
        "CITY::ne::1159144703": {"display_name": {"en": "Quibala", "zh": "基巴拉"}},
        "CITY::ne::1159144705": {"display_name": {"en": "Calulo", "zh": "卡卢洛"}},
        "CITY::ne::1159144707": {"display_name": {"en": "Waku-Kungo", "zh": "瓦庫昆戈"}},
        "CITY::ne::1159144709": {"display_name": {"en": "Songo", "zh": "松戈"}},
        "CITY::ne::1159144711": {"display_name": {"en": "Sankt Salvador", "zh": "圣萨尔瓦多"}},
        "CITY::ne::1159144715": {"display_name": {"en": "N'zeto", "zh": "恩泽托"}},
        "CITY::ne::1159144719": {"display_name": {"en": "Soyo", "zh": "索约"}},
        "CITY::ne::1159144727": {"display_name": {"en": "Calucinga", "zh": "卡卢辛加"}},
        "CITY::ne::1159144733": {"display_name": {"en": "Camacupa", "zh": "卡馬庫帕"}},
        "CITY::ne::1159144737": {"display_name": {"en": "Cubal", "zh": "庫巴爾"}},
        "CITY::ne::1159144741": {"display_name": {"en": "Mavinga", "zh": "馬溫加"}},
        "CITY::ne::1159144745": {"display_name": {"en": "Cuito Cuanavale", "zh": "奎托誇納瓦萊"}},
        "CITY::ne::1159144751": {"display_name": {"en": "Luiana", "zh": "卢亚纳"}},
        "CITY::ne::1159144755": {"display_name": {"en": "Ondjiva", "zh": "翁吉瓦"}},
        "CITY::ne::1159144759": {"display_name": {"en": "Chitado", "zh": "希塔多"}},
        "CITY::ne::1159144763": {"display_name": {"en": "Chibemba", "zh": "希本巴"}},
        "CITY::ne::1159144769": {"display_name": {"en": "Chibia", "zh": "希比亞"}},
        "CITY::ne::1159144773": {"display_name": {"en": "Quipungo", "zh": "基蓬戈"}},
        "CITY::ne::1159144777": {"display_name": {"en": "Luau", "zh": "盧奧"}},
        "CITY::ne::1159144781": {"display_name": {"en": "Cangombe", "zh": "坎甘巴"}},
        "CITY::ne::1159144789": {"display_name": {"en": "Lumbala-Ngimbo", "zh": "隆巴拉"}},
        "CITY::ne::1159144793": {"display_name": {"en": "Cazombo", "zh": "卡宗博"}},
        "CITY::ne::1159145129": {"display_name": {"en": "Orscha", "zh": "奥尔沙"}},
        "CITY::ne::1159145137": {"display_name": {"en": "Garten", "zh": "加滕"}},
        "CITY::ne::1159146313": {"display_name": {"en": "Saparoshje", "zh": "扎波罗热"}},
        "CITY::ne::1159146391": {"display_name": {"en": "Kasese", "zh": "卡塞塞"}},
        "CITY::ne::1159146449": {"display_name": {"en": "Libau", "zh": "利包"}},
        "CITY::ne::1159147227": {"display_name": {"en": "Ryssel", "zh": "赖瑟尔"}},
        "CITY::ne::1159147265": {"display_name": {"en": "Batum", "zh": "巴统"}},
        "CITY::ne::1159147555": {"display_name": {"en": "Fort Rosebery", "zh": "罗斯贝里堡"}},
        "CITY::ne::1159147559": {"display_name": {"en": "Mpika", "zh": "姆皮卡"}},
        "CITY::ne::1159147563": {"display_name": {"en": "Luanshya", "zh": "卢安夏"}},
        "CITY::ne::1159147565": {"display_name": {"en": "Ndola", "zh": "恩多拉"}},
        "CITY::ne::1159147567": {"display_name": {"en": "Zambezi", "zh": "贊比西"}},
        "CITY::ne::1159147569": {"display_name": {"en": "Kafue", "zh": "喀辅埃河"}},
        "CITY::ne::1159147573": {"display_name": {"en": "Wankie", "zh": "万基"}},
        "CITY::ne::1159147577": {"display_name": {"en": "Gwelo", "zh": "圭洛"}},
        "CITY::ne::1159147579": {"display_name": {"en": "Umtali", "zh": "乌姆塔利"}},
        "CITY::ne::1159147581": {"display_name": {"en": "Gatooma", "zh": "加图马"}},
        "CITY::ne::1159147705": {"display_name": {"en": "Antwerpen", "zh": "安特卫普"}},
        "CITY::ne::1159147723": {"display_name": {"en": "Homel", "zh": "戈梅利"}},
        "CITY::ne::1159148021": {"display_name": {"en": "Peryberg", "zh": "佩里贝格"}},
        "CITY::ne::1159148023": {"display_name": {"en": "Kabraldorf", "zh": "卡布拉尔多夫"}},
        "CITY::ne::1159148027": {"display_name": {"en": "Angoche", "zh": "安戈謝"}},
        "CITY::ne::1159148029": {"display_name": {"en": "Island of Mozambique", "zh": "莫桑比克岛"}},
        "CITY::ne::1159148225": {"display_name": {"en": "Litzmannstadt", "zh": "利茨曼施塔特"}},
        "CITY::ne::1159148229": {"display_name": {"en": "Keetmanshoop", "zh": "基特曼斯胡普"}},
        "CITY::ne::1159148231": {"display_name": {"en": "Maltahöhe", "zh": "马尔塔赫厄"}},
        "CITY::ne::1159148233": {"display_name": {"en": "Swakopmund", "zh": "斯瓦科普蒙德"}},
        "CITY::ne::1159148235": {"display_name": {"en": "Ongwediva", "zh": "翁圭迪瓦"}},
        "CITY::ne::1159148237": {"display_name": {"en": "Rundu", "zh": "龙杜"}},
        "CITY::ne::1159148239": {"display_name": {"en": "Tsumeb", "zh": "楚梅布"}},
        "CITY::ne::1159148243": {"display_name": {"en": "Tabora", "zh": "塔波拉"}},
        "CITY::ne::1159148247": {"display_name": {"en": "Songea", "zh": "松盖阿"}},
        "CITY::ne::1159148293": {"display_name": {"en": "Berbérati", "zh": "貝貝拉蒂"}},
        "CITY::ne::1159148299": {"display_name": {"en": "Bria", "zh": "布里亞"}},
        "CITY::ne::1159148307": {"display_name": {"en": "Dünaburg", "zh": "杜纳堡"}},
        "CITY::ne::1159148427": {"display_name": {"en": "Sarh", "zh": "萨尔"}},
        "CITY::ne::1159148429": {"display_name": {"en": "Am Timan", "zh": "安提曼"}},
        "CITY::ne::1159148443": {"display_name": {"en": "Buta", "zh": "布塔"}},
        "CITY::ne::1159148445": {"display_name": {"en": "Watsa", "zh": "瓦斯塔"}},
        "CITY::ne::1159148447": {"display_name": {"en": "Dintersburg", "zh": "丁特斯堡"}},
        "CITY::ne::1159148449": {"display_name": {"en": "Bondo", "zh": "邦多"}},
        "CITY::ne::1159148453": {"display_name": {"en": "Dorpat", "zh": "多尔帕特"}},
        "CITY::ne::1159148479": {"display_name": {"en": "Boma", "zh": "博马"}},
        "CITY::ne::1159148481": {"display_name": {"en": "Costermansstadt", "zh": "科斯特曼斯城"}},
        "CITY::ne::1159148483": {"display_name": {"en": "Kurtsdorf", "zh": "库尔茨多夫"}},
        "CITY::ne::1159148485": {"display_name": {"en": "Empainhafen", "zh": "恩潘港"}},
        "CITY::ne::1159148489": {"display_name": {"en": "Likasi", "zh": "利卡西"}},
        "CITY::ne::1159148491": {"display_name": {"en": "Manono", "zh": "馬諾諾"}},
        "CITY::ne::1159148495": {"display_name": {"en": "Kamina", "zh": "卡米納"}},
        "CITY::ne::1159148497": {"display_name": {"en": "Chiromo", "zh": "奇罗莫"}},
        "CITY::ne::1159148499": {"display_name": {"en": "Zomba", "zh": "松巴"}},
        "CITY::ne::1159148513": {"display_name": {"en": "Oyem", "zh": "奥耶姆"}},
        "CITY::ne::1159148515": {"display_name": {"en": "Pernau", "zh": "佩尔瑙"}},
        "CITY::ne::1159148533": {"display_name": {"en": "Mayumba", "zh": "马永巴"}},
        "CITY::ne::1159148535": {"display_name": {"en": "Gamba", "zh": "甘巴"}},
        "CITY::ne::1159148591": {"display_name": {"en": "Ouésso", "zh": "韋索"}},
        "CITY::ne::1159148945": {"display_name": {"en": "Bouar", "zh": "布阿尔"}},
        "CITY::ne::1159148991": {"display_name": {"en": "Dundo", "zh": "敦多"}},
        "CITY::ne::1159148993": {"display_name": {"en": "Ambriz", "zh": "安布里什"}},
        "CITY::ne::1159148995": {"display_name": {"en": "Dondo", "zh": "栋多"}},
        "CITY::ne::1159148999": {"display_name": {"en": "Sumbe", "zh": "孫貝"}},
        "CITY::ne::1159149003": {"display_name": {"en": "Kuito", "zh": "奎托"}},
        "CITY::ne::1159149005": {"display_name": {"en": "Lobito", "zh": "洛比托"}},
        "CITY::ne::1159149007": {"display_name": {"en": "Xangongo", "zh": "桑貢戈"}},
        "CITY::ne::1159149009": {"display_name": {"en": "Luena", "zh": "卢埃纳"}},
        "CITY::ne::1159149011": {"display_name": {"en": "Tômbwa", "zh": "通布阿"}},
        "CITY::ne::1159149323": {"display_name": {"en": "Lemberg", "zh": "伦贝格"}},
        "CITY::ne::1159149327": {"display_name": {"en": "Shitomir", "zh": "日托米尔"}},
        "CITY::ne::1159149329": {"display_name": {"en": "Reichenaustadt", "zh": "赖歇瑙施塔特"}},
        "CITY::ne::1159149331": {"display_name": {"en": "Hughesdorf", "zh": "休斯多夫"}},
        "CITY::ne::1159149333": {"display_name": {"en": "Charkow", "zh": "哈尔科夫"}},
        "CITY::ne::1159149355": {"display_name": {"en": "Mufulira", "zh": "穆富利拉"}},
        "CITY::ne::1159149359": {"display_name": {"en": "Kitwe", "zh": "基特韦"}},
        "CITY::ne::1159149363": {"display_name": {"en": "Chitungwiza", "zh": "奇通圭扎"}},
        "CITY::ne::1159149385": {"display_name": {"en": "Barthstadt", "zh": "巴特城"}},
        "CITY::ne::1159149487": {"display_name": {"en": "Ameliahafen", "zh": "阿梅莉亚港"}},
        "CITY::ne::1159149493": {"display_name": {"en": "Vila de João Belo", "zh": "维拉·若昂·贝洛"}},
        "CITY::ne::1159149513": {"display_name": {"en": "Bouhlerstadt", "zh": "布勒城"}},
        "CITY::ne::1159149707": {"display_name": {"en": "Danzig", "zh": "但泽"}},
        "CITY::ne::1159149709": {"display_name": {"en": "Krakau", "zh": "克拉考"}},
        "CITY::ne::1159149723": {"display_name": {"en": "Lüderitz", "zh": "吕德里茨"}},
        "CITY::ne::1159149725": {"display_name": {"en": "Walfischbai", "zh": "鲸湾港"}},
        "CITY::ne::1159149731": {"display_name": {"en": "Dodoma", "zh": "松巴万加"}},
        "CITY::ne::1159149733": {"display_name": {"en": "Löweburg", "zh": "勒韦堡"}},
        "CITY::ne::1159149851": {"display_name": {"en": "Moundou", "zh": "蒙杜"}},
        "CITY::ne::1159149865": {"display_name": {"en": "Stanleystadt", "zh": "斯坦利城"}},
        "CITY::ne::1159149977": {"display_name": {"en": "Luluaburg", "zh": "卢卢阿堡"}},
        "CITY::ne::1159149979": {"display_name": {"en": "Kasongo", "zh": "卡松戈"}},
        "CITY::ne::1159149983": {"display_name": {"en": "Albertstadt", "zh": "阿尔贝特城"}},
        "CITY::ne::1159149985": {"display_name": {"en": "Butembo", "zh": "布滕博"}},
        "CITY::ne::1159149993": {"display_name": {"en": "Blantyre", "zh": "布兰太尔"}},
        "CITY::ne::1159150031": {"display_name": {"en": "Kayes", "zh": "卡耶斯"}},
        "CITY::ne::1159150033": {"display_name": {"en": "Franceville", "zh": "弗朗斯维尔"}},
        "CITY::ne::1159150171": {"display_name": {"en": "Schwarze-Spitze", "zh": "黑角"}},
        "CITY::ne::1159150273": {"display_name": {"en": "Bambari", "zh": "班巴里"}},
        "CITY::ne::1159150315": {"display_name": {"en": "Bamenda", "zh": "巴门达"}},
        "CITY::ne::1159150327": {"display_name": {"en": "Malanje", "zh": "马兰热"}},
        "CITY::ne::1159150333": {"display_name": {"en": "Lubango", "zh": "盧班戈"}},
        "CITY::ne::1159150335": {"display_name": {"en": "Moçâmedes", "zh": "莫桑梅德斯"}},
        "CITY::ne::1159150351": {"display_name": {"en": "Brest-Litowsk", "zh": "布列斯特-立托夫斯克"}},
        "CITY::ne::1159150427": {"display_name": {"en": "Usumbura", "zh": "乌松布拉"}},
        "CITY::ne::1159150561": {"display_name": {"en": "Theoderichshafen", "zh": "狄奥多里希港"}},
        "CITY::ne::1159150573": {"display_name": {"en": "Salisbury", "zh": "索尔兹伯里"}},
        "CITY::ne::1159150657": {"display_name": {"en": "Nacala", "zh": "纳卡拉"}},
        "CITY::ne::1159150679": {"display_name": {"en": "Beira", "zh": "贝拉"}},
        "CITY::ne::1159150683": {"display_name": {"en": "Lourenço Marques", "zh": "洛伦索·马贵斯"}},
        "CITY::ne::1159150785": {"display_name": {"en": "Windhuk", "zh": "温得和克"}},
        "CITY::ne::1159150787": {"display_name": {"en": "Grootfontein", "zh": "赫鲁特方丹"}},
        "CITY::ne::1159150789": {"display_name": {"en": "Sansibar", "zh": "桑给巴尔"}},
        "CITY::ne::1159150809": {"display_name": {"en": "Wilna", "zh": "维尔纳"}},
        "CITY::ne::1159150877": {"display_name": {"en": "Reval", "zh": "雷瓦尔"}},
        "CITY::ne::1159150899": {"display_name": {"en": "Matadi", "zh": "马塔迪"}},
        "CITY::ne::1159150901": {"display_name": {"en": "Kolwezi", "zh": "科卢韦齐"}},
        "CITY::ne::1159150903": {"display_name": {"en": "Elisabethstadt", "zh": "伊丽莎白城"}},
        "CITY::ne::1159150913": {"display_name": {"en": "Freistadt", "zh": "自由城"}},
        "CITY::ne::1159150919": {"display_name": {"en": "Gentilhafen", "zh": "让蒂尔港"}},
        "CITY::ne::1159150961": {"display_name": {"en": "Tiflis", "zh": "第比利斯"}},
        "CITY::ne::1159150993": {"display_name": {"en": "Brazzastadt", "zh": "布拉柴城"}},
        "CITY::ne::1159151077": {"display_name": {"en": "N'Délé", "zh": "恩代萊"}},
        "CITY::ne::1159151081": {"display_name": {"en": "Obo", "zh": "奥博"}},
        "CITY::ne::1159151113": {"display_name": {"en": "Maroua", "zh": "马鲁阿"}},
        "CITY::ne::1159151115": {"display_name": {"en": "Jaunde", "zh": "雅恩德"}},
        "CITY::ne::1159151119": {"display_name": {"en": "Yerevan", "zh": "埃里温"}},
        "CITY::ne::1159151123": {"display_name": {"en": "Baku", "zh": "巴库"}},
        "CITY::ne::1159151129": {"display_name": {"en": "Menongue", "zh": "梅农盖"}},
        "CITY::ne::1159151131": {"display_name": {"en": "Neu Lissabon", "zh": "新里斯本"}},
        "CITY::ne::1159151299": {"display_name": {"en": "Warschau", "zh": "华沙"}},
        "CITY::ne::1159151305": {"display_name": {"en": "Daressalam", "zh": "达累斯萨拉姆"}},
        "CITY::ne::1159151465": {"display_name": {"en": "Brüssel", "zh": "布鲁塞尔"}},
        "CITY::ne::1159151495": {"display_name": {"en": "Kiew", "zh": "基辅"}},
        "CITY::ne::1159151539": {"display_name": {"en": "Leopoldstadt", "zh": "利奥波德城"}},
        "CITY::gn::232146": {"display_name": {"en": "Kasaali", "zh": "卡萨利"}},
        "CITY::gn::235574": {"display_name": {"en": "Abim", "zh": "阿比姆"}},
        "CITY::gn::233563": {"display_name": {"en": "Dokolo", "zh": "多科洛"}},
        "CITY::gn::234480": {"display_name": {"en": "Buikwe", "zh": "布伊克韦"}},
        "CITY::gn::233382": {"display_name": {"en": "Gombe", "zh": "贡贝"}},
        "CITY::gn::229599": {"display_name": {"en": "Lyantonde", "zh": "利扬通德"}},
        "CITY::gn::229630": {"display_name": {"en": "Lwengo", "zh": "卢文戈"}},
        "CITY::gn::10943053": {"display_name": {"en": "Nansana", "zh": "南萨纳"}},
        "CITY::gn::231165": {"display_name": {"en": "Kira", "zh": "基拉"}},
        "CITY::gn::234179": {"display_name": {"en": "Bunamwaya", "zh": "布纳姆瓦亚"}},
        "CITY::gn::10858926": {"display_name": {"en": "Kyengera", "zh": "基延盖拉"}},
        "CITY::gn::232110": {"display_name": {"en": "Kasangati", "zh": "卡桑加蒂"}},
        "CITY::gn::227812": {"display_name": {"en": "Njeru", "zh": "恩杰鲁"}},
        "CITY::gn::231954": {"display_name": {"en": "Katabi", "zh": "卡塔比"}},
        "CITY::gn::232713": {"display_name": {"en": "Kajansi", "zh": "卡詹西"}},
        "CITY::gn::229911": {"display_name": {"en": "Lugazi", "zh": "卢加齐"}},
    },
    "hoi4_1936": SOVIET_ERA_CITY_RENAMES,
    "hoi4_1939": SOVIET_ERA_CITY_RENAMES,
}


def _build_default_capital_outputs(
    *,
    scenario_id: str,
    generated_at: str,
    accepted_capital_entries: dict[str, dict[str, object]],
    rejected_capital_entries: list[dict[str, object]],
    unresolved_capitals: list[dict[str, object]],
    featured_runtime_missing: list[str],
) -> tuple[dict[str, object], dict[str, object]]:
    accepted_tags = sorted(accepted_capital_entries)
    accepted_entries = [copy.deepcopy(accepted_capital_entries[tag]) for tag in accepted_tags]
    capitals_by_tag = {
        tag: _clean_text(accepted_capital_entries[tag].get("city_id"))
        for tag in accepted_tags
        if _clean_text(accepted_capital_entries[tag].get("city_id"))
    }
    capital_city_hints = {
        tag: copy.deepcopy(accepted_capital_entries[tag])
        for tag in accepted_tags
        if _clean_text(accepted_capital_entries[tag].get("city_id"))
    }

    capital_defaults_partial_payload = {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": generated_at,
        "capitals_by_tag": capitals_by_tag,
        "capital_city_hints": capital_city_hints,
        "audit": {
            "default_capital_entry_count": len(capitals_by_tag),
            "default_capital_missing_tag_count": len(unresolved_capitals),
            "default_capital_missing_tags": [_clean_text(entry.get("tag")) for entry in unresolved_capitals],
            "default_rejected_candidate_count": len(rejected_capital_entries),
            "default_rejected_candidates": copy.deepcopy(rejected_capital_entries),
            "default_featured_runtime_missing_count": len(featured_runtime_missing),
            "default_featured_runtime_missing_tags": copy.deepcopy(featured_runtime_missing),
        },
    }
    capital_hints_payload = {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": generated_at,
        "entry_count": len(accepted_entries),
        "missing_tag_count": len(unresolved_capitals),
        "missing_tags": [_clean_text(entry.get("tag")) for entry in unresolved_capitals],
        "entries": accepted_entries,
        "audit": {
            "rejected_candidate_count": len(rejected_capital_entries),
            "rejected_candidates": copy.deepcopy(rejected_capital_entries),
            "featured_runtime_missing_count": len(featured_runtime_missing),
            "featured_runtime_missing_tags": copy.deepcopy(featured_runtime_missing),
        },
    }
    return capital_defaults_partial_payload, capital_hints_payload


def _ensure_epsg4326(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        return gdf.set_crs("EPSG:4326", allow_override=True)
    if gdf.crs.to_epsg() != 4326:
        return gdf.to_crs("EPSG:4326")
    return gdf


def _clean_text(value: object) -> str:
    if value is None:
        return ""
    try:
        if bool(pd.isna(value)):
            return ""
    except (TypeError, ValueError):
        pass
    return str(value or "").strip()


def _normalize_text(value: object) -> str:
    text = unicodedata.normalize("NFKD", _clean_text(value))
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.casefold()
    text = re.sub(r"[\u2018\u2019]", "'", text)
    text = re.sub(r"[^a-z0-9']+", " ", text)
    return " ".join(text.split())


def _split_alias_field(raw_value: object) -> list[str]:
    text = _clean_text(raw_value)
    if not text:
        return []
    parts = re.split(r"[|,;/]+", text)
    return [part.strip() for part in parts if part and part.strip()]


def _coerce_text_list(raw_value: object) -> list[str]:
    if raw_value is None:
        return []
    if isinstance(raw_value, str):
        return [raw_value]
    try:
        if bool(pd.isna(raw_value)):
            return []
    except (TypeError, ValueError):
        pass
    if isinstance(raw_value, (list, tuple, set)):
        return [_clean_text(value) for value in raw_value if _clean_text(value)]
    if hasattr(raw_value, "tolist"):
        converted = raw_value.tolist()
        if isinstance(converted, list):
            return [_clean_text(value) for value in converted if _clean_text(value)]
    clean = _clean_text(raw_value)
    return [clean] if clean else []


def _trim_aliases(values: list[str], primary_name: str, ascii_name: str) -> list[str]:
    prioritized = []
    if primary_name:
        prioritized.append(primary_name)
    if ascii_name and ascii_name != primary_name:
        prioritized.append(ascii_name)
    prioritized.extend(values)

    trimmed: list[str] = []
    normalized_seen: set[str] = set()
    for value in prioritized:
        clean = _clean_text(value)
        if not clean or len(clean) > 96:
            continue
        normalized = _normalize_text(clean)
        if not normalized or normalized in normalized_seen:
            continue
        normalized_seen.add(normalized)
        trimmed.append(clean)
        if len(trimmed) >= ALIAS_LIMIT:
            break
    return trimmed


def _capital_kind_from_geonames(feature_code: str) -> str:
    code = _clean_text(feature_code).upper()
    if code in COUNTRY_CAPITAL_CODES:
        return "country_capital"
    if code in ADMIN_CAPITAL_CODES:
        return "admin_capital"
    return "place"


def _capital_kind_from_natural_earth(featurecla: str) -> str:
    value = _clean_text(featurecla).casefold()
    if value in {"admin-0 capital", "admin-0 capital alt"}:
        return "country_capital"
    if "capital" in value:
        return "admin_capital"
    return "place"


def _capital_score(capital_kind: object) -> int:
    value = _clean_text(capital_kind)
    if value == "country_capital":
        return 3
    if value == "admin_capital":
        return 2
    return 1


def _guess_base_tier(
    *,
    population: int,
    capital_kind: object,
    is_world_city: bool,
) -> str:
    capital_score = _capital_score(capital_kind)
    if capital_score >= 3 or population >= 1_500_000 or is_world_city:
        return "major"
    if capital_score >= 2 or population >= 350_000:
        return "regional"
    return "minor"


def _guess_min_zoom(base_tier: str, capital_kind: object) -> float:
    if _capital_score(capital_kind) >= 3 or base_tier == "major":
        return 0.8
    if base_tier == "regional":
        return 1.6
    return 2.9


def _build_city_id(source: str, token: object) -> str:
    normalized_source = "gn" if _clean_text(source).lower().startswith("geo") else "ne"
    cleaned_token = _clean_text(token)
    return f"CITY::{normalized_source}::{cleaned_token}"


def _stable_key_for_city(city_id: str) -> str:
    return f"id::{city_id}"


def _pick_zh_name(*values: object) -> str:
    for value in values:
        text = _clean_text(value)
        if re.search(r"[\u3400-\u9fff]", text):
            return text
    return ""


def _safe_int(value: object) -> int:
    try:
        if value is None or value == "":
            return 0
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _safe_float(value: object) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _stable_hash(*values: object, length: int = 12) -> str:
    payload = "|".join(_clean_text(value) for value in values)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:length].upper()


def _haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    radius_km = 6371.0088
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    return 2.0 * radius_km * math.asin(min(1.0, math.sqrt(a)))


def _record_name_keys(record: dict[str, object]) -> set[str]:
    keys: set[str] = set()
    for value in record.get("aliases", []):
        normalized = _normalize_text(value)
        if normalized:
            keys.add(normalized)
    return keys


def load_geonames_frame(zip_path: Path) -> pd.DataFrame:
    with zipfile.ZipFile(zip_path) as archive:
        member = next(
            (name for name in archive.namelist() if name.lower().endswith(".txt")),
            "",
        )
        if not member:
            raise ValueError(f"GeoNames archive missing text payload: {zip_path}")
        with archive.open(member) as handle:
            frame = pd.read_csv(
                handle,
                sep="\t",
                names=GEONAMES_COLUMNS,
                dtype=str,
                na_filter=False,
                low_memory=False,
            )
    return frame


def _load_geonames_source(zip_path: Path | None = None) -> pd.DataFrame:
    if zip_path is None:
        zip_path = fetch_or_cache_binary(
            cfg.GEONAMES_CITIES15000_URL,
            cfg.GEONAMES_CITIES15000_FILENAME,
            min_size_bytes=64 * 1024,
        )
    return load_geonames_frame(Path(zip_path))


def _normalize_geonames(frame: pd.DataFrame) -> gpd.GeoDataFrame:
    rows: list[dict[str, object]] = []
    for raw in frame.to_dict(orient="records"):
        country_code = _clean_text(raw.get("country_code")).upper()
        if not re.fullmatch(r"[A-Z]{2}", country_code):
            continue
        population = _safe_int(raw.get("population"))
        if population < cfg.WORLD_CITY_MIN_POPULATION:
            continue
        lon = _safe_float(raw.get("longitude"))
        lat = _safe_float(raw.get("latitude"))
        if lon is None or lat is None:
            continue
        primary_name = _clean_text(raw.get("name"))
        ascii_name = _clean_text(raw.get("asciiname")) or primary_name
        aliases = _trim_aliases(
            _split_alias_field(raw.get("alternatenames")),
            primary_name=primary_name,
            ascii_name=ascii_name,
        )
        capital_kind = _capital_kind_from_geonames(_clean_text(raw.get("feature_code")))
        city_id = _build_city_id("geonames", _clean_text(raw.get("geonameid")))
        stable_key = _stable_key_for_city(city_id)
        name_zh = _pick_zh_name(*aliases)
        base_tier = _guess_base_tier(
            population=population,
            capital_kind=capital_kind,
            is_world_city=False,
        )
        rows.append(
            {
                "id": city_id,
                "city_id": city_id,
                "stable_key": stable_key,
                "name": primary_name,
                "name_ascii": ascii_name,
                "name_en": ascii_name or primary_name,
                "name_zh": name_zh or ascii_name or primary_name,
                "country_code": country_code,
                "admin1_code": _clean_text(raw.get("admin1_code")),
                "admin1_name": "",
                "population": population,
                "capital_kind": capital_kind,
                "is_country_capital": capital_kind == "country_capital",
                "is_admin_capital": capital_kind == "admin_capital",
                "is_world_city": False,
                "timezone": _clean_text(raw.get("timezone")),
                "wikidataid": "",
                "geonamesid": _clean_text(raw.get("geonameid")),
                "natural_earth_name": "",
                "source": "geonames",
                "sources": ["geonames"],
                "feature_code": _clean_text(raw.get("feature_code")).upper(),
                "feature_class": _clean_text(raw.get("feature_class")).upper(),
                "featurecla": _clean_text(raw.get("feature_code")).upper(),
                "base_tier": base_tier,
                "min_zoom": _guess_min_zoom(base_tier, capital_kind),
                "aliases": aliases,
                "lon": lon,
                "lat": lat,
                "geometry": Point(lon, lat),
            }
        )

    return gpd.GeoDataFrame(rows, crs="EPSG:4326")


def _normalize_natural_earth() -> gpd.GeoDataFrame:
    source = _ensure_epsg4326(load_populated_places())
    rows: list[dict[str, object]] = []
    allowed_feature_classes = {
        "admin-0 capital",
        "admin-0 capital alt",
        "admin-0 region capital",
        "admin-1 capital",
        "admin-1 region capital",
        "populated place",
    }
    for raw in source.to_dict(orient="records"):
        country_code = _clean_text(raw.get("ISO_A2")).upper()
        if not re.fullmatch(r"[A-Z]{2}", country_code):
            continue
        featurecla = _clean_text(raw.get("FEATURECLA"))
        if featurecla.casefold() not in allowed_feature_classes:
            continue
        lon = _safe_float(raw.get("LONGITUDE"))
        lat = _safe_float(raw.get("LATITUDE"))
        geometry = raw.get("geometry")
        if (lon is None or lat is None) and geometry is not None and not geometry.is_empty:
            lon = float(geometry.x)
            lat = float(geometry.y)
        if lon is None or lat is None:
            continue
        primary_name = _clean_text(raw.get("NAME"))
        ascii_name = _clean_text(raw.get("NAMEASCII")) or primary_name
        aliases = _trim_aliases(
            _split_alias_field(raw.get("NAMEPAR")) + _split_alias_field(raw.get("NAMEALT")),
            primary_name=primary_name,
            ascii_name=ascii_name,
        )
        capital_kind = _capital_kind_from_natural_earth(featurecla)
        ne_id = _safe_int(raw.get("NE_ID"))
        natural_earth_token = ne_id or _stable_hash(
            country_code,
            ascii_name or primary_name,
            f"{lon:.5f}",
            f"{lat:.5f}",
        )
        city_id = _build_city_id("natural_earth", natural_earth_token)
        stable_key = _stable_key_for_city(city_id)
        name_zh = _pick_zh_name(raw.get("NAME_ZH"), *aliases)
        is_world_city = _safe_int(raw.get("WORLDCITY")) > 0 or _safe_int(raw.get("MEGACITY")) > 0
        base_tier = _guess_base_tier(
            population=_safe_int(raw.get("POP_MAX")),
            capital_kind=capital_kind,
            is_world_city=is_world_city,
        )
        rows.append(
            {
                "id": city_id,
                "city_id": city_id,
                "stable_key": stable_key,
                "name": primary_name,
                "name_ascii": ascii_name,
                "name_en": _clean_text(raw.get("NAME_EN")) or ascii_name or primary_name,
                "name_zh": name_zh or ascii_name or primary_name,
                "country_code": country_code,
                "admin1_code": "",
                "admin1_name": _clean_text(raw.get("ADM1NAME")),
                "population": _safe_int(raw.get("POP_MAX")),
                "capital_kind": capital_kind,
                "is_country_capital": capital_kind == "country_capital",
                "is_admin_capital": capital_kind == "admin_capital",
                "is_world_city": is_world_city,
                "timezone": _clean_text(raw.get("TIMEZONE")),
                "wikidataid": _clean_text(raw.get("WIKIDATAID")),
                "geonamesid": "",
                "natural_earth_name": primary_name,
                "source": "natural_earth",
                "sources": ["natural_earth"],
                "feature_code": featurecla,
                "feature_class": featurecla,
                "featurecla": featurecla,
                "base_tier": base_tier,
                "min_zoom": _guess_min_zoom(base_tier, capital_kind),
                "aliases": aliases,
                "lon": lon,
                "lat": lat,
                "geometry": Point(lon, lat),
            }
        )

    return gpd.GeoDataFrame(rows, crs="EPSG:4326")


def _build_ne_candidate_index(ne_gdf: gpd.GeoDataFrame) -> dict[tuple[str, str], set[int]]:
    index: dict[tuple[str, str], set[int]] = {}
    for idx, row in ne_gdf.iterrows():
        country_code = _clean_text(row.get("country_code")).upper()
        aliases = _coerce_text_list(row.get("aliases"))
        for alias in aliases:
            key = _normalize_text(alias)
            if not key:
                continue
            index.setdefault((country_code, key), set()).add(int(idx))
    return index


def _merge_city_rows(geonames_row: dict[str, object], ne_row: dict[str, object] | None) -> dict[str, object]:
    merged = dict(geonames_row)
    if not ne_row:
        merged["sources"] = ["geonames"]
        return merged

    aliases = _trim_aliases(
        list(geonames_row.get("aliases", [])) + list(ne_row.get("aliases", [])),
        primary_name=_clean_text(geonames_row.get("name")) or _clean_text(ne_row.get("name")),
        ascii_name=_clean_text(geonames_row.get("name_ascii")) or _clean_text(ne_row.get("name_ascii")),
    )
    population = max(_safe_int(geonames_row.get("population")), _safe_int(ne_row.get("population")))
    capital_kind = geonames_row.get("capital_kind")
    if _capital_score(ne_row.get("capital_kind")) > _capital_score(capital_kind):
        capital_kind = ne_row.get("capital_kind")
    is_world_city = bool(geonames_row.get("is_world_city")) or bool(ne_row.get("is_world_city"))
    base_tier = _guess_base_tier(
        population=population,
        capital_kind=capital_kind,
        is_world_city=is_world_city,
    )

    merged.update(
        {
            "id": _clean_text(ne_row.get("id")) or _clean_text(geonames_row.get("id")),
            "city_id": _clean_text(ne_row.get("city_id")) or _clean_text(geonames_row.get("city_id")),
            "stable_key": _clean_text(ne_row.get("stable_key")) or _clean_text(geonames_row.get("stable_key")),
            "name": _clean_text(ne_row.get("name")) or _clean_text(geonames_row.get("name")),
            "name_ascii": _clean_text(geonames_row.get("name_ascii")) or _clean_text(ne_row.get("name_ascii")),
            "name_en": _clean_text(ne_row.get("name_en")) or _clean_text(geonames_row.get("name_en")),
            "name_zh": _clean_text(ne_row.get("name_zh")) or _clean_text(geonames_row.get("name_zh")),
            "admin1_name": _clean_text(ne_row.get("admin1_name")) or _clean_text(geonames_row.get("admin1_name")),
            "population": population,
            "capital_kind": capital_kind,
            "is_country_capital": bool(geonames_row.get("is_country_capital")) or bool(ne_row.get("is_country_capital")),
            "is_admin_capital": bool(geonames_row.get("is_admin_capital")) or bool(ne_row.get("is_admin_capital")),
            "is_world_city": is_world_city,
            "timezone": _clean_text(geonames_row.get("timezone")) or _clean_text(ne_row.get("timezone")),
            "wikidataid": _clean_text(ne_row.get("wikidataid")) or _clean_text(geonames_row.get("wikidataid")),
            "natural_earth_name": _clean_text(ne_row.get("name")),
            "source": "merged",
            "sources": ["geonames", "natural_earth"],
            "feature_code": _clean_text(geonames_row.get("feature_code")) or _clean_text(ne_row.get("feature_code")),
            "feature_class": _clean_text(ne_row.get("feature_class")) or _clean_text(geonames_row.get("feature_class")),
            "featurecla": _clean_text(ne_row.get("featurecla")) or _clean_text(geonames_row.get("featurecla")),
            "base_tier": base_tier,
            "min_zoom": _guess_min_zoom(base_tier, capital_kind),
            "aliases": aliases,
        }
    )
    return merged


def merge_world_cities(geonames_gdf: gpd.GeoDataFrame, natural_earth_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if geonames_gdf.empty and natural_earth_gdf.empty:
        return gpd.GeoDataFrame(columns=["id", "name", "country_code", "geometry"], crs="EPSG:4326")

    ne_index = _build_ne_candidate_index(natural_earth_gdf)
    used_ne_indices: set[int] = set()
    rows: list[dict[str, object]] = []
    matches: list[tuple[dict[str, object], int | None]] = []
    ne_identity_owners: dict[int, tuple[float, str]] = {}

    for geo_row in geonames_gdf.to_dict(orient="records"):
        country_code = _clean_text(geo_row.get("country_code")).upper()
        candidate_indices: set[int] = set()
        for key in _record_name_keys(geo_row):
            candidate_indices.update(ne_index.get((country_code, key), set()))
        best_idx: int | None = None
        best_score: tuple[float, int, int, str] | None = None
        for idx in candidate_indices:
            ne_row = natural_earth_gdf.iloc[idx]
            distance_km = _haversine_km(
                float(geo_row["lon"]),
                float(geo_row["lat"]),
                float(ne_row["lon"]),
                float(ne_row["lat"]),
            )
            if distance_km > cfg.WORLD_CITY_MATCH_MAX_DISTANCE_KM:
                continue
            score = (
                distance_km,
                -_capital_score(ne_row.get("capital_kind")),
                -_safe_int(ne_row.get("population")),
                _clean_text(ne_row.get("id")),
            )
            if best_score is None or score < best_score:
                best_score = score
                best_idx = idx

        matches.append((geo_row, best_idx))
        if best_idx is not None:
            owner_score = (best_score[0], _clean_text(geo_row.get("id")))
            if best_idx not in ne_identity_owners or owner_score < ne_identity_owners[best_idx]:
                ne_identity_owners[best_idx] = owner_score

    # A Natural Earth identity belongs to exactly one GeoNames point. Choosing
    # the nearest match first avoids assigning the identity by source row order.
    for geo_row, best_idx in matches:
        match_row = None
        if best_idx is not None and _clean_text(geo_row.get("id")) == ne_identity_owners[best_idx][1]:
            used_ne_indices.add(best_idx)
            match_row = natural_earth_gdf.iloc[best_idx].to_dict()
        rows.append(_merge_city_rows(geo_row, match_row))

    for idx, ne_row in natural_earth_gdf.iterrows():
        if int(idx) in used_ne_indices:
            continue
        rows.append(dict(ne_row))

    merged = gpd.GeoDataFrame(rows, crs="EPSG:4326")
    merged = merged.sort_values(
        by=["country_code", "name_ascii", "population", "id"],
        ascending=[True, True, False, True],
        kind="stable",
    ).reset_index(drop=True)
    return merged


def _city_source_priority(source: object) -> int:
    return CITY_SOURCE_PRIORITY.get(_clean_text(source).casefold(), 9)


def _country_city_name_dedupe_key(row: dict[str, object]) -> tuple[object, ...]:
    return (
        _city_source_priority(row.get("source")),
        -_safe_int(row.get("population")),
        -_capital_score(row.get("capital_kind")),
        _clean_text(row.get("name_ascii")) or _clean_text(row.get("name")) or _clean_text(row.get("id")),
        _clean_text(row.get("id")),
    )


def _country_city_rank_key(row: dict[str, object]) -> tuple[object, ...]:
    return (
        -_safe_int(row.get("population")),
        -_capital_score(row.get("capital_kind")),
        _clean_text(row.get("name")) or _clean_text(row.get("name_ascii")) or _clean_text(row.get("id")),
        _clean_text(row.get("id")),
    )


def build_merged_world_city_dataset(
    *,
    geonames_frame: pd.DataFrame | None = None,
    natural_earth_gdf: gpd.GeoDataFrame | None = None,
) -> gpd.GeoDataFrame:
    geonames = _normalize_geonames(geonames_frame if geonames_frame is not None else _load_geonames_source())
    natural_earth = _normalize_natural_earth() if natural_earth_gdf is None else _ensure_epsg4326(natural_earth_gdf)
    return merge_world_cities(geonames, natural_earth)


@lru_cache(maxsize=1)
def _load_merged_world_city_dataset() -> gpd.GeoDataFrame:
    return build_merged_world_city_dataset()


@lru_cache(maxsize=16)
def _build_country_city_catalog_cached(country_code: str) -> gpd.GeoDataFrame:
    normalized_country = _clean_text(country_code).upper()
    if not re.fullmatch(r"[A-Z]{2}", normalized_country):
        return gpd.GeoDataFrame(columns=["id", "name", "country_code", "geometry"], crs="EPSG:4326")

    merged = _load_merged_world_city_dataset()
    catalog = merged[
        merged["country_code"].fillna("").astype(str).str.upper() == normalized_country
    ].copy()
    if catalog.empty:
        return gpd.GeoDataFrame(columns=["id", "name", "country_code", "geometry"], crs="EPSG:4326")

    deduped_by_name: dict[str, dict[str, object]] = {}
    for row in catalog.to_dict(orient="records"):
        normalized_name = _normalize_text(row.get("name_ascii") or row.get("name"))
        if not normalized_name:
            continue
        incumbent = deduped_by_name.get(normalized_name)
        if incumbent is None or _country_city_name_dedupe_key(row) < _country_city_name_dedupe_key(incumbent):
            deduped_by_name[normalized_name] = row

    rows = sorted(deduped_by_name.values(), key=_country_city_rank_key)
    if not rows:
        return gpd.GeoDataFrame(columns=["id", "name", "country_code", "geometry"], crs="EPSG:4326")

    return gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326").reset_index(drop=True)


def build_country_city_catalog(country_code: str, *, top_n: int | None = None) -> gpd.GeoDataFrame:
    """Return a reusable pre-attachment city catalog for one country."""
    catalog = _build_country_city_catalog_cached(country_code).copy()
    if top_n is not None:
        try:
            limit = max(0, int(top_n))
        except (TypeError, ValueError):
            limit = 0
        if limit:
            catalog = catalog.head(limit).copy()
        else:
            catalog = catalog.iloc[0:0].copy()
    return gpd.GeoDataFrame(catalog, geometry="geometry", crs="EPSG:4326")


def assign_stable_urban_area_ids(urban_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    urban = _ensure_epsg4326(urban_gdf.copy())
    if urban.empty:
        if "id" not in urban.columns:
            urban["id"] = pd.Series(dtype=str)
        return urban

    ids: list[str] = []
    seen: dict[str, int] = {}
    for geom in urban.geometry:
        if geom is None or geom.is_empty:
            base_id = "UA_EMPTY"
        else:
            base_id = f"UA_{hashlib.sha1(geom.wkb).hexdigest()[:12].upper()}"
        duplicate_index = seen.get(base_id, 0)
        seen[base_id] = duplicate_index + 1
        if duplicate_index:
            base_id = f"{base_id}_{duplicate_index}"
        ids.append(base_id)
    urban["id"] = ids
    return urban


def assign_urban_country_owners(
    urban_gdf: gpd.GeoDataFrame,
    political_gdf: gpd.GeoDataFrame,
) -> gpd.GeoDataFrame:
    urban = _ensure_epsg4326(urban_gdf.copy())
    if "country_owner_id" not in urban.columns:
        urban["country_owner_id"] = pd.Series(dtype=str)
    if "country_owner_code" not in urban.columns:
        urban["country_owner_code"] = pd.Series(dtype=str)
    if "country_owner_method" not in urban.columns:
        urban["country_owner_method"] = pd.Series(dtype=str)
    urban["country_owner_id"] = urban["country_owner_id"].fillna("").astype(str)
    urban["country_owner_code"] = urban["country_owner_code"].fillna("").astype(str)
    urban["country_owner_method"] = urban["country_owner_method"].fillna("").astype(str)

    if urban.empty or political_gdf is None or political_gdf.empty:
        return urban

    political = _ensure_epsg4326(
        political_gdf[["id", "cntr_code", "geometry"]].copy()
    )
    political = political[political.geometry.notna() & ~political.geometry.is_empty].copy()
    if political.empty:
        return urban

    urban_valid = urban[urban.geometry.notna() & ~urban.geometry.is_empty].copy()
    if urban_valid.empty:
        return urban

    urban_projected = urban_valid.to_crs("EPSG:6933")
    political_projected = political.to_crs("EPSG:6933")
    political_sindex = political_projected.sindex

    for urban_idx, urban_row in urban_projected.iterrows():
        geom = urban_row.geometry
        if geom is None or geom.is_empty:
            continue
        candidate_positions = list(political_sindex.query(geom, predicate="intersects"))

        best_owner_id = ""
        best_owner_code = ""
        best_area = 0.0
        for candidate_position in candidate_positions:
            candidate = political_projected.iloc[int(candidate_position)]
            candidate_geom = candidate.geometry
            if candidate_geom is None or candidate_geom.is_empty:
                continue
            overlap = geom.intersection(candidate_geom)
            if overlap is None or overlap.is_empty:
                continue
            overlap_area = float(overlap.area or 0.0)
            if overlap_area <= best_area:
                continue
            best_area = overlap_area
            best_owner_id = str(candidate.get("id") or "").strip()
            best_owner_code = str(candidate.get("cntr_code") or "").strip().upper()

        if not best_owner_id:
            centroid = geom.centroid
            distances = political_projected.distance(centroid)
            if distances.empty:
                continue
            nearest_index = distances.sort_values().index[0]
            nearest = political_projected.loc[nearest_index]
            best_owner_id = str(nearest.get("id") or "").strip()
            best_owner_code = str(nearest.get("cntr_code") or "").strip().upper()
            urban.loc[urban_idx, "country_owner_method"] = "nearest_gap_fallback"

        if not best_owner_id:
            continue
        urban.loc[urban_idx, "country_owner_id"] = best_owner_id
        urban.loc[urban_idx, "country_owner_code"] = best_owner_code
        if not str(urban.loc[urban_idx, "country_owner_method"]).strip():
            urban.loc[urban_idx, "country_owner_method"] = "max_overlap"

    return urban


def _attach_within(
    points: gpd.GeoDataFrame,
    polygons: gpd.GeoDataFrame,
    target_id_col: str,
    target_name_col: str = "",
    target_country_col: str = "",
) -> pd.DataFrame:
    if points.empty or polygons.empty:
        return pd.DataFrame(columns=["id", target_id_col, target_name_col, target_country_col, "__distance_m"])

    join_columns = [target_id_col, "geometry"]
    for optional in (target_name_col, target_country_col):
        if optional and optional not in join_columns and optional in polygons.columns:
            join_columns.append(optional)

    joined = gpd.sjoin(
        points[["id", "geometry"]],
        polygons[join_columns],
        how="left",
        predicate="within",
    )
    joined["__distance_m"] = 0.0
    return joined.reset_index(drop=True)


def _attach_nearest(
    points: gpd.GeoDataFrame,
    polygons: gpd.GeoDataFrame,
    *,
    target_id_col: str,
    target_name_col: str = "",
    target_country_col: str = "",
    max_distance_km: float,
) -> pd.DataFrame:
    if points.empty or polygons.empty:
        return pd.DataFrame(columns=["id", target_id_col, target_name_col, target_country_col, "__distance_m"])

    join_columns = [target_id_col, "geometry"]
    for optional in (target_name_col, target_country_col):
        if optional and optional not in join_columns and optional in polygons.columns:
            join_columns.append(optional)

    points_projected = points[["id", "geometry"]].to_crs("EPSG:3857")
    polygons_projected = polygons[join_columns].to_crs("EPSG:3857")
    joined = gpd.sjoin_nearest(
        points_projected,
        polygons_projected,
        how="left",
        max_distance=max_distance_km * 1000.0,
        distance_col="__distance_m",
    )
    return joined.reset_index(drop=True)


def _attach_cities_to_political(cities: gpd.GeoDataFrame, political: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    attached = cities.copy()
    attached["political_feature_id"] = ""
    attached["political_feature_name"] = ""
    attached["political_match_method"] = ""

    if attached.empty or political.empty:
        return attached

    political_ref = _ensure_epsg4326(
        political[["id", "name", "cntr_code", "geometry"]].copy()
    )
    within = _attach_within(
        attached,
        political_ref,
        target_id_col="id",
        target_name_col="name",
        target_country_col="cntr_code",
    )
    within = within.rename(
        columns={
            "id_left": "city_id",
            "id_right": "political_feature_id",
            "name": "political_feature_name",
            "cntr_code": "political_country_code",
        }
    )
    if within.empty:
        within = pd.DataFrame(columns=["city_id", "political_feature_id", "political_feature_name", "political_country_code"])
    best_within = within.groupby("city_id", dropna=False).first()

    attached["__city_id"] = attached["id"]
    attached["political_feature_id"] = attached["__city_id"].map(best_within.get("political_feature_id", pd.Series(dtype=object))).fillna("")
    attached["political_feature_name"] = attached["__city_id"].map(best_within.get("political_feature_name", pd.Series(dtype=object))).fillna("")
    matched_mask = attached["political_feature_id"] != ""
    attached.loc[matched_mask, "political_match_method"] = "within"

    missing = attached.loc[~matched_mask].copy()
    if missing.empty:
        return attached.drop(columns="__city_id")

    fallback_frames: list[pd.DataFrame] = []
    for country_code, subset in missing.groupby(missing["country_code"].fillna("").astype(str).str.upper(), sort=False):
        candidate_polygons = political_ref
        match_method = "nearest_any"
        if re.fullmatch(r"[A-Z]{2}", country_code):
            country_polygons = political_ref[
                political_ref["cntr_code"].fillna("").astype(str).str.upper() == country_code
            ].copy()
            if not country_polygons.empty:
                candidate_polygons = country_polygons
                match_method = "nearest_same_country"
        nearest = _attach_nearest(
            subset,
            candidate_polygons,
            target_id_col="id",
            target_name_col="name",
            target_country_col="cntr_code",
            max_distance_km=cfg.WORLD_CITY_POLITICAL_ATTACH_MAX_DISTANCE_KM,
        )
        if nearest.empty:
            continue
        nearest = nearest.rename(
            columns={
                "id_left": "city_id",
                "id_right": "political_feature_id",
                "name": "political_feature_name",
                "cntr_code": "political_country_code",
            }
        )
        nearest["political_match_method"] = match_method
        fallback_frames.append(nearest)

    if fallback_frames:
        fallback = pd.concat(fallback_frames, ignore_index=True)
        fallback = fallback.groupby("city_id", dropna=False).first()
        fallback_ids = attached["__city_id"].map(fallback.get("political_feature_id", pd.Series(dtype=object))).fillna("")
        fallback_names = attached["__city_id"].map(fallback.get("political_feature_name", pd.Series(dtype=object))).fillna("")
        fallback_methods = attached["__city_id"].map(fallback.get("political_match_method", pd.Series(dtype=object))).fillna("")
        missing_mask = attached["political_feature_id"] == ""
        attached.loc[missing_mask, "political_feature_id"] = fallback_ids.loc[missing_mask]
        attached.loc[missing_mask, "political_feature_name"] = fallback_names.loc[missing_mask]
        attached.loc[missing_mask, "political_match_method"] = fallback_methods.loc[missing_mask]

    return attached.drop(columns="__city_id")


def _attach_cities_to_urban(cities: gpd.GeoDataFrame, urban: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    attached = cities.copy()
    attached["urban_area_id"] = ""
    attached["urban_match_method"] = ""

    if attached.empty or urban.empty:
        return attached

    urban_ref = _ensure_epsg4326(urban[["id", "area_sqkm", "geometry"]].copy())
    within = _attach_within(
        attached,
        urban_ref,
        target_id_col="id",
    )
    within = within.rename(columns={"id_left": "city_id", "id_right": "urban_area_id"})
    if not within.empty and "area_sqkm" in urban_ref.columns:
        area_lookup = urban_ref.set_index("id")["area_sqkm"]
        within["__area_sqkm"] = within["urban_area_id"].map(area_lookup).fillna(float("inf"))
        within = within.sort_values(
            by=["city_id", "__area_sqkm", "__distance_m"],
            ascending=[True, True, True],
            kind="stable",
        )
    best_within = within.groupby("city_id", dropna=False).first() if not within.empty else pd.DataFrame()

    attached["__city_id"] = attached["id"]
    attached["urban_area_id"] = attached["__city_id"].map(best_within.get("urban_area_id", pd.Series(dtype=object))).fillna("")
    matched_mask = attached["urban_area_id"] != ""
    attached.loc[matched_mask, "urban_match_method"] = "within"

    missing = attached.loc[~matched_mask].copy()
    if missing.empty:
        return attached.drop(columns="__city_id")

    nearest = _attach_nearest(
        missing,
        urban_ref,
        target_id_col="id",
        max_distance_km=cfg.WORLD_CITY_URBAN_ATTACH_MAX_DISTANCE_KM,
    )
    if not nearest.empty:
        nearest = nearest.rename(columns={"id_left": "city_id", "id_right": "urban_area_id"})
        nearest = nearest.groupby("city_id", dropna=False).first()
        fallback_ids = attached["__city_id"].map(nearest.get("urban_area_id", pd.Series(dtype=object))).fillna("")
        missing_mask = attached["urban_area_id"] == ""
        attached.loc[missing_mask, "urban_area_id"] = fallback_ids.loc[missing_mask]
        attached.loc[missing_mask & (fallback_ids != ""), "urban_match_method"] = "nearest"

    return attached.drop(columns="__city_id")


def apply_city_name_overrides(cities: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Apply reviewed base translations by city identity, never by ambiguous names.

    Scenario display names remain in the scenario override layer.
    """
    overrides_path = Path(__file__).resolve().parents[1] / "data" / "i18n" / "manual_geo_overrides.json"
    overrides = json.loads(overrides_path.read_text(encoding="utf-8"))
    result = cities.copy()
    for index, row in result.iterrows():
        stable_key = _clean_text(row.get("stable_key")) or _stable_key_for_city(_clean_text(row.get("id")))
        translated = overrides.get(stable_key)
        if stable_key.startswith("id::CITY::") and isinstance(translated, str) and translated.strip():
            result.at[index, "name_zh"] = translated.strip()
    return result


def build_world_cities(
    *,
    political: gpd.GeoDataFrame,
    urban: gpd.GeoDataFrame,
    merged_city_dataset: gpd.GeoDataFrame | None = None,
) -> gpd.GeoDataFrame:
    merged = (merged_city_dataset.copy() if merged_city_dataset is not None else _load_merged_world_city_dataset().copy())
    merged = _attach_cities_to_political(merged, political)
    merged = _attach_cities_to_urban(merged, urban)
    geonames_mask = merged["source"].fillna("").astype(str).str.casefold() == "geonames"
    urban_match_mask = merged["urban_area_id"].fillna("").astype(str) != ""
    capital_keep_mask = (
        merged["is_country_capital"].fillna(False)
        | merged["is_admin_capital"].fillna(False)
        | (merged["capital_kind"].fillna("").astype(str) != "place")
    )
    tier_keep_mask = merged["base_tier"].fillna("").astype(str).isin(["regional", "major"])
    population_keep_mask = merged["population"].apply(_safe_int) >= 120_000
    keep_mask = (~geonames_mask) | urban_match_mask | capital_keep_mask | tier_keep_mask | population_keep_mask
    merged = merged.loc[keep_mask].copy()
    merged["capital_score"] = merged["capital_kind"].apply(_capital_score)
    merged = merged.sort_values(
        by=["country_code", "capital_score", "population", "name_ascii", "id"],
        ascending=[True, False, False, True, True],
        kind="stable",
    ).reset_index(drop=True)
    merged = merged.drop(columns=["capital_score"], errors="ignore")
    merged["host_feature_id"] = merged["political_feature_id"].fillna("").astype(str)
    merged["urban_match_id"] = merged["urban_area_id"].fillna("").astype(str)
    merged["is_capital"] = merged["capital_kind"].fillna("").astype(str) != "place"
    result = apply_city_name_overrides(gpd.GeoDataFrame(merged, crs="EPSG:4326"))
    validate_city_features(result.iterfeatures(drop_id=True))
    return result


def build_city_aliases_payload(world_cities: gpd.GeoDataFrame) -> dict[str, object]:
    validate_city_features(world_cities.iterfeatures(drop_id=True))
    alias_to_city_ids: dict[str, set[str]] = {}
    alias_to_stable_keys: dict[str, set[str]] = {}
    entries: list[dict[str, object]] = []
    geo: dict[str, dict[str, str]] = {}

    for row in world_cities.to_dict(orient="records"):
        city_id = _clean_text(row.get("id"))
        stable_key = _clean_text(row.get("stable_key")) or _stable_key_for_city(city_id)
        country_code = _clean_text(row.get("country_code")).upper()
        primary_name = _clean_text(row.get("name"))
        ascii_name = _clean_text(row.get("name_ascii"))
        name_en = _clean_text(row.get("name_en")) or ascii_name or primary_name or city_id
        name_zh = _clean_text(row.get("name_zh")) or name_en
        aliases = _trim_aliases(
            [
                city_id,
                stable_key,
                *_coerce_text_list(row.get("aliases")),
            ],
            primary_name=primary_name,
            ascii_name=ascii_name,
        )
        if primary_name and country_code:
            aliases = _trim_aliases(
                aliases + [f"{primary_name} ({country_code})"],
                primary_name=primary_name,
                ascii_name=ascii_name,
            )
        for alias in aliases:
            alias_to_city_ids.setdefault(alias, set()).add(city_id)
            alias_to_stable_keys.setdefault(alias, set()).add(stable_key)

        geo[stable_key] = {
            "en": name_en,
            "zh": name_zh,
        }

        entries.append(
            {
                "city_id": city_id,
                "stable_key": stable_key,
                "country_code": country_code,
                "primary_name": primary_name,
                "name": primary_name,
                "name_ascii": ascii_name,
                "name_en": name_en,
                "name_zh": name_zh,
                "aliases": aliases,
            }
        )

    unique_aliases = {
        alias: next(iter(city_ids))
        for alias, city_ids in sorted(alias_to_city_ids.items())
        if len(city_ids) == 1
    }
    unique_stable_aliases = {
        alias: next(iter(stable_keys))
        for alias, stable_keys in sorted(alias_to_stable_keys.items())
        if len(stable_keys) == 1
    }
    ambiguous_aliases = [
        {
            "alias": alias,
            "city_ids": sorted(city_ids),
            "stable_keys": sorted(alias_to_stable_keys.get(alias, set())),
        }
        for alias, city_ids in sorted(alias_to_city_ids.items())
        if len(city_ids) > 1
    ]

    return {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "entry_count": len(entries),
        "alias_count": len(unique_aliases),
        "ambiguous_alias_count": len(ambiguous_aliases),
        "conflict_count": 0,
        "conflicts": [],
        "ambiguous_aliases_sample": ambiguous_aliases[:ALIAS_SAMPLE_LIMIT],
        "geo": geo,
        "entries": entries,
        "alias_to_city_id": unique_aliases,
        "alias_to_stable_key": unique_stable_aliases,
    }


def _build_capital_catalog(world_cities: gpd.GeoDataFrame) -> dict[str, dict[str, object]]:
    capitals = world_cities.copy()
    capitals = capitals[
        (capitals["country_code"].fillna("") != "")
        & (
            capitals["is_country_capital"].fillna(False)
            | capitals["is_admin_capital"].fillna(False)
            | (capitals["capital_kind"].fillna("") == "country_capital")
        )
    ].copy()
    if capitals.empty:
        return {}

    capitals["source_rank"] = capitals["source"].map({"merged": 0, "natural_earth": 1, "geonames": 2}).fillna(3)
    capitals["capital_score"] = capitals["capital_kind"].apply(_capital_score)
    capitals = capitals.sort_values(
        by=["country_code", "capital_score", "is_country_capital", "source_rank", "population", "id"],
        ascending=[True, False, False, True, False, True],
        kind="stable",
    )

    catalog: dict[str, dict[str, object]] = {}
    for row in capitals.to_dict(orient="records"):
        country_code = _clean_text(row.get("country_code")).upper()
        if country_code and country_code not in catalog:
            catalog[country_code] = row
    return catalog


def _city_resolution_sort_key(row: dict[str, object], preferred_country_codes: tuple[str, ...] = ()) -> tuple[object, ...]:
    preferred = tuple(code for code in preferred_country_codes if re.fullmatch(r"[A-Z]{2}", _clean_text(code).upper()))
    country_code = _clean_text(row.get("country_code")).upper()
    tier = _clean_text(row.get("base_tier")).lower()
    return (
        0 if (not preferred or country_code in preferred) else 1,
        -_capital_score(row.get("capital_kind")),
        -int(bool(row.get("is_country_capital"))),
        -int(bool(row.get("is_admin_capital"))),
        -CITY_TIER_WEIGHT.get(tier, 0),
        -_safe_int(row.get("population")),
        _clean_text(row.get("name_ascii")) or _clean_text(row.get("name")) or _clean_text(row.get("id")),
        _clean_text(row.get("id")),
    )


def _dedupe_city_rows(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    deduped: dict[str, dict[str, object]] = {}
    for row in rows:
        city_id = _clean_text(row.get("id"))
        if city_id and city_id not in deduped:
            deduped[city_id] = row
    return list(deduped.values())


def _build_city_lookup(world_cities: gpd.GeoDataFrame) -> dict[str, object]:
    rows = world_cities.to_dict(orient="records")
    by_id: dict[str, dict[str, object]] = {}
    by_stable_key: dict[str, dict[str, object]] = {}
    by_alias: dict[str, list[dict[str, object]]] = {}
    by_country_alias: dict[tuple[str, str], list[dict[str, object]]] = {}

    for row in rows:
        city_id = _clean_text(row.get("id"))
        stable_key = _clean_text(row.get("stable_key"))
        country_code = _clean_text(row.get("country_code")).upper()
        if city_id:
            by_id[city_id] = row
        if stable_key:
            by_stable_key[stable_key] = row

        normalized_tokens: set[str] = set()
        for raw_value in [
            city_id,
            stable_key,
            row.get("name"),
            row.get("name_ascii"),
            row.get("name_en"),
            row.get("name_zh"),
            *_coerce_text_list(row.get("aliases")),
        ]:
            normalized = _normalize_text(raw_value)
            if normalized:
                normalized_tokens.add(normalized)

        for token in normalized_tokens:
            by_alias.setdefault(token, []).append(row)
            if country_code:
                by_country_alias.setdefault((country_code, token), []).append(row)

    return {
        "rows": rows,
        "by_id": by_id,
        "by_stable_key": by_stable_key,
        "by_alias": by_alias,
        "by_country_alias": by_country_alias,
    }


def _resolve_city_reference(
    reference: object,
    lookup: dict[str, object],
    *,
    preferred_country_codes: tuple[str, ...] = (),
) -> dict[str, object] | None:
    text = _clean_text(reference)
    if not text:
        return None
    direct = lookup["by_id"].get(text) or lookup["by_stable_key"].get(text)
    if direct:
        return direct

    normalized = _normalize_text(text)
    if not normalized:
        return None

    candidates: list[dict[str, object]] = []
    for country_code in preferred_country_codes:
        normalized_country = _clean_text(country_code).upper()
        if not normalized_country:
            continue
        candidates.extend(lookup["by_country_alias"].get((normalized_country, normalized), []))
    if not candidates:
        candidates.extend(lookup["by_alias"].get(normalized, []))
    if not candidates:
        return None

    deduped = _dedupe_city_rows(candidates)
    deduped.sort(key=lambda row: _city_resolution_sort_key(row, preferred_country_codes))
    return deduped[0] if deduped else None


def _read_json_payload(path: Path) -> dict[str, object]:
    payload = read_json_optional(path, default={})
    return payload if isinstance(payload, dict) else {}


def _extract_assignment_map(path: Path, primary_key: str) -> dict[str, str]:
    payload = _read_json_payload(path)
    candidate = payload.get(primary_key, payload)
    if not isinstance(candidate, dict):
        return {}
    extracted: dict[str, str] = {}
    for raw_feature_id, raw_tag in candidate.items():
        feature_id = _clean_text(raw_feature_id)
        tag = _clean_text(raw_tag).upper()
        if feature_id and tag:
            extracted[feature_id] = tag
    return extracted


def _build_tag_city_index(
    world_cities: gpd.GeoDataFrame,
    *,
    owners_by_feature: dict[str, str],
    controllers_by_feature: dict[str, str],
) -> dict[str, list[dict[str, object]]]:
    index: dict[str, list[dict[str, object]]] = {}
    for row in world_cities.to_dict(orient="records"):
        host_feature_id = _clean_text(row.get("host_feature_id") or row.get("political_feature_id"))
        if not host_feature_id:
            continue
        tag = _clean_text(controllers_by_feature.get(host_feature_id) or owners_by_feature.get(host_feature_id)).upper()
        if not tag:
            continue
        index.setdefault(tag, []).append(row)
    return index


def _capital_confidence(
    row: dict[str, object] | None,
    *,
    preferred_country_codes: tuple[str, ...],
    candidate_count: int,
) -> str:
    if not row:
        return ""
    capital_score = _capital_score(row.get("capital_kind"))
    tier = _clean_text(row.get("base_tier")).lower()
    country_code = _clean_text(row.get("country_code")).upper()
    preferred = {code for code in preferred_country_codes if re.fullmatch(r"[A-Z]{2}", _clean_text(code).upper())}
    country_match = not preferred or country_code in preferred
    if country_match and capital_score >= 3:
        return "high"
    if country_match and (capital_score >= 2 or tier == "major"):
        return "medium"
    if country_match and candidate_count == 1:
        return "medium"
    if country_match and tier == "regional":
        return "low"
    if capital_score >= 2 or tier == "major":
        return "low"
    return ""


def _build_capital_entry(
    *,
    tag: str,
    country_record: dict[str, object],
    city_row: dict[str, object],
    resolution_method: str,
    confidence: str,
    candidate_count: int = 0,
) -> dict[str, object]:
    return {
        "tag": tag,
        "display_name": _clean_text(country_record.get("display_name")),
        "lookup_iso2": _clean_text(country_record.get("lookup_iso2")).upper(),
        "base_iso2": _clean_text(country_record.get("base_iso2")).upper(),
        "capital_state_id": country_record.get("capital_state_id"),
        "city_id": _clean_text(city_row.get("id")),
        "stable_key": _clean_text(city_row.get("stable_key")),
        "city_name": _clean_text(city_row.get("name")),
        "name_ascii": _clean_text(city_row.get("name_ascii")),
        "capital_kind": _clean_text(city_row.get("capital_kind")),
        "base_tier": _clean_text(city_row.get("base_tier")),
        "population": _safe_int(city_row.get("population")),
        "country_code": _clean_text(city_row.get("country_code")).upper(),
        "host_feature_id": _clean_text(city_row.get("host_feature_id")),
        "urban_match_id": _clean_text(city_row.get("urban_match_id")),
        "lon": _safe_float(city_row.get("lon")),
        "lat": _safe_float(city_row.get("lat")),
        "source": _clean_text(city_row.get("source")),
        "resolution_method": resolution_method,
        "confidence": confidence,
        "candidate_count": candidate_count,
    }


def _append_unique_capital_entry(
    accepted_entries: dict[str, dict[str, object]],
    *,
    tag: str,
    entry: dict[str, object],
) -> None:
    if tag and tag not in accepted_entries:
        accepted_entries[tag] = entry


def emit_default_scenario_city_assets(output_dir: Path, world_cities: gpd.GeoDataFrame) -> None:
    scenarios_root = output_dir / "scenarios"
    if not scenarios_root.exists():
        return

    city_lookup = _build_city_lookup(world_cities)
    generated_at = datetime.now(timezone.utc).isoformat()

    for scenario_dir in sorted(
        path
        for path in scenarios_root.iterdir()
        if path.is_dir() and (path / "manifest.json").exists()
    ):
        scenario_id = scenario_dir.name
        manifest = _read_json_payload(scenario_dir / "manifest.json")
        countries_payload = _read_json_payload(scenario_dir / "countries.json")
        countries = countries_payload.get("countries", {}) if isinstance(countries_payload, dict) else {}
        if not isinstance(countries, dict):
            countries = {}
        featured_tags = {
            _clean_text(raw_tag).upper()
            for raw_tag in (manifest.get("featured_tags", []) if isinstance(manifest, dict) else [])
            if _clean_text(raw_tag)
        }

        owners_by_feature = _extract_assignment_map(scenario_dir / "owners.by_feature.json", "owners")
        controllers_by_feature = dict(owners_by_feature)
        tag_city_index = _build_tag_city_index(
            world_cities,
            owners_by_feature=owners_by_feature,
            controllers_by_feature=controllers_by_feature,
        )

        capitals_by_tag: dict[str, str] = {}
        capital_city_hints: dict[str, dict[str, object]] = {}
        city_overrides: dict[str, dict[str, object]] = {}
        accepted_capital_entries: dict[str, dict[str, object]] = {}
        rejected_capital_entries: list[dict[str, object]] = []
        unresolved_capitals: list[dict[str, object]] = []
        unresolved_manual_capitals: list[dict[str, object]] = []
        unresolved_city_renames: list[dict[str, object]] = []
        name_conflicts: list[dict[str, object]] = []

        manual_capitals = SCENARIO_MANUAL_CAPITALS.get(scenario_id, {})
        for raw_name, override in SCENARIO_CITY_RENAMES.get(scenario_id, {}).items():
            resolved = _resolve_city_reference(raw_name, city_lookup)
            if not resolved:
                unresolved_city_renames.append(
                    {
                        "reference": raw_name,
                        "reason": "city_not_found",
                    }
                )
                continue
            city_id = _clean_text(resolved.get("id"))
            if not city_id:
                continue
            stable_key = _clean_text(resolved.get("stable_key")) or _stable_key_for_city(city_id)
            existing_aliases = list(city_overrides.get(city_id, {}).get("aliases", []))
            override_aliases = _trim_aliases(
                existing_aliases + list(override.get("aliases", [])),
                primary_name=_clean_text(override.get("display_name", {}).get("en")) or _clean_text(resolved.get("name")),
                ascii_name=_clean_text(resolved.get("name_ascii")),
            )
            city_overrides[city_id] = {
                "stable_key": stable_key,
                "display_name": override.get("display_name", {}),
                "aliases": override_aliases,
                "tier": _clean_text(override.get("tier")) or _clean_text(resolved.get("base_tier")),
                "hidden": bool(override.get("hidden", False)),
            }
            base_name = _clean_text(resolved.get("name"))
            scenario_name_en = _clean_text(override.get("display_name", {}).get("en"))
            scenario_name_zh = _clean_text(override.get("display_name", {}).get("zh"))
            if scenario_name_en and scenario_name_en.casefold() != base_name.casefold():
                name_conflicts.append(
                    {
                        "city_id": city_id,
                        "host_feature_id": _clean_text(resolved.get("host_feature_id")),
                        "stable_key": stable_key,
                        "base_name": {
                            "en": base_name,
                            "zh": _clean_text(resolved.get("name_zh")) or base_name,
                        },
                        "scenario_name": {
                            "en": scenario_name_en,
                            "zh": scenario_name_zh or scenario_name_en,
                        },
                        "resolution": "scenario_city_override",
                    }
                )

        for raw_tag, raw_record in sorted(countries.items()):
            if not isinstance(raw_record, dict):
                continue
            tag = _clean_text(raw_tag).upper()
            if not tag:
                continue

            preferred_country_codes = tuple(
                code
                for code in [
                    _clean_text(raw_record.get("lookup_iso2")).upper(),
                    _clean_text(raw_record.get("base_iso2")).upper(),
                ]
                if re.fullmatch(r"[A-Z]{2}", code)
            )
            manual_reference = _clean_text(manual_capitals.get(tag))
            manual_city = _resolve_city_reference(
                manual_reference,
                city_lookup,
                preferred_country_codes=preferred_country_codes,
            ) if manual_reference else None
            if manual_reference and not manual_city:
                unresolved_manual_capitals.append(
                    {
                        "tag": tag,
                        "reference": manual_reference,
                        "display_name": _clean_text(raw_record.get("display_name")),
                    }
                )
            if manual_city:
                capitals_by_tag[tag] = _clean_text(manual_city.get("id"))
                manual_entry = _build_capital_entry(
                    tag=tag,
                    country_record=raw_record,
                    city_row=manual_city,
                    resolution_method="manual_override",
                    confidence="high",
                    candidate_count=1,
                )
                _append_unique_capital_entry(accepted_capital_entries, tag=tag, entry=manual_entry)

            candidate_rows = _dedupe_city_rows(tag_city_index.get(tag, []))
            candidate_rows.sort(key=lambda row: _city_resolution_sort_key(row, preferred_country_codes))
            best_candidate = candidate_rows[0] if candidate_rows else None
            confidence = _capital_confidence(
                best_candidate,
                preferred_country_codes=preferred_country_codes,
                candidate_count=len(candidate_rows),
            )
            capital_state_id = raw_record.get("capital_state_id")
            has_capital_state_hint = capital_state_id not in (None, "", 0, "0")

            candidate_entry = None
            if best_candidate:
                candidate_entry = _build_capital_entry(
                    tag=tag,
                    country_record=raw_record,
                    city_row=best_candidate,
                    resolution_method="capital_state_fallback" if has_capital_state_hint else "controlled_city_fallback",
                    confidence=confidence or "low",
                    candidate_count=len(candidate_rows),
                )

            should_accept_candidate = bool(best_candidate) and (
                confidence in {"high", "medium"} or len(candidate_rows) == 1
            )
            accepted_resolution_method = (
                "capital_state_fallback" if has_capital_state_hint else "controlled_city_fallback"
            )
            if should_accept_candidate:
                accepted_entry = _build_capital_entry(
                    tag=tag,
                    country_record=raw_record,
                    city_row=best_candidate,
                    resolution_method=accepted_resolution_method,
                    confidence=confidence or "medium",
                    candidate_count=len(candidate_rows),
                )
                capital_city_hints[tag] = accepted_entry
                _append_unique_capital_entry(accepted_capital_entries, tag=tag, entry=accepted_entry)
            elif candidate_entry and tag not in accepted_capital_entries:
                rejected_capital_entries.append(candidate_entry)
            elif not manual_city and not best_candidate:
                unresolved_capitals.append(
                    {
                        "tag": tag,
                        "display_name": _clean_text(raw_record.get("display_name")),
                        "lookup_iso2": _clean_text(raw_record.get("lookup_iso2")).upper(),
                        "base_iso2": _clean_text(raw_record.get("base_iso2")).upper(),
                        "capital_state_id": capital_state_id,
                        "reason": "no_controlled_city_candidates",
                    }
                )
            elif not manual_city and best_candidate and confidence not in {"high", "medium"} and len(candidate_rows) > 1:
                unresolved_capitals.append(
                    {
                        "tag": tag,
                        "display_name": _clean_text(raw_record.get("display_name")),
                        "lookup_iso2": _clean_text(raw_record.get("lookup_iso2")).upper(),
                        "base_iso2": _clean_text(raw_record.get("base_iso2")).upper(),
                        "capital_state_id": capital_state_id,
                        "reason": (
                            "capital_hint_low_confidence"
                            if has_capital_state_hint
                            else "controlled_city_low_confidence"
                        ),
                        "candidate_city_id": _clean_text(best_candidate.get("id")),
                    }
                )

        featured_runtime_missing = [
            tag
            for tag in sorted(featured_tags)
            if tag not in capitals_by_tag and tag not in capital_city_hints
        ]
        city_assets_payload = {
            "version": 1,
            "scenario_id": scenario_id,
            "generated_at": generated_at,
            "cities": city_overrides,
            "audit": {
                "renamed_city_count": len(city_overrides),
                "name_conflict_count": len(name_conflicts),
                "unresolved_city_rename_count": len(unresolved_city_renames),
                "name_conflicts": name_conflicts,
                "unresolved_city_renames": unresolved_city_renames,
            },
        }
        capital_overrides_payload = {
            "version": 1,
            "scenario_id": scenario_id,
            "generated_at": generated_at,
            "capitals_by_tag": capitals_by_tag,
            "capital_city_hints": capital_city_hints,
            "audit": {
                "manual_capital_count": len(capitals_by_tag),
                "capital_hint_count": len(capital_city_hints),
                "unresolved_capital_count": len(unresolved_capitals),
                "unresolved_manual_capital_count": len(unresolved_manual_capitals),
                "featured_runtime_missing_count": len(featured_runtime_missing),
                "featured_runtime_missing_tags": featured_runtime_missing,
                "unresolved_capitals": unresolved_capitals,
                "unresolved_manual_capitals": unresolved_manual_capitals,
            },
        }
        overrides_payload = compose_city_overrides_payload(
            city_assets_payload,
            capital_overrides_payload,
            scenario_id=scenario_id,
            generated_at=generated_at,
        )
        city_assets_partial_path = scenario_dir / cfg.SCENARIO_CITY_ASSETS_PARTIAL_FILENAME
        write_json_atomic(city_assets_partial_path, city_assets_payload, ensure_ascii=False, indent=2)

        capital_defaults_partial_payload, capital_hints_payload = _build_default_capital_outputs(
            scenario_id=scenario_id,
            generated_at=generated_at,
            accepted_capital_entries=accepted_capital_entries,
            rejected_capital_entries=rejected_capital_entries,
            unresolved_capitals=unresolved_capitals,
            featured_runtime_missing=featured_runtime_missing,
        )
        capital_defaults_partial_path = scenario_dir / cfg.SCENARIO_CAPITAL_DEFAULTS_PARTIAL_FILENAME
        write_json_atomic(capital_defaults_partial_path, capital_defaults_partial_payload, ensure_ascii=False, indent=2)
        capital_hints_path = scenario_dir / cfg.SCENARIO_CAPITAL_HINTS_FILENAME
        if scenario_id not in cfg.SCENARIO_IDS_WITHOUT_PUBLIC_CAPITAL_HINTS:
            write_json_atomic(capital_hints_path, capital_hints_payload, ensure_ascii=False, indent=2)
        elif capital_hints_path.exists():
            capital_hints_path.unlink()

        overrides_path = scenario_dir / cfg.SCENARIO_CITY_OVERRIDES_FILENAME
        write_json_atomic(overrides_path, overrides_payload, ensure_ascii=False, indent=2)

        manifest_path = scenario_dir / "manifest.json"
        if manifest_path.exists() and isinstance(manifest, dict):
            manifest["city_overrides_url"] = f"data/scenarios/{scenario_id}/{cfg.SCENARIO_CITY_OVERRIDES_FILENAME}"
            if scenario_id in cfg.SCENARIO_IDS_WITHOUT_PUBLIC_CAPITAL_HINTS:
                manifest.pop("capital_hints_url", None)
            else:
                manifest["capital_hints_url"] = f"data/scenarios/{scenario_id}/{cfg.SCENARIO_CAPITAL_HINTS_FILENAME}"
            write_json_atomic(manifest_path, manifest, ensure_ascii=False, indent=2)
