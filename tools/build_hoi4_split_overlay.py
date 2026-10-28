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
    elif parent and tag not in C36 and tag not in C39:
        e["color_hex"] = shade(parent)
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
for id, tag, en, zh, groups in [("hyderabad", "HYD", "Hyderabad", "海得拉巴", ["IN_Telangana"]),
                                ("kashmir", "KSH", "Jammu and Kashmir", "查谟和克什米尔", ["IN_Jammu_and_Kashmir", "IN_Ladakh"]),
                                ("mysore", "MYR", "Mysore", "迈索尔", ["IN_Karnataka"]),
                                ("travancore", "TRV", "Travancore", "特拉凡哥尔", ["IN_Kerala"]),
                                ("sikkim", "SKM", "Sikkim", "锡金", ["IN_Sikkim"])]:
    add(id, B, tag, en, zh, HG(*groups), parent="RAJ", kind="protectorate", only=["RAJ"],
        notes="Princely state approximated by the modern state; not a historical boundary.")
add("straits_settlements", B, "STR", "Straits Settlements", "海峡殖民地",
    {"country_codes": ["SG"], "feature_ids": ["MYS-1139", "MYS-1145", "MYS-4833"]},
    parent="ENG", kind="colony", only=["MAL"])
add("sarawak", B, "SRW", "Sarawak", "沙捞越", {"feature_ids": ["MYS-1187"]}, parent="ENG", kind="protectorate", only=["MAL"])
add("north_borneo", B, "NBO", "North Borneo", "北婆罗洲", {"feature_ids": ["MYS-1186"]}, parent="ENG", kind="protectorate", only=["MAL"])
add("brunei", B, "BRU", "Brunei", "文莱", CC("BN"), parent="ENG", kind="protectorate", only=["MAL"])
for t in ["BOT", "KUW"]:
    add(f"{t.lower()}_parent", B, t, None, None, {"owners": [t]}, parent="ENG", kind="protectorate", only=[t])

# ---------- 法国 ----------
add("aof_senegal", B, "AOF", "Senegal", "塞内加尔", CC("SN"), only=["AOF"])
for id, tag, en, zh, cc, kind in [("mauritania", "MAU", "Mauritania", "毛里塔尼亚", "MR", "colony"),
                                  ("french_sudan", "FSU", "French Sudan", "法属苏丹", "ML", "colony"),
                                  ("french_guinea", "FGU", "French Guinea", "法属几内亚", "GN", "colony"),
                                  ("ivory_coast", "IVC", "Ivory Coast", "科特迪瓦", "CI", "colony"),
                                  ("dahomey", "DAH", "Dahomey", "达荷美", "BJ", "colony"),
                                  ("niger_colony", "NGR", "Niger", "尼日尔", "NE", "colony"),
                                  ("french_togo", "TOG", "French Togoland", "法属多哥", "TG", "mandate"),
                                  ("upper_volta", "UPV", "Upper Volta", "上沃尔特", "BF", "colony")]:
    add(id, B, tag, en, zh, CC(cc), parent="FRA", kind=kind, only=["AOF"])
add("aef_middle_congo", B, "AEF", "Middle Congo", "中央刚果", CC("CG"), only=["AEF"])
for id, tag, en, zh, cc in [("chad", "CHD", "Chad", "乍得", "TD"),
                            ("ubangi_shari", "UBA", "Ubangi-Shari", "乌班吉沙里", "CF"),
                            ("gabon", "GAB", "Gabon", "加蓬", "GA")]:
    add(id, B, tag, en, zh, CC(cc), parent="FRA", kind="colony", only=["AEF"])
add("french_cameroon", B, "FCM", "French Cameroun", "法属喀麦隆", CC("CM"), parent="FRA", kind="mandate",
    only=["AEF", "FRA", "AOF"], exclude=HG("CM_Northwest", "CM_Southwest"))
