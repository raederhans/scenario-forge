import json

import pytest
import shapely
from shapely.geometry import box

from tools.apply_hoi4_geometry_splits import load_cut_geometry, validate_partition_plan
from tools.build_hoi4_water_shape_splits import Candidate, MASK_FILE, build_rules, fit_bands


def test_clipped_rules_load_as_a_single_parent_partition(tmp_path):
    parent = box(0, 0, 5, 1)
    parents = {"A": (dict(name_en="Parent", name_zh="父地块"), parent)}
    lakes = [({}, box(0.1, 0, 0.2, 1)),
             ({"year_removed": 1939}, box(0.3, 0, 0.4, 1)),
             ({"year_built": 1939}, box(0.5, 0, 0.6, 1)),
             ({"year_built": 1940}, box(0.7, 0, 0.8, 1)),
             ({"year_removed": 1936}, box(0.9, 0, 1, 1))]
    # The disconnected tip inside A is under 30 km², even though the whole site is large.
    first = shapely.MultiPolygon([box(-1, 0, 2, 1), box(4.99, 0, 6, 0.05)])
    sites = [Candidate("SITE", "Site", "库址", "reservoir", first),
             Candidate("FLAT", "Flat", "盐沼", "playa", box(1, 0, 3, 1))]
    rules, masks = build_rules(parents, lakes, sites)
    validate_partition_plan(rules)
    (tmp_path / MASK_FILE).write_text(json.dumps(masks), encoding="utf-8")
    entry, = rules["entries"]
    assert entry["feature_ids"] == ["A"]
    assert entry["remainder"] == dict(suffix="REST", full_name=True, **parents["A"][0])
    assert [part["suffix"] for part in entry["parts"]] == ["SITE", "FLAT"]
    site, flat = [load_cut_geometry(p, tmp_path) for p in entry["parts"]]
    assert site.equals(box(0, 0, 2, 1).difference(shapely.union_all([g for _, g in lakes[:3]])))
    assert flat.equals(box(2, 0, 3, 1))


def test_fitted_states_cover_unmatched_shoreline():
    target = box(0, 0, 10, 2)
    bands = fit_bands({"west": [box(1, 1, 2, 2)], "east": [box(3, 1, 4, 2)]}, target)
    assert bands["west"].bounds == pytest.approx((0, 0, 5, 2))
    assert bands["west"].intersection(bands["east"]).area == 0
    assert shapely.union_all(list(bands.values())).equals(target)
