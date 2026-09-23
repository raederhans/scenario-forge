from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS_DIR = ROOT / "landing" / "assets"
RUNTIME_DIR = ROOT / ".runtime" / "tmp" / "landing-raster"
SVGO_CONFIG = ROOT / "tools" / "svgo.landing.config.mjs"

RASTER_TARGETS = (
    ("hero-blank.svg", "hero-blank.webp", 1960, 1360, 70),
    ("hero-hoi4-1936.svg", "hero-hoi4-1936.webp", 1960, 1360, 74),
    ("hero-hoi4-1939.svg", "hero-hoi4-1939.webp", 1960, 1360, 74),
    ("hero-tno-1962.svg", "hero-tno-1962.webp", 1960, 1360, 72),
    ("japan-preview-transport.svg", "japan-preview-transport.webp", 2040, 1320, 72),
    ("japan-preview-cities.svg", "japan-preview-cities.webp", 2040, 1320, 72),
    ("japan-preview-terrain.svg", "japan-preview-terrain.webp", 2040, 1320, 72),
    ("japan-preview-night.svg", "japan-preview-night.webp", 2040, 1320, 72),
    ("template-blank.svg", "template-blank.webp", 1120, 720, 76),
    ("template-modern.svg", "template-modern.webp", 1120, 720, 76),
    ("template-hoi4.svg", "template-hoi4.webp", 1120, 720, 76),
    ("template-tno.svg", "template-tno.webp", 1120, 720, 76),
    ("showcase-final-map.svg", "showcase-final-map.webp", 1120, 720, 76),
    ("work-alt-history-med.svg", "work-alt-history-med.webp", 2240, 1440, 78),
    ("work-scenario-switch-europe.svg", "work-scenario-switch-europe.webp", 1360, 880, 78),
    ("work-atlas-japan-corridor.svg", "work-atlas-japan-corridor.webp", 1360, 880, 78),
)

# Social cards are consumed as PNG by the Open Graph and Twitter metadata. Keep
# this separate so the existing 16 SVG-to-WebP delivery targets remain stable.
PNG_RASTER_TARGETS = (
    ("social-preview.svg", "social-preview.png", 1200, 630, 100),
)

ALL_RASTER_TARGETS = (*RASTER_TARGETS, *PNG_RASTER_TARGETS)


def optimize_svg_file(target: Path) -> None:
    npx = shutil.which("npx")
    if not npx:
        raise RuntimeError("npx is required to optimize landing SVG assets")
    if not SVGO_CONFIG.is_file():
        raise FileNotFoundError(f"Missing SVGO config: {SVGO_CONFIG}")
    subprocess.run(
        [npx, "--yes", "svgo@4.0.1", "--config", str(SVGO_CONFIG), str(target), "-o", str(target)],
        cwd=ROOT,
        check=True,
    )


def run_svgo(selected_sources: set[str] | None = None) -> None:
    for name in (
        "europe-1936-showcase.svg",
        "work-alt-history-med.svg",
        "work-scenario-switch-europe.svg",
        "work-atlas-japan-corridor.svg",
    ):
        if selected_sources is None or name in selected_sources:
            optimize_svg_file(ASSETS_DIR / name)


def build_playwright_script(targets: list[dict[str, str | int]]) -> str:
    return f"""
const {{ chromium }} = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const targets = {json.dumps(targets)};

(async () => {{
  const browser = await chromium.launch();
  const page = await browser.newPage({{ viewport: {{ width: 64, height: 64 }}, deviceScaleFactor: 1 }});
  for (const target of targets) {{
    await page.setViewportSize({{ width: target.width, height: target.height }});
    const sourcePath = path.resolve(target.source);
    const svg = fs.readFileSync(sourcePath, "utf8")
      .replace(/<\\?xml[^>]*>/, "")
      .replace(/<!DOCTYPE[^>]*>/, "");
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html, body {{ margin: 0; width: ${{target.width}}px; height: ${{target.height}}px; overflow: hidden; background: transparent; }}
      body > svg {{ display: block; width: ${{target.width}}px; height: ${{target.height}}px; }}
    </style></head><body>${{svg}}</body></html>`;
    await page.setContent(html, {{ waitUntil: "load" }});
    await page.waitForSelector("svg");
    await page.screenshot({{ path: target.png, omitBackground: true, animations: "disabled" }});
  }}
  await browser.close();
}})().catch((error) => {{
  console.error(error);
  process.exit(1);
}});
"""


def rasterize_targets(selected_sources: set[str] | None = None) -> int:
    from PIL import Image

    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    targets: list[dict[str, str | int]] = []
    selected_targets = [
        target for target in ALL_RASTER_TARGETS
        if selected_sources is None or target[0] in selected_sources
    ]
    for source_name, output_name, width, height, quality in selected_targets:
        source = ASSETS_DIR / source_name
        if not source.is_file():
            raise FileNotFoundError(f"Missing landing SVG source: {source}")
        targets.append(
            {
                "source": str(source),
                "png": str(RUNTIME_DIR / f"{Path(output_name).stem}.png"),
                "width": width,
                "height": height,
                "quality": quality,
            }
        )

    script_path = RUNTIME_DIR / "render-svg-targets.cjs"
    script_path.write_text(build_playwright_script(targets), encoding="utf-8")
    subprocess.run(["node", str(script_path)], cwd=ROOT, check=True)

    for target, (_source_name, output_name, _width, _height, quality) in zip(targets, selected_targets):
        output_path = ASSETS_DIR / output_name
        with Image.open(str(target["png"])) as image:
            if output_path.suffix.lower() == ".png":
                image.save(output_path, "PNG")
            else:
                image.save(output_path, "WEBP", quality=quality, method=6)
    return len(selected_targets)


def main() -> None:
    parser = argparse.ArgumentParser(description="Optimize and rasterize landing SVG assets")
    parser.add_argument("--source", action="append", choices=[target[0] for target in ALL_RASTER_TARGETS])
    args = parser.parse_args()
    selected_sources = set(args.source) if args.source else None
    run_svgo(selected_sources)
    count = rasterize_targets(selected_sources)
    print(f"[rasterize_landing_assets] wrote {count} raster asset(s)")


if __name__ == "__main__":
    main()
