"""Offline, fail-closed same-ID precision candidates for JP/CN/IN/US.

Sources are cached inputs, never downloaded. Output is review material, not a
runtime entry point. Country outlines, scenario metadata and auxiliary surfaces
are retained by the existing regional precision assembler.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import geopandas as gpd
import shapely
from shapely.geometry import mapping

from map_builder.io.readers import read_json_strict
from map_builder.io.writers import write_json_atomic
from map_builder.regional_geometry import _absolute_topology, _decode_geometry
from tools.pilot_tno_regional_precision import _assemble_candidate
from tools.pilot_tno_russia_precision import constrained_partition, node_owner_interfaces
from tools.political_detail_partition import (
    feature_bounds, feature_costs, partition_political_detail_features,
    POLITICAL_DETAIL_SHARD_MAX_COMPACT_BYTES, POLITICAL_DETAIL_SHARD_MAX_PATH_COST,
)

PROFILES = {
    "JP": {"source": "ne_10m_admin_1_states_provinces.shp", "id_column": "adm1_code", "prefix": "", "target_prefixes": (), "tolerance": .002, "max_coordinates": 100_000, "max_bytes": 8 * 1024**2},
    "CN": {"source": "china_adm2.geojson", "id_column": "shapeID", "prefix": "CN_CITY_", "target_prefixes": ("CN_CITY_",), "tolerance": .002, "max_coordinates": 500_000, "max_bytes": 24 * 1024**2},
    "IN": {"source": "geoBoundaries-IND-ADM2.geojson", "id_column": "shapeID", "prefix": "IN_ADM2_", "target_prefixes": ("IN_ADM2_",), "tolerance": .003, "max_coordinates": 1_000_000, "max_bytes": 48 * 1024**2},
    "US": {"source": "cb_2024_us_county_500k.zip", "id_column": "GEOID", "prefix": "US_CNTY_", "target_prefixes": ("US_",), "tolerance": .002, "max_coordinates": 1_000_000, "max_bytes": 48 * 1024**2},
}


def file_digest(path):
    with Path(path).open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def load_source(data_root, country, source_path=None):
    profile = PROFILES[country]
    path = Path(source_path or (Path(data_root) / profile["source"])).resolve()
    if not path.is_file():
        raise ValueError(f"missing_source: {path}")
    frame = gpd.read_file(path)
    if frame.crs is None:
        raise ValueError("source_crs_missing")
    frame = frame.to_crs(4326)
    if country == "JP":
        frame = frame[frame["iso_a2"] == "JP"].copy()
    elif country in {"CN", "IN"}:
        expected = {"CN": "CHN", "IN": "IND"}[country]
        if "shapeGroup" not in frame or set(frame["shapeGroup"]) != {expected}:
            raise ValueError("source_country_leakage")
    elif not frame["GEOID"].astype(str).str.fullmatch(r"\d{5}").all():
        raise ValueError("invalid_us_county_identifiers")
    frame["id"] = profile["prefix"] + frame[profile["id_column"]].astype(str)
    frame["cntr_code"] = country
    return frame[["id", "cntr_code", "geometry"]], path


def governed_source(data_root, country, path):
    """Verify an explicitly supplied cache against the repository's governed bytes."""
    ledger = read_json_strict(Path(data_root) / "source_ledger.json")
    entries = [r for r in ledger if r.get("local_path") == "data/" + PROFILES[country]["source"]]
    if len(entries) != 1 or not entries[0].get("current_local_sha256"):
        raise ValueError("governed_source_requires_unique_ledger_digest")
    entry = entries[0]
    digest = file_digest(path)
    if digest.lower() != entry["current_local_sha256"].lower():
        raise ValueError("governed_source_digest_mismatch")
    return {"source_id": entry["source_id"], "sha256": digest,
            "upstream_url": entry.get("upstream_url"), "status": entry.get("status"),
            "license": entry.get("license"), "verified_against": str(Path(data_root) / "source_ledger.json")}


