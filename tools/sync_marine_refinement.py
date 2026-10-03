"""Refresh ocean-dependent metadata/startup assets without rebuilding political chunks.

Run after adopting validated outputs from rebuild_water_geometry --refine-marine.
The normal strict scenario checker remains the final read-only gate.
"""
from pathlib import Path
from copy import deepcopy
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.check_scenario_contracts import (
    apply_safe_scenario_contract_repairs, discover_scenario_dirs, write_json,
)
from tools.patch_tno_1962_bundle import (
    MARINE_REGIONS_DATASET_META, TNO_NAMED_MARGINAL_WATER_SPECS,
    sync_tno_water_summary_from_scenario,
)
from tools.scenario_chunk_assets import _build_chunk_payloads_for_layer
from map_builder.geo.marine_refinement import additional_snapshot_features
from map_builder.io.writers import write_json_atomic, write_text_atomic
from shapely.geometry import shape


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def _write_changed(path, payload):
    original_text = path.read_text(encoding="utf-8")
    if json.loads(original_text) != payload:
        compact = "\n" not in original_text.rstrip("\r\n")
        write_json_atomic(
            path, payload, ensure_ascii=False,
            indent=None if compact else 2,
            separators=(",", ":") if compact else None,
            trailing_newline=original_text.endswith(("\n", "\r")),
        )


def _write_locales_geo(path, geo):
    """Change only the top-level geo value, preserving other members verbatim."""
    original_text = path.read_bytes().decode("utf-8")
    if json.loads(original_text)["geo"] == geo:
        return
    decoder = json.JSONDecoder()

    def skip_whitespace(offset):
        while offset < len(original_text) and original_text[offset] in " \t\r\n":
            offset += 1
        return offset

    cursor = skip_whitespace(0) + 1  # The locale bundle is a JSON object.
    geo_span = None
    while original_text[skip_whitespace(cursor)] != "}":
        key_start = skip_whitespace(cursor)
        key, key_end = decoder.raw_decode(original_text, key_start)
        value_start = skip_whitespace(skip_whitespace(key_end) + 1)
        _, value_end = decoder.raw_decode(original_text, value_start)
        if key == "geo":
            if geo_span is not None:
                raise ValueError("Locale bundle has duplicate top-level geo members")
            geo_span = (key_start, value_start, value_end)
        cursor = skip_whitespace(value_end)
        if original_text[cursor] == ",":
            cursor += 1
    if geo_span is None:
        raise ValueError("Locale bundle is missing its top-level geo member")
    key_start, value_start, value_end = geo_span
    previous_value = original_text[value_start:value_end]
    compact = "\n" not in previous_value and "\r" not in previous_value
    replacement = json.dumps(geo, ensure_ascii=False, indent=None if compact else 2,
                             separators=(",", ":") if compact else None)
    if not compact:
        line_start = original_text.rfind("\n", 0, key_start) + 1
        member_indent = original_text[line_start:key_start]
        if member_indent.strip():
            member_indent = ""
        newline = "\r\n" if "\r\n" in previous_value else "\n"
        replacement = replacement.replace("\n", newline + member_indent)
    write_text_atomic(path, original_text[:value_start] + replacement + original_text[value_end:])


def _merge_records(rows, additions, *, feature=False):
    """Replace owned fields by durable ID while retaining order and extensions."""
    result = deepcopy(rows)
    key = lambda row: row["properties"]["id"] if feature else row["id"]
    by_id = {key(row): row for row in result}
    if len(by_id) != len(result):
        raise ValueError("Duplicate source metadata IDs")
    for addition in additions:
        record = by_id.get(key(addition))
        if record is None:
            record = deepcopy(addition)
            result.append(record)
            by_id[key(record)] = record
        elif feature:
            properties = {**record["properties"], **addition["properties"]}
            record.update(deepcopy(addition))
            record["properties"] = properties
        else:
            record.update(deepcopy(addition))
    return result


