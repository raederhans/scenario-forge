"""Rebuild contour LOD assets from the published detail topology."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.processors.contour_lod import build_lod_assets


if __name__ == "__main__":
    print(json.dumps(build_lod_assets(ROOT / "data"), indent=2))
