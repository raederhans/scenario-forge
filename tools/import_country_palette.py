#!/usr/bin/env python3
from __future__ import annotations

import argparse
import colorsys
import json
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_SOURCE_ROOTS = [
    Path(r"/mnt/c/Program Files (x86)/Steam/steamapps/common/Hearts of Iron IV"),
    Path(r"C:\Program Files (x86)\Steam\steamapps\common\Hearts of Iron IV"),
]
DEFAULT_OUTPUT_DIR = Path("data")
DEFAULT_PRIMARY_TOPOLOGY = Path("data/europe_topology.json")
DEFAULT_RUNTIME_TOPOLOGY = Path("data/europe_topology.runtime_political_v1.json")
DEFAULT_LOCALISATION_ROOT = Path("localisation/english")

DEFAULT_OCEAN_META = {
    "hoi4_vanilla": {
        "apply_on_autofill": False,
        "fill_color": "#aadaff",
        "source": "app_default",
    },
    "kaiserreich": {
        "apply_on_autofill": True,
        "fill_color": "#304d66",
        "source": "map/terrain/colormap_water_0.dds:average",
    },
    "tno": {
        "apply_on_autofill": True,
        "fill_color": "#2d4769",
        "source": "map/terrain/colormap_water_0.dds:average",
    },
    "red_flood": {
        "apply_on_autofill": True,
        "fill_color": "#373b42",
        "source": "map/terrain/reflection.dds:average",
    },
}

PALETTE_SORT_ORDER = {
    "hoi4_vanilla": 0,
    "kaiserreich": 1,
    "tno": 2,
    "red_flood": 3,
}

SUPPORTED_UNMAPPED_REASONS = {
    "dynamic_tag_not_mapped",
    "unsupported_runtime_country",
    "colonial_predecessor",
    "historical_union_or_predecessor",
    "split_state",
    "warlord_or_regional_tag",
    "fictional_or_alt_history",
    "ambiguous_identity",
    "unreviewed",
}

LOCALISATION_ENTRY_RE = re.compile(r'\s*([A-Z0-9]{3}(?:_[A-Za-z0-9_]+)?):0\s+"([^"]+)"')
COLOR_SPEC_RE = re.compile(
    r"""
    (?P<kind>rgb|hsv)?\s*
    \{\s*
    (?P<a>-?\d+(?:\.\d+)?)\s+
    (?P<b>-?\d+(?:\.\d+)?)\s+
    (?P<c>-?\d+(?:\.\d+)?)
    \s*\}
    """,
    re.IGNORECASE | re.VERBOSE,
)


@dataclass(frozen=True)
class PaletteEntry:
    tag: str
    localized_name: str
    name_source: str
    country_file_label: str
    country_file: str
    country_file_is_shared_template: bool
    map_hex: str
    map_source: str
    ui_hex: str
    ui_source: str
    country_file_hex: str
    country_file_source: str
    dynamic: bool


@dataclass(frozen=True)
class MatchCandidate:
    iso2: str
    match_kind: str


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def normalize_text(value: str) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def clamp_channel(value: float) -> int:
    return max(0, min(255, int(round(value))))


def rgb_to_hex(rgb: tuple[float, float, float]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*[clamp_channel(channel) for channel in rgb])


def hsv_to_hex(h: float, s: float, v: float) -> str:
    hue = h % 1.0
    sat = max(0.0, s)
    val = max(0.0, v)
    red, green, blue = colorsys.hsv_to_rgb(hue, sat, val)
    return rgb_to_hex((red * 255, green * 255, blue * 255))


def parse_color_spec(text: str) -> str | None:
    if not text:
        return None
    match = COLOR_SPEC_RE.search(text)
    if not match:
        return None
    kind = (match.group("kind") or "rgb").lower()
    a = float(match.group("a"))
    b = float(match.group("b"))
    c = float(match.group("c"))
    if kind == "hsv":
        return hsv_to_hex(a, b, c)
    return rgb_to_hex((a, b, c))


