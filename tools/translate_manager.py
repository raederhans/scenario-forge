import argparse
import json
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import unicodedata
from pathlib import Path

try:
    # Attempt absolute import (for when running from root via init_map_data.py)
    from tools.geo_seeds import EUROPE_GEO_SEEDS
except ImportError:
    try:
        # Attempt local import (for when running script directly from tools/ dir)
        from geo_seeds import EUROPE_GEO_SEEDS
    except ImportError as exc:
        raise ImportError(
            "Could not import geo_seeds. Ensure execution from root or tools/ directory."
        ) from exc


MANUAL_UI_DICT = {
    "Fill": "填充",
    "Eraser": "橡皮擦",
    "Eyedropper": "吸管",
    "Export Map": "导出地图",
    "Download Snapshot": "下载快照",
    "Auto-Fill Countries": "自动填充国家",
    "Clear Map": "清空地图",
    "Country Colors": "国家配色",
    "Reset Country Colors": "重置国家配色",
    "Reset Colors": "重置颜色",
    "Search...": "搜索...",
    "Search Countries": "搜索国家",
    "Search countries": "搜索国家",
    "Current Tool": "当前工具",
    "Recent": "最近使用",
    "Color Palette": "调色板",
    "Custom": "自定义",
    "Texture": "纹理",
    "Overlay": "覆盖层",
    "Map Style": "地图样式",
    "Internal Borders": "内部边界",
    "Empire Borders": "帝国边界",
    "Coastlines": "海岸线",
    "Width": "宽度",
    "Opacity": "不透明度",
    "Format": "格式",
    "Color Mode": "配色模式",
    "By Region": "按地区",
    "By Neighbor (Political)": "按邻接（政治）",
    "Paint Granularity": "涂色粒度",
    "By Subdivision": "按子区域",
    "By Country": "按国家",
    "Special Zones": "特殊区域",
    "Project Management": "项目管理",
    "Save or load your map state as a project file.": "将当前地图状态保存或加载为项目文件。",
    "Download Project": "下载项目",
    "Load Project": "加载项目",
    "Selected File": "已选文件",
    "No file selected": "未选择文件",
    "Legend Editor": "图例编辑器",
    "Paint regions to generate a legend.": "为区域上色以生成图例。",
    "Debug Mode": "调试模式",
    "Use diagnostics to inspect geometry and artifact behavior.": "使用诊断视图检查几何与异常行为。",
    "View": "视图",
    "Normal View": "正常视图",
    "1. Geometry Check (Pink/Green)": "1. 几何检查（粉/绿）",
    "2. Artifact Hunter (Red Giants)": "2. 伪影猎人（红色巨物）",
    "3. Island Detector (Orange)": "3. 岛屿检测（橙色）",
    "4. ID Stability": "4. ID 稳定性",
    "--- Presets ---": "--- 预设 ---",
    "--- Provinces/Regions ---": "--- 省/区域 ---",
    "Edit": "编辑",
    "Cancel": "取消",
    "Save": "保存",
    "Copy": "复制",
    "Editing Preset": "正在编辑预设",
    "Invalid project file. Please select a valid map_project.json.": "项目文件无效，请选择有效的 map_project.json。",
    "Unable to read the selected file.": "无法读取所选文件。",
    "Region": "区域",
    "Unknown Region": "未知区域",
    "Paint Meaning": "上色含义",
    "Visual": "视觉",
    "Sovereignty": "主权",
    "Active Sovereign": "当前主权国",
    "None selected": "未选择",
    "Set Active": "设为当前",
    "Active": "已设为主权",
    "Recalculate Borders": "重算边界",
    "Borders up to date": "边界已更新",
    "Borders need recalculation": "边界需要重算",
    "Dynamic borders disabled": "动态边界已禁用",
    "Physical Regions": "地貌区域",
    "Terrain Atlas": "地貌图集",
    "Terrain Contours": "地形等高线",
    "Atlas + Contours": "图集 + 等高线",
    "Atlas Only": "仅图集",
    "Contours Only": "仅等高线",
    "Atlas Intensity": "图集强度",
    "Rainforest Emphasis": "雨林强调",
    "Mountains": "山地",
    "Plateaus": "高原",
    "Plains": "平原",
    "Wetlands & Delta": "湿地与三角洲",
    "Forest": "森林",
    "Rainforest": "雨林",
    "Desert & Bare": "荒漠与裸地",
    "Tundra & Ice": "苔原与冰雪",
    "Show Minor Contours": "显示次级等高线",
    "Contour Color": "等高线颜色",
    "Contour Opacity": "等高线不透明度",
    "Major Width": "主等高线宽度",
    "Minor Width": "次等高线宽度",
    "Major Interval (m)": "主等高距（米）",
    "Minor Interval (m)": "次等高距（米）",
    "Low-Relief Cutoff (m)": "低起伏截止高度（米）",
    "Apply": "应用",
    "Delete Selected": "删除所选",
    "Exit Scenario": "退出剧本",
    "Import cancelled": "导入已取消",
    "Project import cancelled because the saved scenario baseline does not match the current assets.": "由于保存的剧本基线与当前资源不匹配，项目导入已取消。",
    "Reset Changes To Baseline": "重置更改到基线",
    "Scenario": "剧本",
    "Scenario cleared": "剧本已退出",
    "Scenario cleared.": "剧本已退出。",
    "Scenario failed": "剧本加载失败",
    "Scenario loaded": "剧本已加载",
    "Scenario reset": "剧本已重置",
    "Scenario reset to baseline.": "剧本已重置为基线。",
    "Unable to apply scenario.": "无法应用剧本。",
    "Critical checks": "关键检查",
    "Target This Country": "将此国家设为目标",
    "When off, shoreline, basin contour, and texture overlays are hidden for the active scenario.": "关闭后，当前剧本的海岸线、盆地等高线和纹理覆盖层将被隐藏。",
    "Scenario relief overlays are currently visible. During pan and zoom they redraw only after the view settles.": "当前剧本的地形覆盖层处于可见状态。平移和缩放期间会在视图稳定后重绘。",
}

