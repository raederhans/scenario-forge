from __future__ import annotations

import gzip
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from tools import build_landing_hgo_zoom as hgo_zoom
from tools import build_landing_history_scrubber as scrubber


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

    def test_build_writes_images_and_page_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            dataset = Path(temp) / "dataset"
            output = Path(temp) / "out"
            dataset.mkdir()
            ids = np.tile(self.ids, (4, 4))
            (dataset / "core.json").write_text(json.dumps(self.core), encoding="utf-8")
            (dataset / "ids.u16.gz").write_bytes(gzip.compress(ids.astype("<u2").tobytes()))
            manifest = {
                "id": "fixture",
                "revision": "r1",
                "assets": {"core": {"url": "core.json"}, "ids": {"url": "ids.u16.gz"}},
                "coordinateSpace": {"width": ids.shape[1], "height": ids.shape[0]},
                "stats": {"stateCount": 3, "waterStateCount": 0, "provinceCount": 3},
            }
            (dataset / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

            metadata = hgo_zoom.build(dataset, output)

            self.assertEqual(metadata["counts"], {"states": 3, "water_states": 0, "provinces": 3})
            self.assertEqual(metadata["native"], {"width": 24, "height": 16})
            with Image.open(output / "hgo-world.webp") as world:
                self.assertEqual(world.size, (12, 8))
            self.assertTrue((output / "hgo-europe.webp").exists())
            self.assertEqual(read_json(output / "hgo-zoom.json"), metadata)

    def test_checked_in_metadata_matches_the_dataset(self) -> None:
        metadata = read_json(ASSETS / "hgo-zoom.json")
        manifest = read_json(hgo_zoom.DATASET / "manifest.json")
        self.assertEqual(metadata["dataset"]["revision"], manifest["revision"], "re-run tools/build_landing_hgo_zoom.py")
        self.assertEqual(metadata["counts"]["states"], manifest["stats"]["stateCount"])
        detail = metadata["detail"]
        focus = metadata["focus"]
        self.assertTrue(detail["x"] <= focus["x"] < detail["x"] + detail["width"])
        self.assertTrue(detail["y"] <= focus["y"] < detail["y"] + detail["height"])
        with Image.open(ASSETS / "hgo-europe.webp") as image:
            self.assertEqual(image.size, (detail["width"], detail["height"]))


class MapStageAssetTest(unittest.TestCase):
    def test_atom_colours_follow_each_states_owner(self) -> None:
        payload = read_json(ASSETS / "history-scrubber.json")
        self.assertEqual([state["id"] for state in payload["states"]], ["1936", "1939", "1962", "modern"])
        countries = []
        for _state, _family, manifest_path in scrubber.STATES:
            paths = scrubber.hero.scenario_paths(manifest_path)
            countries.append(read_json(paths["countries"])["countries"])

        changed = 0
        for atom in payload["atoms"]:
            self.assertEqual(len(atom["c"]), len(scrubber.STATES))
            for state_index, (tag, colour) in enumerate(zip(atom["o"], atom["c"])):
                expected = scrubber.hero.clamp_hex((countries[state_index].get(tag) or {}).get("color_hex"), "#3a4a45") if tag else "#3a4a45"
                state_id = payload["states"][state_index]["id"]
                self.assertEqual(colour, expected, f"{tag} in {state_id}: re-run tools/build_landing_history_scrubber.py")
            changed += len(set(atom["o"])) > 1
        self.assertGreater(changed, len(payload["atoms"]) // 2, "most atoms should change owner across the states")

    def test_every_state_has_borders_labels_and_names(self) -> None:
        payload = read_json(ASSETS / "history-scrubber.json")
        state_count = len(payload["states"])
        self.assertEqual(len(payload["borders"]), state_count)
        self.assertEqual(len(payload["labels"]), state_count)
        self.assertEqual(len(payload["names"]), state_count)
        for borders, labels in zip(payload["borders"], payload["labels"]):
            self.assertTrue(borders.startswith("M"))
            self.assertGreater(len(labels), 10)
            self.assertTrue(all(label["t"] and label["z"] for label in labels))
        modern_names = {label["t"] for label in payload["labels"][3]}
        self.assertNotIn("Greater German Reich", modern_names, "TNO-only names must not leak into Modern World")
        land = payload["atlantropa"]["land"]
        self.assertTrue(land, "1962 needs the reclaimed Atlantropa land")
        self.assertTrue(all(group["o"] and group["c"].startswith("#") for group in land), "Atlantropa land is coloured by owner")

    def test_every_atom_has_an_owner_in_every_state(self) -> None:
        # Topologies disagree on coastlines (TNO replaces Mediterranean islands with
        # Atlantropa land); an unmatched piece would render in the fallback grey.
        payload = read_json(ASSETS / "history-scrubber.json")
        for state_index, state in enumerate(payload["states"]):
            ownerless = [atom["o"] for atom in payload["atoms"] if atom["o"][state_index] is None]
            self.assertEqual(ownerless, [], f"pieces without an owner in {state['id']}")

    def test_context_layers_are_present(self) -> None:
        payload = read_json(ASSETS / "history-scrubber.json")
        self.assertTrue(payload["rail"] and all(chunk.startswith("M") for chunk in payload["rail"]))
        cities = payload["cities"]
        self.assertGreater(len(cities), 20)
        self.assertTrue(all(city["n"] and city["z"] and 0 <= city["x"] <= payload["width"] and 0 <= city["y"] <= payload["height"] for city in cities))
        self.assertEqual(cities, sorted(cities, key=lambda city: -(city["p"] + (2_000_000 if city["cap"] else 0))))


if __name__ == "__main__":
    unittest.main()
