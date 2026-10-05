"""Lossless download transport; canonical pack generation and identity stay unchanged.

python -m tools.river_partitions.compact_transport INPUT.json OUTPUT.transport.json
"""
import argparse
import json
import math
from pathlib import Path
import re
import struct

TRANSPORT_KIND = "river-paint-indexed-coordinates"
MAX_COORDINATES = 250000
MAX_PARENTS = 512
MAX_CELLS = 8192
MAX_CELLS_PER_PARENT = 128
MAX_SUPPORT = 2048
PACK_FIELDS = ("schemaVersion", "kind", "packId", "sceneId", "algorithmVersion",
               "coordinateIdentityPrecision", "geometryWinding", "source", "parents", "support")
SOURCE_FIELDS = ("landPath", "landDigest", "riverPath", "riverDigest", "baseCommit", "baselineHash")


def _fail(message):
    raise ValueError(f"River partition transport: {message}")


def _record(value, keys, required=None):
    if type(value) is not dict or any(key not in keys for key in value):
        _fail("invalid record or unknown field")
    if any(key not in value for key in (keys if required is None else required)):
        _fail("missing record field")


def _array(value, minimum, maximum, label):
    if type(value) is not list or not minimum <= len(value) <= maximum:
        _fail(f"invalid {label} count")


def _id(value):
    return type(value) is str and 0 < len(value) <= 256


def _digest(value):
    return type(value) is str and re.fullmatch(r"sha256:[0-9a-f]{64}", value) is not None


def _point(value):
    _array(value, 2, 2, "coordinate dimensions")
    if (any(type(n) not in (int, float) for n in value) or abs(value[0]) > 180 or abs(value[1]) > 80
            or any(not math.isfinite(n) for n in value)):
        _fail("invalid coordinate table point")