MANUAL_GEO_OVERRIDES = {
    "United States": "\u7f8e\u56fd",
    "United States of America": "\u7f8e\u56fd",
    "USA": "\u7f8e\u56fd",
    "US": "\u7f8e\u56fd",
    "New York": "\u7ebd\u7ea6",
    "Los Angeles": "\u6d1b\u6749\u77f6",
    "Chicago": "\u829d\u52a0\u54e5",
    "New York City": "\u7ebd\u7ea6\u5e02",
    "Miami": "\u8fc8\u963f\u5bc6",
    "Philadelphia": "\u8d39\u57ce",
    "Dallas": "\u8fbe\u62c9\u65af",
    "Atlanta": "\u4e9a\u7279\u5170\u5927",
    "Boston": "\u6ce2\u58eb\u987f",
    "Houston": "\u4f11\u65af\u6566",
    "Washington,  D.C.": "\u534e\u76db\u987f\u7279\u533a",
    "Detroit": "\u5e95\u7279\u5f8b",
    "Phoenix": "\u83f2\u5c3c\u514b\u65af",
    "San Francisco": "\u65e7\u91d1\u5c71",
    "Seattle": "\u897f\u96c5\u56fe",
    "Irvine": "\u6b27\u6587",
    "San Diego": "\u5723\u8fea\u4e9a\u54e5",
    "Brooklyn": "\u5e03\u9c81\u514b\u6797",
    "Minneapolis": "\u660e\u5c3c\u963f\u6ce2\u5229\u65af",
    "Queens": "\u7687\u540e\u533a",
    "Tampa": "\u5766\u5e15",
    "Denver": "\u4e39\u4f5b",
    "Baltimore": "\u5df4\u5c14\u7684\u6469",
    "St. Louis": "\u5723\u8def\u6613\u65af",
    "Fort Lauderdale": "\u52b3\u5fb7\u4ee3\u5c14\u5821",
    "Russian Federation": "\u4fc4\u7f57\u65af",
    "People's Republic of China": "\u4e2d\u56fd",
    "Ards": "\u963f\u5179",
    "Seven seas (open ocean)": "\u4e03\u6d77\uff08\u516c\u6d77\uff09",
    "F.C.T.": "\u8054\u90a6\u9996\u90fd\u533a",
    "K.P.": "\u5f00\u4f2f\u5c14-\u666e\u4ec0\u56fe\u8d6b\u74e6",
    "Al Hudud ash Shamaliyah": "\u5317\u90e8\u8fb9\u5883\u7701",
    "Bellechasse\u2014Les Etchemins\u2014L\u00e9vis": "\u8d1d\u52d2\u6c99\u65af-\u83b1\u585e\u5947\u660e-\u83b1\u7ef4",
    "Bellechasse\ufffd\ufffdLes Etchemins\ufffd\ufffdL\ufffd\ufffdvis": "\u8d1d\u52d2\u6c99\u65af-\u83b1\u585e\u5947\u660e-\u83b1\u7ef4",
    "Taiaiako'n\u2014Parkdale\u2014High Park": "\u6cf0\u4e9a\u4e9a\u79d1\u6069-\u5e15\u514b\u4ee3\u5c14-\u6d77\u5e15\u514b",
    "Taiaiako'n\ufffd\ufffdParkdale\ufffd\ufffdHigh Park": "\u6cf0\u4e9a\u4e9a\u79d1\u6069-\u5e15\u514b\u4ee3\u5c14-\u6d77\u5e15\u514b",
    "Okanagan Lake West\u2014South Kelowna": "\u5965\u5361\u7eb3\u6839\u6e56\u897f-\u5357\u57fa\u6d1b\u7eb3",
    "Okanagan Lake West\ufffd\ufffdSouth Kelowna": "\u5965\u5361\u7eb3\u6839\u6e56\u897f-\u5357\u57fa\u6d1b\u7eb3",
    "Pitt Meadows\u2014Maple Ridge": "\u76ae\u7279\u6885\u591a\u65af-\u67ab\u6811\u5cad",
    "Pitt Meadows\ufffd\ufffdMaple Ridge": "\u76ae\u7279\u6885\u591a\u65af-\u67ab\u6811\u5cad",
    "Vancouver East": "\u6e29\u54e5\u534e\u4e1c",
    "Oaxaca Zone 52": "\u74e6\u54c8\u5361\u7b2c52\u533a",
    "Tamaulipas Zone 6": "\u5854\u6bdb\u5229\u5e15\u65af\u7b2c6\u533a",
    "St. Lucie": "\u5723\u9732\u897f",
    "Lofa": "\u6d1b\u6cd5",
    "Omaheke": "\u5965\u9a6c\u8d6b\u51ef",
    "VEN+99?": "\u59d4\u5185\u745e\u62c9\u7279\u6b8a\u533a\u57df",
    "VEN+99\uff1f": "\u59d4\u5185\u745e\u62c9\u7279\u6b8a\u533a\u57df",
    "HOI4 1936": "钢铁雄心4 1936",
    "HOI4 1939": "钢铁雄心4 1939",
    "TNO 1962": "TNO 1962（新秩序）",
    "Blank Base": "空白基线",
    "Modern World": "现代世界",
    "Canonical ownership baseline without scenario-only overlays.": "不含剧本专属覆盖层的规范主权基线。",
    "Canonical modern-world baseline with vanilla palette colors.": "使用原版调色板颜色的现代世界规范基线。",
    "Anglo-Egyptian Sudan": "英埃苏丹",
    "Atlantropa Reclamation Zone": "亚特兰托帕垦殖区",
    "Azad Hind": "自由印度",
    "Belgian Congo": "比属刚果",
    "British East Africa": "英属东非",
    "British West Africa": "英属西非",
    "Ceylon": "锡兰",
    "Dutch East Indies": "荷属东印度",
    "French Algeria": "法属阿尔及利亚",
    "French Equatorial Africa": "法属赤道非洲",
    "French Indochina": "法属印度支那",
    "French Mandate for Lebanon": "法属黎巴嫩托管地",
    "French Mandate for Syria": "法属叙利亚托管地",
    "French Morocco": "法属摩洛哥",
    "French Tunisia": "法属突尼斯",
    "French West Africa": "法属西非",
    "Greek Protectorate": "希腊保护国",
    "Guangdong National Government": "广东国民政府",
    "Guizhou Clique": "贵州军阀",
    "Independent State of Croatia": "克罗地亚独立国",
    "Italian East Africa": "意属东非",
    "Italian Egypt": "意属埃及",
    "Italian Palestine": "意属巴勒斯坦",
    "Italian Somaliland": "意属索马里兰",
    "Italian Transjordan": "意属外约旦",
    "Kingdom of Egypt": "埃及王国",
    "Korea": "朝鲜",
    "Lebanese Protectorate": "黎巴嫩保护国",
    "Malaya": "马来亚",
    "Nanjing China": "南京中国",
    "North China Political Council": "华北政务委员会",
    "Ordensstaat Burgund": "勃艮第骑士团国",
    "Reformed Government of China": "中华民国维新政府",
    "Reichskommissariat Kaukasien": "高加索专员辖区",
    "Reichskommissariat Moskowien": "莫斯科专员辖区",
    "Reichskommissariat Niederlande": "荷兰专员辖区",
    "Reichskommissariat Norwegen": "挪威专员辖区",
    "Reichskommissariat Ostland": "东方专员辖区",
    "Reichskommissariat Polen": "波兰专员辖区",
    "Reichskommissariat Ukraine": "乌克兰专员辖区",
    "Serbian Administration": "塞尔维亚行政当局",
    "Spanish Guinea": "西属几内亚",
    "Spanish Morocco": "西属摩洛哥",
    "Spanish Sahara": "西属撒哈拉",
    "Syrian Protectorate": "叙利亚保护国",
    "Tunisian Protectorate": "突尼斯保护国",
    "Xikang-Tibet Administration": "西康-西藏行政区",
    "Xikang Clique": "西康军阀",
    "Xinjiang": "新疆",
    "South Jutland (Remainder)": "南日德兰（剩余部分）",
    "South Jutland (Remainder) (DK)": "南日德兰（剩余部分）",
    "South Jutland (Remainder) [Sydjylland]": "南日德兰（剩余部分）",
}

