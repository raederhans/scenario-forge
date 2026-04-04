from __future__ import annotations

import copy
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from map_builder.io.writers import write_json_atomic
from map_builder.scenario_build_session import resolve_scenario_build_session
from map_builder.scenario_context import (
    capture_text_snapshot,
    load_locked_scenario_context,
    load_scenario_mutations_payload,
    now_iso,
    repo_relative,
    restore_text_snapshot,
    write_json_transaction,
)
from map_builder.scenario_district_groups_service import (
    build_district_groups_payload_in_context,
)
from map_builder.scenario_geo_locale_materializer import (
    build_manual_geo_payload_from_mutations,
    materialize_scenario_geo_locale,
)
from map_builder.scenario_political_materialization_service import (
    build_political_materialization_transaction_in_context,
)
from map_builder.scenario_service_errors import ScenarioServiceError

ROOT = Path(__file__).resolve().parents[1]
MATERIALIZE_TARGETS = {"political", "geo-locale", "district-groups", "all"}


def _validate_target(target: str) -> str:
    normalized_target = str(target or "").strip().lower()
    if normalized_target not in MATERIALIZE_TARGETS:
        raise ValueError(f"Unsupported materialize target: {target}")
    return normalized_target


@contextmanager
def load_locked_materialization_context(
    scenario_id: str,
    *,
    root: Path = ROOT,
) -> Iterator[dict[str, object]]:
    with load_locked_scenario_context(
        scenario_id,
        root=root,
        holder="scenario_materialization_service",
    ) as context:
        yield context


def merge_mutation_patch(
    mutations_payload: dict[str, object],
    mutation_patch: dict[str, object] | None,
) -> dict[str, object]:
    if not isinstance(mutation_patch, dict):
        return mutations_payload
    for key, value in mutation_patch.items():
        if key == "generated_at":
            continue
        if isinstance(value, dict):
            existing_section = mutations_payload.get(key)
            if not isinstance(existing_section, dict):
                existing_section = {}
            merged_section = dict(existing_section)
            for section_key, section_value in value.items():
                normalized_section_key = str(section_key or "").strip()
                if not normalized_section_key:
                    continue
                if section_value is None:
                    merged_section.pop(normalized_section_key, None)
                else:
                    merged_section[normalized_section_key] = copy.deepcopy(section_value)
            mutations_payload[key] = merged_section
        else:
            mutations_payload[key] = copy.deepcopy(value)
    return mutations_payload


def _rollback_text_snapshots(
    *,
    error,
    manual_snapshot: tuple[Path, bool, str],
    mutations_snapshot: tuple[Path, bool, str],
) -> None:
    rollback_details = dict(error.details) if isinstance(error.details, dict) else {}
    try:
        restore_text_snapshot(
            manual_snapshot[0],
            existed=manual_snapshot[1],
            original_text=manual_snapshot[2],
        )
    except Exception as rollback_exc:
        rollback_details["rollbackError"] = str(rollback_exc)
    try:
        restore_text_snapshot(
            mutations_snapshot[0],
            existed=mutations_snapshot[1],
            original_text=mutations_snapshot[2],
        )
    except Exception as rollback_exc:
        rollback_details["mutationsRollbackError"] = str(rollback_exc)
    error.details = rollback_details or error.details


def _materialize_geo_locale_in_context(
    context: dict[str, object],
    *,
    mutations_payload: dict[str, object],
    root: Path,
    checkpoint_dir: Path | None = None,
) -> dict[str, object]:
    manual_path = Path(context["manualGeoOverridesPath"])
    mutations_path = Path(context["mutationsPath"])
    manual_snapshot = capture_text_snapshot(manual_path)
    mutations_snapshot = capture_text_snapshot(mutations_path)

    generated_at = now_iso()
    mutations_payload["generated_at"] = generated_at
    manual_payload = build_manual_geo_payload_from_mutations(
        str(context["scenarioId"]),
        mutations_payload,
        generated_at=generated_at,
    )

    write_json_atomic(manual_path, manual_payload, ensure_ascii=False, indent=2, trailing_newline=True)
    write_json_atomic(mutations_path, mutations_payload, ensure_ascii=False, indent=2, trailing_newline=True)

    try:
        materialized = materialize_scenario_geo_locale(
            context,
            root=root,
            error_cls=ScenarioServiceError,
            checkpoint_dir=checkpoint_dir,
        )
    except ScenarioServiceError as exc:
        _rollback_text_snapshots(
            error=exc,
            manual_snapshot=manual_snapshot,
            mutations_snapshot=mutations_snapshot,
        )
        raise
    except Exception as exc:
        build_error = ScenarioServiceError(
            "geo_locale_build_failed",
            "The geo locale patch builder failed after updating manual overrides.",
            status=500,
            details={"error": repr(exc)},
        )
        _rollback_text_snapshots(
            error=build_error,
            manual_snapshot=manual_snapshot,
            mutations_snapshot=mutations_snapshot,
        )
        raise ScenarioServiceError(
            "geo_locale_build_failed",
            "The geo locale patch builder failed after updating manual overrides.",
            status=500,
            details=build_error.details,
        ) from exc

    return {
        "manualPayload": manual_payload,
        "materialized": materialized,
    }