add("djibouti", B, "DJI", "French Somaliland", "法属索马里", CC("DJ"), parent="FRA", kind="colony", only=["FRA"])
add("madagascar_dependencies", B, "MAD", None, None, CC("KM", "TF"), only=["FRA"])
for t in ["GF", "GP", "MQ", "RE", "YT"]:
    add(f"{t.lower()}_parent", B, t, None, None, {"owners": [t]}, parent="FRA", kind="colony", only=[t])
add("tonkin", B, "TNK", "Tonkin", "东京（北圻）", {"country_codes": ["VN"], "bbox": [100, 19.75, 110, 24]},
    parent="FRA", kind="protectorate", only=["VIN"])
add("cochinchina", B, "COC", "Cochinchina", "交趾支那（南圻）", {"country_codes": ["VN"], "bbox": [100, 8, 110, 11.55]},
    parent="FRA", kind="colony", only=["VIN"])
add("cambodia", B, "CAM", "Cambodia", "柬埔寨", CC("KH"), parent="FRA", kind="protectorate", only=["VIN"])
add("laos", B, "LAO", "Laos", "老挝", CC("LA"), parent="FRA", kind="protectorate", only=["VIN"])
add("vin_annam", B, "VIN", "Annam", "安南（中圻）", {"owners": ["VIN"]}, only=["VIN"],
    notes="Remaining French Indochina core represented as Annam.")

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
                     "太原市", "阳泉市", "晋中市", "长治市", "晋城市", "运城市"]},
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
                     "淮北市", "铜陵市", "安庆市", "滁州市", "宿州市", "亳州市"]},
    only=["CHI"], color="#e3c15a", **OCC)
add("japanese_central_china", Y39, "JCC", "Japanese-Occupied Central China", "日军华中占领区",
    PF("武汉市", "孝感市", "鄂州市", "黄石市", "黄冈市", "咸宁市", "岳阳市", "九江市", "南昌市", "信阳市"),
    only=["CHI"], color="#f2a98c", cores="keep", parent="JAP", kind="military_administration")