def resolve_relative_url(path: Path) -> str:
    try:
        return path.resolve().relative_to(Path.cwd().resolve()).as_posix()
    except Exception:
        return path.as_posix()


def find_source_root(explicit_root: str | None) -> Path:
    candidates = [Path(explicit_root)] if explicit_root else []
    candidates.extend(DEFAULT_SOURCE_ROOTS)
    for candidate in candidates:
        if (candidate / "common/country_tags/00_countries.txt").exists():
            return candidate
    raise SystemExit(
        "Unable to locate HOI4/mod source root. Pass --source-root with the installation or workshop path."
    )


def parse_tag_file(path: Path, dynamic: bool) -> dict[str, tuple[str, bool]]:
    entries: dict[str, tuple[str, bool]] = {}
    if not path.exists():
        return entries
    for raw_line in path.read_text(encoding="utf-8-sig", errors="ignore").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line or line.startswith("dynamic_tags"):
            continue
        match = re.match(r'([A-Z0-9]{3})\s*=\s*"([^"]+)"', line)
        if not match:
            continue
        tag = match.group(1).strip().upper()
        country_file = match.group(2).strip()
        entries[tag] = (country_file, dynamic)
    return entries


def parse_country_tags(root: Path) -> dict[str, tuple[str, bool]]:
    results: dict[str, tuple[str, bool]] = {}
    for rel_path, dynamic in [
        ("common/country_tags/00_countries.txt", False),
        ("common/country_tags/zz_dynamic_countries.txt", True),
    ]:
        results.update(parse_tag_file(root / rel_path, dynamic))
    return results


def iter_tag_blocks(text: str) -> dict[str, str]:
    blocks: dict[str, str] = {}
    current_tag: str | None = None
    current_lines: list[str] = []
    depth = 0
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if current_tag is None:
            match = re.match(r"\s*([A-Z0-9]{3})\s*=\s*\{", line)
            if not match:
                continue
            current_tag = match.group(1).strip().upper()
            current_lines = [line]
            depth = line.count("{") - line.count("}")
            if depth <= 0:
                blocks[current_tag] = "\n".join(current_lines)
                current_tag = None
            continue

        current_lines.append(line)
        depth += line.count("{") - line.count("}")
        if depth <= 0:
            blocks[current_tag] = "\n".join(current_lines)
            current_tag = None
            current_lines = []
            depth = 0
    return blocks


def parse_colors_txt(path: Path) -> dict[str, dict[str, str]]:
    text = path.read_text(encoding="utf-8-sig", errors="ignore")
    blocks = iter_tag_blocks(text)
    results: dict[str, dict[str, str]] = {}
    for tag, block in blocks.items():
        item: dict[str, str] = {}
        color_match = re.search(r"(?<!_ui)\bcolor\s*=\s*([^\n#]+)", block, re.IGNORECASE)
        ui_match = re.search(r"\bcolor_ui\s*=\s*([^\n#]+)", block, re.IGNORECASE)
        if color_match:
            parsed = parse_color_spec(color_match.group(1))
            if parsed:
                item["map_hex"] = parsed
                item["map_source"] = "colors.txt:color"
        if ui_match:
            parsed = parse_color_spec(ui_match.group(1))
            if parsed:
                item["ui_hex"] = parsed
                item["ui_source"] = "colors.txt:color_ui"
        if item:
            results[tag] = item
    return results


def parse_country_file_color(path: Path) -> tuple[str | None, str | None]:
    if not path.exists():
        return None, None
    text = path.read_text(encoding="utf-8-sig", errors="ignore")
    match = re.search(r"(?<!_ui)\bcolor\s*=\s*([^\n#]+)", text, re.IGNORECASE)
    if not match:
        return None, None
    color = parse_color_spec(match.group(1))
    if not color:
        return None, None
    return color, f"{path.name}:color"