def _merge_source_datasets(rows, source_layers):
    """Refresh known layer metadata by stable layer ID, preserving extensions."""
    if rows is None:
        rows = []
    if not isinstance(rows, list):
        raise ValueError("source_datasets must be a list")
    result = deepcopy(rows)
    by_layer = {}
    for row in result:
        if not isinstance(row, dict):
            continue
        layer = str(row.get("source_layer") or "").strip()
        if layer:
            by_layer.setdefault(layer, row)

    layers = {str(value).strip() for value in source_layers
              if value is not None and str(value).strip()}
    for layer in sorted(layers):
        metadata = MARINE_REGIONS_DATASET_META.get(layer)
        if not metadata:
            continue
        record = by_layer.get(layer)
        if record is None:
            record = {}
            result.append(record)
            by_layer[layer] = record
        record.update(deepcopy(metadata), source_layer=layer)
    return result


def sync_shared_source_metadata(root):
    """Refresh only registered marine hashes and source-backed geo translations."""
    data = root / "data"
    sources = ("marine_regions.additional.source.geojson", "marine_regions.refined.source.geojson")
    hashes = {f"data/{name}": hashlib.sha256((data / name).read_bytes()).hexdigest()
              for name in sources}
    ledger_path = data / "source_ledger.json"
    ledger = read(ledger_path)
    for relative, digest in hashes.items():
        entries = [row for row in ledger if row.get("local_path") == relative]
        if len(entries) != 1:
            raise ValueError(f"Expected one source ledger registration for {relative}")
        entries[0]["current_local_sha256"] = digest
    _write_changed(ledger_path, ledger)

    locales_path = data / "locales.json"
    locales = read(locales_path)
    for feature in read(data / sources[0])["features"]:
        props = feature["properties"]
        name, zh = props["name"], props["name_zh"]
        locales["geo"].setdefault(name, {}).update(en=name, zh=zh)
    _write_locales_geo(locales_path, locales["geo"])

    manifest_path = data / "manifest.json"
    manifest = read(manifest_path)
    for name in (*sources, "locales.json"):
        # Only update registered outputs; the supplement is governed by ledger.
        if name not in manifest["outputs"]:
            continue
        path = data / name
        manifest["outputs"][name].update(
            size_bytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        )
    manifest["outputs"]["locales.json"].update(
        geo_entry_count=len(locales["geo"]), ui_entry_count=len(locales["ui"]),
    )
    _write_changed(manifest_path, manifest)


