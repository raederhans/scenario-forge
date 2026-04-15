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
REGION_OUTPUT_DIR = OUTPUT_DIR / 'regions'
STREAM_BATCH_SIZE = 50_000
TARGET_NORMALIZED_CHUNK_ROWS = 4_000

RAIL_CLASSES = ('standard_gauge', 'unknown')
FOCUS_REGION_SPECS = (
    {'id': 'europe', 'lon_min': -12.0, 'lon_max': 45.0, 'lat_min': 34.0, 'lat_max': 72.0},
    {'id': 'japan', 'lon_min': 128.0, 'lon_max': 147.0, 'lat_min': 30.0, 'lat_max': 46.0},
    {'id': 'russia', 'lon_min': 30.0, 'lon_max': 180.0, 'lat_min': 45.0, 'lat_max': 78.0},
    {'id': 'east_asia', 'lon_min': 95.0, 'lon_max': 150.0, 'lat_min': 20.0, 'lat_max': 55.0},
    {'id': 'north_america', 'lon_min': -170.0, 'lon_max': -50.0, 'lat_min': 15.0, 'lat_max': 75.0},
)
FOCUS_REGION_IDS = tuple(spec['id'] for spec in FOCUS_REGION_SPECS)
RAIL_SHARDS = (
    {'id': 'eu_w012_e010', 'region_id': 'europe', 'lon_min': -12.0, 'lon_max': 10.0},
    {'id': 'eu_e010_e025', 'region_id': 'europe', 'lon_min': 10.0, 'lon_max': 25.0},
    {'id': 'eu_e025_e045', 'region_id': 'europe', 'lon_min': 25.0, 'lon_max': 45.0},
    {'id': 'jp_e128_e147', 'region_id': 'japan', 'lon_min': 128.0, 'lon_max': 147.0},
    {'id': 'ru_e030_e060', 'region_id': 'russia', 'lon_min': 30.0, 'lon_max': 60.0},
    {'id': 'ru_e060_e090', 'region_id': 'russia', 'lon_min': 60.0, 'lon_max': 90.0},
    {'id': 'ru_e090_e120', 'region_id': 'russia', 'lon_min': 90.0, 'lon_max': 120.0},
    {'id': 'ru_e120_e150', 'region_id': 'russia', 'lon_min': 120.0, 'lon_max': 150.0},
    {'id': 'ru_e150_e180', 'region_id': 'russia', 'lon_min': 150.0, 'lon_max': 180.0},
    {'id': 'ea_e095_e115', 'region_id': 'east_asia', 'lon_min': 95.0, 'lon_max': 115.0},
    {'id': 'ea_e115_e130', 'region_id': 'east_asia', 'lon_min': 115.0, 'lon_max': 130.0},
    {'id': 'ea_e130_e150', 'region_id': 'east_asia', 'lon_min': 130.0, 'lon_max': 150.0},
    {'id': 'na_w170_w140', 'region_id': 'north_america', 'lon_min': -170.0, 'lon_max': -140.0},
    {'id': 'na_w140_w110', 'region_id': 'north_america', 'lon_min': -140.0, 'lon_max': -110.0},
    {'id': 'na_w110_w080', 'region_id': 'north_america', 'lon_min': -110.0, 'lon_max': -80.0},
    {'id': 'na_w080_w050', 'region_id': 'north_america', 'lon_min': -80.0, 'lon_max': -50.0},
)
RAIL_SHARD_IDS = tuple(spec['id'] for spec in RAIL_SHARDS)
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
    parser.add_argument(
        '--region',
        choices=(*FOCUS_REGION_IDS, 'all_focus'),
        default='all_focus',
        help='Build one focus region pack or all defined focus regions.',
    )
    parser.add_argument(
        '--shard',
        choices=RAIL_SHARD_IDS,
        default='',
        help='Optional shard id within a focus region.',
    )
    return parser.parse_args()


def log_progress(message: str) -> None:
    print(f'[global-rail] {message}', file=sys.stderr, flush=True)


