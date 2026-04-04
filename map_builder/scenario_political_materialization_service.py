from __future__ import annotations

from pathlib import Path

from map_builder.scenario_context import now_iso, repo_relative
from map_builder.scenario_political_materializer import (
    PoliticalMaterializerDeps,
    build_political_materialization_transaction as build_political_materialization_transaction_impl,
)
from map_builder.scenario_political_support import (
    build_capital_city_override_entry,
    build_country_entry_from_mutation,
    build_manual_assignment_record,
    build_manual_override_country_record,
    default_releasable_catalog,
    default_scenario_manual_overrides_payload,
    find_releasable_catalog_entry,
    load_city_assets_payload,
    load_country_catalog,
    load_default_capital_overrides_payload,
    load_local_releasable_catalog_for_materialization,
    load_source_releasable_catalog_for_materialization,
    load_political_payload_bundle,
    normalize_code,
    normalize_text,
    recompute_country_feature_counts,
    scenario_manual_catalog_entry,
    sync_releasable_catalog_entry_from_country,
    validate_core_tags,
    validate_tag_code,
)
from map_builder.scenario_service_errors import ScenarioServiceError


def build_political_materializer_deps() -> PoliticalMaterializerDeps:
    return PoliticalMaterializerDeps(
        load_country_catalog=load_country_catalog,
        load_political_payload_bundle=load_political_payload_bundle,
        load_city_assets_payload=load_city_assets_payload,
        load_default_capital_overrides_payload=load_default_capital_overrides_payload,
        load_source_releasable_catalog=load_source_releasable_catalog_for_materialization,
        load_local_releasable_catalog=load_local_releasable_catalog_for_materialization,
        build_country_entry_from_mutation=build_country_entry_from_mutation,
        build_capital_city_override_entry=build_capital_city_override_entry,
        recompute_country_feature_counts=recompute_country_feature_counts,
        build_manual_override_country_record=build_manual_override_country_record,
        build_manual_assignment_record=build_manual_assignment_record,
        default_scenario_manual_overrides_payload=default_scenario_manual_overrides_payload,
        default_releasable_catalog=default_releasable_catalog,
        find_releasable_catalog_entry=find_releasable_catalog_entry,
        scenario_manual_catalog_entry=scenario_manual_catalog_entry,
        sync_releasable_catalog_entry_from_country=sync_releasable_catalog_entry_from_country,
        validate_tag_code=validate_tag_code,
        validate_core_tags=validate_core_tags,
        normalize_code=normalize_code,
        normalize_text=normalize_text,
        repo_relative=repo_relative,
        now_iso=now_iso,
        error_cls=ScenarioServiceError,
    )


def build_political_materialization_transaction_in_context(
    context: dict[str, object],
    mutations_payload: dict[str, object],
    *,
    root: Path,
) -> tuple[list[tuple[Path, object]], dict[str, object]]:
    return build_political_materialization_transaction_impl(
        context,
        mutations_payload,
        root=root,
        deps=build_political_materializer_deps(),
    )
