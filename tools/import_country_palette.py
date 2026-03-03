#!/usr/bin/env python3
from __future__ import annotations

import argparse
import colorsys
import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_HOI4_ROOTS = [
    Path(r"/mnt/c/Program Files (x86)/Steam/steamapps/common/Hearts of Iron IV"),
    Path(r"C:\Program Files (x86)\Steam\steamapps\common\Hearts of Iron IV"),
]
DEFAULT_OUTPUT_DIR = Path("data")
DEFAULT_PRIMARY_TOPOLOGY = Path("data/europe_topology.json")
DEFAULT_RUNTIME_TOPOLOGY = Path("data/europe_topology.runtime_political_v1.json")
DEFAULT_LOCALISATION = Path("localisation/english/countries_l_english.yml")

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


@dataclass
class PaletteEntry:
    tag: str
    localized_name: str
    country_file_label: str
    country_file: str
    map_hex: str
    map_source: str
    ui_hex: str
    ui_source: str
    country_file_hex: str
    country_file_source: str
    dynamic: bool


@dataclass
class MatchCandidate:
    iso2: str
    match_kind: str


def normalize_text(value: str) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def clamp_channel(value: float) -> int:
    return max(0, min(255, int(round(value))))


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*[clamp_channel(x) for x in rgb])


def hsv_to_hex(h: float, s: float, v: float) -> str:
    hue = h % 1.0
    sat = max(0.0, s)
    val = max(0.0, v)
    red, green, blue = colorsys.hsv_to_rgb(hue, sat, val)
    return rgb_to_hex((red * 255, green * 255, blue * 255))


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


def find_hoi4_root(explicit_root: str | None) -> Path:
    candidates = [Path(explicit_root)] if explicit_root else []
    candidates.extend(DEFAULT_HOI4_ROOTS)
    for candidate in candidates:
        if (candidate / "common/country_tags/00_countries.txt").exists():
            return candidate
    raise SystemExit(
        "Unable to locate Hearts of Iron IV root. Pass --source-root with your installation path."
    )


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_tag_file(path: Path, dynamic: bool) -> dict[str, tuple[str, bool]]:
    entries: dict[str, tuple[str, bool]] = {}
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


def parse_localized_country_names(path: Path) -> dict[str, str]:
    localized_names: dict[str, str] = {}
    if not path.exists():
        return localized_names
    for raw_line in path.read_text(encoding="utf-8-sig", errors="ignore").splitlines():
        line = raw_line.rstrip()
        match = re.match(r'\s*([A-Z0-9]{3}):0\s+"([^"]+)"', line)
        if not match:
            continue
        tag = match.group(1).strip().upper()
        localized_names[tag] = match.group(2).strip()
    return localized_names


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


def build_palette_entries(
    root: Path,
    tag_map: dict[str, tuple[str, bool]],
    colors_txt_data: dict[str, dict[str, str]],
    localized_names: dict[str, str],
) -> dict[str, PaletteEntry]:
    entries: dict[str, PaletteEntry] = {}
    for tag, (country_file, dynamic) in sorted(tag_map.items()):
        country_path = root / "common" / country_file
        country_file_label = country_path.stem
        localized_name = localized_names.get(tag, country_file_label)

        colors_txt_entry = colors_txt_data.get(tag, {})
        country_file_hex, country_file_source = parse_country_file_color(country_path)
        ui_hex = colors_txt_entry.get("ui_hex", "")
        ui_source = colors_txt_entry.get("ui_source", "")
        map_hex = (
            colors_txt_entry.get("map_hex")
            or country_file_hex
            or ui_hex
            or ""
        )
        map_source = (
            colors_txt_entry.get("map_source")
            or country_file_source
            or ui_source
            or ""
        )

        if not map_hex:
            continue

        entries[tag] = PaletteEntry(
            tag=tag,
            localized_name=localized_name,
            country_file_label=country_file_label,
            country_file=country_file,
            map_hex=map_hex,
            map_source=map_source,
            ui_hex=ui_hex,
            ui_source=ui_source,
            country_file_hex=country_file_hex or "",
            country_file_source=country_file_source or "",
            dynamic=dynamic,
        )
    return entries