def load_primary_country_names(path: Path) -> tuple[dict[str, str], dict[str, str]]:
    data = load_json(path)
    geometries = data.get("objects", {}).get("political", {}).get("geometries", [])
    iso2_to_name: dict[str, str] = {}
    name_to_iso2: dict[str, str] = {}
    for geometry in geometries:
        props = geometry.get("properties", {})
        iso2 = str(props.get("cntr_code") or props.get("id") or "").strip().upper()
        name = str(props.get("name") or "").strip()
        if not iso2 or not name or iso2 in iso2_to_name:
            continue
        iso2_to_name[iso2] = name
        name_to_iso2.setdefault(normalize_text(name), iso2)
    return iso2_to_name, name_to_iso2


def load_runtime_country_codes(path: Path) -> set[str]:
    data = load_json(path)
    geometries = data.get("objects", {}).get("political", {}).get("geometries", [])
    results: set[str] = set()
    for geometry in geometries:
        code = str(geometry.get("properties", {}).get("cntr_code") or "").strip().upper()
        if code:
            results.add(code)
    return results


def normalize_verified_mapping(raw_mapping: dict | None) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for tag, iso2 in (raw_mapping or {}).items():
        norm_tag = str(tag).strip().upper()
        norm_iso2 = str(iso2).strip().upper()
        if norm_tag and norm_iso2:
            normalized[norm_tag] = norm_iso2
    return normalized


def normalize_deny_tags(raw_deny_tags: dict | None) -> dict[str, dict[str, str]]:
    deny_tags: dict[str, dict[str, str]] = {}
    for raw_tag, raw_value in (raw_deny_tags or {}).items():
        tag = str(raw_tag).strip().upper()
        if isinstance(raw_value, str):
            payload = {"reason": raw_value.strip()}
        elif isinstance(raw_value, dict):
            payload = {"reason": str(raw_value.get("reason") or "").strip()}
            suggested_iso2 = str(raw_value.get("suggested_iso2") or "").strip().upper()
            if suggested_iso2:
                payload["suggested_iso2"] = suggested_iso2
        else:
            raise SystemExit(f"Invalid deny_tags entry for {tag}: expected string or object.")
        reason = payload.get("reason", "")
        if reason not in SUPPORTED_UNMAPPED_REASONS:
            raise SystemExit(f"Unsupported unmapped reason for {tag}: {reason}")
        deny_tags[tag] = payload
    return deny_tags


def normalize_display_name_overrides(raw_mapping: dict | None) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for raw_tag, raw_name in (raw_mapping or {}).items():
        tag = str(raw_tag).strip().upper()
        name = str(raw_name or "").strip()
        if tag and name:
            normalized[tag] = name
    return normalized


def normalize_suffix_priority(raw_values: list | None) -> list[str]:
    normalized: list[str] = []
    for raw_value in raw_values or []:
        value = str(raw_value or "").strip()
        if value and value not in normalized:
            normalized.append(value)
    return normalized


def build_country_file_usage(tag_map: dict[str, tuple[str, bool]]) -> Counter:
    counter: Counter = Counter()
    for country_file, _dynamic in tag_map.values():
        counter[str(country_file).strip()] += 1
    return counter


def parse_localisation_catalog(
    root: Path,
    suffix_priority: list[str],
) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    exact_names: dict[str, str] = {}
    suffix_names: dict[str, dict[str, str]] = defaultdict(dict)
    suffix_allowlist = set(suffix_priority)
    loc_root = root / DEFAULT_LOCALISATION_ROOT
    if not loc_root.exists():
        return exact_names, suffix_names

    for path in sorted(loc_root.rglob("*.yml")):
        for raw_line in path.read_text(encoding="utf-8-sig", errors="ignore").splitlines():
            match = LOCALISATION_ENTRY_RE.match(raw_line.rstrip())
            if not match:
                continue
            key = match.group(1).strip()
            value = match.group(2).strip()
            if not value:
                continue
            if "_" not in key:
                if len(key) == 3:
                    exact_names.setdefault(key.upper(), value)
                continue
            base_tag, suffix = key.split("_", 1)
            base_tag = base_tag.upper()
            if len(base_tag) != 3 or suffix not in suffix_allowlist:
                continue
            suffix_names[base_tag].setdefault(suffix, value)

    return exact_names, suffix_names


