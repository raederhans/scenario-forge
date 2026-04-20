from __future__ import annotations

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
APP_SHARED_DIRS = ("css", "js", "vendor", "data")


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


def write_nojekyll() -> None:
    (DIST_ROOT / ".nojekyll").write_text("", encoding="utf-8")


def main() -> None:
    landing_entry = resolve_landing_entry_path(root=ROOT)
    editor_entry = resolve_editor_entry_path(root=ROOT)

    reset_dist()
    build_landing_dist(landing_entry)
    build_editor_dist(editor_entry)
    write_nojekyll()

    print(f"[build_pages_dist] landing source: {repo_display_path(landing_entry, root=ROOT)}")
    print(f"[build_pages_dist] editor source: {repo_display_path(editor_entry, root=ROOT)}")
    print(f"[build_pages_dist] output: {DIST_ROOT}")


if __name__ == "__main__":
    main()
