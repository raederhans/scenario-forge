from __future__ import annotations

from copy import deepcopy
from typing import Any


TRANSPORT_SHARED_REQUIRED_FIELDS = (
    "adapter_id",
    "family",
    "geometry_kind",
    "generated_at",
    "recipe_version",
    "feature_counts",
    "source_policy",
    "distribution_tier",
    "paths",
    "default_variant",
    "variants",
)

TRANSPORT_LEGACY_VARIANT_FIELDS = (
    "default_coverage_tier",
    "coverage_variants",
    "default_distribution_variant",
    "distribution_variants",
)


def _has_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (dict, list, tuple, set)):
        return bool(value)
    return True


def finalize_transport_manifest(
    manifest: dict[str, Any],
    *,
    default_variant: str,
    variants: dict[str, Any],
    extension: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = deepcopy(manifest)
    payload["default_variant"] = str(default_variant).strip()
    payload["variants"] = deepcopy(variants)
    if extension:
        extensions = payload.setdefault("extensions", {})
        family = str(payload.get("family") or "").strip()
        if family:
            extensions[family] = deepcopy(extension)
    return payload


def validate_transport_manifest(
    manifest: dict[str, Any],
    *,
    source_label: str = "manifest.json",
) -> list[str]:
    errors: list[str] = []

    for field in TRANSPORT_SHARED_REQUIRED_FIELDS:
        if field == "feature_counts" and isinstance(manifest.get(field), dict):
            continue
        if not _has_value(manifest.get(field)):
            errors.append(f"{source_label}: `{field}` is required.")

    for legacy_field in TRANSPORT_LEGACY_VARIANT_FIELDS:
        if legacy_field in manifest:
            errors.append(
                f"{source_label}: legacy transport variant field `{legacy_field}` is no longer allowed."
            )

    family = str(manifest.get("family") or "").strip()
    geometry_kind = str(manifest.get("geometry_kind") or "").strip()
    if geometry_kind == "carrier" and family != "carrier":
        errors.append(f"{source_label}: carrier geometry_kind requires family `carrier`.")

    paths = manifest.get("paths")
    if not isinstance(paths, dict):
        errors.append(f"{source_label}: `paths` must be an object.")

    variants = manifest.get("variants")
    if not isinstance(variants, dict):
        errors.append(f"{source_label}: `variants` must be an object.")
        return errors

    default_variant = str(manifest.get("default_variant") or "").strip()
    if default_variant and default_variant not in variants:
        errors.append(
            f"{source_label}: `default_variant` must exist in `variants`. Missing `{default_variant}`."
        )

    for variant_id, raw_variant in variants.items():
        if not isinstance(raw_variant, dict):
            errors.append(f"{source_label}: variant `{variant_id}` must be an object.")
            continue
        if not _has_value(raw_variant.get("distribution_tier")):
            errors.append(f"{source_label}: variant `{variant_id}` missing `distribution_tier`.")
        if not isinstance(raw_variant.get("paths"), dict):
            errors.append(f"{source_label}: variant `{variant_id}` missing `paths` object.")
        if not isinstance(raw_variant.get("feature_counts"), dict):
            errors.append(f"{source_label}: variant `{variant_id}` missing `feature_counts` object.")

    if family == "carrier":
        if not isinstance(paths, dict):
            return errors
        if not _has_value(paths.get("carrier")):
            errors.append(f"{source_label}: carrier manifest must declare `paths.carrier`.")
        if not _has_value(paths.get("provenance")):
            errors.append(f"{source_label}: carrier manifest must declare `paths.provenance`.")

    return errors
