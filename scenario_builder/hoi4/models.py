from __future__ import annotations

from dataclasses import dataclass, field


SCENARIO_RULE_QUALITIES = {
    "direct_country_copy",
    "manual_reviewed",
    "approx_existing_geometry",
    "geometry_blocker",
}


@dataclass(slots=True)
class BookmarkRecord:
    name: str
    description: str
    date: str
    default_country: str
    featured_tags: list[str] = field(default_factory=list)


@dataclass(slots=True)
class CountryHistoryRecord:
    tag: str
    file_label: str
    capital_state_id: int | None = None


@dataclass(slots=True)
class StateRecord:
    state_id: int
    file_name: str
    owner_tag: str
    controller_tag: str
    core_tags: list[str]
    province_ids: list[int]
    state_category: str
    manpower: int | None = None
    victory_points: list[int] = field(default_factory=list)


@dataclass(slots=True)
class DefinitionEntry:
    province_id: int
    r: int
    g: int
    b: int
    province_type: str
    coastal: bool
    terrain: str
    continent: int | None

    @property
    def rgb(self) -> tuple[int, int, int]:
        return (self.r, self.g, self.b)


@dataclass(slots=True)
class RuntimeFeatureRecord:
    feature_id: str
    country_code: str
    name: str
    admin1_group: str = ""
    detail_tier: str = ""


@dataclass(slots=True)
class ScenarioRule:
    rule_id: str
    owner_tag: str
    priority: int
    quality: str
    critical: bool
    notes: str
    include_country_codes: list[str] = field(default_factory=list)
    include_hierarchy_group_ids: list[str] = field(default_factory=list)
    include_feature_ids: list[str] = field(default_factory=list)
    exclude_country_codes: list[str] = field(default_factory=list)
    exclude_hierarchy_group_ids: list[str] = field(default_factory=list)
    exclude_feature_ids: list[str] = field(default_factory=list)
    base_iso2: str = ""
    lookup_iso2: str = ""
    display_name_override: str = ""
    color_hex_override: str = ""
    source_type: str = "hoi4_owner"
    historical_fidelity: str = "vanilla"

    def __post_init__(self) -> None:
        if self.quality not in SCENARIO_RULE_QUALITIES:
            raise ValueError(f"Unsupported rule quality: {self.quality}")


@dataclass(slots=True)
class FeatureAssignment:
    owner_tag: str
    quality: str
    source: str
    rule_id: str
    critical: bool
    notes: str
    base_iso2: str = ""
    synthetic_owner: bool = False


@dataclass(slots=True)
class ScenarioCountryRecord:
    tag: str
    display_name: str
    color_hex: str
    feature_count: int
    quality: str
    source: str
    base_iso2: str = ""
    lookup_iso2: str = ""
    provenance_iso2: str = ""
    scenario_only: bool = False
    featured: bool = False
    capital_state_id: int | None = None
    continent_id: str = ""
    continent_label: str = ""
    subregion_id: str = ""
    subregion_label: str = ""
    notes: str = ""
    synthetic_owner: bool = False
    source_type: str = "hoi4_owner"
    historical_fidelity: str = "vanilla"
    primary_rule_source: str = ""
    rule_sources: list[str] = field(default_factory=list)
    source_types: list[str] = field(default_factory=list)
    historical_fidelity_summary: list[str] = field(default_factory=list)
