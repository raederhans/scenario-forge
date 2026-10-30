from copy import deepcopy
import json
from pathlib import Path

import pytest

from tools.apply_hoi4_split_overlay import apply_overlay, make_point_lookup, run_scenario
from scenario_builder.hoi4.crosswalk import _derive_subject_color_hex


@pytest.fixture
def enclave_inputs(inputs):
    arcs, registry, geometries = [], {}, []
    for x in range(3):
        for y in range(3):
            points = [(x / 10, y / 10), ((x + 1) / 10, y / 10),
                      ((x + 1) / 10, (y + 1) / 10), (x / 10, (y + 1) / 10)]
            ring = []
            for a, b in zip(points, points[1:] + points[:1]):
                key = tuple(sorted((a, b)))
                if key not in registry:
                    registry[key] = len(arcs)
                    arcs.append([list(p) for p in key])
                index = registry[key]
                ring.append(index if (a, b) == key else ~index)
            geometries.append({"type": "Polygon", "arcs": [ring],
                               "properties": {"id": f"{x}{y}", "cntr_code": "CN"}})
    inputs["topology"] = {"type": "Topology", "arcs": arcs,
                          "objects": {"political": {"type": "GeometryCollection", "geometries": geometries}}}
    inputs["features"] = {g["properties"]["id"]: g["properties"] for g in geometries}
    inputs["owners"] = {fid: "CAN" if fid == "11" else "ENG" for fid in inputs["features"]}
    inputs["cores"] = {fid: ["CHI"] for fid in inputs["features"]}
    return inputs


def smoothing_rule(**kwargs):
    return {"id": "smooth", "scenarios": ["hoi4_1939"],
            "smooth_enclaves": {"tags": ["CAN", "ENG"], "max_area_km2": 3000, **kwargs}}


def test_smooth_shared_arcs_preserves_cores_and_is_stable(enclave_inputs):
    assert apply(enclave_inputs, smoothing_rule(), scenario="hoi4_1936")[1] == {}
    countries, assignments, report = apply(enclave_inputs, smoothing_rule(), scenario="hoi4_1939")
    assert assignments == {"11": {"parent_id": "11", "owner": "ENG", "controller": "ENG", "cores": ["CHI"]}}
    assert report["changed_count"] == 1
    enclave_inputs["owners"]["11"] = "ENG"
    enclave_inputs["countries"] = countries
    assert apply(enclave_inputs, smoothing_rule(), scenario="hoi4_1939")[1] == {}


@pytest.mark.parametrize("case", ["large", "mixed", "outside_tags", "island"])
def test_smoothing_leaves_non_enclaves(enclave_inputs, case):
    rule = smoothing_rule(max_area_km2=1) if case == "large" else smoothing_rule()
    if case == "mixed":
        enclave_inputs["owners"]["12"] = "CHI"
    elif case == "outside_tags":
        rule = smoothing_rule(tags=["CHI", "CAN"])
    elif case == "island":
        topology = enclave_inputs["topology"]
        center = topology["objects"]["political"]["geometries"][4]
        start = len(topology["arcs"])
        topology["arcs"].extend([[[1, 1], [1.1, 1]], [[1.1, 1], [1.1, 1.1]],
                                 [[1.1, 1.1], [1, 1.1]], [[1, 1.1], [1, 1]]])
        center["arcs"] = [list(range(start, start + 4))]
    assert apply(enclave_inputs, rule, scenario="hoi4_1939")[1] == {}


