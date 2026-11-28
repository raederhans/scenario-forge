from __future__ import annotations

import json
import unittest
from pathlib import Path

import numpy as np

from tools import build_landing_hgo_zoom as hgo_zoom


REPO_ROOT = Path(__file__).resolve().parents[1]
ASSETS = REPO_ROOT / "landing" / "assets"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def blend(rgb: tuple[int, int, int], coverage: float) -> list[int]:
    alpha = coverage * hgo_zoom.BORDER_OPACITY
    return [round(c * (1 - alpha) + b * alpha) for c, b in zip(rgb, hgo_zoom.BORDER_RGB)]


class HgoZoomRenderTest(unittest.TestCase):
    """A 6x4 map: states 10 and 11 belong to country A, state 12 to B, one pixel is empty."""

    def setUp(self) -> None:
        self.core = {
            "provinceIds": [None, 0, 1, 2],
            "provinceStateIds": [None, 10, 11, 12],
            "states": [
                {"id": 10, "entityTag": "AAA"},
                {"id": 11, "entityTag": "AAA"},
                {"id": 12, "entityTag": "BBB"},
            ],
            "entities": [
                {"tag": "AAA", "color": "#204060"},
                {"tag": "BBB", "color": "#c08020"},
            ],
        }
        self.ids = np.array(
            [
                [1, 1, 1, 2, 3, 3],
                [1, 1, 1, 2, 3, 3],
                [1, 1, 1, 2, 3, 0],
                [1, 1, 1, 2, 3, 3],
            ],
            dtype=np.uint16,
        )

    def test_fills_states_with_owner_colour_and_blends_borders(self) -> None:
        rgb = hgo_zoom.render_native(self.ids, self.core)
        state_cover = 0.35
        country_cover = 0.4375
        self.assertEqual(rgb[1, 1].tolist(), [0x20, 0x40, 0x60])  # interior of state 10
        self.assertEqual(rgb[1, 2].tolist(), blend((0x20, 0x40, 0x60), state_cover))  # next to state 11, same country
        self.assertEqual(rgb[1, 3].tolist(), blend((0x20, 0x40, 0x60), country_cover))  # state 11 next to country B
        self.assertEqual(rgb[1, 4].tolist(), blend((0xC0, 0x80, 0x20), country_cover))
        self.assertEqual(rgb[0, 0].tolist(), blend((0x20, 0x40, 0x60), country_cover))  # the map edge counts as a border
        self.assertEqual(rgb[2, 5].tolist(), list(hgo_zoom.NO_PROVINCE_RGB))  # empty pixels get no border

    def test_checked_in_metadata_matches_the_dataset(self) -> None:
        metadata = read_json(ASSETS / "hgo-zoom.json")
        manifest = read_json(hgo_zoom.DATASET / "manifest.json")
        self.assertEqual(metadata["dataset"]["revision"], manifest["revision"], "re-run tools/build_landing_hgo_zoom.py")



class MapStageAssetTest(unittest.TestCase):
    def test_every_atom_has_an_owner_in_every_state(self) -> None:
        # Topologies disagree on coastlines (TNO replaces Mediterranean islands with
        # Atlantropa land); an unmatched piece would render in the fallback grey.
        payload = read_json(ASSETS / "history-scrubber.json")
        for state_index, state in enumerate(payload["states"]):
            ownerless = [atom["o"] for atom in payload["atoms"] if atom["o"][state_index] is None]
            self.assertEqual(ownerless, [], f"pieces without an owner in {state['id']}")


if __name__ == "__main__":
    unittest.main()
