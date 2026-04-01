import argparse
import json
from pathlib import Path

from shapely import coverage_invalid_edges, coverage_is_valid
from shapely.geometry import shape
from topojson.utils import serialize_as_geojson


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCENARIO_DIR = ROOT / "data" / "scenarios" / "tno_1962"
DEFAULT_REPORT_PATH = ROOT / ".runtime" / "reports" / "generated" / "tno_water_geometry_report.json"
WORLD_BBOX_WIDTH_THRESHOLD = 300.0
ANTIMERIDIAN_EPSILON = 1e-3


def _load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object in {path}, got {type(payload).__name__}.")
    return payload


def _iter_polygon_parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    if geometry.geom_type == "MultiPolygon":
        return list(geometry.geoms)
    if hasattr(geometry, "geoms"):
        parts = []
        for child in geometry.geoms:
            parts.extend(_iter_polygon_parts(child))
        return parts
    return []


def _feature_id(feature: dict) -> str:
    properties = feature.get("properties") or {}
    return str(properties.get("id") or feature.get("id") or "").strip()


def _bbox_width(geometry) -> float:
    min_x, _, max_x, _ = geometry.bounds
    return float(max_x - min_x)


def _part_bounds(parts) -> list[list[float]]:
    return [[float(value) for value in part.bounds] for part in parts]


def _is_antimeridian_split_feature(geometry) -> bool:
    parts = _iter_polygon_parts(geometry)
    if len(parts) < 2:
      return False
    feature_bounds = geometry.bounds
    min_x = float(feature_bounds[0])
    max_x = float(feature_bounds[2])
    touches_left = any(abs(float(part.bounds[0]) + 180.0) <= ANTIMERIDIAN_EPSILON for part in parts)
    touches_right = any(abs(float(part.bounds[2]) - 180.0) <= ANTIMERIDIAN_EPSILON for part in parts)
    if not (touches_left and touches_right):
        return False
    return abs(min_x + 180.0) <= ANTIMERIDIAN_EPSILON and abs(max_x - 180.0) <= ANTIMERIDIAN_EPSILON


def _collect_feature_metrics(feature_collection: dict, *, label: str) -> dict:
    invalid = []
    empty = []
    oversized_features = []
    oversized_parts = []
    antimeridian_split_features = []
    feature_ids = []
    for feature in feature_collection.get("features") or []:
        feature_id = _feature_id(feature)
        feature_ids.append(feature_id)
        geometry_payload = feature.get("geometry")
        if not geometry_payload:
            empty.append(feature_id)
            continue
        geometry = shape(geometry_payload)
        if geometry.is_empty:
            empty.append(feature_id)
            continue
        if not geometry.is_valid:
            invalid.append(feature_id)
        width = _bbox_width(geometry)
        parts = _iter_polygon_parts(geometry)
        if width > WORLD_BBOX_WIDTH_THRESHOLD:
            record = {
                "id": feature_id,
                "bbox_width": width,
                "part_count": len(parts),
                "part_bounds": _part_bounds(parts),
            }
            if _is_antimeridian_split_feature(geometry):
                antimeridian_split_features.append(record)
            else:
                oversized_features.append(record)
        for part in parts:
            part_width = _bbox_width(part)
            if part_width > WORLD_BBOX_WIDTH_THRESHOLD:
                oversized_parts.append({
                    "id": feature_id,
                    "bbox_width": part_width,
                    "bounds": [float(value) for value in part.bounds],
                })
    return {
        "label": label,
        "feature_count": len(feature_ids),
        "feature_ids": sorted(filter(None, feature_ids)),
        "invalid_feature_ids": sorted(filter(None, invalid)),
        "empty_feature_ids": sorted(filter(None, empty)),
        "oversized_feature_bboxes": oversized_features,
        "oversized_part_bboxes": oversized_parts,
        "antimeridian_split_features": antimeridian_split_features,
    }


def _load_runtime_topology_feature_collection(path: Path, object_name: str) -> dict:
    topology_payload = _load_json(path)
    return serialize_as_geojson(topology_payload, objectname=object_name)


def _load_chunk_feature_collections(scenario_dir: Path) -> list[tuple[str, dict]]:
    chunks_dir = scenario_dir / "chunks"
    feature_collections = []
    for path in sorted(chunks_dir.glob("water.*.json")):
        payload = _load_json(path)
        if str(payload.get("type") or "").strip() != "FeatureCollection":
            continue
        feature_collections.append((path.name, payload))
    return feature_collections


