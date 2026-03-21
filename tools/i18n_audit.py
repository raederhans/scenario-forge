import argparse
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

try:
    from tools.translate_manager import (
        has_literal_todo_marker,
        is_corrupted_translation,
        is_corrupted_source_name,
        is_missing_like,
        is_shell_fallback_name,
        load_tooltip_admin_names,
        load_scenario_localizable_strings,
        should_track_geo_missing_like,
    )
except ImportError:
    from translate_manager import (
        has_literal_todo_marker,
        is_corrupted_translation,
        is_corrupted_source_name,
        is_missing_like,
        is_shell_fallback_name,
        load_tooltip_admin_names,
        load_scenario_localizable_strings,
        should_track_geo_missing_like,
    )

UI_T_CALL_RE = re.compile(r"""t\(\s*(['\"])(?P<text>.*?)\1\s*,\s*(['\"])ui\3\s*\)""")
GEO_T_CALL_RE = re.compile(r"""t\(\s*(['\"])(?P<text>.*?)\1\s*,\s*(['\"])geo\3\s*\)""")
MODAL_CALL_RE = re.compile(r"""\b(?:alert|confirm|prompt)\(\s*(['\"])(?P<text>.*?)\1\s*\)""")
UI_MAP_ENTRY_RE = re.compile(
    r"""\[\s*"[^"]+"\s*,\s*"(?P<text>(?:\\.|[^"])*)"\s*\]""",
    re.DOTALL,
)
TEXT_ASSIGN_LITERAL_RE = re.compile(
    r"""\b(?:textContent|innerText)\s*=\s*(['\"])(?P<text>(?:\\.|(?!\1).)*)\1""",
    re.DOTALL,
)
TEXT_ASSIGN_TEMPLATE_RE = re.compile(
    r"""\b(?:textContent|innerText)\s*=\s*`(?P<text>(?:\\.|[^`])*)`""",
    re.DOTALL,
)
SHOW_TOAST_LITERAL_RE = re.compile(
    r"""\bshowToast\(\s*(['\"])(?P<text>(?:\\.|(?!\1).)*)\1""",
    re.DOTALL,
)
SHOW_TOAST_TEMPLATE_RE = re.compile(
    r"""\bshowToast\(\s*`(?P<text>(?:\\.|[^`])*)`""",
    re.DOTALL,
)
SET_ATTR_LITERAL_RE = re.compile(
    r"""setAttribute\(\s*(['\"])(?P<attr>placeholder|title|aria-label)\1\s*,\s*(['\"])(?P<text>(?:\\.|(?!\3).)*)\3""",
    re.DOTALL,
)
SET_ATTR_TEMPLATE_RE = re.compile(
    r"""setAttribute\(\s*(['\"])(?P<attr>placeholder|title|aria-label)\1\s*,\s*`(?P<text>(?:\\.|[^`])*)`""",
    re.DOTALL,
)
PLACEHOLDER_HTML_RE = re.compile(r"""placeholder=(['\"])(?P<text>.*?)\1""", re.DOTALL)
ARIA_LABEL_HTML_RE = re.compile(r"""aria-label=(['\"])(?P<text>.*?)\1""", re.DOTALL)
TITLE_HTML_RE = re.compile(r"""title=(['\"])(?P<text>.*?)\1""", re.DOTALL)
INNER_HTML_TEMPLATE_RE = re.compile(
    r"""\binnerHTML\s*=\s*`(?P<text>(?:\\.|[^`])*)`""",
    re.DOTALL,
)
STRING_LITERAL_RE = re.compile(r"""(['\"])(?P<text>(?:\\.|(?!\1).)*)\1""", re.DOTALL)

DECLARATIVE_ATTR_NAMES = {
    "data-i18n",
    "data-i18n-placeholder",
    "data-i18n-title",
    "data-i18n-aria-label",
}
VISIBLE_ATTR_NAMES = {"placeholder", "title", "aria-label"}
A11Y_ATTR_NAMES = {"aria-label", "title"}
NON_TRANSLATABLE_PATTERNS = (
    re.compile(r"^\d+(?:\.\d+)?(?:px|x|ms|s|%)$", re.IGNORECASE),
    re.compile(r"^\d{1,2}:\d{2}(?:\s*(?:UTC|AM|PM))?$", re.IGNORECASE),
    re.compile(r"^[+\-]?\d+(?:\.\d+)?$"),
)
PLACEHOLDER_SAMPLE_RE = re.compile(r"^[a-z][a-z0-9_-]{2,}$")