@pytest.fixture
def inputs():
    return dict(
        features={fid: {"id": fid, "cntr_code": code} for fid, code in
                  [("CA_MRG_2", "CA"), ("ca", "CA"), ("cn", "CN"), ("eng", "GB")]},
        owners={"CA_MRG_2": "CAN", "ca": "CAN", "cn": "CHI", "eng": "ENG"},
        cores={"CA_MRG_2": ["CAN"], "ca": ["CAN"], "cn": ["CHI"], "eng": ["ENG"]},
        countries={tag: {"tag": tag, "color_hex": "#c94a6a", "rule_sources": ["old"]}
                   for tag in ("CAN", "CHI", "ENG")},
        default_country="ENG", hierarchy_groups={"CA_Group": ["a", "b"]},
        country_meta={"CA": {"continent_id": "north_america"}},
        prefectures={"CN_PREF_4201": {"label": "武汉市", "feature_ids": ["cn"]}},
        bucket_by_feature={"CA_MRG_2": "s608", "ca": "s609", "cn": "s1", "eng": "s2"},
        plans=[("first", {"groups": [{"id": "CA_MRG_1", "member_ids": ["a", "b"]}]}),
               ("second", {"scenarios": ["hoi4_1936", "hoi4_1939"],
                           "groups": [{"id": "CA_MRG_2", "member_ids": ["CA_MRG_1", "c", "d"]}]}),
               ("other", {"scenarios": ["modern_world"],
                          "groups": [{"id": "ca", "member_ids": ["x", "y"]}]})],
    )


def entry(select, **kwargs):
    return {"id": "split", "scenarios": ["hoi4_1936", "hoi4_1939"], "tag": "NFL",
            "name_en": "Newfoundland", "name_zh": "纽芬兰", "parent_owner_tag": "ENG",
            "subject_kind": "dominion", "select": select, **kwargs}


def apply(inputs, *entries, scenario="hoi4_1936"):
    return apply_overlay({"version": 1, "entries": list(entries)}, scenario, **inputs)


@pytest.mark.parametrize("selector,expected", [
    ({"country_codes": ["CA"]}, {"CA_MRG_2", "ca"}),
    ({"prefectures": ["武汉市"]}, {"cn"}),
    ({"prefectures": ["CN_PREF_4201"]}, {"cn"}),
    ({"hierarchy_groups": ["CA_Group"]}, {"CA_MRG_2"}),
    ({"hoi4_states": [608]}, {"CA_MRG_2"}),
    ({"feature_ids": ["a", "b"]}, {"CA_MRG_2"}),
    ({"feature_ids": ["CA_MRG_2"]}, {"CA_MRG_2"}),
    ({"feature_ids": ["ca"]}, {"ca"}),
    ({"country_codes": ["CA"], "hoi4_states": [1]}, {"CA_MRG_2", "ca", "cn"}),
])
def test_selectors(inputs, selector, expected):
    _, assignments, _ = apply(inputs, entry(selector))
    assert set(assignments) == expected
    assert all(value["parent_id"] == fid and value["controller"] == "NFL"
               for fid, value in assignments.items())


@pytest.mark.parametrize("selector", [{"feature_ids": ["cn"]}, {"hierarchy_groups": ["CN_Province"]},
                                      {"prefectures": ["武汉市"]}])
def test_split_selectors(inputs, selector):
    inputs["hierarchy_groups"]["CN_Province"] = ["cn"]
    inputs["feature_splits"] = {"cn": ["cn_south", "cn_north"]}
    for key in ("features", "owners", "cores", "bucket_by_feature"):
        value = inputs[key].pop("cn")
        inputs[key].update({child: deepcopy(value) for child in inputs["feature_splits"]["cn"]})
    _, assignments, _ = apply(inputs, entry(selector))
    assert set(assignments) == {"cn_south", "cn_north"}
    assert set(apply(inputs, entry({"feature_ids": ["cn_south"]}))[1]) == {"cn_south"}


def test_split_unresolved_prefecture_hole(inputs):
    inputs["prefectures"]["CN_PREF_4201"]["province_id"] = "CN_Province"
    inputs["feature_splits"] = {"hole": ["hole_south", "hole_north"]}
    inputs["unresolved"] = [{"feature_id": "hole", "province_id": "CN_Province"}]
    for child in inputs["feature_splits"]["hole"]:
        inputs["features"][child] = {"id": child, "cntr_code": "CN"}
        inputs["owners"][child] = "CHI"
        inputs["cores"][child] = ["CHI"]
    inputs["point_for_feature"] = lambda fid: (0, 0)
    _, assignments, report = apply(inputs, entry({"prefectures": ["武汉市"]}))
    assert set(assignments) == {"cn", "hole_south", "hole_north"}
    assert report["filled_prefecture_leaf_count"] == 2