add("japanese_south_china", Y39, "JSC", "Japanese-Occupied South China", "日军华南占领区",
    {"hierarchy_groups": ["CN_Hainan"],
     "prefectures": ["广州市", "佛山市", "东莞市", "深圳市", "惠州市", "汕头市", "潮州市", "厦门市"]},
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


narrow("kwantung", FI(*CN("83272093468807")), "MAN")
narrow("khotan_ma", {"prefectures": ["和田地区"], "feature_ids": CN("17844458275319")}, "SIK")
next(e for e in E if e["id"] == "khotan_ma").update(name_en="Khotan Military Administration", name_zh="和阗军政区")
next(e for e in E if e["id"] == "mordovian_assr")["name_zh"] = "莫尔多维亚自治共和国"
next(e for e in E if e["id"] == "mauritius")["select"] = CC("MU", "IO")
next(e for e in E if e["id"] == "upper_volta").update(
    name_en="Upper Volta Debug Region", name_zh="上沃尔特地区（调试分区）", subject_kind="administrative_region",
    notes="Upper Volta was abolished in 1932–1947; retained solely as a debug subdivision.")
next(e for e in E if e["id"] == "bohemia_moravia")["exclude"]["feature_ids"].append("CZ_ADM2_57006924B3568693077695")
add("liberec_return", Y39, "GER", None, None, FI("CZ_ADM2_57006924B3568693077695"))
add("kosice_return", Y39, "HUN", None, None, FI(*["SK_ADM2_56367889B" + n for n in
    ("16879144707830", "46930466225258", "7741755639355", "57985107422825")]))
for scenarios, parent in [(Y36, "RAJ"), (Y39, "ENG")]:
    year = scenarios[0][-4:]
    add("aden_" + year, scenarios, "ADN", "Aden", "亚丁", FI("YEM-3510"), parent=parent, kind="colony", color="#b38493")
    add("burma_parent_" + year, scenarios, "BRM", None, None, CC("MM"), parent=parent, kind="colony", cores="keep")
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

NCP_POSTS = CN("40522342172572 53166682632414 35191117841364 70843634097749 19397285057030 9046707294983 22707504793071 41032470199188 96614928239344 14553820792876 97923044022234 4963111392108 57880389938199 76829643653933 19618376010244 16732896761360 78988614189372 30734228092100 83167737560066 45390451107599 83100874373445 18968160632662 36539700725824 27087882119733 85544446441725 10208475755367 60524829078673 67411780639584 21492950184785 91447424097989 53877556564875 62040954239455 45020271947314 67315226354305 61994504860165 27963337647177 67438977719884 82739268949282 44584253435303 21670105101896 72971629177091 8527290020627 84296108244083") + ["CN_MRG_380671e40a1c", "CN_MRG_ed13ca65f52b", "CN_MRG_08f0b7755ac2", "CN_MRG_31ba4a677ea0", "CN_MRG_9b9b2d2aa43a", "CN_MRG_005ada82e050"] + CN("32842590404417 89036303488164 20799087712877 453440967624 99191317899548 506119010576 43163945505607")
CNZ_POSTS = CN("66003162693266 41187046911697 21512782047125 53922912898325")
JBZ_POSTS = CN("90378533110631 35516654467080 62103868434319") + ["CN_MRG_3ff67345ed78"]
MEN_POSTS = CN("58561192252896 83584927302596 42573248116242 56850756381420 74586174185496 76051276542746 97242903030707 71745014009476 38329795368035")
RGC_POSTS = CN("45149819427590 19859477737164 46074982775581 47635697455490 82708605205805 78816749784203 71370953459893 92006637325800 13333769593378 46393920630539 36737936197596 69259623848725 77980777243348 68627257397845 39263965325493 91286509256855 60218719915669 43191682084250 77400672470843 94592901594717 42065564755438 85263946797397")
JCC_POSTS = CN("52250123531455 90271468854707 56190437260016 36551936006551 44768888593389 82067370611519 78567156775151 74817202637370 50043505500678 83812560805647 59929886266985 42183204213930 64934349609422 47701832659247 68532057450373") + ["CN_MRG_398970fc50e7"]
JSC_POSTS = CN("38988280096574 25965384817686 33382458843189 31711539663260 92305935351425 58186217435722 75995678778305 35691129963558 2295538790743 80309702523612 34195804181253 50490784073671 71635948673445")
for eid, posts, restore, shanxi in [
    ("provisional_government", NCP_POSTS, "CHI", True), ("south_chahar", CNZ_POSTS, "CHI", False),
    ("north_shanxi", JBZ_POSTS, "SHX", False), ("mengjiang_1939", MEN_POSTS, "SHX", False),
    ("reformed_government", RGC_POSTS, "CHI", False), ("japanese_central_china", JCC_POSTS, "CHI", False),
    ("japanese_south_china", JSC_POSTS, "CHI", False)]:
    narrow(eid, FI(*posts), restore, cores="keep", shanxi=shanxi)
for eid in ("south_chahar", "north_shanxi"):
    next(e for e in E if e["id"] == eid)["parent_owner_tag"] = "MEN"
next(e for e in E if e["id"] == "south_chahar").update(name_en="South Chahar Administration", name_zh="察南政厅")
next(e for e in E if e["id"] == "north_shanxi").update(name_en="North Shanxi Administration", name_zh="晋北政厅")
men = next(e for e in E if e["id"] == "mengjiang_1939")
men.update(name_en="Mongolian United Autonomous Government", name_zh="蒙古联合自治政府",
           notes="China uses late-1939 occupation; CNZ and JBZ remain subordinate debug administrations after the September merger.")
men["only_from_owners"] += ["MAN", "CNZ"]
next(e for e in E if e["id"] == "provisional_government")["only_from_owners"] += ["LUQ", "RGC"]
next(e for e in E if e["id"] == "japanese_south_china")["only_from_owners"] += ["GXC"]

add("qinglong_return", B, "MAN", None, None, FI(*CN("43165756519885")))
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
    ("JCJ", "Jin-Cha-Ji Border Region", "晋察冀边区", "#9f2836", CN("46736465172107 69993211466305")),
    ("THG", "Taihang Resistance Area", "太行抗日根据地", "#b32032", ["CN_MRG_093183003948"]),
    ("JZH", "Central Hebei Resistance Area", "冀中抗日根据地", "#d44442", CN("86070890642714 52385226353354")),
    ("JNA", "Southern Hebei Resistance Area", "冀南抗日根据地", "#e36a5c", ["CN_MRG_51c0b9bbbb0a"]),
    ("LZG", "Central Shandong Resistance Area", "鲁中抗日根据地", "#c83747", CN("77679479199341")),
    ("JDG", "Jiaodong Resistance Area", "胶东抗日根据地", "#ef8a78", CN("99355884213700")),
    ("BHA", "Southeastern Shandong Guerrilla Area", "鲁东南抗日游击区", "#a84956", CN("41312334217118")),
    ("YWS", "Henan-Anhui-Jiangsu Guerrilla Area", "豫皖苏游击区", "#ad4a39", CN("89166552502762")),
    ("MSN", "New Fourth Army Southern Jiangsu Area", "新四军苏南游击区", "#d85c69", CN("59245154361238 11407259911678")),
    ("WNA", "New Fourth Army Southern Anhui Area", "新四军皖南驻区", "#7f344a", CN("59735937562693"))]:
    add(tag.lower() + "_debug_1939", Y39, tag, en, zh, FI(*fids), parent="PRC", kind="military_administration",
        color=color, cores="keep", notes="Whole-parcel resistance-area debug proxy; county seats and rural control were mixed.")

