"""Reproducible GHSL count integration and browser-sized population grids.

GHSL values are modelled resident counts, not density or observations.  Raster
cells are integrated by their exact planar intersection in equal-area Mollweide.
NoData is never changed into an unpopulated cell.  Dependencies: requests,
rasterio, numpy, shapely, pyproj, exactextract (0.3.0 or newer).
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import gzip
import inspect
import json
import math
from pathlib import Path
import time
import zipfile

import numpy as np
import requests
from pyproj import CRS, Transformer
import rasterio
from rasterio.windows import Window
from shapely import STRtree, make_valid, set_precision
from shapely.geometry import shape, mapping, box, GeometryCollection, LineString
from shapely.errors import GEOSException
from shapely.ops import transform, unary_union

LAYER_ID = "population_ghsl_2020_v1"
DATA_VERSION = "ghsl-r2023a-e2020-v1"
CRS_NAME = "ESRI:54009"
SOURCE_BASE = "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/"
SCENARIOS = ("modern_world", "hoi4_1936", "hoi4_1939", "tno_1962")
STATUSES = ("ok", "partial_coverage", "no_data", "invalid_geometry", "overlapping_geometry", "unestimated_scenario_land", "water_not_applicable")
TO_MOLLWEIDE = Transformer.from_crs("EPSG:4326", CRS_NAME, always_xy=True)
FROM_MOLLWEIDE = Transformer.from_crs(CRS_NAME, "EPSG:4326", always_xy=True)


def read_json(path):
    path = Path(path)
    payload = path.read_bytes()
    if path.suffix == ".gz":
        payload = gzip.decompress(payload)
    return json.loads(payload)


def write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_url(resolution=100, tile=None):
    product = f"GHS_POP_E2020_GLOBE_R2023A_54009_{resolution}_V1_0"
    directory = SOURCE_BASE + f"GHS_POP_E2020_GLOBE_R2023A_54009_{resolution}/V1-0/"
    return directory + (f"tiles/{product}_{tile}.zip" if tile else f"{product}.zip")


def download_source(url, cache, workers=8, chunk_bytes=1024 * 1024):
    """Verified range download; finished chunks survive interruption.

    Each chunk is bound to the current URL, length and ETag. Failed or truncated
    chunks remain .part and cannot be incorporated into a successful archive.
    """
    cache = Path(cache)
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / url.rsplit("/", 1)[-1]
    response = requests.head(url, timeout=(20, 60))
    response.raise_for_status()
    length = int(response.headers["Content-Length"])
    identity = {"url": url, "bytes": length, "etag": response.headers.get("ETag"), "last_modified": response.headers.get("Last-Modified")}
    parts = cache / (archive.name + ".parts")
    parts.mkdir(exist_ok=True)
    identity_path = parts / "identity.json"
    if identity_path.exists() and read_json(identity_path) != identity:
        raise ValueError("Source identity changed; use a fresh cache directory")
    write_json(identity_path, identity)
    ledger_path = archive.with_suffix(".source.json")
    if archive.exists() and ledger_path.exists():
        ledger = read_json(ledger_path)
        if ledger.get("bytes") == archive.stat().st_size == length and ledger.get("sha256") == sha256(archive):
            return archive, ledger
        raise ValueError("Existing archive failed source integrity verification")
    started = time.monotonic()
    ranges = [(i, min(i + chunk_bytes, length)) for i in range(0, length, chunk_bytes)]

    def fetch(bounds):
        start, end = bounds
        target = parts / f"{start:012d}.chunk"
        if target.exists() and target.stat().st_size == end - start:
            return
        headers = {"Range": f"bytes={start}-{end - 1}", "Accept-Encoding": "identity"}
        if identity["etag"]:
            headers["If-Range"] = identity["etag"]
        with requests.get(url, headers=headers, stream=True, timeout=(20, 120)) as result:
            result.raise_for_status()
            if result.status_code != 206 or result.headers.get("Content-Range") != f"bytes {start}-{end - 1}/{length}":
                raise ValueError("Server did not honor the exact requested range")
            temporary = target.with_suffix(".part")
            with temporary.open("wb") as output:
                for chunk in result.iter_content(128 * 1024):
                    output.write(chunk)
            if temporary.stat().st_size != end - start:
                raise ValueError("Truncated source range")
            temporary.replace(target)

    with ThreadPoolExecutor(max_workers=workers) as executor:
        for completed, _ in enumerate(executor.map(fetch, ranges), 1):
            if completed % 8 == 0 or completed == len(ranges):
                print(f"download {archive.name}: {completed}/{len(ranges)} ranges", flush=True)
    temporary = archive.with_suffix(".part")
    with temporary.open("wb") as output:
        for start, _ in ranges:
            with (parts / f"{start:012d}.chunk").open("rb") as part:
                for chunk in iter(lambda: part.read(1024 * 1024), b""):
                    output.write(chunk)
    with zipfile.ZipFile(temporary) as compressed:
        bad = compressed.testzip()
        if bad:
            raise ValueError(f"Source ZIP CRC failed: {bad}")
    temporary.replace(archive)
    ledger = {**identity, "sha256": sha256(archive), "retrieved_at": datetime.now(timezone.utc).isoformat(), "elapsed_seconds": time.monotonic() - started, "license": "CC-BY-4.0"}
    write_json(ledger_path, ledger)
    return archive, ledger


def extract_raster(archive, cache):
    with zipfile.ZipFile(archive) as source:
        names = [n for n in source.namelist() if n.lower().endswith(".tif")]
        if len(names) != 1:
            raise ValueError("Expected exactly one GHSL GeoTIFF")
        info = source.getinfo(names[0])
        target = Path(cache) / Path(names[0]).name
        if not target.exists() or target.stat().st_size != info.file_size:
            temporary = target.with_suffix(".part")
            with source.open(names[0]) as entry, temporary.open("wb") as output:
                for chunk in iter(lambda: entry.read(8 * 1024 * 1024), b""):
                    output.write(chunk)
            temporary.replace(target)
    return target


def normalize_zero_area_parts(polygons):
    """Remove only proven point/line rings, preserving every nonzero component.

    Signed ring area is insufficient: a bowtie has zero signed area yet contains
    two real lobes. A zero-area convex hull proves all ring points are collinear.
    A zero shell with nonzero holes is retained for explicit validity handling.
    """
    def zero(ring):
        if len({tuple(p[:2]) for p in ring}) <= 2:
            return True
        return LineString(ring).convex_hull.area == 0

    normalized, dropped_shells, dropped_holes = [], 0, 0
    for rings in polygons:
        if not rings or all(zero(r) for r in rings):
            dropped_shells += 1
            continue
        holes = []
        for ring in rings[1:]:
            if zero(ring):
                dropped_holes += 1
            else:
                holes.append(ring)
        normalized.append([rings[0], *holes])
    return normalized, {"shells": dropped_shells, "holes": dropped_holes}


def decode_topology(topology, object_name="political"):
    """Decode the full canonical TopoJSON, preserving ids and ring topology."""
    transform_spec = topology.get("transform")
    decoded = []
    for arc in topology.get("arcs", []):
        if transform_spec:
            x = y = 0
            points = []
            for dx, dy, *_ in arc:
                x += dx
                y += dy
                points.append((x * transform_spec["scale"][0] + transform_spec["translate"][0], y * transform_spec["scale"][1] + transform_spec["translate"][1]))
            decoded.append(points)
        else:
            decoded.append(arc)

    def ring(indices):
        result = []
        for index in indices:
            arc = decoded[index if index >= 0 else ~index]
            points = arc if index >= 0 else list(reversed(arc))
            result.extend(points if not result else points[1:])
        return result

    result, seen = [], set()
    for item in topology["objects"][object_name]["geometries"]:
        props = item.get("properties", {})
        identifier = str(props.get("id") or props.get("NUTS_ID") or item.get("id") or "").strip()
        if not identifier or identifier in seen:
            raise ValueError(f"Missing or duplicate full-topology feature id: {identifier!r}")
        seen.add(identifier)
        kind = item["type"]
        if kind == "Polygon":
            coordinates = [ring(r) for r in item["arcs"]]
        elif kind == "MultiPolygon":
            coordinates = [[ring(r) for r in p] for p in item["arcs"]]
        else:
            raise ValueError(f"Unsupported political geometry type {kind}")
        normalized, dropped = normalize_zero_area_parts([coordinates] if kind == "Polygon" else coordinates)
        coordinates = (normalized[0] if normalized else []) if kind == "Polygon" else normalized
        try:
            geometry = shape({"type": kind, "coordinates": coordinates})
            decode_error = None
        except (ValueError, IndexError) as error:
            # Degenerate rings remain explicit members with unavailable stats;
            # dropping them would falsely claim complete feature membership.
            geometry = GeometryCollection()
            decode_error = str(error)
        result.append({"id": identifier, "properties": props, "geometry": geometry, "decode_error": decode_error, "dropped_zero_area_parts": dropped})
    return result


def project_geometry(geometry):
    return transform(TO_MOLLWEIDE.transform, geometry)


def polygon_only(geometry):
    if geometry.geom_type == "GeometryCollection":
        return unary_union([polygon_only(g) for g in geometry.geoms if g.geom_type in ("Polygon", "MultiPolygon", "GeometryCollection")])
    return geometry


def prepare_features(topology, lakes=None):
    """Build a statistical 1/N partition without changing display geometry.

    Intersections with *all* neighbors split each feature into constant N pieces;
    this handles triple and higher overlaps, not just pairwise half subtraction.
    Both population and denominator area receive exactly the same weight.
    """
    entries = decode_topology(topology)
    lake_tree = STRtree(lakes) if lakes else None
    projected = []
    for entry in entries:
        geometry = entry["geometry"]
        # A longitude jump cannot safely be interpreted as a straight edge in
        # Mollweide. Do not silently repair or turn it into a globe-sized polygon.
        unsafe = geometry.is_empty
        if unsafe:
            entry["status"] = "invalid_geometry"
            entry["geometry"] = None
            continue
        for polygon in (geometry.geoms if geometry.geom_type == "MultiPolygon" else [geometry]):
            for ring in [polygon.exterior, *polygon.interiors]:
                unsafe |= any(abs(a[0] - b[0]) > 180 for a, b in zip(ring.coords, list(ring.coords)[1:]))
        if unsafe:
            entry["status"] = "invalid_geometry"
            entry["geometry"] = None
            continue
        if not geometry.is_valid:
            original_area = geometry.area
            try:
                geometry = make_valid(geometry)
            except GEOSException as error:
                entry.update(status="invalid_geometry", geometry=None, geometry_issue=str(error))
                continue
            if geometry.geom_type == "GeometryCollection":
                geometry = unary_union([g for g in geometry.geoms if g.geom_type in ("Polygon", "MultiPolygon")])
            entry["geometry_repair"] = {"method": "shapely_make_valid", "original_planar_degrees2": original_area, "repaired_planar_degrees2": geometry.area}
        geometry = project_geometry(geometry)
        if not geometry.is_valid:
            original_area = geometry.area
            try:
                geometry = make_valid(geometry)
            except GEOSException as error:
                entry.update(status="invalid_geometry", geometry=None, geometry_issue=str(error))
                continue
            if geometry.geom_type == "GeometryCollection":
                geometry = unary_union([g for g in geometry.geoms if g.geom_type in ("Polygon", "MultiPolygon")])
            entry["geometry_repair"] = {"method": "shapely_make_valid_after_projection", "original_area_m2": original_area, "repaired_area_m2": geometry.area}
        if geometry.is_empty or geometry.area <= 0 or not math.isfinite(geometry.area):
            entry["status"] = "invalid_geometry"
            entry["geometry"] = None
            continue
        if lake_tree is not None:
            candidates = [lakes[i] for i in lake_tree.query(geometry, predicate="intersects")]
            if candidates:
                geometry = geometry.difference(unary_union(candidates))
        # A common millimetre grid stabilizes GEOS overlays of near-coincident
        # projected arcs. At full double precision a valid Arctic MultiPolygon
        # produced a difference retaining an entire 38.86 km2 intersection.
        # This is statistical geometry only; runtime topology is never edited.
        previous_area = geometry.area
        geometry = set_precision(geometry, 0.001)
        entry["precision_area_delta_m2"] = geometry.area - previous_area
        entry["geometry"] = geometry
        entry["status"] = "water_not_applicable" if geometry.is_empty else "pending"
        if not geometry.is_empty:
            projected.append(entry)
    tree = STRtree([e["geometry"] for e in projected])
    overlap_pairs = []
    neighbors = [[] for _ in projected]
    for i, entry in enumerate(projected):
        for j in tree.query(entry["geometry"], predicate="intersects"):
            if j <= i:
                continue
            other = projected[j]
            overlap = entry["geometry"].intersection(other["geometry"]).area
            # Numerical overlay noise below one square metre is immaterial.
            if overlap > 1:
                overlap_pairs.append({"a": entry["id"], "b": other["id"], "area_km2": overlap / 1e6})
                neighbors[i].append(j)
                neighbors[j].append(i)
    for i, entry in enumerate(projected):
        pieces = [(entry["geometry"], 1)]
        for neighbor in neighbors[i]:
            other = projected[neighbor]["geometry"]
            next_pieces = []
            for piece, multiplicity in pieces:
                intersection = polygon_only(piece.intersection(other))
                if intersection.is_empty or intersection.area <= 0:
                    next_pieces.append((piece, multiplicity))
                    continue
                remainder = polygon_only(piece.difference(other))
                if not remainder.is_empty and remainder.area > 0:
                    next_pieces.append((remainder, multiplicity))
                next_pieces.append((intersection, multiplicity + 1))
            pieces = next_pieces
        split_area = sum(g.area for g, _ in pieces)
        # Each rounded overlay boundary can move by at most a grid-cell
        # diagonal. Bound the resulting area perturbation by boundary length,
        # grid size and operation count (not by an arbitrary relative epsilon).
        split_tolerance = max(1, entry["geometry"].length * .001 * 2 * max(1, len(pieces)))
        if abs(split_area - entry["geometry"].area) > split_tolerance:
            raise ValueError(f"Overlay failed per-feature area conservation for {entry['id']}: residual={split_area - entry['geometry'].area}, bound={split_tolerance}")
        entry["split_area_residual_m2"] = split_area - entry["geometry"].area
        entry["split_area_tolerance_m2"] = split_tolerance
        entry["pieces"] = pieces
        entry["weighted_area_m2"] = sum(g.area / n for g, n in pieces)
        entry["overlap_fraction"] = sum(g.area for g, n in pieces if n > 1) / entry["geometry"].area
    return entries, overlap_pairs


def exact_population(raster, entries):
    from exactextract import exact_extract
    from exactextract.raster import RasterioRasterSource
    features = [{"type": "Feature", "properties": {"feature_id": e["id"], "multiplicity": n}, "geometry": mapping(g)} for e in entries if e["status"] == "pending" for g, n in e.get("pieces", [(e["geometry"], 1)])]
    if not features:
        return {}
    # GeoJSONFeatureSource has no CRS; geometries here are explicitly transformed
    # to the raster's verified ESRI:54009 coordinates.
    results = exact_extract(RasterioRasterSource(raster), features, ["sum", "count"], include_cols=["feature_id", "multiplicity"], strategy="raster-sequential", max_cells_in_memory=4_000_000)
    combined = {}
    for item in results:
        props = item["properties"]
        stat = combined.setdefault(props["feature_id"], {"sum": 0., "count": 0.})
        stat["sum"] += props["sum"] / props["multiplicity"]
        stat["count"] += props["count"] / props["multiplicity"]
    return combined


def audit_partition(raster, entries, statistics):
    """Independently compare weighted features to their unpartitioned union."""
    eligible = [e for e in entries if e["status"] == "pending"]
    union = unary_union([e["geometry"] for e in eligible])
    union_stat = exact_population(raster, [{"id": "union", "geometry": union, "status": "pending"}])["union"]
    area_sum = sum(e["weighted_area_m2"] for e in eligible)
    population_sum = sum(s["sum"] for s in statistics.values())
    valid_count_sum = sum(s["count"] for s in statistics.values())
    tolerance = max(0.01, union_stat["sum"] * 1e-8)
    if abs(population_sum - union_stat["sum"]) > tolerance:
        raise ValueError(f"Feature partition does not conserve population: {population_sum} vs {union_stat['sum']}")
    if abs(area_sum - union.area) > max(1, union.area * 1e-8):
        raise ValueError("Feature partition does not conserve union land area")
    return {"partition_method": "equal_share_by_exact_overlap_multiplicity", "union_population": union_stat["sum"], "allocated_population": population_sum, "population_absolute_error": abs(population_sum - union_stat["sum"]), "population_absolute_tolerance": tolerance, "union_land_area_km2": union.area / 1e6, "allocated_land_area_km2": area_sum / 1e6, "allocated_valid_cell_equivalents": valid_count_sum, "union_valid_cell_equivalents": union_stat["count"], "count_conservation_pass": True, "repaired_geometry_count": sum(bool(e.get("geometry_repair")) for e in entries), "overlapping_feature_count": sum(e.get("overlap_fraction", 0) > 0 for e in entries), "partition_piece_count": sum(len(e.get("pieces", [])) for e in entries), "overlay_precision_m": 0.001, "precision_area_delta_m2": sum(e.get("precision_area_delta_m2", 0) for e in entries)}


def make_feature_records(entries, statistics, pixel_area_m2):
    records = {}
    for entry in entries:
        geometry, status = entry["geometry"], entry["status"]
        area = entry.get("weighted_area_m2", geometry.area) / 1e6 if geometry is not None else None
        raw_overlap = entry.get("overlap_fraction", 0.)
        row = {"population": None, "land_area_km2": area, "density": None, "coverage_fraction": None, "status": status, "source_epoch": 2020, "overlap_fraction": min(1., max(0., raw_overlap))}
        if not 0 <= raw_overlap <= 1:
            row["raw_overlap_fraction"] = raw_overlap
        if entry.get("geometry_repair"):
            row["geometry_repair"] = entry["geometry_repair"]
        if any(entry.get("dropped_zero_area_parts", {}).values()):
            row["dropped_zero_area_parts"] = entry["dropped_zero_area_parts"]
        if status == "pending":
            stat = statistics.get(entry["id"], {})
            covered = float(stat.get("count", 0)) * pixel_area_m2 / 1e6
            raw_coverage = covered / area if area else 0.0
            if raw_coverage > 1 + 1e-6:
                raise ValueError(f"Raster coverage exceeds land area for {entry['id']}: {raw_coverage}")
            coverage = min(1.0, raw_coverage)
            row["raw_coverage_fraction"] = raw_coverage
            row["coverage_fraction"] = coverage
            if covered <= 0:
                row["status"] = "no_data"
            else:
                population = float(stat["sum"])
                row.update(population=population, status="ok" if coverage >= 1 - 1e-6 else "partial_coverage")
                if row["status"] == "ok":
                    row["coverage_fraction"] = 1.0
                    row["density"] = population / area
        records[entry["id"]] = row
    return records


def aggregate_counts(values, factor, nodata=-200):
    """Sum counts and valid pixel area; never average densities or fill NoData."""
    height, width = values.shape
    out_height, out_width = math.ceil(height / factor), math.ceil(width / factor)
    valid = np.isfinite(values) & (values != nodata) & (values >= 0)
    counts = np.pad(np.where(valid, values, 0).astype(np.float64), ((0, out_height * factor - height), (0, out_width * factor - width)))
    coverage = np.pad(valid.astype(np.uint32), ((0, out_height * factor - height), (0, out_width * factor - width)))
    shape_ = (out_height, factor, out_width, factor)
    return counts.reshape(shape_).sum(axis=(1, 3)), coverage.reshape(shape_).sum(axis=(1, 3))


def validate_raster(dataset, resolution):
    if dataset.crs != CRS.from_user_input(CRS_NAME):
        raise ValueError(f"Unexpected GHSL CRS: {dataset.crs}")
    if dataset.count != 1 or dataset.nodata != -200:
        raise ValueError("GHSL must have one count band and -200 NoData")
    if dataset.transform.b != 0 or dataset.transform.d != 0 or dataset.res != (resolution, resolution):
        raise ValueError("GHSL grid is not the declared square, north-up resolution")
    return {"crs": CRS_NAME, "width": dataset.width, "height": dataset.height, "transform": list(dataset.transform)[:6], "bounds": list(dataset.bounds), "dtype": dataset.dtypes[0], "nodata": dataset.nodata, "resolution_m": resolution}


def tile_document(counts, valid_pixels, bounds, cell_size_m, source_resolution):
    height, width = counts.shape
    occupied = np.flatnonzero(valid_pixels.ravel() > 0)
    cells = [[int(i), float(counts.flat[i]), float(valid_pixels.flat[i] * source_resolution ** 2 / 1e6)] for i in occupied]
    return {"schema_version": 1, "layer_id": LAYER_ID, "data_version": DATA_VERSION, "source_epoch": 2020, "crs": CRS_NAME, "bounds": list(bounds), "width": width, "height": height, "cell_size_m": cell_size_m, "cells": cells}


def write_raster_tiles(dataset, output, relative_root, detail_resolution=5000, overview_resolution=50000, tile_size=128):
    """Read one bounded source window at a time and emit count-conserving tiles.

    Index increases east, then south. Missing indices are NoData. Explicit zero
    triples represent valid zero-population cells. The third value is covered
    *raster* area, not an inferred high-resolution coastline/land mask.
    """
    resolution = int(dataset.res[0])
    if detail_resolution % resolution or overview_resolution % detail_resolution:
        raise ValueError("Display resolutions must be nested integer multiples")
    factor = detail_resolution // resolution
    overview_factor = overview_resolution // resolution
    # Source windows also align to the overview grid, including cropped edges.
    block = math.lcm(tile_size * factor, overview_factor)
    overview_shape = (math.ceil(dataset.height / overview_factor), math.ceil(dataset.width / overview_factor))
    overview_counts = np.zeros(overview_shape, dtype=np.float64)
    overview_valid = np.zeros(overview_shape, dtype=np.float64)
    detail_tiles, source_sum, detail_sum, valid_cells = [], 0.0, 0.0, 0
    for top in range(0, dataset.height, block):
        for left in range(0, dataset.width, block):
            width, height = min(block, dataset.width - left), min(block, dataset.height - top)
            data = dataset.read(1, window=Window(left, top, width, height))
            valid = np.isfinite(data) & (data >= 0) & (data != dataset.nodata)
            source_sum += float(data[valid].sum(dtype=np.float64))
            valid_cells += int(valid.sum())
            coarse_counts, coarse_valid = aggregate_counts(data, overview_factor, dataset.nodata)
            oy, ox = top // overview_factor, left // overview_factor
            overview_counts[oy:oy + coarse_counts.shape[0], ox:ox + coarse_counts.shape[1]] = coarse_counts
            overview_valid[oy:oy + coarse_valid.shape[0], ox:ox + coarse_valid.shape[1]] = coarse_valid
            counts, coverage = aggregate_counts(data, factor, dataset.nodata)
            for row in range(0, counts.shape[0], tile_size):
                for col in range(0, counts.shape[1], tile_size):
                    tile_counts = counts[row:row + tile_size, col:col + tile_size]
                    tile_valid = coverage[row:row + tile_size, col:col + tile_size]
                    if not np.any(tile_valid):
                        continue
                    xmin = dataset.bounds.left + left * resolution + col * detail_resolution
                    ymax = dataset.bounds.top - top * resolution - row * detail_resolution
                    xmax = xmin + tile_counts.shape[1] * detail_resolution
                    ymin = ymax - tile_counts.shape[0] * detail_resolution
                    bounds = (xmin, ymin, xmax, ymax)
                    tile_id = f"r{top // factor + row}_c{left // factor + col}"
                    path = f"tiles/{tile_id}.json"
                    tile = tile_document(tile_counts, tile_valid, bounds, detail_resolution, resolution)
                    write_json(Path(output) / path, tile)
                    detail_sum += float(tile_counts.sum(dtype=np.float64))
                    # Densify projected edges for a conservative geographic bbox;
                    # Mollweide tile corners alone miss extrema near the poles.
                    xs, ys = [], []
                    for value in np.linspace(0, 1, 17):
                        for x, y in [(xmin + value * (xmax - xmin), ymin), (xmin + value * (xmax - xmin), ymax), (xmin, ymin + value * (ymax - ymin)), (xmax, ymin + value * (ymax - ymin))]:
                            lon, lat = FROM_MOLLWEIDE.transform(x, y)
                            if math.isfinite(lon) and math.isfinite(lat):
                                xs.append(lon)
                                ys.append(lat)
                    geographic = [min(xs), min(ys), max(xs), max(ys)] if xs else [-180, -90, 180, 90]
                    detail_tiles.append({"id": tile_id, "url": relative_root + "/" + path, "bounds": list(bounds), "bounds_lonlat": geographic, "cell_size_m": detail_resolution})
        print(f"raster rows {min(top + block, dataset.height)}/{dataset.height}", flush=True)
    overview_bounds = [dataset.bounds.left, dataset.bounds.top - overview_shape[0] * overview_resolution, dataset.bounds.left + overview_shape[1] * overview_resolution, dataset.bounds.top]
    overview = tile_document(overview_counts, overview_valid, overview_bounds, overview_resolution, resolution)
    write_json(Path(output) / "overview.json", overview)
    overview_sum = float(overview_counts.sum(dtype=np.float64))
    tolerance = max(1e-5, source_sum * 1e-12)
    if abs(source_sum - detail_sum) > tolerance or abs(source_sum - overview_sum) > tolerance:
        raise ValueError("Raster aggregation failed count conservation")
    metadata = {"crs": CRS_NAME, "source_resolution_m": resolution, "overview_resolution_m": overview_resolution, "detail_resolution_m": detail_resolution, "overview_url": relative_root + "/overview.json", "detail_tiles": detail_tiles, "cell_fields": ["index", "population", "covered_area_km2"], "index_order": "row_major_north_to_south", "missing_cell": "no_data", "area_method": "valid_source_pixel_area", "aggregation": "sum_counts_then_divide_by_covered_area"}
    audit = {"source_population_sum": source_sum, "detail_population_sum": detail_sum, "overview_population_sum": overview_sum, "valid_source_cell_count": valid_cells, "absolute_tolerance": tolerance, "count_conservation_pass": True, "detail_tile_count": len(detail_tiles)}
    return metadata, audit


def build_population_pack(root, raster_path, ledger, resolution=1000, output_relative="data/thematic_layers/population/ghsl_population_2020_v1"):
    from collections import Counter
    if resolution != 1000:
        raise ValueError("This runtime layer contract is the official global 1km product")
    root, output = Path(root), Path(root) / output_relative
    output.mkdir(parents=True, exist_ok=True)
    lakes_path = root / "data/global_lakes.geojson"
    lakes, rejected_lakes = [], 0
    for feature in read_json(lakes_path)["features"]:
        geometry = shape(feature["geometry"])
        projected = project_geometry(geometry)
        if not geometry.is_valid or not projected.is_valid or not math.isfinite(projected.area):
            rejected_lakes += 1
        else:
            lakes.append(projected)
    # Water-source defects must not silently contaminate the land denominator.
    if rejected_lakes:
        raise ValueError(f"Land denominator has {rejected_lakes} invalid lake geometries")
    scenarios, audits, geometry_cache = {}, {}, {}
    cache = root / ".runtime/source-cache/thematic/ghsl/build"
    cache.mkdir(parents=True, exist_ok=True)
    stats_algorithm = hashlib.sha256("".join(inspect.getsource(f) for f in [normalize_zero_area_parts, decode_topology, prepare_features, polygon_only, exact_population, make_feature_records, audit_partition]).encode()).hexdigest()
    raster_algorithm = hashlib.sha256(inspect.getsource(write_raster_tiles).encode()).hexdigest()
    raster_checkpoint = cache / (ledger["sha256"] + "-raster-" + raster_algorithm + ".json")
    with rasterio.open(raster_path) as dataset:
        header = validate_raster(dataset, resolution)
        saved_raster = read_json(raster_checkpoint) if raster_checkpoint.exists() else None
        cached_paths = ([saved_raster["metadata"]["overview_url"]] + [t["url"] for t in saved_raster["metadata"]["detail_tiles"]]) if saved_raster else []
        if saved_raster and saved_raster["metadata"]["overview_url"] == output_relative + "/overview.json" and all((root / path).is_file() for path in cached_paths):
            raster_metadata, raster_audit = saved_raster["metadata"], saved_raster["audit"]
        else:
            raster_metadata, raster_audit = write_raster_tiles(dataset, output, output_relative)
            write_json(raster_checkpoint, {"metadata": raster_metadata, "audit": raster_audit})
        for scenario_id in SCENARIOS:
            manifest = read_json(root / f"data/scenarios/{scenario_id}/manifest.json")
            topology_path = root / manifest["runtime_topology_url"]
            geometry_version = sha256(topology_path)
            checkpoint_key = hashlib.sha256((ledger["sha256"] + geometry_version + sha256(lakes_path) + stats_algorithm).encode()).hexdigest()
            checkpoint = cache / (checkpoint_key + "-features.json")
            print(f"scenario {scenario_id}: full topology {geometry_version}", flush=True)
            if geometry_version in geometry_cache:
                records, overlap_pairs, partition_audit = geometry_cache[geometry_version]
                records = dict(records)
            elif checkpoint.exists():
                saved = read_json(checkpoint)
                records, overlap_pairs, partition_audit = saved["records"], saved["overlap_pairs"], saved["partition_audit"]
                geometry_cache[geometry_version] = (records, overlap_pairs, partition_audit)
            else:
                entries, overlap_pairs = prepare_features(read_json(topology_path), lakes)
                statistics = exact_population(dataset, entries)
                records = make_feature_records(entries, statistics, resolution ** 2)
                partition_audit = audit_partition(dataset, entries, statistics)
                geometry_cache[geometry_version] = (records, overlap_pairs, partition_audit)
                write_json(checkpoint, {"records": records, "overlap_pairs": overlap_pairs, "partition_audit": partition_audit})
            core_count = len(records)
            if scenario_id == "tno_1962" and manifest.get("scenario_atlantropa_topology_url"):
                extras = decode_topology(read_json(root / manifest["scenario_atlantropa_topology_url"]), "scenario_atlantropa")
                for entry in extras:
                    if entry["id"] in records:
                        raise ValueError("Atlantropa overlay duplicates a core political id")
                    water = entry["properties"].get("atl_render_layer") == "water"
                    records[entry["id"]] = {"population": None, "land_area_km2": 0 if water else None, "density": None, "coverage_fraction": None if water else 0, "status": "water_not_applicable" if water else "unestimated_scenario_land", "source_epoch": 2020}
            filename = f"features/{scenario_id}.json"
            payload = {"schema_version": 1, "layer_id": LAYER_ID, "data_version": DATA_VERSION, "source_epoch": 2020, "scenario_id": scenario_id, "geometry_version": geometry_version, "feature_count": len(records), "features": records}
            write_json(output / filename, payload)
            scenarios[scenario_id] = {"geometry_version": geometry_version, "features_url": output_relative + "/" + filename, "feature_count": len(records), "core_feature_count": core_count, "extra_feature_count": len(records) - core_count, "status": "complete_membership"}
            status_counts = dict(Counter(r["status"] for r in records.values()))
            population = sum(r["population"] or 0 for r in records.values())
            # Shared pieces use 1/N counts and area rather than double-counting.
            if population > raster_audit["source_population_sum"] * (1 + 1e-9):
                raise ValueError("Scenario feature count allocation exceeds global source total")
            audits[scenario_id] = {"status_counts": status_counts, "feature_population_sum": population, "overlap_pairs": overlap_pairs, "partition": partition_audit, "membership_complete": True, "geometry_sha256": geometry_version}
            audits[scenario_id]["source_unallocated_population"] = raster_audit["source_population_sum"] - population
            audits[scenario_id]["source_population_coverage_fraction"] = population / raster_audit["source_population_sum"]
            audits[scenario_id]["invalid_geometry_feature_ids"] = [key for key, row in records.items() if row["status"] == "invalid_geometry"]
            audits[scenario_id]["dropped_zero_area_part_count"] = sum(sum(row.get("dropped_zero_area_parts", {}).values()) for row in records.values())
            if manifest.get("scenario_atlantropa_topology_url"):
                scenarios[scenario_id]["extra_geometry_version"] = sha256(root / manifest["scenario_atlantropa_topology_url"])
            print(f"scenario {scenario_id}: {status_counts}", flush=True)
    source = {"dataset": "GHS_POP", "product": f"GHS_POP_E2020_GLOBE_R2023A_54009_{resolution}_V1_0", "release": "R2023A", "epoch": 2020, "resolution_m": resolution, "unit": "persons", "license": "CC-BY-4.0", "attribution": "European Commission, Joint Research Centre (JRC), GHSL GHS-POP R2023A", "citation_url": "https://doi.org/10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE", **ledger, "raster_sha256": sha256(raster_path), "raster_header": header}
    manifest = {"schema_version": 1, "layer_id": LAYER_ID, "data_version": DATA_VERSION, "period": {"year": 2020}, "source_policy": "real_source_cache_only", "coverage_status": "global_source", "source": source, "provenance": {"estimate_type": "modelled_resident_population", "historical_interpretation": "2020 population on scenario boundaries; not historical population", "land_area_method": "full_political_polygon_minus_natural_earth_lakes_in_equal_area_mollweide", "land_mask_url": "data/global_lakes.geojson", "land_mask_sha256": sha256(lakes_path), "area_limitation": "Modelled polygon land area; not a 100m land-fraction mask. Unmapped water and coastline generalization remain.", "integration_method": "exactextract_fractional_pixel_overlap", "integration_dependency": "exactextract>=0.3.0"}, "runtime_consumer": {"status": "main_map_ready", "supports_main_map_render": True, "supported_scenarios": list(SCENARIOS)}, "scenarios": scenarios, "raster": raster_metadata, "audit_url": output_relative + "/audit.json"}
    manifest["provenance"]["partition_method"] = "equal_share_by_exact_overlap_multiplicity"
    manifest["coverage_status"] = "complete"
    manifest["runtime_consumer"]["data_version"] = DATA_VERSION
    manifest["provenance"]["overlay_precision_m"] = 0.001
    manifest["provenance"]["coverage_numerical_tolerance"] = 1e-6
    manifest["provenance"]["degenerate_parts_method"] = "remove_only_rings_with_zero_area_convex_hull; preserve_every_nonzero_component"
    manifest["provenance"]["area_limitation"] += " Overlapping scenario boundaries share both counts and land area by 1/N."
    write_json(output / "audit.json", {"schema_version": 1, "source": source, "raster": raster_audit, "scenarios": audits})
    write_json(output / "source_ledger.json", {"schema_version": 1, "sources": [source]})
    # Publish the entry point last; a interrupted build is never newly ready.
    write_json(output / "manifest.json", manifest)
    return manifest
