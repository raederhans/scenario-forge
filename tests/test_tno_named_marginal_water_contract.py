import json
from pathlib import Path

from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
SCENARIO_WATER_PATH = ROOT / 'data' / 'scenarios' / 'tno_1962' / 'water_regions.geojson'

TARGET_PARENT_IDS = {
    'tno_baltic_sea': 'sea',
    'tno_celtic_sea': 'sea',
    'tno_irish_sea': 'sea',
    'tno_north_sea': 'sea',
    'tno_black_sea': 'sea',
    'tno_sea_of_azov': 'sea',
    'tno_sea_of_marmara': 'sea',
    'tno_bosporus_dardanelles': 'chokepoint',
    'tno_greenland_sea': 'sea',
    'tno_norwegian_sea': 'sea',
    'tno_barents_sea': 'sea',
    'tno_baffin_bay': 'gulf',
    'tno_mozambique_channel': 'channel',
    'tno_gulf_of_guinea': 'gulf',
    'tno_ross_sea': 'sea',
    'tno_bering_sea': 'sea',
    'tno_gulf_of_alaska': 'gulf',
    'tno_beaufort_sea': 'sea',
    'tno_labrador_sea': 'sea',
    'tno_gulf_of_st_lawrence': 'gulf',
    'tno_hudson_bay': 'bay',
    'tno_caribbean_sea': 'sea',
    'tno_gulf_of_mexico': 'gulf',
    'tno_sea_of_japan': 'sea',
    'tno_sea_of_okhotsk': 'sea',
    'tno_yellow_sea': 'sea',
    'tno_east_china_sea': 'sea',
    'tno_south_china_sea': 'sea',
    'tno_philippine_sea': 'sea',
    'tno_sulu_sea': 'sea',
    'tno_celebes_sea': 'sea',
    'tno_tasman_sea': 'sea',
    'tno_great_australian_bight': 'sea',
    'tno_gulf_of_carpentaria': 'gulf',
    'tno_arafura_sea': 'sea',
    'tno_timor_sea': 'sea',
    'tno_bay_of_bengal': 'gulf',
    'tno_arabian_sea': 'sea',
    'tno_red_sea': 'sea',
    'tno_gulf_of_aden': 'gulf',
    'tno_gulf_of_oman': 'gulf',
    'tno_persian_gulf': 'gulf',
    'tno_andaman_sea': 'sea',
    'tno_natuna_sea': 'sea',
    'tno_java_sea': 'sea',
    'tno_banda_sea': 'sea',
    'tno_molucca_sea': 'sea',
    'tno_halmahera_sea': 'sea',
    'tno_malacca_strait': 'strait',
    'tno_singapore_strait': 'strait',
    'tno_makassar_strait': 'strait',
}

TARGET_DETAIL_PARENT_MAP = {
    'tno_central_baltic_sea': 'tno_baltic_sea',
    'tno_gulf_of_riga': 'tno_baltic_sea',
    'tno_bothnian_sea': 'tno_baltic_sea',
    'tno_bay_of_bothnia': 'tno_baltic_sea',
    'tno_gulf_of_finland': 'tno_baltic_sea',
    'tno_the_sound': 'tno_baltic_sea',
    'tno_storebaelt': 'tno_baltic_sea',
    'tno_lillebaelt': 'tno_baltic_sea',
    'tno_st_brides_bay': 'tno_celtic_sea',
    'tno_bay_of_brest': 'tno_celtic_sea',
    'tno_st_georges_channel': 'tno_celtic_sea',
    'tno_swansea_bay': 'tno_bristol_channel',
    'tno_carmarthen_bay': 'tno_bristol_channel',
    'tno_bridgwater_bay': 'tno_bristol_channel',
    'tno_barnstaple_bideford_bay': 'tno_bristol_channel',
    'tno_severn_estuary': 'tno_bristol_channel',
    'tno_wadden_sea': 'tno_north_sea',
    'tno_thames_estuary': 'tno_north_sea',
    'tno_blackwater_estuary': 'tno_north_sea',
    'tno_the_wash': 'tno_north_sea',
    'tno_humber_estuary': 'tno_north_sea',
    'tno_firth_of_forth': 'tno_north_sea',
    'tno_moray_firth': 'tno_north_sea',
    'tno_pentland_firth': 'tno_north_sea',
    'tno_poole_bay': 'tno_english_channel',
    'tno_solent': 'tno_english_channel',
    'tno_cardigan_bay': 'tno_irish_sea',
    'tno_liverpool_bay': 'tno_irish_sea',
    'tno_solway_firth': 'tno_irish_sea',
    'tno_seto_naikai': 'tno_sea_of_japan',
    'tno_tatarskiy_proliv': 'tno_sea_of_japan',
    'tno_taiwan_strait': 'tno_east_china_sea',
    'tno_bo_hai': 'tno_yellow_sea',
    'tno_liaodong_wan': 'tno_bo_hai',
    'tno_gulf_of_tonkin': 'tno_south_china_sea',
    'tno_gulf_of_thailand': 'tno_south_china_sea',
    'tno_gulf_of_papua': 'tno_coral_sea',
    'tno_torres_strait': 'tno_coral_sea',
    'tno_great_barrier_reef_coastal_waters': 'tno_coral_sea',
    'tno_bass_strait': 'tno_tasman_sea',
}