def normalize_verified_mapping(raw_mapping: dict | None) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for tag, iso2 in (raw_mapping or {}).items():
        normalized[str(tag).strip().upper()] = str(iso2).strip().upper()
    return normalized


def normalize_deny_tags(raw_deny_tags: dict | None) -> dict[str, dict[str, str]]:
    deny_tags: dict[str, dict[str, str]] = {}
    for raw_tag, raw_value in (raw_deny_tags or {}).items():
        tag = str(raw_tag).strip().upper()
        if isinstance(raw_value, str):
            payload = {
                "reason": raw_value.strip(),
            }
        elif isinstance(raw_value, dict):
            payload = {
                "reason": str(raw_value.get("reason") or "").strip(),
            }
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


def find_exact_match_candidate(
    entry: PaletteEntry,
    primary_name_to_iso2: dict[str, str],
) -> MatchCandidate | None:
    localized_match = primary_name_to_iso2.get(normalize_text(entry.localized_name))
    if localized_match:
        return MatchCandidate(iso2=localized_match, match_kind="localized_exact")

    file_label_match = primary_name_to_iso2.get(normalize_text(entry.country_file_label))
    if file_label_match:
        return MatchCandidate(iso2=file_label_match, match_kind="country_file_exact")

    return None


def resolve_mapping_state(
    entries: dict[str, PaletteEntry],
    manual: dict,
    runtime_country_codes: set[str],
    primary_name_to_iso2: dict[str, str],
) -> tuple[dict[str, dict], dict[str, dict], dict[str, dict]]:
    verified_exact = normalize_verified_mapping(manual.get("verified_exact_tag_to_iso2"))
    verified_alias = normalize_verified_mapping(manual.get("verified_alias_tag_to_iso2"))
    deny_tags = normalize_deny_tags(manual.get("deny_tags"))

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
            match_kind = exact_candidate.match_kind if exact_candidate else "manual_exact"
            mapped_payload = {
                "iso2": verified_exact[tag],
                "match_kind": match_kind,
                "decision_source": "manual_verified",
            }
        elif tag in verified_alias:
            mapped_payload = {
                "iso2": verified_alias[tag],
                "match_kind": "approved_alias",
                "decision_source": "manual_verified",
            }
        elif entry.dynamic:
            unmapped_payload = {
                "reason": "dynamic_tag_not_mapped",
            }
        elif tag in deny_tags:
            deny_payload = dict(deny_tags[tag])
            suggested_iso2 = deny_payload.get("suggested_iso2") or (exact_candidate.iso2 if exact_candidate else "")
            unmapped_payload = {
                "reason": deny_payload["reason"],
            }
            if suggested_iso2:
                unmapped_payload["suggested_iso2"] = suggested_iso2
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
            unmapped_payload = {
                "reason": "unreviewed",
            }

        if mapped_payload:
            mapped[tag] = mapped_payload
            audit_entries[tag] = {
                "localized_name": entry.localized_name,
                "country_file_label": entry.country_file_label,
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
                "map_hex": entry.map_hex,
                "ui_hex": entry.ui_hex,
                "status": "unmapped",
                "reason": unmapped_payload["reason"],
            }
            if unmapped_payload.get("suggested_iso2"):
                audit_entry["suggested_iso2"] = unmapped_payload["suggested_iso2"]
            audit_entries[tag] = audit_entry

    return mapped, unmapped, audit_entries


def build_quick_tags(entries: dict[str, PaletteEntry], manual: dict) -> list[str]:
    quick_tags: list[str] = []
    for raw_tag in manual.get("quick_tags") or []:
        tag = str(raw_tag).strip().upper()
        if tag and tag in entries and tag not in quick_tags:
            quick_tags.append(tag)
    return quick_tags


def build_palette_payload(
    palette_id: str,
    display_name: str,
    root: Path,
    entries: dict[str, PaletteEntry],
    quick_tags: list[str],
) -> dict:
    serialized_entries = {}
    for tag, entry in sorted(entries.items()):
        serialized_entries[tag] = {
            "localized_name": entry.localized_name,
            "country_file_label": entry.country_file_label,
            "country_file": entry.country_file,
            "map_hex": entry.map_hex,
            "map_source": entry.map_source,
            "ui_hex": entry.ui_hex,
            "ui_source": entry.ui_source,
            "country_file_hex": entry.country_file_hex,
            "country_file_source": entry.country_file_source,
            "dynamic": entry.dynamic,
        }
    return {
        "version": 2,
        "palette_id": palette_id,
        "display_name": display_name,
        "source_type": "game",
        "source_game": "Hearts of Iron IV",
        "source_variant": "vanilla",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "hoi4_root": str(root),
        "preferred_runtime_color_field": "map_hex",
        "preferred_color_field": "color",
        "quick_tags": quick_tags,
        "entries": serialized_entries,
    }