def test_split_merged_parent_preserves_member_selection_threshold(inputs):
    parent = "CA_MRG_2"
    inputs["feature_splits"] = {parent: ["CA_south", "CA_north"]}
    for key in ("features", "owners", "cores", "bucket_by_feature"):
        value = inputs[key].pop(parent)
        inputs[key].update({child: deepcopy(value) for child in inputs["feature_splits"][parent]})
    assert set(apply(inputs, entry({"feature_ids": [parent]}))[1]) == {"CA_south", "CA_north"}
    assert set(apply(inputs, entry({"feature_ids": ["CA_south"]}))[1]) == {"CA_south"}
    _, assignments, report = apply(inputs, entry({"feature_ids": ["a", "ca"]}))
    assert set(assignments) == {"ca"}
    assert len(report["partial_merged"]) == 2
    assert all(row["ratio"] == .25 for row in report["partial_merged"])
    assert set(apply(inputs, entry({"hierarchy_groups": ["CA_Group"]}))[1]) == {"CA_south", "CA_north"}


def test_exclude_and_sequential_owner_filter(inputs):
    _, assignments, report = apply(
        inputs, entry({"country_codes": ["CA"]}, exclude={"feature_ids": ["ca"]}),
        entry({"country_codes": ["CA"]}, id="second", tag="CHI", only_from_owners=["NFL"]),
    )
    assert set(assignments) == {"CA_MRG_2"}
    assert assignments["CA_MRG_2"]["owner"] == "CHI"
    assert [e["selected_count"] for e in report["entries"]] == [1, 1]


@pytest.mark.parametrize("members,ratio,selected", [(["a"], .25, False), (["a", "b"], .5, True),
                                                        (["a", "b", "c"], .75, True)])
def test_partial_merges(inputs, members, ratio, selected):
    _, assignments, report = apply(inputs, entry({"feature_ids": members + ["ca"]}))
    assert ("CA_MRG_2" in assignments) == selected
    assert report["partial_merged"] == [{"entry_id": "split", "runtime_id": "CA_MRG_2",
                                          "ratio": ratio, "selector": "select"}]


def test_scenario_scope(inputs):
    inputs["plans"][1][1]["scenarios"] = ["hoi4_1939"]
    _, assignments, report = apply(inputs, entry({"feature_ids": ["a", "b", "ca"]}))
    assert set(assignments) == {"ca"}
    assert report["partial_merged"] == []
    _, assignments, _ = apply(inputs, entry({"feature_ids": ["a", "b"]}), scenario="hoi4_1939")
    assert set(assignments) == {"CA_MRG_2"}
    with pytest.raises(ValueError, match="split.*unknown feature"):
        apply(inputs, entry({"feature_ids": ["x"]}))
    assert apply(inputs, entry({"feature_ids": ["cn"]}, scenarios=["hoi4_1939"]))[1] == {}


@pytest.mark.parametrize("mode,expected", [("owner", ["NFL"]), ("keep", ["CAN"]), (["CHI"], ["CHI"])])
def test_cores(inputs, mode, expected):
    assert apply(inputs, entry({"feature_ids": ["ca"]}, cores=mode))[1]["ca"]["cores"] == expected


def test_forward_core_declaration(inputs):
    _, assignments, _ = apply(inputs, entry({"feature_ids": ["ca"]}, cores=["WHN"]),
                             entry({"feature_ids": ["cn"]}, id="wuhan", tag="WHN"))
    assert assignments["ca"]["cores"] == ["WHN"]