def _collect_chunk_metrics(scenario_dir: Path) -> dict:
    metrics = []
    feature_ids = set()
    invalid = []
    empty = []
    oversized_parts = []
    oversized_features = []
    antimeridian_split_features = []
    for label, feature_collection in _load_chunk_feature_collections(scenario_dir):
        metric = _collect_feature_metrics(feature_collection, label=label)
        metrics.append(metric)
        feature_ids.update(metric["feature_ids"])
        invalid.extend(metric["invalid_feature_ids"])
        empty.extend(metric["empty_feature_ids"])
        oversized_features.extend(metric["oversized_feature_bboxes"])
        oversized_parts.extend(metric["oversized_part_bboxes"])
        antimeridian_split_features.extend(metric["antimeridian_split_features"])
    return {
        "chunks": metrics,
        "feature_ids": sorted(feature_ids),
        "invalid_feature_ids": sorted(set(filter(None, invalid))),
        "empty_feature_ids": sorted(set(filter(None, empty))),
        "oversized_feature_bboxes": oversized_features,
        "oversized_part_bboxes": oversized_parts,
        "antimeridian_split_features": antimeridian_split_features,
    }


def _collect_ocean_macro_coverage(feature_collection: dict) -> dict:
    ocean_features = [
        feature for feature in (feature_collection.get("features") or [])
        if str((feature.get("properties") or {}).get("region_group") or "").strip() == "ocean_macro"
    ]
    geometries = [shape(feature.get("geometry")) for feature in ocean_features if feature.get("geometry")]
    polygonal = [geom for geom in geometries if not geom.is_empty]
    if not polygonal:
        return {
            "feature_count": 0,
            "is_valid": True,
            "invalid_edge_count": 0,
        }
    invalid_edges = coverage_invalid_edges(polygonal)
    invalid_edge_count = 0
    if invalid_edges is not None:
        if hasattr(invalid_edges, "is_empty"):
            if not invalid_edges.is_empty:
                if hasattr(invalid_edges, "geoms"):
                    invalid_edge_count = len(list(invalid_edges.geoms))
                else:
                    invalid_edge_count = 1
        else:
            invalid_edge_count = sum(
                1
                for edge in invalid_edges
                if edge is not None and not getattr(edge, "is_empty", True)
            )
    return {
        "feature_count": len(polygonal),
        "is_valid": bool(coverage_is_valid(polygonal)),
        "invalid_edge_count": invalid_edge_count,
    }


def build_report(scenario_dir: Path) -> dict:
    source_water = _load_json(scenario_dir / "water_regions.geojson")
    runtime_water = _load_runtime_topology_feature_collection(scenario_dir / "runtime_topology.topo.json", "scenario_water")
    chunk_metrics = _collect_chunk_metrics(scenario_dir)
    source_metrics = _collect_feature_metrics(source_water, label="water_regions.geojson")
    runtime_metrics = _collect_feature_metrics(runtime_water, label="runtime_topology.topo.json::scenario_water")
    source_ids = set(source_metrics["feature_ids"])
    runtime_ids = set(runtime_metrics["feature_ids"])
    chunk_ids = set(chunk_metrics["feature_ids"])
    return {
        "scenario_id": scenario_dir.name,
        "checks": {
            "source": source_metrics,
            "runtime": runtime_metrics,
            "chunks": chunk_metrics,
            "ocean_macro_coverage": _collect_ocean_macro_coverage(source_water),
            "id_consistency": {
                "source_only": sorted(source_ids - runtime_ids),
                "runtime_only": sorted(runtime_ids - source_ids),
                "chunk_missing": sorted(source_ids - chunk_ids),
                "chunk_only": sorted(chunk_ids - source_ids),
            },
        },
    }


def summarize_failures(report: dict) -> list[str]:
    failures = []
    checks = report["checks"]
    for section_name in ("source", "runtime", "chunks"):
        section = checks[section_name]
        if section["invalid_feature_ids"]:
            failures.append(f"{section_name}: invalid={len(section['invalid_feature_ids'])}")
        if section["empty_feature_ids"]:
            failures.append(f"{section_name}: empty={len(section['empty_feature_ids'])}")
        if section["oversized_part_bboxes"]:
            failures.append(f"{section_name}: oversized_parts={len(section['oversized_part_bboxes'])}")
        if section["oversized_feature_bboxes"]:
            failures.append(f"{section_name}: oversized_features={len(section['oversized_feature_bboxes'])}")
    coverage = checks["ocean_macro_coverage"]
    if not coverage["is_valid"] or coverage["invalid_edge_count"]:
        failures.append(
            f"ocean_macro_coverage: valid={coverage['is_valid']} invalid_edges={coverage['invalid_edge_count']}"
        )
    id_consistency = checks["id_consistency"]
    if id_consistency["source_only"] or id_consistency["runtime_only"] or id_consistency["chunk_missing"] or id_consistency["chunk_only"]:
        failures.append("id_consistency mismatch")
    return failures


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate TNO scenario water geometry outputs.")
    parser.add_argument("--scenario-dir", default=str(DEFAULT_SCENARIO_DIR))
    parser.add_argument("--report-path", default=str(DEFAULT_REPORT_PATH))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    scenario_dir = Path(args.scenario_dir).resolve()
    report_path = Path(args.report_path).resolve()
    report = build_report(scenario_dir)
    failures = summarize_failures(report)
    report["ok"] = not failures
    report["failures"] = failures
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if failures:
        for failure in failures:
            print(failure)
        print(f"report={report_path}")
        return 1
    print(f"ok report={report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
