"""Scenario GeoJSON decoding without padding every arc to the longest arc."""
from __future__ import annotations

import numpy as np
from shapely.geometry import shape
from topojson.utils import geometry, winding_order


def topology_object_to_geojson(payload: dict, object_name: str) -> dict:
    """Match topojson's default serializer while keeping arc storage ragged.

    Keep float64 conversion, delta accumulation, geometry assembly and winding
    identical to the library. Only the unused NaN padding is omitted.
    """
    transform = payload.get("transform")
    arcs = []
    for source in payload["arcs"]:
        arc = np.asarray(source, dtype=np.float64).reshape((-1, 2))
        if transform:
            arc = arc.cumsum(axis=0) * transform["scale"] + transform["translate"]
        arcs.append(arc)
    features = []
    for index, feature in enumerate(payload["objects"][object_name]["geometries"]):
        geom = winding_order(shape(geometry(feature, arcs, transform)), order="CCW_CW")
        features.append({
            "id": feature.get("id", index),
            "type": "Feature",
            "properties": feature.get("properties", {}),
            "geometry": geom.__geo_interface__,
        })
    return {"type": "FeatureCollection", "features": features}