def test_new_country_and_existing_update(inputs):
    countries, _, _ = apply(inputs, entry({"feature_ids": ["ca"]}))
    country = countries["NFL"]
    assert country["color_hex"] == _derive_subject_color_hex("#c94a6a", "NFL", "dominion")
    assert country["base_iso2"] == country["lookup_iso2"] == country["provenance_iso2"] == "CA"
    assert country["continent_id"] == "north_america"
    assert country["subregion_id"] == ""
    assert country["display_name"] == country["display_name_en"] == "Newfoundland"
    assert country["parent_owner_tags"] == ["ENG"]
    assert country["historical_fidelity_summary"] == ["extended"]
    assert country["rule_sources"] == ["split"]
    assert country["entry_kind"] == "scenario_subject"
    original = deepcopy(inputs)
    update = {"id": "update", "scenarios": ["hoi4_1936"], "tag": "CAN",
              "select": {"feature_ids": ["ca"]}, "notes": "updated"}
    countries, assignments, _ = apply(inputs, update)
    assert countries["CAN"] == {**inputs["countries"]["CAN"], "notes": "updated", "rule_sources": ["old", "update"]}
    assert assignments == {}
    assert inputs == original


def test_retirement_and_protection(inputs):
    countries, _, report = apply(inputs, entry({"country_codes": ["CA"]}))
    assert "CAN" not in countries
    assert report["retired_tags"] == ["CAN"]
    inputs["default_country"] = "CAN"
    with pytest.raises(ValueError, match="split.*protected.*CAN"):
        apply(inputs, entry({"country_codes": ["CA"]}))
    inputs["default_country"] = "ENG"
    # A landless parent of a remaining subject stays as a hierarchy container.
    inputs["countries"]["CHI"]["parent_owner_tag"] = "CAN"
    countries, _, report = apply(inputs, entry({"country_codes": ["CA"]}))
    assert countries["CAN"]["entry_kind"] == "scenario_container"
    assert report["retired_tags"] == []


def test_retirement_blocked_by_kept_core(inputs):
    # Taking a country's last parcels while keeping its cores must not leave a dangling core tag.
    with pytest.raises(ValueError, match="split.*protected.*CAN"):
        apply(inputs, entry({"country_codes": ["CA"]}, cores="keep"))


@pytest.mark.parametrize("selector", [{"unknown": [1]}, {"hierarchy_groups": ["missing"]},
                                      {"prefectures": ["missing"]}, {"hoi4_states": [999]},
                                      {"feature_ids": ["missing"]}, {"country_codes": ["ZZ"]}])
def test_unknown_or_empty_selector(inputs, selector):
    with pytest.raises(ValueError, match="split"):
        apply(inputs, entry(selector))


def test_ambiguous_prefecture(inputs):
    inputs["prefectures"]["duplicate"] = inputs["prefectures"]["CN_PREF_4201"]
    with pytest.raises(ValueError, match="split.*ambiguous"):
        apply(inputs, entry({"prefectures": ["武汉市"]}))


@pytest.mark.parametrize("changes", [{"tag": "bad"}, {"name_en": ""},
                                     {"cores": ["BAD"]}, {"cores": "invalid"},
                                     {"parent_owner_tag": ""}])
def test_invalid_entry(inputs, changes):
    with pytest.raises(ValueError, match="split"):
        apply(inputs, entry({"feature_ids": ["ca"]}, **changes))


def test_duplicate_id(inputs):
    e = entry({"feature_ids": ["ca"]})
    with pytest.raises(ValueError, match="split.*duplicate"):
        apply(inputs, e, e)


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


def test_filtered_idempotence(inputs):
    e = entry({"country_codes": ["CA"]}, only_from_owners=["CAN"])
    countries, assignments, _ = apply(inputs, e)
    inputs["countries"] = countries
    for fid, value in assignments.items():
        inputs["owners"][fid], inputs["cores"][fid] = value["owner"], value["cores"]
    again, assignments, report = apply(inputs, e)
    assert again == countries
    assert assignments == {}
    assert report["entries"] == [{"entry_id": "split", "selected_count": 0,
                                   "changed_count": 0, "empty_after_filter": True}]