UI_CALL_RE = re.compile(r"""t\(\s*(['\"])(?P<text>.*?)\1\s*,\s*(['\"])ui\3\s*\)""")
MODAL_CALL_RE = re.compile(
    r"""\b(?:alert|confirm|prompt)\(\s*(['\"])(?P<text>.*?)\1\s*\)"""
)
PLACEHOLDER_PREFIX_RE = re.compile(
    r"^\s*(?:\[(?:TODO|todo)\]|TODO:?|To do:?|待办|待翻|未翻译|未汉化|去做)\s*[:：-]?\s*"
)
ORPHAN_STABLE_KEY_RE = re.compile(r"^id::\d+$")
CJK_RE = re.compile(r"[\u4e00-\u9fff]")
PRIVATE_USE_RE = re.compile(r"[\ue000-\uf8ff]")
MOJIBAKE_RE = re.compile(r"[\ufffd]|鈥|锟|€")
SHELL_FALLBACK_NAME_RE = re.compile(r"^Russia Shell Fallback(?: \d+)?(?: \(RU\))?$", re.IGNORECASE)
SHELL_FALLBACK_STABLE_KEY_RE = re.compile(r"^id::[A-Za-z0-9_]+_FB_[A-Za-z0-9_]+$")
ZONE_NAME_RE = re.compile(r"\bZone\s+\d+\b", re.IGNORECASE)
US_ZONE_TRANSLATION_RE = re.compile(r"(?:\bZone\s*\d+\b|\u7b2c?\s*\d+\s*[\u533a\u865f\u53f7])", re.IGNORECASE)
SCENARIO_DISPLAY_FIELDS = ("display_name", "displayName")
SCENARIO_METADATA_FIELDS = ("bookmark_name", "bookmarkName", "bookmark_description", "bookmarkDescription")
TOOLTIP_ADMIN_FIELDS = ("admin1_group", "constituent_country")




def decode_js_string(text: str) -> str:
    value = text.strip()
    value = value.replace(r"\'", "'").replace(r'\"', '"')
    value = value.replace(r"\n", " ").replace(r"\r", " ").replace(r"\t", " ")
    return " ".join(value.split())


def strip_placeholder_prefix(text: str) -> str:
    value = (text or "").strip()
    previous = None
    while value and value != previous:
        previous = value
        value = PLACEHOLDER_PREFIX_RE.sub("", value).strip()
    return value


def normalize_comparable_text(text: str) -> str:
    return unicodedata.normalize("NFKC", (text or "").strip())


def is_user_visible_candidate(value: str) -> bool:
    text = (value or "").strip()
    if len(text) < 3:
        return False
    if text.startswith("#"):
        return False
    if text.startswith("[") and text.endswith("]"):
        return False
    if re.fullmatch(r"[A-Z0-9_\-]+", text):
        return False
    if re.fullmatch(r"[{}()<>:=;,.\-_/\\]+", text):
        return False
    return bool(re.search(r"[A-Za-z]", text))


def has_literal_todo_marker(text: str) -> bool:
    value = (text or "").strip()
    if not value:
        return False
    return value != strip_placeholder_prefix(value)


def is_corrupted_translation(text: str) -> bool:
    value = strip_placeholder_prefix(text or "")
    if not value:
        return False
    if PRIVATE_USE_RE.search(value):
        return True
    if MOJIBAKE_RE.search(value):
        return True
    return False


def is_corrupted_source_name(text: str) -> bool:
    value = strip_placeholder_prefix(text or "")
    if not value:
        return False
    if PRIVATE_USE_RE.search(value):
        return True
    if MOJIBAKE_RE.search(value):
        return True
    return False


def is_shell_fallback_name(text: str) -> bool:
    value = strip_placeholder_prefix(text or "")
    if not value:
        return False
    if SHELL_FALLBACK_NAME_RE.fullmatch(value):
        return True
    if SHELL_FALLBACK_STABLE_KEY_RE.fullmatch(value):
        return True
    return "shell fallback" in value.lower()


def is_missing_like(text: str, en: str = "") -> bool:
    value = (text or "").strip()
    if not value:
        return True
    stripped = strip_placeholder_prefix(value)
    if not stripped:
        return True
    if is_corrupted_translation(stripped):
        return True
    if bool(en) and normalize_comparable_text(stripped) == normalize_comparable_text(en or ""):
        return not bool(CJK_RE.search(stripped))
    return False


