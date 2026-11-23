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
ADM2_DIR = SOURCE.parents[1] / "adm2"
ADM2_OUTPUT = OUTPUT.with_name("adm2_units.geojson")
ADM2_COUNTS = {"KAZ": 174, "KGZ": 41, "LTU": 60, "TJK": 58, "TKM": 59, "UZB": 199}


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


def extract_adm2(path):
    frame = gpd.read_file(path, columns=["shapeName", "shapeGroup", "shapeID"]).to_crs(4326)
    frame["shapeName"] = frame.shapeName.astype(object).where(frame.shapeName.notna(), None)
    frame["unit_key"] = frame.shapeGroup + "/" + frame.shapeID
    frame = frame.sort_values("unit_key")
    polygons = shapely.coverage_simplify(shapely.set_precision(frame.geometry.array, 0.0001), 0.012)
    return [{"type": "Feature", "properties": props, "geometry": mapping(polygon)}
            for props, polygon in zip(frame.drop(columns="geometry").to_dict("records"), polygons)]


def serialized(payload):
    return (json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False) + "\n").encode()


def prepare_adm2(directory, check):
    stored = json.loads(ADM2_OUTPUT.read_bytes()) if check else None
    features = []
    for country, count in ADM2_COUNTS.items():
        path = directory / f"geoBoundaries-{country}-ADM2.geojson"
        if check and not path.exists():
            rows = [f for f in stored["features"] if f["properties"]["shapeGroup"] == country]
        else:
            rows = extract_adm2(path)
        keys = set()
        for row in rows:
            props = row["properties"]
            key = props["unit_key"]
            polygon = shape(row["geometry"])
            if (row["type"] != "Feature" or key != f"{country}/{props['shapeID']}" or key in keys
                    or props["shapeGroup"] != country or polygon.geom_type not in {"Polygon", "MultiPolygon"}
                    or polygon.is_empty or not polygon.is_valid):
                raise ValueError(f"Invalid ADM2 district: {key}")
            keys.add(key)
        if len(keys) != count:
            raise ValueError(f"Expected {count} ADM2 districts in {country}")
        features.extend(rows)
    data = serialized({"type": "FeatureCollection", "features": features})
    if check:
        if data != ADM2_OUTPUT.read_bytes():
            raise SystemExit("Checked-in ADM2 districts differ from the source extraction")
    else:
        ADM2_OUTPUT.write_bytes(data)
    print(f"Verified {len(features)} ADM2 districts, {len(data)} bytes")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--adm2-dir", type=Path, default=ADM2_DIR)
    args = parser.parse_args()
    prepare_adm2(args.adm2_dir, args.check)
    if args.check:
        checked_in = OUTPUT.read_bytes()
        validate(json.loads(checked_in))
        if not args.source.exists():
            print("Validated 824 checked-in districts")
            return
    payload = extract(args.source)
    validate(payload)
    data = serialized(payload)
    if args.check:
        if data != checked_in:
            raise SystemExit("Checked-in districts differ from the source extraction")
    else:
        OUTPUT.write_bytes(data)
    print(f"Verified 824 districts, {len(data)} bytes")


if __name__ == "__main__":
    main()
