from copy import deepcopy
import json
import unittest
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


class OverlayExtensionTests(unittest.TestCase):
    def setUp(self):
        self.inputs = dict(
            features={fid: {"cntr_code": "AA"} for fid in ("a", "b", "c")},
            owners={fid: "AA" for fid in ("a", "b", "c")},
            cores={fid: ["AA"] for fid in ("a", "b", "c")},
            countries={"AA": {"color_hex": "#123456"}}, default_country="AA",
            hierarchy_groups={}, country_meta={}, prefectures={}, bucket_by_feature={}, plans=[],
            point_for_feature={"a": (0, 0), "b": (2, 2), "c": (5, 5)}.__getitem__)
        self.rule = dict(id="new", scenarios=["modern_world"], tag="NEW", name_en="New",
                         name_zh="新", parent_owner_tag="AA", select={"feature_ids": ["a"]})

    def apply(self, **changes):
        return apply_overlay({"version": 1, "entries": [{**self.rule, **changes}]},
                             "modern_world", **self.inputs)

    def test_polygons_alone_filter_and_exclusion(self):
        rings = [[[-1, -1], [1, -1], [1, 1], [-1, 1]],
                 [[1, 1], [3, 1], [3, 3], [1, 3]]]
        self.assertEqual(set(self.apply(select={"polygons": rings})[1]), {"a", "b"})
        self.assertEqual(set(self.apply(select={"feature_ids": ["a", "c"], "polygons": rings})[1]), {"a"})
        self.assertEqual(set(self.apply(select={"bbox": [-1, -1, 1, 1], "polygons": rings})[1]), {"a"})
        self.assertEqual(set(self.apply(select={"feature_ids": ["a", "b", "c"]},
                                        exclude={"polygons": rings})[1]), {"c"})

    def test_presentation_and_inspector_metadata_for_new_and_existing_tag(self):
        fields = dict(presentation="parent_merged", inspector_group_id="group",
                      inspector_group_label="Group", inspector_group_anchor_id="AA",
                      display_name_zh="新名称", color_hex="#abcdef")
        countries, assignments, _ = self.apply(**fields)
        for key, value in fields.items():
            self.assertEqual(countries["NEW"][key], value)
        self.inputs["countries"] = countries
        self.inputs["owners"]["a"] = assignments["a"]["owner"]
        self.inputs["cores"]["a"] = assignments["a"]["cores"]
        updated, _, report = self.apply(**{**fields, "inspector_group_label": "Updated"},
                                        only_from_owners=["AA"])
        self.assertEqual(updated["NEW"]["inspector_group_label"], "Updated")
        self.assertEqual(report["changed_count"], 0)

    def test_invalid_presentation_or_parent(self):
        for changes in ({"presentation": "unknown"},
                        {"presentation": "parent_merged", "parent_owner_tag": ""},
                        {"presentation": "parent_merged", "parent_owner_tag": "BAD"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.apply(**changes)
        del self.rule["parent_owner_tag"]
        with self.assertRaisesRegex(ValueError, "parent_owner_tag"):
            self.apply(presentation="parent_merged", color_hex="#abcdef")


@pytest.mark.parametrize("scenario", ["hoi4_1936", "hoi4_1939"])
def test_batch7_exact_ownership_cores_and_replay(inputs, scenario):
    root = Path(__file__).resolve().parents[1]
    rules = json.loads((root / "data/scenario-rules/hoi4_split_overlay.json").read_text(encoding="utf-8"))
    rules["entries"] = [e for e in rules["entries"] if e["id"].startswith("batch7_")]
    expected = {}
    originals = {}
    southwest = {
        "DEE": ("SIC", "74822957782790"),
        "TRH": ("SIC", "41775887521063 11052099771689 35412891437316"),
        "CIH": ("YUN", "39835801597087 3387618125304 56639900099930"),
        "MLN": ("YUN", "37558107040134"),
        "GEM": ("YUN", "8449177634457"),
        "GLG": ("QMA", "82919928587081 66695118162266 1787117911325 28481452848090 2182407224263 52151949988531"),
        "YSH": ("QMA", "66736115774382 19636254999944 27939254726366 13951895453383 24277287807877 94078824919955"),
    }
    for tag, (parent, numbers) in southwest.items():
        for number in numbers.split():
            fid = "CN_CITY_17275852B" + number
            expected[fid], originals[fid] = tag, parent
    assert len(expected) == 21
    for parent, tag, ids in [
        ("WDN", "LHJ", ["YEM-157"]), ("WDN", "ABY", ["YEM-3511"]),
        ("WDN", "SHW", ["YEM-336"]), ("EDN", "HDM", ["YEM-3497"]),
        ("EDN", "MHA", ["YEM-332"]), ("CAN", "YUK", ["CA_FED_60001"]),
        ("CAN", "NWT", ["CA_FED_61001", "CA_FED_62001"]),
        ("ENG", "GGY", ["GG"]), ("ENG", "JEY", ["JE"]), ("ENG", "IOM", ["IM"]),
        ("AST", "HRD", ["HM"]), ("USA", "SUB", ["PHL-5540"]),
        ("AST", "NTR", ["AU_ADM1_AUS-2650"]),
        ("ENG", "AAT", ["AQ_AAT_EAST", "AQ_AAT_WEST"]),
        ("ENG", "ROS", ["AQ_ROSS"]), ("ENG", "MAD", ["AQ_ADELIE"]),
        ("ENG", "ATA" if scenario == "hoi4_1936" else "QML", ["AQ_QML"]),
        ("ENG", "ATA", ["AQ_MARIE_BYRD", "AQ_PEN_WEST"]),
        ("ENG", "FLK", ["AQ_PEN_EAST", "AQ_PEN_OVERLAP_CORE", "AQ_PEN_OVERLAP_EAST", "AQ_PEN_OVERLAP_WEST"]),
    ]:
        for fid in ids:
            expected[fid], originals[fid] = tag, parent
    originals.update({"CN_CITY_17275852B99290886399570": "QMA", "CN_CITY_17275852B51096101365561": "MAN",
                      "AU_ADM1_AUS-2653": "AST", "YEM-334": "YEM", "GF_PRIMARY": "CAY",
                      "YEM-3510": "RAJ" if scenario == "hoi4_1936" else "ADN",
                      "alaska": "ALK", "hawaii": "HAW", "cambodia": "VIN", "laos": "VIN", "vietnam": "VIN"})
    expected.update(cambodia="CAM", laos="LAO")
    inputs.update(features={fid: {"id": fid, "cntr_code": {"cambodia": "KH", "laos": "LA", "vietnam": "VN"}.get(fid, "CN")} for fid in originals},
                  owners=originals.copy(), cores={fid: [owner] for fid, owner in originals.items()},
                  countries={tag: {"tag": tag, "color_hex": "#c94a6a"} for tag in set(originals.values()) | {"NZL", "NOR", "MAD", "FLK"}},
                  hierarchy_groups={}, prefectures={}, plans=[], bucket_by_feature={})
    countries, assignments, report = apply_overlay(rules, scenario, **inputs)
    assert {fid: a["owner"] for fid, a in assignments.items()} == expected
    assert all(a["cores"] == [originals[fid]] for fid, a in assignments.items())
    assert countries["AAT"]["parent_owner_tag"] == ("ENG" if scenario == "hoi4_1936" else "AST")
    assert not countries["ATA"].get("parent_owner_tag")
    assert {countries[t]["subject_kind"] for t in ("ALK", "HAW")} == {"territory"}
    assert {countries[t]["parent_owner_tag"] for t in ("CAM", "LAO")} == {"VIN"}
    inputs["countries"] = countries
    inputs["owners"].update({fid: a["owner"] for fid, a in assignments.items()})
    repeated, assignments, report = apply_overlay(rules, scenario, **inputs)
    assert assignments == {}
    assert report["changed_count"] == 0
    assert repeated == countries
    assert not set(inputs["owners"].values()) & {"WDN", "EDN"}
    assert {"WDN", "EDN"} <= countries.keys()


@pytest.mark.parametrize("scenario", ["hoi4_1936", "hoi4_1939", "tno_1962", "modern_world"])
def test_landless_parent_container_metadata_survives_replay(inputs, scenario):
    rules = [
        entry({"country_codes": ["CA"]}, id="parent", tag="CAN", parent_owner_tag="ENG",
              only_from_owners=["CAN"], scenarios=[scenario]),
        entry({"country_codes": ["CA"]}, id="child", tag="NFL", parent_owner_tag="CAN",
              only_from_owners=["CAN"], cores="keep", scenarios=[scenario]),
    ]
    countries, assignments, _ = apply(inputs, *rules, scenario=scenario)
    assert countries["CAN"]["entry_kind"] == "scenario_container"
    inputs["countries"] = countries
    inputs["owners"].update({fid: row["owner"] for fid, row in assignments.items()})
    inputs["cores"].update({fid: row["cores"] for fid, row in assignments.items()})
    repeated, assignments, report = apply(inputs, *rules, scenario=scenario)
    assert repeated == countries
    assert assignments == {}
    assert report["changed_count"] == 0
    assert report["retired_tags"] == []


def test_owner_selected_colour_entries_follow_the_entries_that_create_their_territory():
    # A colour-only entry selects its tag by owner; on a fresh build the tag owns
    # nothing until its territory entry (e.g. panama_canal_zone -> PCZ) has run.
    overlay = json.loads((Path(__file__).resolve().parents[1] / "data/scenario-rules/hoi4_split_overlay.json").read_text(encoding="utf-8"))
    first_creator = {}
    for index, entry in enumerate(overlay["entries"]):
        tag, select = entry.get("tag"), entry.get("select", {})
        if tag and select.get("owners") != [tag]:
            for scenario in entry["scenarios"]:
                first_creator.setdefault((tag, scenario), index)
    for index, entry in enumerate(overlay["entries"]):
        tag = entry.get("tag")
        if "_family_colour_" in entry["id"]:
            for scenario in entry["scenarios"]:
                creator = first_creator.get((tag, scenario))
                assert creator is None or creator < index, (entry["id"], scenario)