def decode_js_string(text: str) -> str:
    value = text.strip()
    value = value.replace(r"\'", "'").replace(r'\"', '"')
    value = value.replace(r"\n", " ").replace(r"\r", " ").replace(r"\t", " ")
    return " ".join(value.split())


def is_user_visible_candidate(value: str) -> bool:
    text = (value or "").strip()
    if len(text) < 3:
        return False
    text_without_placeholders = re.sub(r"\{[A-Za-z_]+\}", "", text).strip()
    if not text_without_placeholders:
        return False
    if re.fullmatch(r"\{[A-Za-z_]+\}(?:px|x|ms|%)", text):
        return False
    if text.startswith("#"):
        return False
    if text.startswith("[") and text.endswith("]"):
        return False
    if re.fullmatch(r"[A-Z0-9_\-]+", text):
        return False
    if re.fullmatch(r"[{}()<>:=;,.\-_/\\]+", text):
        return False
    return bool(re.search(r"[A-Za-z]", text_without_placeholders))


def is_non_translatable_token(value: str, attr_name: str | None = None) -> bool:
    text = decode_js_string(value)
    if not text:
        return True
    if any(pattern.fullmatch(text) for pattern in NON_TRANSLATABLE_PATTERNS):
        return True
    if attr_name == "placeholder" and PLACEHOLDER_SAMPLE_RE.fullmatch(text):
        return True
    return False


def add_ui_candidate(bucket: set[str], value: str) -> str | None:
    normalized = decode_js_string(value)
    if normalized and is_user_visible_candidate(normalized):
        bucket.add(normalized)
        return normalized
    return None


def sanitize_template_literal(text: str, placeholder: str = "{expr}") -> str:
    result = []
    index = 0
    length = len(text)
    while index < length:
        if text[index] == "$" and index + 1 < length and text[index + 1] == "{":
            depth = 1
            index += 2
            while index < length and depth > 0:
                char = text[index]
                if char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
                index += 1
            result.append(placeholder)
            continue
        result.append(text[index])
        index += 1
    return "".join(result)


def build_dynamic_candidate(text: str) -> str:
    return decode_js_string(sanitize_template_literal(text))


def collect_dynamic_line_candidates(line: str, dynamic_ui: set[str]) -> None:
    if "t(" in line or "ui(" in line:
        return
    if not any(token in line for token in ("showToast(", "textContent", "innerText", "setAttribute(", "innerHTML")):
        return
    if "+" not in line:
        return
    literal_parts = [
        decode_js_string(match.group("text"))
        for match in STRING_LITERAL_RE.finditer(line)
    ]
    visible_parts = [part for part in literal_parts if is_user_visible_candidate(part)]
    if not visible_parts:
        return
    dynamic_ui.add(" {expr} ".join(visible_parts))


class MarkupAuditParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.text_nodes: list[str] = []
        self.visible_attrs: list[dict[str, str]] = []
        self.declarative_ui_keys: list[str] = []

    def _collect_attrs(self, attrs) -> None:
        for name, value in attrs:
            attr_name = str(name or "").strip().lower()
            attr_value = str(value or "").strip()
            if not attr_name or not attr_value:
                continue
            if attr_name in DECLARATIVE_ATTR_NAMES:
                self.declarative_ui_keys.append(attr_value)
            elif attr_name in VISIBLE_ATTR_NAMES:
                self.visible_attrs.append({"name": attr_name, "value": attr_value})

    def handle_starttag(self, _tag, attrs):
        self._collect_attrs(attrs)

    def handle_startendtag(self, _tag, attrs):
        self._collect_attrs(attrs)

    def handle_data(self, data):
        value = decode_js_string(data)
        if value:
            self.text_nodes.append(value)