def should_track_geo_missing_like(key: str, en_value: str = "") -> bool:
    return (
        not is_shell_fallback_name(key)
        and not is_shell_fallback_name(en_value)
        and not is_corrupted_source_name(key)
        and not is_corrupted_source_name(en_value)
    )


def is_us_stable_key(value: str = "") -> bool:
    return str(value or "").strip().startswith("id::US_")


def is_us_legacy_zone_name(value: str = "") -> bool:
    return bool(ZONE_NAME_RE.search(str(value or "").strip()))


def is_zoneish_us_translation(value: str = "") -> bool:
    return bool(US_ZONE_TRANSLATION_RE.search(strip_placeholder_prefix(value or "")))


def should_ignore_existing_us_geo_zh(
    *,
    key: str,
    en_value: str,
    existing_zh: str,
    primary_name: str = "",
    stable_key: str = "",
) -> bool:
    if not existing_zh:
        return False
    us_context = (
        is_us_stable_key(key)
        or is_us_stable_key(stable_key)
        or str(stable_key or "").startswith("id::US_")
    )
    if not us_context:
        return False
    if (
        is_us_legacy_zone_name(key)
        or is_us_legacy_zone_name(en_value)
        or is_us_legacy_zone_name(primary_name)
    ):
        return False
    return is_zoneish_us_translation(existing_zh)


def get_geo_primary_name(key: str, alias_to_stable: dict, stable_to_primary: dict) -> str:
    stable_key = alias_to_stable.get(key)
    if stable_key:
        return stable_to_primary.get(stable_key, "")
    return stable_to_primary.get(key, "")


def get_existing_usable_zh(existing: dict, key: str, fallback_en: str = "") -> str | None:
    entry = existing.get(key)
    if not isinstance(entry, dict):
        return None
    zh_value = entry.get("zh", "")
    en_value = entry.get("en", fallback_en or key)
    if is_missing_like(zh_value, en_value):
        return None
    return strip_placeholder_prefix(zh_value)


def should_drop_geo_entry(
    key: str,
    geo_names: set[str],
    alias_to_stable: dict,
    stable_to_primary: dict,
    search_only_aliases: set[str],
) -> bool:
    if not key:
        return True
    if key in search_only_aliases:
        return True
    if key in geo_names or key in MANUAL_GEO_OVERRIDES or key in EUROPE_GEO_SEEDS:
        return False
    if key in alias_to_stable or key in stable_to_primary:
        return False
    if is_us_stable_key(key):
        return True
    if is_us_legacy_zone_name(key):
        return True
    if "\ufffd" in key:
        return True
    return bool(ORPHAN_STABLE_KEY_RE.fullmatch(key))



def collect_ui_keys(repo_root: Path) -> list[str]:
    keys = set(MANUAL_UI_DICT.keys())
    source_roots = [repo_root / "js", repo_root / "index.html"]

    files = []
    for item in source_roots:
        if item.is_file():
            files.append(item)
        elif item.is_dir():
            files.extend(sorted(p for p in item.rglob("*") if p.suffix in {".js", ".html"}))

    for path in files:
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for pattern in (UI_CALL_RE, MODAL_CALL_RE):
            for match in pattern.finditer(content):
                value = decode_js_string(match.group("text"))
                if value:
                    keys.add(value)
    return sorted(keys)


def parse_country_codes(raw_value: str | None) -> set[str]:
    if not raw_value:
        return set()
    parts = re.split(r"[\s,;|]+", str(raw_value).strip())
    return {
        part.strip().upper()
        for part in parts
        if part and part.strip()
    }


def iter_topology_properties(topo_path: Path, country_codes: set[str] | None = None) -> list[dict]:
    if not topo_path.exists():
        raise FileNotFoundError(f"Missing topology file: {topo_path}")

    with topo_path.open("r", encoding="utf-8") as file:
        data = json.load(file)

    properties_list = []
    if isinstance(data, dict) and data.get("type") == "Topology":
        political = data.get("objects", {}).get("political")
        if political and isinstance(political, dict):
            for geom in political.get("geometries", []):
                props = geom.get("properties") or {}
                code = str(props.get("cntr_code", "")).strip().upper()
                if country_codes and code not in country_codes:
                    continue
                properties_list.append(props)
    elif isinstance(data, dict) and "features" in data:
        for feat in data.get("features", []):
            props = feat.get("properties") or {}
            code = str(props.get("cntr_code", "")).strip().upper()
            if country_codes and code not in country_codes:
                continue
            properties_list.append(props)
    return properties_list


def load_geo_names(topo_path: Path, country_codes: set[str] | None = None) -> list[str]:
    names = set()
    for props in iter_topology_properties(topo_path, country_codes=country_codes):
        for key, value in props.items():
            if not isinstance(value, str) or not value.strip():
                continue
            if "name" in key.lower() or key in TOOLTIP_ADMIN_FIELDS:
                names.add(value.strip())
    return sorted(names)


def load_tooltip_admin_names(topo_path: Path, country_codes: set[str] | None = None) -> list[str]:
    names = set()
    for props in iter_topology_properties(topo_path, country_codes=country_codes):
        for key in TOOLTIP_ADMIN_FIELDS:
            value = props.get(key)
            if isinstance(value, str) and value.strip():
                names.add(value.strip())
    return sorted(names)


def load_hierarchy_geo_names(hierarchy_path: Path) -> list[str]:
    if not hierarchy_path.exists():
        return []

    try:
        with hierarchy_path.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except Exception:
        return []

    names = set()
    country_groups = data.get("country_groups") if isinstance(data, dict) else None
    if not isinstance(country_groups, dict):
        return []

    continents = country_groups.get("continents")
    if not isinstance(continents, list):
        return []

    for continent in continents:
        if not isinstance(continent, dict):
            continue
        continent_label = str(continent.get("label", "")).strip()
        if continent_label:
            names.add(continent_label)

        subregions = continent.get("subregions")
        if not isinstance(subregions, list):
            continue
        for subregion in subregions:
            if not isinstance(subregion, dict):
                continue
            subregion_label = str(subregion.get("label", "")).strip()
            if subregion_label:
                names.add(subregion_label)

    return sorted(names)


