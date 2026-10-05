"""Read-only Pages source references; not a release/data integrity check.

The virtual inventory follows the builder's copy order without copying or hashing
assets. Only text code and the scenario manifests needed by publication policy
are read. Compression, generated data contents and final artifact completeness
remain the responsibility of the full Pages build lane.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools import build_pages_dist as pages
from tools.app_entry_resolver import resolve_editor_entry_path, resolve_landing_entry_path


def build_source_inventory(root: Path) -> dict[str, Path]:
    """Map published names to their current sources, never to an existing dist."""
    root = root.resolve()
    inventory: dict[str, Path] = {}

    def add(source: Path, target: str) -> None:
        if source.is_file():
            inventory[target] = source

    def tree(source: Path, target: str, predicate=None) -> None:
        if not source.is_dir():
            return
        for path in source.rglob("*"):
            relative = path.relative_to(source)
            if pages.should_skip_disposable_dist_path(relative):
                continue
            if predicate is None or predicate(path):
                add(path, f"{target}/{relative.as_posix()}".lstrip("/"))

    landing = resolve_landing_entry_path(root=root)
    editor = resolve_editor_entry_path(root=root)
    for name in pages.ROOT_PUBLIC_FILES:
        add(root / name, name)
    for path in root.iterdir():
        if path.suffix.lower() in pages.ROOT_PUBLIC_FILE_SUFFIXES:
            add(path, path.name)
    if landing.parent != root:
        tree(landing.parent, "")
    add(landing, "index.html")
    if editor.parent != root:
        tree(editor.parent, "app")
    for name in pages.APP_SHARED_DIRS:
        tree(root / name, f"app/{name}")
    add(editor, "app/index.html")
    for name in pages.DATA_RUNTIME_FILES:
        add(root / "data" / name, f"app/data/{name}")
    for name in pages.DATA_RUNTIME_DIRS:
        tree(root / "data" / name, f"app/data/{name}")
    for name in (*pages.HGO_IDENTITY_RUNTIME_FILES, "hgo_flags.png_manifest.json"):
        add(root / "data/hgo_catalogs" / name, f"app/data/hgo_catalogs/{name}")
    for tier in pages.HGO_IDENTITY_FLAG_TIERS:
        tree(root / "data/hgo_catalogs/flags_png" / tier, f"app/data/hgo_catalogs/flags_png/{tier}")
    for name in pages.PAGES_HGO_RUNTIME_FILES:
        add(root / "data/hgo_runtime" / name, f"app/data/hgo_runtime/{name}")
    policy = pages.build_pages_production_publication_policy(root / "data/scenarios")
    for name in ("scenarios", "transport_layers"):
        tree(root / "data" / name, f"app/data/{name}", lambda path: policy.allows(path.relative_to(root)))
    return inventory


# Tokenize strings/comments before identifiers so examples inside them do not
# become references. Escapes include CSS hex escapes and escaped punctuation.
_ESCAPE = r"\\(?:[0-9a-fA-F]{1,6}\s?|\r\n|[\s\S])"
_STRING = rf'''"(?:{_ESCAPE}|[^"\\])*"|'(?:{_ESCAPE}|[^'\\])*' '''.strip()
_TOKENS = re.compile(rf"/\*[\s\S]*?\*/|{_STRING}|(?:{_ESCAPE}|[-\w])+|[^\s]", re.UNICODE)


def _unescape_css(value: str) -> str:
    def replace(match: re.Match) -> str:
        escaped = match.group(0)[1:]
        if escaped in ("\n", "\r", "\r\n", "\f"):
            return ""
        if re.fullmatch(r"[0-9a-fA-F]{1,6}\s?", escaped):
            code = int(escaped.strip(), 16)
            return chr(code) if 0 < code <= 0x10ffff else "\ufffd"
        return escaped
    return re.sub(_ESCAPE, replace, value)


def css_references(source: str) -> list[str]:
    tokens = [m.group(0) for m in _TOKENS.finditer(source) if not m.group(0).startswith("/*")]
    references = []
    for index, token in enumerate(tokens):
        if token.startswith(('"', "'")):
            continue
        if token == "@" and index + 2 < len(tokens) and _unescape_css(tokens[index + 1]).lower() == "import":
            value = tokens[index + 2]
            if value.startswith(('"', "'")):
                references.append(_unescape_css(value[1:-1]))
        if _unescape_css(token).lower() == "url" and tokens[index + 1:index + 2] == ["("]:
            end = index + 2
            while end < len(tokens) and tokens[end] != ")":
                end += 1
            if end == len(tokens):
                raise ValueError("Unclosed CSS url() reference")
            value = "".join(tokens[index + 2:end])
            if value.startswith(('"', "'")):
                value = value[1:-1]
            references.append(_unescape_css(value))
    return references


def check_source_graph(root: Path = ROOT, *, dynamic_import_registry=None) -> dict:
    inventory = build_source_inventory(root)
    available = set(inventory)
    texts = {
        target: source.read_text(encoding="utf-8")
        for target, source in inventory.items()
        if Path(target).suffix.lower() in {".html", ".js", ".mjs", ".css"}
    }
    graph = pages.build_pages_module_graph(
        available_paths=available, source_texts=texts,
        dynamic_import_registry=dynamic_import_registry,
    )
    issues = list(graph["unresolved_references"])
    if pages.PAGES_MODULE_ENTRYPOINT not in available:
        issues.append({"source": "app/index.html", "kind": "module-entrypoint", "reference": pages.PAGES_MODULE_ENTRYPOINT})
    css_count = 0
    for path, source in texts.items():
        if not path.endswith(".css"):
            continue
        css_count += 1
        for reference in css_references(source):
            local, target = pages._resolve_dist_reference(path, reference, available, allow_document_relative=True)
            if local and target not in available:
                issues.append({"source": path, "kind": "css-resource", "reference": reference, "resolved_path": target})
    return {
        "status": "fail" if issues else "pass",
        "inventory_file_count": len(inventory),
        "javascript_file_count": graph["summary"]["module_count"],
        "css_file_count": css_count,
        "entrypoints": graph["entrypoints"],
        "unresolved_references": issues,
        "boundary": "Source references only; full build must verify generated data, compression and release artifacts.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    try:
        result = check_source_graph()
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Pages source graph failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 0 if result["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
