"""Shared pipeline and scenario bundle contracts.

This module defines checked-in artifact roles, stage descriptors, and
scenario checkpoint/publish file contracts. It intentionally keeps runtime
paths unchanged and only centralizes policy that was previously duplicated
across entry scripts.
"""

from __future__ import annotations

from dataclasses import dataclass

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


DATA_ARTIFACT_SPECS: tuple[DataArtifactSpec, ...] = (
    DataArtifactSpec(
        path="europe_topology.json",
        role="primary_topology",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="init_map_data.primary_topology_bundle",
        description="Primary political topology emitted by the coarse GIS pipeline.",
    ),
    DataArtifactSpec(
        path="europe_topology.na_v1.json",
        role="detail_topology_na_v1",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="init_map_data.detail_topology",
        description="Legacy North America detail topology checkpoint.",
    ),
    DataArtifactSpec(
        path="europe_topology.na_v2.json",
        role="detail_topology_na_v2",
        artifact_class=ARTIFACT_CLASS_DERIVED,
        owner="init_map_data.detail_topology",
        description="Current detail political topology used for runtime enrichment.",
    ),
    DataArtifactSpec(
        path="europe_topology.runtime_political_v1.json",
        role="runtime_political_topology",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.runtime_political_topology",
        description="Unified runtime political topology consumed by the app and scenarios.",
    ),
    DataArtifactSpec(
        path="global_physical_semantics.topo.json",
        role="physical_semantics_topology",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.primary_topology_bundle",
        description="Physical semantics topology shipped with the runtime bundle.",
    ),
    DataArtifactSpec(
        path="global_contours.major.topo.json",
        role="terrain_contours_major_topology",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.primary_topology_bundle",
        description="Major contour topology published for runtime relief rendering.",
    ),
    DataArtifactSpec(
        path="global_contours.minor.topo.json",
        role="terrain_contours_minor_topology",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.primary_topology_bundle",
        description="Minor contour topology published for runtime relief rendering.",
    ),
    DataArtifactSpec(
        path="hierarchy.json",
        role="hierarchy",
        artifact_class=ARTIFACT_CLASS_PUBLISH,
        owner="init_map_data.hierarchy_locales",
        description="Hierarchy and grouping data consumed by scenario and inspector flows.",
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
        owner="init_map_data.py",
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
SCENARIO_CHECKPOINT_POLITICAL_FILENAME = "scenario_political.geojson"
SCENARIO_CHECKPOINT_WATER_SEED_FILENAME = "scenario_water_seed.geojson"
SCENARIO_CHECKPOINT_WATER_FILENAME = "water_regions.geojson"
SCENARIO_CHECKPOINT_RELIEF_FILENAME = "relief_overlays.geojson"
SCENARIO_CHECKPOINT_BATHYMETRY_FILENAME = "bathymetry.topo.json"
SCENARIO_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME = "runtime_topology.bootstrap.topo.json"
SCENARIO_CHECKPOINT_GEO_LOCALE_FILENAME = "geo_locale_patch.json"
SCENARIO_CHECKPOINT_GEO_LOCALE_EN_FILENAME = "geo_locale_patch.en.json"
SCENARIO_CHECKPOINT_GEO_LOCALE_ZH_FILENAME = "geo_locale_patch.zh.json"
SCENARIO_CHECKPOINT_STARTUP_LOCALES_FILENAME = "locales.startup.json"
SCENARIO_CHECKPOINT_STARTUP_GEO_ALIASES_FILENAME = "geo_aliases.startup.json"
SCENARIO_CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME = "startup.bundle.en.json"
SCENARIO_CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME = "startup.bundle.zh.json"
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
    ScenarioCheckpointArtifact("controllers_payload", "controllers.by_feature.json"),
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
    ScenarioCheckpointArtifact("runtime_water_regions", SCENARIO_CHECKPOINT_WATER_FILENAME),
    ScenarioCheckpointArtifact("runtime_topology_payload", SCENARIO_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME),
)

SCENARIO_OPTIONAL_RUNTIME_STAGE_ARTIFACTS: tuple[ScenarioCheckpointArtifact, ...] = ()

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
    SCENARIO_PUBLISH_SCOPE_POLAR_RUNTIME: (
        SCENARIO_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME,
    ),
    SCENARIO_PUBLISH_SCOPE_SCENARIO_DATA: (
        "countries.json",
        "owners.by_feature.json",
        "controllers.by_feature.json",
        "cores.by_feature.json",
        "manifest.json",
        "audit.json",
        "special_regions.geojson",
        SCENARIO_CHECKPOINT_WATER_FILENAME,
        SCENARIO_CHECKPOINT_RELIEF_FILENAME,
        SCENARIO_CHECKPOINT_BATHYMETRY_FILENAME,
        SCENARIO_CHECKPOINT_NAMED_WATER_SNAPSHOT_FILENAME,
        SCENARIO_CHECKPOINT_WATER_REGIONS_PROVENANCE_FILENAME,
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
    "controllers.by_feature.json",
    "cores.by_feature.json",
    SCENARIO_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME,
)


def resolve_scenario_publish_filenames(scope: str) -> tuple[str, ...]:
    if scope not in SCENARIO_PUBLISH_FILENAMES_BY_SCOPE:
        raise ValueError(f"Unsupported publish scope: {scope}")
    return SCENARIO_PUBLISH_FILENAMES_BY_SCOPE[scope]