def region_policy(region_id: str) -> dict[str, Any]:
    return REGION_POLICY_BY_ID.get(str(region_id), REGION_POLICY_BY_ID['low_priority'])


def bbox_center(row_bbox: Any) -> tuple[float, float] | None:
    if not isinstance(row_bbox, dict):
        return None
    xmin = row_bbox.get('xmin')
    xmax = row_bbox.get('xmax')
    ymin = row_bbox.get('ymin')
    ymax = row_bbox.get('ymax')
    if xmin is None or xmax is None or ymin is None or ymax is None:
        return None
    try:
        return ((float(xmin) + float(xmax)) / 2.0, (float(ymin) + float(ymax)) / 2.0)
    except (TypeError, ValueError):
        return None


def region_bbox_center_matches(row_bbox: Any, region_spec: dict[str, Any]) -> bool:
    center = bbox_center(row_bbox)
    if center is None:
        return False
    lon, lat = center
    return (
        float(region_spec['lon_min']) <= lon < float(region_spec['lon_max'])
        and float(region_spec['lat_min']) <= lat < float(region_spec['lat_max'])
    )


def assign_focus_region_id(row_bbox: Any) -> str:
    for region_spec in FOCUS_REGION_SPECS:
        if region_bbox_center_matches(row_bbox, region_spec):
            return str(region_spec['id'])
    return 'low_priority'


def shard_bbox_center_matches(row_bbox: Any, shard_spec: dict[str, Any] | None) -> bool:
    if not shard_spec:
        return True
    center = bbox_center(row_bbox)
    if center is None:
        return False
    lon, _ = center
    return float(shard_spec['lon_min']) <= lon < float(shard_spec['lon_max'])


def get_region_spec(region_id: str) -> dict[str, Any]:
    normalized = str(region_id or '').strip().lower()
    for spec in FOCUS_REGION_SPECS:
        if spec['id'] == normalized:
            return dict(spec)
    raise SystemExit(f'Unknown rail region `{region_id}`. Valid values: {", ".join(FOCUS_REGION_IDS)}')


def get_region_shards(region_id: str) -> list[dict[str, Any]]:
    normalized = str(region_id).strip().lower()
    shards = [dict(spec) for spec in RAIL_SHARDS if spec['region_id'] == normalized]
    if not shards:
        raise SystemExit(f'No rail shards configured for region `{region_id}`.')
    return shards


def get_shard_spec(shard_id: str, *, expected_region_id: str | None = None) -> dict[str, Any]:
    normalized = str(shard_id or '').strip().lower()
    for spec in RAIL_SHARDS:
        if spec['id'] != normalized:
            continue
        if expected_region_id and spec['region_id'] != str(expected_region_id).strip().lower():
            raise SystemExit(f'Rail shard `{shard_id}` does not belong to region `{expected_region_id}`.')
        return dict(spec)
    raise SystemExit(f'Unknown rail shard `{shard_id}`. Valid values: {", ".join(RAIL_SHARD_IDS)}')


def resolve_requested_region_specs(region_arg: str, shard_id: str = '') -> list[dict[str, Any]]:
    requested_shard = get_shard_spec(shard_id) if shard_id else None
    if requested_shard:
        shard_region_id = str(requested_shard['region_id'])
        normalized_region = str(region_arg or '').strip().lower()
        if normalized_region not in {'', 'all_focus', shard_region_id}:
            raise SystemExit(f"Rail shard `{shard_id}` does not belong to region `{region_arg}`.")
        return [get_region_spec(shard_region_id)]
    if region_arg == 'all_focus':
        return [dict(spec) for spec in FOCUS_REGION_SPECS]
    return [get_region_spec(region_arg)]


def get_output_dir(region_spec: dict[str, Any] | None, shard_spec: dict[str, Any] | None = None) -> Path:
    if not region_spec:
        return OUTPUT_DIR
    region_dir = REGION_OUTPUT_DIR / str(region_spec['id'])
    if not shard_spec:
        return region_dir
    return region_dir / 'shards' / str(shard_spec['id'])


