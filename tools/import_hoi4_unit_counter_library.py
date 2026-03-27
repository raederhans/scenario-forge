#!/usr/bin/env python3
"""Import HOI4 unit counter icons into a project-local review library."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_HOI4_ROOT = Path(r"C:\Program Files (x86)\Steam\steamapps\common\Hearts of Iron IV")
OUTPUT_ROOT = REPO_ROOT / "data" / "unit_counter_libraries" / "hoi4"

SUBUNIT_ICONS_GFX = "interface/subuniticons.gfx"
SUBUNIT_CATEGORIES_GFX = "interface/subunitcategories.gfx"

RELEVANT_TEXTURE_PREFIXES = {
    "division_small": "gfx/interface/counters/divisions_small/",
    "division_large": "gfx/interface/counters/divisions_large/",
    "ship_small": "gfx/interface/counters/ships_small/",
}
CATEGORY_TEXTURE_PREFIXES = (
    "gfx/interface/category_",
    "gfx/interface/counters/divisions_large/",
)


PRESET_ALIAS_MAP = {
    "inf": {
        "unit_infantry_icon",
        "unit_irregular_infantry_icon",
        "unit_penal_infantry_icon",
        "unit_blackshirt_assault_battalion_icon",
        "unit_sturmtruppe_battalion_icon",
        "unit_bicycle_infantry_icon",
    },
    "mot": {
        "unit_motorized_icon",
        "unit_motorized_rocket_brigade_icon",
        "unit_mot_art_icon",
        "unit_mot_at_icon",
        "unit_mot_anti_air_icon",
        "unit_motorized_military_police_icon",
    },
    "mech": {
        "unit_mechanized_icon",
        "unit_amphibious_mechanized_icon",
    },
    "arm": {
        "unit_light_tank_icon",
        "unit_medium_tank_icon",
        "unit_heavy_armor_icon",
        "unit_modern_armor_icon",
        "unit_super_heavy_armor_icon",
        "unit_light_tank_at_icon",
        "unit_medium_tank_at_icon",
        "unit_heavy_armor_at_icon",
        "unit_modern_armor_at_icon",
        "unit_super_heavy_armor_at_icon",
        "unit_light_tank_artillery_icon",
        "unit_medium_tank_artillery_icon",
        "unit_heavy_armor_artillery_icon",
        "unit_modern_armor_artillery_icon",
        "unit_super_heavy_armor_artillery_icon",
        "unit_light_tank_antiair_icon",
        "unit_medium_tank_antiair_icon",
        "unit_heavy_armor_antiair_icon",
        "unit_modern_armor_antiair_icon",
        "unit_super_heavy_armor_antiair_icon",
        "unit_light_amphibious_tank_icon",
        "unit_medium_amphibious_tank_icon",
        "unit_heavy_amphibious_tank_icon",
        "unit_amphibious_tank_icon",
        "unit_light_flamethrower_tank_icon",
        "unit_medium_flamethrower_tank_icon",
        "unit_heavy_flamethrower_tank_icon",
        "unit_land_cruiser_icon",
        "unit_armored_car_icon",
    },
    "cav": {
        "unit_cavalry_icon",
        "unit_camelry_icon",
        "unit_elephantry_icon",
    },
    "recon": {
        "unit_recon_icon",
        "support_unit_motorized_recon_icon",
        "support_unit_armored_recon_icon",
        "support_unit_armored_car_recon_icon",
        "support_unit_airborne_armored_recon_icon",
        "unit_helicopter_recon_icon",
        "category_all_recon",
        "unit_category_recon",
    },
    "airborne": {
        "unit_paratroop_icon",
        "category_paratroopers",
    },
    "marine": {
        "unit_marine_icon",
        "unit_marine_commando_icon",
        "category_marines",
    },
    "mountain": {
        "unit_mountain_icon",
        "unit_mountain_ski_icon",
        "category_mountaineers",
        "category_rangers",
        "unit_ranger_battalion_icon",
        "support_unit_rangers_icon",
    },
    "militia": {
        "unit_militia_icon",
        "unit_integralist_militia_icon",
    },
    "art": {
        "unit_art_icon",
        "support_unit_art_icon",
        "unit_rocket_art_icon",
        "support_unit_rocket_art_icon",
        "unit_super_heavy_artillery_icon",
        "unit_self_propelled_super_heavy_artillery_icon",
        "category_artillery",
        "category_line_artillery",
        "category_rocket_artillery",
        "category_support_artillery",
    },
    "eng": {
        "unit_engineer_icon",
        "unit_assault_engineer_icon",
        "unit_armored_engineer_icon",
        "pioneers_support",
        "unit_jungle_pioneers_support_icon",
    },
    "aa": {
        "unit_anti_air_icon",
        "support_unit_anti_air_icon",
        "category_anti_air",
    },
    "at": {
        "unit_at_icon",
        "support_unit_at_icon",
        "category_anti_tank",
        "category_mobile_anti_tank",
        "category_tank_destroyers",
    },
    "log": {
        "support_unit_logistics_company_icon",
        "unit_winter_logistics_support_icon",
        "unit_long_range_patrol_support_icon",
    },
    "fighter": {
        "category_fighter",
        "category_heavy_fighter",
    },
    "bomber": {
        "category_bomber",
        "category_nav_bomber",
        "category_tac_bomber",
        "category_strat_bomber",
        "category_cas",
    },
    "air": {
        "category_army",
    },
    "transport": {
        "unit_helicopter_transport_icon",
    },
    "carrier": {
        "ship_carrier",
    },
    "destroyer": {
        "ship_destroyer",
    },
    "submarine": {
        "ship_submarine",
    },
    "naval": {
        "ship_battleship",
        "ship_battlecruiser",
        "ship_light_cruiser",
        "ship_heavy_cruiser",
        "ship_transport",
        "ship_general_support_ship",
        "ship_repair_support_ship",
    },
}

DISPLAY_LABEL_OVERRIDES = {
    "unit_at_icon": "Anti-Tank",
    "unit_anti_air_icon": "Anti-Air",
    "unit_art_icon": "Artillery",
    "unit_mot_art_icon": "Motorized Artillery",
    "unit_mot_at_icon": "Motorized Anti-Tank",
    "unit_mot_anti_air_icon": "Motorized Anti-Air",
    "unit_medium_tank_icon": "Medium Armor",
    "unit_light_tank_icon": "Light Armor",
    "unit_paratroop_icon": "Paratrooper",
    "unit_mountain_icon": "Mountain",
    "unit_heavy_armor_icon": "Heavy Armor",
    "unit_modern_armor_icon": "Modern Armor",
    "unit_super_heavy_armor_icon": "Super Heavy Armor",
    "unit_recon_icon": "Recon",
    "unit_motorized_icon": "Motorized",
    "unit_mechanized_icon": "Mechanized",
    "unit_infantry_icon": "Infantry",
    "unit_marine_icon": "Marine",
    "unit_cavalry_icon": "Cavalry",
    "support_unit_logistics_company_icon": "Logistics Company",
    "support_unit_art_icon": "Support Artillery",
    "support_unit_anti_air_icon": "Support Anti-Air",
    "support_unit_at_icon": "Support Anti-Tank",
    "support_unit_signal_company_icon": "Signal Company",
    "support_unit_maintenance_company_icon": "Maintenance Company",
    "support_unit_field_hospital_icon": "Field Hospital",
    "ship_carrier": "Carrier",
    "ship_destroyer": "Destroyer",
    "ship_submarine": "Submarine",
    "ship_battleship": "Battleship",
    "ship_battlecruiser": "Battlecruiser",
    "ship_light_cruiser": "Light Cruiser",
    "ship_heavy_cruiser": "Heavy Cruiser",
    "ship_transport": "Transport",
    "ship_general_support_ship": "Support Ship",
    "ship_repair_support_ship": "Repair Ship",
}

KEYWORD_OVERRIDES = {
    "unit_infantry_icon": ["line", "rifle", "ground"],
    "unit_motorized_icon": ["truck", "mobile", "ground"],
    "unit_mechanized_icon": ["apc", "ifv", "ground"],
    "unit_medium_tank_icon": ["armor", "tank", "ground"],
    "unit_cavalry_icon": ["horse", "mounted", "ground"],
    "unit_recon_icon": ["scout", "screen", "support"],
    "unit_paratroop_icon": ["airborne", "parachute", "special forces"],
    "unit_marine_icon": ["amphibious", "naval infantry", "special forces"],
    "unit_mountain_icon": ["alpine", "terrain", "special forces"],
    "unit_militia_icon": ["irregular", "levy", "ground"],
    "unit_art_icon": ["guns", "battery", "support"],
    "unit_engineer_icon": ["sap", "bridge", "support"],
    "unit_anti_air_icon": ["air defense", "support"],
    "unit_at_icon": ["anti-armor", "support"],
    "support_unit_logistics_company_icon": ["supply", "service", "support"],
}

TOKEN_REPLACEMENTS = {
    "aa": "AA",
    "at": "AT",
    "mot": "Motorized",
    "sp": "SP",
    "cv": "CV",
    "cas": "CAS",
    "nav": "Naval",
    "tac": "Tactical",
    "strat": "Strategic",
}


@dataclass
class SpriteRecord:
    sprite_name: str
    texture_file: str
    kind: str


@dataclass
class ManifestEntry:
    canonical_key: str
    kind: str
    sprite_names: set[str] = field(default_factory=set)
    texture_files: dict[str, str] = field(default_factory=dict)
    source_paths: dict[str, str] = field(default_factory=dict)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hoi4-root", default=str(DEFAULT_HOI4_ROOT), help="Absolute path to HOI4 root directory.")
    parser.add_argument("--output-root", default=str(OUTPUT_ROOT), help="Output directory for generated library.")
    return parser.parse_args()


def parse_sprite_records(file_path: Path, *, categories_only: bool = False) -> list[SpriteRecord]:
    content = file_path.read_text(encoding="utf-8", errors="ignore")
    block_pattern = re.compile(r"spriteType\s*=\s*{(.*?)}", re.IGNORECASE | re.DOTALL)
    name_pattern = re.compile(r'name\s*=\s*"([^"]+)"', re.IGNORECASE)
    texture_pattern = re.compile(r'texturefile\s*=\s*"([^"]+)"', re.IGNORECASE)
    records: list[SpriteRecord] = []
    for block in block_pattern.findall(content):
        name_match = name_pattern.search(block)
        texture_match = texture_pattern.search(block)
        if not name_match or not texture_match:
            continue
        sprite_name = name_match.group(1).strip()
        texture_file = texture_match.group(1).strip().replace("\\", "/")
        kind = classify_kind(texture_file, categories_only=categories_only)
        if not kind:
            continue
        records.append(SpriteRecord(sprite_name=sprite_name, texture_file=texture_file, kind=kind))
    return records


def classify_kind(texture_file: str, *, categories_only: bool = False) -> str:
    normalized = texture_file.strip().lower()
    if categories_only:
        return "category" if normalized.startswith(CATEGORY_TEXTURE_PREFIXES) else ""
    for kind, prefix in RELEVANT_TEXTURE_PREFIXES.items():
        if normalized.startswith(prefix):
            if "division_templates_small/" in normalized:
                return ""
            return kind
    return ""


def canonicalize_texture_stem(kind: str, texture_file: str) -> str:
    stem = Path(texture_file).stem.lower()
    if kind == "division_small" and stem.startswith("onmap_"):
        stem = stem[len("onmap_") :]
        if stem.endswith("_white"):
            stem = stem[: -len("_white")]
    elif kind == "ship_small" and stem.startswith("onmap_"):
        stem = stem[len("onmap_") :]
        if not stem.startswith("ship_"):
            stem = f"ship_{stem}"
    elif kind == "category":
        if stem.startswith("category_"):
            return stem
        if stem.startswith("unit_"):
            return stem
        return f"category_{stem}"
    return stem


def stable_entry_id(sprite_name: str, texture_file: str, canonical_key: str) -> str:
    digest = hashlib.sha1(f"{sprite_name}|{texture_file}".encode("utf-8")).hexdigest()[:10]
    slug = re.sub(r"[^a-z0-9]+", "-", canonical_key.lower()).strip("-")
    return f"hoi4-{slug}-{digest}"


def build_mapped_preset_ids(canonical_key: str) -> list[str]:
    return sorted(
        preset_id
        for preset_id, aliases in PRESET_ALIAS_MAP.items()
        if canonical_key in aliases
    )


def derive_domain(kind: str, canonical_key: str, mapped_preset_ids: Iterable[str]) -> str:
    mapped = set(mapped_preset_ids)
    if kind == "ship_small" or canonical_key.startswith("ship_") or mapped.intersection({"carrier", "destroyer", "submarine", "naval"}):
        return "naval"
    if mapped.intersection({"fighter", "bomber", "air", "transport"}):
        return "air"
    if canonical_key.startswith("category_") and any(token in canonical_key for token in ("fighter", "bomber", "cas", "nav")):
        return "air"
    return "ground"


def humanize_label(canonical_key: str) -> str:
    if canonical_key in DISPLAY_LABEL_OVERRIDES:
        return DISPLAY_LABEL_OVERRIDES[canonical_key]
    tokens = [part for part in canonical_key.replace("ship_", "").replace("category_", "").split("_") if part not in {"unit", "icon", "support"}]
    normalized_tokens = []
    for token in tokens:
        normalized_tokens.append(TOKEN_REPLACEMENTS.get(token, token.capitalize()))
    return " ".join(normalized_tokens) or canonical_key


def derive_keywords(canonical_key: str, label: str, sprite_names: Iterable[str]) -> list[str]:
    base_keywords = list(KEYWORD_OVERRIDES.get(canonical_key, []))
    for source in [canonical_key, label, *sprite_names]:
        base_keywords.extend(
            token
            for token in re.split(r"[^a-z0-9]+", source.lower())
            if token and token not in {"gfx", "unit", "icon", "medium", "white", "small", "large"}
        )
    seen: set[str] = set()
    deduped = []
    for keyword in base_keywords:
        if keyword in seen:
            continue
        seen.add(keyword)
        deduped.append(keyword)
    return deduped


def ensure_output_dirs(output_root: Path) -> None:
    for child in ("small", "large", "ships_small"):
        (output_root / child).mkdir(parents=True, exist_ok=True)


def convert_texture(game_root: Path, output_root: Path, kind: str, texture_file: str, *, errors: list[dict]) -> str | None:
    source_path = game_root / texture_file
    if not source_path.exists():
        errors.append({
            "kind": kind,
            "textureFile": texture_file,
            "reason": "missing_source",
        })
        return None
    output_dir_name = {
        "division_small": "small",
        "division_large": "large",
        "ship_small": "ships_small",
        "category": "large",
    }[kind]
    output_path = output_root / output_dir_name / f"{Path(texture_file).stem.lower()}.png"
    try:
        with Image.open(source_path) as image:
            image.save(output_path)
    except Exception as exc:  # noqa: BLE001
        errors.append({
            "kind": kind,
            "textureFile": texture_file,
            "reason": "conversion_failed",
            "detail": str(exc),
        })
        return None
    return output_path.relative_to(REPO_ROOT).as_posix()


def build_manifest(game_root: Path, output_root: Path) -> dict:
    ensure_output_dirs(output_root)
    entries_by_key: dict[str, ManifestEntry] = {}
    skipped: list[dict] = []
    errors: list[dict] = []

    for record in parse_sprite_records(game_root / SUBUNIT_ICONS_GFX):
        canonical_key = canonicalize_texture_stem(record.kind, record.texture_file)
        entry = entries_by_key.setdefault(canonical_key, ManifestEntry(canonical_key=canonical_key, kind=record.kind))
        entry.sprite_names.add(record.sprite_name)
        entry.texture_files[record.kind] = record.texture_file
        entry.source_paths[record.kind] = str((game_root / record.texture_file).resolve())

    for record in parse_sprite_records(game_root / SUBUNIT_CATEGORIES_GFX, categories_only=True):
        canonical_key = canonicalize_texture_stem(record.kind, record.texture_file)
        entry = entries_by_key.setdefault(canonical_key, ManifestEntry(canonical_key=canonical_key, kind=record.kind))
        entry.sprite_names.add(record.sprite_name)
        entry.texture_files.setdefault(record.kind, record.texture_file)
        entry.source_paths.setdefault(record.kind, str((game_root / record.texture_file).resolve()))

    manifest_entries = []
    for canonical_key, entry in sorted(entries_by_key.items()):
        variants = {
            "small": None,
            "large": None,
            "ship": None,
        }
        for variant_kind, texture_file in entry.texture_files.items():
            converted = convert_texture(game_root, output_root, variant_kind, texture_file, errors=errors)
            if not converted:
                continue
            if variant_kind == "division_small":
                variants["small"] = converted
            elif variant_kind == "division_large":
                variants["large"] = converted
            elif variant_kind == "ship_small":
                variants["ship"] = converted
            elif variant_kind == "category":
                variants["large"] = variants["large"] or converted

        if not any(variants.values()):
            skipped.append({
                "canonicalKey": canonical_key,
                "reason": "no_converted_variants",
                "spriteNames": sorted(entry.sprite_names),
            })
            continue

        sprite_names = sorted(entry.sprite_names)
        primary_kind = (
            "division_small" if variants["small"]
            else "division_large" if variants["large"]
            else "ship_small" if variants["ship"]
            else entry.kind
        )
        primary_texture = (
            entry.texture_files.get("division_small")
            or entry.texture_files.get("division_large")
            or entry.texture_files.get("ship_small")
            or entry.texture_files.get("category")
            or ""
        )
        primary_sprite_name = sprite_names[0]
        mapped_preset_ids = build_mapped_preset_ids(canonical_key)
        label = humanize_label(canonical_key)
        manifest_entries.append({
            "id": stable_entry_id(primary_sprite_name, primary_texture, canonical_key),
            "canonicalKey": canonical_key,
            "kind": primary_kind,
            "spriteName": primary_sprite_name,
            "spriteAliases": sprite_names[1:],
            "sourceGamePath": str((game_root / primary_texture).resolve()) if primary_texture else "",
            "sourceTextureFile": primary_texture,
            "sourceScope": "vanilla",
            "domain": derive_domain(primary_kind, canonical_key, mapped_preset_ids),
            "label": label,
            "keywords": derive_keywords(canonical_key, label, sprite_names),
            "mappedPresetIds": mapped_preset_ids,
            "variants": variants,
        })

    return {
        "version": 1,
        "libraryId": "hoi4",
        "label": "Hearts of Iron IV",
        "sourceScope": "vanilla",
        "sourceRoot": str(game_root.resolve()),
        "entryCount": len(manifest_entries),
        "entries": manifest_entries,
        "skipped": skipped,
        "errors": errors,
    }


def main() -> int:
    args = parse_args()
    game_root = Path(args.hoi4_root).expanduser().resolve()
    output_root = Path(args.output_root).expanduser().resolve()
    if not game_root.exists():
        raise SystemExit(f"HOI4 root does not exist: {game_root}")
    manifest = build_manifest(game_root, output_root)
    output_root.mkdir(parents=True, exist_ok=True)
    manifest_path = output_root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {manifest['entryCount']} entries to {manifest_path}")
    if manifest["errors"]:
        print(f"Encountered {len(manifest['errors'])} conversion errors.")
    if manifest["skipped"]:
        print(f"Skipped {len(manifest['skipped'])} entries.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
