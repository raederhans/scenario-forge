import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

try:
    from tools.translate_manager import has_literal_todo_marker, is_missing_like
except ImportError:
    from translate_manager import has_literal_todo_marker, is_missing_like

UI_T_CALL_RE = re.compile(r"""t\(\s*(['\"])(?P<text>.*?)\1\s*,\s*(['\"])ui\3\s*\)""")
GEO_T_CALL_RE = re.compile(r"""t\(\s*(['\"])(?P<text>.*?)\1\s*,\s*(['\"])geo\3\s*\)""")
MODAL_CALL_RE = re.compile(r"""\b(?:alert|confirm|prompt)\(\s*(['\"])(?P<text>.*?)\1\s*\)""")
TEXT_ASSIGN_RE = re.compile(r"""\b(?:textContent|innerText)\s*=\s*(['\"])(?P<text>.*?)\1""")
PLACEHOLDER_RE = re.compile(
    r"""setAttribute\(\s*(['\"])placeholder\1\s*,\s*(['\"])(?P<text>.*?)\2"""
)


def decode_js_string(text: str) -> str:
    value = text.strip()
    value = value.replace(r"\'", "'").replace(r'\"', '"')
    value = value.replace(r"\n", " ").replace(r"\r", " ").replace(r"\t", " ")
    return " ".join(value.split())
def is_user_visible_candidate(value: str) -> bool:
    text = (value or "").strip()
    if len(text) < 3:
        return False
    if text.startswith("#"):
        return False
    if text.startswith("[") and text.endswith("]"):
        return False
    if re.fullmatch(r"[A-Z0-9_\-]+", text):
        return False
    if re.fullmatch(r"[{}()<>:=;,.\-_/\\]+", text):
        return False
    return bool(re.search(r"[A-Za-z]", text))


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


def load_scenario_geo_names(scenarios_root: Path) -> list[str]:
    if not scenarios_root.exists() or not scenarios_root.is_dir():
        return []

    names = set()
    for path in sorted(scenarios_root.rglob("*.json")):
        if not path.is_file():
            continue
        try:
            with path.open("r", encoding="utf-8") as file:
                data = json.load(file)
        except Exception:
            continue

        if not isinstance(data, dict):
            continue

        root_display_name = str(
            data.get("display_name") or data.get("displayName") or ""
        ).strip()
        if root_display_name:
            names.add(root_display_name)

        countries = data.get("countries")
        if isinstance(countries, dict):
            for entry in countries.values():
                if not isinstance(entry, dict):
                    continue
                display_name = str(
                    entry.get("display_name") or entry.get("displayName") or ""
                ).strip()
                if display_name:
                    names.add(display_name)

        scenarios = data.get("scenarios")
        if isinstance(scenarios, list):
            for entry in scenarios:
                if not isinstance(entry, dict):
                    continue
                display_name = str(
                    entry.get("display_name") or entry.get("displayName") or ""
                ).strip()
                if display_name:
                    names.add(display_name)

    return sorted(names)


def collect_code_strings(repo_root: Path) -> dict:
    ui_t_keys = set()
    geo_t_keys = set()
    modal_keys = set()
    hardcoded_ui = set()

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

        for match in GEO_T_CALL_RE.finditer(content):
            value = decode_js_string(match.group("text"))
            if value:
                geo_t_keys.add(value)

        lines = content.splitlines()
        for line in lines:
            line_stripped = line.strip()
            has_t_call = "t(" in line_stripped

            for pattern, bucket in ((MODAL_CALL_RE, modal_keys),):
                for match in pattern.finditer(line):
                    value = decode_js_string(match.group("text"))
                    if value:
                        bucket.add(value)
                        if not has_t_call and is_user_visible_candidate(value):
                            hardcoded_ui.add(value)

            for pattern in (TEXT_ASSIGN_RE, PLACEHOLDER_RE):
                for match in pattern.finditer(line):
                    value = decode_js_string(match.group("text"))
                    if value and not has_t_call and is_user_visible_candidate(value):
                        hardcoded_ui.add(value)

    return {
        "ui_t_keys": sorted(ui_t_keys),
        "geo_t_keys": sorted(geo_t_keys),
        "modal_keys": sorted(modal_keys),
        "hardcoded_ui_candidates": sorted(hardcoded_ui),
    }


