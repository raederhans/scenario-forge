"""Generate data/scenario-rules/hoi4_split_overlay.json, the post-build HOI4 ownership overlay.

Run `python tools/build_hoi4_split_overlay.py`, then `python tools/apply_hoi4_split_overlay.py`.
Entries are applied in order; later entries may filter on owners set by earlier ones.
"""
import colorsys
import json
import math
from pathlib import Path

W = Path(__file__).resolve().parents[1]
B = ["hoi4_1936", "hoi4_1939"]
Y36, Y39 = ["hoi4_1936"], ["hoi4_1939"]


def load(s):
    return json.load(open(W / f"data/scenarios/{s}/countries.json", encoding="utf-8"))["countries"]


C36, C39 = load("hoi4_1936"), load("hoi4_1939")
PARENT_COLOR = {t: (C36.get(t) or C39.get(t))["color_hex"] for t in set(C36) | set(C39)}

# 每个宗主国下的子单位依次取色：色相小幅旋转 + 明度交替，同族可辨又看得出母国。
_child_index = {}


def shade(parent, hue_span=0.07):
    i = _child_index.get(parent, 0)
    _child_index[parent] = i + 1
    r, g, b = (int(PARENT_COLOR[parent][k:k + 2], 16) / 255 for k in (1, 3, 5))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    steps = [(-1, 0.10), (1, -0.08), (-2, -0.02), (2, 0.14), (-3, 0.05), (3, -0.12),
             (-4, 0.16), (4, 0.0), (-5, -0.06), (5, 0.08), (-6, 0.12), (6, -0.04)]
    dh, dl = steps[i % len(steps)]
    h = (h + dh * hue_span / 3) % 1.0
    l = min(0.80, max(0.22, l + dl + (0.10 if l < 0.3 else 0)))
    s = min(0.95, max(0.35, s))
    rr, gg, bb = colorsys.hls_to_rgb(h, l, s)
    return "#%02x%02x%02x" % (round(rr * 255), round(gg * 255), round(bb * 255))


E = []


def add(id, scen, tag, en, zh, select, parent=None, kind=None, color=None, only=None,
        exclude=None, cores=None, notes=None):
    e = {"id": id, "scenarios": scen, "tag": tag}
    if en:
        e["name_en"] = en
    if zh:
        e["name_zh"] = zh
    if parent:
        e["parent_owner_tag"] = parent
    if kind:
        e["subject_kind"] = kind
    if color:
        e["color_hex"] = color
    e["select"] = select
    if exclude:
        e["exclude"] = exclude
    if only:
        e["only_from_owners"] = only
    if cores:
        e["cores"] = cores
    if notes:
        e["notes"] = notes
    E.append(e)


def CC(*c):
    return {"country_codes": list(c)}


def HG(*g):
    return {"hierarchy_groups": list(g)}


def PF(*p):
    return {"prefectures": list(p)}


# ---------- 现成错误修正 ----------
add("faroe_islands", B, "FRO", "Faroe Islands", "法罗群岛", CC("FO"), parent="DEN", kind="colony", only=["ENG"],
    notes="Faroe Islands stay under Denmark until the 1940 British occupation.")
add("greenland_parent", B, "GRN", None, None, {"owners": ["GRN"]}, parent="DEN", kind="colony", only=["GRN"])
add("hatay_1936", Y36, "SYR", None, None, {"feature_ids": ["TR631"]}, only=["TUR"],
    notes="Sanjak of Alexandretta remains in the French Syrian mandate in 1936.")
add("dodecanese", B, "DOD", "Italian Aegean Islands", "意属爱琴海群岛", {"feature_ids": ["EL421"]},
    parent="ITA", kind="colony", only=["GRE"])
add("british_somaliland", B, "SML", "British Somaliland", "英属索马里兰",
    HG("SO_Awdal", "SO_Woqooyi_Galbeed", "SO_Sanaag", "SO_Sool", "SO_Togdheer"),
    parent="ENG", kind="protectorate", only=["SOM", "AOI"])
add("newfoundland", B, "NFL", "Dominion of Newfoundland", "纽芬兰自治领", HG("CA_Newfoundland_and_Labrador"),
    parent="ENG", kind="dominion", only=["CAN"],
    notes="Newfoundland under Commission of Government (1934-1949), separate from Canada.")
add("portuguese_india", B, "GOA", "Portuguese India", "葡属印度",
    HG("IN_Goa", "IN_Dadra_and_Nagar_Haveli_and_Daman_and_Diu"), parent="POR", kind="colony", only=["RAJ"])
add("monaco", B, "MCO", "Monaco", "摩纳哥公国", CC("MC"), color="#d8434e", only=["FRA"])
add("andorra", B, "AND", "Andorra", "安道尔", CC("AD"), color="#2a4fa8", only=["SPR"])
add("liechtenstein", B, "LIE", "Liechtenstein", "列支敦士登", CC("LI"), color="#3a5fcd", only=["SWI"])
add("san_marino", B, "SMN", "San Marino", "圣马力诺", CC("SM"), color="#6fb3d9", only=["ITA"])
add("danzig", B, "DNZ", "Free City of Danzig", "但泽自由市", {"feature_ids": ["PL_POW_2261", "PL_POW_2264"]},
    color="#c9a227", only=["POL"], notes="City parcels only; the Free City's rural districts are not split out yet.")

# ---------- 英国 ----------
for id, tag, en, zh, sel, kind in [
    ("southern_rhodesia", "RHO", "Southern Rhodesia", "南罗得西亚", CC("ZW"), "colony"),
    ("northern_rhodesia", "NRH", "Northern Rhodesia", "北罗得西亚", CC("ZM"), "protectorate"),
    ("nyasaland", "NYS", "Nyasaland", "尼亚萨兰", CC("MW"), "protectorate"),
    ("basutoland", "BAS", "Basutoland", "巴苏陀兰", CC("LS"), "protectorate"),
    ("swaziland", "SWZ", "Swaziland", "斯威士兰", CC("SZ"), "protectorate"),
    ("hong_kong", "HKG", "Hong Kong", "香港", CC("HK"), "colony"),
    ("british_honduras", "BHO", "British Honduras", "英属洪都拉斯", CC("BZ"), "colony"),
    ("british_guiana", "BGU", "British Guiana", "英属圭亚那", CC("GY"), "colony"),
    ("bahrain", "BAH", "Bahrain", "巴林", CC("BH"), "protectorate"),
    ("qatar", "QAT", "Qatar", "卡塔尔", CC("QA"), "protectorate"),
    ("trucial_states", "TRU", "Trucial States", "特鲁西尔诸国", CC("AE"), "protectorate"),
    ("malta", "MLT", "Malta", "马耳他", CC("MT"), "colony"),
    ("cyprus", "CYP", "Cyprus", "塞浦路斯", CC("CY"), "colony"),
    ("jamaica", "JAM", "Jamaica", "牙买加", CC("JM"), "colony"),
    ("trinidad", "TRI", "Trinidad and Tobago", "特立尼达和多巴哥", CC("TT"), "colony"),
    ("bahamas", "BHM", "Bahamas", "巴哈马", CC("BS"), "colony"),
    ("mauritius", "MUR", "Mauritius", "毛里求斯", CC("MU", "SC", "IO"), "colony"),
    ("falklands", "FLK", "Falkland Islands", "福克兰群岛", CC("FK", "GS"), "colony"),
]:
    add(id, B, tag, en, zh, sel, parent="ENG", kind=kind, only=["ENG"])
add("bwa_nigeria", B, "BWA", "Nigeria", "尼日利亚",
    {"country_codes": ["NG"], "hierarchy_groups": ["CM_Northwest", "CM_Southwest"]},
    only=["BWA", "FRA", "AEF", "ENG"], notes="Nigeria plus the British Cameroons mandate.")
for id, tag, en, zh, cc in [("gold_coast", "GLD", "Gold Coast", "黄金海岸", "GH"),
                            ("sierra_leone", "SIE", "Sierra Leone", "塞拉利昂", "SL"),
                            ("gambia", "GAM", "Gambia", "冈比亚", "GM")]:
    add(id, B, tag, en, zh, CC(cc), parent="ENG", kind="colony", only=["BWA"])
