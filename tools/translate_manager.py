import argparse
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
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
}

UI_CALL_RE = re.compile(r"""t\(\s*(['\"])(?P<text>.*?)\1\s*,\s*(['\"])ui\3\s*\)""")
MODAL_CALL_RE = re.compile(
    r"""\b(?:alert|confirm|prompt)\(\s*(['\"])(?P<text>.*?)\1\s*\)"""
)


def decode_js_string(text: str) -> str:
    value = text.strip()
    value = value.replace(r"\'", "'").replace(r'\"', '"')
    value = value.replace(r"\n", " ").replace(r"\r", " ").replace(r"\t", " ")
    return " ".join(value.split())


def is_todo_like(text: str, en: str = "") -> bool:
    value = (text or "").strip()
    if not value:
        return True
    if value.startswith("[TODO]"):
        return True
    return bool(en) and value == en


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


def load_geo_names(topo_path: Path) -> list[str]:
    if not topo_path.exists():
        raise FileNotFoundError(f"Missing topology file: {topo_path}")

    with topo_path.open("r", encoding="utf-8") as file:
        data = json.load(file)

    names = set()
    if isinstance(data, dict) and data.get("type") == "Topology":
        political = data.get("objects", {}).get("political")
        if political and isinstance(political, dict):
            for geom in political.get("geometries", []):
                props = geom.get("properties") or {}
                for key, value in props.items():
                    if "name" in key.lower() and isinstance(value, str) and value.strip():
                        names.add(value.strip())
    elif isinstance(data, dict) and "features" in data:
        for feat in data.get("features", []):
            props = feat.get("properties") or {}
            for key, value in props.items():
                if "name" in key.lower() and isinstance(value, str) and value.strip():
                    names.add(value.strip())
    return sorted(names)


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


def load_geo_aliases(path: Path) -> tuple[dict, dict]:
    if not path.exists():
        return {}, {}
    try:
        with path.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except Exception:
        return {}, {}

    alias_to_stable = data.get("alias_to_stable_key") or {}
    entries = data.get("entries") or []
    stable_to_primary = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        stable = str(entry.get("stable_key", "")).strip()
        primary = str(entry.get("primary_name", "")).strip()
        if stable and primary:
            stable_to_primary[stable] = primary
    return alias_to_stable, stable_to_primary


def normalize_entry(key: str, value) -> dict:
    if isinstance(value, dict):
        en = str(value.get("en", key))
        zh = str(value.get("zh", key))
    else:
        en = key
        zh = str(value)
    return {"en": en, "zh": zh}


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

        query = urllib.parse.urlencode(
            {
                "client": "gtx",
                "sl": "en",
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
) -> str:
    existing_entry = existing.get(key)
    if existing_entry and not is_todo_like(existing_entry["zh"], existing_entry["en"]):
        return existing_entry["zh"]

    if key in MANUAL_UI_DICT:
        return MANUAL_UI_DICT[key]

    if key in EUROPE_GEO_SEEDS:
        return EUROPE_GEO_SEEDS[key]

    stable_key = alias_to_stable.get(key)
    if stable_key:
        stable_entry = existing.get(stable_key)
        if stable_entry and not is_todo_like(stable_entry["zh"], stable_entry["en"]):
            return stable_entry["zh"]

    if key in stable_to_primary:
        primary_name = stable_to_primary[key]
        if primary_name in EUROPE_GEO_SEEDS:
            return EUROPE_GEO_SEEDS[primary_name]
        alias_entry = existing.get(primary_name)
        if alias_entry and not is_todo_like(alias_entry["zh"], alias_entry["en"]):
            return alias_entry["zh"]

    translated = translator.translate(en_value)
    if translated:
        return translated
    return f"[TODO] {en_value}"


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
        )
        merged[key] = {"en": existing.get("en", key), "zh": zh}
    return merged


def merge_geo(
    geo_names: list[str],
    existing_geo: dict,
    alias_to_stable: dict,
    stable_to_primary: dict,
    translator: MachineTranslator,
    include_stable_geo_keys: bool,
) -> dict:
    normalized = {key: normalize_entry(key, value) for key, value in (existing_geo or {}).items()}
    keys = set(geo_names) | set(normalized.keys()) | set(alias_to_stable.keys())
    if include_stable_geo_keys:
        keys.update(alias_to_stable.values())

    merged = {}
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
        )
        merged[key] = {"en": en_value, "zh": zh}
    return {key: merged[key] for key in sorted(merged.keys())}


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
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    base_dir = Path(__file__).resolve().parents[1]

    topo_path = args.topology or (base_dir / "data" / "europe_topology.json")
    output_path = args.locales or (base_dir / "data" / "locales.json")
    geo_aliases_path = args.geo_aliases or (base_dir / "data" / "geo_aliases.json")

    geo_names = load_geo_names(topo_path)
    existing = load_existing_locales(output_path)
    alias_to_stable, stable_to_primary = load_geo_aliases(geo_aliases_path)
    discovered_ui_keys = collect_ui_keys(base_dir)
    translator = MachineTranslator(
        enabled=args.machine_translate,
        delay_seconds=args.translator_delay_seconds,
        max_requests=args.max_machine_translations,
    )

    ui_payload = merge_ui(existing.get("ui", {}), discovered_ui_keys, translator)
    geo_payload = merge_geo(
        geo_names=geo_names,
        existing_geo=existing.get("geo", {}),
        alias_to_stable=alias_to_stable,
        stable_to_primary=stable_to_primary,
        translator=translator,
        include_stable_geo_keys=not args.no_stable_geo_keys,
    )

    payload = {"ui": ui_payload, "geo": geo_payload}

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)

    missing_geo_todo = sum(
        1 for entry in geo_payload.values() if is_todo_like(entry.get("zh", ""), entry.get("en", ""))
    )
    print(
        "OK: synced translations. "
        f"ui_keys={len(ui_payload)}, geo_keys={len(geo_payload)}, "
        f"geo_todo={missing_geo_todo}, alias_map={len(alias_to_stable)}, "
        f"mt_requests={translator.requests_made}"
    )
    print(f"Saved locales to: {output_path}")


if __name__ == "__main__":
    main()
