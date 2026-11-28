from copy import deepcopy
import json
from pathlib import Path
import shutil
from uuid import uuid4

import pytest

from tools.apply_tno_split_overlay import run_scenario, update_country_geography
from tools.apply_hoi4_split_overlay import apply_overlay
from tools import materialize_polar_scenarios


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
    (scenario_dir / "europe_topology.runtime_political_v1.json").write_text(
        json.dumps({"objects": {"political": {"geometries": []}}}), encoding="utf-8")
    monkeypatch.setattr(materialize_polar_scenarios, "apply_safe_scenario_contract_repairs", lambda *a, **k: [])
    monkeypatch.setattr(materialize_polar_scenarios, "synchronize_scenario_snapshot", lambda *a: None)
    monkeypatch.setattr(materialize_polar_scenarios, "_refresh_summary_metadata", lambda *a: None)
    rebuilt = []
    options = dict(data_dir=scenario_dir, rebuild=lambda path: rebuilt.append(path), synchronize=lambda path: None,
                   load_plans=lambda path: [], load_hierarchy=lambda path: ({}, {}))
    overlay = {"version": 1, "entries": [{
        "id": "withdrawn", "scenarios": ["tno_1962"], "tag": "OLD",
        "name_en": "Old", "name_zh": "旧政体", "parent_owner_tag": "JAP",
        "color_hex": "#aabbcc", "select": {"feature_ids": ["home"]}, "cores": "keep",
    }, {
        "id": "test", "scenarios": ["tno_1962"], "tag": "JTWN", "name_en": "Taiwan",
        "name_zh": "台湾", "parent_owner_tag": "JAP", "subject_kind": "colony",
        "color_hex": "#bbccdd", "select": {"feature_ids": ["p", "a"]},
        "only_from_owners": ["JAP"], "cores": "keep", "supersedes": ["withdrawn"]}]}
    assert run_scenario(overlay, scenario_dir, **options)["changed_count"] == 2
    assert read(scenario_dir / "owners.by_feature.json")["owners"] == dict(p="JTWN", a="JTWN", home="JAP")
    assert read(scenario_dir / "cores.by_feature.json")["cores"] == payloads["cores.by_feature.json"]["cores"]
    assert "OLD" not in read(scenario_dir / "countries.json")["countries"]
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


def test_geographic_majority_uses_base_parcels_and_preserves_parent():
    countries = {"TEST": {"parent_owner_tag": "JAP", "lookup_iso2": "JAP"}}
    owners = dict(a="TEST", b="TEST", c="TEST", foreign="JAP")
    features = {fid: {"cntr_code": code} for fid, code in
                [("a", "JAP"), ("b", "JAP"), ("c", "CA"), ("foreign", "CA")]}
    base = {fid: {"cntr_code": "US"} for fid in ("a", "b")}
    meta = {"US": dict(continent_id="north_america", continent_label="North America",
                       subregion_id="northern_america", subregion_label="Northern America")}
    update_country_geography(countries, owners, features, base, meta, {"TEST"})
    country = countries["TEST"]
    assert [country[key] for key in ("lookup_iso2", "base_iso2", "provenance_iso2")] == ["US"] * 3
    assert country["parent_owner_tag"] == "JAP"
    assert all(country[key] == value for key, value in meta["US"].items())
    before = deepcopy(countries)
    update_country_geography(countries, owners, features, base, meta, {"TEST"})
    assert countries == before


def test_reclamation_preserves_other_cores_and_is_repeatable():
    from tools.apply_tno_split_overlay import expand_reclamation_entries

    overlay = {"version": 1, "entries": [{"id": "reclaim", "scenarios": ["tno_1962"],
        "tag": "RKU", "cores": "parent_if_single_child", "only_from_owners": ["UK01"],
        "select": {"feature_ids": ["single", "parent", "multiple"]}}]}
    owners = dict.fromkeys(("single", "parent", "multiple"), "UK01")
    cores = {"single": ["UK01"], "parent": ["RKU"], "multiple": ["RKU", "SOV"]}
    countries = {tag: {"tag": tag} for tag in ("RKU", "UK01", "SOV")}
    kwargs = dict(features={fid: {"cntr_code": "UA"} for fid in owners},
                  owners=owners, cores=cores, countries=countries, default_country="RKU",
                  hierarchy_groups={}, country_meta={}, prefectures={}, bucket_by_feature={}, plans=[])
    result, assignments, report = apply_overlay(expand_reclamation_entries(overlay, cores), "tno_1962", **kwargs)
    assert report["retired_tags"] == ["UK01"]
    assert report["changed_count"] == 3
    assert all(row["owner"] == "RKU" for row in assignments.values())
    assert assignments["single"]["cores"] == ["RKU"]
    assert assignments["multiple"]["cores"] == cores["multiple"]
    assert assignments["parent"]["cores"] == cores["parent"]
    kwargs.update(countries=result, owners={fid: row["owner"] for fid, row in assignments.items()},
                  cores={fid: row["cores"] for fid, row in assignments.items()})
    assert apply_overlay(expand_reclamation_entries(overlay, kwargs["cores"]), "tno_1962", **kwargs)[2]["changed_count"] == 0


def test_identity_v2_preserves_current_tags_and_geographic_codes(scenario_dir):
    from tools.apply_tno_1962_identity_migrations import apply_identity_migrations

    payloads = {
        "manifest.json": {"tag_migration_version": 1},
        "countries.json": {"countries": {
            "BZ": {"tag": "BZ", "base_iso2": "BZ", "primary_rule_source": "tno_1962_decolonization_bz"},
            "GY": {"tag": "GY", "lookup_iso2": "GY", "rule_sources": ["tno_1962_decolonization_gy"]},
            **{tag: {"tag": tag} for tag in ("MAG", "MGN", "GUI", "GUZ", "PRC", "ANG")},
        }},
        "owners.by_feature.json": {"owners": {"belize": "BZ", "guyana": "GY", "magadan": "MAG"}},
        "runtime_topology.topo.json": {"properties": {"cntr_code": "BZ", "owner_tag": "BZ"}},
    }
    for name, payload in payloads.items():
        (scenario_dir / name).write_text(json.dumps(payload), encoding="utf-8")
    assert apply_identity_migrations(scenario_dir, releasable_paths=[])
    countries = read(scenario_dir / "countries.json")["countries"]
    assert set(countries) == {"BLZ", "GUY", "MAG", "MGN", "GUI", "GUZ", "PRC", "ANG"}
    assert countries["BLZ"]["base_iso2"] == "BZ"
    assert countries["GUY"]["lookup_iso2"] == "GY"
    assert countries["BLZ"]["primary_rule_source"] == "tno_1962_decolonization_blz"
    assert countries["GUY"]["rule_sources"] == ["tno_1962_decolonization_guy"]
    assert read(scenario_dir / "owners.by_feature.json")["owners"] == {
        "belize": "BLZ", "guyana": "GUY", "magadan": "MAG"}
    assert read(scenario_dir / "runtime_topology.topo.json")["properties"] == {
        "cntr_code": "BZ", "owner_tag": "BLZ"}
    assert apply_identity_migrations(scenario_dir, releasable_paths=[]) == []
