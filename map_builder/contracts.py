"""Shared pipeline and scenario bundle contracts.

This module defines checked-in artifact roles, stage descriptors, and
scenario checkpoint/publish file contracts. It intentionally keeps runtime
paths unchanged and only centralizes policy that was previously duplicated
across entry scripts.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ARTIFACT_CLASS_SOURCE = "source"
ARTIFACT_CLASS_MANUAL = "manual"
ARTIFACT_CLASS_DERIVED = "derived"
ARTIFACT_CLASS_PUBLISH = "publish"
ARTIFACT_CLASS_RUNTIME_CACHE = "runtime-cache"


@dataclass(frozen=True)
class DataArtifactSpec:
    path: str
    role: str
    artifact_class: str
    owner: str
    description: str
    schema_ref: str = ""
    simplification: str = ""
    target_zoom_range: tuple[float, float] | tuple[()] = ()


@dataclass(frozen=True)
class StageDescriptor:
    name: str
    owner: str
    inputs: tuple[str, ...]
    outputs: tuple[str, ...]
    failure_surface: tuple[str, ...]


@dataclass(frozen=True)
class ScenarioCheckpointArtifact:
    state_key: str
    filename: str
    payload_kind: str = "json"


@dataclass(frozen=True)
class ScenarioContractProfile:
    profile_id: str
    gate_mode: str
    expect_runtime_topology: bool
    expect_runtime_bootstrap: bool
    expect_chunk_assets: bool
    expect_startup_assets: bool
    expect_audit: bool
    startup_support_base_topology: str


DATA_ARTIFACT_SPECS: tuple[DataArtifactSpec, ...] = (
    DataArtifactSpec(
        path="europe_topology.json",
        role="primary_topology",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="init_map_data.primary_topology_bundle",
        description="Primary political topology emitted by the coarse GIS pipeline.",
        schema_ref="schema://topology/political_bundle_v1",
        simplification="coarse_publish_v1",
        target_zoom_range=(0.0, 1.7),
    ),
    DataArtifactSpec(
        path="europe_topology.na_v1.json",
        role="detail_topology_na_v1",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="init_map_data.detail_topology",
        description="Legacy North America detail topology checkpoint.",
        schema_ref="schema://topology/detail_political_bundle_v1",
        simplification="detail_publish_legacy_v1",
        target_zoom_range=(1.7, 20.0),
    ),
    DataArtifactSpec(
        path="europe_topology.na_v2.json",
        role="detail_topology_na_v2",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="init_map_data.detail_topology",
        description="Current detail political topology used for runtime enrichment.",
        schema_ref="schema://topology/detail_political_bundle_v2",
        simplification="detail_publish_v2",
        target_zoom_range=(1.7, 20.0),
    ),
    DataArtifactSpec(
        path="europe_topology.runtime_political_v1.json",
        role="runtime_political_topology",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.runtime_political_topology",
        description="Unified runtime political topology consumed by the app and scenarios.",
        schema_ref="schema://topology/runtime_political_v1",
        simplification="runtime_projection_v1",
        target_zoom_range=(1.7, 20.0),
    ),
    DataArtifactSpec(
        path="global_physical_semantics.topo.json",
        role="physical_semantics_topology",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.primary_topology_bundle",
        description="Physical semantics topology shipped with the runtime bundle.",
        schema_ref="schema://topology/physical_semantics_v1",
        simplification="semantic_dissolve_v1",
        target_zoom_range=(0.0, 20.0),
    ),
    DataArtifactSpec(
        path="global_contours.major.topo.json",
        role="terrain_contours_major_topology",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.primary_topology_bundle",
        description="Major contour topology published for runtime relief rendering.",
        schema_ref="schema://topology/terrain_contours_major_v1",
        simplification="contour_major_publish_v1",
        target_zoom_range=(0.0, 20.0),
    ),
    DataArtifactSpec(
        path="global_contours.minor.topo.json",
        role="terrain_contours_minor_topology",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.primary_topology_bundle",
        description="Minor contour topology published for runtime relief rendering.",
        schema_ref="schema://topology/terrain_contours_minor_v1",
        simplification="contour_minor_publish_v1",
        target_zoom_range=(0.0, 20.0),
    ),
    DataArtifactSpec(
        path="hierarchy.json",
        role="hierarchy",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.hierarchy_locales",
        description="Hierarchy and grouping data consumed by scenario and inspector flows.",
    ),
    DataArtifactSpec(
        path="quick_fill/reference/china-pca-2017.json",
        role="quick_fill_china_reference",
        artifact_class=ARTIFACT_CLASS_SOURCE,
        owner="quick_fill_hierarchy",
        description="Pinned administrative code reference, not boundary geometry.",
        schema_ref="schema://quick_fill/china_reference/v1",
    ),
    DataArtifactSpec(
        path="quick_fill/china_prefecture_crosswalk.v1.json",
        role="quick_fill_prefecture_crosswalk",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="quick_fill_hierarchy",
        description="Versioned candidates and unresolved cases for conservative prefecture fill.",
        schema_ref="schema://quick_fill/prefecture_crosswalk/v1",
    ),
    DataArtifactSpec(
        path="geo_aliases.json",
        role="geo_aliases",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.hierarchy_locales",
        description="Canonical geographic alias index.",
    ),
    DataArtifactSpec(
        path="world_cities.geojson",
        role="world_cities",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.world_cities",
        description="Published world city dataset with stable feature links.",
    ),
    DataArtifactSpec(
        path="city_aliases.json",
        role="city_aliases",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.world_cities",
        description="City alias lookup generated from world city build outputs.",
    ),
    DataArtifactSpec(
        path="locales.json",
        role="locales",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.hierarchy_locales",
        description="Published locale bundle for UI and geo labels.",
    ),
    DataArtifactSpec(
        path="country_feature_policies.json",
        role="country_feature_policies",
        artifact_class=ARTIFACT_CLASS_MANUAL,
        owner="data/country_feature_policies.json",
        description="Manual country policy table for subdivision protection and country gate thresholds.",
    ),
    DataArtifactSpec(
        path="runtime_asset_registry.json",
        role="runtime_asset_registry",
        artifact_class=ARTIFACT_CLASS_MANUAL,
        owner="data/runtime_asset_registry.json",
        description="Manual runtime asset registry shared by JS resolvers and build manifest generation.",
    ),
    DataArtifactSpec(
        path="thematic_layers/index.json",
        role="thematic_layer_catalog",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_thematic_layers",
        description="Catalog for checked-in thematic layer manifests and fixture-only foundation layers.",
        schema_ref="schema://thematic/layer_index/v1",
    ),
    DataArtifactSpec(
        path="thematic_layers/source_recipes/wgi_state_capacity.manual.json",
        role="thematic_source_recipe",
        artifact_class=ARTIFACT_CLASS_MANUAL,
        owner="tools.build_thematic_layers",
        description="Manual source recipe for future WGI-derived governance proxy thematic layers.",
    ),
    DataArtifactSpec(
        path="thematic_layers/source_recipes/wgi_state_capacity_v1.manual.json",
        role="thematic_source_recipe",
        artifact_class=ARTIFACT_CLASS_MANUAL,
        owner="tools.build_thematic_layers",
        description="Cache-only source recipe for the WGI 2025 governance proxy thematic layer.",
    ),
    DataArtifactSpec(
        path="thematic_layers/source_recipes/undp_hdi.manual.json",
        role="thematic_source_recipe",
        artifact_class=ARTIFACT_CLASS_MANUAL,
        owner="tools.build_thematic_layers",
        description="Manual source recipe for future UNDP HDI-derived thematic layers.",
    ),
    DataArtifactSpec(
        path="thematic_layers/source_recipes/population_density_grid.manual.json",
        role="thematic_source_recipe",
        artifact_class=ARTIFACT_CLASS_MANUAL,
        owner="tools.build_thematic_layers",
        description="Manual source recipe for future population-density grid thematic layers.",
    ),
    DataArtifactSpec(
        path="thematic_layers/political/state_capacity_demo/manifest.json",
        role="thematic_layer_manifest",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_thematic_layers",
        description="Fixture-only admin0 state capacity thematic layer manifest.",
        schema_ref="schema://thematic/layer_manifest/v1",
    ),
    DataArtifactSpec(
        path="thematic_layers/political/state_capacity_demo/metrics.admin0.json",
        role="thematic_admin_metrics",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_thematic_layers",
        description="Fixture-only admin0 state capacity metric values.",
        schema_ref="schema://thematic/admin_metrics/v1",
    ),
    DataArtifactSpec(
        path="thematic_layers/political/state_capacity_demo/build_audit.json",
        role="thematic_build_audit",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_thematic_layers",
        description="Build audit for fixture-only state capacity thematic layer.",
        schema_ref="schema://thematic/build_audit/v1",
    ),
    DataArtifactSpec(
        path="thematic_layers/political/wgi_state_capacity_v1/manifest.json",
        role="thematic_layer_manifest",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_thematic_layers",
        description="World Bank WGI 2025 admin0 governance proxy thematic layer manifest.",
        schema_ref="schema://thematic/layer_manifest/v1",
    ),
    DataArtifactSpec(
        path="thematic_layers/political/wgi_state_capacity_v1/metrics.admin0.json",
        role="thematic_admin_metrics",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_thematic_layers",
        description="World Bank WGI 2024 admin0 official dimension scores and project-defined proxy scores.",
        schema_ref="schema://thematic/admin_metrics/v1",
    ),
    DataArtifactSpec(
        path="thematic_layers/political/wgi_state_capacity_v1/build_audit.json",
        role="thematic_build_audit",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_thematic_layers",
        description="Build audit for the World Bank WGI governance proxy thematic layer.",
        schema_ref="schema://thematic/build_audit/v1",
    ),
    DataArtifactSpec(
        path="thematic_layers/social/human_development_demo/manifest.json",
        role="thematic_layer_manifest",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_thematic_layers",
        description="Fixture-only admin0 human development thematic layer manifest.",
        schema_ref="schema://thematic/layer_manifest/v1",
    ),
    DataArtifactSpec(
        path="thematic_layers/social/human_development_demo/metrics.admin0.json",
        role="thematic_admin_metrics",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_thematic_layers",
        description="Fixture-only admin0 human development metric values.",
        schema_ref="schema://thematic/admin_metrics/v1",
    ),
    DataArtifactSpec(
        path="thematic_layers/social/human_development_demo/build_audit.json",
        role="thematic_build_audit",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_thematic_layers",
        description="Build audit for fixture-only human development thematic layer.",
        schema_ref="schema://thematic/build_audit/v1",
    ),
    DataArtifactSpec(
        path="thematic_layers/population/population_density_demo/manifest.json",
        role="thematic_layer_manifest",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_thematic_layers",
        description="Fixture-only 720x360 population-density thematic layer manifest.",
        schema_ref="schema://thematic/layer_manifest/v1",
    ),
    DataArtifactSpec(
        path="thematic_layers/population/population_density_demo/grid.rle.json",
        role="thematic_grid_rle",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_thematic_layers",
        description="Fixture-only 720x360 population-density RLE grid.",
        schema_ref="schema://thematic/grid_rle/v1",
    ),
    DataArtifactSpec(
        path="thematic_layers/population/population_density_demo/build_audit.json",
        role="thematic_build_audit",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_thematic_layers",
        description="Build audit for fixture-only population-density thematic layer.",
        schema_ref="schema://thematic/build_audit/v1",
    ),
    DataArtifactSpec(
        path="palettes/index.json",
        role="palette_registry",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.palette_assets",
        description="Palette registry exposed to runtime and scenario builders.",
    ),
    DataArtifactSpec(
        path="palettes/hoi4_vanilla.palette.json",
        role="palette_pack",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.palette_assets",
        description="HOI4 vanilla palette pack.",
    ),
    DataArtifactSpec(
        path="palettes/kaiserreich.palette.json",
        role="palette_pack",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.palette_assets",
        description="Kaiserreich palette pack.",
    ),
    DataArtifactSpec(
        path="palettes/tno.palette.json",
        role="palette_pack",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.palette_assets",
        description="TNO palette pack.",
    ),
    DataArtifactSpec(
        path="palettes/red_flood.palette.json",
        role="palette_pack",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.palette_assets",
        description="Red Flood palette pack.",
    ),
    DataArtifactSpec(
        path="palettes/hgo.palette.json",
        role="palette_pack",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.palette_assets",
        description="Historic Geographical Overhaul palette pack.",
    ),
    DataArtifactSpec(
        path="palette-maps/hoi4_vanilla.map.json",
        role="palette_map",
        artifact_class=ARTIFACT_CLASS_MANUAL,
        owner="tools.import_country_palette",
        description="Manual mapping layer for HOI4 vanilla palette import.",
    ),
    DataArtifactSpec(
        path="palette-maps/kaiserreich.map.json",
        role="palette_map",
        artifact_class=ARTIFACT_CLASS_MANUAL,
        owner="tools.import_country_palette",
        description="Manual mapping layer for Kaiserreich palette import.",
    ),
    DataArtifactSpec(
        path="palette-maps/tno.map.json",
        role="palette_map",
        artifact_class=ARTIFACT_CLASS_MANUAL,
        owner="tools.import_country_palette",
        description="Manual mapping layer for TNO palette import.",
    ),
    DataArtifactSpec(
        path="palette-maps/red_flood.map.json",
        role="palette_map",
        artifact_class=ARTIFACT_CLASS_MANUAL,
        owner="tools.import_country_palette",
        description="Manual mapping layer for Red Flood palette import.",
    ),
    DataArtifactSpec(
        path="palette-maps/hgo.map.json",
        role="palette_map",
        artifact_class=ARTIFACT_CLASS_MANUAL,
        owner="tools.import_country_palette",
        description="Catalog-only mapping layer for Historic Geographical Overhaul palette import.",
    ),
    DataArtifactSpec(
        path="palette-maps/hoi4_vanilla.audit.json",
        role="palette_audit",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="init_map_data.palette_assets",
        description="Generated audit for HOI4 vanilla palette mapping coverage.",
    ),
    DataArtifactSpec(
        path="palette-maps/kaiserreich.audit.json",
        role="palette_audit",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="init_map_data.palette_assets",
        description="Generated audit for Kaiserreich palette mapping coverage.",
    ),
    DataArtifactSpec(
        path="palette-maps/tno.audit.json",
        role="palette_audit",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="init_map_data.palette_assets",
        description="Generated audit for TNO palette mapping coverage.",
    ),
    DataArtifactSpec(
        path="palette-maps/red_flood.audit.json",
        role="palette_audit",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="init_map_data.palette_assets",
        description="Generated audit for Red Flood palette mapping coverage.",
    ),
    DataArtifactSpec(
        path="palette-maps/hgo.audit.json",
        role="palette_audit",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="init_map_data.palette_assets",
        description="Generated audit for Historic Geographical Overhaul palette mapping coverage.",
    ),
    # HGO catalog 拆成三层：总索引负责能力发现，place names / flags index 保留源语义，
    # PNG manifest 只描述已授权、已转换、可随 Pages 分发的图片产物。
    DataArtifactSpec(
        path="hgo_catalogs/index.json",
        role="hgo_tier_a_catalog",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_hgo_flag_index",
        description="Historic Geographical Overhaul Tier-A catalog index.",
    ),
    DataArtifactSpec(
        path="hgo_catalogs/hgo_place_names.json",
        role="hgo_place_names",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_hgo_name_catalog",
        description="Historic Geographical Overhaul reusable place-name catalog.",
    ),
    DataArtifactSpec(
        path="hgo_catalogs/hgo_flags.index.json",
        role="hgo_flags_index",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_hgo_flag_index",
        description="Historic Geographical Overhaul source-only flag index.",
    ),
    DataArtifactSpec(
        path="hgo_catalogs/hgo_flags.png_manifest.json",
        role="hgo_flags_png_manifest",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_hgo_flag_png_catalog",
        description="Historic Geographical Overhaul authorized converted flag PNG manifest.",
    ),
    DataArtifactSpec(
        path="hgo_catalogs/hgo_identity_aliases.json",
        role="hgo_identity_aliases",
        artifact_class=ARTIFACT_CLASS_MANUAL,
        owner="hgo_identity_aliases.manual_review",
        description="Historic Geographical Overhaul manually reviewed identity alias catalog.",
    ),
    DataArtifactSpec(
        path="hgo_runtime/manifest.json",
        role="hgo_runtime_manifest",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_hgo_runtime_assets",
        description="Historic Geographical Overhaul independent runtime asset manifest.",
        schema_ref="schema://hgo/runtime_manifest/v1",
    ),
    DataArtifactSpec(
        path="hgo_runtime/seed.json",
        role="hgo_runtime_seed",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_hgo_runtime_assets",
        description="Historic Geographical Overhaul independent runtime seed built from mod source.",
        schema_ref="schema://hgo/runtime_seed/v1",
    ),
    DataArtifactSpec(
        path="hgo_runtime/provinces.bmp",
        role="hgo_runtime_raster",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="tools.build_hgo_runtime_assets",
        description="Historic Geographical Overhaul province-color raster used by the independent runtime preview.",
        schema_ref="schema://bitmap/bmp_rgb24/v1",
    ),
    DataArtifactSpec(
        path="js/core/city_lights_modern_asset.js",
        role="modern_city_lights_asset",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.city_lights_assets",
        description="Generated modern city lights runtime asset.",
    ),
    DataArtifactSpec(
        path="js/core/city_lights_historical_1930_asset.js",
        role="historical_1930_city_lights_asset",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.city_lights_assets",
        description="Generated 1930 historical city lights runtime asset.",
    ),
)

DATA_ARTIFACT_ROLE_BY_PATH = {spec.path: spec.role for spec in DATA_ARTIFACT_SPECS}
DATA_ARTIFACT_SPECS_BY_PATH = {spec.path: spec for spec in DATA_ARTIFACT_SPECS}

INIT_MAP_DATA_STAGE_DESCRIPTORS: tuple[StageDescriptor, ...] = (
    StageDescriptor(
        name="primary_topology_bundle",
        owner="init_map_data.py",
        inputs=("raw geodata sources", "processor rules", "physical context config"),
        outputs=("europe_topology.json", "physical context publish artifacts"),
        failure_surface=("invalid source geometry", "topology contract drift"),
    ),
    StageDescriptor(
        name="detail_topology",
        owner="init_map_data.py",
        inputs=("europe_topology.json", "detail patch scripts"),
        outputs=("europe_topology.na_v2.json",),
        failure_surface=("detail bundle build failure", "country gate regression"),
    ),
    StageDescriptor(
        name="runtime_political_topology",
        owner="init_map_data.py",
        inputs=("europe_topology.json", "europe_topology.na_v2.json", "override collections"),
        outputs=("europe_topology.runtime_political_v1.json",),
        failure_surface=("runtime political id drift", "shell coverage regression"),
    ),
    StageDescriptor(
        name="hierarchy_locales",
        owner="map_builder/hierarchy_locale_stage.py",
        inputs=("runtime political topology", "scenario roots", "locale sync rules"),
        outputs=("hierarchy.json", "geo_aliases.json", "locales.json"),
        failure_surface=("missing runtime ids", "translation sync drift"),
    ),
    StageDescriptor(
        name="palette_assets",
        owner="init_map_data.py",
        inputs=("primary/runtime topology", "HOI4 family source roots", "manual palette maps"),
        outputs=("palettes/*.json", "palette-maps/*.json"),
        failure_surface=("missing source root", "palette coverage drift"),
    ),
    StageDescriptor(
        name="world_cities",
        owner="init_map_data.py",
        inputs=("runtime political topology", "city source datasets"),
        outputs=("world_cities.geojson", "city_aliases.json"),
        failure_surface=("duplicate city ids", "missing political feature links"),
    ),
    StageDescriptor(
        name="city_lights_assets",
        owner="init_map_data.py",
        inputs=("world_cities.geojson",),
        outputs=("js/core/city_lights_modern_asset.js", "js/core/city_lights_historical_1930_asset.js"),
        failure_surface=("missing city dataset", "asset regeneration failure"),
    ),
    StageDescriptor(
        name="derived_hoi4_assets",
        owner="init_map_data.py",
        inputs=("runtime topology", "scenario rules", "HOI4/TNO source roots"),
        outputs=("data/scenarios/hoi4_*", "data/scenarios/tno_1962", "data/releasables/*.json"),
        failure_surface=("scenario builder failure", "scenario contract drift"),
    ),
    StageDescriptor(
        name="manifest",
        owner="init_map_data.py",
        inputs=("published pipeline outputs",),
        outputs=("data/manifest.json",),
        failure_surface=("missing contract spec", "inspection parse failure"),
    ),
    StageDescriptor(
        name="validation",
        owner="init_map_data.py",
        inputs=("published pipeline outputs", "dependent scenario assets"),
        outputs=("validation warnings/errors",),
        failure_surface=("strict contract regression", "runtime/topology drift"),
    ),
)

SCENARIO_BUNDLE_STAGE_DESCRIPTORS: tuple[StageDescriptor, ...] = (
    StageDescriptor(
        name="countries",
        owner="tools/patch_tno_1962_bundle.py",
        inputs=("scenario dir", "runtime topology", "manual rule packs"),
        outputs=("country state checkpoint artifacts",),
        failure_surface=("ownership/controller/core drift", "manual override mismatch"),
    ),
    StageDescriptor(
        name="water_state",
        owner="tools/patch_tno_1962_bundle.py",
        inputs=("countries stage checkpoints", "named water snapshot sources", "runtime topology donor roots"),
        outputs=("water state checkpoint artifacts",),
        failure_surface=("water geometry validation failure", "named-water snapshot drift"),
    ),
    StageDescriptor(
        name="water_runtime_from_scenario",
        owner="tools/patch_tno_1962_bundle.py",
        inputs=("checked-in water regions", "checked-in runtime topology"),
        outputs=("water runtime checkpoint artifacts",),
        failure_surface=("published water/runtime divergence", "chunk asset regeneration failure"),
    ),
    StageDescriptor(
        name="runtime_topology",
        owner="tools/patch_tno_1962_bundle.py",
        inputs=("countries stage checkpoints", "water state checkpoints"),
        outputs=("runtime topology checkpoint bundle",),
        failure_surface=("runtime topology validation failure", "water/special region divergence"),
    ),
    StageDescriptor(
        name="geo_locale",
        owner="tools/patch_tno_1962_bundle.py",
        inputs=("runtime topology checkpoints", "manual geo overrides"),
        outputs=("geo locale checkpoint variants",),
        failure_surface=("manual override mismatch", "geo locale variant drift"),
    ),
    StageDescriptor(
        name="startup_assets",
        owner="tools/patch_tno_1962_bundle.py",
        inputs=("geo locale checkpoints", "runtime topology checkpoints", "startup bundle sources"),
        outputs=("startup bootstrap topology", "startup bundles"),
        failure_surface=("startup bootstrap drift", "startup bundle build failure"),
    ),
    StageDescriptor(
        name="write_bundle",
        owner="tools/patch_tno_1962_bundle.py",
        inputs=("checkpoint bundle", "publish scope", "manual sync policy"),
        outputs=("published scenario bundle",),
        failure_surface=("strict publish validation failure", "unsynced manual edits"),
    ),
    StageDescriptor(
        name="chunk_assets",
        owner="tools/patch_tno_1962_bundle.py",
        inputs=("published scenario bundle", "chunk manifest sources"),
        outputs=("published scenario chunk assets",),
        failure_surface=("missing published bundle dependency", "chunk asset regeneration failure"),
    ),
)

SCENARIO_PUBLISH_SCOPE_POLAR_RUNTIME = "polar_runtime"
SCENARIO_PUBLISH_SCOPE_SCENARIO_DATA = "scenario_data"
SCENARIO_PUBLISH_SCOPE_ALL = "all"
SCENARIO_PUBLISH_SCOPES = (
    SCENARIO_PUBLISH_SCOPE_POLAR_RUNTIME,
    SCENARIO_PUBLISH_SCOPE_SCENARIO_DATA,
    SCENARIO_PUBLISH_SCOPE_ALL,
)

SCENARIO_CHECKPOINT_STAGE_METADATA_FILENAME = "stage_metadata.json"
SCENARIO_CHECKPOINT_WATER_STAGE_METADATA_FILENAME = "water_stage_metadata.json"
SCENARIO_BUILD_SNAPSHOT_FILENAME = "build_snapshot.json"
SCENARIO_CONTRACT_VERSION = "2026-05-01.v1"
SCENARIO_BUILDER_VERSION = "scenario-data-governance-v1"
SCENARIO_CHECKPOINT_POLITICAL_FILENAME = "scenario_political.geojson"
SCENARIO_CHECKPOINT_WATER_SEED_FILENAME = "scenario_water_seed.geojson"
SCENARIO_CHECKPOINT_WATER_FILENAME = "water_regions.geojson"
SCENARIO_CHECKPOINT_RELIEF_FILENAME = "relief_overlays.geojson"
SCENARIO_CHECKPOINT_BATHYMETRY_FILENAME = "bathymetry.topo.json"
SCENARIO_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME = "runtime_topology.bootstrap.topo.json"
SCENARIO_CHECKPOINT_ATLANTROPA_TOPOLOGY_FILENAME = "scenario_atlantropa.topo.json"
SCENARIO_CHECKPOINT_ATLANTROPA_METADATA_FILENAME = "scenario_atlantropa_metadata.json"
SCENARIO_CHECKPOINT_GEO_LOCALE_FILENAME = "geo_locale_patch.json"
SCENARIO_CHECKPOINT_GEO_LOCALE_EN_FILENAME = "geo_locale_patch.en.json"
SCENARIO_CHECKPOINT_GEO_LOCALE_ZH_FILENAME = "geo_locale_patch.zh.json"
SCENARIO_CHECKPOINT_STARTUP_LOCALES_FILENAME = "locales.startup.json"
SCENARIO_CHECKPOINT_STARTUP_GEO_ALIASES_FILENAME = "geo_aliases.startup.json"
SCENARIO_CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME = "startup.bundle.en.json"
SCENARIO_CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME = "startup.bundle.zh.json"
SCENARIO_STRATEGIC_VALUES_FILENAME = "strategic_values.by_feature.json"
SCENARIO_LOCALE_LANGUAGES = ("en", "zh")
SCENARIO_GEO_LOCALE_PATCH_MANIFEST_FIELD = "geo_locale_patch_url"
SCENARIO_GEO_LOCALE_PATCH_MANIFEST_LANGUAGE_FIELDS = {
    "en": "geo_locale_patch_url_en",
    "zh": "geo_locale_patch_url_zh",
}
SCENARIO_STARTUP_BUNDLE_MANIFEST_LANGUAGE_FIELDS = {
    "en": "startup_bundle_url_en",
    "zh": "startup_bundle_url_zh",
}
SCENARIO_GEO_LOCALE_PATCH_FILENAMES_BY_LANGUAGE = {
    "en": SCENARIO_CHECKPOINT_GEO_LOCALE_EN_FILENAME,
    "zh": SCENARIO_CHECKPOINT_GEO_LOCALE_ZH_FILENAME,
}
SCENARIO_STARTUP_BUNDLE_FILENAMES_BY_LANGUAGE = {
    "en": SCENARIO_CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME,
    "zh": SCENARIO_CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME,
}
SCENARIO_CHECKPOINT_LAND_MASK_FILENAME = "land_mask.geojson"
SCENARIO_CHECKPOINT_CONTEXT_LAND_MASK_FILENAME = "context_land_mask.geojson"
SCENARIO_CHECKPOINT_NAMED_WATER_SNAPSHOT_FILENAME = "derived/marine_regions_named_waters.snapshot.geojson"
SCENARIO_CHECKPOINT_WATER_REGIONS_PROVENANCE_FILENAME = "derived/water_regions.provenance.json"
SCENARIO_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME = "runtime_topology.topo.json"

SCENARIO_COUNTRIES_STAGE_ARTIFACTS: tuple[ScenarioCheckpointArtifact, ...] = (
    ScenarioCheckpointArtifact("countries_payload", "countries.json"),
    ScenarioCheckpointArtifact("owners_payload", "owners.by_feature.json"),
    ScenarioCheckpointArtifact("cores_payload", "cores.by_feature.json"),
    ScenarioCheckpointArtifact("manifest_payload", "manifest.json"),
    ScenarioCheckpointArtifact("audit_payload", "audit.json"),
    ScenarioCheckpointArtifact("stage_metadata", SCENARIO_CHECKPOINT_STAGE_METADATA_FILENAME),
    ScenarioCheckpointArtifact("scenario_political_gdf", SCENARIO_CHECKPOINT_POLITICAL_FILENAME, payload_kind="gdf"),
)

SCENARIO_WATER_STAGE_ARTIFACTS: tuple[ScenarioCheckpointArtifact, ...] = (
    ScenarioCheckpointArtifact("water_stage_metadata", SCENARIO_CHECKPOINT_WATER_STAGE_METADATA_FILENAME),
    ScenarioCheckpointArtifact("water_gdf", SCENARIO_CHECKPOINT_WATER_SEED_FILENAME, payload_kind="gdf"),
    ScenarioCheckpointArtifact("relief_overlays_payload", SCENARIO_CHECKPOINT_RELIEF_FILENAME),
    ScenarioCheckpointArtifact("bathymetry_payload", SCENARIO_CHECKPOINT_BATHYMETRY_FILENAME),
    ScenarioCheckpointArtifact("named_water_snapshot_payload", SCENARIO_CHECKPOINT_NAMED_WATER_SNAPSHOT_FILENAME),
    ScenarioCheckpointArtifact("water_regions_provenance_payload", SCENARIO_CHECKPOINT_WATER_REGIONS_PROVENANCE_FILENAME),
    ScenarioCheckpointArtifact("land_mask_gdf", SCENARIO_CHECKPOINT_LAND_MASK_FILENAME, payload_kind="gdf"),
    ScenarioCheckpointArtifact("context_land_mask_gdf", SCENARIO_CHECKPOINT_CONTEXT_LAND_MASK_FILENAME, payload_kind="gdf"),
)

SCENARIO_RUNTIME_STAGE_EXTRA_ARTIFACTS: tuple[ScenarioCheckpointArtifact, ...] = (
    ScenarioCheckpointArtifact("runtime_special_regions", "special_regions.geojson"),
    ScenarioCheckpointArtifact("special_zone_layers_payload", "special_zone_layers.json"),
    ScenarioCheckpointArtifact("runtime_water_regions", SCENARIO_CHECKPOINT_WATER_FILENAME),
    ScenarioCheckpointArtifact("runtime_topology_payload", SCENARIO_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME),
    ScenarioCheckpointArtifact("scenario_atlantropa_topology_payload", SCENARIO_CHECKPOINT_ATLANTROPA_TOPOLOGY_FILENAME),
    ScenarioCheckpointArtifact("scenario_atlantropa_metadata_payload", SCENARIO_CHECKPOINT_ATLANTROPA_METADATA_FILENAME),
)

SCENARIO_OPTIONAL_RUNTIME_STAGE_ARTIFACTS: tuple[ScenarioCheckpointArtifact, ...] = ()

# 下面这些 stage artifact 列表和 patch_tno_1962_bundle.py 的阶段顺序一一对应。
# builder / checker / snapshot 只要都依赖这里，新增或删除 checkpoint 文件时就不会各改各的。
SCENARIO_GEO_LOCALE_STAGE_ARTIFACTS: tuple[ScenarioCheckpointArtifact, ...] = (
    ScenarioCheckpointArtifact("geo_locale_payload", SCENARIO_CHECKPOINT_GEO_LOCALE_FILENAME),
    ScenarioCheckpointArtifact("geo_locale_payload_en", SCENARIO_CHECKPOINT_GEO_LOCALE_EN_FILENAME),
    ScenarioCheckpointArtifact("geo_locale_payload_zh", SCENARIO_CHECKPOINT_GEO_LOCALE_ZH_FILENAME),
)

SCENARIO_STARTUP_SUPPORT_STAGE_ARTIFACTS: tuple[ScenarioCheckpointArtifact, ...] = (
    ScenarioCheckpointArtifact(
        "runtime_bootstrap_topology_payload",
        SCENARIO_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME,
    ),
    ScenarioCheckpointArtifact("startup_locales_payload", SCENARIO_CHECKPOINT_STARTUP_LOCALES_FILENAME),
    ScenarioCheckpointArtifact("startup_geo_aliases_payload", SCENARIO_CHECKPOINT_STARTUP_GEO_ALIASES_FILENAME),
)

SCENARIO_STARTUP_BUNDLE_STAGE_ARTIFACTS: tuple[ScenarioCheckpointArtifact, ...] = (
    ScenarioCheckpointArtifact("startup_bundle_payload_en", SCENARIO_CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME),
    ScenarioCheckpointArtifact("startup_bundle_payload_zh", SCENARIO_CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME),
)

SCENARIO_STARTUP_STAGE_ARTIFACTS: tuple[ScenarioCheckpointArtifact, ...] = (
    *SCENARIO_STARTUP_SUPPORT_STAGE_ARTIFACTS,
    *SCENARIO_STARTUP_BUNDLE_STAGE_ARTIFACTS,
)

SCENARIO_CHUNK_STAGE_REQUIRED_FILENAMES = (
    "manifest.json",
    SCENARIO_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME,
    SCENARIO_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME,
)

SCENARIO_PUBLISH_FILENAMES_BY_SCOPE = {
    # 这里描述的是 scenario 目录 publish contract。
    # Pages dist 可以在后续构建里继续裁剪，所以它和 build_pages_dist.py 的最终发布集合不是同一回事。
    SCENARIO_PUBLISH_SCOPE_POLAR_RUNTIME: (
        SCENARIO_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME,
    ),
    SCENARIO_PUBLISH_SCOPE_SCENARIO_DATA: (
        "countries.json",
        "owners.by_feature.json",
        "cores.by_feature.json",
        "manifest.json",
        "audit.json",
        "special_regions.geojson",
        "special_zone_layers.json",
        "city_overrides.json",
        "capital_hints.json",
        SCENARIO_STRATEGIC_VALUES_FILENAME,
        SCENARIO_CHECKPOINT_WATER_FILENAME,
        SCENARIO_CHECKPOINT_RELIEF_FILENAME,
        SCENARIO_CHECKPOINT_BATHYMETRY_FILENAME,
        SCENARIO_CHECKPOINT_NAMED_WATER_SNAPSHOT_FILENAME,
        SCENARIO_CHECKPOINT_WATER_REGIONS_PROVENANCE_FILENAME,
        SCENARIO_CHECKPOINT_ATLANTROPA_TOPOLOGY_FILENAME,
        SCENARIO_CHECKPOINT_ATLANTROPA_METADATA_FILENAME,
        SCENARIO_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME,
        SCENARIO_CHECKPOINT_GEO_LOCALE_FILENAME,
        SCENARIO_CHECKPOINT_GEO_LOCALE_EN_FILENAME,
        SCENARIO_CHECKPOINT_GEO_LOCALE_ZH_FILENAME,
        SCENARIO_CHECKPOINT_STARTUP_LOCALES_FILENAME,
        SCENARIO_CHECKPOINT_STARTUP_GEO_ALIASES_FILENAME,
        SCENARIO_CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME,
        SCENARIO_CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME,
    ),
}
SCENARIO_PUBLISH_FILENAMES_BY_SCOPE[SCENARIO_PUBLISH_SCOPE_ALL] = (
    *SCENARIO_PUBLISH_FILENAMES_BY_SCOPE[SCENARIO_PUBLISH_SCOPE_SCENARIO_DATA],
    *SCENARIO_PUBLISH_FILENAMES_BY_SCOPE[SCENARIO_PUBLISH_SCOPE_POLAR_RUNTIME],
)

SCENARIO_STRICT_REQUIRED_FILENAMES = (
    "manifest.json",
    "owners.by_feature.json",
    "cores.by_feature.json",
    SCENARIO_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME,
)

SCENARIO_PROFILE_TNO_FULL = ScenarioContractProfile(
    profile_id="tno_full",
    gate_mode="hard",
    expect_runtime_topology=True,
    expect_runtime_bootstrap=True,
    expect_chunk_assets=True,
    expect_startup_assets=True,
    expect_audit=True,
    startup_support_base_topology="data/europe_topology.na_v2.json",
)
SCENARIO_PROFILE_HOI4_CHUNKED = ScenarioContractProfile(
    profile_id="hoi4_chunked",
    gate_mode="shadow",
    expect_runtime_topology=True,
    expect_runtime_bootstrap=True,
    expect_chunk_assets=True,
    expect_startup_assets=True,
    expect_audit=True,
    startup_support_base_topology="data/europe_topology.json",
)
SCENARIO_PROFILE_LIGHTWEIGHT_BASE = ScenarioContractProfile(
    profile_id="lightweight_base",
    gate_mode="shadow",
    expect_runtime_topology=True,
    expect_runtime_bootstrap=False,
    expect_chunk_assets=False,
    expect_startup_assets=False,
    expect_audit=True,
    startup_support_base_topology="data/europe_topology.json",
)
SCENARIO_PROFILE_HGO_VECTOR = ScenarioContractProfile(
    profile_id="hgo_vector",
    gate_mode="shadow",
    expect_runtime_topology=True,
    expect_runtime_bootstrap=False,
    expect_chunk_assets=False,
    expect_startup_assets=False,
    expect_audit=True,
    startup_support_base_topology="data/europe_topology.json",
)


def resolve_scenario_publish_filenames(scope: str) -> tuple[str, ...]:
    # publish scope 是 scenario builder 和 strict checker 的共同入口；新增 scope 时先补这里的文件集合。
    if scope not in SCENARIO_PUBLISH_FILENAMES_BY_SCOPE:
        raise ValueError(f"Unsupported publish scope: {scope}")
    return SCENARIO_PUBLISH_FILENAMES_BY_SCOPE[scope]


def normalize_scenario_contract_tag(raw_value: object) -> str:
    # contract tag 进入 snapshot fingerprint 前先收敛成稳定 ID，避免大小写或符号差异制造伪漂移。
    text = "".join(ch for ch in str(raw_value or "").strip().upper() if ch.isalnum())
    return text


def resolve_scenario_contract_profile(scenario_id: str) -> ScenarioContractProfile:
    normalized = str(scenario_id or "").strip().lower()
    # profile 决定 strict checker 对一个 scenario 期待哪些产物。
    # 这里保持“按 scenario 家族分合同”，这样 builder 和 checker 可以共用同一套分流规则。
    if normalized == "tno_1962":
        return SCENARIO_PROFILE_TNO_FULL
    if normalized.startswith("hgo_"):
        return SCENARIO_PROFILE_HGO_VECTOR
    if normalized.startswith("hoi4_"):
        return SCENARIO_PROFILE_HOI4_CHUNKED
    if normalized in {"blank_base", "modern_world"}:
        return SCENARIO_PROFILE_LIGHTWEIGHT_BASE
    return SCENARIO_PROFILE_LIGHTWEIGHT_BASE


def sha256_json_stable(payload: object) -> str:
    stable_json = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(stable_json.encode("utf-8")).hexdigest()


def sha256_path(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_scenario_snapshot_payload(
    *,
    scenario_id: str,
    profile_id: str,
    input_sha: dict[str, str],
    output_sha: dict[str, str],
    feature_count: int,
    water_count: int,
    chunk_count: int,
    generated_at: str,
    environment: dict[str, object] | None = None,
    durations: dict[str, object] | None = None,
    report_paths: dict[str, object] | None = None,
    contract_version: str = SCENARIO_CONTRACT_VERSION,
    builder_version: str = SCENARIO_BUILDER_VERSION,
) -> dict[str, object]:
    # snapshot_fingerprint 只吃稳定输入/输出摘要，不把生成时间这类易漂移字段算进去。
    stable_payload = {
        "scenario_id": scenario_id,
        "profile": profile_id,
        "contract_version": contract_version,
        "builder_version": builder_version,
        "input_sha": dict(sorted((input_sha or {}).items())),
        "output_sha": dict(sorted((output_sha or {}).items())),
        "feature_count": int(feature_count),
        "water_count": int(water_count),
        "chunk_count": int(chunk_count),
    }
    snapshot_fingerprint = sha256_json_stable(stable_payload)
    return {
        **stable_payload,
        "snapshot_fingerprint": snapshot_fingerprint,
        "generated_at": generated_at,
        "environment": environment or {},
        "durations": durations or {},
        "report_paths": report_paths or {},
    }
