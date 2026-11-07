#!/usr/bin/env python3
"""把地图中文标签字体切成按 unicode-range 加载的 woff2 切片，并生成 css/map-label-fonts.css。

源字体 vendor/fonts/notoserifsc/NotoSerifSC-400.woff2（完整字形，只作生成源，不发布到 Pages）。
- 首片：仓库中文文本（本地化、地名、剧本国家名、界面文案）实际用到的字符，加 ASCII 与常用标点，
  覆盖全部内置标签，绝大多数会话只需下载这一片。
- 其余码位按码位顺序均分成若干片，各自声明 unicode-range，用户自定义名称里的生僻字按需加载。

用法：python tools/build_map_label_font_slices.py（需要 fontTools 与 brotli）。输出是确定性的。
"""
from __future__ import annotations

import argparse
import gc
import glob
from io import BytesIO
from pathlib import Path
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE_FONT = Path("vendor/fonts/notoserifsc/NotoSerifSC-400.woff2")
SLICE_DIR = Path("vendor/fonts/notoserifsc/slices")
CSS_PATH = Path("css/map-label-fonts.css")
FAMILY = "Map Noto Serif SC"
REST_SLICE_COUNT = 24
TEXT_SOURCES = (
    "data/locales*.json",
    "data/i18n/*.json",
    "data/geo_aliases*.json",
    "data/scenarios/*/locales*.json",
    "data/scenarios/*/geo_aliases*.json",
    "data/scenarios/*/countries.json",
    "data/scenarios/*/*.zh.json",
    "index.html",
    "js/**/*.js",
)
# ASCII、拉丁补充里的常用符号、通用标点与 CJK 标点/全角形式：标签里常与汉字混排。
BASE_RANGES = ((0x20, 0x7E), (0xA0, 0xFF), (0x2000, 0x206F), (0x3000, 0x303F), (0xFF00, 0xFFEF))

CSS_HEADER = """/* 生成文件：python tools/build_map_label_font_slices.py。许可与来源见 vendor/fonts/README.md。 */
@font-face {
  font-family: "Map Garamond";
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url("../vendor/fonts/ebgaramond/EBGaramond-500.woff2") format("woff2");
}
"""


def collect_used_codepoints(root: Path, cmap: dict[int, str]) -> set[int]:
    used = {cp for low, high in BASE_RANGES for cp in range(low, high + 1) if cp in cmap}
    for pattern in TEXT_SOURCES:
        for name in sorted(glob.glob(str(root / pattern), recursive=True)):
            text = Path(name).read_text(encoding="utf-8", errors="ignore")
            used.update(ord(char) for char in text if ord(char) >= 0x2E80 and ord(char) in cmap)
    return used


def split_rest(codepoints: list[int], count: int) -> list[list[int]]:
    size = -(-len(codepoints) // count)
    return [codepoints[index:index + size] for index in range(0, len(codepoints), size)]


def unicode_range(codepoints: list[int]) -> str:
    ranges, start, previous = [], None, None
    for cp in sorted(codepoints):
        if start is None:
            start = previous = cp
        elif cp == previous + 1:
            previous = cp
        else:
            ranges.append((start, previous))
            start = previous = cp
    if start is not None:
        ranges.append((start, previous))
    return ", ".join(f"U+{low:X}" if low == high else f"U+{low:X}-{high:X}" for low, high in ranges)


def subset_woff2(source: bytes, codepoints: list[int]) -> bytes:
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    options.recalc_timestamp = False
    font = TTFont(BytesIO(source))
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)
    output = BytesIO()
    font.flavor = "woff2"
    font.save(output, reorderTables=False)
    return output.getvalue()


def build(root: Path = ROOT, rest_slice_count: int = REST_SLICE_COUNT) -> list[dict]:
    # 先把 woff2 解码成 TTF 一次：逐片从 woff2 重建 glyf 既慢又占内存。
    decoded = TTFont(root / SOURCE_FONT)
    cmap = decoded.getBestCmap()
    decoded.flavor = None
    buffer = BytesIO()
    decoded.save(buffer, reorderTables=False)
    source = buffer.getvalue()
    del decoded, buffer
    primary = sorted(collect_used_codepoints(root, cmap))
    primary_set = set(primary)
    rest = sorted(cp for cp in cmap if cp not in primary_set)
    slices = [primary, *split_rest(rest, rest_slice_count)]
    slice_dir = root / SLICE_DIR
    slice_dir.mkdir(parents=True, exist_ok=True)
    for stale in slice_dir.glob("*.woff2"):
        stale.unlink()
    records, css = [], [CSS_HEADER]
    for index, codepoints in enumerate(slices):
        name = f"NotoSerifSC-400.s{index:02d}.woff2"
        data = subset_woff2(source, codepoints)
        (slice_dir / name).write_bytes(data)
        gc.collect()
        records.append({"file": name, "codepoints": len(codepoints), "bytes": len(data)})
        css.append(
            "\n@font-face {\n"
            f'  font-family: "{FAMILY}";\n'
            "  font-style: normal;\n"
            "  font-weight: 400;\n"
            "  font-display: swap;\n"
            f'  src: url("../{(SLICE_DIR / name).as_posix()}") format("woff2");\n'
            f"  unicode-range: {unicode_range(codepoints)};\n"
            "}\n"
        )
    (root / CSS_PATH).write_bytes("".join(css).encode("utf-8"))
    return records


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--rest-slices", type=int, default=REST_SLICE_COUNT)
    args = parser.parse_args(argv)
    records = build(rest_slice_count=args.rest_slices)
    total = sum(record["bytes"] for record in records)
    for record in records:
        print(f"{record['file']}: {record['codepoints']} codepoints, {record['bytes']} bytes")
    print(f"{len(records)} slices, {total} bytes total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