def baseline_overlap_inventory(absolute, target_ids, owners=None):
    """Keep participants of frozen-domain overlaps out of an upgrade.

    Include foreign participants: preserving only a selected-selected overlap
    would still let a selected feature change an existing foreign allocation.
    With owners supplied, exact source coverage may repair same-owner overlaps.
    """
    rows = absolute["objects"]["political"]["geometries"]
    ids = [str(r["properties"]["id"]) for r in rows]
    values = [_decode_geometry(absolute, r) for r in rows]
    tree = shapely.STRtree(values)
    targets = set(target_ids)
    preserved, overlaps = set(), []
    for i, fid in enumerate(ids):
        if fid not in targets:
            continue
        for raw_j in tree.query(values[i], predicate="intersects"):
            j = int(raw_j)
            if j == i or (ids[j] in targets and j < i):
                continue
            # Within one upgraded owner domain, exact source coverage may
            # resolve inherited overlaps without changing political allocation.
            # The partition gate below rejects any nearest-source resolution.
            if owners is not None and ids[j] in targets and fid in owners and owners.get(ids[j]) == owners[fid]:
                continue
            overlap = values[i].intersection(values[j])
            if overlap.area <= 0:
                continue
            if overlap.area <= 1e-10 and all(values[k].boundary.buffer(1e-9).covers(overlap) for k in (i, j)):
                continue
            preserved.update({fid, ids[j]} & targets)
            overlaps.append({"ids": [fid, ids[j]], "area_deg2": overlap.area, "bounds": list(overlap.bounds)})
    return sorted(preserved), overlaps


def geographic_target_ids(baseline_rows, country, source_ids=()):
    """Select geographic source members independently of mutable scenario allegiance."""
    prefixes = PROFILES[country]["target_prefixes"]
    source_ids = set(map(str, source_ids))
    result = []
    for row in baseline_rows:
        props = row["properties"]
        fid = str(props["id"])
        matches_geography = fid.startswith(prefixes) if prefixes else (fid in source_ids or props.get("cntr_code") == country)
        if matches_geography:
            result.append(fid)
    if not result or len(set(result)) != len(result):
        raise ValueError("baseline_ids_missing_or_duplicate")
    return result


def map_source(baseline_rows, source, country, lineage=None, target_ids=None):
    """Exact identifiers only; an explicit many-to-one map may rebuild US zones.

    One source assigned to multiple scenario children is deliberately rejected:
    those children need a reviewed cut geometry, not a guessed nearest polygon.
    """
    if source.empty or source.crs is None or source.crs.to_epsg() != 4326:
        raise ValueError("source_requires_nonempty_wgs84")
    if set(source["cntr_code"]) != {country}:
        raise ValueError("source_country_leakage")
    if not source["id"].is_unique or source["id"].isna().any():
        raise ValueError("source_ids_not_unique")
    source_by_id = dict(zip(source["id"].astype(str), source.geometry))
    target_ids = list(target_ids or geographic_target_ids(baseline_rows, country, source_by_id))
    baseline_ids = {str(row["properties"]["id"]) for row in baseline_rows}
    if not target_ids or len(set(target_ids)) != len(target_ids) or set(target_ids) - baseline_ids:
        raise ValueError("baseline_ids_missing_or_duplicate")
    lineage = lineage or {fid: [fid] for fid in target_ids}
    if set(lineage) != set(target_ids):
        raise ValueError("lineage_must_cover_exact_target_ids")
    used = []
    for fid in target_ids:
        members = lineage[fid]
        if not isinstance(members, list) or not members or any(not isinstance(x, str) for x in members):
            raise ValueError(f"invalid_lineage: {fid}")
        used.extend(members)
    missing = sorted(set(used) - set(source_by_id))
    if missing:
        raise ValueError(f"unresolved_lineage: {len(missing)} source IDs missing; examples={missing[:8]}")
    if len(used) != len(set(used)):
        raise ValueError("split_children_require_reviewed_cut_geometry")
    frame = gpd.GeoDataFrame([
        {"id": fid, "cntr_code": country,
         "geometry": shapely.union_all([source_by_id[item] for item in lineage[fid]])}
        for fid in target_ids], crs=4326)
    geometry = frame.geometry.values
    if any(g is None or g.is_empty or not g.is_valid or g.geom_type not in {"Polygon", "MultiPolygon"} for g in geometry):
        raise ValueError("invalid_source_polygons")
    if not shapely.coverage_is_valid(geometry):
        raise ValueError("source_coverage_invalid")
    return frame, {"mapping": lineage, "unused_source_ids": sorted(set(source_by_id) - set(used))}