def load_scenario_localizable_strings(scenarios_root: Path) -> dict[str, list[str]]:
    display_names = set()
    metadata_names = set()
    if not scenarios_root.exists() or not scenarios_root.is_dir():
        return {
            "display_names": [],
            "metadata_names": [],
            "all_names": [],
        }

    def collect_values(entry: dict, fields: tuple[str, ...], bucket: set[str]) -> None:
        for field in fields:
            value = str(entry.get(field) or "").strip()
            if value and is_user_visible_candidate(value):
                bucket.add(value)

    for path in sorted(scenarios_root.rglob("*.json")):
        if not path.is_file():
            continue
        try:
            with path.open("r", encoding="utf-8") as file:
                data = json.load(file)
        except Exception:
            continue

        if not isinstance(data, dict):
            continue

        collect_values(data, SCENARIO_DISPLAY_FIELDS, display_names)
        collect_values(data, SCENARIO_METADATA_FIELDS, metadata_names)

        countries = data.get("countries")
        if isinstance(countries, dict):
            for entry in countries.values():
                if not isinstance(entry, dict):
                    continue
                collect_values(entry, SCENARIO_DISPLAY_FIELDS, display_names)
                collect_values(entry, SCENARIO_METADATA_FIELDS, metadata_names)

        scenarios = data.get("scenarios")
        if isinstance(scenarios, list):
            for entry in scenarios:
                if not isinstance(entry, dict):
                    continue
                collect_values(entry, SCENARIO_DISPLAY_FIELDS, display_names)
                collect_values(entry, SCENARIO_METADATA_FIELDS, metadata_names)
    return {
        "display_names": sorted(display_names),
        "metadata_names": sorted(metadata_names),
        "all_names": sorted(display_names | metadata_names),
    }


def load_scenario_geo_names(scenarios_root: Path) -> list[str]:
    return load_scenario_localizable_strings(scenarios_root)["all_names"]


def detect_visible_missing_country_codes(
    topo_path: Path,
    existing_geo: dict,
) -> set[str]:
    if not topo_path.exists():
        return set()

    with topo_path.open("r", encoding="utf-8") as file:
        data = json.load(file)

    missing_codes = set()
    geometries = []
    if isinstance(data, dict) and data.get("type") == "Topology":
        geometries = data.get("objects", {}).get("political", {}).get("geometries", []) or []
    elif isinstance(data, dict) and "features" in data:
        geometries = data.get("features", []) or []

    for geometry in geometries:
        props = geometry.get("properties") or {}
        code = str(props.get("cntr_code", "")).strip().upper()
        if not code:
            continue

        names = []
        for key, value in props.items():
            if "name" in str(key).lower() and isinstance(value, str) and value.strip():
                names.append(value.strip())
        if not names:
            continue

        for name in names:
            entry = existing_geo.get(name)
            zh_value = entry.get("zh", "") if isinstance(entry, dict) else ""
            en_value = entry.get("en", name) if isinstance(entry, dict) else name
            if is_missing_like(zh_value, en_value):
                missing_codes.add(code)
                break

    return missing_codes