def parse_markup(markup: str) -> dict:
    parser = MarkupAuditParser()
    parser.feed(markup)
    parser.close()
    return {
        "text_nodes": parser.text_nodes,
        "visible_attrs": parser.visible_attrs,
        "declarative_ui_keys": parser.declarative_ui_keys,
    }


def load_locales(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def load_topology_names(topology_path: Path) -> list[str]:
    with topology_path.open("r", encoding="utf-8") as file:
        data = json.load(file)

    names = set()
    political = data.get("objects", {}).get("political", {})
    for geom in political.get("geometries", []):
        props = geom.get("properties") or {}
        for key, value in props.items():
            if "name" in str(key).lower() and isinstance(value, str) and value.strip():
                names.add(value.strip())
    return sorted(names)

def collect_code_strings(repo_root: Path) -> dict:
    ui_t_keys = set()
    geo_t_keys = set()
    modal_keys = set()
    declarative_ui_keys = set()
    legacy_ui_map_keys = set()
    covered_default_literals = set()
    uncovered_user_visible_literals = set()
    a11y_literals = set()
    non_translatable_tokens = set()
    dynamic_ui = set()
    template_html_candidates = set()
    default_markup_literals: list[dict[str, object]] = []
    runtime_literal_candidates: list[dict[str, str | None]] = []

    source_files = sorted((repo_root / "js").rglob("*.js"))
    source_files.append(repo_root / "index.html")

    for path in source_files:
        if not path.exists():
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue

        for match in UI_T_CALL_RE.finditer(content):
            value = decode_js_string(match.group("text"))
            if value:
                ui_t_keys.add(value)

        if path.name == "i18n.js":
            for match in UI_MAP_ENTRY_RE.finditer(content):
                value = decode_js_string(match.group("text"))
                if value:
                    legacy_ui_map_keys.add(value)

        for match in GEO_T_CALL_RE.finditer(content):
            value = decode_js_string(match.group("text"))
            if value:
                geo_t_keys.add(value)

        for match in MODAL_CALL_RE.finditer(content):
            value = decode_js_string(match.group("text"))
            if value:
                modal_keys.add(value)
                runtime_literal_candidates.append({"value": value, "attr_name": None})

        for pattern in (TEXT_ASSIGN_LITERAL_RE, SHOW_TOAST_LITERAL_RE, SET_ATTR_LITERAL_RE):
            for match in pattern.finditer(content):
                runtime_literal_candidates.append({
                    "value": match.group("text"),
                    "attr_name": match.groupdict().get("attr"),
                })

        for pattern in (TEXT_ASSIGN_TEMPLATE_RE, SHOW_TOAST_TEMPLATE_RE, SET_ATTR_TEMPLATE_RE):
            for match in pattern.finditer(content):
                raw_template = match.group("text")
                if "t(" in raw_template or "ui(" in raw_template:
                    continue
                candidate = build_dynamic_candidate(raw_template)
                if "${" in raw_template:
                    add_ui_candidate(dynamic_ui, candidate)
                else:
                    runtime_literal_candidates.append({
                        "value": candidate,
                        "attr_name": match.groupdict().get("attr"),
                    })

        for match in INNER_HTML_TEMPLATE_RE.finditer(content):
            raw_markup = match.group("text")
            parsed = parse_markup(sanitize_template_literal(raw_markup))
            for key in parsed["declarative_ui_keys"]:
                add_ui_candidate(declarative_ui_keys, key)
            for value in parsed["text_nodes"]:
                default_markup_literals.append({
                    "value": value,
                    "attr_name": None,
                    "from_template": True,
                })
            for attr in parsed["visible_attrs"]:
                default_markup_literals.append({
                    "value": attr["value"],
                    "attr_name": attr["name"],
                    "from_template": True,
                })

        if path.suffix.lower() == ".html":
            parsed = parse_markup(content)
            for key in parsed["declarative_ui_keys"]:
                add_ui_candidate(declarative_ui_keys, key)
            for value in parsed["text_nodes"]:
                default_markup_literals.append({
                    "value": value,
                    "attr_name": None,
                    "from_template": False,
                })
            for attr in parsed["visible_attrs"]:
                default_markup_literals.append({
                    "value": attr["value"],
                    "attr_name": attr["name"],
                    "from_template": False,
                })

        for line in content.splitlines():
            collect_dynamic_line_candidates(line, dynamic_ui)

    translation_keys = ui_t_keys | declarative_ui_keys | legacy_ui_map_keys

    def classify_default_literal(value: str, attr_name: str | None, from_template: bool) -> None:
        normalized = decode_js_string(value)
        if not normalized or not is_user_visible_candidate(normalized):
            return
        if is_non_translatable_token(normalized, attr_name):
            non_translatable_tokens.add(normalized)
            return
        if normalized in translation_keys:
            covered_default_literals.add(normalized)
            return
        if attr_name in A11Y_ATTR_NAMES:
            a11y_literals.add(normalized)
        else:
            uncovered_user_visible_literals.add(normalized)
        if from_template:
            template_html_candidates.add(normalized)

    def classify_runtime_literal(value: str, attr_name: str | None) -> None:
        normalized = decode_js_string(value)
        if not normalized or not is_user_visible_candidate(normalized):
            return
        if is_non_translatable_token(normalized, attr_name):
            non_translatable_tokens.add(normalized)
            return
        if attr_name in A11Y_ATTR_NAMES:
            a11y_literals.add(normalized)
            return
        uncovered_user_visible_literals.add(normalized)

    for entry in default_markup_literals:
        classify_default_literal(
            str(entry["value"]),
            entry["attr_name"],
            bool(entry["from_template"]),
        )
    for entry in runtime_literal_candidates:
        classify_runtime_literal(str(entry["value"]), entry["attr_name"])

    sorted_ui_t_keys = sorted(ui_t_keys)

    return {
        "ui_t_keys": sorted_ui_t_keys,
        "geo_t_keys": sorted(geo_t_keys),
        "modal_keys": sorted(modal_keys),
        "declarative_ui_keys": sorted(declarative_ui_keys),
        "legacy_ui_map_keys": sorted(legacy_ui_map_keys),
        "literal_translated_ui_keys": sorted_ui_t_keys,
        "covered_default_literals": sorted(covered_default_literals),
        "uncovered_user_visible_literals": sorted(uncovered_user_visible_literals),
        "a11y_literals": sorted(a11y_literals),
        "non_translatable_tokens": sorted(non_translatable_tokens),
        "dynamic_ui_candidates": sorted(dynamic_ui),
        "template_html_candidates": sorted(template_html_candidates),
    }


def render_markdown(report: dict) -> str:
    lines = []
    lines.append("# Translation Coverage Report")
    lines.append("")
    lines.append(f"Generated at: {report['generated_at']}")
    lines.append("")

    lines.append("## Summary")
    lines.append(f"- UI locale keys: {report['ui_locale_count']}")
    lines.append(f"- UI keys used via t(..., \"ui\"), data-i18n*, or legacy uiMap: {report['ui_used_count']}")
    lines.append(f"- Literal translated UI keys via t(..., \"ui\"): {report['literal_translated_ui_count']}")
    lines.append(f"- Declarative UI keys via data-i18n*: {report['declarative_ui_key_count']}")
    lines.append(f"- Legacy uiMap keys: {report['legacy_ui_map_key_count']}")
    lines.append(f"- Missing UI locale keys: {report['ui_missing_count']}")
    lines.append(f"- Covered default literals: {report['covered_default_literal_count']}")
    lines.append(f"- Uncovered user-visible literals: {report['uncovered_user_visible_count']}")
    lines.append(f"- A11y literals requiring translation wiring: {report['a11y_literal_count']}")
    lines.append(f"- Non-translatable tokens: {report['non_translatable_token_count']}")
    lines.append(f"- Dynamic UI string candidates: {report['dynamic_ui_count']}")
    lines.append(f"- Template HTML candidates: {report['template_html_count']}")
    lines.append(f"- GEO locale keys: {report['geo_locale_count']}")
    lines.append(f"- GEO missing-like entries: {report['geo_missing_like_count']}")
    lines.append(f"- Shell fallback GEO entries: {report['shell_fallback_geo_count']}")
    lines.append(f"- Shell fallback missing-like entries: {report['shell_fallback_missing_like_count']}")
    lines.append(f"- Literal TODO markers: {report['geo_todo_marker_count']}")
    lines.append(f"- Corrupted translations: {report['corrupted_translation_count']}")
    lines.append(f"- Corrupted source names: {report['source_name_corrupted_count']}")
    lines.append(
        "- Topology-derived geo names: "
        f"{report['topology_geo_name_count']} "
        f"(primary={report['primary_topology_geo_name_count']}, runtime={report['runtime_topology_geo_name_count']})"
    )
    lines.append(f"- Topology names missing in locales.geo: {report['topology_geo_missing_count']}")
    lines.append(f"- Tooltip admin names: {report['tooltip_admin_name_count']}")
    lines.append(f"- Tooltip admin names missing or untranslated in locales.geo: {report['tooltip_admin_missing_count']}")
    lines.append(f"- Scenario country display names: {report['scenario_geo_name_count']}")
    lines.append(
        "- Scenario names missing or untranslated in locales.geo: "
        f"{report['scenario_geo_missing_count']}"
    )
    lines.append(f"- Scenario metadata strings: {report['scenario_metadata_name_count']}")
    lines.append(
        "- Scenario metadata missing or untranslated in locales.geo: "
        f"{report['scenario_metadata_missing_count']}"
    )
    lines.append("")

    lines.append("## Missing UI Locale Keys")
    if report["ui_missing_keys"]:
        for key in report["ui_missing_keys"]:
            lines.append(f"- {key}")
    else:
        lines.append("- None")
    lines.append("")

    lines.append("## Covered Default Literals")
    if report["covered_default_literals"]:
        for key in report["covered_default_literals"]:
            lines.append(f"- {key}")
    else:
        lines.append("- None")
    lines.append("")

    lines.append("## Uncovered User-Visible Literals")
    if report["uncovered_user_visible_literals"]:
        for key in report["uncovered_user_visible_literals"]:
            lines.append(f"- {key}")
    else:
        lines.append("- None")
    lines.append("")

    lines.append("## A11y Literals")
    if report["a11y_literals"]:
        for key in report["a11y_literals"]:
            lines.append(f"- {key}")
    else:
        lines.append("- None")
    lines.append("")

    lines.append("## Non-Translatable Tokens")
    if report["non_translatable_tokens"]:
        for key in report["non_translatable_tokens"]:
            lines.append(f"- {key}")
    else:
        lines.append("- None")
    lines.append("")

    lines.append("## Dynamic UI Candidates")
    if report["dynamic_ui_candidates"]:
        for key in report["dynamic_ui_candidates"]:
            lines.append(f"- {key}")
    else:
        lines.append("- None")
    lines.append("")

    lines.append("## Template HTML Candidates")
    if report["template_html_candidates"]:
        for key in report["template_html_candidates"]:
            lines.append(f"- {key}")
    else:
        lines.append("- None")
    lines.append("")

    lines.append("## Corrupted Translation Entries")
    if report["corrupted_translation_examples"]:
        for entry in report["corrupted_translation_examples"][:200]:
            lines.append(f"- [{entry['section']}] {entry['key']}")
        if len(report["corrupted_translation_examples"]) > 200:
            lines.append(f"- ... ({len(report['corrupted_translation_examples']) - 200} more)")
    else:
        lines.append("- None")
    lines.append("")

    lines.append("## Shell Fallback Missing-Like Entries")
    if report["shell_fallback_missing_like_examples"]:
        for key in report["shell_fallback_missing_like_examples"][:200]:
            lines.append(f"- {key}")
        if len(report["shell_fallback_missing_like_examples"]) > 200:
            lines.append(f"- ... ({len(report['shell_fallback_missing_like_examples']) - 200} more)")
    else:
        lines.append("- None")
    lines.append("")

    lines.append("## Corrupted Source Names")
    if report["source_name_corrupted_examples"]:
        for key in report["source_name_corrupted_examples"][:200]:
            lines.append(f"- {key}")
        if len(report["source_name_corrupted_examples"]) > 200:
            lines.append(f"- ... ({len(report['source_name_corrupted_examples']) - 200} more)")
    else:
        lines.append("- None")
    lines.append("")

    lines.append("## Tooltip Admin Names Missing or Untranslated in locales.geo")
    if report["tooltip_admin_missing_examples"]:
        for key in report["tooltip_admin_missing_examples"][:200]:
            lines.append(f"- {key}")
        if len(report["tooltip_admin_missing_examples"]) > 200:
            lines.append(f"- ... ({len(report['tooltip_admin_missing_examples']) - 200} more)")
    else:
        lines.append("- None")
    lines.append("")

    lines.append("## Topology Names Missing in locales.geo")
    if report["topology_geo_missing"]:
        for key in report["topology_geo_missing"][:200]:
            lines.append(f"- {key}")
        if len(report["topology_geo_missing"]) > 200:
            lines.append(f"- ... ({len(report['topology_geo_missing']) - 200} more)")
    else:
        lines.append("- None")
    lines.append("")

    lines.append("## Scenario Names Missing or Untranslated in locales.geo")
    if report["scenario_geo_missing"]:
        for key in report["scenario_geo_missing"][:200]:
            lines.append(f"- {key}")
        if len(report["scenario_geo_missing"]) > 200:
            lines.append(f"- ... ({len(report['scenario_geo_missing']) - 200} more)")
    else:
        lines.append("- None")
    lines.append("")

    lines.append("## Scenario Metadata Missing or Untranslated in locales.geo")
    if report["scenario_metadata_missing"]:
        for key in report["scenario_metadata_missing"][:200]:
            lines.append(f"- {key}")
        if len(report["scenario_metadata_missing"]) > 200:
            lines.append(f"- ... ({len(report['scenario_metadata_missing']) - 200} more)")
    else:
        lines.append("- None")
    lines.append("")

    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit translation coverage for UI and geo text.")
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--locales", type=Path)
    parser.add_argument("--topology", type=Path)
    parser.add_argument("--runtime-topology", type=Path)
    parser.add_argument("--scenarios-root", type=Path)
    parser.add_argument("--markdown-out", type=Path)
    parser.add_argument("--json-out", type=Path)
    return parser.parse_args()


def resolve_default_topology(repo_root: Path) -> Path:
    candidates = [
        repo_root / "data" / "europe_topology.na_v2.json",
        repo_root / "data" / "europe_topology.na_v1.json",
        repo_root / "data" / "europe_topology.highres.json",
        repo_root / "data" / "europe_topology.json",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[-1]


def resolve_default_runtime_topology(repo_root: Path) -> Path:
    candidates = [
        repo_root / "data" / "europe_topology.runtime_political_v1.json",
        repo_root / "data" / "europe_topology.na_v2.json",
        repo_root / "data" / "europe_topology.na_v1.json",
        repo_root / "data" / "europe_topology.highres.json",
        repo_root / "data" / "europe_topology.json",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[-1]


def main() -> None:
    args = parse_args()
    repo_root = args.repo_root.resolve()
    locales_path = args.locales or (repo_root / "data" / "locales.json")
    topology_path = args.topology or resolve_default_topology(repo_root)
    runtime_topology_path = args.runtime_topology or resolve_default_runtime_topology(repo_root)
    scenarios_root = args.scenarios_root or (repo_root / "data" / "scenarios")
    markdown_out = (
        args.markdown_out
        or (repo_root / ".runtime" / "reports" / "generated" / "translation" / "translation_coverage_report.md")
    )
    json_out = (
        args.json_out
        or (repo_root / ".runtime" / "reports" / "generated" / "translation" / "translation_coverage_report.json")
    )

    locales = load_locales(locales_path)
    code_strings = collect_code_strings(repo_root)

    ui_locale_key_set = set((locales.get("ui") or {}).keys())
    ui_locale_keys = sorted(ui_locale_key_set)
    geo_locale = locales.get("geo") or {}

    ui_used = (
        set(code_strings["ui_t_keys"])
        | set(code_strings["declarative_ui_keys"])
        | set(code_strings["legacy_ui_map_keys"])
    )
    ui_missing = sorted(key for key in ui_used if key not in ui_locale_key_set)

    shell_fallback_geo = sorted(key for key in geo_locale if is_shell_fallback_name(key))
    shell_fallback_missing_like = sorted(
        key
        for key, value in geo_locale.items()
        if is_shell_fallback_name(key)
        and is_missing_like((value or {}).get("zh", ""), (value or {}).get("en", key))
    )
    source_name_corrupted = sorted(
        key
        for key, value in geo_locale.items()
        if is_corrupted_source_name(key) or is_corrupted_source_name((value or {}).get("en", key))
    )
    geo_missing_like_count = sum(
        1
        for key, value in geo_locale.items()
        if should_track_geo_missing_like(key, (value or {}).get("en", key))
        and is_missing_like((value or {}).get("zh", ""), (value or {}).get("en", key))
    )
    geo_todo_marker_count = sum(
        1
        for value in geo_locale.values()
        if has_literal_todo_marker((value or {}).get("zh", ""))
    )
    corrupted_translation_examples = []
    for section_name, section_payload in (("ui", locales.get("ui") or {}), ("geo", geo_locale)):
        for key, value in section_payload.items():
            zh_value = (value or {}).get("zh", "") if isinstance(value, dict) else str(value or "")
            if is_corrupted_translation(zh_value):
                corrupted_translation_examples.append({
                    "section": section_name,
                    "key": key,
                })

    topology_names = []
    if topology_path.exists():
        topology_names = load_topology_names(topology_path)
    runtime_topology_names = []
    if runtime_topology_path.exists():
        runtime_topology_names = load_topology_names(runtime_topology_path)
    combined_topology_names = sorted(set(topology_names) | set(runtime_topology_names))
    topology_missing = sorted(name for name in combined_topology_names if name not in geo_locale)
    tooltip_admin_names = []
    if topology_path.exists():
        tooltip_admin_names.extend(load_tooltip_admin_names(topology_path))
    if runtime_topology_path.exists():
        tooltip_admin_names.extend(load_tooltip_admin_names(runtime_topology_path))
    tooltip_admin_names = sorted(set(tooltip_admin_names))
    tooltip_admin_missing = []
    for name in tooltip_admin_names:
        entry = geo_locale.get(name)
        zh_value = entry.get("zh", "") if isinstance(entry, dict) else ""
        en_value = entry.get("en", name) if isinstance(entry, dict) else name
        if is_missing_like(zh_value, en_value):
            tooltip_admin_missing.append(name)

    scenario_strings = load_scenario_localizable_strings(scenarios_root)
    scenario_geo_names = scenario_strings["display_names"]
    scenario_geo_missing = []
    for name in scenario_geo_names:
        entry = geo_locale.get(name)
        zh_value = entry.get("zh", "") if isinstance(entry, dict) else ""
        en_value = entry.get("en", name) if isinstance(entry, dict) else name
        if is_missing_like(zh_value, en_value):
            scenario_geo_missing.append(name)
    scenario_metadata_names = scenario_strings["metadata_names"]
    scenario_metadata_missing = []
    for name in scenario_metadata_names:
        entry = geo_locale.get(name)
        zh_value = entry.get("zh", "") if isinstance(entry, dict) else ""
        en_value = entry.get("en", name) if isinstance(entry, dict) else name
        if is_missing_like(zh_value, en_value):
            scenario_metadata_missing.append(name)

    literal_translated_ui_keys = code_strings["ui_t_keys"]
    geo_todo_count = geo_missing_like_count

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "repo_root": str(repo_root),
        "locales_path": str(locales_path),
        "topology_path": str(topology_path),
        "runtime_topology_path": str(runtime_topology_path),
        "scenarios_root": str(scenarios_root),
        "ui_locale_count": len(ui_locale_keys),
        "ui_used_count": len(ui_used),
        "literal_translated_ui_count": len(literal_translated_ui_keys),
        "literal_translated_ui_keys": literal_translated_ui_keys,
        "declarative_ui_key_count": len(code_strings["declarative_ui_keys"]),
        "declarative_ui_keys": code_strings["declarative_ui_keys"],
        "legacy_ui_map_key_count": len(code_strings["legacy_ui_map_keys"]),
        "legacy_ui_map_keys": code_strings["legacy_ui_map_keys"],
        "ui_missing_count": len(ui_missing),
        "ui_missing_keys": ui_missing,
        "covered_default_literal_count": len(code_strings["covered_default_literals"]),
        "covered_default_literals": code_strings["covered_default_literals"],
        "uncovered_user_visible_count": len(code_strings["uncovered_user_visible_literals"]),
        "uncovered_user_visible_literals": code_strings["uncovered_user_visible_literals"],
        "a11y_literal_count": len(code_strings["a11y_literals"]),
        "a11y_literals": code_strings["a11y_literals"],
        "non_translatable_token_count": len(code_strings["non_translatable_tokens"]),
        "non_translatable_tokens": code_strings["non_translatable_tokens"],
        "hardcoded_ui_count": len(code_strings["uncovered_user_visible_literals"]),
        "hardcoded_ui_candidates": code_strings["uncovered_user_visible_literals"],
        "dynamic_ui_count": len(code_strings["dynamic_ui_candidates"]),
        "dynamic_ui_candidates": code_strings["dynamic_ui_candidates"],
        "template_html_count": len(code_strings["template_html_candidates"]),
        "template_html_candidates": code_strings["template_html_candidates"],
        "geo_locale_count": len(geo_locale),
        "geo_todo_count": geo_todo_count,
        "geo_missing_like_count": geo_missing_like_count,
        "shell_fallback_geo_count": len(shell_fallback_geo),
        "shell_fallback_missing_like_count": len(shell_fallback_missing_like),
        "shell_fallback_missing_like_examples": shell_fallback_missing_like[:500],
        "geo_todo_marker_count": geo_todo_marker_count,
        "corrupted_translation_count": len(corrupted_translation_examples),
        "corrupted_translation_examples": corrupted_translation_examples,
        "source_name_corrupted_count": len(source_name_corrupted),
        "source_name_corrupted_examples": source_name_corrupted[:500],
        "primary_topology_geo_name_count": len(topology_names),
        "runtime_topology_geo_name_count": len(runtime_topology_names),
        "topology_geo_name_count": len(combined_topology_names),
        "topology_geo_missing_count": len(topology_missing),
        "topology_geo_missing": topology_missing,
        "tooltip_admin_name_count": len(tooltip_admin_names),
        "tooltip_admin_missing_count": len(tooltip_admin_missing),
        "tooltip_admin_missing_examples": tooltip_admin_missing[:500],
        "scenario_geo_name_count": len(scenario_geo_names),
        "scenario_geo_missing_count": len(scenario_geo_missing),
        "scenario_geo_missing": scenario_geo_missing,
        "scenario_metadata_name_count": len(scenario_metadata_names),
        "scenario_metadata_missing_count": len(scenario_metadata_missing),
        "scenario_metadata_missing": scenario_metadata_missing,
    }

    markdown_out.parent.mkdir(parents=True, exist_ok=True)
    markdown_out.write_text(render_markdown(report), encoding="utf-8")

    json_out.parent.mkdir(parents=True, exist_ok=True)
    json_out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        "OK: i18n audit complete. "
        f"ui_missing={report['ui_missing_count']}, "
        f"covered_defaults={report['covered_default_literal_count']}, "
        f"uncovered_visible_ui={report['uncovered_user_visible_count']}, "
        f"a11y_literals={report['a11y_literal_count']}, "
        f"non_translatable={report['non_translatable_token_count']}, "
        f"dynamic_ui={report['dynamic_ui_count']}, "
        f"template_html={report['template_html_count']}, "
        f"geo_missing_like={report['geo_missing_like_count']}, "
        f"shell_fallback_missing_like={report['shell_fallback_missing_like_count']}, "
        f"scenario_geo_missing={report['scenario_geo_missing_count']}, "
        f"scenario_metadata_missing={report['scenario_metadata_missing_count']}, "
        f"source_name_corrupted={report['source_name_corrupted_count']}, "
        f"corrupted_translations={report['corrupted_translation_count']}, "
        f"todo_markers={report['geo_todo_marker_count']}"
    )
    print(f"Markdown report: {markdown_out}")
    print(f"JSON report: {json_out}")


if __name__ == "__main__":
    main()
