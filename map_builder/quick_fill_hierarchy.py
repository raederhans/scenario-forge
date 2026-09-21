"""Geometry-free quick-fill levels, derived from authoritative IDs and pinned crosswalks."""
from __future__ import annotations
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re

ALIASES = {
    "CN": ("province", "Province"), "FR": ("region", "Region"),
    "DE": ("state", "State"), "US": ("state", "State"),
    "CA": ("province", "Province / territory"), "MX": ("state", "State"),
    "IN": ("state", "State / union territory"), "RU": ("subject", "Federal subject"),
    "PL": ("voivodeship", "Voivodeship"), "UA": ("oblast", "Oblast"),
    "JP": ("prefecture", "Prefecture"), "BR": ("state", "State"),
    "AU": ("state", "State / territory"),
}
GB_NAMES = dict(zip(
    "C D E F G H I J K L M N".split(),
    ["North East England", "North West England", "Yorkshire and the Humber", "East Midlands", "West Midlands", "East of England", "London", "South East England", "South West England", "Wales", "Scotland", "Northern Ireland"],
))


def derive_fr_department(feature_id: str) -> str | None:
    match = re.fullmatch(r"FR_ARR_([0-9AB]+)", feature_id)
    if not match:
        return None
    code = match.group(1)
    if code.startswith(("97", "98")) and len(code) >= 4:
        return code[:3]
    if re.fullmatch(r"(?:[0-9]{2}|2[AB])[0-9]+", code):
        return code[:2]
    return None


def build_quick_fill_metadata(hierarchy: dict, properties: list[dict], crosswalk: dict | None = None) -> dict:
    groups = hierarchy.get("groups", {})
    countries = {}
    by_country: dict[str, list[dict]] = defaultdict(list)
    for row in properties:
        country = str(row.get("cntr_code", "")).upper()
        if country == "UK": country = "GB"
        by_country[country].append(row)
    for country, (level_id, label) in ALIASES.items():
        if any(key.startswith(country + "_") for key in groups):
            countries[country] = {"default_level": level_id, "levels": {level_id: {"label": label, "alias": "parent"}}}
    departments: dict[str, dict] = {}
    region_by_department: dict[str, set[str]] = defaultdict(set)
    for region, members in groups.items():
        if not region.startswith("FR_"): continue
        for feature_id in members:
            department = derive_fr_department(feature_id)
            if department is None:
                raise ValueError(f"Unsupported France arrondissement ID: {feature_id}")
            region_by_department[department].add(region)
            record = departments.setdefault("FR_DEPT_" + department, {
                "label": f"Département {department}", "parent_group": region, "feature_ids": [], "complete": True,
            })
            record["feature_ids"].append(feature_id)
    if any(len(regions) != 1 for regions in region_by_department.values()):
        raise ValueError("A department belongs to multiple source regions; review the crosswalk before publishing")
    if departments:
        countries["FR"]["levels"]["department"] = {"label": "Department", "status": "complete", "groups": departments}

    # UK NUTS1 presentation stays at its current regional scale, not all of England.
    gb_groups: dict[str, dict] = {}
    for row in by_country.get("GB", []):
        feature_id = str(row.get("id", ""))
        match = re.fullmatch(r"UK([C-N])[A-Z0-9]{2}", feature_id) or re.fullmatch(r"GB_NUTS1_UK([C-N])", feature_id)
        if not match: continue
        letter = match.group(1)
        record = gb_groups.setdefault("GB_REGION_UK" + letter, {"label": GB_NAMES[letter], "feature_ids": [], "complete": True})
        record["feature_ids"].append(feature_id)
    if gb_groups:
        countries["GB"] = {"default_level": "region", "levels": {"region": {"label": "Region / constituent country", "groups": gb_groups}}}

    if crosswalk and "CN" in countries:
        rows = sorted((str(row["id"]), str(row.get("name", ""))) for row in by_country.get("CN", []))
        signature = hashlib.sha256(json.dumps(rows, ensure_ascii=True, separators=(",", ":")).encode()).hexdigest()
        if signature != crosswalk.get("input_feature_signature"):
            raise ValueError("China leaf IDs/names changed. Regenerate and review the prefecture crosswalk before publishing.")
        parent_signature = hashlib.sha256(json.dumps({k: sorted(v) for k, v in sorted(groups.items()) if k.startswith("CN_")}, ensure_ascii=True, separators=(",", ":")).encode()).hexdigest()
        if parent_signature != crosswalk.get("input_parent_signature"):
            raise ValueError("China parent membership changed. Regenerate and review the prefecture crosswalk.")
        known_ids = {feature_id for feature_id, _ in rows}
        safe_groups = {}
        blocked_parents = []
        for key, record in crosswalk.get("groups", {}).items():
            members = record.get("feature_ids", [])
            if not set(members) <= known_ids:
                raise ValueError(f"Orphan China prefecture members: {key}")
            province_id = record.get("province_id")
            if not set(members) <= set(groups.get(province_id, [])):
                raise ValueError(f"China prefecture crosses its declared province: {key}")
            if record.get("complete") is True and crosswalk.get("provinces", {}).get(province_id, {}).get("release_enabled") is True:
                safe_groups[key] = record
        for key, province in crosswalk.get("provinces", {}).items():
            if not province.get("release_enabled"): blocked_parents.append(key)
        countries["CN"]["levels"]["prefecture"] = {
            "label": "Prefecture / city", "status": "partial" if blocked_parents else "complete",
            "reference_year": 2017,
            "reference_source": crosswalk["source_url"],
            "blocked_parent_groups": sorted(blocked_parents), "groups": safe_groups,
            "unmapped_feature_ids": [row["feature_id"] for row in crosswalk.get("unresolved", [])],
        }
    # Only truly single-leaf countries receive an explicit country-fallback contract.
    # Coarse geometry never implies that a missing multi-leaf hierarchy is valid.
    for country, rows in by_country.items():
        if len(rows) == 1 and country not in countries and not any(key.startswith(country + "_") for key in groups):
            countries[country] = {"parent_available": False, "levels": {}}
    return {"version": 1, "semantics": "geographic_editing_groups_not_historical_administration", "countries": countries}


def load_crosswalk(data_dir: Path) -> dict | None:
    path = data_dir / "quick_fill/china_prefecture_crosswalk.v1.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