def probe_machine_translation_available(timeout: float = 3.0) -> bool:
    query = urllib.parse.urlencode(
        {
            "client": "gtx",
            "sl": "en",
            "tl": "zh-CN",
            "dt": "t",
            "q": "test",
        }
    )
    url = f"https://translate.googleapis.com/translate_a/single?{query}"
    req = urllib.request.Request(url, headers={"User-Agent": "mapcreator-translate-manager/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return isinstance(payload, list) and bool(payload)
    except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
        return False


def load_existing_locales(path: Path) -> dict:
    if not path.exists():
        return {"ui": {}, "geo": {}}
    try:
        with path.open("r", encoding="utf-8") as file:
            data = json.load(file)
        ui = data.get("ui") if isinstance(data, dict) else {}
        geo = data.get("geo") if isinstance(data, dict) else {}
        return {"ui": ui or {}, "geo": geo or {}}
    except Exception:
        return {"ui": {}, "geo": {}}


def load_geo_aliases(path: Path) -> tuple[dict, dict, set[str]]:
    if not path.exists():
        return {}, {}, set()
    try:
        with path.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except Exception:
        return {}, {}, set()

    alias_to_stable = data.get("alias_to_stable_key") or {}
    entries = data.get("entries") or []
    stable_to_primary = {}
    search_only_aliases: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        stable = str(entry.get("stable_key", "")).strip()
        primary = str(entry.get("primary_name", "")).strip()
        if stable and primary:
            stable_to_primary[stable] = primary
        for raw_alias in entry.get("search_only_aliases") or []:
            alias = str(raw_alias or "").strip()
            if alias:
                search_only_aliases.add(alias)
    return alias_to_stable, stable_to_primary, search_only_aliases


def normalize_entry(key: str, value) -> dict:
    if isinstance(value, dict):
        en = str(value.get("en", key))
        zh = str(value.get("zh", key))
    else:
        en = key
        zh = str(value)
    return {"en": en, "zh": zh}


def normalize_translation_candidate(candidate: str | None, en_value: str) -> str | None:
    value = strip_placeholder_prefix(candidate or "")
    if not value:
        return None
    if value == (en_value or "").strip():
        return None
    return value


def contains_cjk(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text or ""))


def detect_translation_source_language(text: str) -> str:
    value = strip_placeholder_prefix(text or "")
    if not value:
        return "en"
    if re.fullmatch(r"[A-Za-z0-9\s\-'(),./:&+\[\]?]+", value):
        return "en"
    return "auto"


def is_usable_zh(text: str, en: str = "") -> bool:
    value = strip_placeholder_prefix(text or "")
    if is_missing_like(value, en):
        return False
    if is_corrupted_translation(value):
        return False
    return contains_cjk(value)


def load_git_head_locales(repo_root: Path) -> dict:
    try:
        payload = subprocess.check_output(
            ["git", "-C", str(repo_root), "show", "HEAD:data/locales.json"],
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        data = json.loads(payload)
        ui = data.get("ui") if isinstance(data, dict) else {}
        geo = data.get("geo") if isinstance(data, dict) else {}
        return {"ui": ui or {}, "geo": geo or {}}
    except Exception:
        return {"ui": {}, "geo": {}}


def merge_locale_snapshots(current_locales: dict, baseline_locales: dict) -> dict:
    merged = {"ui": {}, "geo": {}}
    for section in ("ui", "geo"):
        current = current_locales.get(section) or {}
        baseline = baseline_locales.get(section) or {}
        keys = set(current.keys()) | set(baseline.keys())
        section_payload = {}
        for key in keys:
            current_entry = normalize_entry(key, current.get(key, {}))
            baseline_entry = normalize_entry(key, baseline.get(key, {}))
            chosen = current_entry
            if not is_usable_zh(current_entry.get("zh", ""), current_entry.get("en", key)):
                if is_usable_zh(baseline_entry.get("zh", ""), baseline_entry.get("en", key)):
                    chosen = {
                        "en": current_entry.get("en", baseline_entry.get("en", key)),
                        "zh": strip_placeholder_prefix(baseline_entry.get("zh", "")),
                    }
            else:
                chosen = {
                    "en": current_entry.get("en", key),
                    "zh": strip_placeholder_prefix(current_entry.get("zh", "")),
                }
            section_payload[key] = chosen
        merged[section] = section_payload
    return merged


class MachineTranslator:
    def __init__(
        self,
        enabled: bool = False,
        delay_seconds: float = 0.0,
        max_requests: int | None = None,
    ):
        self.enabled = enabled
        self.delay_seconds = max(0.0, delay_seconds)
        self.max_requests = max_requests if max_requests and max_requests > 0 else None
        self.requests_made = 0
        self.cache = {}

    def translate(self, text: str) -> str | None:
        if not self.enabled:
            return None
        value = (text or "").strip()
        if not value:
            return None
        if value in self.cache:
            return self.cache[value]
        if self.max_requests is not None and self.requests_made >= self.max_requests:
            return None

        source_language = detect_translation_source_language(value)
        query = urllib.parse.urlencode(
            {
                "client": "gtx",
                "sl": source_language,
                "tl": "zh-CN",
                "dt": "t",
                "q": value,
            }
        )
        url = f"https://translate.googleapis.com/translate_a/single?{query}"
        req = urllib.request.Request(url, headers={"User-Agent": "mapcreator-translate-manager/1.0"})
        translated = None
        self.requests_made += 1
        try:
            with urllib.request.urlopen(req, timeout=8) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if isinstance(payload, list) and payload and isinstance(payload[0], list):
                translated = "".join(
                    segment[0] for segment in payload[0] if isinstance(segment, list) and segment
                ).strip()
        except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
            translated = None
        if self.delay_seconds:
            time.sleep(self.delay_seconds)
        self.cache[value] = translated
        return translated


def resolve_zh(
    key: str,
    en_value: str,
    existing: dict,
    translator: MachineTranslator,
    alias_to_stable: dict,
    stable_to_primary: dict,
    resolved_primary_zh: dict | None = None,
) -> str:
    if key in MANUAL_UI_DICT:
        return MANUAL_UI_DICT[key]

    if key in EUROPE_GEO_SEEDS:
        return EUROPE_GEO_SEEDS[key]
    if en_value in EUROPE_GEO_SEEDS:
        return EUROPE_GEO_SEEDS[en_value]

    if key in MANUAL_GEO_OVERRIDES:
        return MANUAL_GEO_OVERRIDES[key]
    if en_value in MANUAL_GEO_OVERRIDES:
        return MANUAL_GEO_OVERRIDES[en_value]

    primary_name = get_geo_primary_name(key, alias_to_stable, stable_to_primary)
    stable_key = alias_to_stable.get(key)
    if primary_name and primary_name in MANUAL_GEO_OVERRIDES and key != primary_name:
        return MANUAL_GEO_OVERRIDES[primary_name]
    existing_zh = get_existing_usable_zh(existing, key, en_value)
    if existing_zh and not should_ignore_existing_us_geo_zh(
        key=key,
        en_value=en_value,
        existing_zh=existing_zh,
        primary_name=primary_name,
        stable_key=stable_key or key,
    ):
        return existing_zh

    if resolved_primary_zh and primary_name:
        primary_zh = resolved_primary_zh.get(primary_name)
        if primary_zh and not is_missing_like(primary_zh, primary_name):
            return primary_zh

    if stable_key:
        stable_zh = get_existing_usable_zh(existing, stable_key, stable_to_primary.get(stable_key, stable_key))
        if stable_zh and not should_ignore_existing_us_geo_zh(
            key=stable_key,
            en_value=stable_to_primary.get(stable_key, stable_key),
            existing_zh=stable_zh,
            primary_name=primary_name or stable_to_primary.get(stable_key, ""),
            stable_key=stable_key,
        ):
            return stable_zh

    if primary_name:
        if primary_name in EUROPE_GEO_SEEDS:
            return EUROPE_GEO_SEEDS[primary_name]
        primary_existing_zh = get_existing_usable_zh(existing, primary_name, primary_name)
        if primary_existing_zh and not should_ignore_existing_us_geo_zh(
            key=primary_name,
            en_value=primary_name,
            existing_zh=primary_existing_zh,
            primary_name=primary_name,
            stable_key=stable_key or key,
        ):
            return primary_existing_zh

    if is_shell_fallback_name(key) or is_shell_fallback_name(en_value):
        return en_value
    if is_corrupted_source_name(key) or is_corrupted_source_name(en_value):
        return en_value

    translated = normalize_translation_candidate(translator.translate(en_value), en_value)
    if translated:
        return translated
    return en_value


def merge_ui(existing_ui: dict, discovered_ui_keys: list[str], translator: MachineTranslator) -> dict:
    normalized = {key: normalize_entry(key, value) for key, value in (existing_ui or {}).items()}
    keys = set(discovered_ui_keys) | set(normalized.keys()) | set(MANUAL_UI_DICT.keys())
    merged = {}

    for key in sorted(keys):
        existing = normalized.get(key, {"en": key, "zh": key})
        zh = resolve_zh(
            key=key,
            en_value=existing["en"],
            existing=normalized,
            translator=translator,
            alias_to_stable={},
            stable_to_primary={},
            resolved_primary_zh={},
        )
        merged[key] = {"en": existing.get("en", key), "zh": zh}
    return merged


def merge_geo(
    geo_names: list[str],
    existing_geo: dict,
    alias_to_stable: dict,
    stable_to_primary: dict,
    search_only_aliases: set[str],
    translator: MachineTranslator,
    include_stable_geo_keys: bool,
    restrict_scope: bool = False,
) -> dict:
    geo_name_set = set(geo_names)
    normalized = {key: normalize_entry(key, value) for key, value in (existing_geo or {}).items()}
    if restrict_scope:
        keys = set(geo_names)
        if include_stable_geo_keys:
            for alias in list(keys):
                stable_key = alias_to_stable.get(alias)
                if stable_key:
                    keys.add(stable_key)
        merged = dict(normalized)
    else:
        keys = set(geo_names) | set(normalized.keys()) | set(alias_to_stable.keys())
        if include_stable_geo_keys:
            keys.update(alias_to_stable.values())
        keys.difference_update(search_only_aliases)
        merged = {}

    primary_names = {
        primary_name
        for key in keys
        if (primary_name := get_geo_primary_name(key, alias_to_stable, stable_to_primary))
    }
    resolved_primary_zh = {}
    for primary_name in sorted(primary_names):
        existing_primary = normalized.get(primary_name, {"en": primary_name, "zh": primary_name})
        resolved_primary_zh[primary_name] = resolve_zh(
            key=primary_name,
            en_value=existing_primary.get("en", primary_name),
            existing=normalized,
            translator=translator,
            alias_to_stable=alias_to_stable,
            stable_to_primary=stable_to_primary,
            resolved_primary_zh={},
        )

    for key in sorted(keys):
        stable_key = alias_to_stable.get(key)
        en_value = key
        if stable_key and key != stable_key:
            en_value = key
        elif key in stable_to_primary:
            en_value = stable_to_primary[key]
        elif key in normalized:
            en_value = normalized[key].get("en", key)

        zh = resolve_zh(
            key=key,
            en_value=en_value,
            existing=normalized,
            translator=translator,
            alias_to_stable=alias_to_stable,
            stable_to_primary=stable_to_primary,
            resolved_primary_zh=resolved_primary_zh,
        )
        merged[key] = {"en": en_value, "zh": zh}
    return {
        key: merged[key]
        for key in sorted(merged.keys())
        if not should_drop_geo_entry(key, geo_name_set, alias_to_stable, stable_to_primary, search_only_aliases)
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync UI/GEO translation dictionary.")
    parser.add_argument(
        "--topology",
        type=Path,
        help="Path to topology file.",
    )
    parser.add_argument(
        "--locales",
        type=Path,
        help="Path to locales output file.",
    )
    parser.add_argument(
        "--geo-aliases",
        type=Path,
        help="Path to geo alias mapping generated by geo_key_normalizer.py.",
    )
    parser.add_argument(
        "--hierarchy",
        type=Path,
        help="Path to hierarchy file for continent/subregion labels.",
    )
    parser.add_argument(
        "--runtime-topology",
        type=Path,
        help="Optional runtime political topology path for additional geo names.",
    )
    parser.add_argument(
        "--scenarios-root",
        type=Path,
        help="Optional scenarios directory for scenario country display names.",
    )
    parser.add_argument(
        "--machine-translate",
        action="store_true",
        help="Enable fallback machine translation for missing keys.",
    )
    parser.add_argument(
        "--translator-delay-seconds",
        type=float,
        default=0.0,
        help="Optional delay between translation requests.",
    )
    parser.add_argument(
        "--max-machine-translations",
        type=int,
        default=0,
        help="Maximum number of machine translation requests per run (0 = unlimited).",
    )
    parser.add_argument(
        "--no-stable-geo-keys",
        action="store_true",
        help="Do not emit stable geo keys (id::<feature_id>) into locales.geo.",
    )
    parser.add_argument(
        "--country-codes",
        type=str,
        help="Optional comma-separated ISO2 country codes; limits geo translation updates to those countries.",
    )
    parser.add_argument(
        "--auto-country-codes",
        choices=["visible-missing"],
        help="Auto-select ISO2 country codes from the current topology.",
    )
    parser.add_argument(
        "--network-mode",
        choices=["off", "auto", "on"],
        default="on",
        help="Machine translation network policy.",
    )
    return parser.parse_args()


def resolve_default_topology(base_dir: Path) -> Path:
    candidates = [
        base_dir / "data" / "europe_topology.na_v2.json",
        base_dir / "data" / "europe_topology.na_v1.json",
        base_dir / "data" / "europe_topology.highres.json",
        base_dir / "data" / "europe_topology.json",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[-1]


def resolve_default_runtime_topology(base_dir: Path) -> Path:
    candidates = [
        base_dir / "data" / "europe_topology.runtime_political_v1.json",
        base_dir / "data" / "europe_topology.na_v2.json",
        base_dir / "data" / "europe_topology.na_v1.json",
        base_dir / "data" / "europe_topology.highres.json",
        base_dir / "data" / "europe_topology.json",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[-1]


def sync_translations(
    topology_path: Path,
    output_path: Path,
    geo_aliases_path: Path,
    hierarchy_path: Path,
    runtime_topology_path: Path | None,
    scenarios_root: Path | None,
    machine_translate: bool = False,
    translator_delay_seconds: float = 0.0,
    max_machine_translations: int = 0,
    include_stable_geo_keys: bool = True,
    country_codes: set[str] | None = None,
    auto_country_codes: str | None = None,
    network_mode: str = "off",
) -> dict:
    base_dir = Path(__file__).resolve().parents[1]
    existing = load_existing_locales(output_path)
    baseline_locales = load_git_head_locales(base_dir)
    existing = merge_locale_snapshots(existing, baseline_locales)
    resolved_country_codes = set(country_codes or set())
    if auto_country_codes == "visible-missing":
        resolved_country_codes |= detect_visible_missing_country_codes(
            topology_path,
            existing.get("geo", {}),
        )
        if runtime_topology_path and runtime_topology_path.exists():
            resolved_country_codes |= detect_visible_missing_country_codes(
                runtime_topology_path,
                existing.get("geo", {}),
            )

    machine_translate_enabled = bool(machine_translate)
    machine_translate_available = False
    if machine_translate_enabled:
        if network_mode == "off":
            machine_translate_enabled = False
        elif network_mode == "auto":
            machine_translate_available = probe_machine_translation_available()
            machine_translate_enabled = machine_translate_available
        else:
            machine_translate_available = True
    if machine_translate and network_mode == "auto" and not machine_translate_enabled:
        print("[i18n] Machine translation skipped: network/service unavailable.")

    geo_names = set(load_geo_names(topology_path, country_codes=resolved_country_codes or None))
    if runtime_topology_path and runtime_topology_path.exists():
        geo_names |= set(load_geo_names(runtime_topology_path, country_codes=resolved_country_codes or None))
    geo_names |= set(load_hierarchy_geo_names(hierarchy_path))
    if scenarios_root:
        geo_names |= set(load_scenario_geo_names(scenarios_root))
    geo_names |= set(EUROPE_GEO_SEEDS.keys())
    geo_names = sorted(geo_names)
    alias_to_stable, stable_to_primary, search_only_aliases = load_geo_aliases(geo_aliases_path)
    discovered_ui_keys = collect_ui_keys(base_dir)
    translator = MachineTranslator(
        enabled=machine_translate_enabled,
        delay_seconds=translator_delay_seconds,
        max_requests=max_machine_translations,
    )

    ui_payload = merge_ui(existing.get("ui", {}), discovered_ui_keys, translator)
    geo_payload = merge_geo(
        geo_names=geo_names,
        existing_geo=existing.get("geo", {}),
        alias_to_stable=alias_to_stable,
        stable_to_primary=stable_to_primary,
        search_only_aliases=search_only_aliases,
        translator=translator,
        include_stable_geo_keys=include_stable_geo_keys,
        restrict_scope=bool(resolved_country_codes),
    )

    payload = {"ui": ui_payload, "geo": geo_payload}

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_output_path = output_path.with_name(f"{output_path.name}.tmp")
    with temp_output_path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")
    temp_output_path.replace(output_path)

    geo_missing_like = sum(
        1
        for key, entry in geo_payload.items()
        if should_track_geo_missing_like(key, entry.get("en", ""))
        and is_missing_like(entry.get("zh", ""), entry.get("en", ""))
    )
    shell_fallback_missing_like = sum(
        1
        for key, entry in geo_payload.items()
        if is_shell_fallback_name(key)
        and is_missing_like(entry.get("zh", ""), entry.get("en", ""))
    )
    source_name_corrupted_count = sum(
        1
        for key, entry in geo_payload.items()
        if is_corrupted_source_name(key) or is_corrupted_source_name(entry.get("en", key))
    )
    geo_literal_todo_markers = sum(
        1
        for entry in geo_payload.values()
        if has_literal_todo_marker(entry.get("zh", ""))
    )
    corrupted_translation_count = (
        sum(
            1
            for entry in ui_payload.values()
            if is_corrupted_translation(entry.get("zh", ""))
        )
        + sum(
            1
            for entry in geo_payload.values()
            if is_corrupted_translation(entry.get("zh", ""))
        )
    )
    scenario_geo_name_count = (
        len(load_scenario_geo_names(scenarios_root)) if scenarios_root else 0
    )
    return {
        "ui_keys": len(ui_payload),
        "geo_keys": len(geo_payload),
        "geo_missing_like": geo_missing_like,
        "shell_fallback_missing_like": shell_fallback_missing_like,
        "geo_literal_todo_markers": geo_literal_todo_markers,
        "source_name_corrupted_count": source_name_corrupted_count,
        "scenario_geo_names": scenario_geo_name_count,
        "alias_map": len(alias_to_stable),
        "mt_requests": translator.requests_made,
        "corrupted_translation_count": corrupted_translation_count,
        "machine_translate_enabled": machine_translate_enabled,
        "machine_translate_available": machine_translate_available,
        "resolved_country_codes": sorted(resolved_country_codes),
        "output_path": str(output_path),
    }


def main() -> None:
    args = parse_args()
    base_dir = Path(__file__).resolve().parents[1]

    default_topology = resolve_default_topology(base_dir)
    default_runtime_topology = resolve_default_runtime_topology(base_dir)
    topo_path = args.topology or default_topology
    runtime_topology_path = args.runtime_topology or default_runtime_topology
    output_path = args.locales or (base_dir / "data" / "locales.json")
    geo_aliases_path = args.geo_aliases or (base_dir / "data" / "geo_aliases.json")
    hierarchy_path = args.hierarchy or (base_dir / "data" / "hierarchy.json")
    scenarios_root = args.scenarios_root or (base_dir / "data" / "scenarios")
    country_codes = parse_country_codes(args.country_codes)

    result = sync_translations(
        topology_path=topo_path,
        output_path=output_path,
        geo_aliases_path=geo_aliases_path,
        hierarchy_path=hierarchy_path,
        runtime_topology_path=runtime_topology_path,
        scenarios_root=scenarios_root,
        machine_translate=args.machine_translate,
        translator_delay_seconds=args.translator_delay_seconds,
        max_machine_translations=args.max_machine_translations,
        include_stable_geo_keys=not args.no_stable_geo_keys,
        country_codes=country_codes,
        auto_country_codes=args.auto_country_codes,
        network_mode=args.network_mode,
    )

    print(
        "OK: synced translations. "
        f"ui_keys={result['ui_keys']}, geo_keys={result['geo_keys']}, "
        f"geo_missing_like={result['geo_missing_like']}, "
        f"shell_fallback_missing_like={result['shell_fallback_missing_like']}, "
        f"todo_markers={result['geo_literal_todo_markers']}, "
        f"source_name_corrupted={result['source_name_corrupted_count']}, "
        f"corrupted_translations={result['corrupted_translation_count']}, "
        f"scenario_geo_names={result['scenario_geo_names']}, "
        f"alias_map={result['alias_map']}, mt_requests={result['mt_requests']}"
    )
    if result["resolved_country_codes"]:
        print(
            "[i18n] active country codes: "
            + ",".join(result["resolved_country_codes"])
        )
    print(f"Saved locales to: {result['output_path']}")


if __name__ == "__main__":
    main()

