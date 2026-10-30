from copy import deepcopy
import json
import math
from pathlib import Path
import shutil
from uuid import uuid4

import pytest

from map_builder.scenario_political_materialization_support import build_country_entry_from_mutation
from map_builder.scenario_family_palette import family_palette, hex_to_oklab
from tools.apply_tno_split_overlay import run_scenario
from tools.build_tno_split_overlay import D
from tools import materialize_polar_scenarios
from tools import build_tno_split_overlay as builder


@pytest.fixture
def scenario_dir():
    parent = Path(__file__).resolve().parents[1] / ".runtime/tmp" / f"tno-overlay-{uuid4().hex}"
    path = parent / "tno_1962"
    path.mkdir(parents=True)
    yield path
    shutil.rmtree(parent)


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_two_objects_sources_and_idempotence(scenario_dir, monkeypatch):
    def geometry(fid):
        return {"properties": {"id": fid, "cntr_code": "JP"}}

    payloads = {
        "runtime_topology.topo.json": {"objects": {
            "political": {"geometries": [geometry("p"), geometry("home"), geometry("unowned")]},
            "scenario_atlantropa": {"geometries": [geometry("a"), geometry("sea")]}}},
        "countries.json": {"countries": {"JAP": {"tag": "JAP", "color_hex": "#abcdef",
                                                  "feature_count": 3, "controller_feature_count": 3}}},
        "owners.by_feature.json": {"owners": dict(p="JAP", a="JAP", home="JAP")},
        "cores.by_feature.json": {"cores": {fid: ["JAP"] for fid in ("p", "a", "home")}},
        "manifest.json": {"default_country": "JAP", "summary": {}},
        "scenario_manual_overrides.json": {"countries": {}, "assignments": {}},
        "scenario_mutations.json": {"countries": {}, "assignments_by_feature_id": {}},
    }
    for name, payload in payloads.items():
        (scenario_dir / name).write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(materialize_polar_scenarios, "apply_safe_scenario_contract_repairs", lambda *a, **k: [])
    monkeypatch.setattr(materialize_polar_scenarios, "synchronize_scenario_snapshot", lambda *a: None)
    monkeypatch.setattr(materialize_polar_scenarios, "_refresh_summary_metadata", lambda *a: None)
    rebuilt = []
    options = dict(rebuild=lambda path: rebuilt.append(path), synchronize=lambda path: None,
                   load_plans=lambda path: [], load_hierarchy=lambda path: ({}, {}))
    overlay = {"version": 1, "entries": [{
        "id": "test", "scenarios": ["tno_1962"], "tag": "JTWN", "name_en": "Taiwan",
        "name_zh": "台湾", "parent_owner_tag": "JAP", "subject_kind": "colony",
        "color_hex": "#bbccdd", "select": {"feature_ids": ["p", "a"]},
        "only_from_owners": ["JAP"], "cores": "keep"}]}
    assert run_scenario(overlay, scenario_dir, **options)["changed_count"] == 2
    assert read(scenario_dir / "owners.by_feature.json")["owners"] == dict(p="JTWN", a="JTWN", home="JAP")
    assert read(scenario_dir / "cores.by_feature.json")["cores"] == payloads["cores.by_feature.json"]["cores"]
    for name in ("countries.json", "scenario_manual_overrides.json", "scenario_mutations.json"):
        country = read(scenario_dir / name)["countries"]["JTWN"]
        assert country["parent_owner_tag"] == "JAP"
        assert country["subject_kind"] == "colony"
        assert country["color_hex"] == "#bbccdd"
        assert country["display_name_zh"] == "台湾"
    for name, key in (("scenario_manual_overrides.json", "assignments"),
                      ("scenario_mutations.json", "assignments_by_feature_id")):
        assert read(scenario_dir / name)[key] == {
            fid: dict(owner="JTWN", controller="JTWN", cores=["JAP"]) for fid in ("p", "a")}
    before = {p.name: p.read_bytes() for p in scenario_dir.glob("*.json")}
    assert run_scenario(overlay, scenario_dir, **options)["changed_count"] == 0
    assert before == {p.name: p.read_bytes() for p in scenario_dir.glob("*.json")}
    assert rebuilt == [scenario_dir]


