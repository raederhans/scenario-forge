import json
from pathlib import Path

from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
SCENARIO_WATER_PATH = ROOT / 'data' / 'scenarios' / 'tno_1962' / 'water_regions.geojson'


NON_OVERLAP_PAIRS = [
    ('tno_black_sea', 'tno_sea_of_azov'),
    ('tno_bosporus_dardanelles', 'tno_sea_of_marmara'),
    ('tno_north_sea', 'tno_strait_of_dover'),
    ('tno_baltic_sea', 'tno_central_baltic_sea'),
    ('tno_bristol_channel', 'tno_severn_estuary'),
    ('tno_barents_sea', 'tno_western_arctic_ocean'),
    ('tno_caribbean_sea', 'tno_gulf_of_mexico'),
    ('tno_south_china_sea', 'tno_gulf_of_tonkin'),
    ('tno_tasman_sea', 'tno_bass_strait'),
]


def _load_feature_map():
    payload = json.loads(SCENARIO_WATER_PATH.read_text(encoding='utf-8'))
    return {
        str(feature.get('properties', {}).get('id') or ''): feature
        for feature in payload.get('features', [])
        if str(feature.get('properties', {}).get('id') or '').strip()
    }


def test_named_water_subtractions_remove_expected_overlap():
    feature_map = _load_feature_map()
    failures = []
    for left_id, right_id in NON_OVERLAP_PAIRS:
        left = feature_map.get(left_id)
        right = feature_map.get(right_id)
        assert left is not None, left_id
        assert right is not None, right_id
        left_geom = shape(left['geometry'])
        right_geom = shape(right['geometry'])
        overlap_area = float(left_geom.intersection(right_geom).area)
        if overlap_area > 1e-6:
            failures.append((left_id, right_id, overlap_area))
    assert failures == []