ZANZIBAR = ("TZ_Unguja_South", "TZ_Unguja_North", "TZ_Mjini_Magharibi", "TZ_North_Pemba", "TZ_South_Pemba")
add("bea_kenya", B, "BEA", "Kenya", "肯尼亚", CC("KE"), only=["BEA"])
add("uganda", B, "UGA", "Uganda", "乌干达", CC("UG"), parent="ENG", kind="protectorate", only=["BEA"])
add("tanganyika", B, "TGN", "Tanganyika", "坦噶尼喀", CC("TZ"), parent="ENG", kind="mandate", only=["BEA"],
    exclude=HG(*ZANZIBAR))
add("zanzibar", B, "ZAN", "Zanzibar", "桑给巴尔", HG(*ZANZIBAR), parent="ENG", kind="protectorate", only=["BEA"])
add("sikkim", B, "SKM", "Sikkim", "锡金", HG("IN_Sikkim"),
    parent="RAJ", kind="protectorate", only=["RAJ"])
add("straits_settlements", B, "STR", "Straits Settlements", "海峡殖民地",
    {"country_codes": ["SG"], "feature_ids": ["MYS-1139", "MYS-1145", "MYS-4833", "AU_REMOTE_INDIAN_OCEAN_TERRITORIES"]},
    parent="ENG", kind="colony", only=["MAL", "AST"])
add("sarawak", B, "SRW", "Kingdom of Sarawak", "沙捞越王国", {"feature_ids": ["MYS-1187"]}, parent="ENG", kind="protectorate", only=["MAL"])
add("north_borneo", B, "NBO", "British North Borneo", "英属北婆罗洲", {"feature_ids": ["MYS-1186"]}, parent="ENG", kind="protectorate", only=["MAL"])
add("brunei", B, "BEI", "Sultanate of Brunei", "文莱苏丹国", CC("BN"), parent="ENG", kind="protectorate", only=["MAL"])
for t in ["BOT", "KUW"]:
    add(f"{t.lower()}_parent", B, t, None, None, {"owners": [t]}, parent="ENG", kind="protectorate", only=[t])

# ---------- 法国 ----------
add("french_west_africa", B, "AOF", "French West Africa", "法属西非联邦",
    CC("SN", "MR", "ML", "GN", "CI", "BJ", "NE", "BF"), parent="FRA", kind="federation", only=["AOF"])
add("french_togo", B, "TOG", "French Togoland", "法属多哥", CC("TG"), parent="FRA", kind="mandate", only=["AOF"])
add("french_equatorial_africa", B, "AEF", "French Equatorial Africa", "法属赤道非洲联邦",
    CC("TD", "CF", "CG", "GA"), parent="FRA", kind="federation", only=["AEF"])
add("french_cameroon", B, "FCM", "French Cameroun", "法属喀麦隆", CC("CM"), parent="FRA", kind="mandate",
    only=["AEF", "FRA", "AOF"], exclude=HG("CM_Northwest", "CM_Southwest"))
add("djibouti", B, "DJI", "French Somaliland", "法属索马里", CC("DJ"), parent="FRA", kind="colony", only=["FRA"])
add("madagascar_dependencies", B, "MAD", None, None, CC("KM", "TF"), only=["FRA"])
for t in ["GF", "GP", "MQ", "RE"]:
    add(f"{t.lower()}_parent", B, t, None, None, {"owners": [t]}, parent="FRA", kind="colony", only=[t])
add("french_indochina", B, "VIN", "French Indochina", "法属印度支那联邦",
    CC("VN", "KH", "LA"), parent="FRA", kind="federation", only=["VIN"])

# ---------- 其他宗主国 ----------
for id, tag, en, zh, cc in [("cape_verde", "CPV", "Cape Verde", "佛得角", "CV"),
                            ("portuguese_guinea", "PGU", "Portuguese Guinea", "葡属几内亚", "GW"),
                            ("sao_tome", "STP", "São Tomé and Príncipe", "圣多美和普林西比", "ST"),
                            ("portuguese_timor", "TMR", "Portuguese Timor", "葡属帝汶", "TL"),
                            ("macau", "MCU", "Macau", "澳门", "MO")]:
    add(id, B, tag, en, zh, CC(cc), parent="POR", kind="colony", only=["POR"])
add("suriname", B, "SUR", "Suriname", "苏里南", CC("SR"), parent="HOL", kind="colony", only=["HOL"])
add("ruanda_urundi", B, "RUA", "Ruanda-Urundi", "卢安达-乌隆迪", CC("RW", "BI"), parent="BEL", kind="mandate", only=["RCG"])
add("alaska", B, "ALK", "Territory of Alaska", "阿拉斯加领地", {"country_codes": ["US"], "bbox": [-180, 51, -129.9, 72]},
    parent="USA", kind="colony", only=["USA"])
add("hawaii", B, "HAW", "Territory of Hawaii", "夏威夷领地", {"country_codes": ["US"], "bbox": [-161, 18, -154, 23]},
    parent="USA", kind="colony", only=["USA"])
add("puerto_rico_parent", B, "PUE", None, None, {"owners": ["PUE"]}, parent="USA", kind="colony", only=["PUE"])

# ---------- 日本、芬兰北疆 ----------
add("karafuto_kurils", B, "JAP", None, None,
    {"country_codes": ["RU"], "bboxes": [[141.0, 43.0, 145.2, 49.6], [145.2, 43.3, 157.5, 51.5]]}, only=["SOV"],
    notes="Karafuto (south of 50N) and the Kuril Islands, approximated by parcel centroid.")
add("kwantung", B, "KWT", "Kwantung Leased Territory", "关东州", PF("大连市"), parent="JAP", kind="colony", only=["MAN"])
add("manchukuo_parent", B, "MAN", None, None, {"owners": ["MAN"]}, parent="JAP", kind="puppet", only=["MAN"])

# ---------- 苏联 ----------
CRIMEA = [32.4, 44.0, 36.8, 46.12]
add("ukrainian_ssr", B, "UKR", "Ukrainian SSR", "乌克兰苏维埃社会主义共和国", CC("UA"), parent="SOV",
    kind="union_republic", only=["SOV"], exclude={"country_codes": ["UA"], "bbox": CRIMEA})
add("crimean_assr", B, "CRM", "Crimean ASSR", "克里米亚自治苏维埃社会主义共和国", {"country_codes": ["UA"], "bbox": CRIMEA},
    parent="SOV", kind="autonomous_republic", only=["SOV"])
add("byelorussian_ssr", B, "BLR", "Byelorussian SSR", "白俄罗斯苏维埃社会主义共和国", CC("BY"), parent="SOV",
    kind="union_republic", only=["SOV"])
add("transcaucasian_sfsr", Y36, "TSC", "Transcaucasian SFSR", "外高加索社会主义联邦苏维埃共和国", CC("GE", "AM", "AZ"),
    parent="SOV", kind="union_republic", only=["SOV"])
for id, tag, en, zh, cc in [("georgian_ssr", "GEO", "Georgian SSR", "格鲁吉亚苏维埃社会主义共和国", "GE"),
                            ("armenian_ssr", "ARM", "Armenian SSR", "亚美尼亚苏维埃社会主义共和国", "AM"),
                            ("azerbaijan_ssr", "AZR", "Azerbaijan SSR", "阿塞拜疆苏维埃社会主义共和国", "AZ")]:
    add(id, Y39, tag, en, zh, CC(cc), parent="SOV", kind="union_republic", only=["SOV"])
KAZ_COLOR, KYR_COLOR = shade("SOV"), shade("SOV")
add("kazakh_1936", Y36, "KAZ", "Kazakh ASSR", "哈萨克自治苏维埃社会主义共和国", CC("KZ"), parent="SOV",
    kind="autonomous_republic", only=["SOV"], color=KAZ_COLOR)
add("kazakh_1939", Y39, "KAZ", "Kazakh SSR", "哈萨克苏维埃社会主义共和国", CC("KZ"), parent="SOV",
    kind="union_republic", only=["SOV"], color=KAZ_COLOR)
add("kirghiz_1936", Y36, "KYR", "Kirghiz ASSR", "吉尔吉斯自治苏维埃社会主义共和国", CC("KG"), parent="SOV",
    kind="autonomous_republic", only=["SOV"], color=KYR_COLOR)
add("kirghiz_1939", Y39, "KYR", "Kirghiz SSR", "吉尔吉斯苏维埃社会主义共和国", CC("KG"), parent="SOV",
    kind="union_republic", only=["SOV"], color=KYR_COLOR)
