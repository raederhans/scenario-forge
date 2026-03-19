"""Atomic file writers for pipeline outputs."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import geopandas as gpd


def write_text_atomic(path: Path, text: str, *, encoding: str = "utf-8") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        text=True,
    )
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding=encoding, newline="") as handle:
            handle.write(text)
        temp_path.replace(path)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def write_bytes_atomic(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
        temp_path.replace(path)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def write_json_atomic(
    path: Path,
    payload: object,
    *,
    ensure_ascii: bool = False,
    indent: int | None = 2,
    separators: tuple[str, str] | None = None,
    allow_nan: bool = True,
    trailing_newline: bool = False,
) -> None:
    text = json.dumps(
        payload,
        ensure_ascii=ensure_ascii,
        indent=indent,
        separators=separators,
        allow_nan=allow_nan,
    )
    if trailing_newline:
        text += "\n"
    write_text_atomic(path, text)


def write_geojson_atomic(path: Path, gdf: gpd.GeoDataFrame | None) -> None:
    if gdf is None:
        return
    if gdf.empty:
        write_json_atomic(path, {"type": "FeatureCollection", "features": []}, ensure_ascii=False, indent=2)
        return
    write_text_atomic(path, gdf.to_json(drop_id=True))