def resolve_display_name(
    tag: str,
    country_file_label: str,
    country_file_is_shared_template: bool,
    exact_names: dict[str, str],
    suffix_names: dict[str, dict[str, str]],
    display_name_overrides: dict[str, str],
    suffix_priority: list[str],
) -> tuple[str, str]:
    if tag in display_name_overrides:
        return display_name_overrides[tag], "manual_override"

    exact = str(exact_names.get(tag) or "").strip()
    if exact:
        return exact, "exact_tag_loc"

    suffix_map = suffix_names.get(tag, {})
    for suffix in suffix_priority:
        candidate = str(suffix_map.get(suffix) or "").strip()
        if candidate:
            return candidate, "ideology_loc"

    if country_file_label and not country_file_is_shared_template:
        return country_file_label, "unique_country_file"

    return tag, "tag_fallback"


def build_palette_entries(
    root: Path,
    tag_map: dict[str, tuple[str, bool]],
    colors_txt_data: dict[str, dict[str, str]],
    exact_names: dict[str, str],
    suffix_names: dict[str, dict[str, str]],
    manual: dict,
) -> dict[str, PaletteEntry]:
    display_name_overrides = normalize_display_name_overrides(manual.get("display_name_overrides"))
    suffix_priority = normalize_suffix_priority(manual.get("display_name_suffix_priority"))
    country_file_usage = build_country_file_usage(tag_map)

    entries: dict[str, PaletteEntry] = {}
    for tag, (country_file, dynamic) in sorted(tag_map.items()):
        country_path = root / "common" / country_file
        country_file_label = country_path.stem
        is_shared_template = country_file_usage[str(country_file)] > 1
        localized_name, name_source = resolve_display_name(
            tag=tag,
            country_file_label=country_file_label,
            country_file_is_shared_template=is_shared_template,
            exact_names=exact_names,
            suffix_names=suffix_names,
            display_name_overrides=display_name_overrides,
            suffix_priority=suffix_priority,
        )

        colors_txt_entry = colors_txt_data.get(tag, {})
        country_file_hex, country_file_source = parse_country_file_color(country_path)
        ui_hex = colors_txt_entry.get("ui_hex", "")
        ui_source = colors_txt_entry.get("ui_source", "")
        map_hex = colors_txt_entry.get("map_hex") or country_file_hex or ui_hex or ""
        map_source = colors_txt_entry.get("map_source") or country_file_source or ui_source or ""

        if not map_hex:
            continue

        entries[tag] = PaletteEntry(
            tag=tag,
            localized_name=localized_name,
            name_source=name_source,
            country_file_label=country_file_label,
            country_file=country_file,
            country_file_is_shared_template=is_shared_template,
            map_hex=map_hex,
            map_source=map_source,
            ui_hex=ui_hex,
            ui_source=ui_source,
            country_file_hex=country_file_hex or "",
            country_file_source=country_file_source or "",
            dynamic=dynamic,
        )
    return entries


def find_exact_match_candidate(entry: PaletteEntry, primary_name_to_iso2: dict[str, str]) -> MatchCandidate | None:
    localized_match = primary_name_to_iso2.get(normalize_text(entry.localized_name))
    if localized_match:
        return MatchCandidate(iso2=localized_match, match_kind="localized_exact")

    if not entry.country_file_is_shared_template:
        file_label_match = primary_name_to_iso2.get(normalize_text(entry.country_file_label))
        if file_label_match:
            return MatchCandidate(iso2=file_label_match, match_kind="country_file_exact")

    return None