def cost_report(frame, owners, profile):
    buckets = {}
    for row in frame.itertuples():
        fid = str(row.id)
        if fid not in owners:
            raise ValueError(f"owner_mapping_missing: {fid}")
        feature = {"type": "Feature", "properties": {"id": fid, "cntr_code": row.cntr_code}, "geometry": mapping(row.geometry)}
        buckets.setdefault(owners[fid], []).append((fid, feature, feature_bounds(feature)))
    chunks = []
    for owner, entries in sorted(buckets.items()):
        for shard in partition_political_detail_features(entries):
            costs = [feature_costs(entry[1]) for entry in shard]
            chunks.append({"owner": owner, "features": len(shard), "path_cost": sum(c[0] for c in costs),
                           "compact_bytes": 42 + sum(c[1] for c in costs) + max(0, len(shard)-1)})
    coordinates = int(shapely.get_num_coordinates(frame.geometry.values).sum())
    compact_bytes = sum(chunk["compact_bytes"] for chunk in chunks)
    oversized = [c for c in chunks if c["path_cost"] > POLITICAL_DETAIL_SHARD_MAX_PATH_COST or c["compact_bytes"] > POLITICAL_DETAIL_SHARD_MAX_COMPACT_BYTES]
    return {"coordinates": coordinates, "compact_bytes": compact_bytes, "owner_count": len(buckets),
            "estimated_chunks": chunks, "oversized_indivisible_chunks": oversized,
            "budget_pass": coordinates <= profile["max_coordinates"] and compact_bytes <= profile["max_bytes"] and not oversized,
            "budget": {k: profile[k] for k in ("max_coordinates", "max_bytes")}}


def coverage_gate(old, new, max_surface_delta=1e-10):
    if not math.isfinite(max_surface_delta) or max_surface_delta < 0:
        raise ValueError("invalid_surface_delta_budget")
    if not shapely.coverage_is_valid(new):
        raise ValueError("candidate_coverage_invalid")
    delta = shapely.union_all(old).symmetric_difference(shapely.union_all(new)).area
    if delta > max_surface_delta:
        raise ValueError(f"candidate_surface_changed: {delta}")
    return {"coverage_valid": True, "surface_delta_degrees_squared": delta,
            "max_surface_delta_degrees_squared": max_surface_delta}


def freeze_owner_domains(absolute, selected, owners, tolerance, *, preserve_failed_domains=False):
    rows = absolute["objects"]["political"]["geometries"]
    selected_ids = set(selected["id"])
    old = {r["properties"]["id"]: _decode_geometry(absolute, r) for r in rows
           if r["properties"]["id"] in selected_ids}
    sources = dict(zip(selected["id"], selected.geometry))
    groups = {}
    for fid in sorted(selected_ids):
        if fid not in owners:
            raise ValueError(f"owner_mapping_missing: {fid}")
        groups.setdefault(owners[fid], []).append(fid)
    replacement, diagnostics = {}, {}
    for owner, ids in sorted(groups.items()):
        def partition_domain(domain_ids):
            result, diagnostic = constrained_partition({fid: old[fid] for fid in domain_ids}, sources,
                                                       {fid: fid for fid in domain_ids})
            if diagnostic.get("baseline_overlap_resolutions"):
                raise ValueError("nearest_source_overlap_resolution_forbidden")
            values = shapely.coverage_simplify([result[fid] for fid in domain_ids], tolerance, simplify_boundary=False)
            diagnostic["coverage"] = coverage_gate([old[fid] for fid in domain_ids], values)
            return values, diagnostic
        try:
            values, diagnostic = partition_domain(ids)
        except (ValueError, shapely.errors.GEOSException) as exc:
            if not preserve_failed_domains:
                raise
            preserved, _ = baseline_overlap_inventory(absolute, ids)
            clean_ids = [fid for fid in ids if fid not in set(preserved)]
            if not preserved or not clean_ids:
                diagnostics[owner] = {"preserved_ids": ids, "reason": str(exc), "upgraded": False}
                continue
            try:
                values, diagnostic = partition_domain(clean_ids)
            except (ValueError, shapely.errors.GEOSException) as retry_exc:
                diagnostics[owner] = {"preserved_ids": ids, "reason": str(retry_exc), "initial_reason": str(exc), "upgraded": False}
                continue
            diagnostic.update(preserved_ids=preserved, initial_reason=str(exc), upgraded=True)
            ids = clean_ids
        replacement.update(zip(ids, values))
        diagnostics[owner] = diagnostic
    replacement = node_owner_interfaces(replacement)
    result = selected[selected["id"].isin(replacement)].copy()
    result["geometry"] = [replacement[fid] for fid in result["id"]]
    return result, diagnostics