def get_output_paths(output_dir: Path) -> dict[str, Path]:
    return {
        'recipe': output_dir / 'source_recipe.manual.json',
        'manifest': output_dir / 'manifest.json',
        'audit': output_dir / 'build_audit.json',
        'railways_preview': output_dir / 'railways.preview.topo.json',
        'railways_full': output_dir / 'railways.topo.json',
        'stations_preview': output_dir / 'rail_stations_major.preview.geojson',
        'stations_full': output_dir / 'rail_stations_major.geojson',
    }


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


def map_batch_rows(
    batch_rows: list[dict[str, Any]],
    *,
    region_id: str,
    shard_spec: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    focus_region = str(region_id).strip().lower()
    policy = region_policy(focus_region)
    for row in batch_rows:
        raw_class = str(row.get('class') or '').strip().lower()
        if raw_class not in RAIL_CLASSES:
            continue
        row_bbox = row.get('bbox')
        if assign_focus_region_id(row_bbox) != focus_region:
            continue
        if not shard_bbox_center_matches(row_bbox, shard_spec):
            continue
        name = safe_primary_name(row.get('names'))
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


def normalize_rail_batch(
    batch_rows: list[dict[str, Any]],
    *,
    region_id: str,
    shard_spec: dict[str, Any] | None = None,
) -> gpd.GeoDataFrame:
    gdf = rows_to_geodataframe(map_batch_rows(batch_rows, region_id=region_id, shard_spec=shard_spec))
    if gdf.empty:
        return empty_normalized_railways_frame()
    gdf = measure_lengths(gdf)
    policy = region_policy(region_id)
    min_lengths = gdf['overture_class'].map(policy['full_min_length_m']).fillna(0.0).astype(float)
    gdf = gdf.loc[gdf['length_m'] >= min_lengths].copy()
    if gdf.empty:
        return empty_normalized_railways_frame()
    pieces = []
    for raw_class in RAIL_CLASSES:
        subset = gdf.loc[gdf['overture_class'] == raw_class].copy()
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
    region_id = str(gdf.iloc[0].get('focus_region') or 'low_priority')
    policy = region_policy(region_id)
    min_lengths = gdf['class'].map(policy['preview_min_length_by_line_class']).fillna(0.0).astype(float)
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


def build_railways_streaming(
    temp_root: Path,
    *,
    region_spec: dict[str, Any],
    shard_spec: dict[str, Any],
    max_features: int = 0,
) -> dict[str, Any]:
    columns = ['id', 'geometry', 'bbox', 'class', 'names', 'sources']
    raw_line_count = 0
    filtered_line_count = 0
    class_counts = {line_class: 0 for line_class in ('mainline', 'regional', 'secondary')}
    region_id = str(region_spec['id'])
    shard_id = str(shard_spec['id'])
    region_counts = {region_id: 0}
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
                f'normalized chunk {chunk_index + 1} flushed; shard={shard_id}; raw_seen={raw_line_count}; kept={filtered_line_count}; chunk_rows={len(combined)}; regions={region_counts}'
            )
        pending_frames = []
        pending_rows = 0
        chunk_index += 1

    for batch_rows in stream_transport_segment_rows(
        subtype='rail',
        allowed_classes=RAIL_CLASSES,
        columns=columns,
        batch_size=STREAM_BATCH_SIZE,
        bbox_bounds=(
            float(shard_spec['lon_min']),
            float(shard_spec['lon_max']),
            float(region_spec['lat_min']),
            float(region_spec['lat_max']),
        ),
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
        normalized_chunk = normalize_rail_batch(batch_rows, region_id=region_id, shard_spec=shard_spec)
        if normalized_chunk.empty:
            continue
        filtered_line_count += int(len(normalized_chunk))
        for line_class in class_counts:
            class_counts[line_class] += int((normalized_chunk['class'] == line_class).sum())
        region_counts[region_id] += int(len(normalized_chunk))
        pending_frames.append(normalized_chunk)
        pending_rows += int(len(normalized_chunk))
        if batch_index == 1 or batch_index % 25 == 0:
            log_progress(
                f'scan checkpoint batch={batch_index}; shard={shard_id}; raw_seen={raw_line_count}; kept={filtered_line_count}; pending_rows={pending_rows}; regions={region_counts}'
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


def write_source_recipe(recipe_path: Path, region_spec: dict[str, Any], shard_spec: dict[str, Any]) -> None:
    region_id = str(region_spec['id'])
    shard_id = str(shard_spec['id'])
    recipe = {
        'version': 'global_rail_sources_v1',
        'family': 'rail',
        'target_region': region_id,
        'target_shard': shard_id,
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
        'region': {
            'id': region_id,
            'lon_min': float(region_spec['lon_min']),
            'lon_max': float(region_spec['lon_max']),
            'lat_min': float(region_spec['lat_min']),
            'lat_max': float(region_spec['lat_max']),
            'selection_rule': 'bbox_center_priority_region_assignment',
        },
        'shard': {
            'id': shard_id,
            'lon_min': float(shard_spec['lon_min']),
            'lon_max': float(shard_spec['lon_max']),
            'lat_min': float(region_spec['lat_min']),
            'lat_max': float(region_spec['lat_max']),
            'selection_rule': 'bbox_longitude_center_assignment_within_region',
        },
    }
    write_json(recipe_path, recipe, compact=False)


def build_audit_payload(
    *,
    paths: dict[str, Path],
    region_spec: dict[str, Any],
    shard_spec: dict[str, Any],
    source_signature: dict[str, Any],
    result: dict[str, Any],
    preview_railways: gpd.GeoDataFrame,
    railways: gpd.GeoDataFrame,
    major_stations: gpd.GeoDataFrame,
    output_size_bytes: dict[str, int] | None = None,
) -> dict[str, Any]:
    region_id = str(region_spec['id'])
    shard_id = str(shard_spec['id'])
    return {
        'generated_at': utc_now(),
        'adapter_id': 'global_rail_v1',
        'region_id': region_id,
        'shard_id': shard_id,
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
            'railways_preview': paths['railways_preview'].stat().st_size,
            'railways_full': paths['railways_full'].stat().st_size,
            'stations_preview': paths['stations_preview'].stat().st_size,
            'stations_full': paths['stations_full'].stat().st_size,
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
            f'Region scope: {region_id} ({region_spec["lon_min"]}..{region_spec["lon_max"]} lon, {region_spec["lat_min"]}..{region_spec["lat_max"]} lat).',
            f'Shard scope: {shard_id} ({shard_spec["lon_min"]}..{shard_spec["lon_max"]} lon within region window).',
        ],
    }


def build_manifest_payload(
    *,
    paths: dict[str, Path],
    region_spec: dict[str, Any],
    shard_spec: dict[str, Any],
    source_signature: dict[str, Any],
    preview_railways: gpd.GeoDataFrame,
    railways: gpd.GeoDataFrame,
    audit: dict[str, Any],
    build_command: str,
) -> dict[str, Any]:
    region_id = str(region_spec['id'])
    shard_id = str(shard_spec['id'])
    manifest = {
        'adapter_id': 'global_rail_v1',
        'family': 'rail',
        'geometry_kind': 'line',
        'schema_version': 1,
        'generated_at': utc_now(),
        'recipe_path': str(paths['recipe'].relative_to(ROOT)).replace('\\', '/'),
        'recipe_version': 'global_rail_sources_v1',
        'distribution_tier': 'single_pack',
        'source_policy': 'overture_only_checked_in_v1',
        'paths': {
            'preview': {
                'railways': str(paths['railways_preview'].relative_to(ROOT)).replace('\\', '/'),
            },
            'full': {
                'railways': str(paths['railways_full'].relative_to(ROOT)).replace('\\', '/'),
            },
            'build_audit': str(paths['audit'].relative_to(ROOT)).replace('\\', '/'),
        },
        'feature_counts': {
            'preview': {
                'railways': int(len(preview_railways)),
            },
            'full': {
                'railways': int(len(railways)),
            },
        },
        'build_command': build_command,
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
            'region': {
                'id': region_id,
                'lon_min': float(region_spec['lon_min']),
                'lon_max': float(region_spec['lon_max']),
                'lat_min': float(region_spec['lat_min']),
                'lat_max': float(region_spec['lat_max']),
            },
            'shard': {
                'id': shard_id,
                'lon_min': float(shard_spec['lon_min']),
                'lon_max': float(shard_spec['lon_max']),
                'lat_min': float(region_spec['lat_min']),
                'lat_max': float(region_spec['lat_max']),
            },
        },
    )


