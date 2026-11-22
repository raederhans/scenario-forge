"""Extract the 1897 district polygons used by the RCW membership rules."""
import argparse
import json
from pathlib import Path

import geopandas as gpd
import shapely
from shapely.geometry import mapping, shape


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path("C:/Users/raede/Desktop/dev/mapcreator/.runtime/tmp/rcw/ristat/districts.gpkg")
OUTPUT = ROOT / "data/scenario-rules/rcw.sources/units_1897.geojson"
FIELDS = ["prov_ENG", "Name_ENG", "Name_RU"]


def extract(source):
    frame = gpd.read_file(source, columns=FIELDS).to_crs(4326)
    frame["unit_key"] = frame.prov_ENG + "/" + frame.Name_ENG
    frame = frame.sort_values("unit_key")
    polygons = shapely.set_precision(frame.geometry.array, 0.0001)
    polygons = shapely.coverage_simplify(polygons, 0.012)
    features = [
        {"type": "Feature", "properties": props, "geometry": mapping(polygon)}
        for props, polygon in zip(frame[[*FIELDS, "unit_key"]].to_dict("records"), polygons)
    ]
    return {"type": "FeatureCollection", "features": features}


def validate(payload):
    if payload["type"] != "FeatureCollection" or len(payload["features"]) != 824:
        raise ValueError("Expected the 824 RISTAT districts")
    keys = set()
    for feature in payload["features"]:
        props = feature["properties"]
        key = props["unit_key"]
        polygon = shape(feature["geometry"])
        if (feature["type"] != "Feature" or not all(props[field] for field in FIELDS)
                or key != f"{props['prov_ENG']}/{props['Name_ENG']}" or key in keys
                or polygon.geom_type not in {"MultiPolygon", "Polygon"}
                or polygon.is_empty or not polygon.is_valid or polygon.area <= 0):
            raise ValueError(f"Invalid district: {key}")
        keys.add(key)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        checked_in = OUTPUT.read_bytes()
        validate(json.loads(checked_in))
        if not args.source.exists():
            print("Validated 824 checked-in districts")
            return
    payload = extract(args.source)
    validate(payload)
    data = (json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode()
    if args.check:
        if data != checked_in:
            raise SystemExit("Checked-in districts differ from the source extraction")
    else:
        OUTPUT.write_bytes(data)
    print(f"Verified 824 districts, {len(data)} bytes")


if __name__ == "__main__":
    main()
