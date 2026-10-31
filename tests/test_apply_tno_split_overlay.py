from copy import deepcopy
import json
import math
from pathlib import Path
import shutil
from uuid import uuid4

import pytest

from map_builder.scenario_political_materialization_support import build_country_entry_from_mutation
from map_builder.scenario_family_palette import family_palette, hex_to_oklab
from tools.apply_tno_split_overlay import run_scenario, update_country_geography
from tools.apply_hoi4_split_overlay import apply_overlay
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


@pytest.mark.parametrize("has_child", [True, False])
def test_zero_land_parent_is_retained_but_core_only_tag_is_rejected(has_child):
    overlay = {"version": 1, "entries": [{"id": "capital_district", "scenarios": ["tno_1962"],
        "tag": "NEW", "select": {"feature_ids": ["capital"]}, "cores": "keep"}]}
    countries = {"ROOT": {"tag": "ROOT"}, "NEW": {"tag": "NEW"}}
    if has_child:
        countries["NEW"]["parent_owner_tag"] = "ROOT"
    kwargs = dict(features={"capital": {"cntr_code": "RU"}}, owners={"capital": "ROOT"},
        cores={"capital": ["ROOT"]}, countries=countries, default_country="NEW",
        hierarchy_groups={}, country_meta={}, prefectures={}, bucket_by_feature={}, plans=[])
    if not has_child:
        with pytest.raises(ValueError, match="protected.*ROOT"):
            apply_overlay(overlay, "tno_1962", **kwargs)
        return
    result, assignments, report = apply_overlay(overlay, "tno_1962", **kwargs)
    assert result["ROOT"]["entry_kind"] == "scenario_container"
    assert assignments["capital"]["owner"] == "NEW"
    assert assignments["capital"]["cores"] == ["ROOT"]
    assert report["retired_tags"] == []
    kwargs.update(countries=result, owners={"capital": "NEW"})
    assert apply_overlay(overlay, "tno_1962", **kwargs)[2]["changed_count"] == 0


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


def test_generator_preserves_applied_entries_and_appends_new(scenario_dir, monkeypatch):
    source_path = scenario_dir / "releasables.json"
    source_path.write_text(json.dumps({"entries": []}), encoding="utf-8")
    monkeypatch.setattr(builder, "RELEASABLE_PATH", source_path)
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
    monkeypatch.setattr(builder, "DISTRICTS", ())
    monkeypatch.setattr(builder, "EXPLICIT", ())
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


@pytest.mark.parametrize("kind", ["colony", "colonial_government", "protectorate"])
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


def test_batch_two_published_ownership_and_relationships():
    directory = builder.SCENARIO_DIR
    overlay = read(builder.OVERLAY_PATH)
    owners = read(directory / "owners.by_feature.json")["owners"]
    cores = read(directory / "cores.by_feature.json")["cores"]
    countries = read(directory / "countries.json")["countries"]
    user_rules = read(Path(__file__).parent / "fixtures/tno_user_reassign.json")
    corrected = {fid: {"RKO": "OE00"}.get(row["to"], row["to"]) for fid, row in user_rules.items() if row["from"] != row["to"]}
    for entry in overlay["entries"][3:]:
        tag = entry["tag"]
        country = countries[tag]
        if "parent_owner_tag" in entry:
            assert country["parent_owner_tag"] == entry["parent_owner_tag"]
            assert country["subject_kind"] == entry["subject_kind"]
        for fid in entry["select"]["feature_ids"]:
            assert owners[fid] == corrected.get(fid, tag)
            if entry["cores"] == "owner":
                assert cores[fid] == [tag]
    assert owners["MYS-1139"] == "MLY"
    assert owners["MYS-4833"] == "MAL"
    assert owners["BN_ADM1_BRN-1184"] == "MAL"
    assert owners["MR_ADM1_MRT-2796"] == "AZW"
    assert owners["PL_POW_1463"] == "RKP"
    assert countries["GUI"]["display_name_en"] == "Guinea"
    assert countries["GUZ"]["display_name"] == "Guizhou Clique"
    assert all(owner in countries for owner in owners.values())
    assert all(core in countries for values in cores.values() for core in values)