def test_filtered_rerun_still_updates_metadata(inputs):
    e = entry({"country_codes": ["CA"]}, only_from_owners=["CAN"], color_hex="#111111")
    countries, assignments, _ = apply(inputs, e)
    inputs["countries"] = countries
    for fid, value in assignments.items():
        inputs["owners"][fid], inputs["cores"][fid] = value["owner"], value["cores"]
    again, assignments, _ = apply(inputs, {**e, "color_hex": "#222222", "name_zh": "纽芬兰自治领"})
    assert assignments == {}
    assert again["NFL"]["color_hex"] == "#222222"
    assert again["NFL"]["display_name_zh"] == "纽芬兰自治领"


def test_empty_exclude_and_empty_after_exclude(inputs):
    _, assignments, _ = apply(inputs, entry({"feature_ids": ["ca"]}, exclude={"owners": ["ZZZ"]}))
    assert set(assignments) == {"ca"}
    countries, assignments, report = apply(inputs, entry({"feature_ids": ["ca"]},
                                                        exclude={"country_codes": ["CA"]}))
    assert countries == inputs["countries"]
    assert assignments == {}
    assert report["entries"][0]["empty_after_filter"] is True


def test_current_owner_selector(inputs):
    _, assignments, report = apply(inputs, entry({"feature_ids": ["ca"]}),
                                  entry({"owners": ["NFL"]}, id="second", tag="CHI"))
    assert set(assignments) == {"ca"}
    assert assignments["ca"]["owner"] == "CHI"
    assert report["entries"][1]["selected_count"] == 1


@pytest.mark.parametrize("selector,expected", [
    ({"bbox": [0, 0, 1, 1]}, {"ca", "cn"}),
    ({"country_codes": ["CA"], "bbox": [0, 0, 1, 1]}, {"ca"}),
    ({"owners": ["CHI"], "feature_ids": ["ca"], "bbox": [0, 0, 1, 1]}, {"ca", "cn"}),
    ({"bboxes": [[0, 0, 0, 0], [2, 2, 2, 2]]}, {"ca", "CA_MRG_2"}),
    ({"bbox": [0, 0, 0, 0], "bboxes": [[2, 2, 2, 2]]}, {"ca", "CA_MRG_2"}),
])
def test_bbox_selectors(inputs, selector, expected):
    points = {"ca": (0, 0), "cn": (1, 1), "CA_MRG_2": (2, 2), "eng": (3, 3)}
    inputs["point_for_feature"] = points.__getitem__
    _, assignments, _ = apply(inputs, entry(selector))
    assert set(assignments) == expected


def test_bbox_exclude(inputs):
    inputs["point_for_feature"] = {"ca": (0, 0), "CA_MRG_2": (2, 2),
                                   "cn": (1, 1), "eng": (3, 3)}.__getitem__
    _, assignments, _ = apply(inputs, entry({"country_codes": ["CA"]}, exclude={"bbox": [0, 0, 1, 1]}))
    assert set(assignments) == {"CA_MRG_2"}


def test_geometry_is_lazy_and_cached(monkeypatch):
    from tools import patch_tno_1962_bundle

    topology = {"type": "Topology", "transform": {"scale": [0.5, 0.5], "translate": [10, 20]},
                "arcs": [[[0, 0], [4, 0], [0, 4], [-4, 0], [0, -4]]],
                "objects": {"political": {"type": "GeometryCollection", "geometries": [
                    {"type": "Polygon", "arcs": [[0]], "properties": {"id": "ca"}}]}}}
    original = deepcopy(topology)
    calls = []
    decode = patch_tno_1962_bundle.topology_object_to_gdf

    def counted(*args):
        calls.append(1)
        return decode(*args)

    monkeypatch.setattr(patch_tno_1962_bundle, "topology_object_to_gdf", counted)
    lookup = make_point_lookup(topology)
    assert calls == []
    assert lookup("ca") == (11, 21)
    assert lookup("ca") == (11, 21)
    assert len(calls) == 1
    assert topology == original