FEDERAL_SUBDIVISIONS = [
    ("CAN", "CA", "CAAB", "Alberta", "阿尔伯塔省", "Edmonton"),
    ("CAN", "CA", "CABC", "British_Columbia", "不列颠哥伦比亚省", "Victoria"),
    ("CAN", "CA", "CAMB", "Manitoba", "马尼托巴省", "Winnipeg"),
    ("CAN", "CA", "CANB", "New_Brunswick", "新不伦瑞克省", "Fredericton"),
    ("CAN", "CA", "CANS", "Nova_Scotia", "新斯科舍省", "Halifax"),
    ("CAN", "CA", "CAON", "Ontario", "安大略省", "Toronto"),
    ("CAN", "CA", "CAPE", "Prince_Edward_Island", "爱德华王子岛省", "Charlottetown"),
    ("CAN", "CA", "CAQC", "Quebec", "魁北克省", "Quebec City"),
    ("CAN", "CA", "CASK", "Saskatchewan", "萨斯卡彻温省", "Regina"),
    # Australia stays whole: the golden flows probe interior Western Australia and need it free of
    # a state label (tests/e2e/golden/golden-support.js PROBE_LON_LAT).
]
US_STATES = [
    ("AL", "Alabama", "亚拉巴马州", "Montgomery"), ("AZ", "Arizona", "亚利桑那州", "Phoenix"),
    ("AR", "Arkansas", "阿肯色州", "Little Rock"), ("CA", "California", "加利福尼亚州", "Sacramento"),
    ("CO", "Colorado", "科罗拉多州", "Denver"), ("CT", "Connecticut", "康涅狄格州", "Hartford"),
    ("DE", "Delaware", "特拉华州", "Dover"), ("FL", "Florida", "佛罗里达州", "Tallahassee"),
    ("GA", "Georgia", "佐治亚州", "Atlanta"), ("ID", "Idaho", "爱达荷州", "Boise"),
    ("IL", "Illinois", "伊利诺伊州", "Springfield"), ("IN", "Indiana", "印第安纳州", "Indianapolis"),
    ("IA", "Iowa", "艾奥瓦州", "Des Moines"), ("KS", "Kansas", "堪萨斯州", "Topeka"),
    ("KY", "Kentucky", "肯塔基州", "Frankfort"), ("LA", "Louisiana", "路易斯安那州", "Baton Rouge"),
    ("ME", "Maine", "缅因州", "Augusta"), ("MD", "Maryland", "马里兰州", "Annapolis"),
    ("MA", "Massachusetts", "马萨诸塞州", "Boston"), ("MI", "Michigan", "密歇根州", "Lansing"),
    ("MN", "Minnesota", "明尼苏达州", "Saint Paul"), ("MS", "Mississippi", "密西西比州", "Jackson"),
    ("MO", "Missouri", "密苏里州", "Jefferson City"), ("MT", "Montana", "蒙大拿州", "Helena"),
    ("NE", "Nebraska", "内布拉斯加州", "Lincoln"), ("NV", "Nevada", "内华达州", "Carson City"),
    ("NH", "New_Hampshire", "新罕布什尔州", "Concord"), ("NJ", "New_Jersey", "新泽西州", "Trenton"),
    ("NM", "New_Mexico", "新墨西哥州", "Santa Fe"), ("NY", "New_York", "纽约州", "Albany"),
    ("NC", "North_Carolina", "北卡罗来纳州", "Raleigh"), ("ND", "North_Dakota", "北达科他州", "Bismarck"),
    ("OH", "Ohio", "俄亥俄州", "Columbus"), ("OK", "Oklahoma", "俄克拉何马州", "Oklahoma City"),
    ("OR", "Oregon", "俄勒冈州", "Salem"), ("PA", "Pennsylvania", "宾夕法尼亚州", "Harrisburg"),
    ("RI", "Rhode_Island", "罗得岛州", "Providence"), ("SC", "South_Carolina", "南卡罗来纳州", "Columbia"),
    ("SD", "South_Dakota", "南达科他州", "Pierre"), ("TN", "Tennessee", "田纳西州", "Nashville"),
    ("TX", "Texas", "得克萨斯州", "Austin"), ("UT", "Utah", "犹他州", "Salt Lake City"),
    ("VT", "Vermont", "佛蒙特州", "Montpelier"), ("VA", "Virginia", "弗吉尼亚州", "Richmond"),
    ("WA", "Washington", "华盛顿州", "Olympia"), ("WV", "West_Virginia", "西弗吉尼亚州", "Charleston"),
    ("WI", "Wisconsin", "威斯康星州", "Madison"), ("WY", "Wyoming", "怀俄明州", "Cheyenne"),
]
FEDERAL_SUBDIVISIONS += [("USA", "US", "US" + abbr, name, zh, capital) for abbr, name, zh, capital in US_STATES]
for i, (parent, cc, tag, name, zh, capital) in enumerate(FEDERAL_SUBDIVISIONS):
    h, l, sat = colorsys.rgb_to_hls(*(int(PARENT_COLOR[parent][k:k + 2], 16) / 255 for k in (1, 3, 5)))
    rgb = colorsys.hls_to_rgb((h + ((i * 7) % 17 - 8) * .006) % 1, .34 + (i % 8) * .055, .35 + (i % 3) * .12)
    color = "#%02x%02x%02x" % tuple(round(c * 255) for c in rgb)
    add(tag.lower() + "_administration", B, tag, name.replace("_", " "), zh, HG(cc + "_" + name),
        parent=parent, kind="province" if cc == "CA" else "state", color=color, cores=[parent],
        exclude=FI("CA_FED_35079") if tag == "CAON" else None,
        notes="Ottawa parcel retained as the federal seat in this debug subdivision." if tag == "CAON" else None)


