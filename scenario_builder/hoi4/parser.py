from __future__ import annotations

import csv
import json
import re
from pathlib import Path

from .models import (
    BookmarkRecord,
    CountryHistoryRecord,
    DefinitionEntry,
    RuntimeFeatureRecord,
    ScenarioRule,
    StateRecord,
)


TAG_RE = re.compile(r"[A-Z][A-Z0-9]{1,2}")
DATE_BLOCK_RE = re.compile(r"\b(\d{1,4}(?:\.\d{1,2}){1,3})\s*=\s*\{")


def normalize_tag(raw: object) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(raw or "").strip().upper())


def normalize_iso2(raw: object) -> str:
    return re.sub(r"[^A-Z]", "", str(raw or "").strip().upper())


def normalize_hex(raw: object) -> str:
    value = str(raw or "").strip().lower()
    return value if re.fullmatch(r"#[0-9a-f]{6}", value) else ""


def discover_hoi4_source_root(explicit_root: str | Path | None = None) -> Path:
    candidates = []
    if explicit_root:
        candidates.append(Path(explicit_root))
    candidates.extend(
        [
            Path("/mnt/c/Program Files (x86)/Steam/steamapps/common/Hearts of Iron IV"),
            Path("C:/Program Files (x86)/Steam/steamapps/common/Hearts of Iron IV"),
        ]
    )
    for candidate in candidates:
        if (candidate / "history/states").exists():
            return candidate
    raise FileNotFoundError(
        "Unable to locate Hearts of Iron IV source root. Pass --source-root explicitly."
    )


def parse_bookmark(path: Path) -> BookmarkRecord:
    text = path.read_text(encoding="utf-8-sig", errors="ignore")
    name = re.search(r'\bname\s*=\s*"([^"]+)"', text)
    desc = re.search(r'\bdesc\s*=\s*"([^"]+)"', text)
    date = re.search(r"\bdate\s*=\s*([0-9.]+)", text)
    default_country = re.search(r'\bdefault_country\s*=\s*"?(?P<tag>[A-Z0-9]{2,3})"?', text)

    featured_tags: list[str] = []
    for match in re.finditer(r'^\s*"?(?P<tag>[A-Z0-9]{2,3}|---)"?\s*=\s*\{', text, re.M):
        tag = normalize_tag(match.group("tag"))
        if tag == "---":
            break
        if tag and tag not in featured_tags:
            featured_tags.append(tag)

    return BookmarkRecord(
        name=name.group(1) if name else path.stem,
        description=desc.group(1) if desc else "",
        date=date.group(1) if date else "",
        default_country=normalize_tag(default_country.group("tag") if default_country else ""),
        featured_tags=featured_tags,
    )


def parse_country_tags(path: Path) -> dict[str, str]:
    tag_to_file: dict[str, str] = {}
    if not path.exists():
        return tag_to_file
    for line in path.read_text(encoding="utf-8-sig", errors="ignore").splitlines():
        line = line.split("#", 1)[0].strip()
        if "=" not in line:
            continue
        raw_tag, raw_file = line.split("=", 1)
        tag = normalize_tag(raw_tag)
        country_file = raw_file.strip().strip('"')
        if tag and country_file:
            tag_to_file[tag] = country_file
    return tag_to_file


def parse_country_histories(directory: Path) -> dict[str, CountryHistoryRecord]:
    records: dict[str, CountryHistoryRecord] = {}
    if not directory.exists():
        return records
    for path in sorted(directory.glob("*.txt")):
        tag = normalize_tag(path.name.split(" - ", 1)[0])
        text = path.read_text(encoding="utf-8-sig", errors="ignore")
        capital_match = re.search(r"\bcapital\s*=\s*(\d+)", text)
        capital_state_id = int(capital_match.group(1)) if capital_match else None
        records[tag] = CountryHistoryRecord(
            tag=tag,
            file_label=path.stem,
            capital_state_id=capital_state_id,
        )
    return records


