"""Generate data/scenario-rules/hoi4_split_overlay.json, the post-build HOI4 ownership overlay.

Run `python tools/build_hoi4_split_overlay.py`, then `python tools/apply_hoi4_split_overlay.py`.
Entries are applied in order; later entries may filter on owners set by earlier ones.
"""
import colorsys
import json
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
add("xikang_clique", B, "SIC", "Xikang Clique", "西康军阀（刘文辉）", PF("甘孜藏族自治州", "雅安市"), color="#006080",
    only=["CHU", "CHI", "SIC"])
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

ids = [e["id"] for e in E]
assert len(ids) == len(set(ids)), "duplicate ids"
out = {"version": 1,
       "description": ("Post-build ownership overlay for HOI4 1936/1939, applied after the political feature merges. "
                       "Debug-oriented split; approximations are noted per entry."),
       "entries": E}
p = W / "data/scenario-rules/hoi4_split_overlay.json"
p.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
print(len(E), "entries ->", p)
