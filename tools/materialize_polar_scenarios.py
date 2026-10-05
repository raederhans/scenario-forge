"""Refresh scenario assignment inputs after polar political geometry is repaired.

The caller owns the runtime topology edit. This module updates its assignment
sidecars and then delegates all derived assets to the scenario contract builder.
"""

from __future__ import annotations

from collections import Counter
import gzip
from pathlib import Path
from typing import Mapping

from map_builder.json_source import read_json_source
from map_builder.contracts import sha256_json_stable
from tools.check_scenario_contracts import (
    apply_safe_scenario_contract_repairs,
    _build_snapshot_for_scenario,
    _refresh_audit_payload,
    load_json,
    write_json,
)


def refresh_scenario(
    scenario_dir: Path,
    assignments: Mapping[str, Mapping[str, object]],
    removed_ids: tuple[str, ...] | list[str] = (),
    *,
    rebuild_chunk_assets: bool = True,
) -> list[str]:
    """Refresh a scenario after its political runtime topology has been saved.

    ``assignments`` maps new feature IDs to parent_id, owner, controller, cores.
    Empty assignments are required for the ownerless ``blank_base`` scenario.
    Returns the safe repair steps performed by the existing contract builder.
    """
    scenario_dir = Path(scenario_dir)
    scenario_id = scenario_dir.name
    blank = scenario_id == "blank_base"
    if blank and assignments:
        raise ValueError("blank_base must remain ownerless")

    topology = read_json_source(scenario_dir / "runtime_topology.topo.json")
    geometries = topology["objects"]["political"]["geometries"]
    feature_ids = [row["properties"]["id"] for row in geometries]
    if len(feature_ids) != len(set(feature_ids)):
        raise ValueError("runtime political feature IDs must be unique")
    runtime_ids = set(feature_ids)
    if scenario_id == "tno_1962":
        runtime_ids.update(
            row["properties"]["id"]
            for row in topology["objects"]["scenario_atlantropa"]["geometries"]
        )
    removed = set(removed_ids)
    if removed & runtime_ids:
        raise ValueError(f"removed IDs remain in runtime topology: {sorted(removed & runtime_ids)[:5]}")
    if not set(assignments) <= runtime_ids:
        raise ValueError(f"assigned IDs missing from runtime topology: {sorted(set(assignments) - runtime_ids)[:5]}")

    owners_path = scenario_dir / "owners.by_feature.json"
    cores_path = scenario_dir / "cores.by_feature.json"
    countries_path = scenario_dir / "countries.json"
    manifest_path = scenario_dir / "manifest.json"
    owners_payload = load_json(owners_path)
    cores_payload = load_json(cores_path)
    countries_payload = load_json(countries_path)
    manifest = load_json(manifest_path)
    owners = owners_payload["owners"]
    cores = cores_payload["cores"]
    countries = countries_payload["countries"]
    controllers_path = scenario_dir / "controllers.by_feature.json"
    controllers_payload = load_json(controllers_path) if controllers_path.exists() else None
    controllers = controllers_payload["controllers"] if controllers_payload is not None else None

    for feature_id, assignment in assignments.items():
        if blank:
            break
        parent_id = str(assignment.get("parent_id") or "")
        if parent_id and parent_id not in owners and parent_id not in removed:
            raise ValueError(f"unknown assignment parent: {parent_id}")
        owner = str(assignment["owner"])
        controller = str(assignment["controller"])
        core_tags = assignment["cores"]
        if owner not in countries or controller not in countries:
            raise ValueError(f"undeclared country for {feature_id}: {owner}/{controller}")
        if not isinstance(core_tags, list) or any(tag not in countries for tag in core_tags):
            raise ValueError(f"invalid cores for {feature_id}")

    for feature_id in removed:
        owners.pop(feature_id, None)
        cores.pop(feature_id, None)
        if controllers is not None:
            controllers.pop(feature_id, None)
    for feature_id, assignment in assignments.items():
        if blank:
            continue
        owners[feature_id] = str(assignment["owner"])
        cores[feature_id] = list(assignment["cores"])
        if controllers is not None:
            controllers[feature_id] = str(assignment["controller"])

    if blank:
        if owners or cores or controllers:
            raise ValueError("blank_base assignment sidecars must be empty")
        baseline_hash = sha256_json_stable({"scenario_id": scenario_id, "feature_ids": sorted(runtime_ids)})
        feature_count = len(runtime_ids)
    else:
        if set(owners) != set(cores) or not set(owners) <= runtime_ids:
            raise ValueError("assignment sidecars contain stale or mismatched feature IDs")
        if scenario_id != "tno_1962" and set(owners) != runtime_ids:
            raise ValueError("assignment sidecars must cover all runtime political features")
        baseline_hash = sha256_json_stable(owners)
        feature_count = len(owners)

    if "baseline_hash" in owners_payload:
        owners_payload["baseline_hash"] = baseline_hash
    if "baseline_hash" in cores_payload:
        cores_payload["baseline_hash"] = baseline_hash
    if controllers_payload is not None and "baseline_hash" in controllers_payload:
        controllers_payload["baseline_hash"] = sha256_json_stable(controllers)
    manifest["baseline_hash"] = baseline_hash
    summary = manifest["summary"]
    summary["feature_count"] = feature_count
    if blank:
        summary["changed_feature_count"] = feature_count
        summary["quality_counts"] = {"ownerless_editable_topology": feature_count}
        summary["source_counts"] = {"ownerless_editable_topology": feature_count}
    else:
        counts = Counter(owners.values())
        controller_counts = Counter(controllers.values()) if controllers is not None else counts
        for tag, country in countries.items():
            country["feature_count"] = counts.get(tag, 0)
            if "controller_feature_count" in country:
                # Bundles without a controller sidecar publish owner-derived counts.
                country["controller_feature_count"] = controller_counts.get(tag, 0)
        summary["owner_count"] = len(counts)
        summary["controller_count"] = len(controller_counts)

    if scenario_id == "tno_1962":
        # Both files are authoring inputs; keep new feature overrides identical.
        manual_path = scenario_dir / "scenario_manual_overrides.json"
        mutations_path = scenario_dir / "scenario_mutations.json"
        manual = load_json(manual_path)
        mutations = load_json(mutations_path)
        manual_assignments = manual["assignments"]
        mutation_assignments = mutations["assignments_by_feature_id"]
        for feature_id in removed:
            manual_assignments.pop(feature_id, None)
            mutation_assignments.pop(feature_id, None)
        for feature_id, assignment in assignments.items():
            row = {key: assignment[key] for key in ("owner", "controller", "cores")}
            manual_assignments[feature_id] = row
            mutation_assignments[feature_id] = row.copy()

    strategic_path = scenario_dir / "strategic_values.by_feature.json"
    strategic = None
    if strategic_path.exists():
        strategic = load_json(strategic_path)
        buckets = strategic["bucket_by_feature"]
        new_buckets = {}
        missing_buckets = []
        for feature_id, assignment in assignments.items():
            parent_id = str(assignment.get("parent_id") or "")
            if parent_id:
                bucket = buckets.get(parent_id) or buckets.get(feature_id)
                if bucket is None:
                    missing_buckets.append(feature_id)
                    continue
            else:
                # Match the builder's fallback for features without a state
                # anchor: use the existing country-pooled bucket.
                owner = str(assignment["owner"])
                bucket = f"pool:{owner}"
                strategic["buckets"].setdefault(bucket, {
                    "owner_tag": owner,
                    "attribution": "country_pooled",
                    **{metric: 0.0 for metric in strategic["metrics"]},
                })
            new_buckets[feature_id] = bucket
        if missing_buckets:
            raise ValueError(f"strategic bucket missing for parent of: {missing_buckets[:5]}")
        for feature_id in removed:
            buckets.pop(feature_id, None)
        buckets.update(new_buckets)
        strategic["baseline_hash"] = baseline_hash

    write_json(owners_path, owners_payload)
    write_json(cores_path, cores_payload)
    if scenario_id == "tno_1962":
        write_json(manual_path, manual)
        write_json(mutations_path, mutations)
    if controllers_payload is not None:
        write_json(controllers_path, controllers_payload)
    write_json(countries_path, countries_payload)
    if strategic is not None:
        write_json(strategic_path, strategic)
    _refresh_summary_metadata(scenario_dir, manifest, countries, assignments, removed)
    write_json(manifest_path, manifest)
    fixes = apply_safe_scenario_contract_repairs(
        scenario_dir, rebuild_chunk_assets=rebuild_chunk_assets
    )
    synchronize_scenario_snapshot(scenario_dir)
    return fixes