def _parse_int_list(raw: str) -> list[int]:
    values: list[int] = []
    for token in re.findall(r"\d+", raw):
        try:
            values.append(int(token))
        except ValueError:
            continue
    return values


def _parse_date_key(raw: object) -> tuple[int, int, int, int] | None:
    tokens = [token for token in str(raw or "").strip().split(".") if token]
    if not tokens:
        return None
    parts: list[int] = []
    for token in tokens[:4]:
        if not token.isdigit():
            return None
        parts.append(int(token))
    while len(parts) < 4:
        parts.append(0)
    # year, month, day, hour
    year = max(parts[0], 0)
    month = min(max(parts[1], 0), 12)
    day = min(max(parts[2], 0), 31)
    hour = min(max(parts[3], 0), 24)
    return (year, month, day, hour)


def _find_matching_brace(text: str, open_index: int) -> int:
    if open_index < 0 or open_index >= len(text) or text[open_index] != "{":
        return -1
    depth = 0
    for index in range(open_index, len(text)):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
    return -1


def _extract_assignment_block(text: str, key: str) -> str:
    match = re.search(rf"\b{re.escape(key)}\s*=\s*\{{", text)
    if not match:
        return ""
    open_index = text.find("{", match.start())
    if open_index < 0:
        return ""
    close_index = _find_matching_brace(text, open_index)
    if close_index <= open_index:
        return ""
    return text[open_index + 1 : close_index]


def _strip_dated_blocks(text: str) -> str:
    stripped = text
    cursor = 0
    while True:
        match = DATE_BLOCK_RE.search(stripped, cursor)
        if not match:
            break
        open_index = stripped.find("{", match.start())
        if open_index < 0:
            break
        close_index = _find_matching_brace(stripped, open_index)
        if close_index < 0:
            break
        stripped = f"{stripped[:match.start()]} {stripped[close_index + 1:]}"
        cursor = match.start()
    return stripped


def _iter_dated_blocks(text: str) -> list[tuple[tuple[int, int, int, int], str]]:
    blocks: list[tuple[tuple[int, int, int, int], str]] = []
    cursor = 0
    while True:
        match = DATE_BLOCK_RE.search(text, cursor)
        if not match:
            break
        date_key = _parse_date_key(match.group(1))
        open_index = text.find("{", match.start())
        if date_key is None or open_index < 0:
            cursor = match.end()
            continue
        close_index = _find_matching_brace(text, open_index)
        if close_index < 0:
            break
        body = text[open_index + 1 : close_index]
        blocks.append((date_key, body))
        cursor = close_index + 1
    return blocks


def _extract_tag_assignments(text: str, key: str) -> list[str]:
    pattern = re.compile(rf"\b{re.escape(key)}\s*=\s*([A-Z0-9_]+)")
    return [normalized for normalized in (normalize_tag(match) for match in pattern.findall(text)) if normalized]