def test_district_expansion_intersects_current_owner():
    districts = {"tags": {"JAP": {"districts": {"taiwan": {"feature_ids": ["b", "a", "foreign", "absent"]}}}}}
    assert D("JAP", "taiwan", districts, {"a": "JAP", "b": "JAP", "foreign": "CHI"}) == ["a", "b"]


def test_generator_preserves_applied_entries_and_appends_new(scenario_dir, monkeypatch):
    overlay_path = scenario_dir / "overlay.json"
    colors = family_palette("#3c3c3c", 2)
    existing = {"version": 1, "entries": [
        {"id": f"tno_{tag.lower()}", "tag": tag, "parent_owner_tag": "GER",
         "select": {"feature_ids": [fid]}, "color_hex": color, "name_zh": "旧政体"}
        for tag, fid, color in zip(("OLDB", "OLDA"), ("b", "a"), colors)
    ]}
    original_bytes = json.dumps(existing, ensure_ascii=False, indent=4).encode("utf-8")
    overlay_path.write_bytes(original_bytes)
    payloads = {
        "district_groups.manual.json": {"tags": {"GER": {"districts": {
            "new": {"feature_ids": ["c", "foreign"]}}}}},
        "owners.by_feature.json": {"owners": dict(a="OLDA", b="OLDB", c="GER", foreign="CHI")},
        "countries.json": {"countries": {"GER": {"color_hex": "#3c3c3c"}}},
    }
    for name, payload in payloads.items():
        (scenario_dir / name).write_text(json.dumps(payload), encoding="utf-8")
    pilots = tuple((tag, "Old", "旧政体", "GER", "colony", "removed") for tag in ("OLDA", "OLDB"))
    monkeypatch.setattr(builder, "SCENARIO_DIR", scenario_dir)
    monkeypatch.setattr(builder, "OVERLAY_PATH", overlay_path)
    monkeypatch.setattr(builder, "PILOTS", pilots)
    builder.main()
    assert overlay_path.read_bytes() == original_bytes

    monkeypatch.setattr(builder, "PILOTS", pilots + (("NEWC", "New", "新政体", "GER", "colony", "new"),))
    builder.main()
    result = read(overlay_path)
    assert result["entries"][:2] == existing["entries"]
    assert len(result["entries"]) == 3
    new = result["entries"][-1]
    assert new["id"] == "tno_newc"
    assert new["select"] == {"feature_ids": ["c"]}
    assert all(math.dist(hex_to_oklab(new["color_hex"]), hex_to_oklab(color)) > 0.015 for color in colors)
    appended_bytes = overlay_path.read_bytes()
    builder.main()
    assert overlay_path.read_bytes() == appended_bytes


def test_generator_rejects_empty_new_entry(monkeypatch):
    monkeypatch.setattr(builder, "PILOTS", (("JTWN", "Taiwan", "台湾", "JAP", "colony", "taiwan"),))
    districts = {"tags": {"JAP": {"districts": {"taiwan": {"feature_ids": ["foreign"]}}}}}
    with pytest.raises(ValueError, match="tno_jtwn"):
        builder.build_overlay(districts, {"foreign": "CHI"}, {"JAP": {"color_hex": "#82132e"}},
                              {"version": 1, "entries": []})


@pytest.mark.parametrize("kind", ["colony", "colonial_government"])
def test_subject_kind_survives_materialization(kind):
    mutation = dict(mode="create", display_name_en="Taiwan", display_name_zh="台湾",
                    color_hex="#bbccdd", parent_owner_tag="JAP", subject_kind=kind)
    entry = build_country_entry_from_mutation({"scenarioId": "tno_1962"}, "JTWN", mutation, existing_entry=None)
    assert entry["parent_owner_tag"] == "JAP"
    assert entry["parent_owner_tags"] == ["JAP"]
    assert entry["subject_kind"] == kind
    existing = deepcopy(entry)
    existing["subject_kind"] = "releasable_state"
    assert build_country_entry_from_mutation(
        {"scenarioId": "tno_1962"}, "JTWN", mutation, existing_entry=existing)["subject_kind"] == kind
