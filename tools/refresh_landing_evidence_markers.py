"""Refresh the landing page's checked-in evidence numbers from their source markers.

Stat cards, story evidence and sample-run evidence carry a source marker
(`<asset path>:<dotted path>[+<dotted path>...]`) next to a hard-coded value.
tests/landing_showcase_view_behavior.test.mjs resolves each marker and requires
the value and visible text to match. This rewrites both from the marker, then
mirrors the page to dist/index.html (and its pages-dist-manifest size) when the
mirror was in sync.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "landing/index.html"
MIRROR = ROOT / "dist/index.html"
PAGES_MANIFEST = ROOT / "dist/pages-dist-manifest.json"
STAT = re.compile(r'(data-stat-source="([^"]+)" data-stat-value=")(\d+)(">)\d+(</span>)')
EVIDENCE = re.compile(r'(data-(story|sample)-evidence-source="([^"]+)">\s*<dt\b[^>]*>[^<]*</dt>\s*'
                      r'<dd data-\2-evidence-value=")(\d+)(">)\d+(</dd>)')


def resolve(marker: str, cache: dict) -> int:
    asset_path, expression = marker.split(":")
    if asset_path not in cache:
        cache[asset_path] = json.loads((ROOT / asset_path).read_text(encoding="utf-8"))
    total = 0
    for part in expression.split("+"):
        value = cache[asset_path]
        for key in part.split("."):
            value = len(value) if key == "length" else value[key]
        total += int(value)
    return total


def main() -> None:
    original = PAGE.read_bytes().replace(b"\r\n", b"\n")
    html, cache = original.decode("utf-8"), {}
    html = STAT.sub(lambda m: f"{m[1]}{(v := resolve(m[2], cache))}{m[4]}{v}{m[5]}", html)
    html = EVIDENCE.sub(lambda m: f"{m[1]}{(v := resolve(m[3], cache))}{m[5]}{v}{m[6]}", html)
    if html.encode("utf-8") == original:
        print("landing evidence markers already current")
        return
    mirror_in_sync = MIRROR.exists() and MIRROR.read_bytes().replace(b"\r\n", b"\n") == original
    PAGE.write_bytes(html.encode("utf-8"))
    if mirror_in_sync:
        MIRROR.write_bytes(html.encode("utf-8"))
        manifest = json.loads(PAGES_MANIFEST.read_text(encoding="utf-8"))
        delta = len(html.encode("utf-8")) - len(original)
        for entry in manifest["files"] + manifest["largest_files"]:
            if entry.get("path") == "index.html":
                entry["size_bytes"] += delta
        for entry in manifest["top_level_directories"]:
            if entry.get("path") == "index.html":
                entry["size_bytes"] += delta
        manifest["total_bytes"] += delta
        PAGES_MANIFEST.write_bytes((json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    print(f"refreshed landing evidence markers (dist mirror {'synced' if mirror_in_sync else 'left as is'})")


if __name__ == "__main__":
    main()
