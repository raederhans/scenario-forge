"""Shared catalog for source governance scripts."""
from __future__ import annotations

import re
from pathlib import Path

from map_builder import config as cfg
from tools.source_smoke_catalog import SOURCE_GROUPS, SOURCE_SPECS as SMOKE_SOURCE_SPECS


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"


def _provenance_name(filename: str) -> str:
    path = Path(filename)
    suffix = path.suffix
    stem = path.name[:-len(suffix)] if suffix else path.name
    return f"{stem}.provenance.json"


def _github_commit_ref(url: str) -> str:
    patterns = (
        r"raw\.githubusercontent\.com/[^/]+/[^/]+/([0-9a-f]{7,40})/",
        r"github\.com/[^/]+/[^/]+/raw/([0-9a-f]{7,40})/",
        r"cdn\.jsdelivr\.net/gh/[^/]+/[^@]+@([0-9a-f]{7,40})/",
    )
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return str(match.group(1))
    return ""


def _base_entry(
    *,
    source_id: str,
    filename: str,
    configured_source_url: str,
    fallback_urls: list[str] | None,
    fetch_kind: str,
    validator_name: str,
    origin_kind: str,
    immutable_ref: str,
    license_name: str,
    citation: str,
    consumers: list[str],
    rebuild_command: str,
    status: str,
    min_size_bytes: int = 0,
) -> dict[str, object]:
    return {
        "source_id": source_id,
        "filename": filename,
        "configured_source_url": configured_source_url,
        "fallback_urls": list(fallback_urls or []),
        "fetch_kind": fetch_kind,
        "validator_name": validator_name,
        "origin_kind": origin_kind,
        "immutable_ref": immutable_ref,
        "license": license_name,
        "citation": citation,
        "consumers": list(consumers),
        "rebuild_command": rebuild_command,
        "status": status,
        "provenance_sidecar": f"data/{_provenance_name(filename)}",
        "local_path": f"data/{filename}",
        "min_size_bytes": int(min_size_bytes),
    }


def _smoke_entry(
    source_key: str,
    *,
    citation: str,
    status: str,
) -> dict[str, object]:
    spec = SMOKE_SOURCE_SPECS[source_key]
    return _base_entry(
        source_id=source_key,
        filename=str(spec["filename"]),
        configured_source_url=str(spec["url"]),
        fallback_urls=list(spec["fallback_urls"]),
        fetch_kind="geojson",
        validator_name="_validate_json_bytes",
        origin_kind="download",
        immutable_ref=_github_commit_ref(str(spec["url"])),
        license_name="",
        citation=citation,
        consumers=[
            "map_builder/config.py",
            "init_map_data.py",
            "data/europe_topology.json",
        ],
        rebuild_command="python init_map_data.py --mode primary --strict",
        status=status,
    )


LEDGER_SOURCE_SPECS: list[dict[str, object]] = [
    _smoke_entry(
        "fr_arr",
        citation="https://github.com/gregoiredavid/france-geojson",
        status="frozen_verified",
    ),
    _smoke_entry(
        "pl_powiaty",
        citation="https://github.com/jusuff/PolandGeoJson",
        status="frozen_verified",
    ),
]

LEDGER_SOURCE_SPECS.extend(
    _smoke_entry(
        source_key,
        citation=f"https://www.geoboundaries.org/api/current/gbOpen/{SMOKE_SOURCE_SPECS[source_key]['iso']}/{SMOKE_SOURCE_SPECS[source_key]['adm']}/",
        status="frozen_verified",
    )
    for source_key in SOURCE_GROUPS["geoboundaries_phase2"]
)

LEDGER_SOURCE_SPECS.extend(
    [
        _base_entry(
            source_id="geonames_cities15000",
            filename=cfg.GEONAMES_CITIES15000_FILENAME,
            configured_source_url=cfg.GEONAMES_CITIES15000_URL,
            fallback_urls=[],
            fetch_kind="binary",
            validator_name="binary_min_size:65536",
            origin_kind="download",
            immutable_ref="",
            license_name="CC BY 4.0",
            citation="https://download.geonames.org/export/dump/readme.txt",
            consumers=[
                "map_builder/cities.py",
                "data/world_cities.geojson",
                "data/city_aliases.json",
            ],
            rebuild_command="python init_map_data.py --mode primary --strict",
            status="pending_upgrade_review",
            min_size_bytes=64 * 1024,
        ),
        _base_entry(
            source_id="natural_earth_populated_places_10m",
            filename=cfg.POPULATED_PLACES_FILENAME,
            configured_source_url=cfg.POPULATED_PLACES_URL,
            fallback_urls=[],
            fetch_kind="vector_archive",
            validator_name="_validate_vector_archive_bytes",
            origin_kind="download",
            immutable_ref="version 5.1.2",
            license_name="public domain",
            citation="https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/",
            consumers=[
                "map_builder/cities.py",
                "data/world_cities.geojson",
                "data/city_aliases.json",
            ],
            rebuild_command="python init_map_data.py --mode primary --strict",
            status="frozen_local_only",
        ),
        _base_entry(
            source_id="etopo_2022_surface_60s",
            filename=cfg.ETOPO_2022_SURFACE_FILENAME,
            configured_source_url=cfg.ETOPO_2022_SURFACE_URL,
            fallback_urls=[],
            fetch_kind="binary",
            validator_name="binary_min_size:50000000",
            origin_kind="download",
            immutable_ref="ETOPO 2022 v1 60s",
            license_name="",
            citation="https://www.ncei.noaa.gov/products/etopo-global-relief-model",
            consumers=[
                "map_builder/processors/physical_context.py",
                "tools/build_global_bathymetry_asset.py",
                "data/global_bathymetry.topo.json",
            ],
            rebuild_command="python tools/build_global_bathymetry_asset.py",
            status="frozen_local_only",
            min_size_bytes=50_000_000,
        ),
        _base_entry(
            source_id="cgls_lc100_2019_forest_type",
            filename=cfg.CGLS_LC100_2019_FOREST_TYPE_FILENAME,
            configured_source_url=cfg.CGLS_LC100_2019_FOREST_TYPE_URL,
            fallback_urls=[],
            fetch_kind="binary",
            validator_name="binary_min_size:50000000",
            origin_kind="download",
            immutable_ref="Zenodo 3939050 / V3.0.1",
            license_name="",
            citation="https://zenodo.org/records/3939050",
            consumers=[
                "map_builder/processors/physical_context.py",
                "data/global_physical_semantics.topo.json",
            ],
            rebuild_command="python init_map_data.py --mode primary --strict",
            status="frozen_local_only",
            min_size_bytes=50_000_000,
        ),
    ]
)