def build_map_payload(
    palette_id: str,
    mapped: dict[str, dict],
    unmapped: dict[str, dict],
) -> dict:
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import HOI4 country colors into project palette assets.")
    parser.add_argument("--source-root", default=None, help="HOI4 installation root. Defaults to common Steam paths.")
    parser.add_argument("--palette-id", default="hoi4_vanilla")
    parser.add_argument("--display-name", default="HOI4 Vanilla")
    parser.add_argument("--manual-map", default="data/palette-maps/hoi4_vanilla.manual.json")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--primary-topology", default=str(DEFAULT_PRIMARY_TOPOLOGY))
    parser.add_argument("--runtime-topology", default=str(DEFAULT_RUNTIME_TOPOLOGY))
    parser.add_argument(
        "--localisation-file",
        default=str(DEFAULT_LOCALISATION),
        help="Path relative to HOI4 root for English country names.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    root = find_hoi4_root(args.source_root)
    output_dir = Path(args.output_dir)
    primary_topology = Path(args.primary_topology)
    runtime_topology = Path(args.runtime_topology)
    manual_path = Path(args.manual_map)
    localisation_path = root / args.localisation_file

    if not primary_topology.exists():
        raise SystemExit(f"Primary topology not found: {primary_topology}")
    if not runtime_topology.exists():
        raise SystemExit(f"Runtime topology not found: {runtime_topology}")
    if not manual_path.exists():
        raise SystemExit(f"Manual map file not found: {manual_path}")

    manual = load_json(manual_path)
    _primary_iso2_to_name, primary_name_to_iso2 = load_primary_country_names(primary_topology)
    runtime_country_codes = load_runtime_country_codes(runtime_topology)
    localized_names = parse_localized_country_names(localisation_path)
    tag_map = parse_country_tags(root)
    colors_txt_data = parse_colors_txt(root / "common/countries/colors.txt")
    entries = build_palette_entries(root, tag_map, colors_txt_data, localized_names)
    mapped, unmapped, audit_entries = resolve_mapping_state(
        entries,
        manual,
        runtime_country_codes,
        primary_name_to_iso2,
    )
    quick_tags = build_quick_tags(entries, manual)

    palette_payload = build_palette_payload(
        args.palette_id,
        args.display_name,
        root,
        entries,
        quick_tags,
    )
    map_payload = build_map_payload(
        args.palette_id,
        mapped,
        unmapped,
    )
    audit_payload = build_audit_payload(
        args.palette_id,
        audit_entries,
        mapped,
        unmapped,
    )

    palette_path = output_dir / "palettes" / f"{args.palette_id}.palette.json"
    map_path = output_dir / "palette-maps" / f"{args.palette_id}.map.json"
    audit_path = output_dir / "palette-maps" / f"{args.palette_id}.audit.json"
    registry_path = output_dir / "palettes" / "index.json"

    dump_json(palette_path, palette_payload)
    dump_json(map_path, map_payload)
    dump_json(audit_path, audit_payload)

    registry_payload = {
        "version": 1,
        "default_palette_id": args.palette_id,
        "palettes": [
            {
                "palette_id": args.palette_id,
                "display_name": args.display_name,
                "palette_url": str(palette_path).replace("\\", "/"),
                "map_url": str(map_path).replace("\\", "/"),
            }
        ],
    }
    dump_json(registry_path, registry_payload)

    print(
        f"[Palette Import] root={root}\n"
        f"  entries={len(entries)}\n"
        f"  mapped={len(mapped)}\n"
        f"  unmapped={len(unmapped)}\n"
        f"  palette={palette_path}\n"
        f"  map={map_path}\n"
        f"  audit={audit_path}"
    )


if __name__ == "__main__":
    main()
