"""Render the landing page's HGO zoom images from the committed HGO dataset.

The images reproduce what HGO Atlas exports for an unedited project with the
label and city layers off: every state filled with its owner's colour and
state borders blended in the editor's default border colour. Rendering here
instead of driving the editor keeps the build offline and free of GPU drivers.

Outputs (landing/assets):
  hgo-world.webp   whole map at half resolution
  hgo-europe.webp  lossless native-pixel crop that the page zooms into
  hgo-zoom.json    image placement, zoom focus and dataset counts for the page
"""
from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

import numpy as np
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[1]
DATASET = REPO_ROOT / "apps" / "hgo" / "assets" / "default"
OUTPUT = REPO_ROOT / "landing" / "assets"

# Mirrors apps/hgo/src/render/renderer.js and settings.js defaults.
NO_PROVINCE_RGB = (31, 38, 46)  # vec3(.12,.15,.18)
BORDER_RGB = (0x1F, 0x29, 0x33)
BORDER_OPACITY = 0.45
BORDER_WIDTH = 0.7
COUNTRY_BORDER_FACTOR = 1.25

WORLD_SCALE = 2
DETAIL_CROP = (2400, 420, 1040, 650)  # x, y, width, height in native pixels: Central Europe
ZOOM_FOCUS = (2838, 688)  # Danzig and East Prussia, shown at pixel scale


def border_coverage(width: float) -> float:
    # The editor samples each export pixel at its centre (distance 0.5, pixel ratio 1).
    return min(1.0, max(0.0, min(2.0, width) * 0.5 + 0.5 - 0.5))


def render_native(ids: np.ndarray, core: dict) -> np.ndarray:
    """Return an RGB uint8 array for province codes `ids` (height x width)."""
    states = core["states"]
    entities = {entity["tag"]: entity for entity in core["entities"]}
    state_index = {state["id"]: index + 1 for index, state in enumerate(states)}
    state_owner = {state["id"]: state["entityTag"] for state in states}
    owner_index = {tag: index + 1 for index, tag in enumerate(sorted(set(state_owner.values())))}

    code_count = len(core["provinceIds"])
    code_state = np.zeros(code_count, dtype=np.int32)
    code_owner = np.zeros(code_count, dtype=np.int32)
    code_rgb = np.zeros((code_count, 3), dtype=np.float32)
    code_rgb[:] = NO_PROVINCE_RGB
    for code, state_id in enumerate(core["provinceStateIds"]):
        if code == 0 or state_id is None:
            continue
        tag = state_owner[state_id]
        code_state[code] = state_index[state_id]
        code_owner[code] = owner_index[tag]
        color = entities[tag]["color"]
        code_rgb[code] = [int(color[i:i + 2], 16) for i in (1, 3, 5)]

    state = code_state[ids]
    owner = code_owner[ids]
    coverage = np.zeros(ids.shape, dtype=np.float32)
    state_cover = border_coverage(BORDER_WIDTH)
    country_cover = border_coverage(BORDER_WIDTH * COUNTRY_BORDER_FACTOR)
    padded_state = np.pad(state, 1)
    padded_owner = np.pad(owner, 1)
    height, width = ids.shape
    for dy, dx in ((0, -1), (0, 1), (-1, 0), (1, 0)):
        neighbour_state = padded_state[1 + dy:1 + dy + height, 1 + dx:1 + dx + width]
        neighbour_owner = padded_owner[1 + dy:1 + dy + height, 1 + dx:1 + dx + width]
        edge = neighbour_state != state
        cover = np.where(neighbour_owner != owner, country_cover, state_cover)
        coverage = np.maximum(coverage, np.where(edge, cover, 0.0))
    coverage[ids == 0] = 0.0

    alpha = (coverage * BORDER_OPACITY)[..., None]
    rgb = code_rgb[ids] * (1 - alpha) + np.array(BORDER_RGB, dtype=np.float32) * alpha
    return np.clip(np.rint(rgb), 0, 255).astype(np.uint8)


def load_dataset(dataset: Path) -> tuple[dict, dict, np.ndarray]:
    manifest = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))
    core = json.loads((dataset / manifest["assets"]["core"]["url"]).read_text(encoding="utf-8"))
    space = manifest["coordinateSpace"]
    raw = gzip.decompress((dataset / manifest["assets"]["ids"]["url"]).read_bytes())
    ids = np.frombuffer(raw, dtype="<u2").reshape(space["height"], space["width"])
    return manifest, core, ids


def build(dataset: Path = DATASET, output: Path = OUTPUT) -> dict:
    manifest, core, ids = load_dataset(dataset)
    native = Image.fromarray(render_native(ids, core), "RGB")
    width, height = native.size

    output.mkdir(parents=True, exist_ok=True)
    world = native.resize((width // WORLD_SCALE, height // WORLD_SCALE), Image.LANCZOS)
    world.save(output / "hgo-world.webp", "WEBP", quality=82, method=6)
    x, y, crop_width, crop_height = DETAIL_CROP
    native.crop((x, y, x + crop_width, y + crop_height)).save(output / "hgo-europe.webp", "WEBP", lossless=True, method=6)

    stats = manifest["stats"]
    metadata = {
        "schema_version": 1,
        "dataset": {"id": manifest["id"], "revision": manifest["revision"]},
        "native": {"width": width, "height": height},
        "world": {"src": "./assets/hgo-world.webp", "width": world.width, "height": world.height},
        "detail": {"src": "./assets/hgo-europe.webp", "x": x, "y": y, "width": crop_width, "height": crop_height},
        "focus": {"x": ZOOM_FOCUS[0], "y": ZOOM_FOCUS[1]},
        "counts": {
            "states": stats["stateCount"],
            "water_states": stats["waterStateCount"],
            "provinces": stats["provinceCount"],
        },
    }
    (output / "hgo-zoom.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8", newline="\n")
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dataset", type=Path, default=DATASET)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    metadata = build(args.dataset, args.output)
    print(f"[build_landing_hgo_zoom] {metadata['native']['width']}x{metadata['native']['height']} -> {args.output}")


if __name__ == "__main__":
    main()