# ---------- 同色系配色 ----------
# Subjects keep their parent's hue (±10° in OKLCH) and vary lightness/chroma; colours are picked
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


def family_palette(parent_hex, count, hue_span=10.0):
    L0, a0, b0 = hex_to_oklab(parent_hex)
    C0, h0 = math.hypot(a0, b0), math.degrees(math.atan2(b0, a0))
    # A 0.32-wide lightness window around the parent, shifted inward at the 0.30/0.90 limits,
    # so very light (JAP) or dark (SOV) parents still give their subjects enough range.
    lo = min(max(0.30, L0 - 0.16), 0.90 - 0.32)
    hi = lo + 0.32
    pool = []
    for i in range(1, 900):
        L = lo + (hi - lo) * _halton(i, 2)
        # Near-grey parents (GER) keep greyscale subjects: their hue angle is meaningless.
        C = C0 + 0.01 * _halton(i, 3) if C0 < 0.03 else max(0.02, C0 * (0.55 + 0.6 * _halton(i, 3)))
        h = math.radians(h0 + hue_span * (2 * _halton(i, 5) - 1))
        while True:  # pull chroma back into the sRGB gamut
            lab = (L, C * math.cos(h), C * math.sin(h))
            rgb = oklab_to_rgb(lab)
            if all(0 <= c <= 1 for c in rgb) or C <= 0.01:
                break
            C *= 0.92
        if all(0 <= c <= 1 for c in rgb):
            pool.append(lab)
    chosen, anchors = [], [(L0, a0, b0)]
    for _ in range(count):
        best = max(pool, key=lambda p: min(math.dist(p, q) for q in anchors))
        chosen.append(best)
        anchors.append(best)
        pool.remove(best)
    return ["#%02x%02x%02x" % tuple(round(min(1, max(0, c)) * 255) for c in oklab_to_rgb(lab)) for lab in chosen]


