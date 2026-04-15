from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.transport_workbench_contracts import finalize_transport_manifest
from map_builder.overture_transport_common import (
    OVERTURE_RELEASE,
    OVERTURE_TRANSPORT_SEGMENT_PATH,
    feature_collection_payload,
    file_sha256,
    first_source_dataset,
    measure_lengths,
    rows_to_geodataframe,
    safe_primary_name,
    simplify_lines,
    stream_transport_segment_rows,
    topojson_from_gdf,
    utc_now,
    write_json,
)

OUTPUT_DIR = ROOT / 'data' / 'transport_layers' / 'global_rail'
RECIPE_PATH = OUTPUT_DIR / 'source_recipe.manual.json'
MANIFEST_PATH = OUTPUT_DIR / 'manifest.json'
AUDIT_PATH = OUTPUT_DIR / 'build_audit.json'
RAILWAYS_TOPO_PATH = OUTPUT_DIR / 'railways.topo.json'
RAILWAYS_PREVIEW_TOPO_PATH = OUTPUT_DIR / 'railways.preview.topo.json'
MAJOR_STATIONS_PATH = OUTPUT_DIR / 'rail_stations_major.geojson'
MAJOR_STATIONS_PREVIEW_PATH = OUTPUT_DIR / 'rail_stations_major.preview.geojson'
STREAM_BATCH_SIZE = 50_000
TARGET_NORMALIZED_CHUNK_ROWS = 4_000

