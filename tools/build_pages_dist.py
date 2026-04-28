from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.app_entry_resolver import (
    repo_display_path,
    resolve_editor_entry_path,
    resolve_landing_entry_path,
)

DIST_ROOT = ROOT / "dist"
APP_DIST_ROOT = DIST_ROOT / "app"
DIST_MANIFEST_PATH = DIST_ROOT / "pages-dist-manifest.json"
MAX_PAGES_DIST_BYTES = 950 * 1024 * 1024
ROOT_PUBLIC_FILES = (
    ".nojekyll",
    "CNAME",
    "favicon.ico",
    "favicon.svg",
    "favicon.png",
    "site.webmanifest",
    "robots.txt",
    "humans.txt",
)
ROOT_PUBLIC_FILE_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".svg",
    ".gif",
    ".avif",
}
APP_SHARED_DIRS = ("css", "js", "vendor")
REQUIRED_DIST_FILES = (
    "index.html",
    "app/index.html",
    ".nojekyll",
    "app/js/main.js",
    "app/data/scenarios/index.json",
)
DATA_RUNTIME_FILES = (
    "manifest.json",
    "europe_topology.json",
    "europe_topology.na_v2.json",
    "hierarchy.json",
    "locales.json",
    "geo_aliases.json",
    "europe_topology.runtime_political_v1.json",
    "world_cities.geojson",
    "city_aliases.json",
    "ru_city_overrides.geojson",
    "special_zones.geojson",
    "global_rivers.geojson",
    "europe_physical.geojson",
    "europe_urban.geojson",
    "global_physical_semantics.topo.json",
    "global_contours.major.topo.json",
    "global_contours.minor.topo.json",
    "global_bathymetry.topo.json",
    "historical_city_lights_1930_exclusions.json",
)
DATA_RUNTIME_DIRS = (
    "feature-migrations",
    "palette-maps",
    "palettes",
    "releasables",
    "scenario-rules",
    "unit_counter_libraries",
)
SCENARIO_EXCLUDED_DIR_NAMES = {"derived"}
SCENARIO_EXCLUDED_FILE_NAMES = {"audit.json"}
TRANSPORT_METADATA_FILE_NAMES = {
    "catalog.json",
    "manifest.json",
    "build_audit.json",
    "subtype_catalog.json",
    "carrier.json",
    "provenance.json",
}
TRANSPORT_SMALL_DIRECT_RUNTIME_FILES = {
    "data/transport_layers/japan_airport/airports.geojson",
    "data/transport_layers/japan_port/ports.geojson",
}


def reset_dist() -> None:
    if DIST_ROOT.exists():
        shutil.rmtree(DIST_ROOT)
    APP_DIST_ROOT.mkdir(parents=True, exist_ok=True)


def copy_tree_contents(source_dir: Path, destination_dir: Path) -> None:
    if not source_dir.exists() or not source_dir.is_dir():
        return
    destination_dir.mkdir(parents=True, exist_ok=True)
    for child in source_dir.iterdir():
        target_path = destination_dir / child.name
        if child.is_dir():
            shutil.copytree(child, target_path, dirs_exist_ok=True)
        else:
            shutil.copy2(child, target_path)


def copy_tree_filtered(source_dir: Path, destination_dir: Path, should_copy_file) -> None:
    if not source_dir.exists() or not source_dir.is_dir():
        return
    for source_file in source_dir.rglob("*"):
        if not source_file.is_file():
            continue
        relative_path = source_file.relative_to(source_dir)
        if not should_copy_file(relative_path, source_file):
            continue
        target_path = destination_dir / relative_path
        target_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_file, target_path)


def copy_relative_file(relative_path: str) -> None:
    source_file = ROOT / relative_path
    if not source_file.is_file():
        return
    target_path = APP_DIST_ROOT / relative_path
    target_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_file, target_path)


def copy_root_public_assets() -> None:
    DIST_ROOT.mkdir(parents=True, exist_ok=True)
    for file_name in ROOT_PUBLIC_FILES:
        source_file = ROOT / file_name
        if source_file.is_file():
            shutil.copy2(source_file, DIST_ROOT / file_name)
    for source_file in ROOT.iterdir():
        if not source_file.is_file():
            continue
        if source_file.name == "index.html":
            continue
        if source_file.suffix.lower() in ROOT_PUBLIC_FILE_SUFFIXES:
            shutil.copy2(source_file, DIST_ROOT / source_file.name)


def build_landing_dist(landing_entry: Path) -> None:
    copy_root_public_assets()
    if landing_entry.parent != ROOT:
        copy_tree_contents(landing_entry.parent, DIST_ROOT)
    shutil.copy2(landing_entry, DIST_ROOT / "index.html")


def inject_editor_noindex(index_path: Path) -> None:
    content = index_path.read_text(encoding="utf-8")
    marker = '<meta name="viewport" content="width=device-width, initial-scale=1.0" />'
    noindex = "\n    <meta name=\"robots\" content=\"noindex,nofollow\" />"
    if 'meta name="robots" content="noindex,nofollow"' in content:
        return
    if marker in content:
        content = content.replace(marker, marker + noindex, 1)
        index_path.write_text(content, encoding="utf-8")