def sync_tno_source_metadata(root, additions, named_specs):
    """Persist supplement evidence without fetching or rebuilding scenario geometry."""
    scenario = root / "data/scenarios/tno_1962"
    water = read(scenario / "water_regions.geojson")
    water_by_id = {f["properties"]["id"]: f for f in water["features"]}
    missing_ids = {spec["id"] for spec in named_specs} - water_by_id.keys()
    if missing_ids:
        raise ValueError(f"Promote water geometry before source metadata sync: {sorted(missing_ids)}")
    snapshot_path = scenario / "derived/marine_regions_named_waters.snapshot.geojson"
    snapshot = read(snapshot_path)
    snapshot["features"] = _merge_records(snapshot["features"], additions, feature=True)
    _write_changed(snapshot_path, snapshot)
    snapshot_by_id = {f["properties"]["id"]: f for f in snapshot["features"]}
    extracts = []
    for feature in additions:
        props = feature["properties"]
        extracts.append({key: deepcopy(props[key]) for key in (
            "id", "name", "label", "source_layer", "source_query", "source_record_ids",
            "source_standard", "source_feature_count", "source_url", "source_simplify_degrees",
        ) if key in props})

    provenance_paths = (scenario / "derived/water_regions.provenance.json",
                        scenario / "water_regions.provenance.json")
    for path in provenance_paths:
        provenance = read(path)
        provenance["water_extracts"] = _merge_records(provenance["water_extracts"], extracts)
        provenance["snapshot_path"] = "data/scenarios/tno_1962/derived/marine_regions_named_waters.snapshot.geojson"
        provenance["additional_snapshot_path"] = "data/marine_regions.additional.source.geojson"
        rows = provenance["water_extracts"]
        provenance["source_datasets"] = _merge_source_datasets(
            provenance.get("source_datasets", []),
            {row["source_layer"] for row in rows if row.get("source_layer")},
        )
        provenance.setdefault("diagnostics", {}).update(
            snapshot_feature_count=len(snapshot["features"]),
            local_clone_feature_count=len(provenance.get("local_clone_extracts", [])),
            source_feature_count=sum(int(row.get("source_feature_count") or 0) for row in rows),
            source_layers=sorted({row["source_layer"] for row in rows if row.get("source_layer")}),
        )
        _write_changed(path, provenance)

    shared = read(root / "data/marine_regions.refined.source.geojson")
    shared_by_id = {f["properties"]["id"].replace("marine_", "tno_", 1): f
                    for f in shared["features"]}
    audit_path = scenario / "audit.json"
    audit = read(audit_path)
    diagnostics = audit.setdefault("diagnostics", {})
    diagnostics["tno_water_region_ids"] = [f["properties"]["id"] for f in water["features"]]
    diagnostics["water_regions_provenance"] = read(provenance_paths[0])
    diagnostics["water_regions_provenance_path"] = "data/scenarios/tno_1962/derived/water_regions.provenance.json"
    diagnostics["named_water_snapshot_path"] = "data/scenarios/tno_1962/derived/marine_regions_named_waters.snapshot.geojson"
    named_diagnostics = diagnostics.setdefault("named_water_source_diagnostics", {})
    for spec in named_specs:
        feature_id = spec["id"]
        source_props = snapshot_by_id.get(feature_id, {}).get("properties", {})
        global_source_id = str(spec.get("global_source_id") or "")
        row = named_diagnostics.setdefault(feature_id, {})
        row.update(
            name=spec["name"], source_standard=spec["source_standard"],
            source_layer="global_water_regions" if global_source_id else spec["source_layer"],
            source_query=f"id='{global_source_id}'" if global_source_id else spec["source_query"],
            source_record_ids=[global_source_id] if global_source_id else source_props["source_record_ids"],
            global_source_id=global_source_id,
        )
        for key in ("subtract_base_ids", "supplement_bboxes", "subtract_named_ids", "clip_open_ocean_ids"):
            row[key] = deepcopy(list(spec.get(key, ())))
        if feature_id in shared_by_id:
            row["geometry_area"] = round(shape(shared_by_id[feature_id]["geometry"]).area, 6)
    _write_changed(audit_path, audit)


def main():
    sync_shared_source_metadata(ROOT)
    sync_tno_source_metadata(ROOT, additional_snapshot_features(), TNO_NAMED_MARGINAL_WATER_SPECS)
    manifest_path = ROOT / "data/manifest.json"
    manifest = read(manifest_path)
    for name in ("europe_topology.json", "europe_topology.na_v2.json"):
        path = ROOT / "data" / name
        topology = read(path)
        manifest["outputs"][name].update(
            size_bytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
            arc_count=len(topology["arcs"]), arc_point_count=sum(len(arc) for arc in topology["arcs"]),
        )
    write_json(manifest_path, manifest)
    scenario = ROOT / "data/scenarios/tno_1962"
    sync_tno_water_summary_from_scenario(scenario)
    chunks, layers = _build_chunk_payloads_for_layer(
        scenario_id="tno_1962", scenario_dir=scenario, layer_key="water",
        payload=read(scenario / "water_regions.geojson"),
    )
    detail = read(scenario / "detail_chunks.manifest.json")
    detail["chunks"] = [chunk for chunk in detail["chunks"] if chunk["layer"] != "water"] + chunks
    write_json(scenario / "detail_chunks.manifest.json", detail)
    context = read(scenario / "context_lod.manifest.json")
    context["layers"].update(layers)
    write_json(scenario / "context_lod.manifest.json", context)
    meta = read(scenario / "runtime_meta.json")
    meta["layer_chunk_counts"]["water"] = len(chunks)
    meta["total_chunk_count"] = len(detail["chunks"])
    write_json(scenario / "runtime_meta.json", meta)
    for directory in discover_scenario_dirs(ROOT / "data/scenarios", []):
        print(f"Refresh dependent startup assets: {directory.name}", flush=True)
        apply_safe_scenario_contract_repairs(directory, rebuild_chunk_assets=False)


if __name__ == "__main__":
    main()