def _materialize_district_groups_in_context(
    context: dict[str, object],
    *,
    mutations_payload: dict[str, object],
    root: Path,
) -> dict[str, object]:
    district_groups_payload = build_district_groups_payload_in_context(
        context,
        mutations_payload,
        root=root,
        error_cls=ScenarioServiceError,
    )

    transaction_payloads: list[tuple[Path, object]] = [
        (Path(context["districtGroupsPath"]), district_groups_payload),
    ]
    manifest_relative_path = repo_relative(Path(context["districtGroupsPath"]), root=root)
    manifest_payload: dict[str, object] | None = None
    if str(context.get("manifest", {}).get("district_groups_url") or "").strip() != manifest_relative_path:
        manifest_payload = dict(context["manifest"]) if isinstance(context.get("manifest"), dict) else {}
        manifest_payload["district_groups_url"] = manifest_relative_path
        transaction_payloads.append((Path(context["manifestPath"]), manifest_payload))
    write_json_transaction(transaction_payloads)
    return {
        "districtGroupsPayload": district_groups_payload,
        "manifestPayload": manifest_payload,
    }


def write_mutation_patch_in_locked_context(
    context: dict[str, object],
    *,
    mutation_patch: dict[str, object] | None,
    root: Path = ROOT,
) -> dict[str, object]:
    mutations_payload = load_scenario_mutations_payload(context)
    merged_payload = merge_mutation_patch(mutations_payload, mutation_patch)
    merged_payload["generated_at"] = now_iso()
    write_json_atomic(
        Path(context["mutationsPath"]),
        merged_payload,
        ensure_ascii=False,
        indent=2,
        trailing_newline=True,
    )
    return {
        "scenarioId": str(context["scenarioId"]),
        "context": context,
        "mutationsPayload": merged_payload,
        "mutationsPath": str(Path(context["mutationsPath"])),
    }


def materialize_in_locked_context(
    context: dict[str, object],
    *,
    target: str,
    root: Path = ROOT,
) -> dict[str, object]:
    normalized_target = _validate_target(target)
    mutations_payload = load_scenario_mutations_payload(context)
    results: dict[str, object] = {
        "scenarioId": str(context["scenarioId"]),
        "target": normalized_target,
        "context": context,
        "mutationsPayload": mutations_payload,
    }

    if normalized_target in {"political", "all"}:
        mutations_payload["generated_at"] = now_iso()
        transaction_payloads, materialized = build_political_materialization_transaction_in_context(
            context,
            mutations_payload,
            root=root,
        )
        write_json_transaction(transaction_payloads)
        results["political"] = {
            "transactionPayloads": transaction_payloads,
            "materialized": materialized,
        }

    if normalized_target in {"geo-locale", "all"}:
        build_session = resolve_scenario_build_session(
            root=root,
            scenario_id=str(context["scenarioId"]),
            scenario_dir=Path(context["scenarioDir"]),
        )
        results["geoLocale"] = _materialize_geo_locale_in_context(
            context,
            mutations_payload=mutations_payload,
            root=root,
            checkpoint_dir=Path(build_session["buildDir"]),
        )

    if normalized_target in {"district-groups", "all"}:
        results["districtGroups"] = _materialize_district_groups_in_context(
            context,
            mutations_payload=mutations_payload,
            root=root,
        )

    return results


def apply_mutation_and_materialize_in_locked_context(
    context: dict[str, object],
    *,
    mutation_patch: dict[str, object] | None,
    target: str,
    root: Path = ROOT,
) -> dict[str, object]:
    write_result = write_mutation_patch_in_locked_context(
        context,
        mutation_patch=mutation_patch,
        root=root,
    )
    results = materialize_in_locked_context(
        context,
        target=target,
        root=root,
    )
    results["mutationsPayload"] = write_result["mutationsPayload"]
    return results


def apply_mutation_and_materialize(
    scenario_id: str,
    *,
    mutation_patch: dict[str, object] | None,
    target: str,
    root: Path = ROOT,
) -> dict[str, object]:
    with load_locked_materialization_context(scenario_id, root=root) as context:
        return apply_mutation_and_materialize_in_locked_context(
            context,
            mutation_patch=mutation_patch,
            target=target,
            root=root,
        )


def materialize_existing_mutations(
    scenario_id: str,
    *,
    target: str,
    root: Path = ROOT,
) -> dict[str, object]:
    with load_locked_materialization_context(scenario_id, root=root) as context:
        return materialize_in_locked_context(
            context,
            target=target,
            root=root,
        )
