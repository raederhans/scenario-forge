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
        "memberFeatureIds": sorted(set(members)),
        "note": note,
    }
    if style:
        record["style"] = style
    return record


def build(scenario_id: str):
    data = ScenarioData(scenario_id)
    layers = []
    if scenario_id == "hoi4_1936":
        layers += [
            layer("preset-rhineland-dmz", "demilitarized", "Rhineland Demilitarized Zone", "莱茵兰非军事区",
                  rhineland_dmz(data), "《凡尔赛和约》第 42–43 条；HOI4 州 42/51/978 至 1936-03-07 为非军事区"),
            layer("preset-turkish-straits-dmz", "demilitarized", "Turkish Straits Demilitarized Zone", "土耳其海峡非军事区",
                  data.require(["TR100", "TR222", "TR212", "TR213"]),
                  "1923 年《洛桑海峡公约》，至 1936 年《蒙特勒公约》前有效；HOI4 州 340/341/797"),
            layer("preset-danzig-dmz", "demilitarized", "Danzig Demilitarized Area", "但泽非军事化地带",
                  data.owned_by("DNZ"), "国际联盟保护下的自由市；HOI4 州 85 set_demilitarized_zone"),
        ]
    elif scenario_id == "hoi4_1939":
        layers += [
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