def main() -> None:
    args = parse_args()
    region_specs = resolve_requested_region_specs(args.region, args.shard)
    requested_shard_spec = get_shard_spec(args.shard) if args.shard else None

    for region_spec in region_specs:
        region_id = str(region_spec['id'])
        shard_specs = (
            [requested_shard_spec]
            if requested_shard_spec
            else get_region_shards(region_id)
        )

        for shard_spec in shard_specs:
            shard_id = str(shard_spec['id'])
            output_dir = get_output_dir(region_spec, shard_spec)
            paths = get_output_paths(output_dir)
            output_dir.mkdir(parents=True, exist_ok=True)
            log_progress(f'starting region build: {region_id} / {shard_id}')
            write_source_recipe(paths['recipe'], region_spec, shard_spec)

            with tempfile.TemporaryDirectory(prefix=f'global_transport_rail_{shard_id}_') as temp_dir:
                log_progress('starting normalized rail chunk scan')
                result = build_railways_streaming(
                    Path(temp_dir),
                    region_spec=region_spec,
                    shard_spec=shard_spec,
                    max_features=args.max_features,
                )
                rail_chunks = result['rail_chunks']
                log_progress(f'finished normalized rail chunk scan; chunks={len(rail_chunks)}; kept={result["filtered_line_count"]}')
                log_progress('starting preview backbone assembly')
                preview_railways = materialize_railways_from_chunks(rail_chunks, build_preview_railways)
                write_json(paths['railways_preview'], topojson_from_gdf(preview_railways, 'railways'), compact=True)
                log_progress('finished preview backbone assembly')
                log_progress('starting full backbone assembly')
                railways = materialize_railways_from_chunks(rail_chunks, lambda chunk: chunk[RAILWAY_COLUMNS].copy())
                write_json(paths['railways_full'], topojson_from_gdf(railways, 'railways'), compact=True)
                log_progress('finished full backbone assembly')
            major_stations = empty_station_collection()
            log_progress('writing phase-B placeholder station sidecars')
            write_json(paths['stations_full'], feature_collection_payload(major_stations), compact=False)
            write_json(paths['stations_preview'], feature_collection_payload(major_stations), compact=False)

            build_command = f'python tools/build_global_transport_rail.py --region {region_id} --shard {shard_id}'
            source_signature = {
                'overture_transport_segment': {
                    'release': OVERTURE_RELEASE,
                    'remote_path': f's3://{OVERTURE_TRANSPORT_SEGMENT_PATH}',
                },
                'source_recipe': {
                    'filename': str(paths['recipe'].relative_to(ROOT)).replace('\\', '/'),
                    'size_bytes': paths['recipe'].stat().st_size,
                    'sha256': file_sha256(paths['recipe']),
                },
            }

            audit = build_audit_payload(
                paths=paths,
                region_spec=region_spec,
                shard_spec=shard_spec,
                source_signature=source_signature,
                result=result,
                preview_railways=preview_railways,
                railways=railways,
                major_stations=major_stations,
            )
            write_json(paths['audit'], audit, compact=False)
            manifest = build_manifest_payload(
                paths=paths,
                region_spec=region_spec,
                shard_spec=shard_spec,
                source_signature=source_signature,
                preview_railways=preview_railways,
                railways=railways,
                audit=audit,
                build_command=build_command,
            )
            write_json(paths['manifest'], manifest, compact=False)
            print(f'Wrote global rail shard pack to {output_dir.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
