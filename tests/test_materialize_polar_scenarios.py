from __future__ import annotations

import json
import gzip
import hashlib

import pytest

from tools import materialize_polar_scenarios as subject


@pytest.fixture(autouse=True)
def stub_snapshot_services(monkeypatch):
    monkeypatch.setattr(subject, '_build_snapshot_for_scenario',
                        lambda *args, **kwargs: {'snapshot_fingerprint': 'test-snapshot'})
    monkeypatch.setattr(subject, '_refresh_audit_payload', lambda *args, **kwargs: None)


def _write(path, payload):
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_gzip_is_synchronized_before_snapshot(tmp_path, monkeypatch):
    _write(tmp_path / 'manifest.json', {})
    path = tmp_path / 'startup.bundle.en.json'
    path.write_bytes(b'{"value": 1}\n')
    mirror = tmp_path / 'startup.bundle.en.json.gz'
    mirror.write_bytes(gzip.compress(b'{"value":1}', mtime=0))
    def snapshot(*args, **kwargs):
        assert gzip.decompress(mirror.read_bytes()) == path.read_bytes()
        return {'snapshot_fingerprint': hashlib.sha256(mirror.read_bytes()).hexdigest()}
    monkeypatch.setattr(subject, '_build_snapshot_for_scenario', snapshot)
    subject.synchronize_scenario_snapshot(tmp_path)
    assert subject.load_json(tmp_path / 'manifest.json')['snapshot_fingerprint'] == hashlib.sha256(mirror.read_bytes()).hexdigest()


def _scenario(tmp_path, scenario_id, *, ids, owners, extra_ids=()):
    directory = tmp_path / scenario_id
    directory.mkdir()
    objects = {"political": {"geometries": [{"properties": {"id": fid}} for fid in ids]}}
    if scenario_id == "tno_1962":
        objects["scenario_atlantropa"] = {
            "geometries": [{"properties": {"id": fid}} for fid in extra_ids]
        }
    _write(directory / "runtime_topology.topo.json", {"objects": objects})
    _write(directory / "owners.by_feature.json", {"owners": owners.copy()})
    _write(directory / "cores.by_feature.json", {"cores": {fid: [owner] for fid, owner in owners.items()}})
    _write(directory / "countries.json", {"countries": {
        "RUS": {"feature_count": 0, "controller_feature_count": 0},
        "NOR": {"feature_count": 0, "controller_feature_count": 0},
    }})
    _write(directory / "manifest.json", {"scenario_id": scenario_id, "summary": {"feature_count": 0}})
    if scenario_id == "tno_1962":
        _write(directory / "scenario_manual_overrides.json", {"assignments": {}})
        _write(directory / "scenario_mutations.json", {"assignments_by_feature_id": {}})
    return directory


def test_refresh_updates_assignments_counts_and_tno_authoring_inputs(tmp_path, monkeypatch):
    directory = _scenario(tmp_path, "tno_1962", ids=["child"],
                          owners={"old": "RUS", "atl": "NOR"}, extra_ids=["atl"])
    called = []
    monkeypatch.setattr(subject, "apply_safe_scenario_contract_repairs",
                        lambda path, *, rebuild_chunk_assets: called.append((path, rebuild_chunk_assets)) or ["rebuilt"])

    result = subject.refresh_scenario(directory, {"child": {
        "parent_id": "old", "owner": "RUS", "controller": "RUS", "cores": ["RUS"]
    }}, removed_ids=["old"])

    assert result == ["rebuilt"]
    assert called == [(directory, True)]
    assert subject.load_json(directory / "owners.by_feature.json")["owners"] == {"atl": "NOR", "child": "RUS"}
    assert subject.load_json(directory / "manifest.json")["summary"]["feature_count"] == 2
    assert subject.load_json(directory / "countries.json")["countries"]["RUS"]["feature_count"] == 1
    row = {"owner": "RUS", "controller": "RUS", "cores": ["RUS"]}
    assert subject.load_json(directory / "scenario_manual_overrides.json")["assignments"]["child"] == row
    assert subject.load_json(directory / "scenario_mutations.json")["assignments_by_feature_id"]["child"] == row


def test_blank_base_refresh_keeps_empty_assignments_and_counts_runtime(tmp_path, monkeypatch):
    directory = _scenario(tmp_path, "blank_base", ids=["a", "b"], owners={})
    calls = []
    monkeypatch.setattr(subject, "apply_safe_scenario_contract_repairs",
                        lambda *args, **kwargs: calls.append(kwargs) or [])
    subject.refresh_scenario(directory, {}, rebuild_chunk_assets=False)
    assert calls == [{"rebuild_chunk_assets": False}]
    manifest = subject.load_json(directory / "manifest.json")
    assert manifest["summary"]["feature_count"] == 2
    assert manifest["summary"]["quality_counts"] == {"ownerless_editable_topology": 2}
    assert subject.load_json(directory / "owners.by_feature.json")["owners"] == {}
    with pytest.raises(ValueError, match="ownerless"):
        subject.refresh_scenario(directory, {"c": {}})