def test_inactive_bbox_does_not_compute_points(inputs):
    def unexpected(fid):
        pytest.fail("inactive bbox must not request geometry")

    inputs["point_for_feature"] = unexpected
    apply(inputs, entry({"bbox": [0, 0, 1, 1]}, scenarios=["hoi4_1939"]),
          entry({"feature_ids": ["ca"]}, id="active"))


@pytest.mark.parametrize("merged", [False, True])
def test_prefecture_hole_nearest_neighbor(inputs, merged):
    fixture = json.loads((Path(__file__).parent / "fixtures/hoi4_split_overlay/prefecture_holes.json")
                         .read_text(encoding="utf-8"))
    points = fixture["points"]
    plans = []
    if merged:
        points = {"mixed": [0, 0], "hole_block": [1, 0], "other": [1.1, 0], "a": [5, 0]}
        plans = [("merged", {"groups": [
            {"id": "mixed", "member_ids": ["b", "c", "minority"]},
            {"id": "hole_block", "member_ids": ["hole", "resolved"]},
        ]})]
        fixture["groups"]["PREF_A"]["feature_ids"].extend(["minority", "resolved"])
    inputs.update(features={fid: {"id": fid, "cntr_code": "CN"} for fid in points},
                  owners={fid: "CHI" for fid in points}, cores={fid: ["CHI"] for fid in points},
                  prefectures=fixture["groups"], unresolved=fixture["unresolved"], plans=plans,
                  point_for_feature=points.__getitem__)
    before = deepcopy(fixture)
    target = "乙市" if merged else "甲市"
    _, assignments, report = apply(inputs, entry({"prefectures": [target]}),
                                  entry({"prefectures": [target]}, id="repeat"))
    assert ("hole_block" if merged else "hole") in assignments
    assert "other" not in assignments
    assert report["filled_prefecture_leaf_count"] == 1
    assert fixture == before


def test_io_refresh_and_dry_run(inputs):
    payloads = {
        "runtime_topology.topo.json": {"objects": {"political": {"geometries": [
            {"properties": props} for props in inputs["features"].values()]}}},
        "countries.json": {"countries": inputs["countries"], "version": 1},
        "owners.by_feature.json": {"owners": inputs["owners"]},
        "cores.by_feature.json": {"cores": inputs["cores"]},
        "manifest.json": {"default_country": "ENG"},
        "china_prefecture_crosswalk.v1.json": {"groups": inputs["prefectures"]},
        "strategic_values.by_feature.json": {"bucket_by_feature": inputs["bucket_by_feature"]},
    }
    events = []

    def write(path, payload):
        events.append("write")
        assert path.name == "countries.json"
        payloads[path.name] = payload

    def refresh(path, assignments, removed_ids):
        events.append("refresh")
        assert path == Path("hoi4_1936")
        assert removed_ids == ()
        assert "NFL" in payloads["countries.json"]["countries"]
        for fid, value in assignments.items():
            assert value["parent_id"] == fid
            inputs["owners"][fid] = value["owner"]
            inputs["cores"][fid] = value["cores"]

    kwargs = dict(read=lambda p: deepcopy(payloads[p.name]), write=write, refresh=refresh,
                  load_plans=lambda p: inputs["plans"],
                  load_hierarchy=lambda p: (inputs["hierarchy_groups"], inputs["country_meta"]))
    overlay = {"version": 1, "entries": [entry({"feature_ids": ["ca"]})]}
    run_scenario(overlay, Path("hoi4_1936"), dry_run=True, **kwargs)
    assert events == []
    run_scenario(overlay, Path("hoi4_1936"), **kwargs)
    assert events == ["write", "refresh"]
    snapshot = deepcopy(payloads)
    run_scenario(overlay, Path("hoi4_1936"), **kwargs)
    assert events == ["write", "refresh"]
    assert payloads == snapshot
