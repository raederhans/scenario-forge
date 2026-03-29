from __future__ import annotations

from pathlib import Path
import unittest
from unittest.mock import patch

from tools import scenario_chunk_assets


class ScenarioChunkAssetsTest(unittest.TestCase):
    def test_write_json_wraps_permission_error_with_actionable_message(self) -> None:
        target = Path("C:/tmp/political.detail.country.rur.json")
        with patch.object(
            scenario_chunk_assets,
            "write_json_atomic",
            side_effect=PermissionError("WinError 5"),
        ):
            with self.assertRaisesRegex(PermissionError, "Scenario chunk write is blocked"):
                scenario_chunk_assets._write_json(target, {"type": "FeatureCollection", "features": []})


if __name__ == "__main__":
    unittest.main()