def test_refresh_copies_parent_strategic_bucket(tmp_path, monkeypatch):
    directory = _scenario(tmp_path, "hoi4_1936", ids=["child"], owners={"old": "NOR"})
    _write(directory / "strategic_values.by_feature.json", {
        "baseline_hash": "old", "bucket_by_feature": {"old": "s1"}, "buckets": {"s1": {}}
    })
    monkeypatch.setattr(subject, "apply_safe_scenario_contract_repairs",
                        lambda *args, **kwargs: [])
    subject.refresh_scenario(directory, {"child": {
        "parent_id": "old", "owner": "NOR", "controller": "NOR", "cores": ["NOR"]
    }}, removed_ids=["old"])
    strategic = subject.load_json(directory / "strategic_values.by_feature.json")
    manifest = subject.load_json(directory / "manifest.json")
    assert strategic["bucket_by_feature"] == {"child": "s1"}
    assert strategic["baseline_hash"] == manifest["baseline_hash"]


def test_new_island_uses_existing_country_pool(tmp_path, monkeypatch):
    directory = _scenario(tmp_path, "hoi4_1936", ids=["old", "NO_NEW"], owners={"old": "NOR"})
    _write(directory / "strategic_values.by_feature.json", {
        "baseline_hash": "old", "metrics": {"manpower": {}},
        "bucket_by_feature": {"old": "s1"},
        "buckets": {"s1": {}, "pool:NOR": {"owner_tag": "NOR", "manpower": 123.0}},
    })
    monkeypatch.setattr(subject, "apply_safe_scenario_contract_repairs",
                        lambda *args, **kwargs: [])
    subject.refresh_scenario(directory, {"NO_NEW": {
        "owner": "NOR", "controller": "NOR", "cores": ["NOR"]
    }})
    strategic = subject.load_json(directory / "strategic_values.by_feature.json")
    assert strategic["bucket_by_feature"]["NO_NEW"] == "pool:NOR"
    assert strategic["buckets"]["pool:NOR"]["manpower"] == 123.0


def test_hoi_summary_refresh_uses_audit_rows_once(tmp_path):
    directory = tmp_path / "hoi4_1936"
    directory.mkdir()
    _write(directory / "audit.json", {
        "feature_changes": [{"feature_id": "old", "to_tag": "SOV",
                             "quality": "manual_reviewed", "source": "manual_rule"}],
        "owner_stats": {
            "SOV": {"feature_count": 2, "quality_breakdown": {"manual_reviewed": 2}},
            "NOR": {"feature_count": 1, "quality_breakdown": {"direct_country_copy": 1}},
        }, "diagnostics": {},
    })
    manifest = {"summary": {
        "feature_count": 2, "quality_counts": {"manual_reviewed": 2, "direct_country_copy": 1},
        "source_counts": {"manual_rule": 2, "direct_active_owner": 1},
        "manual_reviewed_feature_count": 2, "changed_feature_count": 1,
    }}
    countries = {"SOV": {"feature_count": 1}, "NOR": {"feature_count": 1}}
    assignments = {"NO_PRIMARY_GAP_15": {"owner": "NOR"}}
    for _ in range(2):
        subject._refresh_summary_metadata(directory, manifest, countries, assignments, {"old"})
    summary = manifest["summary"]
    assert summary["quality_counts"] == {"manual_reviewed": 1, "direct_country_copy": 2}
    assert summary["source_counts"] == {"manual_rule": 1, "direct_active_owner": 2}
    assert summary["changed_feature_count"] == 0
    audit = subject.load_json(directory / "audit.json")
    assert audit["feature_changes"] == []
    assert audit["owner_stats"]["SOV"]["quality_breakdown"] == {"manual_reviewed": 1}


def test_tno_summary_refresh_uses_country_classification_once(tmp_path):
    directory = tmp_path / "tno_1962"
    directory.mkdir()
    _write(directory / "audit.json", {"diagnostics": {}, "owner_stats": {}})
    manifest = {"summary": {
        "quality_counts": {"manual_reviewed": 10},
        "source_counts": {"tno_reichskommissariat_baseline": 10},
        "manual_reviewed_feature_count": 10, "approximate_count": 0,
    }}
    countries = {"RKNO": {"quality": "manual_reviewed",
                          "source": "tno_reichskommissariat_baseline"}}
    assignments = {"NO_PRIMARY_GAP_15": {"owner": "RKNO"}}
    for _ in range(2):
        subject._refresh_summary_metadata(directory, manifest, countries, assignments, set())
    assert manifest["summary"]["quality_counts"]["manual_reviewed"] == 11
    assert manifest["summary"]["source_counts"]["tno_reichskommissariat_baseline"] == 11


def test_modern_summary_refresh_uses_its_single_classification(tmp_path):
    directory = tmp_path / "modern_world"
    directory.mkdir()
    manifest = {"summary": {"feature_count": 2,
                            "quality_counts": {"direct_country_copy": 3},
                            "source_counts": {"canonical_baseline": 3}}}
    subject._refresh_summary_metadata(directory, manifest, {}, {}, set())
    assert manifest["summary"]["quality_counts"] == {"direct_country_copy": 2}
    assert manifest["summary"]["source_counts"] == {"canonical_baseline": 2}
