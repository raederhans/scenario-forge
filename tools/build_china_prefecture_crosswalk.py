#!/usr/bin/env python3
"""Conservative, reproducible prefecture candidates for the existing China leaf IDs.

Install pypinyin==0.55.0 for this optional source-preparation command. Normal map
builds consume the checked-in crosswalk and do not need a transliteration library.
No fuzzy, nearest-neighbour, or first-match assignment is permitted. Provinces
with any unresolved leaf are held back as a whole, since an unresolved leaf may
belong to any of their prefectures. This is not a claim of historical boundary fit.
"""
from __future__ import annotations
import argparse
from collections import defaultdict
import hashlib
from itertools import product
import json
from pathlib import Path
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
REFERENCE_SHA256 = "3da1a40dd9395ac8a55673a41d2308b56f3e4fe3a6e55cc93fc55fefb1fba561"
PROVINCE_BY_CODE = dict(zip(
    "11 12 13 14 15 21 22 23 31 32 33 34 35 36 37 41 42 43 44 45 46 50 51 52 53 54 61 62 63 64 65".split(),
    "Beijing Tianjin Hebei Shanxi Inner_Mongolia Liaoning Jilin Heilongjiang Shanghai Jiangsu Zhejiang Anhui Fujian Jiangxi Shandong Henan Hubei Hunan Guangdong Guangxi Hainan Chongqing Sichuan Guizhou Yunnan Tibet Shaanxi Gansu Qinghai Ningxia Xinjiang".split(),
))
DIRECT = {"省直辖县级行政区划", "自治区直辖县级行政区划"}
MUNICIPALITIES = {"11", "12", "31", "50"}


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKC", value).lower())


def aliases(name: str) -> set[str]:
    from pypinyin import Style, lazy_pinyin, pinyin
    def romanizations(value: str) -> set[str]:
        rows = pinyin(value, style=Style.NORMAL, heteronym=True)
        combinations = 1
        for row in rows:
            combinations *= len(row)
        if combinations > 4096:
            return {normalize("".join(lazy_pinyin(value)))}
        return {normalize("".join(parts)) for parts in product(*rows)}
    values = romanizations(name)
    for suffix in ("自治县", "自治旗", "县", "市", "区", "旗", "盟", "自治州", "地区"):
        if name.endswith(suffix):
            stems = romanizations(name[:-len(suffix)])
            values.update(stems)
            if suffix in ("县", "市", "区"):
                values.update(stem + ending for stem in stems for ending in ("xian", "shi", "qu"))
    # The existing importer removes every literal 'shi', not just the final suffix.
    values.update(value.replace("shi", "") for value in list(values))
    return values - {""}


def build_crosswalk(hierarchy: dict, features: list[dict], reference: list[dict]) -> dict:
    by_id = {str(p.get("id", "")): p for p in features if p.get("cntr_code") == "CN"}
    province_results = {}
    groups = {}
    unresolved = []
    for province in reference:
        prefix = str(province["code"])
        province_id = "CN_" + PROVINCE_BY_CODE[prefix]
        ids = sorted(hierarchy.get("groups", {}).get(province_id, []))
        index: dict[str, set[str]] = defaultdict(set)
        records = {}
        for city in province["children"]:
            if city["name"] not in DIRECT | {"市辖区", "县"}:
                records[city["code"]] = {"label": city["name"], "kind": "prefecture"}
                for alias in aliases(city["name"]):
                    index[alias].add(city["code"])
            for county in city.get("children", []):
                parent = county if city["name"] in DIRECT else city
                records[parent["code"]] = {"label": parent["name"], "kind": "direct_county" if city["name"] in DIRECT else "prefecture"}
                for alias in aliases(county["name"]):
                    index[alias].add(parent["code"])
        assignments = {}
        missing = []
        for feature_id in ids:
            if feature_id not in by_id:
                raise ValueError(f"Hierarchy leaf absent from authoritative topology: {feature_id}")
            name = str(by_id[feature_id].get("name", ""))
            candidates = sorted(index.get(normalize(name), set()))
            if prefix in MUNICIPALITIES:
                candidates = [prefix + "00"]
                records[candidates[0]] = {"label": province["name"], "kind": "municipality"}
            if len(candidates) != 1:
                missing.append(feature_id)
                unresolved.append({"feature_id": feature_id, "name": name, "province_id": province_id, "candidates": candidates})
                continue
            parent = candidates[0]
            key = "CN_PREF_" + parent
            assignments[feature_id] = key
            group = groups.setdefault(key, {**records[parent], "province_id": province_id, "feature_ids": [], "complete": False})
            group["feature_ids"].append(feature_id)
        complete = bool(ids) and not missing
        for key in set(assignments.values()):
            groups[key]["complete"] = complete
        province_results[province_id] = {"total": len(ids), "matched": len(assignments), "unresolved": len(missing), "release_enabled": complete}
    signature_rows = sorted((key, str(value.get("name", ""))) for key, value in by_id.items())
    return {
        "version": 1,
        "reference_year": 2017,
        "source_commit": "e01c078c68e044242bfcc4d26a970b2314b098cd",
        "source_url": "https://github.com/modood/Administrative-divisions-of-China/tree/e01c078c68e044242bfcc4d26a970b2314b098cd",
        "license": "WTFPL-2.0",
        "method": "unique_province_scoped_romanized_name; municipality_reuses_existing_province_membership",
        "release_policy": "all_existing_leaves_in_province_must_resolve; no_fuzzy_or_nearest_assignment",
        "input_parent_signature": hashlib.sha256(json.dumps({k: sorted(v) for k, v in sorted(hierarchy.get("groups", {}).items()) if k.startswith("CN_")}, ensure_ascii=True, separators=(",", ":")).encode()).hexdigest(),
        "input_feature_signature": hashlib.sha256(json.dumps(signature_rows, ensure_ascii=True, separators=(",", ":")).encode()).hexdigest(),
        "provinces": province_results,
        "groups": {key: {**value, "feature_ids": sorted(value["feature_ids"])} for key, value in sorted(groups.items())},
        "unresolved": sorted(unresolved, key=lambda row: row["feature_id"]),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    root = args.root
    reference_path = root / "data/quick_fill/reference/china-pca-2017.json"
    if hashlib.sha256(reference_path.read_bytes()).hexdigest() != REFERENCE_SHA256:
        raise SystemExit("Pinned China reference checksum mismatch; review the source before rebuilding")
    reference = json.loads(reference_path.read_text(encoding="utf-8"))
    hierarchy = json.loads((root / "data/hierarchy.json").read_text(encoding="utf-8"))
    topology = json.loads((root / "data/europe_topology.runtime_political_v1.json").read_text(encoding="utf-8"))
    features = [row.get("properties", {}) for row in topology["objects"]["political"]["geometries"]]
    output = build_crosswalk(hierarchy, features, reference)
    output["reference_sha256"] = hashlib.sha256(reference_path.read_bytes()).hexdigest()
    path = root / "data/quick_fill/china_prefecture_crosswalk.v1.json"
    path.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"provinces": output["provinces"], "unresolved": len(output["unresolved"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