def render_markdown(report: dict) -> str:
    lines = []
    lines.append("# Translation Coverage Report")
    lines.append("")
    lines.append(f"Generated at: {report['generated_at']}")
    lines.append("")

    lines.append("## Summary")
    lines.append(f"- UI locale keys: {report['ui_locale_count']}")
    lines.append(f"- UI keys used via t(..., \"ui\"): {report['ui_used_count']}")
    lines.append(f"- Missing UI locale keys: {report['ui_missing_count']}")
    lines.append(f"- Hardcoded visible UI string candidates (not wrapped in t): {report['hardcoded_ui_count']}")
    lines.append(f"- GEO locale keys: {report['geo_locale_count']}")
    lines.append(f"- GEO missing-like entries: {report['geo_missing_like_count']}")
    lines.append(f"- Literal TODO markers: {report['geo_todo_marker_count']}")
    lines.append(
        "- Topology-derived geo names: "
        f"{report['topology_geo_name_count']} "
        f"(primary={report['primary_topology_geo_name_count']}, runtime={report['runtime_topology_geo_name_count']})"
    )
    lines.append(f"- Topology names missing in locales.geo: {report['topology_geo_missing_count']}")
    lines.append(f"- Scenario country display names: {report['scenario_geo_name_count']}")
    lines.append(
        "- Scenario names missing or untranslated in locales.geo: "
        f"{report['scenario_geo_missing_count']}"
    )
    lines.append("")

    lines.append("## Missing UI Locale Keys")
    if report["ui_missing_keys"]:
        for key in report["ui_missing_keys"]:
            lines.append(f"- {key}")
    else:
        lines.append("- None")
    lines.append("")

    lines.append("## Hardcoded UI Candidates")
    if report["hardcoded_ui_candidates"]:
        for key in report["hardcoded_ui_candidates"]:
            lines.append(f"- {key}")
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
        or (repo_root / "reports" / "generated" / "translation" / "translation_coverage_report.md")
    )
    json_out = (
        args.json_out
        or (repo_root / "reports" / "generated" / "translation" / "translation_coverage_report.json")
    )

    locales = load_locales(locales_path)
    code_strings = collect_code_strings(repo_root)

    ui_locale_keys = sorted((locales.get("ui") or {}).keys())
    geo_locale = locales.get("geo") or {}

    ui_used = set(code_strings["ui_t_keys"]) | set(code_strings["modal_keys"])
    ui_missing = sorted(key for key in ui_used if key not in ui_locale_keys)

    geo_missing_like_count = sum(
        1
        for key, value in geo_locale.items()
        if is_missing_like((value or {}).get("zh", ""), (value or {}).get("en", key))
    )
    geo_todo_marker_count = sum(
        1
        for value in geo_locale.values()
        if has_literal_todo_marker((value or {}).get("zh", ""))
    )

    topology_names = []
    if topology_path.exists():
        topology_names = load_topology_names(topology_path)
    runtime_topology_names = []
    if runtime_topology_path.exists():
        runtime_topology_names = load_topology_names(runtime_topology_path)
    combined_topology_names = sorted(set(topology_names) | set(runtime_topology_names))
    topology_missing = sorted(name for name in combined_topology_names if name not in geo_locale)

    scenario_geo_names = load_scenario_geo_names(scenarios_root)
    scenario_geo_missing = []
    for name in scenario_geo_names:
        entry = geo_locale.get(name)
        zh_value = entry.get("zh", "") if isinstance(entry, dict) else ""
        en_value = entry.get("en", name) if isinstance(entry, dict) else name
        if is_missing_like(zh_value, en_value):
            scenario_geo_missing.append(name)

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "repo_root": str(repo_root),
        "locales_path": str(locales_path),
        "topology_path": str(topology_path),
        "runtime_topology_path": str(runtime_topology_path),
        "scenarios_root": str(scenarios_root),
        "ui_locale_count": len(ui_locale_keys),
        "ui_used_count": len(ui_used),
        "ui_missing_count": len(ui_missing),
        "ui_missing_keys": ui_missing,
        "hardcoded_ui_count": len(code_strings["hardcoded_ui_candidates"]),
        "hardcoded_ui_candidates": code_strings["hardcoded_ui_candidates"],
        "geo_locale_count": len(geo_locale),
        "geo_todo_count": geo_missing_like_count,
        "geo_missing_like_count": geo_missing_like_count,
        "geo_todo_marker_count": geo_todo_marker_count,
        "primary_topology_geo_name_count": len(topology_names),
        "runtime_topology_geo_name_count": len(runtime_topology_names),
        "topology_geo_name_count": len(combined_topology_names),
        "topology_geo_missing_count": len(topology_missing),
        "topology_geo_missing": topology_missing,
        "scenario_geo_name_count": len(scenario_geo_names),
        "scenario_geo_missing_count": len(scenario_geo_missing),
        "scenario_geo_missing": scenario_geo_missing,
    }

    markdown_out.parent.mkdir(parents=True, exist_ok=True)
    markdown_out.write_text(render_markdown(report), encoding="utf-8")

    json_out.parent.mkdir(parents=True, exist_ok=True)
    json_out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        "OK: i18n audit complete. "
        f"ui_missing={report['ui_missing_count']}, "
        f"hardcoded_ui={report['hardcoded_ui_count']}, "
        f"geo_missing_like={report['geo_missing_like_count']}, "
        f"scenario_geo_missing={report['scenario_geo_missing_count']}, "
        f"todo_markers={report['geo_todo_marker_count']}"
    )
    print(f"Markdown report: {markdown_out}")
    print(f"JSON report: {json_out}")


if __name__ == "__main__":
    main()
