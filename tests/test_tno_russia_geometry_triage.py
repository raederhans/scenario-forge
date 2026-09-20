from shapely.geometry import box

from tools.triage_tno_russia_geometry import source_partition_evidence


def test_source_evidence_does_not_hide_unexplained_overlap():
    result = source_partition_evidence(box(0, 0, 3, 1), box(0, 0, 1, 1), box(1, 0, 2, 1))
    assert result['left_source_km2'] > 0
    assert abs(result['left_source_km2'] - result['right_source_km2']) < 1e-6
    assert result['both_sources_km2'] == 0
    assert abs(result['outside_sources_km2'] - result['left_source_km2']) < 1e-6


def test_ambiguous_raw_overlap_is_reported_separately():
    result = source_partition_evidence(box(0, 0, 3, 1), box(0, 0, 2, 1), box(1, 0, 3, 1))
    assert result['both_sources_km2'] > 0
    assert result['outside_sources_km2'] == 0
    assert abs(sum(result.values()) - 3 * result['left_source_km2']) < 1e-6
