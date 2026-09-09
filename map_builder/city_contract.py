"""Canonical city identity and WGS84 point contract, independent of GIS libraries."""
from __future__ import annotations

import math


def validate_city_features(features, *, source: str = "world_cities") -> None:
    """Reject invalid identities before aliases or city artifacts can be published."""
    ids: set[str] = set()
    stable_keys: set[str] = set()
    for index, feature in enumerate(features):
        label = f"[city-contract] {source} feature {index + 1}"
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise ValueError(f"{label}: expected Feature")
        props = feature.get("properties") or {}
        if not isinstance(props, dict):
            raise ValueError(f"{label}: expected properties object")
        for field, seen in (("id", ids), ("stable_key", stable_keys)):
            value = props.get(field)
            if not isinstance(value, str) or not value.strip() or value != value.strip():
                raise ValueError(f"{label}: missing or invalid {field}")
            if value in seen:
                raise ValueError(f"{label}: duplicate {field}: {value}")
            seen.add(value)
        geometry = feature.get("geometry") or {}
        if not isinstance(geometry, dict):
            raise ValueError(f"{label}: expected Point geometry")
        coordinates = geometry.get("coordinates")
        if geometry.get("type") != "Point" or not isinstance(coordinates, (list, tuple)) or len(coordinates) not in (2, 3):
            raise ValueError(f"{label}: expected Point coordinates")
        if any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) for n in coordinates):
            raise ValueError(f"{label}: coordinates must be finite numbers")
        if not -180 <= coordinates[0] <= 180 or not -90 <= coordinates[1] <= 90:
            raise ValueError(f"{label}: coordinates outside WGS84 bounds")
