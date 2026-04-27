from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
import time
from dataclasses import dataclass
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


@dataclass
class SyncStats:
    copied_files: int = 0
    skipped_files: int = 0


def reset_dist() -> None:
    if DIST_ROOT.exists():
        shutil.rmtree(DIST_ROOT)
    APP_DIST_ROOT.mkdir(parents=True, exist_ok=True)


def file_sha256(path: Path, chunk_size: int = 1024 * 1024) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def should_copy_file(source_file: Path, target_file: Path, use_hash: bool = False) -> bool:
    if not target_file.exists() or not target_file.is_file():
        return True

    source_stat = source_file.stat()
    target_stat = target_file.stat()
    source_mtime_ns = source_stat.st_mtime_ns
    target_mtime_ns = target_stat.st_mtime_ns

    if source_stat.st_size == target_stat.st_size and source_mtime_ns <= target_mtime_ns:
        return False

    if not use_hash:
        return True

    return file_sha256(source_file) != file_sha256(target_file)


def sync_tree_contents(
    source_dir: Path,
    destination_dir: Path,
    *,
    stats: SyncStats,
    use_hash: bool = False,
    prune: bool = True,
) -> None:
    if not source_dir.exists() or not source_dir.is_dir():
        return

    destination_dir.mkdir(parents=True, exist_ok=True)

    source_entries = {child.name: child for child in source_dir.iterdir()}
    destination_entries = {child.name: child for child in destination_dir.iterdir()}

    if prune:
        for orphan_name, orphan_path in destination_entries.items():
            if orphan_name in source_entries:
                continue
            if orphan_path.is_dir():
                shutil.rmtree(orphan_path)
            else:
                orphan_path.unlink()

    for name, source_path in source_entries.items():
        target_path = destination_dir / name
        if source_path.is_dir():
            sync_tree_contents(
                source_path,
                target_path,
                stats=stats,
                use_hash=use_hash,
                prune=prune,
            )
            continue

        if should_copy_file(source_path, target_path, use_hash=use_hash):
            shutil.copy2(source_path, target_path)
            stats.copied_files += 1
        else:
            stats.skipped_files += 1


def copy_file_if_needed(
    source_file: Path,
    target_file: Path,
    *,
    stats: SyncStats,
    force: bool = False,
    use_hash: bool = False,
) -> None:
    target_file.parent.mkdir(parents=True, exist_ok=True)
    if force or should_copy_file(source_file, target_file, use_hash=use_hash):
        shutil.copy2(source_file, target_file)
        stats.copied_files += 1
        return
    stats.skipped_files += 1


def copy_root_public_assets(stats: SyncStats) -> None:
    DIST_ROOT.mkdir(parents=True, exist_ok=True)
    for file_name in ROOT_PUBLIC_FILES:
        source_file = ROOT / file_name
        if source_file.is_file():
            copy_file_if_needed(source_file, DIST_ROOT / file_name, stats=stats)

    for source_file in ROOT.iterdir():
        if not source_file.is_file():
            continue
        if source_file.name == "index.html":
            continue
        if source_file.suffix.lower() in ROOT_PUBLIC_FILE_SUFFIXES:
            copy_file_if_needed(source_file, DIST_ROOT / source_file.name, stats=stats)


def build_landing_dist(landing_entry: Path, stats: SyncStats) -> None:
    copy_root_public_assets(stats)
    if landing_entry.parent != ROOT:
        sync_tree_contents(landing_entry.parent, DIST_ROOT, stats=stats, prune=False)
    copy_file_if_needed(landing_entry, DIST_ROOT / "index.html", stats=stats, force=True)


def inject_editor_noindex(index_path: Path) -> None:
    content = index_path.read_text(encoding="utf-8")
    marker = '<meta name="viewport" content="width=device-width, initial-scale=1.0" />'
    noindex = "\n    <meta name=\"robots\" content=\"noindex,nofollow\" />"
    if 'meta name="robots" content="noindex,nofollow"' in content:
        return
    if marker in content:
        content = content.replace(marker, marker + noindex, 1)
        index_path.write_text(content, encoding="utf-8")


def build_editor_dist(editor_entry: Path, stats: SyncStats, use_hash: bool = False) -> None:
    if editor_entry.parent != ROOT:
        sync_tree_contents(editor_entry.parent, APP_DIST_ROOT, stats=stats, use_hash=use_hash, prune=False)

    for directory_name in APP_SHARED_DIRS:
        source_dir = ROOT / directory_name
        if source_dir.is_dir():
            sync_tree_contents(
                source_dir,
                APP_DIST_ROOT / directory_name,
                stats=stats,
                use_hash=use_hash,
            )

    target_index = APP_DIST_ROOT / "index.html"
    copy_file_if_needed(editor_entry, target_index, stats=stats, force=True)
    inject_editor_noindex(target_index)


def write_nojekyll(stats: SyncStats) -> None:
    target = DIST_ROOT / ".nojekyll"
    existing = target.read_text(encoding="utf-8") if target.exists() else None
    if existing == "":
        stats.skipped_files += 1
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("", encoding="utf-8")
    stats.copied_files += 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build dist pages with incremental sync support.")
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Force full rebuild by cleaning dist before copy.",
    )
    parser.add_argument(
        "--hash-check",
        action="store_true",
        help="Use file hash verification when deciding copy/skip.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    started_at = time.perf_counter()
    stats = SyncStats()

    landing_entry = resolve_landing_entry_path(root=ROOT)
    editor_entry = resolve_editor_entry_path(root=ROOT)

    if args.clean:
        reset_dist()
    else:
        APP_DIST_ROOT.mkdir(parents=True, exist_ok=True)

    build_landing_dist(landing_entry, stats)
    build_editor_dist(editor_entry, stats, use_hash=args.hash_check)
    write_nojekyll(stats)

    duration_seconds = time.perf_counter() - started_at

    print(f"[build_pages_dist] landing source: {repo_display_path(landing_entry, root=ROOT)}")
    print(f"[build_pages_dist] editor source: {repo_display_path(editor_entry, root=ROOT)}")
    print(f"[build_pages_dist] output: {DIST_ROOT}")
    print(f"[build_pages_dist] copied files: {stats.copied_files}")
    print(f"[build_pages_dist] skipped files: {stats.skipped_files}")
    print(f"[build_pages_dist] total time: {duration_seconds:.2f}s")


if __name__ == "__main__":
    main()
