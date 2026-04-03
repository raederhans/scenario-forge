from __future__ import annotations

import copy
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from map_builder.scenario_city_overrides_composer import (
    compose_city_overrides_payload,
    merge_capital_overrides_payload,
)


@dataclass(frozen=True)
class PoliticalMaterializerDeps:
    load_country_catalog: Callable[[dict[str, object]], dict[str, object]]
    load_political_payload_bundle: Callable[[dict[str, object]], dict[str, object]]
    load_city_assets_payload: Callable[[dict[str, object]], dict[str, object]]
    load_default_capital_overrides_payload: Callable[[dict[str, object]], dict[str, object]]
    load_source_releasable_catalog: Callable[[dict[str, object]], dict[str, object] | None]
    load_local_releasable_catalog: Callable[[dict[str, object]], dict[str, object] | None]
    build_country_entry_from_mutation: Callable[..., dict[str, object]]
    build_capital_city_override_entry: Callable[..., dict[str, object]]
    recompute_country_feature_counts: Callable[..., None]
    build_manual_override_country_record: Callable[..., dict[str, object]]
    build_manual_assignment_record: Callable[..., dict[str, object]]
    default_scenario_manual_overrides_payload: Callable[[str], dict[str, object]]
    default_releasable_catalog: Callable[[str], dict[str, object]]
    find_releasable_catalog_entry: Callable[..., tuple[int, dict[str, object]] | tuple[None, None]]
    scenario_manual_catalog_entry: Callable[..., dict[str, object]]
    sync_releasable_catalog_entry_from_country: Callable[..., dict[str, object]]
    validate_tag_code: Callable[[object], str]
    validate_core_tags: Callable[..., list[str]]
    normalize_code: Callable[[object], str]
    normalize_text: Callable[[object], str]
    repo_relative: Callable[..., str]
    now_iso: Callable[[], str]
    error_cls: type[Exception]


def build_capital_city_override_entry_payload(
    *,
    tag: str,
    country_entry: dict[str, object],
    capital_state_id: object,
    city_id: str,
    city_name: str,
    stable_key: str,
    country_code: str,
    lookup_iso2: str,
    base_iso2: str,
    capital_kind: str,
    population: object,
    lon: object,
    lat: object,
    urban_match_id: str,
    base_tier: str,
    name_ascii: str,
    host_feature_id: str,
    previous_hint: dict[str, object] | None = None,
) -> dict[str, object]:
    previous_hint = previous_hint if isinstance(previous_hint, dict) else {}
    normalized_city_id = str(city_id or "").strip()
    normalized_city_name = str(city_name or "").strip()
    normalized_name_ascii = str(name_ascii or "").strip() or normalized_city_name
    normalized_capital_kind = str(capital_kind or "").strip()
    normalized_base_tier = str(base_tier or "").strip().lower()
    normalized_lookup_iso2 = (
        str(lookup_iso2 or "").strip().upper()
        or str(previous_hint.get("lookup_iso2") or "").strip().upper()
        or str(country_entry.get("lookup_iso2") or "").strip().upper()
    )
    normalized_base_iso2 = (
        str(base_iso2 or "").strip().upper()
        or str(previous_hint.get("base_iso2") or "").strip().upper()
        or str(country_entry.get("base_iso2") or "").strip().upper()
        or normalized_lookup_iso2
    )
    normalized_country_code = (
        str(country_code or "").strip().upper()
        or str(previous_hint.get("country_code") or "").strip().upper()
        or normalized_lookup_iso2
        or normalized_base_iso2
    )
    normalized_feature_id = str(host_feature_id or "").strip() or str(previous_hint.get("host_feature_id") or "").strip()
    normalized_stable_key = str(stable_key or "").strip() or str(previous_hint.get("stable_key") or "").strip() or f"id::{normalized_city_id}"
    normalized_urban_match_id = str(urban_match_id or "").strip() or str(previous_hint.get("urban_match_id") or "").strip()
    return {
        **previous_hint,
        "tag": tag,
        "display_name": str(country_entry.get("display_name") or country_entry.get("display_name_en") or tag).strip(),
        "lookup_iso2": normalized_lookup_iso2,
        "base_iso2": normalized_base_iso2,
        "capital_state_id": capital_state_id,
        "city_id": normalized_city_id,
        "stable_key": normalized_stable_key,
        "city_name": normalized_city_name or str(previous_hint.get("city_name") or "").strip() or normalized_city_id,
        "name_ascii": normalized_name_ascii or str(previous_hint.get("name_ascii") or "").strip() or normalized_city_id,
        "capital_kind": normalized_capital_kind or str(previous_hint.get("capital_kind") or "").strip() or "manual_capital",
        "base_tier": normalized_base_tier or str(previous_hint.get("base_tier") or "").strip(),
        "population": population if population is not None else previous_hint.get("population"),
        "country_code": normalized_country_code,
        "host_feature_id": normalized_feature_id,
        "urban_match_id": normalized_urban_match_id,
        "lon": lon if lon is not None else previous_hint.get("lon"),
        "lat": lat if lat is not None else previous_hint.get("lat"),
        "source": "manual_override",
        "resolution_method": "dev_workspace_manual",
        "confidence": "manual",
    }