def synchronize_scenario_snapshot(scenario_dir: Path) -> None:
    """Publish byte-identical startup mirrors before fingerprinting final assets."""
    for path in scenario_dir.glob('startup.bundle.*.json'):
        mirror = path.with_suffix(path.suffix + '.gz')
        if mirror.exists() and gzip.decompress(mirror.read_bytes()) != path.read_bytes():
            mirror.write_bytes(gzip.compress(path.read_bytes(), mtime=0))
    manifest_path = scenario_dir / 'manifest.json'
    manifest = load_json(manifest_path)
    snapshot = _build_snapshot_for_scenario(scenario_dir, manifest)
    manifest['snapshot_fingerprint'] = snapshot['snapshot_fingerprint']
    write_json(manifest_path, manifest)
    _refresh_audit_payload(scenario_dir, manifest, snapshot_payload=snapshot)


def _refresh_summary_metadata(
    scenario_dir: Path,
    manifest: dict,
    countries: dict,
    assignments: Mapping[str, Mapping[str, object]],
    removed_ids: set[str],
) -> None:
    """Reconcile counts where the checked-in provenance identifies each delta."""
    scenario_id = scenario_dir.name
    summary = manifest["summary"]
    if scenario_id == "modern_world":
        if set(summary.get("quality_counts", {})) == {"direct_country_copy"}:
            summary["quality_counts"]["direct_country_copy"] = summary["feature_count"]
        if set(summary.get("source_counts", {})) == {"canonical_baseline"}:
            summary["source_counts"]["canonical_baseline"] = summary["feature_count"]
        return
    if scenario_id == "tno_1962":
        audit_path = scenario_dir / "audit.json"
        if not audit_path.exists():
            return
        audit = load_json(audit_path)
        marker = audit.setdefault("diagnostics", {}).setdefault("polar_materialization", {})
        classified = set(marker.get("classified_feature_ids", []))
        new_ids = set(assignments) - classified
        for feature_id in sorted(new_ids):
            country = countries[str(assignments[feature_id]["owner"])]
            quality = str(country["quality"])
            source = str(country["source"])
            if quality not in summary["quality_counts"] or source not in summary["source_counts"]:
                raise ValueError(f"TNO feature classification is not established: {feature_id}")
            summary["quality_counts"][quality] += 1
            summary["source_counts"][source] += 1
            if quality == "approx_existing_geometry":
                summary["approximate_count"] += 1
            if quality == "manual_reviewed":
                summary["manual_reviewed_feature_count"] += 1
        marker["classified_feature_ids"] = sorted(classified | new_ids)
        owner_stats = audit.get("owner_stats", {})
        for tag, stat in owner_stats.items():
            country = countries.get(tag)
            if isinstance(country, dict) and isinstance(stat, dict):
                stat["feature_count"] = country["feature_count"]
                if "controller_feature_count" in stat:
                    stat["controller_feature_count"] = country.get("controller_feature_count", country["feature_count"])
        for feature_id in new_ids:
            tag = str(assignments[feature_id]["owner"])
            stat = owner_stats.get(tag)
            if isinstance(stat, dict) and isinstance(stat.get("quality_breakdown"), dict):
                quality = str(countries[tag]["quality"])
                stat["quality_breakdown"][quality] = stat["quality_breakdown"].get(quality, 0) + 1
        write_json(audit_path, audit)
        return
    if scenario_id not in {"hoi4_1936", "hoi4_1939"}:
        return

    audit_path = scenario_dir / "audit.json"
    if not audit_path.exists():
        return
    audit = load_json(audit_path)
    changes = audit.get("feature_changes")
    if not isinstance(changes, list):
        return
    removed_rows = [row for row in changes if row.get("feature_id") in removed_ids]
    removed_changes = {row["feature_id"] for row in removed_rows}
    if removed_changes:
        audit["feature_changes"] = [
            row for row in changes if row.get("feature_id") not in removed_changes
        ]

    diagnostics = audit.setdefault("diagnostics", {})
    marker = diagnostics.setdefault("polar_materialization", {})
    classified = set(marker.get("direct_nor_feature_ids", []))
    direct_nor_ids = {
        feature_id for feature_id, assignment in assignments.items()
        if feature_id.startswith("NO_PRIMARY_GAP_")
        and not assignment.get("parent_id")
        and assignment.get("owner") == "NOR"
    }
    added_direct = direct_nor_ids - classified
    marker["direct_nor_feature_ids"] = sorted(classified | direct_nor_ids)

    qualities = summary.get("quality_counts", {})
    sources = summary.get("source_counts", {})
    for row in removed_rows:
        quality = row.get("quality")
        source = row.get("source")
        if quality in qualities:
            qualities[quality] -= 1
        if source in sources:
            sources[source] -= 1
        if quality == "manual_reviewed":
            summary["manual_reviewed_feature_count"] -= 1
    qualities["direct_country_copy"] += len(added_direct)
    sources["direct_active_owner"] += len(added_direct)
    summary["changed_feature_count"] -= len(removed_rows)

    owner_stats = audit.get("owner_stats")
    if isinstance(owner_stats, dict):
        for tag, stat in owner_stats.items():
            country = countries.get(tag)
            if isinstance(country, dict) and isinstance(stat, dict):
                stat["feature_count"] = country["feature_count"]
                if "controller_feature_count" in stat:
                    stat["controller_feature_count"] = country.get("controller_feature_count", country["feature_count"])
        for tag, quality, delta in (
            ("SOV", "manual_reviewed", -sum(row.get("to_tag") == "SOV" and row.get("quality") == "manual_reviewed" for row in removed_rows)),
            ("NOR", "direct_country_copy", len(added_direct)),
        ):
            stat = owner_stats.get(tag)
            if isinstance(stat, dict) and isinstance(stat.get("quality_breakdown"), dict):
                stat["quality_breakdown"][quality] = stat["quality_breakdown"].get(quality, 0) + delta
    write_json(audit_path, audit)
