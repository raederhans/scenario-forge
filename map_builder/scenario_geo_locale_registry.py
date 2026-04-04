from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

GEO_LOCALE_BUILDER_BY_SCENARIO: dict[str, Path] = {
    "tno_1962": ROOT / "tools" / "build_tno_1962_geo_locale_patch.py",
}


def get_registered_geo_locale_builder_path(scenario_id: str) -> Path | None:
    registered_builder_path = GEO_LOCALE_BUILDER_BY_SCENARIO.get(str(scenario_id or "").strip())
    if not registered_builder_path:
        return None
    return Path(registered_builder_path)