def load_inherited_manual(manual_path: Path, manual: dict) -> dict:
    inherited_palette_id = str(manual.get("inherit_verified_from_palette_id") or "").strip()
    if not inherited_palette_id:
        return {}
    inherited_path = manual_path.with_name(f"{inherited_palette_id}.manual.json")
    if not inherited_path.exists():
        raise SystemExit(
            f"Inherited manual mapping file not found: {inherited_path} (from {manual_path.name})"
        )
    return load_json(inherited_path)


def resolve_mapping_state(
    entries: dict[str, PaletteEntry],
    manual: dict,
    manual_path: Path,
    runtime_country_codes: set[str],
    primary_name_to_iso2: dict[str, str],
) -> tuple[dict[str, dict], dict[str, dict], dict[str, dict]]:
    inherited_manual = load_inherited_manual(manual_path, manual)

    verified_exact = {}
    verified_alias = {}
    deny_tags = {}

    if manual.get("inherit_exact_verified"):
        verified_exact.update(normalize_verified_mapping(inherited_manual.get("verified_exact_tag_to_iso2")))
    if manual.get("inherit_alias_verified"):
        verified_alias.update(normalize_verified_mapping(inherited_manual.get("verified_alias_tag_to_iso2")))
    deny_tags.update(normalize_deny_tags(inherited_manual.get("deny_tags")))

    verified_exact.update(normalize_verified_mapping(manual.get("verified_exact_tag_to_iso2")))
    verified_alias.update(normalize_verified_mapping(manual.get("verified_alias_tag_to_iso2")))
    deny_tags.update(normalize_deny_tags(manual.get("deny_tags")))

    for tag in list(verified_exact):
        if tag not in entries or tag in deny_tags:
            verified_exact.pop(tag, None)
    for tag in list(verified_alias):
        if tag not in entries or tag in deny_tags:
            verified_alias.pop(tag, None)

    for tag, iso2 in {**verified_exact, **verified_alias}.items():
        if iso2 not in runtime_country_codes:
            raise SystemExit(
                f"Manual mapping {tag}->{iso2} is invalid because {iso2} is not present in runtime country codes."
            )

    mapped: dict[str, dict] = {}
    unmapped: dict[str, dict] = {}
    audit_entries: dict[str, dict] = {}

    for tag, entry in sorted(entries.items()):
        exact_candidate = find_exact_match_candidate(entry, primary_name_to_iso2)

        mapped_payload = None
        unmapped_payload = None

        if tag in verified_exact:
            mapped_payload = {
                "iso2": verified_exact[tag],
                "match_kind": exact_candidate.match_kind if exact_candidate else "manual_exact",
                "decision_source": "manual_verified",
            }
        elif tag in verified_alias:
            mapped_payload = {
                "iso2": verified_alias[tag],
                "match_kind": "approved_alias",
                "decision_source": "manual_verified",
            }
        elif entry.dynamic:
            unmapped_payload = {"reason": "dynamic_tag_not_mapped"}
        elif tag in deny_tags:
            deny_payload = dict(deny_tags[tag])
            if not deny_payload.get("suggested_iso2") and exact_candidate:
                deny_payload["suggested_iso2"] = exact_candidate.iso2
            unmapped_payload = {"reason": deny_payload["reason"]}
            if deny_payload.get("suggested_iso2"):
                unmapped_payload["suggested_iso2"] = deny_payload["suggested_iso2"]
        elif exact_candidate and exact_candidate.iso2 not in runtime_country_codes:
            unmapped_payload = {
                "reason": "unsupported_runtime_country",
                "suggested_iso2": exact_candidate.iso2,
            }
        elif exact_candidate:
            unmapped_payload = {
                "reason": "unreviewed",
                "suggested_iso2": exact_candidate.iso2,
            }
        else:
            unmapped_payload = {"reason": "unreviewed"}

        if mapped_payload:
            mapped[tag] = mapped_payload
            audit_entries[tag] = {
                "localized_name": entry.localized_name,
                "country_file_label": entry.country_file_label,
                "name_source": entry.name_source,
                "country_file_is_shared_template": entry.country_file_is_shared_template,
                "map_hex": entry.map_hex,
                "ui_hex": entry.ui_hex,
                "status": "mapped",
                "mapped_iso2": mapped_payload["iso2"],
                "match_kind": mapped_payload["match_kind"],
                "decision_source": mapped_payload["decision_source"],
            }
        else:
            unmapped[tag] = unmapped_payload
            audit_entry = {
                "localized_name": entry.localized_name,
                "country_file_label": entry.country_file_label,
                "name_source": entry.name_source,
                "country_file_is_shared_template": entry.country_file_is_shared_template,
                "map_hex": entry.map_hex,
                "ui_hex": entry.ui_hex,
                "status": "unmapped",
                "reason": unmapped_payload["reason"],
            }
            if unmapped_payload.get("suggested_iso2"):
                audit_entry["suggested_iso2"] = unmapped_payload["suggested_iso2"]
            audit_entries[tag] = audit_entry

    return mapped, unmapped, audit_entries


