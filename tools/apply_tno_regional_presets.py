"""把 TNO 1962 的架空区域预设写进剧本产物。

规则在 data/scenario-rules/tno_1962.regional_presets.json：每个预设由剧本大区
（district_groups.manual.json，按 name_en 引用）或现存国家标签（可再按原国家代码筛选）
组合而成。本工具按当前产物把规则解析成地块 id，写入 countries.json 的 regional_presets，
同步中英启动包及其 .gz，并刷新 build_snapshot / manifest 指纹。

这是构建后叠加步骤：地块合并、拆分、外壳碎块并入等改写 id 之后，或 patch_tno_1962_bundle
重建 countries.json 之后，都要重跑一次（之后再跑 apply_scenario_politics 也不会冲掉，它只补政治字段）。

    python tools/apply_tno_regional_presets.py          # 写入
    python tools/apply_tno_regional_presets.py --check  # 只检查产物是否与规则一致
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.apply_scenario_politics import node_gzip, replace_bundle, snapshot_matches
from tools.refresh_political_id_raster_snapshot import refresh_snapshot

SCENARIO_ID = "tno_1962"
SCENARIO_DIR = ROOT / "data/scenarios" / SCENARIO_ID
RULES_PATH = ROOT / "data/scenario-rules/tno_1962.regional_presets.json"


def _read_json(path: Path) -> object:
    return json.loads(path.read_bytes())


def _serialize_countries(payload: dict) -> bytes:
    # 与 apply_scenario_politics 写 tno_1962 countries.json 的格式一致（单行、键排序）。
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _load_feature_index() -> tuple[dict[str, str], dict[str, str]]:
    owners_payload = _read_json(SCENARIO_DIR / "owners.by_feature.json")
    owners = owners_payload.get("owners", owners_payload)
    topology = _read_json(SCENARIO_DIR / "runtime_topology.topo.json")
    cntr_codes = {
        str(geometry["properties"].get("id")): str(geometry["properties"].get("cntr_code") or "").upper()
        for geometry in topology["objects"]["political"]["geometries"]
    }
    return {str(k): str(v).upper() for k, v in owners.items()}, cntr_codes


def resolve_presets(rules: dict, district_groups: dict, owners: dict[str, str], cntr_codes: dict[str, str]) -> dict[str, list[dict]]:
    """把规则解析成 {国家标签: [{name, ids}]}；引用不存在的大区或解析为空都直接报错。"""
    resolved: dict[str, list[dict]] = {}
    for tag, country_rule in rules["countries"].items():
        districts = district_groups.get(tag, {}).get("districts", {})
        if isinstance(districts, dict):
            districts = list(districts.values())
        district_ids = {str(d["name_en"]): list(d.get("feature_ids") or []) for d in districts}
        presets = []
        for spec in country_rule["presets"]:
            ids: set[str] = set()
            for name in spec.get("districts", []):
                if name not in district_ids:
                    raise ValueError(f"{tag} 预设「{spec['name']}」引用了不存在的剧本大区：{name}")
                ids.update(district_ids[name])
            owner_tags = {str(t).upper() for t in spec.get("owner_tags", [])}
            if owner_tags:
                allowed_codes = {str(c).upper() for c in spec.get("cntr_codes", [])}
                ids.update(
                    feature_id for feature_id, owner in owners.items()
                    if owner in owner_tags and (not allowed_codes or cntr_codes.get(feature_id) in allowed_codes)
                )
            if not ids:
                raise ValueError(f"{tag} 预设「{spec['name']}」没有解析出任何地块")
            presets.append({"name": spec["name"], "ids": sorted(ids)})
        resolved[tag] = presets
    return resolved


def apply_to_countries(countries: dict, rules: dict, resolved: dict[str, list[dict]]) -> dict:
    """返回新的 countries 负载：规则管理的预设整体替换，规则外的既有预设（如德国「吞并某某」）保留在前。"""
    updated = json.loads(json.dumps(countries))
    for tag, presets in resolved.items():
        entry = updated["countries"].get(tag)
        if entry is None:
            raise ValueError(f"countries.json 里没有 {tag}")
        managed = {preset["name"] for preset in presets}
        kept = [preset for preset in entry.get("regional_presets") or [] if preset.get("name") not in managed]
        entry["regional_presets"] = kept + presets
        if rules["countries"][tag].get("own_preset_key"):
            # 只看本国剧本预设，不继承同一 ISO 查找代码下的现代静态预设。
            entry["preset_lookup_code"] = tag
    return updated


def prepare() -> dict[Path, bytes]:
    rules = _read_json(RULES_PATH)
    district_groups = _read_json(SCENARIO_DIR / "district_groups.manual.json")["tags"]
    owners, cntr_codes = _load_feature_index()
    countries_path = SCENARIO_DIR / "countries.json"
    original = countries_path.read_bytes()
    old = json.loads(original)
    new = apply_to_countries(old, rules, resolve_presets(rules, district_groups, owners, cntr_codes))
    raw = _serialize_countries(new)
    outputs = {countries_path: raw}
    old_sha = hashlib.sha256(original).hexdigest()
    new_sha = hashlib.sha256(raw).hexdigest()
    for language in ("en", "zh"):
        path = SCENARIO_DIR / f"startup.bundle.{language}.json"
        updated = replace_bundle(path.read_bytes().decode("utf-8"), old, json.loads(raw), old_sha, new_sha).encode("utf-8")
        outputs[path] = updated
        outputs[path.with_suffix(".json.gz")] = node_gzip(updated)
    return outputs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    outputs = prepare()
    changed = {path: raw for path, raw in outputs.items() if path.read_bytes() != raw}
    current = not changed and snapshot_matches(SCENARIO_ID)
    if not args.check and not current:
        for path, raw in changed.items():
            path.write_bytes(raw)
        refresh_snapshot(SCENARIO_ID)
    print(f"{SCENARIO_ID}: {'consistent' if current else 'differs' if args.check else 'updated'}")
    return int(args.check and not current)


if __name__ == "__main__":
    raise SystemExit(main())