def build_political_materialization_transaction(
    context: dict[str, object],
    mutations_payload: dict[str, object],
    *,
    root: Path,
    deps: PoliticalMaterializerDeps,
) -> tuple[list[tuple[Path, object]], dict[str, object]]:
    countries_payload = deps.load_country_catalog(context)
    countries = countries_payload["countries"]
    political_bundle = deps.load_political_payload_bundle(context)
    owners_payload = political_bundle["ownersPayload"]
    owners = political_bundle["owners"]
    controllers_payload = political_bundle["controllersPayload"]
    controllers = political_bundle["controllers"]
    has_controllers = bool(political_bundle["hasControllers"])
    cores_payload = political_bundle["coresPayload"]
    cores = political_bundle["cores"]
    has_cores = bool(political_bundle["hasCores"])
    allowed_tags = {
        str(tag or "").strip().upper()
        for tag in countries.keys()
        if str(tag or "").strip()
    }

    country_mutations = mutations_payload.get("countries", {})
    if not isinstance(country_mutations, dict):
        country_mutations = {}
    for raw_tag, raw_mutation in country_mutations.items():
        normalized_tag = deps.validate_tag_code(raw_tag)
        if not isinstance(raw_mutation, dict):
            continue
        existing_entry = countries.get(normalized_tag) if isinstance(countries.get(normalized_tag), dict) else None
        countries[normalized_tag] = deps.build_country_entry_from_mutation(
            context,
            normalized_tag,
            raw_mutation,
            existing_entry=existing_entry,
        )

    allowed_tags = {
        str(tag or "").strip().upper()
        for tag in countries.keys()
        if str(tag or "").strip()
    }

    assignment_mutations = mutations_payload.get("assignments_by_feature_id", {})
    if not isinstance(assignment_mutations, dict):
        assignment_mutations = {}
    for raw_feature_id, raw_assignment in assignment_mutations.items():
        feature_id = deps.normalize_text(raw_feature_id)
        if not feature_id or not isinstance(raw_assignment, dict):
            continue
        if feature_id not in owners:
            raise deps.error_cls(
                "unknown_feature_ids",
                "One or more feature assignments referenced a feature outside the active scenario.",
                status=400,
                details={"missingFeatureIds": [feature_id]},
            )
        if "owner" in raw_assignment:
            owner_tag = deps.normalize_code(raw_assignment.get("owner"))
            if owner_tag not in allowed_tags:
                raise deps.error_cls(
                    "invalid_owner_codes",
                    f'Feature "{feature_id}" used an owner tag not declared by the scenario.',
                    status=400,
                    details={"featureId": feature_id, "invalidOwnerTag": owner_tag},
                )
            owners[feature_id] = owner_tag
        if "controller" in raw_assignment:
            if not has_controllers:
                raise deps.error_cls(
                    "missing_controllers_file",
                    "Scenario controllers file is required when saving controller assignments.",
                    status=400,
                )
            controller_tag = deps.normalize_code(raw_assignment.get("controller"))
            if controller_tag not in allowed_tags:
                raise deps.error_cls(
                    "invalid_controller_codes",
                    f'Feature "{feature_id}" used a controller tag not declared by the scenario.',
                    status=400,
                    details={"featureId": feature_id, "invalidControllerTag": controller_tag},
                )
            controllers[feature_id] = controller_tag
        if "cores" in raw_assignment:
            if not has_cores:
                raise deps.error_cls(
                    "missing_cores_file",
                    "Scenario cores file is required when saving core assignments.",
                    status=400,
                )
            cores[feature_id] = deps.validate_core_tags(
                raw_assignment.get("cores"),
                feature_id=feature_id,
                allowed_tags=allowed_tags,
            )

    capital_mutations = mutations_payload.get("capitals", {})
    if not isinstance(capital_mutations, dict):
        capital_mutations = {}
    city_assets_payload = deps.load_city_assets_payload(context)
    default_capital_overrides_payload = deps.load_default_capital_overrides_payload(context)
    explicit_capital_overrides_payload = {
        "version": 1,
        "scenario_id": str(context["scenarioId"]),
        "generated_at": deps.now_iso() if capital_mutations else "",
        "capitals_by_tag": {},
        "capital_city_hints": {},
        "audit": {
            "explicit_capital_override_count": 0,
            "explicit_capital_override_tags": [],
        },
    }
    for raw_tag, raw_capital in capital_mutations.items():
        normalized_tag = deps.validate_tag_code(raw_tag)
        if not isinstance(raw_capital, dict):
            continue
        if normalized_tag not in countries:
            raise deps.error_cls(
                "unknown_scenario_tag",
                f'Tag "{normalized_tag}" does not exist in the active scenario countries catalog.',
                status=404,
            )
        feature_id = deps.normalize_text(raw_capital.get("feature_id"))
        if feature_id and owners.get(feature_id) != normalized_tag:
            raise deps.error_cls(
                "capital_feature_owner_mismatch",
                "The selected feature is not owned by the requested country in the saved scenario owners file.",
                status=400,
                details={
                    "featureId": feature_id,
                    "featureOwnerTag": owners.get(feature_id),
                    "requestedTag": normalized_tag,
                },
            )
        countries[normalized_tag]["capital_state_id"] = raw_capital.get("capital_state_id")
        explicit_city_override_entry = raw_capital.get("city_override_entry")
        if isinstance(explicit_city_override_entry, dict):
            city_override_entry = copy.deepcopy(explicit_city_override_entry)
            city_override_entry["tag"] = normalized_tag
            city_override_entry["display_name"] = str(
                countries[normalized_tag].get("display_name")
                or countries[normalized_tag].get("display_name_en")
                or normalized_tag
            ).strip()
            city_override_entry["capital_state_id"] = raw_capital.get("capital_state_id")
            city_override_entry["city_id"] = deps.normalize_text(
                raw_capital.get("city_id") or city_override_entry.get("city_id")
            )
            city_override_entry["host_feature_id"] = deps.normalize_text(
                raw_capital.get("feature_id") or city_override_entry.get("host_feature_id")
            )
        else:
            city_override_entry = deps.build_capital_city_override_entry(
                normalized_tag,
                countries[normalized_tag],
                raw_capital,
            )
        explicit_capital_overrides_payload["capitals_by_tag"][normalized_tag] = deps.normalize_text(raw_capital.get("city_id"))
        explicit_capital_overrides_payload["capital_city_hints"][normalized_tag] = city_override_entry

    explicit_override_tags = sorted(explicit_capital_overrides_payload["capital_city_hints"].keys())
    explicit_capital_overrides_payload["audit"] = {
        "explicit_capital_override_count": len(explicit_override_tags),
        "explicit_capital_override_tags": explicit_override_tags,
    }
    city_overrides_payload = compose_city_overrides_payload(
        city_assets_payload,
        merge_capital_overrides_payload(
            default_capital_overrides_payload,
            explicit_capital_overrides_payload,
            scenario_id=str(context["scenarioId"]),
            generated_at=deps.now_iso() if capital_mutations else "",
        ),
        scenario_id=str(context["scenarioId"]),
        generated_at=deps.now_iso() if capital_mutations else "",
    )

    deps.recompute_country_feature_counts(countries, owners, controllers)
    countries_payload["generated_at"] = deps.now_iso()
    owners_payload["owners"] = owners
    if has_controllers and controllers_payload is not None:
        controllers_payload["controllers"] = controllers
    if has_cores and cores_payload is not None:
        cores_payload["cores"] = cores

    manual_payload = deps.default_scenario_manual_overrides_payload(str(context["scenarioId"]))
    for raw_tag, raw_mutation in country_mutations.items():
        normalized_tag = deps.validate_tag_code(raw_tag)
        if not isinstance(raw_mutation, dict) or normalized_tag not in countries:
            continue
        manual_payload["countries"][normalized_tag] = deps.build_manual_override_country_record(
            countries[normalized_tag],
            mode=str(raw_mutation.get("mode") or "override"),
        )
    for feature_id in assignment_mutations.keys():
        if feature_id not in owners:
            continue
        manual_payload["assignments"][feature_id] = deps.build_manual_assignment_record(
            feature_id,
            owners,
            controllers,
            cores,
            has_controllers=has_controllers,
            has_cores=has_cores,
        )
    for raw_tag in capital_mutations.keys():
        normalized_tag = deps.validate_tag_code(raw_tag)
        if normalized_tag not in countries:
            continue
        existing_manual_entry = manual_payload["countries"].get(normalized_tag)
        manual_mode = "override"
        if isinstance(existing_manual_entry, dict) and str(existing_manual_entry.get("mode") or "").strip().lower() == "create":
            manual_mode = "create"
        elif normalized_tag in country_mutations:
            manual_mode = str(country_mutations[normalized_tag].get("mode") or "override")
        manual_payload["countries"][normalized_tag] = deps.build_manual_override_country_record(
            countries[normalized_tag],
            mode=manual_mode,
        )
    manual_payload["generated_at"] = deps.now_iso()

    source_catalog_payload = deps.load_source_releasable_catalog(context)
    local_catalog_payload = deps.load_local_releasable_catalog(context)
    catalog_payload = copy.deepcopy(source_catalog_payload) if isinstance(source_catalog_payload, dict) else None
    source_catalog_entries = (
        catalog_payload.get("entries", [])
        if isinstance(catalog_payload, dict) and isinstance(catalog_payload.get("entries"), list)
        else []
    )
    source_catalog_tags = {
        deps.normalize_code(entry.get("tag"))
        for entry in source_catalog_entries
        if isinstance(entry, dict) and deps.normalize_code(entry.get("tag"))
    }
    local_only_catalog_entries: list[dict[str, object]] = []
    if isinstance(local_catalog_payload, dict):
        for raw_entry in local_catalog_payload.get("entries", []):
            if not isinstance(raw_entry, dict):
                continue
            normalized_entry_tag = deps.normalize_code(raw_entry.get("tag"))
            if not normalized_entry_tag or normalized_entry_tag in source_catalog_tags:
                continue
            local_only_catalog_entries.append(copy.deepcopy(raw_entry))
    catalog_entries_changed = False
    if catalog_payload is not None or local_only_catalog_entries or any(
        deps.normalize_code(entry.get("parent_owner_tag"))
        for entry in country_mutations.values()
        if isinstance(entry, dict)
    ):
        if catalog_payload is None:
            catalog_payload = deps.default_releasable_catalog(str(context["scenarioId"]))
        catalog_payload.setdefault("entries", [])
        if local_only_catalog_entries:
            catalog_payload["entries"].extend(local_only_catalog_entries)
        for raw_tag, raw_mutation in country_mutations.items():
            normalized_tag = deps.validate_tag_code(raw_tag)
            if normalized_tag not in countries or not isinstance(raw_mutation, dict):
                continue
            catalog_entry_index, existing_catalog_entry = deps.find_releasable_catalog_entry(catalog_payload, normalized_tag)
            parent_owner_tag = deps.normalize_code(countries[normalized_tag].get("parent_owner_tag"))
            if not existing_catalog_entry and not parent_owner_tag:
                continue
            current_feature_ids = sorted(
                feature_id
                for feature_id, owner_tag in owners.items()
                if owner_tag == normalized_tag
            )
            if existing_catalog_entry is None:
                updated_catalog_entry = deps.scenario_manual_catalog_entry(
                    scenario_id=str(context["scenarioId"]),
                    tag=normalized_tag,
                    display_name_en=deps.normalize_text(countries[normalized_tag].get("display_name_en") or countries[normalized_tag].get("display_name")),
                    display_name_zh=deps.normalize_text(countries[normalized_tag].get("display_name_zh")),
                    color_hex=str(countries[normalized_tag].get("color_hex") or "#000000"),
                    feature_ids=current_feature_ids,
                    parent_owner_tag=parent_owner_tag,
                )
                catalog_payload.setdefault("entries", []).append(updated_catalog_entry)
            else:
                updated_catalog_entry = deps.sync_releasable_catalog_entry_from_country(existing_catalog_entry, countries[normalized_tag])
                updated_catalog_entry["lookup_iso2"] = deps.normalize_code(updated_catalog_entry.get("lookup_iso2") or parent_owner_tag or normalized_tag)
                updated_catalog_entry["release_lookup_iso2"] = deps.normalize_code(updated_catalog_entry.get("release_lookup_iso2") or parent_owner_tag or normalized_tag)
                updated_catalog_entry["boundary_variants"] = [
                    {
                        "id": "current_manual",
                        "label": "Current Selection",
                        "description": "Manual releasable created from the selected features.",
                        "basis": "manual_selection",
                        "preset_source": {
                            "type": "feature_ids",
                            "name": "",
                            "group_ids": [],
                            "feature_ids": current_feature_ids,
                        },
                        "resolved_feature_count_hint": len(current_feature_ids),
                    }
                ]
                if catalog_entry_index is None:
                    catalog_payload.setdefault("entries", []).append(updated_catalog_entry)
                else:
                    catalog_payload["entries"][catalog_entry_index] = updated_catalog_entry
            catalog_entries_changed = True

        for raw_tag in capital_mutations.keys():
            normalized_tag = deps.validate_tag_code(raw_tag)
            catalog_entry_index, existing_catalog_entry = deps.find_releasable_catalog_entry(catalog_payload, normalized_tag)
            if existing_catalog_entry is None or normalized_tag not in countries:
                continue
            updated_catalog_entry = deps.sync_releasable_catalog_entry_from_country(existing_catalog_entry, countries[normalized_tag])
            if catalog_entry_index is None:
                catalog_payload.setdefault("entries", []).append(updated_catalog_entry)
            else:
                catalog_payload["entries"][catalog_entry_index] = updated_catalog_entry
            catalog_entries_changed = True

    manifest_payload: dict[str, object] | None = None
    transaction_payloads: list[tuple[Path, object]] = [
        (Path(context["mutationsPath"]), mutations_payload),
        (Path(context["countriesPath"]), countries_payload),
        (Path(context["ownersPath"]), owners_payload),
        (Path(context["manualOverridesPath"]), manual_payload),
    ]
    if has_controllers and political_bundle["controllersPath"] is not None and controllers_payload is not None:
        transaction_payloads.append((political_bundle["controllersPath"], controllers_payload))
    if has_cores and political_bundle["coresPath"] is not None and cores_payload is not None:
        transaction_payloads.append((political_bundle["coresPath"], cores_payload))
    if capital_mutations:
        transaction_payloads.append((Path(context["cityOverridesPath"]), city_overrides_payload))
        city_overrides_relative = deps.repo_relative(Path(context["cityOverridesPath"]), root=root)
        if str(context.get("manifest", {}).get("city_overrides_url") or "").strip() != city_overrides_relative:
            manifest_payload = dict(context["manifest"]) if isinstance(context.get("manifest"), dict) else {}
            manifest_payload["city_overrides_url"] = city_overrides_relative
    if catalog_entries_changed and catalog_payload is not None:
        catalog_payload["generated_at"] = deps.now_iso()
        catalog_payload["scenario_ids"] = [str(context["scenarioId"])]
        transaction_payloads.append((Path(context["releasableCatalogLocalPath"]), catalog_payload))
        catalog_relative = deps.repo_relative(Path(context["releasableCatalogLocalPath"]), root=root)
        if str(context.get("manifest", {}).get("releasable_catalog_url") or "").strip() != catalog_relative:
            if manifest_payload is None:
                manifest_payload = dict(context["manifest"]) if isinstance(context.get("manifest"), dict) else {}
            manifest_payload["releasable_catalog_url"] = catalog_relative
    if manifest_payload is not None:
        transaction_payloads.append((Path(context["manifestPath"]), manifest_payload))

    return transaction_payloads, {
        "countriesPayload": countries_payload,
        "ownersPayload": owners_payload,
        "manualPayload": manual_payload,
        "cityOverridesPayload": city_overrides_payload,
        "catalogPayload": catalog_payload,
        "manifestPayload": manifest_payload,
    }