add("uzbek_ssr", B, "UZB", "Uzbek SSR", "乌兹别克苏维埃社会主义共和国", CC("UZ"), parent="SOV", kind="union_republic",
    only=["SOV"], exclude={"feature_ids": ["UZB-356"]})
add("karakalpak_assr", B, "KKP", "Karakalpak ASSR", "卡拉卡尔帕克自治苏维埃社会主义共和国", {"feature_ids": ["UZB-356"]},
    parent="SOV", kind="autonomous_republic", only=["SOV"])
add("turkmen_ssr", B, "TMS", "Turkmen SSR", "土库曼苏维埃社会主义共和国", CC("TM"), parent="SOV", kind="union_republic", only=["SOV"])
add("tajik_ssr", B, "TAJ", "Tajik SSR", "塔吉克苏维埃社会主义共和国", CC("TJ"), parent="SOV", kind="union_republic", only=["SOV"])
for id, tag, en, zh, groups in [
    ("tatar_assr", "TAT", "Tatar ASSR", "鞑靼自治共和国", ["RU_Republic_of_Tatarstan"]),
    ("bashkir_assr", "BSH", "Bashkir ASSR", "巴什基尔自治共和国", ["RU_Bashkortostan"]),
    ("chuvash_assr", "CVS", "Chuvash ASSR", "楚瓦什自治共和国", ["RU_Chuvash_Republic"]),
    ("mari_assr", "MRE", "Mari ASSR", "马里自治共和国", ["RU_Mari_El_Republic"]),
    ("udmurt_assr", "UDM", "Udmurt ASSR", "乌德穆尔特自治共和国", ["RU_Udmurt_Republic"]),
    ("mordovian_assr", "MRD", "Mordovian ASSR", "莫尔多瓦自治共和国", ["RU_Republic_of_Mordovia"]),
    ("komi_assr", "KOM", "Komi ASSR", "科米自治共和国", ["RU_Komi_Republic"]),
    ("yakut_assr", "YAK", "Yakut ASSR", "雅库特自治共和国", ["RU_Sakha_Republic"]),
    ("buryat_assr", "BYA", "Buryat-Mongol ASSR", "布里亚特-蒙古自治共和国", ["RU_Republic_of_Buryatia"]),
    ("karelian_assr", "KRL", "Karelian ASSR", "卡累利阿自治共和国", ["RU_Karelia"]),
    ("dagestan_assr", "DAG", "Dagestan ASSR", "达吉斯坦自治共和国", ["RU_Republic_of_Dagestan"]),
    ("kalmyk_assr", "KAL", "Kalmyk ASSR", "卡尔梅克自治共和国", ["RU_Republic_of_Kalmykia"]),
    ("kabardino_balkar_assr", "KBA", "Kabardino-Balkar ASSR", "卡巴尔达-巴尔卡尔自治共和国", ["RU_Kabardino_Balkaria"]),
    ("north_ossetian_assr", "NOS", "North Ossetian ASSR", "北奥塞梯自治共和国", ["RU_Republic_of_North_Ossetia_Alania"]),
    ("chechen_ingush_assr", "CHE", "Chechen-Ingush ASSR", "车臣-印古什自治共和国", ["RU_Chechen_Republic", "RU_Republic_of_Ingushetia"]),
]:
    add(id, B, tag, en, zh, HG(*groups), parent="SOV", kind="autonomous_republic", only=["SOV"],
        notes="Modern republic boundary used as an approximation.")
add("finnish_karelia", B, "FIN", None, None,
    {"country_codes": ["RU"], "bboxes": [[27.5, 60.3, 32.6, 62.7], [28.5, 69.0, 31.7, 70.3]]},
    only=["SOV", "KRL"], exclude={"feature_ids": ["RU_RAY_50074027B20331318716688"]},
    notes="Pre-Winter War Finnish Karelian Isthmus, Ladoga Karelia and Petsamo, approximated by parcel centroid.")

# ---------- 欧洲 1939 ----------
BOM_RULE = next(r for r in json.load(open(W / "data/scenario-rules/hoi4_1939.manual.json", encoding="utf-8"))["rules"]
                if r["rule_id"] == "bohemia_moravia_protectorate_1939")
add("bohemia_moravia", Y39, "BOM", "Protectorate of Bohemia and Moravia", "波希米亚和摩拉维亚保护国",
    CC(*BOM_RULE["include_country_codes"]), exclude={"feature_ids": BOM_RULE["exclude_feature_ids"]},
    parent="GER", kind="protectorate", only=["GER"])
add("slovakia_parent", Y39, "SLO", None, None, {"owners": ["SLO"]}, parent="GER", kind="puppet", only=["SLO"])
add("albania_1939", Y39, "ALB", "Albanian Kingdom", "阿尔巴尼亚王国", CC("AL"), parent="ITA", kind="puppet",
    only=["ITA"], color=PARENT_COLOR.get("ALB") or "#a05a5a")

# ---------- 中国 1936 ----------
add("east_hebei", Y36, "EHC", "East Hebei Autonomous Council", "冀东防共自治政府", CC("CN"), parent="JAP",
    kind="puppet", only=["JAP"], color="#f7b08f")
add("hebei_chahar", Y36, "HBC", "Hebei-Chahar Political Council", "冀察政务委员会", HG("CN_Hebei", "CN_Beijing", "CN_Tianjin"),
    color="#5d6fb3", only=["CHI"])
add("hunan_clique", Y36, "HNN", "Hunan Clique", "湘系（何键）", HG("CN_Hunan"), color="#8a6fb0", only=["CHI"])
add("xikang_clique", Y36, "SIC", "Xikang Administration", "西康军政区（刘文辉）", PF("甘孜藏族自治州"),
    color="#006080", only=["CHU", "CHI", "SIC"])
add("xikang_clique_1939", Y39, "SIC", "Xikang Administration", "西康军政区（刘文辉）", PF("甘孜藏族自治州", "雅安市"),
    color="#006080", only=["CHU", "CHI", "SIC"], exclude={"feature_ids": ["CN_CITY_17275852B99222209572409"]})
add("khotan_ma", Y36, "KHM", "Khotan Emirate", "和阗马虎山政权", PF("和田地区", "喀什地区"), color="#9c7a3c", only=["SIK"])

# ---------- 中国 1939：战线（owner = 实际控制者，cores 保留法理归属） ----------
OCC = dict(cores="keep", parent="JAP", kind="puppet")
add("provisional_government", Y39, "NCP", "Provisional Government of the Republic of China", "中华民国临时政府",
    {"hierarchy_groups": ["CN_Beijing", "CN_Tianjin", "CN_Hebei", "CN_Shandong"],
     "prefectures": ["安阳市", "鹤壁市", "新乡市", "焦作市", "濮阳市", "开封市", "商丘市",
                     "太原市", "阳泉市", "晋中市", "长治市", "晋城市", "运城市", "临汾市", "忻州市"]},
    exclude=PF("张家口市", "承德市"), only=["CHI", "SHX", "PRC"], color="#b0874a", **OCC)
add("south_chahar", Y39, "CNZ", "South Chahar Autonomous Government", "察南自治政府", PF("张家口市"),
    only=["CHI", "SHX", "MEN"], color="#c6e8a4", **OCC)
add("north_shanxi", Y39, "JBZ", "North Shanxi Autonomous Government", "晋北自治政府", PF("大同市", "朔州市"),
    only=["CHI", "SHX", "PRC"], color="#9fd27a", **OCC)
add("mengjiang_1939", Y39, "MEN", "Mongol United Autonomous Government", "蒙古联盟自治政府",
    PF("呼和浩特市", "包头市", "乌兰察布市"), only=["CHI", "SHX", "MEN"], **OCC)
add("reformed_government", Y39, "RGC", "Reformed Government of the Republic of China", "中华民国维新政府",
    {"hierarchy_groups": ["CN_Shanghai", "CN_Jiangsu"],
     "prefectures": ["杭州市", "嘉兴市", "湖州市", "舟山市", "合肥市", "芜湖市", "蚌埠市", "淮南市", "马鞍山市",
                     "淮北市", "铜陵市", "安庆市", "滁州市", "宿州市", "亳州市", "阜阳市"]},
    only=["CHI"], color="#e3c15a", **OCC)
add("japanese_central_china", Y39, "JCC", "Japanese-Occupied Central China", "日军华中占领区",
    PF("武汉市", "孝感市", "鄂州市", "黄石市", "黄冈市", "咸宁市", "岳阳市", "九江市", "南昌市", "信阳市", "荆门市", "随州市"),
    only=["CHI"], color="#f2a98c", cores="keep", parent="JAP", kind="military_administration")
