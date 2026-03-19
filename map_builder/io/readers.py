"""File readers and helpers for map pipeline."""
from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd

from map_builder import config as cfg
from map_builder.geo.utils import clip_to_map_bounds, pick_column
from map_builder.io.fetch import fetch_ne_zip, fetch_or_load_vector_archive

JSON_ENCODINGS = ("utf-8", "utf-8-sig")


def read_json_strict(path: Path, *, encodings: tuple[str, ...] = JSON_ENCODINGS) -> object:
    last_error: Exception | None = None
    for encoding in encodings:
        try:
            return json.loads(path.read_text(encoding=encoding))
        except FileNotFoundError:
            raise
        except json.JSONDecodeError as exc:
            last_error = ValueError(f"Failed to parse JSON {path}: {exc}")
            last_error.__cause__ = exc
            continue
        except UnicodeDecodeError as exc:
            last_error = ValueError(f"Failed to decode JSON {path} with {encoding}: {exc}")
            last_error.__cause__ = exc
            continue
        except OSError:
            raise
    if last_error is not None:
        raise last_error
    raise ValueError(f"Failed to read JSON {path}.")


def read_json_optional(
    path: Path | None,
    *,
    default: object = None,
    encodings: tuple[str, ...] = JSON_ENCODINGS,
) -> object:
    if path is None or not path.exists():
        return default
    try:
        return read_json_strict(path, encodings=encodings)
    except (ValueError, OSError):
        return default


def load_natural_earth_admin0(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Normalize an admin0 layer for ISO A2 lookups (CRS WGS84)."""
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326", allow_override=True)
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")
    return gdf


def load_rivers() -> gpd.GeoDataFrame:
    gdf = fetch_ne_zip(cfg.RIVERS_URL, "rivers")
    return clip_to_map_bounds(gdf, "rivers")


def load_urban() -> gpd.GeoDataFrame:
    gdf = fetch_ne_zip(cfg.URBAN_URL, "urban")
    return clip_to_map_bounds(gdf, "urban")


def load_populated_places() -> gpd.GeoDataFrame:
    gdf = fetch_or_load_vector_archive(
        cfg.POPULATED_PLACES_URL,
        cfg.POPULATED_PLACES_FILENAME,
    )
    return clip_to_map_bounds(gdf, "populated places")


def load_physical() -> gpd.GeoDataFrame:
    gdf = fetch_ne_zip(cfg.PHYSICAL_URL, "physical")
    feature_col = pick_column(gdf, ["featurecla", "FEATURECLA", "feature_cla"])
    if feature_col:
        keep_types = set(cfg.PHYSICAL_CONTEXT_FEATURE_TYPES)
        gdf = gdf[gdf[feature_col].isin(keep_types)].copy()
        if feature_col != "featurecla":
            gdf = gdf.rename(columns={feature_col: "featurecla"})
    else:
        print("[Physical] featurecla missing; keeping all features.")
    return clip_to_map_bounds(gdf, "physical")