def parse_state_file(
    path: Path,
    *,
    as_of_date: tuple[int, int, int, int] | str | None = None,
) -> StateRecord | None:
    text = path.read_text(encoding="utf-8-sig", errors="ignore")
    state_id_match = re.search(r"\bid\s*=\s*(\d+)", text)
    history_block = _extract_assignment_block(text, "history")
    owner_match = re.search(r"\bowner\s*=\s*([A-Z0-9_]+)", history_block)
    controller_match = re.search(r"\bcontroller\s*=\s*([A-Z0-9_]+)", history_block)
    provinces_match = re.search(r"\bprovinces\s*=\s*\{([^}]*)\}", text, re.S)
    state_category = re.search(r"\bstate_category\s*=\s*([a-zA-Z0-9_]+)", text)
    manpower_match = re.search(r"\bmanpower\s*=\s*(\d+)", text)
    vp_blocks = re.findall(r"\bvictory_points\s*=\s*\{([^}]*)\}", text, re.S)
    victory_points: list[int] = []
    for block in vp_blocks:
        victory_points.extend(_parse_int_list(block))
    if not state_id_match or not owner_match:
        return None

    resolved_as_of = (
        _parse_date_key(as_of_date)
        if isinstance(as_of_date, str)
        else as_of_date
    )

    owner_tag = normalize_tag(owner_match.group(1))
    controller_tag = normalize_tag(controller_match.group(1) if controller_match else "") or owner_tag
    base_history = _strip_dated_blocks(history_block)
    core_tags: set[str] = set(_extract_tag_assignments(base_history, "add_core_of"))
    for removed_tag in _extract_tag_assignments(base_history, "remove_core_of"):
        core_tags.discard(removed_tag)

    if resolved_as_of is not None:
        for block_date, block_body in _iter_dated_blocks(history_block):
            if block_date > resolved_as_of:
                continue
            block_owner_match = re.search(r"\bowner\s*=\s*([A-Z0-9_]+)", block_body)
            if block_owner_match:
                owner_tag = normalize_tag(block_owner_match.group(1))
            block_controller_match = re.search(r"\bcontroller\s*=\s*([A-Z0-9_]+)", block_body)
            if block_controller_match:
                controller_tag = normalize_tag(block_controller_match.group(1)) or owner_tag
            for added_tag in _extract_tag_assignments(block_body, "add_core_of"):
                core_tags.add(added_tag)
            for removed_tag in _extract_tag_assignments(block_body, "remove_core_of"):
                core_tags.discard(removed_tag)

    controller_tag = controller_tag or owner_tag

    return StateRecord(
        state_id=int(state_id_match.group(1)),
        file_name=path.name,
        owner_tag=owner_tag,
        controller_tag=controller_tag,
        core_tags=sorted(core_tags),
        province_ids=_parse_int_list(provinces_match.group(1) if provinces_match else ""),
        state_category=state_category.group(1).strip() if state_category else "",
        manpower=int(manpower_match.group(1)) if manpower_match else None,
        victory_points=victory_points,
    )


def parse_states(
    directory: Path,
    *,
    as_of_date: tuple[int, int, int, int] | str | None = None,
) -> dict[int, StateRecord]:
    records: dict[int, StateRecord] = {}
    if not directory.exists():
        return records
    resolved_as_of = _parse_date_key(as_of_date) if isinstance(as_of_date, str) else as_of_date
    for path in sorted(directory.glob("*.txt")):
        record = parse_state_file(path, as_of_date=resolved_as_of)
        if record:
            records[record.state_id] = record
    return records


def parse_definition_csv(path: Path) -> dict[int, DefinitionEntry]:
    entries: dict[int, DefinitionEntry] = {}
    with path.open("r", encoding="utf-8-sig", errors="ignore") as handle:
        reader = csv.reader(handle, delimiter=";")
        for row in reader:
            if len(row) < 8:
                continue
            try:
                province_id = int(row[0])
                r = int(row[1])
                g = int(row[2])
                b = int(row[3])
            except ValueError:
                continue
            entries[province_id] = DefinitionEntry(
                province_id=province_id,
                r=r,
                g=g,
                b=b,
                province_type=str(row[4]).strip(),
                coastal=str(row[5]).strip().lower() == "true",
                terrain=str(row[6]).strip(),
                continent=int(row[7]) if str(row[7]).strip().isdigit() else None,
            )
    return entries


