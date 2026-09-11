"""Final-asset water checks using the application's vendored D3 decoder."""
from __future__ import annotations

import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def validate_water_runtime(topology, *, object_name="water_regions", land_object=None,
                           ocean_object=None, stage_label="water.final"):
    # Validate the exact browser-decoded coordinates before any spherical
    # sampling. Sub-pixel self-intersections can otherwise pass D3 probes while
    # breaking source exports and the chunk materializer's planar contract.
    from shapely.geometry import shape
    from shapely.validation import explain_validity
    from .spherical_safety import _topology_feature_collection

    collection = _topology_feature_collection(topology, object_name, stage_label)
    features = collection.get("features", []) if collection.get("type") == "FeatureCollection" else [collection]
    invalid = []
    for feature in features:
        geometry = shape(feature["geometry"])
        if not geometry.is_valid:
            feature_id = (feature.get("properties") or {}).get("id") or feature.get("id")
            invalid.append({"id": feature_id, "reason": explain_validity(geometry)})
    if invalid:
        raise ValueError(f"Water decoded planar geometry failed at {stage_label}: "
                         + json.dumps(invalid, ensure_ascii=False))
    script = """
import fs from 'node:fs';
import {validateWaterGeometry} from './tools/check_water_geometry.mjs';
const {topology, objectName, landObject, oceanObject} = JSON.parse(fs.readFileSync(0, 'utf8'));
const result = validateWaterGeometry(topology, {
  objectName,
  land: landObject && topology.objects[landObject] ? {topology, objectName: landObject} : null,
  ocean: oceanObject && topology.objects[oceanObject] ? {topology, objectName: oceanObject} : null,
});
process.stdout.write(JSON.stringify(result));
"""
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        input=json.dumps({"topology": topology, "objectName": object_name,
                          "landObject": land_object, "oceanObject": ocean_object}),
        text=True, encoding="utf-8", capture_output=True, cwd=ROOT, timeout=180,
        check=False,
    )
    if completed.returncode:
        raise RuntimeError(f"Water validator failed at {stage_label}: {completed.stderr.strip()}")
    report = json.loads(completed.stdout)
    if not report["ok"]:
        raise ValueError(f"Water runtime geometry failed at {stage_label}: "
                         + json.dumps(report["errors"], ensure_ascii=False))
    return report
