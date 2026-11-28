from __future__ import annotations

from helpers.polygon_fixtures import _square
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import Point, box, mapping, shape

from map_builder.json_source import read_json_source
from tools import patch_tno_1962_bundle as tno_bundle
from tools.patch_tno_1962_bundle import (
    apply_tno_feature_assignment_overrides,
    clip_named_water_features_to_land_mask,
)


class TnoBundleBuilderTest(unittest.TestCase):
    def test_clip_named_water_features_to_land_mask_removes_macro_land_overlap(self) -> None:
        named_features = [
            {
                "type": "Feature",
                "properties": {"id": "macro-sea", "name": "Macro Sea"},
                "geometry": mapping(_square(0, 0, 4.0)),
            }
        ]
        land_mask_geom = _square(1, 1, 2.0)

        clipped_features = clip_named_water_features_to_land_mask(named_features, land_mask_geom)

        self.assertEqual(len(clipped_features), 1)
        clipped_geom = shape(clipped_features[0]["geometry"])
        self.assertTrue(clipped_geom.is_valid)
        self.assertAlmostEqual(clipped_geom.intersection(land_mask_geom).area, 0.0)

    def test_apply_tno_feature_assignment_overrides_follows_cut_feature_source_map(self) -> None:
        political_gdf = gpd.GeoDataFrame(
            [
                {
                    "id": "SOURCE-LAND__tno1962_1",
                    "name": "Cut Land 1",
                    "cntr_code": "OLD",
                    "geometry": _square(0, 0),
                },
                {
                    "id": "SOURCE-LAND__tno1962_2",
                    "name": "Cut Land 2",
                    "cntr_code": "OLD",
                    "geometry": _square(2, 0),
                },
            ],
            geometry="geometry",
            crs="EPSG:4326",
        )
        original_overrides = tno_bundle.TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES
        tno_bundle.TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES = {
            "RKK": ["SOURCE-LAND"],
        }
        try:
            owners_payload = {"owners": {
                "SOURCE-LAND__tno1962_1": "OLD",
                "SOURCE-LAND__tno1962_2": "OLD",
            }}
            controllers_payload = {"controllers": {
                "SOURCE-LAND__tno1962_1": "OLD",
                "SOURCE-LAND__tno1962_2": "OLD",
            }}
            cores_payload = {"cores": {
                "SOURCE-LAND__tno1962_1": ["OLD"],
                "SOURCE-LAND__tno1962_2": ["OLD"],
            }}

            diagnostics = apply_tno_feature_assignment_overrides(
                owners_payload=owners_payload,
                controllers_payload=controllers_payload,
                cores_payload=cores_payload,
                scenario_political_gdf=political_gdf,
                source_feature_id_by_new_id={
                    "SOURCE-LAND__tno1962_1": "SOURCE-LAND",
                    "SOURCE-LAND__tno1962_2": "SOURCE-LAND",
                },
            )

            self.assertEqual(diagnostics["feature_count"], 2)
            self.assertEqual(diagnostics["derived_feature_count"], 2)
            self.assertEqual(set(owners_payload["owners"].values()), {"RKK"})
            self.assertEqual(political_gdf["cntr_code"].tolist(), ["RKK", "RKK"])
        finally:
            tno_bundle.TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES = original_overrides

    def test_checked_in_tno_1962_atlisl_runtime_contract_stays_consistent(self) -> None:
        scenario_dir = Path(tno_bundle.SCENARIO_DIR)
        owners_payload = json.loads((scenario_dir / "owners.by_feature.json").read_text(encoding="utf-8"))
        cores_payload = json.loads((scenario_dir / "cores.by_feature.json").read_text(encoding="utf-8"))
        countries_payload = json.loads((scenario_dir / "countries.json").read_text(encoding="utf-8"))
        runtime_topology = read_json_source(scenario_dir / "runtime_topology.topo.json")

        owners = owners_payload["owners"]
        cores = cores_payload["cores"]
        countries = countries_payload["countries"]
        political_geometries = runtime_topology["objects"]["political"]["geometries"]
        atlantropa_geometries = runtime_topology["objects"]["scenario_atlantropa"]["geometries"]
        self.assertFalse(
            any(
                str(geometry.get("properties", {}).get("id", "")).startswith(("ATLISL_", "ATLSHL_", "ATLWLD_", "ATLSEA_"))
                for geometry in political_geometries
            )
        )
        atlisl_props = [
            geometry.get("properties", {})
            for geometry in atlantropa_geometries
            if str(geometry.get("properties", {}).get("id", "")).startswith("ATLISL_")
        ]
        atlshl_props = [
            geometry.get("properties", {})
            for geometry in atlantropa_geometries
            if str(geometry.get("properties", {}).get("id", "")).startswith("ATLSHL_")
        ]

        self.assertTrue(atlisl_props)
        for props in atlisl_props:
            feature_id = props["id"]
            self.assertIn(feature_id, owners, feature_id)
            self.assertIn(feature_id, cores, feature_id)
            self.assertEqual(props.get("cntr_code"), "ATL", feature_id)
            owner_tag = owners[feature_id]
            core_tags = cores[feature_id]
            self.assertIn(owner_tag, countries, feature_id)
            self.assertNotEqual(owner_tag, "ATL", feature_id)
            self.assertTrue(core_tags, feature_id)
            for core_tag in core_tags:
                self.assertIn(core_tag, countries, feature_id)
                self.assertNotEqual(core_tag, "ATL", feature_id)
            if str(props.get("atl_join_mode") or "").strip().lower() == "boolean_weld":
                self.assertIs(props.get("interactive"), True, feature_id)
            else:
                self.assertIs(props.get("interactive"), True, feature_id)
        for props in atlshl_props:
            self.assertIs(props.get("interactive"), True, props.get("id"))
            self.assertIs(props.get("atl_interactive"), True, props.get("id"))
        helper_prefixes = ("ATLWLD_", "ATLSEA_FILL_")
        helper_roles = {"shore_seal", "sea_completion", "donor_sea"}
        helper_props = [
            geometry.get("properties", {})
            for geometry in atlantropa_geometries
            if str(geometry.get("properties", {}).get("id", "")).startswith(helper_prefixes)
            or str(geometry.get("properties", {}).get("atl_geometry_role", "")).strip().lower() in helper_roles
            or str(geometry.get("properties", {}).get("atl_join_mode", "")).strip().lower() == "gap_fill"
        ]
        self.assertTrue(helper_props)
        for props in helper_props:
            self.assertIs(props.get("interactive"), True, props.get("id"))
            self.assertIs(props.get("atl_interactive"), True, props.get("id"))

    def test_checked_in_tno_1962_atlsea_runtime_contract_keeps_donor_sea_projectable(self) -> None:
        scenario_dir = Path(tno_bundle.SCENARIO_DIR)
        runtime_topology = read_json_source(scenario_dir / "runtime_topology.topo.json")
        political_geometries = runtime_topology["objects"]["political"]["geometries"]
        atlantropa_geometries = runtime_topology["objects"]["scenario_atlantropa"]["geometries"]
        self.assertFalse(
            any(
                str(geometry.get("properties", {}).get("id", "")).startswith("ATLSEA_")
                for geometry in political_geometries
            )
        )
        donor_sea_props = [
            geometry.get("properties", {})
            for geometry in atlantropa_geometries
            if str(geometry.get("properties", {}).get("id", "")).startswith("ATLSEA_")
            and not str(geometry.get("properties", {}).get("id", "")).startswith("ATLSEA_FILL_")
            and str(geometry.get("properties", {}).get("atl_geometry_role") or "").strip().lower() == "donor_sea"
        ]
        fill_props = [
            geometry.get("properties", {})
            for geometry in atlantropa_geometries
            if str(geometry.get("properties", {}).get("id", "")).startswith("ATLSEA_FILL_")
        ]

        self.assertGreater(len(donor_sea_props), 50)
        for props in donor_sea_props:
            feature_id = props.get("id")
            self.assertEqual(props.get("cntr_code"), "ATL", feature_id)
            self.assertEqual(str(props.get("atl_surface_kind") or "").strip().lower(), "sea", feature_id)
            self.assertEqual(str(props.get("atl_geometry_role") or "").strip().lower(), "donor_sea", feature_id)
            self.assertEqual(props.get("atl_render_layer"), "water", feature_id)
            self.assertEqual(props.get("atl_color_rule"), "atlantropa_sea", feature_id)
            self.assertIs(props.get("atl_interactive"), True, feature_id)
            self.assertIs(props.get("interactive"), True, feature_id)
            self.assertIs(props.get("render_as_base_geography"), False, feature_id)
        self.assertGreater(len(fill_props), 100)
        for props in fill_props:
            feature_id = props.get("id")
            self.assertEqual(str(props.get("atl_geometry_role") or "").strip().lower(), "sea_completion", feature_id)
            self.assertEqual(props.get("atl_render_layer"), "water", feature_id)
            self.assertEqual(props.get("atl_color_rule"), "atlantropa_sea", feature_id)
            self.assertIs(props.get("atl_interactive"), True, feature_id)
            self.assertIs(props.get("interactive"), True, feature_id)

    def test_mediterranean_closure_fills_gap_without_flooding_land_or_other_water(self) -> None:
        template = box(0, 0, 10, 10)
        baseline_land = box(3, 3, 4, 4)
        atlantropa_land = box(6, 6, 7, 7)
        existing_sea = box(0, 0, 2, 10)
        other_water = box(8, 0, 10, 10)
        rows, completion, diagnostics = tno_bundle.build_mediterranean_sea_closure_rows(
            expected_template_geom=template,
            baseline_land_geom=baseline_land,
            atlantropa_land_geom=atlantropa_land,
            existing_sea_geom=existing_sea,
            other_water_geom=other_water,
        )
        self.assertEqual([row["properties"]["id"] for row in rows], ["ATLSEA_FILL_mediterranean_1"])
        self.assertTrue(completion.covers(Point(5, 5)))
        for excluded in [baseline_land, atlantropa_land, existing_sea, other_water]:
            self.assertEqual(completion.intersection(excluded).area, 0)
        self.assertEqual(completion.area, 58)
        self.assertEqual(diagnostics["remaining_hole_area"], 0)
        self.assertEqual(diagnostics["remaining_hole_count"], 0)
        self.assertTrue(shape(rows[0]["geometry"]).equals(completion))

    def test_startup_support_stage_restores_matching_content_addressed_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir, checkpoint_dir = self._write_startup_support_outputs(Path(tmp_dir))
            entry = tno_bundle._build_stage_signature_entry(
                tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                scenario_dir=scenario_dir,
                checkpoint_dir=checkpoint_dir,
            )
            artifact_identity = tno_bundle._admit_startup_support_artifact(
                checkpoint_dir,
                stage_signature=entry["signature"],
            )
            entry["artifact_identity"] = artifact_identity
            output_path = checkpoint_dir / tno_bundle.CHECKPOINT_STARTUP_LOCALES_FILENAME
            output_path.write_bytes(b"drifted")

            with (
                patch.object(tno_bundle, "load_stage_signature", return_value=entry),
                patch.object(tno_bundle, "load_stage_artifact", return_value=artifact_identity),
            ):
                self.assertTrue(
                    tno_bundle._stage_signature_is_current(
                        tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                        scenario_dir=scenario_dir,
                        checkpoint_dir=checkpoint_dir,
                    )
                )
            self.assertEqual(output_path.read_bytes(), b"aa")

    def test_startup_support_stage_rejects_damaged_cache_without_changing_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir, checkpoint_dir = self._write_startup_support_outputs(Path(tmp_dir))
            entry = tno_bundle._build_stage_signature_entry(
                tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                scenario_dir=scenario_dir,
                checkpoint_dir=checkpoint_dir,
            )
            artifact_identity = tno_bundle._admit_startup_support_artifact(
                checkpoint_dir,
                stage_signature=entry["signature"],
            )
            entry["artifact_identity"] = artifact_identity
            output_path = checkpoint_dir / tno_bundle.CHECKPOINT_STARTUP_LOCALES_FILENAME
            output_path.write_bytes(b"checkpoint-drift")
            object_key = next(
                item["sha256"]
                for item in artifact_identity["files"]
                if item["path"] == tno_bundle.CHECKPOINT_STARTUP_LOCALES_FILENAME
            )
            tno_bundle._startup_support_cache(checkpoint_dir)._object_path(object_key).write_bytes(b"cache-drift")

            with (
                patch.object(tno_bundle, "load_stage_signature", return_value=entry),
                patch.object(tno_bundle, "load_stage_artifact", return_value=artifact_identity),
            ):
                self.assertFalse(
                    tno_bundle._stage_signature_is_current(
                        tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                        scenario_dir=scenario_dir,
                        checkpoint_dir=checkpoint_dir,
                    )
                )

            self.assertEqual(output_path.read_bytes(), b"checkpoint-drift")

    def test_startup_support_forward_replace_failure_rolls_back_all_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir, checkpoint_dir = self._write_startup_support_outputs(Path(tmp_dir))
            entry = tno_bundle._build_stage_signature_entry(
                tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                scenario_dir=scenario_dir,
                checkpoint_dir=checkpoint_dir,
            )
            artifact_identity = tno_bundle._admit_startup_support_artifact(
                checkpoint_dir,
                stage_signature=entry["signature"],
            )
            entry["artifact_identity"] = artifact_identity
            filenames = [item["filename"] for item in entry["output_identity"]]
            for index, filename in enumerate(filenames, start=1):
                (checkpoint_dir / filename).write_bytes(f"checkpoint-{index}".encode("utf-8"))
            original_outputs = {
                filename: (checkpoint_dir / filename).read_bytes()
                for filename in filenames
            }
            forward_count = 0

            def fail_second_forward_replace(source: Path, target: Path) -> None:
                nonlocal forward_count
                if Path(source).parent.name == "artifact":
                    forward_count += 1
                    if forward_count == 2:
                        raise OSError("simulated forward replace failure")
                os.replace(source, target)

            with (
                patch.object(tno_bundle, "load_stage_signature", return_value=entry),
                patch.object(tno_bundle, "load_stage_artifact", return_value=artifact_identity),
                patch.object(
                    tno_bundle,
                    "_replace_startup_support_file",
                    side_effect=fail_second_forward_replace,
                ),
            ):
                self.assertFalse(
                    tno_bundle._stage_signature_is_current(
                        tno_bundle.STAGE_STARTUP_SUPPORT_ASSETS,
                        scenario_dir=scenario_dir,
                        checkpoint_dir=checkpoint_dir,
                    )
                )

            self.assertEqual(
                {
                    filename: (checkpoint_dir / filename).read_bytes()
                    for filename in filenames
                },
                original_outputs,
            )

    def _write_startup_support_outputs(self, root: Path) -> tuple[Path, Path]:
        scenario_dir = root / "scenario"
        checkpoint_dir = root / "checkpoint"
        scenario_dir.mkdir(parents=True, exist_ok=True)
        checkpoint_dir.mkdir(parents=True, exist_ok=True)
        for filename, contents in (
            (tno_bundle.CHECKPOINT_RUNTIME_BOOTSTRAP_TOPOLOGY_FILENAME, b"aa"),
            (tno_bundle.CHECKPOINT_STARTUP_LOCALES_FILENAME, b"aa"),
            (tno_bundle.CHECKPOINT_STARTUP_GEO_ALIASES_FILENAME, b"aa"),
        ):
            (checkpoint_dir / filename).write_bytes(contents)
        return scenario_dir, checkpoint_dir


if __name__ == "__main__":
    unittest.main()
