"""按书面规则生成各剧本的预设特殊区域（special_zone_layers.json）。

预设只用地块成员表达，默认关闭，在特殊区域面板的“预设区域”里由用户开启。
每条规则写明依据；成员由规则从当前剧本数据推导，重跑即可随剧本数据更新。

用法：python tools/build_special_zone_presets.py [--check]
--check 只核对现有文件是否与规则输出一致，不写文件。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.scenario_topology_decode import topology_object_to_geojson  # noqa: E402

SCENARIOS = ("hoi4_1936", "hoi4_1939", "tno_1962", "modern_world")
TO_METERS = Transformer.from_crs(4326, 3035, always_xy=True).transform


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


class ScenarioData:
    def __init__(self, scenario_id: str):
        base = ROOT / "data" / "scenarios" / scenario_id
        self.manifest = read_json(base / "manifest.json")
        self.owners = read_json(base / "owners.by_feature.json")["owners"]
        cores_path = base / "cores.by_feature.json"
        self.cores = read_json(cores_path).get("cores", {}) if cores_path.exists() else {}
        topology = read_json(ROOT / self.manifest["runtime_topology_url"])
        self.features = {}
        for feature in topology_object_to_geojson(topology, "political")["features"]:
            fid = str(feature.get("properties", {}).get("id") or "").strip()
            if fid and fid in self.owners:
                self.features[fid] = feature
        self._points = {}

    def props(self, fid):
        return self.features[fid].get("properties", {})

    def point(self, fid):
        if fid not in self._points:
            self._points[fid] = shape(self.features[fid]["geometry"]).representative_point()
        return self._points[fid]

    def owned_by(self, *tags):
        wanted = set(tags)
        return [fid for fid, owner in self.owners.items() if owner in wanted and fid in self.features]

    def require(self, ids):
        missing = [fid for fid in ids if fid not in self.owners]
        if missing:
            raise ValueError(f"预设引用的地块不存在：{missing}")
        return list(ids)

    def by_names(self, names, *, cntr_code, bbox):
        lon0, lat0, lon1, lat1 = bbox
        wanted = set(names)
        hits = []
        for fid in self.features:
            props = self.props(fid)
            if props.get("cntr_code") != cntr_code or props.get("name") not in wanted:
                continue
            pt = self.point(fid)
            if lon0 <= pt.x <= lon1 and lat0 <= pt.y <= lat1:
                hits.append(fid)
        found = {self.props(fid).get("name") for fid in hits}
        missing = sorted(wanted - found)
        if missing:
            raise ValueError(f"按名称未找到地块：{missing}")
        return hits


def rhine_lines():
    rivers = read_json(ROOT / "data" / "europe_rivers.geojson")["features"]
    lines = [shape(f["geometry"]) for f in rivers
             if {f["properties"].get(k) for k in ("name", "name_en", "name_de")} & {"Rhine", "Rhein", "Rhin"}]
    return transform(TO_METERS, unary_union(lines))


def rhineland_dmz(data: ScenarioData):
    # 《凡尔赛和约》第 42–43 条：莱茵河左岸全部及右岸 50 公里内非军事化，1936-03-07 德军进驻前有效。
    # 左岸用 NUTS：DEA1 杜塞尔多夫、DEA2 科隆、DEB 莱茵兰-普法尔茨、DEC 萨尔；右岸按距莱茵河 50 公里。
    rhine = rhine_lines()
    members = []
    for fid in data.owned_by("GER"):
        if re.match(r"^(DEA1|DEA2|DEB|DEC)", fid):
            members.append(fid)
        elif fid.startswith("DE") and transform(TO_METERS, data.point(fid)).distance(rhine) <= 50_000:
            members.append(fid)
    return members


def french_dmz(data: ScenarioData):
    # TNO 州文件的 set_demilitarized_zone：诺曼底、圣但尼、塞纳-马恩、香槟、皮卡第、汝拉-科多尔，仅取法兰西国（FRA）持有部分。
    departments = {"14", "27", "50", "61", "76", "75", "77", "78", "91", "92", "93", "94", "95",
                   "02", "60", "80", "08", "10", "51", "52", "21", "39"}
    arrondissements = {fid: fid[7:9] for fid in data.features if fid.startswith("FR_ARR_")}
    members = []
    for fid in data.owned_by("FRA"):
        if fid in arrondissements:
            dept = arrondissements[fid]
        elif fid.startswith("FR_MRG_"):
            pt = data.point(fid)
            nearest = min(arrondissements, key=lambda other: data.point(other).distance(pt))
            dept = arrondissements[nearest]
        else:
            continue
        if dept in departments:
            members.append(fid)
    return members


def aa_line_uncontrolled(data: ScenarioData):
    # TNO 本地化：官方地图仍以阿尔汉格尔斯克—阿斯特拉罕线为帝国东界，而线以西仍有不受德方控制的俄罗斯政权。
    archangelsk, astrakhan = (40.5, 64.55), (48.03, 46.35)
    german_sphere = {"GER", "RKM", "RKU", "RKK", "RKP", "RKO", "OE00", "OE01", "OE02", "OE03",
                     "TNS", "ROM", "HUN", "FIN", "CRI"}
    members = []
    for fid, owner in data.owners.items():
        if fid not in data.features or owner in german_sphere or data.props(fid).get("cntr_code") != "RU":
            continue
        pt = data.point(fid)
        if not (astrakhan[1] <= pt.y <= archangelsk[1]):
            continue
        line_lon = archangelsk[0] + (astrakhan[0] - archangelsk[0]) * (archangelsk[1] - pt.y) / (archangelsk[1] - astrakhan[1])
        if pt.x < line_lon:
            members.append(fid)
    return members


def occupied_ukraine(data: ScenarioData):
    # 现代剧本叠加规则（modern_world.split_overlay.json）按 2025 年底前线近似：乌克兰地块中归俄罗斯、法理仍属乌克兰者。
    return [fid for fid, owner in data.owners.items()
            if owner == "RU" and fid in data.features and data.props(fid).get("cntr_code") == "UA"
            and "UA" in (data.cores.get(fid) or [])]


YELLOW_RIVER_FLOOD_COUNTIES = [
    # 1938 年花园口决堤后黄泛区：豫东贾鲁河、颍河一线，皖北淮河沿岸，苏北洪泽湖—里下河。
    "Zhongmouxian", "Kaifengxian", "Weixian", "Tongxu", "Xihuaxian", "Taikangxian", "Huaiyangxian",
    "Zhoukou", "Shangshuixian", "Shenqiuxian", "Xiangcheng", "Taihexian", "Jieshou", "Fuyang",
    "Yingshangxian", "Fengtaixian", "Huainan", "Shouxian", "Huaiyuanxian", "Bangbu", "Sihongxian",
    "Xuyuxian", "Hongzexian", "Huaiyinxian", "Huaiyin", "Huaian", "Baoyingxian", "Gaoyou",
]


def french_mandate(data: ScenarioData):
    # 1936 年法国委任统治叙利亚、黎巴嫩；HTY 为法国下属亚历山大勒塔自治专区。
    return [fid for fid in data.features
            if data.props(fid).get("cntr_code") in {"SY", "LB"}
            or (data.props(fid).get("cntr_code") == "TR" and data.props(fid).get("name") == "Hatay"
                and data.owners[fid] in {"FRA", "SYR", "HTY"})]


def british_mandates(data: ScenarioData):
    # 巴勒斯坦与外约旦委任统治范围，以现代 PS、IL、JO 行政区覆盖。
    return [fid for fid in data.features if data.props(fid).get("cntr_code") in {"PS", "IL", "JO"}]


def class_b_mandates(data: ScenarioData):
    # 坦噶尼喀不含奔巴岛两区和温古贾岛三区；其余覆盖卢旺达-乌隆迪、法属多哥与喀麦隆。
    # CM 的 Northwest、Southwest 为英属南喀麦隆，其余为法属喀麦隆；GH、NG 粒度不足，不纳入。
    zanzibar = {"North Pemba", "South Pemba", "Unguja North", "Unguja South", "Mjini Magharibi"}
    return [fid for fid in data.features
            if data.props(fid).get("cntr_code") in {"RW", "BI", "TG", "CM"}
            or (data.props(fid).get("cntr_code") == "TZ" and data.props(fid).get("name") not in zanzibar)]


def class_c_mandates(data: ScenarioData):
    # 西南非洲、南洋群岛（不含 GU）、西萨摩亚、瑙鲁；PG 仅原德属新几内亚。
    # 纳入省份：恩加、东塞皮克、马当、桑道恩、钦布、东高地、西高地、莫罗贝、
    # 东新不列颠、西新不列颠、新爱尔兰、马努斯、布干维尔；排除原巴布亚南部各省。
    provinces = ["Enga", "East Sepik", "Madang", "Sandaun", "Chimbu", "Eastern Highlands",
                 "Western Highlands", "Morobe", "East New Britain", "West New Britain",
                 "New Ireland", "Manus", "of Bougainville"]
    return ([fid for fid in data.features
             if data.props(fid).get("cntr_code") in {"NA", "PW", "MH", "FM", "MP", "WS", "NR"}]
            + data.by_names(provinces, cntr_code="PG", bbox=(140, -8, 157, 0)))


def new_territories(data: ScenarioData):
    # 1898 年《展拓香港界址专条》租借新界及离岛，按现有九个新界行政区近似（约 844 km²）。
    return data.by_names(["Sai Kung", "Sha Tin", "Kwai Tsing", "Tsuen Wan", "Tuen Mun", "Yuen Long",
                          "North District", "Tai Po", "Lantau Island"],
                         cntr_code="HK", bbox=(113.8, 22.1, 114.5, 22.6))


def sudetenland(data: ScenarioData):
    # 1938 年慕尼黑协定后并入德国；按书签归属区分 GER 与保护国 BOM，排除波兰持有的捷克地块。
    return [fid for fid in data.owned_by("GER") if data.props(fid).get("cntr_code") == "CZ"]


def bohemia_moravia(data: ScenarioData):
    # 1939 年 3 月设立保护国；剧本以 BOM 表示，成员与德国直接并入的苏台德分离。
    return [fid for fid in data.owned_by("BOM") if data.props(fid).get("cntr_code") == "CZ"]


def western_sahara(data: ScenarioData):
    # EH 地块只覆盖部分西撒哈拉；另纳入现代数据列在 MA 下的两个南部大区，合计约 24 万平方公里。
    return ([fid for fid in data.features if data.props(fid).get("cntr_code") == "EH"]
            + data.by_names(["Laâyoune - Boujdour - Sakia El Hamra", "Oued el Dahab"],
                            cntr_code="MA", bbox=(-18, 20, -8, 28)))


def southern_kurils(data: ScenarioData):
    # 国后、色丹、齿舞属南库里尔区；库里尔区含择捉及以北岛屿，两地块约 5815 km²，未超过四岛约 5000 km² 的三倍。
    return data.by_names(["Yuzhno-Kurilsky District", "Kurilsky District"],
                         cntr_code="RU", bbox=(145, 43, 153, 48))


def antarctic_overlap(data: ScenarioData):
    # 阿根廷、智利、英国三方共同重叠为西经 74–53 度；两侧扇区分别仅为两方重叠，不纳入。
    return data.by_names(["Antarctica / Peninsula 74W-53W Overlap Sector"],
                         cntr_code="AQ", bbox=(-74, -90, -53, -60))


# 与 js/core/special_zone_layers.js 的 SPECIAL_ZONE_PRESETS 默认样式保持一致；剧本契约要求每层带完整 style。
PRESET_STYLES = {
    "demilitarized": ("#f6e05e", "#b7791f", 0.08, "fineHatch", 0.42),
    "claim": ("#fb923c", "#c2410c", 0.06, "dashHatch", 0.42),
    "occupation": ("#475569", "#475569", 0.0, "bandStripes", 0.5),
    "lease": ("#5eead4", "#0f766e", 0.06, "dotGrid", 0.42),
    "economic": ("#a3e635", "#4d7c0f", 0.06, "fineHorizontal", 0.42),
    "restricted": ("#a8a29e", "#57534e", 0.1, "openGrid", 0.42),
}


def preset_style(preset, overrides=None):
    fill, stroke, fill_opacity, pattern, pattern_opacity = PRESET_STYLES[preset]
    style = {"fill": fill, "stroke": stroke, "fillOpacity": fill_opacity, "strokeOpacity": 0.92,
             "strokeWidth": 1.3, "pattern": pattern, "patternOpacity": pattern_opacity, "revision": 1}
    style.update(overrides or {})
    return style


def layer(layer_id, preset, name_en, name_zh, members, note, style=None):
    if not members:
        raise ValueError(f"{layer_id} 没有成员")
    record = {
        "id": layer_id,
        "name": name_en,
        "nameZh": name_zh,
        "presetId": preset,
        "source": "scenario",
        "visible": False,
        "legendVisible": True,
        "style": preset_style(preset, style),
        "memberFeatureIds": sorted(set(members)),
        "note": note,
    }
    return record


def build(scenario_id: str):
    data = ScenarioData(scenario_id)
    layers = []
    if scenario_id == "hoi4_1936":
        mandate_style = {"fill": "#60a5fa", "stroke": "#1d4ed8"}
        layers += [
            layer("preset-rhineland-dmz", "demilitarized", "Rhineland Demilitarized Zone", "莱茵兰非军事区",
                  rhineland_dmz(data), "《凡尔赛和约》第 42–43 条；HOI4 州 42/51/978 至 1936-03-07 为非军事区"),
            layer("preset-turkish-straits-dmz", "demilitarized", "Turkish Straits Demilitarized Zone", "土耳其海峡非军事区",
                  data.require(["TR100", "TR222", "TR212", "TR213"]),
                  "1923 年《洛桑海峡公约》，至 1936 年《蒙特勒公约》前有效；HOI4 州 340/341/797"),
            layer("preset-danzig-dmz", "demilitarized", "Danzig Demilitarized Area", "但泽非军事化地带",
                  data.owned_by("DNZ"), "国际联盟保护下的自由市；HOI4 州 85 set_demilitarized_zone"),
            layer("preset-french-mandate", "lease", "French Mandate for Syria and the Lebanon", "法国委任统治叙利亚和黎巴嫩",
                  french_mandate(data), "国际联盟法国委任统治；现代叙利亚、黎巴嫩及法国下属亚历山大勒塔自治专区（哈塔伊）",
                  style=mandate_style),
            layer("preset-british-mandates", "lease", "British Mandates for Palestine and Transjordan", "英国委任统治巴勒斯坦和外约旦",
                  british_mandates(data), "国际联盟英国委任统治；按现代巴勒斯坦、以色列、约旦地块覆盖", style=mandate_style),
            layer("preset-class-b-mandates", "lease", "Class B Mandates in Africa", "非洲 B 类委任统治地",
                  class_b_mandates(data),
                  "国际联盟 B 类委任统治：坦噶尼喀（排除奔巴岛、温古贾岛）、卢旺达-乌隆迪、法属多哥、英属南喀麦隆（西北及西南大区）与法属喀麦隆；英属多哥兰和英属北喀麦隆因加纳、尼日利亚地块粒度不符未纳入",
                  style=mandate_style),
            layer("preset-class-c-mandates", "lease", "Class C Mandates", "C 类委任统治地",
                  class_c_mandates(data),
                  "国际联盟 C 类委任统治：西南非洲、南洋群岛（不含关岛）、原德属新几内亚北部各省及俾斯麦群岛、布干维尔（排除原巴布亚）、西萨摩亚、瑙鲁；当前剧本无 PW、MH、FM、MP、WS、NR 地块，实际仅覆盖西南非洲与新几内亚领地",
                  style=mandate_style),
            # 关东州现有切分地块约 2200 km²，接近租借地约 3500 km²，未超过三倍。
            layer("preset-kwantung-lease", "lease", "Kwantung Leased Territory", "关东州租借地",
                  data.by_names(["Dalian · Kwantung"], cntr_code="CN", bbox=(120.8, 38.5, 122.5, 39.5)),
                  "日本承继旅顺—大连租借权；采用剧本关东州切分地块，约 2200 平方公里"),
            layer("preset-new-territories-lease", "lease", "New Territories (Hong Kong)", "香港新界",
                  new_territories(data), "1898 年《展拓香港界址专条》英国租借新界及离岛；按九个新界行政区近似，约 844 平方公里"),
            # 广州湾三个切分地块合计约 728 km²，与约 1300 km² 的租借范围量级相符。
            layer("preset-kwangchowan-lease", "lease", "Kwangchowan", "广州湾",
                  data.by_names(["Zhanjianghsi · Guangzhouwan", "Suixixian · Guangzhouwan", "Wuchuan · Guangzhouwan"],
                                cntr_code="CN", bbox=(110.0, 20.8, 110.8, 21.5)),
                  "1899 年《广州湾租界条约》法国租借；采用湛江、遂溪、吴川的广州湾切分地块，约 728 平方公里"),
            # 上海、天津无独立租界多边形，按允许的整市粒度表达。
            layer("preset-shanghai-concessions", "lease", "Shanghai International Settlement and French Concession", "上海公共租界与法租界",
                  data.by_names(["Shanghai"], cntr_code="CN", bbox=(121.0, 31.0, 121.8, 31.5)),
                  "1936 年上海公共租界与法租界；整市粒度，现有上海地块约 1446 平方公里，超出租界实际边界"),
            layer("preset-tianjin-concessions", "lease", "Tianjin Concessions", "天津租界",
                  data.by_names(["Tianjin"], cntr_code="CN", bbox=(117.0, 38.5, 117.8, 39.5)),
                  "1936 年天津各国租界；整市粒度，现有天津地块约 3845 平方公里，超出租界实际边界"),
            # 1903 年美巴条约下运河区约 1432 km²，现有切分地块约 1543 km²。
            layer("preset-panama-canal-zone", "lease", "Panama Canal Zone", "巴拿马运河区",
                  data.by_names(["Colón · Panama Canal Zone", "Panamá · Panama Canal Zone"],
                                cntr_code="PA", bbox=(-80.1, 8.7, -79.4, 9.5)),
                  "1903 年美巴条约下美国管辖的运河区；采用剧本运河区切分地块，约 1543 平方公里，含科隆市地块近似"),
        ]
    elif scenario_id == "hoi4_1939":
        layers += [
            layer("preset-sudetenland", "claim", "Sudetenland (annexed 1938)", "苏台德（1938 年并入）",
                  sudetenland(data), "1938 年 10 月慕尼黑协定后并入德国；采用 CZ 中 GER 持有地块，约 21700 平方公里，排除 BOM 保护国"),
            layer("preset-bohemia-moravia", "occupation", "Protectorate of Bohemia and Moravia", "波希米亚-摩拉维亚保护国",
                  bohemia_moravia(data), "1939 年 3 月德国占领；采用 CZ 中保护国 BOM 持有地块，排除苏台德和波兰持有部分"),
            # 克莱佩达县约 4786 km²，未超过历史梅梅尔地区约 2657 km² 的三倍。
            layer("preset-memel", "claim", "Memel Territory (annexed 1939)", "梅梅尔地区（1939 年并入）",
                  [fid for fid in data.owned_by("GER") if data.props(fid).get("cntr_code") == "LT"],
                  "1939 年 3 月德国从立陶宛并入梅梅尔；采用德属克莱佩达县地块近似，约 4786 平方公里"),
            layer("preset-albania-occupation", "occupation", "Italian-occupied Albania", "意占阿尔巴尼亚",
                  [fid for fid in data.features if data.props(fid).get("cntr_code") == "AL"],
                  "1939 年 4 月意大利入侵；按现代 AL 地块覆盖阿尔巴尼亚，剧本保留 ALB 标签"),
            layer("preset-hatay", "claim", "Hatay (annexed by Turkey 1939)", "哈塔伊（1939 年并入土耳其）",
                  data.by_names(["Hatay"], cntr_code="TR", bbox=(35, 35, 37, 38)),
                  "1939 年哈塔伊并入土耳其，叙利亚不承认；现代哈塔伊省约 5806 平方公里，未超过原专区约 4700 平方公里的三倍"),
            layer("preset-danzig-dmz", "demilitarized", "Danzig Demilitarized Area", "但泽非军事化地带",
                  data.owned_by("DNZ"), "HOI4 州 85 set_demilitarized_zone，书签日仍有效"),
            layer("preset-yellow-river-flood", "restricted", "Yellow River Flood Area", "黄泛区",
                  data.by_names(YELLOW_RIVER_FLOOD_COUNTIES, cntr_code="CN", bbox=(113.5, 32.2, 120.0, 35.0)),
                  "1938-06 花园口决堤；HOI4 州 598/606/607 的 yellow_river_blown 修正（1938-10-25 起 300 天）"),
        ]
    elif scenario_id == "tno_1962":
        layers += [
            layer("preset-french-dmz", "demilitarized", "French Demilitarized Belt", "法国非军事化地带",
                  french_dmz(data), "TNO 州 15/16/788/1625/1626/1635 set_demilitarized_zone"),
            layer("preset-sichuan-dmz", "demilitarized", "Sichuan Demilitarized States", "四川非军事化地带",
                  data.by_names(["Chengdu", "Zigong", "Yibin", "Yibinxian", "Nanchong", "Mianyang", "Suining", "Luzhou"],
                                cntr_code="CN", bbox=(102.5, 27.5, 107.5, 32.5)),
                  "TNO 州 605/2368–2373/2438 set_demilitarized_zone"),
            layer("preset-cyprus-dmz", "demilitarized", "Cyprus Demilitarized Area", "塞浦路斯非军事化地带",
                  data.require(["ATLISL_levant_cyprus"]), "TNO 州 183/1328/2322/2323 set_demilitarized_zone；整岛粒度"),
            layer("preset-gotenland-settlement", "economic", "Gotenland Settlement Zone", "哥腾兰殖民定居区",
                  data.owned_by("CRI"), "TNO 克里米亚本地化：旅游、定居与东方殖民投资"),
            layer("preset-suez-transit", "restricted", "Suez Canal Controlled Transit", "苏伊士运河管制通行区",
                  data.require(["EGY-1531", "EGY-1536"]), "TNO 意大利本地化：运河由意大利控制，可开闭并限制通行"),
            layer("preset-aa-line-claim", "claim", "Uncontrolled Lands West of the A-A Line", "A-A 线以西未实控区",
                  aa_line_uncontrolled(data), "TNO 本地化：官方地图仍以 A-A 线为帝国东界，线以西仍有俄罗斯政权"),
        ]
    elif scenario_id == "modern_world":
        layers += [
            layer("preset-western-sahara", "claim", "Western Sahara", "西撒哈拉（地位未定）",
                  western_sahara(data), "西撒哈拉地位未定；摩洛哥实控大部、波利萨里奥主张，采用 EH 及 MA 下两个南部大区近似"),
            layer("preset-southern-kurils", "claim", "Southern Kuril Islands", "南千岛群岛（北方四岛）争议",
                  southern_kurils(data), "俄罗斯实控、日本主张；按南库里尔区与库里尔区岛屿地块近似，包含择捉以北岛屿，约 5815 平方公里，未超过四岛约 5000 平方公里的三倍"),
            layer("preset-falkland-islands", "claim", "Falkland Islands", "福克兰（马尔维纳斯）群岛争议",
                  [fid for fid in data.features if data.props(fid).get("cntr_code") == "FK"],
                  "英国实控、阿根廷主张；采用 FK 群岛地块"),
            layer("preset-kosovo-status", "claim", "Kosovo status", "科索沃地位争议",
                  [fid for fid in data.features if data.props(fid).get("cntr_code") == "XK"],
                  "科索沃独立地位存在争议，塞尔维亚主张；采用 XK 地块"),
            layer("preset-antarctic-overlap", "claim", "Overlapping Antarctic Claims", "南极领土主张重叠区",
                  antarctic_overlap(data), "阿根廷、智利、英国三方主张共同重叠的西经 74–53 度扇区；采用现有南极扇区地块"),
            layer("preset-golan-dispute", "claim", "Golan Heights Dispute", "戈兰高地争议区",
                  data.require(["ISR-3056__SPLIT_GOLAN_HEIGHTS", "SYR-5261__SPLIT_GOLAN_HEIGHTS"]),
                  "Natural Earth 争议区 1159320905；以色列实控、叙利亚法理"),
            layer("preset-ukraine-occupation", "occupation", "Russian-Controlled Areas of Ukraine", "乌克兰境内俄控区",
                  occupied_ukraine(data), "现代剧本叠加规则按 2025 年底前线近似（约 ±20 km）",
                  style={"stroke": "#7f1d1d", "fill": "#7f1d1d"}),
            layer("preset-kashmir-india", "claim", "Indian-Administered Kashmir", "印控克什米尔（争议）",
                  data.owned_by("JNK", "LDK"), "查谟—克什米尔与拉达克，巴基斯坦主张"),
            layer("preset-kashmir-pakistan", "claim", "Pakistan-Administered Kashmir", "巴控克什米尔（争议）",
                  data.require(["PAK-1109", "PAK-1111"]), "自由克什米尔与吉尔吉特-巴尔蒂斯坦，印度主张"),
            layer("preset-northern-cyprus", "claim", "Northern Cyprus Status Dispute", "北塞浦路斯地位争议",
                  data.require(["CY000__SPLIT_NORTHERN_CYPRUS"]), "仅土耳其承认；法理属塞浦路斯"),
        ]
    return {"version": 1, "layers": layers, "activeLayerId": "", "topologyFingerprint": "", "diagnostics": []}


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    stale = []
    for scenario_id in SCENARIOS:
        payload = build(scenario_id)
        target = ROOT / "data" / "scenarios" / scenario_id / "special_zone_layers.json"
        text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        counts = ", ".join(f"{entry['nameZh']} {len(entry['memberFeatureIds'])}" for entry in payload["layers"])
        print(f"{scenario_id}: {counts}")
        if args.check:
            if target.read_text(encoding="utf-8") != text:
                stale.append(scenario_id)
        else:
            with target.open("w", encoding="utf-8", newline="\n") as handle:
                handle.write(text)
    if stale:
        raise SystemExit(f"预设与规则输出不一致：{stale}")


if __name__ == "__main__":
    main()