def apply_mapped_project_name_fallbacks(
    entries: dict[str, PaletteEntry],
    mapped: dict[str, dict],
    primary_iso2_to_name: dict[str, str],
) -> dict[str, PaletteEntry]:
    updated: dict[str, PaletteEntry] = {}
    for tag, entry in entries.items():
        mapped_iso2 = str(mapped.get(tag, {}).get("iso2") or "").strip().upper()
        if entry.name_source == "tag_fallback" and mapped_iso2 and primary_iso2_to_name.get(mapped_iso2):
            updated[tag] = replace(
                entry,
                localized_name=primary_iso2_to_name[mapped_iso2],
                name_source="mapped_project_name",
            )
        else:
            updated[tag] = entry
    return updated


def rebuild_audit_names(
    audit_entries: dict[str, dict],
    entries: dict[str, PaletteEntry],
) -> dict[str, dict]:
    refreshed: dict[str, dict] = {}
    for tag, payload in audit_entries.items():
        entry = entries[tag]
        next_payload = dict(payload)
        next_payload["localized_name"] = entry.localized_name
        next_payload["country_file_label"] = entry.country_file_label
        next_payload["name_source"] = entry.name_source
        next_payload["country_file_is_shared_template"] = entry.country_file_is_shared_template
        refreshed[tag] = next_payload
    return refreshed


def build_quick_tags(entries: dict[str, PaletteEntry], manual: dict) -> list[str]:
    quick_tags: list[str] = []
    for raw_tag in manual.get("quick_tags") or []:
        tag = str(raw_tag).strip().upper()
        if tag and tag in entries and tag not in quick_tags:
            quick_tags.append(tag)
    return quick_tags


def build_ocean_meta(palette_id: str, manual: dict) -> dict:
    default = DEFAULT_OCEAN_META.get(palette_id, DEFAULT_OCEAN_META["hoi4_vanilla"])
    manual_fill = str(manual.get("ocean_fill") or default["fill_color"]).strip().lower()
    return {
        "apply_on_autofill": bool(default["apply_on_autofill"]),
        "fill_color": manual_fill if re.fullmatch(r"#[0-9a-f]{6}", manual_fill) else default["fill_color"],
        "source": default["source"],
    }


