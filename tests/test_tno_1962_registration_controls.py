import numpy as np

from tools.tno_1962_registration import filter_geographic_controls


def test_global_affine_rejects_cross_continent_match_and_keeps_normal_controls():
    controls = [dict(province_id=index, x=(lon + 180) * 20, y=(90 - lat) * 20,
                     lon=lon, lat=lat)
                for index, (lon, lat) in enumerate((lon, lat) for lon in np.linspace(-150, 150, 11)
                                                  for lat in np.linspace(-50, 70, 7))]
    mismatch = dict(province_id=4407, x=(98 + 180) * 20, y=(90 - 30) * 20,
                    lon=-79.2663, lat=43.8668)
    kept, rejected = filter_geographic_controls(controls + [mismatch])
    assert kept == controls
    assert len(rejected) == 1
    assert rejected[0]['province_id'] == 4407
    assert rejected[0]['distance_km'] > 1500
    assert abs(rejected[0]['predicted_lonlat'][0] - 98) < 10


def test_consistent_controls_are_unchanged():
    controls = [dict(x=x, y=y, lon=x / 20 - 180, lat=90 - y / 20)
                for x, y in [(500, 500), (500, 2500), (3000, 1500), (6000, 500), (6000, 2500)]]
    kept, rejected = filter_geographic_controls(controls)
    assert kept == controls
    assert rejected == []