def build_editor_dist(editor_entry: Path) -> None:
    if editor_entry.parent != ROOT:
        copy_tree_contents(editor_entry.parent, APP_DIST_ROOT)
    for directory_name in APP_SHARED_DIRS:
        source_dir = ROOT / directory_name
        if source_dir.is_dir():
            shutil.copytree(source_dir, APP_DIST_ROOT / directory_name, dirs_exist_ok=True)
    target_index = APP_DIST_ROOT / "index.html"
    shutil.copy2(editor_entry, target_index)
    inject_editor_noindex(target_index)


def copy_scenario_runtime_data() -> None:
    source_dir = ROOT / "data" / "scenarios"
    destination_dir = APP_DIST_ROOT / "data" / "scenarios"

    def should_copy_file(relative_path: Path, _source_file: Path) -> bool:
        parts = set(relative_path.parts)
        if parts.intersection(SCENARIO_EXCLUDED_DIR_NAMES):
            return False
        if relative_path.name in SCENARIO_EXCLUDED_FILE_NAMES:
            return False
        return True

    copy_tree_filtered(source_dir, destination_dir, should_copy_file)


def copy_transport_runtime_data() -> None:
    source_dir = ROOT / "data" / "transport_layers"
    destination_dir = APP_DIST_ROOT / "data" / "transport_layers"

    def should_copy_file(relative_path: Path, source_file: Path) -> bool:
        repo_relative = source_file.relative_to(ROOT).as_posix()
        if repo_relative in TRANSPORT_SMALL_DIRECT_RUNTIME_FILES:
            return True
        if relative_path.name == "industrial_zones.open.geojson":
            return False
        if relative_path.name in TRANSPORT_METADATA_FILE_NAMES:
            return True
        if ".preview." in relative_path.name:
            return True
        if "overrides" in relative_path.parts and relative_path.suffix.lower() == ".json":
            return True
        return False

    copy_tree_filtered(source_dir, destination_dir, should_copy_file)


def copy_runtime_data() -> None:
    for relative_file in DATA_RUNTIME_FILES:
        copy_relative_file(f"data/{relative_file}")
    for directory_name in DATA_RUNTIME_DIRS:
        copy_tree_contents(ROOT / "data" / directory_name, APP_DIST_ROOT / "data" / directory_name)
    copy_scenario_runtime_data()
    copy_transport_runtime_data()


def write_nojekyll() -> None:
    (DIST_ROOT / ".nojekyll").write_text("", encoding="utf-8")


def iter_dist_files() -> list[Path]:
    return sorted(path for path in DIST_ROOT.rglob("*") if path.is_file())


def get_dist_file_records() -> tuple[list[dict[str, int | str]], int]:
    records: list[dict[str, int | str]] = []
    total_bytes = 0
    for path in iter_dist_files():
        size_bytes = path.stat().st_size
        total_bytes += size_bytes
        records.append(
            {
                "path": path.relative_to(DIST_ROOT).as_posix(),
                "size_bytes": size_bytes,
            }
        )
    return records, total_bytes


def validate_required_dist_files() -> None:
    missing_files = [relative_path for relative_path in REQUIRED_DIST_FILES if not (DIST_ROOT / relative_path).is_file()]
    if missing_files:
        missing_text = ", ".join(missing_files)
        raise FileNotFoundError(f"Pages dist is missing required file(s): {missing_text}")


def write_dist_manifest() -> int:
    DIST_MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(2):
        records, total_bytes = get_dist_file_records()
        payload = {
            "schema_version": 1,
            "total_bytes": total_bytes,
            "max_allowed_bytes": MAX_PAGES_DIST_BYTES,
            "required_files": list(REQUIRED_DIST_FILES),
            "files": records,
        }
        DIST_MANIFEST_PATH.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    _records, total_bytes = get_dist_file_records()
    return total_bytes


def enforce_dist_size(total_bytes: int) -> None:
    if total_bytes > MAX_PAGES_DIST_BYTES:
        total_mib = total_bytes / (1024 * 1024)
        limit_mib = MAX_PAGES_DIST_BYTES / (1024 * 1024)
        raise SystemExit(
            f"Pages dist size gate failed: {total_mib:.2f} MiB exceeds {limit_mib:.2f} MiB. "
            "Update the runtime allowlist before publishing."
        )


def main() -> None:
    landing_entry = resolve_landing_entry_path(root=ROOT)
    editor_entry = resolve_editor_entry_path(root=ROOT)

    reset_dist()
    build_landing_dist(landing_entry)
    build_editor_dist(editor_entry)
    copy_runtime_data()
    write_nojekyll()
    validate_required_dist_files()
    total_bytes = write_dist_manifest()
    enforce_dist_size(total_bytes)

    print(f"[build_pages_dist] landing source: {repo_display_path(landing_entry, root=ROOT)}")
    print(f"[build_pages_dist] editor source: {repo_display_path(editor_entry, root=ROOT)}")
    print(f"[build_pages_dist] output: {DIST_ROOT}")
    print(f"[build_pages_dist] manifest: {repo_display_path(DIST_MANIFEST_PATH, root=ROOT)}")
    print(f"[build_pages_dist] total size: {total_bytes / (1024 * 1024):.2f} MiB")


if __name__ == "__main__":
    main()