def build_palette_payload(
    args: argparse.Namespace,
    root: Path,
    entries: dict[str, PaletteEntry],
    quick_tags: list[str],
    ocean_meta: dict,
) -> dict:
    serialized_entries = {}
    for tag, entry in sorted(entries.items()):
        serialized_entries[tag] = {
            "localized_name": entry.localized_name,
            "name_source": entry.name_source,
            "country_file_label": entry.country_file_label,
            "country_file": entry.country_file,
            "country_file_is_shared_template": entry.country_file_is_shared_template,
            "map_hex": entry.map_hex,
            "map_source": entry.map_source,
            "ui_hex": entry.ui_hex,
            "ui_source": entry.ui_source,
            "country_file_hex": entry.country_file_hex,
            "country_file_source": entry.country_file_source,
            "dynamic": entry.dynamic,
        }

    source_type = "game_mod" if str(args.source_workshop_id or "").strip() else "game"
    payload = {
        "version": 3,
        "palette_id": args.palette_id,
        "display_name": args.display_name,
        "source_type": source_type,
        "source_game": "Hearts of Iron IV",
        "source_variant": args.source_variant,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_root": str(root),
        "preferred_runtime_color_field": "map_hex",
        "preferred_color_field": "color",
        "quick_tags": quick_tags,
        "ocean": ocean_meta,
        "entries": serialized_entries,
    }
    if source_type == "game_mod":
        payload["source_workshop_id"] = str(args.source_workshop_id).strip()
    return payload


def build_map_payload(palette_id: str, mapped: dict[str, dict], unmapped: dict[str, dict]) -> dict:
    return {
        "version": 2,
        "palette_id": palette_id,
        "canonical_key_type": "iso2",
        "mapping_policy": "conservative",
        "mapped": {tag: mapped[tag] for tag in sorted(mapped)},
        "unmapped": {tag: unmapped[tag] for tag in sorted(unmapped)},
    }


def build_audit_payload(
    palette_id: str,
    audit_entries: dict[str, dict],
    mapped: dict[str, dict],
    unmapped: dict[str, dict],
) -> dict:
    return {
        "version": 1,
        "palette_id": palette_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "total_entries": len(audit_entries),
            "mapped_count": len(mapped),
            "unmapped_count": len(unmapped),
        },
        "entries": {tag: audit_entries[tag] for tag in sorted(audit_entries)},
    }