def _validate(pack, table=None):
    _record(pack, PACK_FIELDS)
    if (type(pack["schemaVersion"]) is not int or pack["schemaVersion"] != 1
            or pack["kind"] != "river-paint-partitions" or not _digest(pack["packId"]) or not _id(pack["sceneId"])
            or pack["algorithmVersion"] != "river-joint-noding-v1"
            or type(pack["coordinateIdentityPrecision"]) is not int or pack["coordinateIdentityPrecision"] != 7
            or pack["geometryWinding"] != "d3-clockwise-exterior"):
        _fail("unsupported pack contract")
    source = pack["source"]
    _record(source, (*SOURCE_FIELDS, "riverNames", "includeLakeCenterlines"), ())
    for key in SOURCE_FIELDS:
        if key in source and (type(source[key]) is not str or len(source[key]) > 1024):
            _fail("invalid source")
    if "riverNames" in source:
        _array(source["riverNames"], 0, 100, "river names")
        if any(not _id(name) for name in source["riverNames"]):
            _fail("invalid river name")
    if "includeLakeCenterlines" in source and type(source["includeLakeCenterlines"]) is not bool:
        _fail("invalid source flag")
    _array(pack["parents"], 1, MAX_PARENTS, "parent")
    _array(pack["support"], 0, MAX_SUPPORT, "support")
    references = cells = 0

    def geometry(raw):
        nonlocal references
        _record(raw, ("type", "coordinates"))
        if raw["type"] not in ("Polygon", "MultiPolygon"):
            _fail("invalid geometry type")
        polygons = [raw["coordinates"]] if raw["type"] == "Polygon" else raw["coordinates"]
        _array(polygons, 1, (MAX_COORDINATES - references) // 4, "polygon")
        for rings in polygons:
            _array(rings, 1, (MAX_COORDINATES - references) // 4, "ring")
            for ring in rings:
                _array(ring, 4, MAX_COORDINATES - references, "coordinate reference")
                references += len(ring)
                for point in ring:
                    if table is None:
                        _point(point)
                    elif type(point) is not int or not 0 <= point < len(table):
                        _fail("invalid coordinate index")

    for parent in pack["parents"]:
        _record(parent, ("parentId", "parentFingerprint", "parentGeometry", "cells"))
        if not _id(parent["parentId"]) or not _digest(parent["parentFingerprint"]):
            _fail("invalid parent")
        _array(parent["cells"], 2, MAX_CELLS_PER_PARENT, "cell")
        cells += len(parent["cells"])
        if cells > MAX_CELLS:
            _fail("cell budget exceeded")
        geometry(parent["parentGeometry"])
        for cell in parent["cells"]:
            _record(cell, ("id", "geometry", "geometryFingerprint"))
            if not _id(cell["id"]) or not _digest(cell["geometryFingerprint"]):
                _fail("invalid cell")
            geometry(cell["geometry"])
    for item in pack["support"]:
        _record(item, ("parentId", "parentFingerprint", "parentGeometry", "geometry", "geometryFingerprint"))
        if not _id(item["parentId"]) or not _digest(item["parentFingerprint"]) or not _digest(item["geometryFingerprint"]):
            _fail("invalid support")
        geometry(item["parentGeometry"])
        geometry(item["geometry"])
    if table is not None and len(table) > references:
        _fail("coordinate table exceeds reference count")


def _map_pack(pack, point):
    def geometry(raw):
        def ring(values):
            return [point(value) for value in values]
        coordinates = raw["coordinates"]
        return {"type": raw["type"], "coordinates": [ring(r) for r in coordinates] if raw["type"] == "Polygon"
                else [[ring(r) for r in rings] for rings in coordinates]}

    source = dict(pack["source"])
    if "riverNames" in source:
        source["riverNames"] = list(source["riverNames"])
    return {**pack, "source": source,
            "parents": [{**parent, "parentGeometry": geometry(parent["parentGeometry"]),
                         "cells": [{**cell, "geometry": geometry(cell["geometry"])} for cell in parent["cells"]]}
                        for parent in pack["parents"]],
            "support": [{**item, "parentGeometry": geometry(item["parentGeometry"]), "geometry": geometry(item["geometry"])}
                        for item in pack["support"]]}


def encode_transport(pack):
    """Index exact binary64 coordinates without rounding, sorting or ring edits."""
    _validate(pack)
    table, indexes = [], {}

    def index(point):
        # Binary keys preserve signed zero; numeric equality alone merges it.
        key = struct.pack(">dd", *point)
        if key not in indexes:
            indexes[key] = len(table)
            table.append(list(point))
        return indexes[key]

    indexed_pack = _map_pack(pack, index)
    return {"transportVersion": 1, "kind": TRANSPORT_KIND, "coordinates": table, "pack": indexed_pack}


def decode_transport(value):
    """Preflight bounded references before allocating expanded coordinate arrays."""
    if type(value) is dict and value.get("kind") == "river-paint-partitions" and "transportVersion" not in value:
        return value
    _record(value, ("transportVersion", "kind", "coordinates", "pack"))
    if type(value["transportVersion"]) is not int or value["transportVersion"] != 1 or value["kind"] != TRANSPORT_KIND:
        _fail("unsupported transport contract")
    table = value["coordinates"]
    _array(table, 1, MAX_COORDINATES, "coordinate table")
    for point in table:
        _point(point)
    _validate(value["pack"], table)
    return _map_pack(value["pack"], lambda index: list(table[index]))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args(argv)
    if args.input.resolve() == args.output.resolve():
        parser.error("output must differ from the canonical input")
    # JSON's integer token -0 is a negative zero in JS; Python's default int
    # parser would erase its sign before coordinate indexing.
    pack = json.loads(args.input.read_text(encoding="utf-8"),
                      parse_int=lambda token: -0.0 if token == "-0" else int(token))
    transport = encode_transport(pack)
    payload = json.dumps(transport, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(payload.encode("utf-8"))
    print(json.dumps({"input": str(args.input), "output": str(args.output),
                      "transportBytes": len(payload.encode("utf-8")), "uniqueCoordinates": len(transport["coordinates"])}))


if __name__ == "__main__":
    main()
