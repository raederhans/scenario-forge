from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import geopandas as gpd
import pandas as pd
import pyarrow.dataset as ds
from pyarrow import fs
from shapely import from_wkb
from topojson import Topology

OVERTURE_RELEASE = "2026-02-18.0"
OVERTURE_REGION = "us-west-2"
OVERTURE_BUCKET = "overturemaps-us-west-2"
OVERTURE_TRANSPORT_SEGMENT_PATH = (
    f"{OVERTURE_BUCKET}/release/{OVERTURE_RELEASE}/theme=transportation/type=segment/"
)
OVERTURE_PLACES_PATH = (
    f"{OVERTURE_BUCKET}/release/{OVERTURE_RELEASE}/theme=places/type=place/"
)
TOPO_PREQUANTIZE = 1_000_000
METRIC_CRS = "EPSG:3857"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def anonymous_overture_s3() -> fs.S3FileSystem:
    return fs.S3FileSystem(region=OVERTURE_REGION, anonymous=True)


def transport_segment_dataset() -> ds.Dataset:
    return ds.dataset(
        OVERTURE_TRANSPORT_SEGMENT_PATH,
        filesystem=anonymous_overture_s3(),
        format="parquet",
    )


def places_dataset() -> ds.Dataset:
    return ds.dataset(
        OVERTURE_PLACES_PATH,
        filesystem=anonymous_overture_s3(),
        format="parquet",
    )


def transport_class_filter(
    subtype: str,
    allowed_classes: Iterable[str],
    bbox_bounds: tuple[float, float] | None = None,
):
    classes = [str(value).strip() for value in allowed_classes if str(value).strip()]
    if not classes:
        raise ValueError("allowed_classes must not be empty")
    expr = (ds.field("subtype") == str(subtype).strip()) & ds.field("class").isin(classes)
    if bbox_bounds:
        if len(bbox_bounds) == 2:
            lon_min, lon_max = bbox_bounds
            expr = expr & (ds.field("bbox", "xmax") >= float(lon_min)) & (ds.field("bbox", "xmin") < float(lon_max))
        elif len(bbox_bounds) == 4:
            lon_min, lon_max, lat_min, lat_max = bbox_bounds
            expr = (
                expr
                & (ds.field("bbox", "xmax") >= float(lon_min))
                & (ds.field("bbox", "xmin") < float(lon_max))
                & (ds.field("bbox", "ymax") >= float(lat_min))
                & (ds.field("bbox", "ymin") <= float(lat_max))
            )
        else:
            raise ValueError("bbox_bounds must be (lon_min, lon_max) or (lon_min, lon_max, lat_min, lat_max)")
    return expr


def stream_transport_segment_rows(
    *,
    subtype: str,
    allowed_classes: Iterable[str],
    columns: Iterable[str],
    batch_size: int = 100_000,
    bbox_bounds: tuple[float, float] | None = None,
) -> Iterable[list[dict[str, Any]]]:
    dataset = transport_segment_dataset()
    scanner = dataset.scanner(
        columns=list(columns),
        filter=transport_class_filter(subtype, allowed_classes, bbox_bounds=bbox_bounds),
        batch_size=batch_size,
    )
    for batch in scanner.to_batches():
        rows = batch.to_pylist()
        if rows:
            yield rows


def safe_primary_name(names: Any) -> str:
    if not isinstance(names, dict):
        return ""
    return str(names.get("primary") or "").strip()


def first_route_ref(routes: Any) -> str:
    if not isinstance(routes, list):
        return ""
    for route in routes:
        if not isinstance(route, dict):
            continue
        value = str(route.get("ref") or "").strip()
        if value:
            return value
    return ""


def first_source_dataset(sources: Any) -> str:
    if not isinstance(sources, list) or not sources:
        return ""
    for source in sources:
        if not isinstance(source, dict):
            continue
        dataset = str(source.get("dataset") or "").strip()
        if dataset:
            return dataset
    return ""


def rows_to_geodataframe(rows: list[dict[str, Any]]) -> gpd.GeoDataFrame:
    if not rows:
        return gpd.GeoDataFrame(columns=["geometry"], geometry="geometry", crs="EPSG:4326")
    frame = pd.DataFrame(rows)
    frame["geometry"] = frame["geometry"].map(lambda value: from_wkb(value) if value else None)
    gdf = gpd.GeoDataFrame(frame, geometry="geometry", crs="EPSG:4326")
    return gdf.loc[gdf.geometry.notnull() & ~gdf.geometry.is_empty].copy()


def measure_lengths(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        gdf["length_m"] = pd.Series(dtype="float64")
        return gdf
    metric = gdf.to_crs(METRIC_CRS)
    gdf = gdf.copy()
    gdf["length_m"] = metric.length.astype(float)
    return gdf


def simplify_lines(gdf: gpd.GeoDataFrame, tolerance_m: float) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf.copy()
    metric = gdf.to_crs(METRIC_CRS)
    metric["geometry"] = metric.geometry.simplify(tolerance_m, preserve_topology=False)
    simplified = metric.to_crs("EPSG:4326")
    return simplified.loc[simplified.geometry.notnull() & ~simplified.geometry.is_empty].copy()


def topojson_from_gdf(gdf: gpd.GeoDataFrame, object_name: str) -> dict[str, Any]:
    safe_gdf = gdf.copy()
    for column in safe_gdf.columns:
        if column == "geometry":
            continue
        safe_gdf[column] = safe_gdf[column].astype(object).where(pd.notna(safe_gdf[column]), None)
    topo = Topology(
        safe_gdf,
        object_name=object_name,
        topology=True,
        prequantize=TOPO_PREQUANTIZE,
        topoquantize=False,
        presimplify=False,
        toposimplify=False,
        shared_coords=True,
    )
    return topo.to_dict()


def feature_collection_payload(gdf: gpd.GeoDataFrame) -> dict[str, Any]:
    return json.loads(gdf.to_json(drop_id=True, ensure_ascii=False))


def write_json(path: Path, payload: Any, *, compact: bool = False) -> None:
    if compact:
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    else:
        text = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False)
    path.write_text(text, encoding="utf-8")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