def merge_registry_entry(
    registry_path: Path,
    palette_id: str,
    display_name: str,
    palette_url: str,
    map_url: str,
    audit_url: str,
    source_type: str,
    source_workshop_id: str,
    registry_mode: str,
) -> dict:
    if registry_mode not in {"merge", "replace"}:
        raise SystemExit(f"Unsupported registry mode: {registry_mode}")

    registry_payload = {"version": 2, "default_palette_id": "hoi4_vanilla", "palettes": []}
    if registry_mode == "merge" and registry_path.exists():
        try:
            existing = load_json(registry_path)
            if isinstance(existing, dict):
                registry_payload.update(existing)
        except Exception:
            pass

    registry_payload["version"] = 2
    registry_payload["default_palette_id"] = str(
        registry_payload.get("default_palette_id") or "hoi4_vanilla"
    ).strip() or "hoi4_vanilla"

    palettes = registry_payload.get("palettes")
    if not isinstance(palettes, list):
        palettes = []
    registry_payload["palettes"] = palettes

    entry = {
        "palette_id": palette_id,
        "display_name": display_name,
        "source_type": source_type,
        "palette_url": palette_url,
        "map_url": map_url,
        "audit_url": audit_url,
    }
    if source_type == "game_mod" and source_workshop_id:
        entry["source_workshop_id"] = source_workshop_id

    replaced = False
    for index, current in enumerate(palettes):
        if str(current.get("palette_id") or "").strip() == palette_id:
            palettes[index] = entry
            replaced = True
            break
    if not replaced:
        palettes.append(entry)

    palettes.sort(
        key=lambda item: (
            PALETTE_SORT_ORDER.get(str(item.get("palette_id") or "").strip(), 999),
            item.get("display_name", ""),
        )
    )
    return registry_payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import HOI4/mod country colors into project palette assets.")
    parser.add_argument("--source-root", default=None, help="HOI4 or mod root directory.")
    parser.add_argument("--palette-id", default="hoi4_vanilla")
    parser.add_argument("--display-name", default="HOI4 Vanilla")
    parser.add_argument("--source-variant", default="vanilla")
    parser.add_argument("--source-workshop-id", default="")
    parser.add_argument("--manual-map", default="data/palette-maps/hoi4_vanilla.manual.json")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--primary-topology", default=str(DEFAULT_PRIMARY_TOPOLOGY))
    parser.add_argument("--runtime-topology", default=str(DEFAULT_RUNTIME_TOPOLOGY))
    parser.add_argument("--registry-mode", choices=["merge", "replace"], default="merge")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    root = find_source_root(args.source_root)
    output_dir = Path(args.output_dir)
    primary_topology = Path(args.primary_topology)
    runtime_topology = Path(args.runtime_topology)
    manual_path = Path(args.manual_map)

    if not primary_topology.exists():
        raise SystemExit(f"Primary topology not found: {primary_topology}")
    if not runtime_topology.exists():
        raise SystemExit(f"Runtime topology not found: {runtime_topology}")
    if not manual_path.exists():
        raise SystemExit(f"Manual map file not found: {manual_path}")

    manual = load_json(manual_path)
    primary_iso2_to_name, primary_name_to_iso2 = load_primary_country_names(primary_topology)
    runtime_country_codes = load_runtime_country_codes(runtime_topology)
    suffix_priority = normalize_suffix_priority(manual.get("display_name_suffix_priority"))
    exact_names, suffix_names = parse_localisation_catalog(root, suffix_priority)
    tag_map = parse_country_tags(root)
    colors_txt_data = parse_colors_txt(root / "common/countries/colors.txt")
    raw_entries = build_palette_entries(root, tag_map, colors_txt_data, exact_names, suffix_names, manual)
    mapped, unmapped, audit_entries = resolve_mapping_state(
        raw_entries,
        manual,
        manual_path,
        runtime_country_codes,
        primary_name_to_iso2,
    )
    entries = apply_mapped_project_name_fallbacks(raw_entries, mapped, primary_iso2_to_name)
    audit_entries = rebuild_audit_names(audit_entries, entries)
    quick_tags = build_quick_tags(entries, manual)
    ocean_meta = build_ocean_meta(args.palette_id, manual)

    palette_payload = build_palette_payload(args, root, entries, quick_tags, ocean_meta)
    map_payload = build_map_payload(args.palette_id, mapped, unmapped)
    audit_payload = build_audit_payload(args.palette_id, audit_entries, mapped, unmapped)

    palette_path = output_dir / "palettes" / f"{args.palette_id}.palette.json"
    map_path = output_dir / "palette-maps" / f"{args.palette_id}.map.json"
    audit_path = output_dir / "palette-maps" / f"{args.palette_id}.audit.json"
    registry_path = output_dir / "palettes" / "index.json"

    dump_json(palette_path, palette_payload)
    dump_json(map_path, map_payload)
    dump_json(audit_path, audit_payload)

    source_type = "game_mod" if str(args.source_workshop_id or "").strip() else "game"
    registry_payload = merge_registry_entry(
        registry_path=registry_path,
        palette_id=args.palette_id,
        display_name=args.display_name,
        palette_url=resolve_relative_url(palette_path),
        map_url=resolve_relative_url(map_path),
        audit_url=resolve_relative_url(audit_path),
        source_type=source_type,
        source_workshop_id=str(args.source_workshop_id or "").strip(),
        registry_mode=args.registry_mode,
    )
    dump_json(registry_path, registry_payload)

    print(
        f"[Palette Import] palette={args.palette_id}\n"
        f"  root={root}\n"
        f"  entries={len(entries)}\n"
        f"  mapped={len(mapped)}\n"
        f"  unmapped={len(unmapped)}\n"
        f"  quick_tags={len(quick_tags)}\n"
        f"  palette={palette_path}\n"
        f"  map={map_path}\n"
        f"  audit={audit_path}\n"
        f"  registry={registry_path}"
    )


if __name__ == "__main__":
    main()
