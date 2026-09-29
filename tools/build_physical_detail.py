"""Build a bounded Alps land-cover detail pack from the local CGLS raster.

The overview is retained outside the declared footprint. This is regional
detail, not a claim of globally higher resolution or historical vegetation.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import geopandas as gpd
import pandas as pd
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.windows import from_bounds as window_from_bounds
from shapely.geometry import box

from map_builder import config as cfg
from map_builder.geo.spherical_safety import _topology_feature_collection
from map_builder.geo.topology import build_named_layer_topology
from map_builder.processors.physical_context import _build_semantic_code_grid, _polygonize_semantic_grid

ALPS_BOUNDS = (4.0, 43.0, 17.0, 49.0)
DETAIL_CELL_DEGREES = 0.05


def replace_cover_in_region(overview, detail, bounds=ALPS_BOUNDS):
    retained = overview.copy()
    # The shipped overview contains one exact duplicate wetland. Remove only
    # identical records, so IDs remain stable without dropping distinct areas.
    retained['_geometry_key'] = retained.geometry.to_wkb()
    retained = retained.drop_duplicates(subset=['id', '_geometry_key']).drop(columns='_geometry_key')
    patch = box(*bounds)
    cover = retained.atlas_layer.eq('semantic_overlay') & retained.intersects(patch)
    retained.loc[cover, 'geometry'] = retained.loc[cover].geometry.difference(patch)
    retained = retained[~retained.geometry.is_empty].copy()
    return gpd.GeoDataFrame(pd.concat([retained, detail], ignore_index=True), geometry='geometry', crs='EPSG:4326')


def build(output_dir: Path):
    source_path = ROOT / 'data' / cfg.CGLS_LC100_2019_DISCRETE_FILENAME
    overview_path = ROOT / 'data' / cfg.PHYSICAL_SEMANTICS_TOPO_FILENAME
    west, south, east, north = ALPS_BOUNDS
    width = round((east-west) / DETAIL_CELL_DEGREES)
    height = round((north-south) / DETAIL_CELL_DEGREES)
    with rasterio.open(source_path) as dataset:
        if dataset.crs.to_epsg() != 4326 or dataset.width < width or dataset.height < height:
            raise ValueError('Expected the local WGS84 CGLS source raster')
        grid = dataset.read(1, window=window_from_bounds(*ALPS_BOUNDS, transform=dataset.transform), out_shape=(height, width), resampling=Resampling.mode)
    transform = from_bounds(*ALPS_BOUNDS, width, height)
    detail = _polygonize_semantic_grid(_build_semantic_code_grid(grid, transform), transform,
        simplify_degrees=0.01, min_area_km2=10, rainforest_min_area_km2=25, grassland_min_area_km2=32)
    if detail.empty:
        raise ValueError('Alps detail must contain classified land cover')
    detail['id'] = 'alps_detail_' + detail.id.astype(str)
    payload = json.loads(overview_path.read_text(encoding='utf-8'))
    overview = gpd.GeoDataFrame.from_features(_topology_feature_collection(payload, 'physical_semantics', 'physical-detail'), crs='EPSG:4326')
    combined = replace_cover_in_region(overview, detail)
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / 'global_physical_semantics.detail.topo.json'
    build_named_layer_topology(combined, path, object_name='physical_semantics', quantization=1_000_000)
    topology = json.loads(path.read_text(encoding='utf-8'))
    topology['metadata'] = {
        'source': 'cgls_lc100_2019', 'source_year': 2019,
        'detail_regions': [{'id': 'alps', 'bounds': list(ALPS_BOUNDS), 'cell_degrees': DETAIL_CELL_DEGREES}],
        'outside_detail_regions': 'Existing overview retained',
        'simplify_degrees': 0.01, 'min_component_area_km2': 10,
        'detail_feature_count': len(detail),
    }
    path.write_text(json.dumps(topology, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    if path.stat().st_size > 2_000_000:
        raise ValueError('Regional detail exceeded the 2 MB raw asset budget')
    print(json.dumps({'asset': str(path), 'overview_features': len(overview), 'detail_features': len(detail), 'combined_features': len(combined), 'bytes': path.stat().st_size, 'bounds': ALPS_BOUNDS, 'cell_degrees': DETAIL_CELL_DEGREES}))
    return combined


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True)
    build(parser.parse_args().output_dir)
