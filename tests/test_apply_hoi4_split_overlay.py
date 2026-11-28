import pytest

from tools.apply_hoi4_split_overlay import apply_overlay


@pytest.fixture
def inputs():
    return dict(
        features={fid: {"id": fid, "cntr_code": code} for fid, code in
                  [("CA_MRG_2", "CA"), ("ca", "CA"), ("cn", "CN"), ("eng", "GB")]},
        owners={"CA_MRG_2": "CAN", "ca": "CAN", "cn": "CHI", "eng": "ENG"},
        cores={"CA_MRG_2": ["CAN"], "ca": ["CAN"], "cn": ["CHI"], "eng": ["ENG"]},
        countries={tag: {"tag": tag, "color_hex": "#c94a6a", "rule_sources": ["old"]}
                   for tag in ("CAN", "CHI", "ENG")},
        default_country="ENG", hierarchy_groups={}, country_meta={},
        prefectures={}, bucket_by_feature={},
        plans=[("first", {"groups": [{"id": "CA_MRG_1", "member_ids": ["a", "b"]}]}),
               ("second", {"scenarios": ["hoi4_1936", "hoi4_1939"],
                           "groups": [{"id": "CA_MRG_2", "member_ids": ["CA_MRG_1", "c", "d"]}]})],
    )


def entry(select, **kwargs):
    return {"id": "split", "scenarios": ["hoi4_1936", "hoi4_1939"], "tag": "NFL",
            "name_en": "Newfoundland", "name_zh": "纽芬兰", "parent_owner_tag": "ENG",
            "subject_kind": "dominion", "select": select, **kwargs}


def apply(inputs, *entries, scenario="hoi4_1936"):
    return apply_overlay({"version": 1, "entries": list(entries)}, scenario, **inputs)


def test_selectors(inputs):
    _, assignments, _ = apply(inputs, entry({"feature_ids": ["a", "b"]}))
    assert set(assignments) == {"CA_MRG_2"}
    assert all(value["parent_id"] == fid and value["controller"] == "NFL"
               for fid, value in assignments.items())


def test_exclude_and_sequential_owner_filter(inputs):
    _, assignments, report = apply(
        inputs, entry({"country_codes": ["CA"]}, exclude={"feature_ids": ["ca"]}),
        entry({"country_codes": ["CA"]}, id="second", tag="CHI", only_from_owners=["NFL"]),
    )
    assert set(assignments) == {"CA_MRG_2"}
    assert assignments["CA_MRG_2"]["owner"] == "CHI"
    assert [e["selected_count"] for e in report["entries"]] == [1, 1]


def test_cores(inputs):
    assert apply(inputs, entry({"feature_ids": ["ca"]}, cores="keep"))[1]["ca"]["cores"] == ["CAN"]


def test_retirement_blocked_by_kept_core(inputs):
    # Taking a country's last parcels while keeping its cores must not leave a dangling core tag.
    with pytest.raises(ValueError, match="split.*protected.*CAN"):
        apply(inputs, entry({"country_codes": ["CA"]}, cores="keep"))


def test_idempotence(inputs):
    e = entry({"country_codes": ["CA"]})
    countries, assignments, _ = apply(inputs, e)
    inputs["countries"] = countries
    for fid, value in assignments.items():
        inputs["owners"][fid], inputs["cores"][fid] = value["owner"], value["cores"]
    again, assignments, report = apply(inputs, e)
    assert again == countries
    assert assignments == {}
    assert report["entries"][0]["changed_count"] == 0
    assert report["retired_tags"] == []