add("japanese_south_china", Y39, "JSC", "Japanese-Occupied South China", "日军华南占领区",
    {"hierarchy_groups": ["CN_Hainan"],
     "prefectures": ["广州市", "佛山市", "东莞市", "深圳市", "惠州市", "汕头市", "潮州市", "厦门市", "中山市", "江门市", "南宁市", "钦州市", "防城港市"]},
    only=["CHI"], color="#e8907a", cores="keep", parent="JAP", kind="military_administration")


def FI(*ids):
    return {"feature_ids": list(ids)}


def CN(numbers):
    return ["CN_CITY_17275852B" + n for n in numbers.split()]


def narrow(entry_id, selection, restore_tag, *, cores="owner", shanxi=False):
    entry = next(e for e in E if e["id"] == entry_id)
    returns = []
    if shanxi:
        returns.append({"id": entry_id + "_shanxi_return", "scenarios": entry["scenarios"],
                        "tag": "SHX", "select": HG("CN_Shanxi"), "exclude": selection,
                        "only_from_owners": [entry["tag"]], "cores": cores})
    returns.append({"id": entry_id + "_return", "scenarios": entry["scenarios"], "tag": restore_tag,
                    "select": entry["select"], "exclude": selection,
                    "only_from_owners": [entry["tag"]], "cores": cores})
    index = E.index(entry)
    E[index:index] = returns
    entry["select"] = selection
    entry["only_from_owners"] = list(dict.fromkeys(entry.get("only_from_owners", []) + [entry["tag"]]))


narrow("kwantung", FI("CN_CITY_17275852B83272093468807__SPLIT_KWANTUNG"), "MAN")
narrow("khotan_ma", {"prefectures": ["和田地区"], "feature_ids": CN("17844458275319")}, "SIK")
next(e for e in E if e["id"] == "khotan_ma").update(name_en="Khotan Military Administration", name_zh="和阗军政区")
next(e for e in E if e["id"] == "mordovian_assr")["name_zh"] = "莫尔多维亚自治共和国"
next(e for e in E if e["id"] == "mauritius")["select"] = CC("MU", "IO")
next(e for e in E if e["id"] == "bohemia_moravia")["exclude"]["feature_ids"].append("CZ_ADM2_57006924B3568693077695")
add("liberec_return", Y39, "GER", None, None, FI("CZ_ADM2_57006924B3568693077695"))
add("kosice_return", Y39, "HUN", None, None, FI(*["SK_ADM2_56367889B" + n for n in
    ("16879144707830", "46930466225258", "7741755639355", "57985107422825")]))
for scenarios, parent in [(Y36, "RAJ"), (Y39, "ENG")]:
    year = scenarios[0][-4:]
    if scenarios == Y36:
        add("aden_" + year, scenarios, "RAJ", None, None, FI("YEM-3510"))
    else:
        add("aden_" + year, scenarios, "ADN", "Aden Colony", "亚丁殖民地", FI("YEM-3510"), parent=parent, kind="colony")
    if scenarios == Y36:
        add("burma_direct_1936", scenarios, "RAJ", None, None, CC("MM"), only=["BRM"])
    else:
        add("burma_parent_1939", scenarios, "BRM", "British Burma", "英属缅甸", CC("MM"),
            parent="ENG", kind="colony", only=["BRM"], cores="keep")
add("karakalpak_parent_1939", Y39, "KKP", None, None, FI("UZB-356"), parent="UZB", cores="keep")
for tag, en, zh in [("KOM", "Komi", "科米"), ("MRE", "Mari", "马里"),
                     ("KBA", "Kabardino-Balkar", "卡巴尔达-巴尔卡尔"),
                     ("NOS", "North Ossetian", "北奥塞梯"), ("CHE", "Chechen-Ingush", "车臣-印古什")]:
    add(tag.lower() + "_autonomous_oblast_1936", Y36, tag, en + " Autonomous Oblast", zh + "自治州",
        {"owners": [tag]}, parent="SOV", kind="autonomous_oblast", cores="keep")
add("seychelles_return", B, "SEY", "Seychelles", "塞舌尔", CC("SC"), parent="ENG", kind="colony", color="#bd809b")
add("south_west_africa", B, "SWA", "South West Africa", "西南非洲", CC("NA"), parent="SAF", kind="mandate",
    color="#bd586b", notes="Modern Namibia proxy; Walvis Bay requires a later geometry split.")
for tag, en, zh, groups, kind, color in [
    ("PAP", "Territory of Papua", "巴布亚领地", ("Gulf", "Southern_Highlands", "Western", "Central", "Milne_Bay", "Port_Moresby", "Oro"), "territory", "#b45073"),
    ("NGN", "Territory of New Guinea", "新几内亚委任统治地", ("Enga", "East_Sepik", "Madang", "Sandaun", "Chimbu", "Eastern_Highlands", "of_Bougainville", "Western_Highlands", "East_New_Britain", "Manus", "Morobe", "New_Ireland", "West_New_Britain"), "mandate", "#e5a6b9")]:
    add(tag.lower() + "_territory", B, tag, en, zh, HG(*("PG_" + g for g in groups)), parent="AST", kind=kind,
        color=color, notes="Modern province proxies; highland boundaries require later geometry splits.")
for tag, en, zh, groups, color in [
    ("SUM", "Sumatra Debug Region", "苏门答腊调试大区", ("Aceh", "North_Sumatra", "West_Sumatra", "Riau", "Riau_Islands", "Jambi", "Bengkulu", "South_Sumatra", "Bangka_Belitung_Islands", "Lampung"), "#b86d4c"),
    ("BOR", "Dutch Borneo Debug Region", "荷属婆罗洲调试大区", ("West_Kalimantan", "Central_Kalimantan", "South_Kalimantan", "East_Kalimantan", "North_Kalimantan"), "#cb8e6b"),
    ("CEL", "Celebes Debug Region", "西里伯斯调试大区", ("North_Sulawesi", "Gorontalo", "Central_Sulawesi", "West_Sulawesi", "South_Sulawesi", "Southeast_Sulawesi"), "#994d47"),
    ("LSI", "Lesser Sunda Debug Region", "小巽他调试大区", ("Bali", "West_Nusa_Tenggara", "East_Nusa_Tenggara"), "#d49b8a"),
    ("MLK", "Moluccas Debug Region", "马鲁古调试大区", ("Maluku", "North_Maluku"), "#a15555"),
    ("WNG", "Dutch New Guinea Debug Region", "荷属新几内亚调试大区", ("Papua", "West_Papua"), "#c27a64")]:
    add(tag.lower() + "_region", B, tag, en, zh, HG(*("ID_" + g for g in groups)), parent="INS",
        kind="administrative_region", color=color, cores=["INS"])
for tag, en, zh, cc, color in [("ERI", "Eritrea Governorate", "厄立特里亚总督区", "ER", "#6eaa83"),
                               ("SOM", "Somalia Governorate", "索马里总督区", "SO", "#9dbb87")]:
    add(tag.lower() + "_governorate_1939", Y39, tag, en, zh, CC(cc), parent="AOI", kind="administrative_region",
        only=["AOI", tag], color=color, cores=["AOI"], notes="Modern-country regional proxy, not the precise historical governorate boundary.")

next(e for e in E if e["id"] == "south_chahar").update(name_en="South Chahar Administration", name_zh="察南政厅")
next(e for e in E if e["id"] == "north_shanxi").update(name_en="North Shanxi Administration", name_zh="晋北政厅")
men = next(e for e in E if e["id"] == "mengjiang_1939")
men.update(name_en="Mongolian United Autonomous Government", name_zh="蒙古联合自治政府",
           notes="China uses late-1939 occupation; CNZ and JBZ remain subordinate debug administrations after the September merger.")
men["only_from_owners"] += ["MAN", "CNZ"]
next(e for e in E if e["id"] == "provisional_government")["only_from_owners"] += ["LUQ", "RGC", "MAN"]
next(e for e in E if e["id"] == "japanese_south_china")["only_from_owners"] += ["GXC"]

add("qinglong_return", Y36, "MAN", None, None, FI(*CN("43165756519885")))
add("east_hebei_counties_1936", Y36, "EHC", None, None,
    FI(*CN("72792517073116 24643771294108 7080321063595 95574356023337 72922623961147 75890737929332 60414806889849 38375506939997")))