def load_runtime_features(path: Path) -> list[RuntimeFeatureRecord]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    geometries = payload.get("objects", {}).get("political", {}).get("geometries", [])
    records: list[RuntimeFeatureRecord] = []
    for geometry in geometries:
        props = geometry.get("properties", {}) or {}
        feature_id = str(props.get("id") or geometry.get("id") or "").strip()
        if not feature_id:
            continue
        country_code = normalize_iso2(props.get("cntr_code") or "")
        name = str(props.get("name") or "").strip()
        admin1_group = str(props.get("admin1_group") or "").strip()
        detail_tier = str(props.get("detail_tier") or "").strip()
        records.append(
            RuntimeFeatureRecord(
                feature_id=feature_id,
                country_code=country_code,
                name=name,
                admin1_group=admin1_group,
                detail_tier=detail_tier,
            )
        )
    return records


def load_runtime_country_names(path: Path) -> dict[str, str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    names: dict[str, str] = {}
    for geometry in payload.get("objects", {}).get("political", {}).get("geometries", []):
        props = geometry.get("properties", {}) or {}
        code = normalize_iso2(props.get("cntr_code") or "")
        name = str(props.get("name") or "").strip()
        if code and name and code not in names:
            names[code] = name
    return names


def load_hierarchy_groups(path: Path) -> tuple[dict[str, list[str]], dict[str, dict[str, str]]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    groups = payload.get("groups", {}) or {}
    country_meta = payload.get("country_groups", {}).get("country_meta", {}) or {}
    normalized_country_meta: dict[str, dict[str, str]] = {}
    for raw_code, meta in country_meta.items():
        code = normalize_iso2(raw_code)
        if not code or not isinstance(meta, dict):
            continue
        normalized_country_meta[code] = {
            "continent_id": str(meta.get("continent_id") or "").strip(),
            "continent_label": str(meta.get("continent_label") or "").strip(),
            "subregion_id": str(meta.get("subregion_id") or "").strip(),
            "subregion_label": str(meta.get("subregion_label") or "").strip(),
        }
    return (
        {
            str(group_id): [str(child).strip() for child in (children or []) if str(child).strip()]
            for group_id, children in groups.items()
            if isinstance(children, list)
        },
        normalized_country_meta,
    )


def load_palette_pack(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_palette_map(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_manual_rules(path: Path) -> list[ScenarioRule]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    rules_payload = payload.get("rules", []) if isinstance(payload, dict) else []
    rules: list[ScenarioRule] = []
    for index, raw in enumerate(rules_payload):
        if not isinstance(raw, dict):
            continue
        rule_id = str(raw.get("rule_id") or f"rule_{index + 1:03d}").strip()
        rules.append(
            ScenarioRule(
                rule_id=rule_id,
                owner_tag=normalize_tag(raw.get("owner_tag")),
                priority=int(raw.get("priority") or 0),
                quality=str(raw.get("quality") or "approx_existing_geometry").strip(),
                critical=bool(raw.get("critical")),
                notes=str(raw.get("notes") or "").strip(),
                include_country_codes=[normalize_iso2(value) for value in raw.get("include_country_codes", [])],
                include_hierarchy_group_ids=[str(value).strip() for value in raw.get("include_hierarchy_group_ids", [])],
                include_feature_ids=[str(value).strip() for value in raw.get("include_feature_ids", [])],
                exclude_country_codes=[normalize_iso2(value) for value in raw.get("exclude_country_codes", [])],
                exclude_hierarchy_group_ids=[str(value).strip() for value in raw.get("exclude_hierarchy_group_ids", [])],
                exclude_feature_ids=[str(value).strip() for value in raw.get("exclude_feature_ids", [])],
                base_iso2=normalize_iso2(raw.get("base_iso2")),
                lookup_iso2=normalize_iso2(raw.get("lookup_iso2")),
                display_name_override=str(raw.get("display_name_override") or "").strip(),
                color_hex_override=normalize_hex(raw.get("color_hex_override")),
                source_type=str(raw.get("source_type") or "hoi4_owner").strip() or "hoi4_owner",
                historical_fidelity=str(raw.get("historical_fidelity") or "vanilla").strip() or "vanilla",
            )
        )
    return sorted(rules, key=lambda item: (item.priority, item.rule_id))