NON_OVERLAP_PAIRS = [
    ('tno_black_sea', 'tno_sea_of_azov'),
    ('tno_bosporus_dardanelles', 'tno_sea_of_marmara'),
    ('tno_north_sea', 'tno_kattegat'),
    ('tno_north_sea', 'tno_skagerrak'),
    ('tno_north_sea', 'tno_english_channel'),
    ('tno_north_sea', 'tno_strait_of_dover'),
    ('tno_baltic_sea', 'tno_kattegat'),
    ('tno_kattegat', 'tno_central_baltic_sea'),
    ('tno_baltic_sea', 'tno_the_sound'),
    ('tno_baltic_sea', 'tno_storebaelt'),
    ('tno_baltic_sea', 'tno_lillebaelt'),
    ('tno_irish_sea', 'tno_north_channel'),
    ('tno_irish_sea', 'tno_st_georges_channel'),
    ('tno_irish_sea', 'tno_st_brides_bay'),
    ('tno_celtic_sea', 'tno_bristol_channel'),
    ('tno_celtic_sea', 'tno_st_georges_channel'),
    ('tno_bay_of_biscay', 'tno_bay_of_brest'),
    ('tno_bristol_channel', 'tno_severn_estuary'),
    ('tno_greenland_sea', 'tno_norwegian_sea'),
    ('tno_norwegian_sea', 'tno_northeast_atlantic_ocean'),
    ('tno_barents_sea', 'tno_western_arctic_ocean'),
    ('tno_mozambique_channel', 'tno_western_indian_ocean'),
    ('tno_english_channel', 'tno_poole_bay'),
    ('tno_english_channel', 'tno_solent'),
    ('tno_irish_sea', 'tno_cardigan_bay'),
    ('tno_irish_sea', 'tno_liverpool_bay'),
    ('tno_irish_sea', 'tno_solway_firth'),
    ('tno_bering_sea', 'tno_northeast_pacific_ocean'),
    ('tno_bering_sea', 'tno_gulf_of_alaska'),
    ('tno_gulf_of_alaska', 'tno_northeast_pacific_ocean'),
    ('tno_beaufort_sea', 'tno_western_arctic_ocean'),
    ('tno_labrador_sea', 'tno_northwest_atlantic_ocean'),
    ('tno_labrador_sea', 'tno_gulf_of_st_lawrence'),
    ('tno_gulf_of_st_lawrence', 'tno_northwest_atlantic_ocean'),
    ('tno_hudson_bay', 'tno_northwest_atlantic_ocean'),
    ('tno_hudson_bay', 'tno_western_arctic_ocean'),
    ('tno_caribbean_sea', 'tno_west_central_atlantic_ocean'),
    ('tno_caribbean_sea', 'tno_gulf_of_mexico'),
    ('tno_gulf_of_mexico', 'tno_west_central_atlantic_ocean'),
    ('tno_yellow_sea', 'tno_bo_hai'),
    ('tno_bo_hai', 'tno_liaodong_wan'),
    ('tno_east_china_sea', 'tno_taiwan_strait'),
    ('tno_south_china_sea', 'tno_taiwan_strait'),
    ('tno_sea_of_japan', 'tno_seto_naikai'),
    ('tno_sea_of_japan', 'tno_tatarskiy_proliv'),
    ('tno_sea_of_japan', 'tno_sea_of_okhotsk'),
    ('tno_south_china_sea', 'tno_gulf_of_tonkin'),
    ('tno_south_china_sea', 'tno_gulf_of_thailand'),
    ('tno_south_china_sea', 'tno_natuna_sea'),
    ('tno_south_china_sea', 'tno_singapore_strait'),
    ('tno_south_china_sea', 'tno_java_sea'),
    ('tno_south_china_sea', 'tno_sulu_sea'),
    ('tno_arabian_sea', 'tno_gulf_of_aden'),
    ('tno_arabian_sea', 'tno_gulf_of_oman'),
    ('tno_gulf_of_oman', 'tno_persian_gulf'),
    ('tno_red_sea', 'tno_gulf_of_aden'),
    ('tno_bay_of_bengal', 'tno_andaman_sea'),
    ('tno_bay_of_bengal', 'tno_malacca_strait'),
    ('tno_andaman_sea', 'tno_malacca_strait'),
    ('tno_andaman_sea', 'tno_singapore_strait'),
    ('tno_philippine_sea', 'tno_sulu_sea'),
    ('tno_philippine_sea', 'tno_celebes_sea'),
    ('tno_philippine_sea', 'tno_molucca_sea'),
    ('tno_philippine_sea', 'tno_halmahera_sea'),
    ('tno_celebes_sea', 'tno_makassar_strait'),
    ('tno_java_sea', 'tno_makassar_strait'),
    ('tno_banda_sea', 'tno_molucca_sea'),
    ('tno_banda_sea', 'tno_halmahera_sea'),
    ('tno_molucca_sea', 'tno_celebes_sea'),
    ('tno_molucca_sea', 'tno_halmahera_sea'),
    ('tno_molucca_sea', 'tno_banda_sea'),
    ('tno_coral_sea', 'tno_gulf_of_papua'),
    ('tno_coral_sea', 'tno_torres_strait'),
    ('tno_coral_sea', 'tno_great_barrier_reef_coastal_waters'),
    ('tno_tasman_sea', 'tno_bass_strait'),
    ('tno_arafura_sea', 'tno_gulf_of_carpentaria'),
    ('tno_arafura_sea', 'tno_timor_sea'),
    ('tno_taiwan_strait', 'tno_northwest_pacific_ocean'),
    ('tno_seto_naikai', 'tno_northwest_pacific_ocean'),
    ('tno_tatarskiy_proliv', 'tno_northwest_pacific_ocean'),
    ('tno_natuna_sea', 'tno_west_central_pacific_ocean'),
    ('tno_gulf_of_tonkin', 'tno_west_central_pacific_ocean'),
    ('tno_gulf_of_thailand', 'tno_west_central_pacific_ocean'),
    ('tno_makassar_strait', 'tno_west_central_pacific_ocean'),
    ('tno_gulf_of_papua', 'tno_west_central_pacific_ocean'),
    ('tno_torres_strait', 'tno_west_central_pacific_ocean'),
    ('tno_molucca_sea', 'tno_west_central_pacific_ocean'),
    ('tno_halmahera_sea', 'tno_west_central_pacific_ocean'),
    ('tno_banda_sea', 'tno_west_central_pacific_ocean'),
    ('tno_bass_strait', 'tno_southwest_pacific_ocean'),
    ('tno_timor_sea', 'tno_southern_indian_ocean'),
    ('tno_great_australian_bight', 'tno_southern_indian_ocean'),
]