add("hainan_qinlian_return_1936", Y36, "YUE", None, None,
    {"hierarchy_groups": ["CN_Hainan"], "feature_ids": CN("19868960828514 30975390905787 50490784073671 71635948673445") + ["CN_MRG_54a435d63591"]})
add("suiyuan_return_1936", Y36, "SHX", None, None, FI(*CN("56850756381420 4230864536687")))
HEXI = {"prefectures": ["武威市", "金昌市", "张掖市", "酒泉市"], "feature_ids": CN("58588105655352")}
add("gansu_return_1936", Y36, "CHI", None, None, HG("CN_Gansu"), only=["GMA"], exclude=HEXI, cores=["CHI"])
add("hexi_ma_1936", Y36, "GMA", "Hexi Ma Clique", "河西马家军", HEXI)
add("southern_ningxia_return_1936", Y36, "CHI", None, None, {"prefectures": ["固原市"], "feature_ids": CN("3472329779353")}, cores=["CHI"])
add("yanan_return_1936", Y36, "CHI", None, None, FI(*CN("97849821920285")), cores=["CHI"])
add("northern_shaanxi_return_1936", Y36, "CHI", None, None, FI(*CN("71560826208449 92543718728466")), cores=["CHI"])
add("huachi_soviet_1936", Y36, "PRC", None, None, FI(*CN("7825306449652")))
add("wayaobao_soviet_1936", Y36, "PRC", None, None, FI(*CN("74624363636090")))
add("yaan_return_1936", Y36, "CHU", None, None, PF("雅安市"), only=["SIC"], cores=["CHU"])
add("mingshan_return_1939", Y39, "CHI", None, None, FI(*CN("99222209572409")), cores=["CHI"])
add("xikang_ning_1939", Y39, "SIC", None, None, FI(*CN("18343080596072 78456779133513 90257281612339 77966044233531 22487922789088")))
add("red_fourth_army_1936", Y36, "PRC", None, None, FI(*CN("67382669517001 17632126042959 26108585816208")))
add("mongol_banners_1936", Y36, "MEN", "Chahar Mongol Banner Administrations", "察哈尔蒙古旗政区", {"owners": ["MEN"]}, cores="keep")
for tag, en, zh, color, nums, parent in [
    ("DMC", "Mongol Local Autonomy Political Council", "蒙古地方自治政务委员会", "#8fa96a", "79222988236433", "CHI"),
    ("CDE", "East Chahar Garrison", "察东警备区（李守信）", "#a7bd79", "97242903030707 76051276542746 39600332445203 74586174185496", "JAP"),
    ("NEA", "Northeastern Army in Shaanxi-Gansu", "东北军陕甘驻防区", "#637caf", "58292310857107 99561505558549 62674804488136", "CHI"),
    ("GSG", "Gansu Provincial Government", "甘肃省政府（于学忠）", "#596aa1", "84192730453130 75830625621181", "CHI"),
    ("CDX", "Deng Xihou Clique", "川军邓锡侯部", "#2a8299", "39008212883754 55258020624391 91329777295844", "CHI"),
    ("CSZ", "Sun Zhen Clique", "川军孙震部", "#3c7791", "38426922086125 9326266766926 30341791442731 91773014733924", "CHI"),
    ("CYS", "Yang Sen Clique", "川军杨森部", "#527f89", "34390587465306 8936190947302 73469440437176 92501194129581 5895567339665", "CHI")]:
    add(tag.lower() + "_debug_1936", Y36, tag, en, zh, FI(*CN(nums)), parent=parent,
        kind="military_administration", color=color, cores="keep",
        notes="Whole-parcel faction proxy based on T5 and HGO political divisions, not exclusive historical county control.")
add("northwestern_army_1936", Y36, "NWA", "Northwestern Army Administration", "西北军（杨虎城）",
    PF("西安市", "咸阳市", "渭南市", "汉中市"), parent="CHI", kind="military_administration", color="#435ba0",
    only=["CHI", "NWA"], cores="keep", notes="Guanzhong-Hanzhong faction proxy; overlapping garrisons are not separate sovereign territories.")
for tag, en, zh, color, fids in [
    ("JCJ", "Jin-Cha-Ji Border Region", "晋察冀边区", "#9f2836",
     CN("46736465172107 69993211466305 48796108703718 59002516276853 8665149309175")
     + ["CN_MRG_51650d15c050", "CN_MRG_9b9b2d2aa43a"]),
    ("THG", "Taihang Resistance Area", "太行抗日根据地", "#b32032",
     ["CN_MRG_093183003948", "CN_MRG_27a184e8ab38"] + CN("61726350757100"))]:
    add(tag.lower() + "_debug_1939", Y39, tag, en, zh, FI(*fids), parent="PRC", kind="military_administration",
        color=color, cores="keep", notes="Whole-parcel resistance-area debug proxy; county seats and rural control were mixed.")