RAIL_CLASSES = ('standard_gauge', 'unknown')
FOCUS_REGION_SPECS = (
    {'id': 'japan', 'lon_min': 128.0, 'lon_max': 147.0, 'lat_min': 30.0, 'lat_max': 46.0},
    {'id': 'europe', 'lon_min': -12.0, 'lon_max': 45.0, 'lat_min': 34.0, 'lat_max': 72.0},
    {'id': 'russia', 'lon_min': 30.0, 'lon_max': 180.0, 'lat_min': 45.0, 'lat_max': 78.0},
    {'id': 'east_asia', 'lon_min': 95.0, 'lon_max': 150.0, 'lat_min': 20.0, 'lat_max': 55.0},
    {'id': 'north_america', 'lon_min': -170.0, 'lon_max': -50.0, 'lat_min': 15.0, 'lat_max': 75.0},
)
REGION_POLICY_BY_ID = {
    'japan': {
        'full_min_length_m': {'standard_gauge': 6_000.0, 'unknown': 16_000.0},
        'preview_min_length_by_line_class': {'mainline': 25_000.0, 'regional': 28_000.0, 'secondary': 70_000.0},
        'simplify_meters': {'standard_gauge': 90.0, 'unknown': 130.0},
        'drop_unnamed_standard_gauge': False,
        'drop_unknown_without_name': False,
    },
    'europe': {
        'full_min_length_m': {'standard_gauge': 8_000.0, 'unknown': 20_000.0},
        'preview_min_length_by_line_class': {'mainline': 35_000.0, 'regional': 35_000.0, 'secondary': 90_000.0},
        'simplify_meters': {'standard_gauge': 120.0, 'unknown': 160.0},
        'drop_unnamed_standard_gauge': False,
        'drop_unknown_without_name': False,
    },
    'russia': {
        'full_min_length_m': {'standard_gauge': 10_000.0, 'unknown': 24_000.0},
        'preview_min_length_by_line_class': {'mainline': 42_000.0, 'regional': 52_000.0, 'secondary': 120_000.0},
        'simplify_meters': {'standard_gauge': 140.0, 'unknown': 180.0},
        'drop_unnamed_standard_gauge': False,
        'drop_unknown_without_name': False,
    },
    'east_asia': {
        'full_min_length_m': {'standard_gauge': 8_000.0, 'unknown': 20_000.0},
        'preview_min_length_by_line_class': {'mainline': 35_000.0, 'regional': 40_000.0, 'secondary': 100_000.0},
        'simplify_meters': {'standard_gauge': 120.0, 'unknown': 160.0},
        'drop_unnamed_standard_gauge': False,
        'drop_unknown_without_name': False,
    },
    'north_america': {
        'full_min_length_m': {'standard_gauge': 10_000.0, 'unknown': 24_000.0},
        'preview_min_length_by_line_class': {'mainline': 45_000.0, 'regional': 55_000.0, 'secondary': 130_000.0},
        'simplify_meters': {'standard_gauge': 140.0, 'unknown': 180.0},
        'drop_unnamed_standard_gauge': False,
        'drop_unknown_without_name': False,
    },
    'low_priority': {
        'full_min_length_m': {'standard_gauge': 30_000.0, 'unknown': 120_000.0},
        'preview_min_length_by_line_class': {'mainline': 150_000.0, 'regional': 220_000.0, 'secondary': 320_000.0},
        'simplify_meters': {'standard_gauge': 260.0, 'unknown': 320.0},
        'drop_unnamed_standard_gauge': True,
        'drop_unknown_without_name': True,
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Build checked-in global coarse rail transport packs from Overture.')
    parser.add_argument('--max-features', type=int, default=0, help='Optional local debug cap before writing output.')
    return parser.parse_args()


def log_progress(message: str) -> None:
    print(f'[global-rail] {message}', file=sys.stderr, flush=True)


def bbox_center(row_bbox: Any) -> tuple[float | None, float | None]:
    if not isinstance(row_bbox, dict):
        return (None, None)
    xmin = row_bbox.get('xmin')
    xmax = row_bbox.get('xmax')
    ymin = row_bbox.get('ymin')
    ymax = row_bbox.get('ymax')
    try:
        lon = (float(xmin) + float(xmax)) / 2.0
        lat = (float(ymin) + float(ymax)) / 2.0
    except (TypeError, ValueError):
        return (None, None)
    return (lon, lat)


def focus_region_for_bbox(row_bbox: Any) -> str:
    lon, lat = bbox_center(row_bbox)
    if lon is None or lat is None:
        return 'low_priority'
    for spec in FOCUS_REGION_SPECS:
        if spec['lon_min'] <= lon < spec['lon_max'] and spec['lat_min'] <= lat <= spec['lat_max']:
            return str(spec['id'])
    return 'low_priority'


def region_policy(region_id: str) -> dict[str, Any]:
    return REGION_POLICY_BY_ID.get(str(region_id), REGION_POLICY_BY_ID['low_priority'])


def line_class_for_row(raw_class: str, length_m: float, name: str) -> str:
    normalized = str(raw_class or '').strip().lower()
    if normalized == 'standard_gauge' and length_m >= 160_000:
        return 'mainline'
    if normalized == 'standard_gauge':
        return 'regional'
    if name and length_m >= 100_000:
        return 'regional'
    return 'secondary'


def reveal_rank_for_row(raw_class: str, length_m: float, name: str) -> int:
    line_class = line_class_for_row(raw_class, length_m, name)
    if line_class == 'mainline':
        return 1
    if line_class == 'regional':
        return 2
    return 3

NORMALIZED_RAILWAY_COLUMNS = ['id', 'name', 'focus_region', 'class', 'source', 'length_m', 'reveal_rank', 'geometry']
RAILWAY_COLUMNS = ['id', 'name', 'class', 'source', 'length_m', 'reveal_rank', 'geometry']


def empty_railways_frame() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(columns=RAILWAY_COLUMNS, geometry='geometry', crs='EPSG:4326')


def empty_normalized_railways_frame() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(columns=NORMALIZED_RAILWAY_COLUMNS, geometry='geometry', crs='EPSG:4326')


def map_batch_rows(batch_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in batch_rows:
        raw_class = str(row.get('class') or '').strip().lower()
        if raw_class not in RAIL_CLASSES:
            continue
        name = safe_primary_name(row.get('names'))
        focus_region = focus_region_for_bbox(row.get('bbox'))
        policy = region_policy(focus_region)
        if raw_class == 'unknown' and policy.get('drop_unknown_without_name') and not name:
            continue
        if raw_class == 'standard_gauge' and policy.get('drop_unnamed_standard_gauge') and not name:
            continue
        rows.append({
            'id': str(row.get('id') or '').strip(),
            'name': name,
            'focus_region': focus_region,
            'overture_class': raw_class,
            'source': first_source_dataset(row.get('sources')) or 'Overture',
            'geometry': row.get('geometry'),
        })
    return rows


def normalize_rail_batch(batch_rows: list[dict[str, Any]]) -> gpd.GeoDataFrame:
    gdf = rows_to_geodataframe(map_batch_rows(batch_rows))
    if gdf.empty:
        return empty_normalized_railways_frame()
    gdf = measure_lengths(gdf)
    min_lengths = gdf.apply(
        lambda row: float(region_policy(str(row.get('focus_region')))['full_min_length_m'].get(str(row['overture_class']), 0.0)),
        axis=1,
    )
    gdf = gdf.loc[gdf['length_m'] >= min_lengths].copy()
    if gdf.empty:
        return empty_normalized_railways_frame()
    pieces = []
    for focus_region in sorted(set(gdf['focus_region'].tolist())):
        region_subset = gdf.loc[gdf['focus_region'] == focus_region].copy()
        policy = region_policy(str(focus_region))
        for raw_class in RAIL_CLASSES:
            subset = region_subset.loc[region_subset['overture_class'] == raw_class].copy()
            if subset.empty:
                continue
            pieces.append(simplify_lines(subset, float(policy['simplify_meters'][raw_class])))
    if not pieces:
        return empty_normalized_railways_frame()
    normalized = gpd.GeoDataFrame(pd.concat(pieces, ignore_index=True), geometry='geometry', crs='EPSG:4326')
    normalized = measure_lengths(normalized)
    normalized['class'] = normalized.apply(lambda row: line_class_for_row(str(row['overture_class']), float(row['length_m']), str(row['name'] or '')), axis=1)
    normalized['reveal_rank'] = normalized.apply(lambda row: reveal_rank_for_row(str(row['overture_class']), float(row['length_m']), str(row['name'] or '')), axis=1)
    return normalized[NORMALIZED_RAILWAY_COLUMNS].copy()


def build_preview_railways(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return empty_railways_frame()
    min_lengths = gdf.apply(
        lambda row: float(region_policy(str(row.get('focus_region')))['preview_min_length_by_line_class'].get(str(row['class']), 0.0)),
        axis=1,
    )
    preview = gdf.loc[(gdf['length_m'] >= min_lengths) & (gdf['reveal_rank'] <= 2)].copy()
    return preview[RAILWAY_COLUMNS].copy()


def empty_station_collection() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        columns=['id', 'name', 'city_key', 'importance', 'importance_rank', 'source', 'geometry'],
        geometry='geometry',
        crs='EPSG:4326',
    )


def write_chunk_parquet(gdf: gpd.GeoDataFrame, path: Path) -> None:
    if gdf.empty:
        return
    gdf.to_parquet(path, index=False)


def build_railways_streaming(temp_root: Path, max_features: int = 0) -> dict[str, Any]:
    columns = ['id', 'geometry', 'bbox', 'class', 'names', 'sources']
    raw_line_count = 0
    filtered_line_count = 0
    class_counts = {line_class: 0 for line_class in ('mainline', 'regional', 'secondary')}
    region_counts = {region_id: 0 for region_id in REGION_POLICY_BY_ID}
    chunk_paths: list[Path] = []
    pending_frames: list[gpd.GeoDataFrame] = []
    pending_rows = 0
    processed = 0
    chunk_index = 0
    batch_index = 0

    def flush_pending_frames() -> None:
        nonlocal pending_frames, pending_rows, chunk_index
        if not pending_frames:
            return
        combined = gpd.GeoDataFrame(pd.concat(pending_frames, ignore_index=True), geometry='geometry', crs='EPSG:4326')
        chunk_path = temp_root / f'railways_{chunk_index:05d}.parquet'
        write_chunk_parquet(combined, chunk_path)
        chunk_paths.append(chunk_path)
        if chunk_index == 0 or (chunk_index + 1) % 10 == 0:
            log_progress(
                f'normalized chunk {chunk_index + 1} flushed; raw_seen={raw_line_count}; kept={filtered_line_count}; chunk_rows={len(combined)}; regions={region_counts}'
            )
        pending_frames = []
        pending_rows = 0
        chunk_index += 1

    for batch_rows in stream_transport_segment_rows(
        subtype='rail',
        allowed_classes=RAIL_CLASSES,
        columns=columns,
        batch_size=STREAM_BATCH_SIZE,
    ):
        batch_index += 1
        if max_features:
            remaining = max_features - processed
            if remaining <= 0:
                break
            batch_rows = batch_rows[:remaining]
        if not batch_rows:
            continue
        processed += len(batch_rows)
        raw_line_count += len(batch_rows)
        normalized_chunk = normalize_rail_batch(batch_rows)
        if normalized_chunk.empty:
            continue
        filtered_line_count += int(len(normalized_chunk))
        for line_class in class_counts:
            class_counts[line_class] += int((normalized_chunk['class'] == line_class).sum())
        for region_id in region_counts:
            region_counts[region_id] += int((normalized_chunk['focus_region'] == region_id).sum())
        pending_frames.append(normalized_chunk)
        pending_rows += int(len(normalized_chunk))
        if batch_index == 1 or batch_index % 25 == 0:
            log_progress(
                f'scan checkpoint batch={batch_index}; raw_seen={raw_line_count}; kept={filtered_line_count}; pending_rows={pending_rows}; regions={region_counts}'
            )
        if pending_rows >= TARGET_NORMALIZED_CHUNK_ROWS:
            flush_pending_frames()

    flush_pending_frames()

    return {
        'rail_chunks': chunk_paths,
        'raw_line_count': raw_line_count,
        'filtered_line_count': filtered_line_count,
        'line_class_counts': class_counts,
        'region_counts': region_counts,
    }


def materialize_railways_from_chunks(chunk_paths: list[Path], builder) -> gpd.GeoDataFrame:
    frames: list[gpd.GeoDataFrame] = []
    for index, path in enumerate(chunk_paths, start=1):
        if not path.exists():
            continue
        chunk = gpd.read_parquet(path)
        built = builder(chunk)
        if not built.empty:
            frames.append(built)
        if index == 1 or index % 25 == 0:
            log_progress(f'materialized {index}/{len(chunk_paths)} chunk(s) for staged output')
    if not frames:
        return empty_railways_frame()
    return gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), geometry='geometry', crs='EPSG:4326')


def write_source_recipe() -> None:
    recipe = {
        'version': 'global_rail_sources_v1',
        'family': 'rail',
        'source_policy': 'overture_only_checked_in_v1',
        'primary_source': {
            'provider': 'Overture Maps Foundation',
            'release': OVERTURE_RELEASE,
            'theme': 'transportation',
            'type': 'segment',
            'subtype': 'rail',
            'classes': list(RAIL_CLASSES),
            'remote_path': f's3://{OVERTURE_TRANSPORT_SEGMENT_PATH}',
            'license': 'ODbL-1.0',
        },
        'product_rules': {
            'focus_region_priority': [spec['id'] for spec in FOCUS_REGION_SPECS],
            'region_policy': REGION_POLICY_BY_ID,
            'line_class_policy': 'standard_gauge long segments => mainline, other standard_gauge => regional, remaining => secondary',
            'stations_phase': 'phase_b_pending_major_station_source',
            'phase_a_scope': 'line_only_backbone',
            'non_focus_strategy': 'keep focus regions at baseline fidelity; drop unnamed low-priority lines early and raise thresholds outside focus regions',
        },
    }
    write_json(RECIPE_PATH, recipe, compact=False)


def build_audit_payload(
    *,
    source_signature: dict[str, Any],
    result: dict[str, Any],
    preview_railways: gpd.GeoDataFrame,
    railways: gpd.GeoDataFrame,
    major_stations: gpd.GeoDataFrame,
    output_size_bytes: dict[str, int] | None = None,
) -> dict[str, Any]:
    return {
        'generated_at': utc_now(),
        'adapter_id': 'global_rail_v1',
        'recipe_version': 'global_rail_sources_v1',
        'source_policy': 'overture_only_checked_in_v1',
        'raw_line_count': int(result['raw_line_count']),
        'filtered_line_count': int(result['filtered_line_count']),
        'preview_line_count': int(len(preview_railways)),
        'major_station_count': int(len(major_stations)),
        'line_class_counts': result['line_class_counts'],
        'region_counts': result['region_counts'],
        'preview_thresholds_m': {
            region_id: policy['preview_min_length_by_line_class']
            for region_id, policy in REGION_POLICY_BY_ID.items()
        },
        'output_size_bytes': output_size_bytes or {
            'railways_preview': RAILWAYS_PREVIEW_TOPO_PATH.stat().st_size,
            'railways_full': RAILWAYS_TOPO_PATH.stat().st_size,
            'stations_preview': MAJOR_STATIONS_PREVIEW_PATH.stat().st_size,
            'stations_full': MAJOR_STATIONS_PATH.stat().st_size,
        },
        'source_signature': source_signature,
        'phase_status': {
            'backbone': 'ready_for_phase_a_checked_in_outputs',
            'major_stations': 'phase_b_pending_source',
        },
        'runtime_readiness': {
            'transport_overview_rail': 'backbone_only_not_ui_ready',
            'rail_stations_major': 'placeholder_only',
        },
        'notes': [
            'Global rail coarse v1 uses Overture transportation segments as the only canonical source.',
            'Phase A delivers backbone railways now and leaves major station enrichment to phase B.',
            'Manifest phase A only declares railways as checked-in live outputs.',
            'rail_stations_major is emitted as an empty placeholder sidecar until the dedicated major-station source is finalized.',
            'Focus regions are Europe, Russia, East Asia, Japan, and North America; other regions keep a coarser line-only baseline with stricter early filtering and longer reveal thresholds.',
        ],
    }


def build_manifest_payload(
    *,
    source_signature: dict[str, Any],
    preview_railways: gpd.GeoDataFrame,
    railways: gpd.GeoDataFrame,
    audit: dict[str, Any],
) -> dict[str, Any]:
    manifest = {
        'adapter_id': 'global_rail_v1',
        'family': 'rail',
        'geometry_kind': 'line',
        'schema_version': 1,
        'generated_at': utc_now(),
        'recipe_path': str(RECIPE_PATH.relative_to(ROOT)).replace('\\', '/'),
        'recipe_version': 'global_rail_sources_v1',
        'distribution_tier': 'single_pack',
        'source_policy': 'overture_only_checked_in_v1',
        'paths': {
            'preview': {
                'railways': str(RAILWAYS_PREVIEW_TOPO_PATH.relative_to(ROOT)).replace('\\', '/'),
            },
            'full': {
                'railways': str(RAILWAYS_TOPO_PATH.relative_to(ROOT)).replace('\\', '/'),
            },
            'build_audit': str(AUDIT_PATH.relative_to(ROOT)).replace('\\', '/'),
        },
        'feature_counts': {
            'preview': {
                'railways': int(len(preview_railways)),
            },
            'full': {
                'railways': int(len(railways)),
            },
        },
        'build_command': 'python tools/build_global_transport_rail.py',
        'runtime_consumer': 'transport_overview_rail',
        'source_signature': source_signature,
    }
    return finalize_transport_manifest(
        manifest,
        default_variant='default',
        variants={
            'default': {
                'label': 'default',
                'distribution_tier': manifest['distribution_tier'],
                'paths': manifest['paths'],
                'feature_counts': manifest['feature_counts'],
            }
        },
        extension={
            'phase_status': audit['phase_status'],
            'runtime_readiness': audit['runtime_readiness'],
            'phase_b_reserved_outputs': ['rail_stations_major'],
        },
    )


def main() -> None:
    args = parse_args()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    write_source_recipe()

    with tempfile.TemporaryDirectory(prefix='global_transport_rail_') as temp_dir:
        log_progress('starting normalized rail chunk scan')
        result = build_railways_streaming(Path(temp_dir), args.max_features)
        rail_chunks = result['rail_chunks']
        log_progress(f'finished normalized rail chunk scan; chunks={len(rail_chunks)}; kept={result["filtered_line_count"]}')
        log_progress('starting preview backbone assembly')
        preview_railways = materialize_railways_from_chunks(rail_chunks, build_preview_railways)
        write_json(RAILWAYS_PREVIEW_TOPO_PATH, topojson_from_gdf(preview_railways, 'railways'), compact=True)
        log_progress('finished preview backbone assembly')
        log_progress('starting full backbone assembly')
        railways = materialize_railways_from_chunks(rail_chunks, lambda chunk: chunk[RAILWAY_COLUMNS].copy())
        write_json(RAILWAYS_TOPO_PATH, topojson_from_gdf(railways, 'railways'), compact=True)
        log_progress('finished full backbone assembly')
    major_stations = empty_station_collection()
    log_progress('writing phase-B placeholder station sidecars')
    write_json(MAJOR_STATIONS_PATH, feature_collection_payload(major_stations), compact=False)
    write_json(MAJOR_STATIONS_PREVIEW_PATH, feature_collection_payload(major_stations), compact=False)

    source_signature = {
        'overture_transport_segment': {
            'release': OVERTURE_RELEASE,
            'remote_path': f's3://{OVERTURE_TRANSPORT_SEGMENT_PATH}',
        },
        'source_recipe': {
            'filename': str(RECIPE_PATH.relative_to(ROOT)).replace('\\', '/'),
            'size_bytes': RECIPE_PATH.stat().st_size,
            'sha256': file_sha256(RECIPE_PATH),
        },
    }

    audit = build_audit_payload(
        source_signature=source_signature,
        result=result,
        preview_railways=preview_railways,
        railways=railways,
        major_stations=major_stations,
    )
    write_json(AUDIT_PATH, audit, compact=False)
    manifest = build_manifest_payload(
        source_signature=source_signature,
        preview_railways=preview_railways,
        railways=railways,
        audit=audit,
    )
    write_json(MANIFEST_PATH, manifest, compact=False)
    print(f'Wrote global rail packs to {OUTPUT_DIR.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
