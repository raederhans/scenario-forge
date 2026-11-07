"""Extract starting politics from country histories.

After split overlays, corrections, or any other countries.json changes, rerun
python tools/apply_scenario_politics.py.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import re


ALLIANCE_NAMES = {
    "allies": ("Allies", "同盟国"),
    "axis": ("Axis", "轴心国"),
    "comintern": ("Comintern", "共产国际"),
    "chinese_united_front": ("Chinese United Front", "中国统一战线"),
    "organization_of_free_nations": ("Organization of Free Nations", "自由国家组织"),
    "einheitspakt": ("Einheitspakt", "统一条约"),
    "japanese_co_prosperity_sphere": ("Greater East Asia Co-Prosperity Sphere", "大东亚共荣圈"),
    "triumvirate": ("Triumvirate", "三巨头"),
}
DATE_RE = re.compile(r"\d{4}(?:\.\d{1,2}){2,3}")
GAME_TAG_ALIASES = {
    "tno_1962": {
        "KGZ": "KYR", "TJK": "TAJ", "TKM": "TRK", "CEY": "CYL",
        "ARE": "UAE", "SIA": "THA", "TAT": "TAR", "ORN": "ORE",
        "VOK": "VOR", "WLS": "WAL", "PFC": "KMC", "MC": "MOC",
        "BOT": "BTS", "VMT": "VIC", "RAJ": "IND",
    },
}


def read_histories(directory: Path) -> dict[str, str]:
    return {path.name.split(" - ", 1)[0]: path.read_text(encoding="utf-8-sig")
            for path in sorted(directory.glob("*.txt"))}


def _parse(text: str) -> list:
    tokens = re.findall(r'"(?:\\.|[^"\\])*"|#[^\n]*|[{}=<>!]|[^\s{}=<>!"#]+', text)
    tokens = [token for token in tokens if not token.startswith("#")]
    position = 0

    def block():
        nonlocal position
        entries = []
        while position < len(tokens) and tokens[position] != "}":
            key = tokens[position].strip('"')
            position += 1
            if key == "{":
                block()
                position += 1
                continue
            if position >= len(tokens) or tokens[position] not in ("=", "<", ">", "!"):
                entries.append((key, None))
                continue
            operator = tokens[position]
            position += 1
            if tokens[position] == "=":
                operator += "="
                position += 1
            if tokens[position] == "{":
                position += 1
                value = block()
                position += 1
            else:
                value = tokens[position].strip('"')
                position += 1
            entries.append((key if operator == "=" else key + operator, value))
        return entries

    return block()


def _date(value: str) -> tuple:
    parts = tuple(map(int, value.split(".")))
    return parts + (0,) * (4 - len(parts))


def _dlc_condition(entries: list) -> bool | None:
    values = []
    for key, value in entries:
        if key.lower() == "has_dlc" and isinstance(value, str):
            values.append(False)
        elif key.lower() == "not" and isinstance(value, list):
            nested = _dlc_condition(value)
            if nested is None:
                return None
            values.append(not nested)
        else:
            return None
    return all(values)


def evaluate_histories(histories: dict[str, str], cutoff: str) -> tuple[dict, dict, dict]:
    politics = {tag: {"ruling_ideology": "", "alliance": ""} for tag in histories}
    alliances = {}
    memberships = []
    audit = {"unresolved_if_count": 0, "unmatched_members": []}

    def execute(entries, scope, previous, file_tag):
        for index, (key, value) in enumerate(entries):
            if key.lower() == "if" and isinstance(value, list):
                limit = next((v for k, v in value if k.lower() == "limit"), None)
                alternative = next((v for k, v in value if k.lower() == "else"), None)
                if alternative is None and index + 1 < len(entries) and entries[index + 1][0].lower() == "else":
                    alternative = entries[index + 1][1]
                condition = _dlc_condition(limit) if isinstance(limit, list) else None
                if condition is None:
                    audit["unresolved_if_count"] += 1
                elif condition:
                    execute([(k, v) for k, v in value if k.lower() not in ("limit", "else")], scope, previous, file_tag)
                elif alternative is not None:
                    execute(alternative, scope, previous, file_tag)
            elif key.lower() in ("limit", "else"):
                continue
            elif key == "set_politics":
                for field, ideology in value:
                    if field == "ruling_party":
                        politics.setdefault(scope, {"ruling_ideology": "", "alliance": ""})["ruling_ideology"] = ideology
            elif key in ("create_faction", "create_faction_from_template"):
                name = next(v for k, v in value if k == "name") if isinstance(value, list) else value
                alliance = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_").removeprefix("faction_template_")
                if alliance not in ALLIANCE_NAMES:
                    raise ValueError(f"Unknown alliance id: {alliance}")
                alliances[alliance] = {"leader": file_tag, "name_en": ALLIANCE_NAMES[alliance][0], "name_zh": ALLIANCE_NAMES[alliance][1]}
                politics[file_tag]["alliance"] = alliance
            elif key == "add_to_faction":
                memberships.append((scope, previous if value == "PREV" else value))
            elif isinstance(value, list) and (re.fullmatch(r"[A-Z][A-Z0-9]{2}", key) or key == "PREV"):
                execute(value, previous if key == "PREV" else key, scope, file_tag)

    for tag, text in sorted(histories.items()):
        entries = _parse(text)
        execute([(key, value) for key, value in entries if not DATE_RE.fullmatch(key)], tag, tag, tag)
        dated = [(key, value) for key, value in entries if DATE_RE.fullmatch(key)]
        for date, entries in sorted(dated, key=lambda entry: _date(entry[0])):
            if _date(date) <= _date(cutoff):
                execute(entries, tag, tag, tag)

    pending = memberships
    while pending:
        remaining = []
        for scope, member in pending:
            alliance = politics.get(scope, {}).get("alliance", "")
            if alliance:
                politics.setdefault(member, {"ruling_ideology": "", "alliance": ""})["alliance"] = alliance
            else:
                remaining.append((scope, member))
        if len(remaining) == len(pending):
            audit["unmatched_members"].extend({"scope": scope, "member": member, "reason": "scope_without_alliance"} for scope, member in remaining)
            break
        pending = remaining
    audit["memberships"] = memberships
    return politics, alliances, audit


def annotate_countries(payload: dict, histories: dict[str, str], cutoff: str, overrides: dict | None = None, *, game_tag_aliases: dict | None = None) -> tuple[dict, dict]:
    result = deepcopy(payload)
    countries = result["countries"]
    politics, alliances, audit = evaluate_histories(histories, cutoff)
    aliases = game_tag_aliases or {}
    project_tags = {game: project for project, game in aliases.items() if project in countries}
    for alliance in alliances.values():
        alliance["leader"] = project_tags.get(alliance["leader"], alliance["leader"])
    for member in audit["unmatched_members"]:
        for field in ("scope", "member"):
            member[field] = project_tags.get(member[field], member[field])
    fields = ("ruling_ideology", "alliance")
    for tag, country in countries.items():
        game_tag = aliases.get(tag, tag)
        source = f"game_history:{game_tag}" if tag in aliases else "game_history"
        for field in fields:
            value = politics.get(game_tag, {}).get(field, "")
            country[field] = value
            country[field + "_source"] = source if value else ""

    def resolve(tag, field, visiting):
        country = countries[tag]
        if country[field] or tag in visiting:
            return country[field]
        if field == "ruling_ideology" and aliases.get(tag, tag) in histories:
            return ""
        seen = visiting | {tag}
        parent = country.get("parent_owner_tag", "")
        while parent in countries and parent not in seen:
            value = resolve(parent, field, seen)
            if value:
                country[field] = value
                country[field + "_source"] = f"inherited:{parent}"
                break
            seen.add(parent)
            parent = countries[parent].get("parent_owner_tag", "")
        return country[field]

    # Manual values seed the parent chain, so their scenario-only children inherit them.
    for tag, values in (overrides or {}).items():
        if tag not in countries:
            continue
        for field, value in values.items():
            countries[tag][field] = value
            countries[tag][field + "_source"] = "manual"
    for tag in countries:
        for field in fields:
            resolve(tag, field, set())
    result["alliances"] = {}
    audit["alliance_members"] = {}
    for tag, country in countries.items():
        alliance = country["alliance"]
        if alliance:
            if alliance not in ALLIANCE_NAMES:
                raise ValueError(f"Unknown alliance id: {alliance}")
            audit["alliance_members"].setdefault(alliance, []).append(tag)
    for alliance, members in sorted(audit["alliance_members"].items()):
        result["alliances"][alliance] = {**alliances[alliance], "member_count": len(members)}
    for scope, member in audit.pop("memberships"):
        scope = project_tags.get(scope, scope)
        member = project_tags.get(member, member)
        if member not in countries:
            audit["unmatched_members"].append({"scope": scope, "member": member, "reason": "absent_from_scenario"})
    audit["empty_tags"] = sorted(tag for tag, country in countries.items() if not any(country[field] for field in fields))
    return result, audit