# ---------- 同色系配色 ----------
# Subjects keep their parent's hue (±5° in OKLCH) and vary lightness/chroma; colours are picked
# greedily from a low-discrepancy pool so siblings and the parent stay perceptually apart.
def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _linear_to_srgb(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def hex_to_oklab(hex_color):
    r, g, b = (_srgb_to_linear(int(hex_color[k:k + 2], 16) / 255) for k in (1, 3, 5))
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def oklab_to_rgb(lab):
    L, a, b = lab
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return tuple(_linear_to_srgb(max(0.0, c)) if c >= 0 else -1.0 for c in (
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s))


def _halton(index, base):
    result, f = 0.0, 1.0
    while index:
        f /= base
        result += f * (index % base)
        index //= base
    return result


# Families whose subjects border each other on the map need a wider lightness range to stay
# distinguishable; the Japanese puppets tile occupied China, and JAP itself is very light.
WIDE_FAMILIES = {"JAP": dict(hue_span=10.0, lightness_width=0.45, max_distance=0.30)}


def family_palette(parent_hex, count, hue_span=5.0, lightness_width=0.16, max_distance=0.119):
    L0, a0, b0 = hex_to_oklab(parent_hex)
    C0, h0 = math.hypot(a0, b0), math.degrees(math.atan2(b0, a0))
    # A lightness window around the parent, shifted inward at the 0.30/0.90 limits,
    # so very light (JAP) or dark (SOV) parents still give their subjects enough range.
    lo = min(max(0.30, L0 - lightness_width / 2), 0.90 - lightness_width)
    hi = lo + lightness_width
    pool = []
    for i in range(1, 900):
        L = lo + (hi - lo) * _halton(i, 2)
        # Near-grey parents (GER) keep greyscale subjects: their hue angle is meaningless.
        C = C0 * (0.85 + 0.20 * _halton(i, 3))
        h = math.radians(h0 + hue_span * (2 * _halton(i, 5) - 1))
        while True:  # pull chroma back into the sRGB gamut
            lab = (L, C * math.cos(h), C * math.sin(h))
            rgb = oklab_to_rgb(lab)
            if all(0 <= c <= 1 for c in rgb) or C <= 0.01:
                break
            C *= 0.92
        if all(0 <= c <= 1 for c in rgb):
            if math.dist(lab, (L0, a0, b0)) <= max_distance:
                pool.append(lab)
    chosen, anchors = [], [(L0, a0, b0)]
    for _ in range(count):
        best = max(pool, key=lambda p: min(math.dist(p, q) for q in anchors))
        chosen.append(best)
        anchors.append(best)
        pool.remove(best)
    return ["#%02x%02x%02x" % tuple(round(min(1, max(0, c)) * 255) for c in oklab_to_rgb(lab)) for lab in chosen]


def harmonize_family_colors(entries):
    colors_by_scenario = {}
    for scenario, countries in (("hoi4_1936", C36), ("hoi4_1939", C39)):
        parent_of = {tag: country["parent_owner_tag"] for tag, country in countries.items()
                     if country.get("parent_owner_tag")}
        applicable = [e for e in entries if scenario in e["scenarios"]]
        for e in applicable:
            if e.get("parent_owner_tag"):
                parent_of[e["tag"]] = e["parent_owner_tag"]
        colour = {tag: country["color_hex"] for tag, country in countries.items()}
        for e in applicable:
            if e.get("color_hex") and e["tag"] not in parent_of:
                colour[e["tag"]] = e["color_hex"]
        families = {}
        for child, parent in sorted(parent_of.items()):
            families.setdefault(parent, []).append(child)

        def depth(tag, seen=()):
            return 0 if tag not in parent_of or tag in seen else 1 + depth(parent_of[tag], seen + (tag,))

        for parent in sorted(families, key=lambda t: (depth(t), t)):
            children = families[parent]
            palette = family_palette(colour[parent], len(children), **WIDE_FAMILIES.get(parent, {}))
            for child, hex_color in zip(children, palette):
                colour[child] = hex_color
        colors_by_scenario[scenario] = {tag: colour[tag] for tag in parent_of}
        entry_tags = {e["tag"] for e in applicable}
        for tag in sorted(set(parent_of) - entry_tags):
            entries.append({"id": f"{tag.lower()}_family_colour_{scenario}", "scenarios": [scenario], "tag": tag,
                            "select": {"owners": [tag]}, "only_from_owners": [tag]})
    colored_entries = []
    for e in entries:
        colors = {scenario: colors_by_scenario[scenario].get(e["tag"], e.get("color_hex"))
                  for scenario in e["scenarios"]}
        if len(set(colors.values())) == 1:
            if next(iter(colors.values())):
                e["color_hex"] = next(iter(colors.values()))
            colored_entries.append(e)
        else:
            for scenario, color in colors.items():
                colored_entries.append({**e, "id": f"{e['id']}_{scenario}", "scenarios": [scenario], "color_hex": color})
    entries[:] = colored_entries


geometry_rules = json.loads((W / "data/scenario-rules/hoi4_geometry_splits.json").read_text(encoding="utf-8"))
geometry_by_id = {entry["id"]: entry for entry in geometry_rules["entries"]}

def split_ids(name, side="inside"):
    rule = geometry_by_id[name]
    return [fid + "__SPLIT_" + rule[side]["suffix"] for fid in rule["feature_ids"]]

next(e for e in E if e["id"] == "danzig")["select"]["feature_ids"].extend(split_ids("danzig"))
next(e for e in E if e["id"] == "danzig")["notes"] = geometry_by_id["danzig"]["notes"]
next(e for e in E if e["id"] == "kwantung")["notes"] = geometry_by_id["kwantung"]["notes"]
next(e for e in E if e["id"] == "karafuto_kurils")["exclude"] = FI(*split_ids("karafuto", "outside"))
add("karafuto_south", B, "JAP", None, None, FI(*split_ids("karafuto")))
add("sakhalin_north", B, "SOV", None, None, FI(*split_ids("karafuto", "outside")))
add("tangier_international_zone", B, "TGR", "Tangier International Zone", "坦吉尔国际区",
    FI(*split_ids("tangier")), kind="international_zone", color="#c9b67d", notes=geometry_by_id["tangier"]["notes"])
add("ifni", B, "IFN", "Spanish Ifni", "西属伊夫尼", FI(*split_ids("ifni")),
    parent="SPR", kind="colony", notes=geometry_by_id["ifni"]["notes"])
add("guangzhouwan", B, "KWW", "Guangzhouwan Leased Territory", "广州湾租借地", FI(*split_ids("guangzhouwan")),
    parent="FRA", kind="colony", notes=geometry_by_id["guangzhouwan"]["notes"])


def IN(*numbers):
    return ["IN_ADM2_76128533B" + number for number in numbers]


add("hyderabad", B, "HYD", "Hyderabad", "海得拉巴",
    {"hierarchy_groups": ["IN_Telangana"], "feature_ids": IN("39329594544563", "63783580004876", "1083016608278", "9794868259401") + ["IN_MRG_ffed35f9503d"]},
    parent="RAJ", kind="princely_state", only=["RAJ"], exclude=FI(*split_ids("bhadrachalam")))
add("kashmir", B, "KAS", "Jammu and Kashmir", "查谟和克什米尔",
    {"hierarchy_groups": ["IN_Jammu_and_Kashmir", "IN_Ladakh"], "feature_ids": ["PAK-1109"]},
    parent="RAJ", kind="princely_state", only=["RAJ"], exclude=FI(*IN("2782141712775")))
add("mysore", B, "MYS", "Mysore", "迈索尔",
    FI(*IN("15550697205080", "85389886560116", "95879808095476", "76927648517269", "49597693387243"), "IN_MRG_c2a8b7b28b23"),
    parent="RAJ", kind="princely_state", only=["RAJ"])
add("travancore", B, "TVC", "Travancore", "特拉凡哥尔",
    FI(*IN("33162455176756", "53796141759805"), "IN_MRG_a3f42a5bb822", *IN("75519739609062")),
    parent="RAJ", kind="princely_state", only=["RAJ"])
add("rajputana_states", B, "IRA", "Rajputana States", "拉杰普塔纳诸邦", HG("IN_Rajasthan"),
    parent="RAJ", kind="princely_state", only=["RAJ"], exclude=FI(*IN("60180372390230")))
for tag, en, zh, numbers, merged in [
    ("BDA", "Baroda", "巴罗达", ["33151011563565"], []),
    ("GWA", "Gwalior", "瓜廖尔", ["90551733723251", "89286042589317"], ["ad1b1cb9dc7d"]),
    ("INR", "Indore", "印多尔", ["60360721573267"], []),
    ("BPL", "Bhopal", "博帕尔", ["22439249004073"], []),
    ("ICA", "Central India States", "中央印度诸邦", ["38767180038480", "50014751336341"], ["f73955d59e52", "f050f1c4b3c9", "8c423602963b", "cf5f1caa9d83", "90a8716fe1b8"]),
    ("KUT", "Cutch", "卡奇", ["91881382098572"], []),
    ("IWA", "Western India States", "西印度诸邦", ["35205406647638", "74381554567803", "93450974047240", "74992405432705"], ["dfe0e83efbc8"]),
    ("KHP", "Kolhapur", "戈尔哈布尔", ["66719908763317"], []),
    ("IPA", "Punjab States", "旁遮普诸邦", ["39368211148513"], ["862fe17f65b9"]),
    ("IHA", "Punjab Hill States", "旁遮普山邦", ["58537895532859", "11802210119774", "50011981829203", "77537928419507"], []),
    ("IEA", "Eastern States", "东部诸邦", ["6128685860104"], ["d5c4dbfe1bc8", "87a650d2ea07", "5a8caf67d623"]),
    ("RMP", "Rampur", "兰普尔", ["46682008877369"], []),
    ("CHB", "Cooch Behar", "科奇比哈尔", ["64156747739715"], []),
    ("IKA", "Khasi States", "卡西诸邦", ["27102120636500"], []),
]:
    add(tag.lower() + "_states", B, tag, en, zh,
        FI(*IN(*numbers), *("IN_MRG_" + suffix for suffix in merged)),
        parent="RAJ", kind="princely_state", only=["RAJ"])
for tag, en, zh, group in [("TPA", "Tripura", "特里普拉", "IN_Tripura"),
                            ("MNP", "Manipur", "曼尼普尔", "IN_Manipur")]:
    add(tag.lower() + "_state", B, tag, en, zh, HG(group), parent="RAJ", kind="princely_state", only=["RAJ"])
add("bhutan_protectorate", B, "BHU", None, None, CC("BT"), parent="RAJ", kind="protectorate", cores="keep")
add("french_india", B, "FND", "French India", "法属印度",
    FI(*IN("29873478326363", "62624361588317", "41246169049488", "83105693975079")), parent="FRA", kind="colony", only=["RAJ"])
for name, tag, en, zh in [
    ("hassan", "MYS", "Mysore", "迈索尔"),
    ("jalna", "HYD", "Hyderabad", "海得拉巴"),
    ("parbhani", "HYD", "Hyderabad", "海得拉巴"),
    ("raichur", "HYD", "Hyderabad", "海得拉巴"),
    ("cochin", "COC", "Cochin", "科钦"),
    ("bahawalpur", "BHW", "Bahawalpur", "巴哈瓦尔布尔"),
    ("khairpur", "KPU", "Khairpur", "海尔布尔"),
    ("baluchistan_states", "KLA", "Kalat and Baluchistan States", "卡拉特与俾路支诸邦"),
    ("frontier_states", "IFA", "North-West Frontier States", "西北边疆诸邦"),
    ("deccan_states", "IDA", "Deccan States", "德干诸邦"),
    ("mandi", "IHA", "Punjab Hill States", "旁遮普山邦"),
    ("odisha_states", "IEA", "Eastern States", "东部诸邦"),
]:
    add(name + "_split", B, tag, en, zh, FI(*split_ids(name)), parent="RAJ", kind="princely_state", only=["RAJ"])
for scenarios, parent in [(Y36, "RAJ"), (Y39, "BRM")]:
    for tag, en, zh, fid in [("SHA", "Federated Shan States", "掸邦联邦", "MMR-3277"),
                              ("KRN", "Karenni States", "克伦尼诸邦", "MMR-2473")]:
        add(tag.lower() + "_" + scenarios[0], scenarios, tag, en, zh, FI(fid),
            parent=parent, kind="protectorate", only=[parent])
add("malaya_federated_states", B, "MAL", "Federated Malay States", "马来联邦",
    FI("MYS-1137", "MYS-1146", "MYS-1147", "MYS-1148", "MYS-4831", "MYS-4832"),
    parent="ENG", kind="protectorate", cores="keep")
for tag, en, zh, fid in [
    ("JOH", "Sultanate of Johor", "柔佛苏丹国", "MYS-1143"),
    ("KED", "Sultanate of Kedah", "吉打苏丹国", "MYS-1140"),
    ("PLS", "Perlis", "玻璃市", "MYS-1141"),
    ("KEL", "Sultanate of Kelantan", "吉兰丹苏丹国", "MYS-1144"),
    ("TGA", "Sultanate of Terengganu", "登嘉楼苏丹国", "MYS-1149"),
]:
    add(tag.lower() + "_protectorate", B, tag, en, zh, FI(fid), parent="ENG", kind="protectorate", only=["MAL"], cores="keep")
add("yogyakarta", B, "YOG", "Sultanate of Yogyakarta", "日惹苏丹国", HG("ID_Special_Region_of_Yogyakarta"),
    parent="HOL", kind="princely_state", only=["INS"], cores="keep")
add("olongapo_reservation", B, "USA", None, None, FI("PHL-5540"), only=["PHI"], cores="keep")
add("thailand_name_1939", Y39, "SIA", "Kingdom of Thailand", "泰王国", CC("TH"), cores="keep")
# 1936 Burma is ruled directly by RAJ; drop the retired BRM so the palette pass adds no colour-only entry for it.
C36.pop("BRM", None)
C36.pop("ADN", None)

for tag, en, zh, fid in [
    ("ABD", "Sheikhdom of Abu Dhabi", "阿布扎比酋长国", "ARE-349"),
    ("DUB", "Sheikhdom of Dubai", "迪拜酋长国", "ARE-350"),
    ("SHJ", "Sheikhdom of Sharjah", "沙迦酋长国", "ARE-348"),
    ("RAK", "Sheikhdom of Ras al-Khaimah", "拉斯海马酋长国", "ARE-338"),
    ("AJM", "Sheikhdom of Ajman", "阿治曼酋长国", "ARE-346"),
    ("UAQ", "Sheikhdom of Umm al-Quwain", "乌姆盖万酋长国", "ARE-339"),
]:
    add(tag.lower() + "_sheikhdom", B, tag, en, zh, FI(fid), parent="ENG", kind="protectorate", only=["TRU", "ENG"])
add("fujairah", B, "FUJ", "Sheikhdom of Fujairah", "富查伊拉酋长国", FI("ARE-341"),
    color=shade("ENG"), only=["TRU", "ENG"])
add("muscat_name", B, "OMA", "Sultanate of Muscat and Oman", "马斯喀特与阿曼苏丹国", CC("OM"), only=["OMA"], cores="keep")
add("oman_imamate", B, "IMO", "Imamate of Oman", "阿曼伊玛目国", FI("OMN-2404", "OMN-2414"),
    parent="OMA", kind="autonomous_region", only=["OMA"])
add("alawite_government", B, "ALW", "Autonomous Government of Latakia", "拉塔基亚自治政府",
    FI("SYR-134", "SYR-135"), parent="FRA", kind="autonomous_region", only=["SYR"])
add("jabal_druze", B, "JEB", "Autonomous Government of Jabal Druze", "德鲁兹山自治政府",
    FI("SYR-143"), parent="FRA", kind="autonomous_region", only=["SYR"])
add("alexandretta_1936", Y36, "HTY", "Alexandretta Autonomous Sanjak Debug Region", "亚历山大勒塔自治专区调试分区",
    FI("TR631"), parent="FRA", kind="autonomous_region", only=["SYR"])
add("jazira_administration_1939", Y39, "JAZ", "Upper Jazira Administration", "上杰济拉行政区",
    FI("SYR-141"), parent="FRA", kind="administrative_region", only=["SYR"])
add("transjordan_mandate", B, "JOR", "Emirate of Transjordan", "外约旦酋长国", CC("JO"),
    parent="ENG", kind="mandate", only=["JOR"], cores="keep")
add("aden_western_states", B, "WDN", "Western Aden Protectorate Debug Region", "西亚丁保护地调试分区",
    FI("YEM-157", "YEM-3511", "YEM-336"), parent="ENG", kind="protectorate", only=["YEM"])
add("aden_eastern_states", B, "EDN", "Eastern Aden Protectorate Debug Region", "东亚丁保护地调试分区",
    FI("YEM-3497", "YEM-332"), parent="ENG", kind="protectorate", only=["YEM"])

add("sichuan_faction_metadata_1936", Y36, "CHU", "Sichuan Administration - Liu Xiang Faction", "四川军政区（刘湘系）",
    {"owners": ["CHU"]}, parent="CHI", kind="military_administration", cores="keep")
for scenarios, en, zh in [(Y36, "Xikang Provincial Preparatory Committee", "西康建省委员会"),
                           (Y39, "Xikang Provincial Government", "西康省政府")]:
    add("xikang_metadata_" + scenarios[0], scenarios, "SIC", en, zh, {"owners": ["SIC"]},
        parent="CHI", kind="military_administration", cores="keep")
add("yunnan_metadata", B, "YUN", "Yunnan Provincial Government - Long Yun", "云南省政府（龙云）",
    {"owners": ["YUN"]}, parent="CHI", kind="military_administration", cores="keep")
for scenarios, parent, owners in [(Y36, "CHU", ["CHU"]), (Y39, "SIC", ["CHI", "SIC"])]:
    add("liangshan_clans_" + scenarios[0], scenarios, "LOL", "Liangshan Yi Clan Debug Region", "凉山彝族家支调试分区",
        FI(*CN("23024603415445 52132557540167 17138311811008")), parent=parent,
        kind="autonomous_region", only=owners, cores="keep")
    add("muli_chiefdom_" + scenarios[0], scenarios, "MUL", "Muli Chiefdom", "木里土司",
        FI(*CN("80219081988604")), parent=parent, kind="tusi", only=["SIC"], cores="keep")
add("gyalrong_four_1939", Y39, "JRG", "Gyalrong Four Chiefdoms Debug Region", "嘉绒四土调试分区",
    FI(*CN("24790182027849")), parent="CHI", kind="tusi", only=["CHI"], cores="keep")

DZ_SOUTH = FI(*["DZA-" + number for number in
    "2143 2148 2149 2150 2188 2189 2190 2191 2192 2193 2194 2211 2212".split()])
add("algeria_northern_departments", B, "FRA", None, None, CC("DZ"), exclude=DZ_SOUTH, only=["ALG"])
add("algeria_southern_territories", B, "ALG", "Southern Territories of Algeria", "阿尔及利亚南部领地",
    DZ_SOUTH, parent="FRA", kind="military_administration", only=["ALG"], cores="keep")
add("libyan_coastal_provinces_1939", Y39, "ITA", None, None,
    {"country_codes": ["LY"], "bbox": [-180, 29, 180, 90]}, only=["LBA"])
add("karafuto_administration", B, "KRF", "Karafuto Prefecture", "桦太厅",
    {"country_codes": ["RU"], "bbox": [140, 45, 145, 50]}, parent="JAP", kind="colony", only=["JAP"])
add("saint_helena_colony", B, "STH", "Saint Helena Colony", "圣赫勒拿殖民地", CC("SH"), parent="ENG", kind="colony", only=["ENG"])
add("saint_pierre_miquelon", B, "SPM", "Saint Pierre and Miquelon", "圣皮埃尔和密克隆", CC("PM"), parent="FRA", kind="colony", only=["FRA"])
add("mayotte_madagascar_dependency", B, "MAD", None, None, CC("YT"), only=["YT"])
add("puerto_rico_territory_metadata", B, "PUE", None, None, CC("PR"), parent="USA", kind="territory", only=["PUE"], cores="keep")
add("guangzhouwan_indochina_parent", B, "KWW", None, None, {"owners": ["KWW"]}, parent="VIN", kind="colony", cores="keep")

NG_NORTH = HG("NG_Borno_State", "NG_Benue_State", "NG_Taraba_State", "NG_Kwara_State", "NG_Niger_State",
              "NG_Bauchi_State", "NG_Gombe_State", "NG_Kaduna_State", "NG_Kogi_State", "NG_Plateau_State",
              "NG_Nasarawa_State", "NG_Jigawa_State", "NG_Kano_State", "NG_Katsina_State", "NG_Sokoto_State",
              "NG_Zamfara_State", "NG_Yobe_State", "NG_Kebbi_State", "NG_Adamawa_State", "NG_Federal_Capital_Territory")
NG_EAST = HG("NG_Abia_State", "NG_Akwa_Ibom_State", "NG_Imo_State", "NG_Rivers_State", "NG_Bayelsa_State",
             "NG_Cross_River_State", "NG_Anambra_State", "NG_Enugu_State", "NG_Ebonyi_State")
NG_WEST = HG("NG_Ogun_State", "NG_Ondo_State", "NG_Ekiti_State", "NG_Osun_State", "NG_Oyo_State", "NG_Delta_State", "NG_Edo_State")
NCM_IDS = [fid + "__SPLIT_NCM" for fid in geometry_by_id["northern_cameroons"]["feature_ids"]]
WTO_IDS = [fid + "__SPLIT_WTO" for fid in geometry_by_id["british_togoland"]["feature_ids"]]
add("nigeria_northern_provinces", B, "NNI", "Northern Provinces of Nigeria", "尼日利亚北部省区", NG_NORTH,
    parent="BWA", kind="administrative_region", only=["BWA"], exclude=FI(*NCM_IDS), cores="keep")
for scenarios, tag, en, zh, selector in [
    (Y36, "SNI", "Southern Provinces of Nigeria", "尼日利亚南部省区", HG(*NG_EAST["hierarchy_groups"], *NG_WEST["hierarchy_groups"])),
    (Y39, "NWI", "Western Provinces of Nigeria", "尼日利亚西部省区", NG_WEST),
    (Y39, "NEI", "Eastern Provinces of Nigeria", "尼日利亚东部省区", NG_EAST),
]:
    add(tag.lower() + "_provinces", scenarios, tag, en, zh, selector,
        parent="BWA", kind="administrative_region", only=["BWA"], cores="keep")
add("northern_cameroons", B, "NCM", "British Northern Cameroons", "英属北喀麦隆", FI(*NCM_IDS),
    parent="BWA", kind="mandate", only=["BWA"], cores="keep")
add("southern_cameroons", B, "SCM", "British Southern Cameroons", "英属南喀麦隆", HG("CM_Northwest", "CM_Southwest"),
    parent="BWA", kind="mandate", only=["BWA"], cores="keep")
add("ashanti", B, "AHI", "Ashanti Colony", "阿散蒂殖民地", HG("GH_Ashanti", "GH_Brong_Ahafo"),
    parent="ENG", kind="colony", only=["GLD"], cores="keep")
add("gold_coast_northern_territories", B, "GNH", "Northern Territories of the Gold Coast", "黄金海岸北领地",
    HG("GH_Northern", "GH_Upper_East", "GH_Upper_West"), parent="ENG", kind="protectorate", only=["GLD"], exclude=FI(*WTO_IDS), cores="keep")
add("british_togoland", B, "WTO", "British Togoland", "英属多哥兰", FI(*WTO_IDS), parent="ENG", kind="mandate", only=["GLD"], cores="keep")
add("sierra_leone_protectorate", B, "HSL", "Sierra Leone Protectorate", "塞拉利昂保护地", HG("SL_Southern", "SL_Northern", "SL_Eastern"),
    parent="ENG", kind="protectorate", only=["SIE"], cores="keep")
add("gambia_protectorate", B, "GMP", "Gambia Protectorate", "冈比亚保护地", CC("GM"),
    parent="ENG", kind="protectorate", only=["GAM"], exclude=HG("GM_Banjul"), cores="keep")
for tag, en, zh in [("GLD", "Gold Coast Colony", "黄金海岸殖民地"),
                    ("SIE", "Sierra Leone Colony", "塞拉利昂殖民地"), ("GAM", "Gambia Colony", "冈比亚殖民地")]:
    add(tag.lower() + "_colony_metadata", B, tag, en, zh, {"owners": [tag]}, cores="keep")
add("aef_colony_1936", Y36, "AEF", None, None, {"owners": ["AEF"]}, kind="colony", cores="keep")
for tag, en, zh, selector, excluded in [
    ("GAB", "Territory of Gabon", "加蓬领地", CC("GA"), HG("GA_Haut_Ogoou")),
    ("CAR", "Territory of Ubangi-Shari", "乌班吉沙立领地", CC("CF"), HG("CF_Mamb_r_Kad", "CF_Sangha_Mba_r")),
    ("CHA", "Territory of Chad", "乍得领地", CC("TD"), None),
]:
    add(tag.lower() + "_territory_1939", Y39, tag, en, zh, selector,
        parent="AEF", kind="territory", only=["AEF"], exclude=excluded, cores="keep")
for tag, en, zh, groups in [
    ("CQT", "Coquilhatville Province", "科基亚维尔省", ["CD_quateur"]),
    ("STN", "Stanleyville Province", "斯坦利维尔省", ["CD_Orientale"]),
    ("KIV", "Costermansville Province", "科斯特曼斯维尔省", ["CD_North_Kivu", "CD_South_Kivu", "CD_Maniema"]),
    ("KTG", "Élisabethville Province", "伊丽莎白维尔省", ["CD_Katanga"]),
    ("LSP", "Lusambo Province", "卢桑博省", ["CD_Kasa_Occidental", "CD_Kasa_Oriental"]),
]:
    add(tag.lower() + "_province", B, tag, en, zh, HG(*groups), parent="RCG", kind="administrative_region", only=["RCG"], cores="keep")
add("cabinda_district", B, "CAB", "Portuguese Cabinda District", "葡属卡宾达区", HG("AO_Cabinda"),
    parent="ANG", kind="administrative_region", only=["ANG"], cores="keep")
for tag, en, zh, groups in [
    ("AMH", "Amhara Governorate", "阿姆哈拉总督区", ["ET_Amhara", "ET_Tigray", "ET_Benishangul_Gumuz"]),
    ("GSD", "Galla-Sidamo Governorate", "加拉-西达莫总督区", ["ET_Southern_Nations", "ET_Gambela", "ET_Oromia"]),
    ("HRR", "Harar Governorate", "哈勒尔总督区", ["ET_Afar", "ET_Somali", "ET_Dire_Dawa", "ET_Harari"]),
]:
    add(tag.lower() + "_governorate_1939", Y39, tag, en, zh, HG(*groups),
        parent="AOI", kind="administrative_region", only=["AOI"], cores="keep")
add("egypt_sovereign_ally", B, "EGY", None, None, {"owners": ["EGY"]}, kind="sovereign_ally", cores="keep")
for tag, en, zh in [("SHM", "Saguia el-Hamra", "萨基亚哈姆拉"), ("RDO", "Rio de Oro", "里奥德奥罗")]:
    add(tag.lower() + "_colony", B, tag, en, zh, FI("EH_ADMIN0_PASSTHROUGH__SPLIT_" + tag),
        parent="SPR", kind="colony", only=["SSH"], cores="keep")

harmonize_family_colors(E)
E.append({"id": "china_enclaves_1939", "scenarios": Y39,
          "smooth_enclaves": {"tags": ["CHI", "SHX", "PRC", "NCP", "CNZ", "JBZ", "MEN", "RGC", "JCC", "JSC", "JCJ", "THG"],
                              "max_area_km2": 3000}})

ids = [e["id"] for e in E]
assert len(ids) == len(set(ids)), "duplicate ids"
out = {"version": 1,
       "description": ("Post-build ownership overlay for HOI4 1936/1939, applied after the political feature merges. "
                       "Debug-oriented split; approximations are noted per entry."),
       "entries": E}
p = W / "data/scenario-rules/hoi4_split_overlay.json"
p.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
print(len(E), "entries ->", p)