def _load_feature_map():
    payload = json.loads(SCENARIO_WATER_PATH.read_text(encoding='utf-8'))
    return {
        str(feature.get('properties', {}).get('id') or ''): feature
        for feature in payload.get('features', [])
        if str(feature.get('properties', {}).get('id') or '').strip()
    }


def test_target_named_waters_exist_with_expected_contract():
    feature_map = _load_feature_map()
    for feature_id, water_type in TARGET_PARENT_IDS.items():
        feature = feature_map.get(feature_id)
        assert feature is not None, feature_id
        props = feature.get('properties', {})
        assert str(props.get('water_type') or '').strip() == water_type, feature_id
        assert str(props.get('region_group') or '').strip() == 'marine_macro', feature_id
        assert bool(props.get('interactive')) is True, feature_id
        assert str(props.get('scenario_id') or '').strip() == 'tno_1962', feature_id

    for feature_id, parent_id in TARGET_DETAIL_PARENT_MAP.items():
        feature = feature_map.get(feature_id)
        assert feature is not None, feature_id
        props = feature.get('properties', {})
        assert str(props.get('region_group') or '').strip() == 'marine_detail', feature_id
        assert str(props.get('parent_id') or '').strip() == parent_id, feature_id
        assert bool(props.get('interactive')) is True, feature_id
        assert str(props.get('scenario_id') or '').strip() == 'tno_1962', feature_id


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
