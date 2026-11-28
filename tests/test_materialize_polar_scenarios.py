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


def _scenario(tmp_path, scenario_id, *, ids, owners):
    directory = tmp_path / scenario_id
    directory.mkdir()
    objects = {"political": {"geometries": [{"properties": {"id": fid}} for fid in ids]}}
    _write(directory / "runtime_topology.topo.json", {"objects": objects})
    _write(directory / "owners.by_feature.json", {"owners": owners.copy()})
    _write(directory / "cores.by_feature.json", {"cores": {fid: [owner] for fid, owner in owners.items()}})
    _write(directory / "countries.json", {"countries": {
        "RUS": {"feature_count": 0, "controller_feature_count": 0},
        "NOR": {"feature_count": 0, "controller_feature_count": 0},
    }})
    _write(directory / "manifest.json", {"scenario_id": scenario_id, "summary": {"feature_count": 0}})
    return directory


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