def harmonize_family_colors(entries):
    parent_of, scenarios_of = {}, {}
    for scenario, countries in (("hoi4_1936", C36), ("hoi4_1939", C39)):
        for tag, country in countries.items():
            if country.get("parent_owner_tag"):
                parent_of.setdefault(tag, country["parent_owner_tag"])
            scenarios_of.setdefault(tag, []).append(scenario)
    for e in entries:
        if e.get("parent_owner_tag"):
            parent_of[e["tag"]] = e["parent_owner_tag"]
        for scenario in e["scenarios"]:
            if scenario not in scenarios_of.setdefault(e["tag"], []):
                scenarios_of[e["tag"]].append(scenario)
    colour = dict(PARENT_COLOR)
    for e in entries:
        if e.get("color_hex") and e["tag"] not in parent_of:
            colour[e["tag"]] = e["color_hex"]
    families = {}
    for child, parent in sorted(parent_of.items()):
        families.setdefault(parent, []).append(child)

    def depth(tag, seen=()):
        return 0 if tag not in parent_of or tag in seen else 1 + depth(parent_of[tag], seen + (tag,))

    for parent in sorted(families, key=lambda t: (depth(t), t)):
        children = families[parent]
        for child, hex_color in zip(children, family_palette(colour[parent], len(children))):
            colour[child] = hex_color
    entry_tags = {e["tag"] for e in entries}
    for e in entries:
        if e["tag"] in parent_of:
            e["color_hex"] = colour[e["tag"]]
    for tag in sorted(set(parent_of) - entry_tags):  # subjects from the manual rules: colour-only entries
        entries.append({"id": f"{tag.lower()}_family_colour", "scenarios": sorted(scenarios_of[tag]), "tag": tag,
                        "color_hex": colour[tag], "select": {"owners": [tag]}, "only_from_owners": [tag]})


harmonize_family_colors(E)

ids = [e["id"] for e in E]
assert len(ids) == len(set(ids)), "duplicate ids"
out = {"version": 1,
       "description": ("Post-build ownership overlay for HOI4 1936/1939, applied after the political feature merges. "
                       "Debug-oriented split; approximations are noted per entry."),
       "entries": E}
p = W / "data/scenario-rules/hoi4_split_overlay.json"
p.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
print(len(E), "entries ->", p)