def test_gui_legacy_migration_preserves_new_guinea():
    import subprocess

    script = r"""
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrateTnoProjectTags, TNO_TAG_MIGRATION_VERSION,
  normalizeCountryCodeAlias } from './js/core/country_code_aliases.js';
const countries = JSON.parse(readFileSync('./data/scenarios/tno_1962/countries.json', 'utf8')).countries;
assert.equal(TNO_TAG_MIGRATION_VERSION, 1);
const legacy = migrateTnoProjectTags({scenario: {id: 'tno_1962'},
  activeSovereignCode: 'GUI', countryBaseColors: {GUI: '#123456'}});
assert.equal(legacy.activeSovereignCode, 'GUZ');
assert.deepEqual(legacy.countryBaseColors, {GUZ: '#123456'});
const current = {scenario: {id: 'tno_1962', tagMigrationVersion: 1},
  activeSovereignCode: 'GUI', countryBaseColors: {GUI: '#abcdef', GUZ: '#123456'}};
assert.equal(migrateTnoProjectTags(current), current);
assert.equal(normalizeCountryCodeAlias('GUI'), 'GUI');
assert.equal(countries.GUI.display_name_en, 'Guinea');
assert.equal(countries.GUZ.display_name, 'Guizhou Clique');
"""
    subprocess.run(["node", "--input-type=module", "-e", script], cwd=builder.ROOT, check=True)


def test_jhaw_sidebar_uses_owned_hawaii_hierarchy():
    import subprocess

    script = r"""
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCountryInspectorModel } from './js/ui/sidebar/country_inspector_model.js';
import { getEffectiveScenarioHierarchy, clipHierarchyGroupsToOwner } from './js/core/scenario_hierarchy.js';
import { getMapDataBoundary } from './js/core/map_data_boundary.js';
import { normalizeCountryCodeAlias } from './js/core/country_code_aliases.js';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const hierarchy = read('./data/hierarchy.json');
const countries = read('./data/scenarios/tno_1962/countries.json').countries;
const owners = read('./data/scenarios/tno_1962/owners.by_feature.json').owners;
const runtime = {
  activeScenarioId: 'tno_1962', mapSemanticMode: 'political',
  scenarioCountriesByTag: countries, scenarioBaselineOwnersByFeatureId: owners,
  hierarchyData: hierarchy, hierarchyGroupsByCode: new Map(),
  activeScenarioManifest: read('./data/scenarios/tno_1962/manifest.json'),
  countryGroupMetaByCode: new Map(Object.entries(hierarchy.country_groups.country_meta)),
};
const model = createCountryInspectorModel(runtime, value => value);
assert.equal(model.resolveInspectorDataCode('JHAW'), 'US');
assert.deepEqual(model.getCountryGroupingMeta('JHAW'), hierarchy.country_groups.country_meta.US);
const source = readFileSync('./js/ui/sidebar.js', 'utf8');
const declarations = ['getHierarchyGroupsForCode', 'getOwnedHierarchyGroups'].map(name => {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}).join('\n');
const getOwnedHierarchyGroups = new Function('runtimeState', 'getEffectiveScenarioHierarchy',
  'normalizeCountryCode', 'hierarchyGroupsCache', 'getMapDataBoundary', 'clipHierarchyGroupsToOwner',
  declarations + '\nreturn getOwnedHierarchyGroups;')(
    runtime, getEffectiveScenarioHierarchy, normalizeCountryCodeAlias, new WeakMap(),
    getMapDataBoundary, clipHierarchyGroupsToOwner);
const groups = getOwnedHierarchyGroups(model.resolveInspectorDataCode('JHAW'), 'JHAW');
const hawaii = groups.find(group => group.id === 'US_Hawaii');
assert.ok(hawaii);
assert.deepEqual([...hawaii.children].sort(), Object.keys(owners).filter(id => owners[id] === 'JHAW').sort());
assert.equal(hawaii.children.length, 5);
console.log('JHAW -> US -> US_Hawaii: 5 owned parcels');
"""
    subprocess.run(["node", "--input-type=module", "-e", script], cwd=builder.ROOT, check=True)


def test_explicit_pilot_selection_intersects_current_owner(monkeypatch):
    monkeypatch.setattr(builder, "PILOTS", (
        ("CGUB", "Ubangi", "乌班吉", "GCO", "colonial_government", ("a", "foreign")),))
    monkeypatch.setattr(builder, "DISTRICTS", ())
    monkeypatch.setattr(builder, "EXPLICIT", ())
    result = builder.build_overlay({}, {"a": "GCO", "foreign": "CAO"},
                                   {"GCO": {"color_hex": "#6a725b"}},
                                   {"version": 1, "entries": []})
    assert result["entries"][0]["select"] == {"feature_ids": ["a"]}
    assert result["entries"][0]["cores"] == "keep"


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