def prepare(scenario_dir, data_root, output_root, countries, *, lineage_paths=None, source_paths=None,
            preserve_baseline_overlaps=False, preserve_unresolved_lineage=False):
    scenario_dir, data_root, output_root = map(lambda p: Path(p).resolve(), (scenario_dir, data_root, output_root))
    runtime_root = (ROOT / ".runtime").resolve()
    if output_root.exists() or output_root == runtime_root or not output_root.is_relative_to(runtime_root):
        raise ValueError("output_root_must_be_new_and_inside_repository_runtime")
    if not countries or len(set(countries)) != len(countries) or set(countries) - set(PROFILES):
        raise ValueError("select_unique_supported_countries")
    if read_json_strict(scenario_dir / "manifest.json").get("scenario_id") != "tno_1962":
        raise ValueError("requires_tno_1962")
    baseline = read_json_strict(scenario_dir / "runtime_topology.topo.json")
    absolute = _absolute_topology(baseline)
    rows = absolute["objects"]["political"]["geometries"]
    owners = read_json_strict(scenario_dir / "owners.by_feature.json")["owners"]
    output_root.mkdir(parents=True)
    reports = []
    for country in countries:
        profile = PROFILES[country]
        target_ids = geographic_target_ids(rows, country)
        report = {"country": country, "status": "blocked", "release_ready": False, "profile": profile,
                  "baseline_runtime": str(scenario_dir / "runtime_topology.topo.json"),
                  "baseline_sha256": file_digest(scenario_dir / "runtime_topology.topo.json"),
                  "baseline_target_ids": target_ids, "baseline_target_features": len(target_ids),
                  "baseline_owner_counts": dict(Counter(owners.get(fid, "MISSING") for fid in target_ids)),
                  "split_child_ids": [fid for fid in target_ids if "__" in fid],
                  "policy": "Candidate only; all scenario sidecar files remain authoritative and are not rewritten."}
        try:
            source_path = (source_paths or {}).get(country)
            if source_path:
                report["source_provenance"] = governed_source(data_root, country, source_path)
            source, path = load_source(data_root, country, source_path)
            target_ids = geographic_target_ids(rows, country, source["id"])
            report.update(baseline_target_ids=target_ids, baseline_target_features=len(target_ids),
                          baseline_owner_counts=dict(Counter(owners.get(fid, "MISSING") for fid in target_ids)),
                          split_child_ids=[fid for fid in target_ids if "__" in fid])
            report.update(source_file=str(path), source_sha256=file_digest(path), source_features=len(source), source_coordinates=int(shapely.get_num_coordinates(source.geometry.values).sum()))
            if preserve_unresolved_lineage:
                if (lineage_paths or {}).get(country):
                    raise ValueError("partial_exact_ids_cannot_use_explicit_lineage")
                unresolved = sorted(set(target_ids) - set(source["id"]))
                report["preserved_unresolved_lineage_ids"] = unresolved
                report["preserved_baseline_ids"] = unresolved
                target_ids = [fid for fid in target_ids if fid not in set(unresolved)]
                if not target_ids:
                    raise ValueError("no_exact_source_ids")
            if preserve_baseline_overlaps:
                preserved, overlaps = baseline_overlap_inventory(absolute, target_ids, owners)
                report.update(preserved_baseline_ids=sorted(set(report.get("preserved_baseline_ids", [])) | set(preserved)), inherited_overlaps=overlaps,
                              whole_country_coverage_validated=False,
                              partial_upgrade_policy="Freeze cross-owner and foreign overlaps; allow exact source allocation within an owner. On partition failure freeze all overlapping participants in that owner, then try its clean remainder once. Never use nearest-source allocation.")
                target_ids = [fid for fid in target_ids if fid not in set(preserved)]
                if not target_ids:
                    raise ValueError("no_overlap_free_targets")
            report["upgrade_target_ids"] = target_ids
            report["upgrade_target_features"] = len(target_ids)
            lineage_path = (lineage_paths or {}).get(country)
            lineage = read_json_strict(lineage_path) if lineage_path else None
            selected, lineage_report = map_source(rows, source, country, lineage, target_ids=target_ids)
            report["lineage"] = lineage_report
            report["source_cost"] = cost_report(selected, owners, profile)
            selected, report["frozen_owner_domains"] = freeze_owner_domains(
                absolute, selected, owners, profile["tolerance"], preserve_failed_domains=preserve_baseline_overlaps)
            retained = sorted(set(target_ids) - set(selected["id"]))
            if retained:
                report["preserved_baseline_ids"] = sorted(set(report.get("preserved_baseline_ids", [])) | set(retained))
                target_ids = selected["id"].tolist()
                report.update(upgrade_target_ids=target_ids, upgrade_target_features=len(target_ids))
            if selected.empty:
                raise ValueError("no_upgradeable_owner_domains")
            baseline_codes = {str(r["properties"]["id"]): str(r["properties"].get("cntr_code", "")) for r in rows}
            selected["cntr_code"] = [baseline_codes[str(fid)] for fid in selected["id"]]
            candidate, assembly = _assemble_candidate(
                baseline, selected, [country], boundary_tolerance=1e-9,
                target_feature_ids=target_ids,
            )
            report["assembly"] = assembly
            new_rows = candidate["objects"]["political"]["geometries"]
            old_target = [_decode_geometry(absolute, r) for r in rows if str(r["properties"]["id"]) in set(target_ids)]
            new_target = [_decode_geometry(candidate, r) for r in new_rows if str(r["properties"]["id"]) in set(target_ids)]
            report["coverage"] = coverage_gate(old_target, new_target)
            report["baseline_coordinates"] = int(shapely.get_num_coordinates(old_target).sum())
            target_owner_order = [owners[str(r["properties"]["id"])] for r in rows if str(r["properties"]["id"]) in set(target_ids)]
            owner_deltas = {}
            for owner in sorted(set(target_owner_order)):
                old_domain = shapely.union_all([g for g, tag in zip(old_target, target_owner_order) if tag == owner])
                new_domain = shapely.union_all([g for g, tag in zip(new_target, target_owner_order) if tag == owner])
                owner_deltas[owner] = old_domain.symmetric_difference(new_domain).area
                if owner_deltas[owner] > 1e-10:
                    raise ValueError(f"assembled_owner_domain_changed: {owner}: {owner_deltas[owner]}")
            report["assembled_owner_surface_deltas_deg2"] = owner_deltas
            preserved_ids = set(report.get("preserved_baseline_ids", []))
            old_rows_by_id = {str(r["properties"]["id"]): r for r in rows}
            for row in new_rows:
                fid = str(row["properties"]["id"])
                if fid in preserved_ids:
                    old_row = old_rows_by_id[fid]
                    if row["properties"] != old_row["properties"] or not _decode_geometry(candidate, row).equals_exact(_decode_geometry(absolute, old_row), 0):
                        raise ValueError(f"preserved_baseline_feature_changed: {fid}")
            report["preserved_baseline_verified"] = True
            selected["geometry"] = new_target
            report["cost"] = cost_report(selected, owners, profile)
            if not report["cost"]["budget_pass"]:
                raise ValueError("candidate_cost_budget_exceeded")
            output = output_root / f"{country.lower()}.candidate.topo.json"
            write_json_atomic(output_root / f"{country.lower()}.target-ids.json", target_ids, indent=2)
            write_json_atomic(output, candidate, indent=None, separators=(",", ":"), allow_nan=False)
            report.update(status="candidate_ready_for_review", candidate=str(output),
                          owners=dict(Counter(owners[str(fid)] for fid in selected["id"])))
        except (ValueError, KeyError, shapely.errors.GEOSException) as exc:
            report["blocker"] = str(exc)
        write_json_atomic(output_root / f"{country.lower()}.report.json", report, indent=2, allow_nan=False)
        reports.append(report)
    write_json_atomic(output_root / "summary.json", {"countries": reports, "release_ready": False}, indent=2, allow_nan=False)
    return reports


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario-dir", type=Path, default=ROOT / "data/scenarios/tno_1962")
    parser.add_argument("--data-root", type=Path, default=ROOT / "data")
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--countries", nargs="+", choices=sorted(PROFILES), default=list(PROFILES))
    parser.add_argument("--lineage", action="append", default=[], metavar="COUNTRY=JSON")
    parser.add_argument("--source", action="append", default=[], metavar="COUNTRY=PATH",
                        help="Explicit cached source, verified against source_ledger SHA256.")
    parser.add_argument("--preserve-baseline-overlaps", action="store_true",
                        help="Retain frozen-domain overlap features; on partition failure try only that owner's overlap-free remainder.")
    parser.add_argument("--preserve-unresolved-lineage", action="store_true",
                        help="Upgrade only exact source IDs, retaining unresolved zones and split children unchanged.")
    args = parser.parse_args(argv)
    lineage = dict(value.split("=", 1) for value in args.lineage)
    sources = dict(value.split("=", 1) for value in args.source)
    if set(lineage) - set(args.countries):
        parser.error("lineage country must be selected")
    if set(sources) - set(args.countries):
        parser.error("source country must be selected")
    reports = prepare(args.scenario_dir, args.data_root, args.output_root, args.countries,
                      lineage_paths=lineage, source_paths=sources,
                      preserve_baseline_overlaps=args.preserve_baseline_overlaps,
                      preserve_unresolved_lineage=args.preserve_unresolved_lineage)
    print(json.dumps([{k: r[k] for k in ("country", "status", "blocker") if k in r} for r in reports], indent=2))
    return 0 if all(r["status"] == "candidate_ready_for_review" for r in reports) else 2


if __name__ == "__main__":
    raise SystemExit(main())
