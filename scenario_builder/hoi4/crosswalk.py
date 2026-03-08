from __future__ import annotations

import colorsys
from collections import Counter, defaultdict

from .models import FeatureAssignment, RuntimeFeatureRecord, ScenarioCountryRecord, ScenarioRule


QUALITY_RANK = {
    "direct_country_copy": 0,
    "manual_reviewed": 1,
    "approx_existing_geometry": 2,
    "geometry_blocker": 3,
}


def _fallback_color_hex(tag: str) -> str:
    seed = sum(ord(char) * (index + 1) for index, char in enumerate(str(tag or "").upper()))
    r = 72 + (seed % 104)
    g = 72 + ((seed // 7) % 104)
    b = 72 + ((seed // 13) % 104)
    return f"#{r:02x}{g:02x}{b:02x}"


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _get_palette_color_hex(tag: str, palette_entries: dict[str, dict] | None = None) -> str:
    palette_entry = palette_entries.get(tag, {}) if isinstance(palette_entries, dict) else {}
    return (
        str(palette_entry.get("map_hex") or "").strip().lower()
        or str(palette_entry.get("country_file_hex") or "").strip().lower()
        or _fallback_color_hex(tag)
    )


def _derive_subject_color_hex(parent_color_hex: str, child_tag: str, subject_kind: str = "") -> str:
    normalized_parent = str(parent_color_hex or "").strip().lower()
    if not normalized_parent.startswith("#") or len(normalized_parent) != 7:
        return normalized_parent or _fallback_color_hex(child_tag)

    try:
        red = int(normalized_parent[1:3], 16) / 255.0
        green = int(normalized_parent[3:5], 16) / 255.0
        blue = int(normalized_parent[5:7], 16) / 255.0
    except ValueError:
        return normalized_parent or _fallback_color_hex(child_tag)

    subject_profiles: dict[str, tuple[float, float]] = {
        "dominion": (0.14, -0.05),
        "commonwealth": (0.12, -0.04),
        "raj": (0.10, 0.00),
        "mandate": (0.04, -0.12),
        "protectorate": (0.02, -0.14),
        "colony": (-0.08, 0.04),
        "colonial_government": (0.08, -0.02),
        "colonial_federation": (-0.02, -0.10),
    }
    base_lightness_delta, base_saturation_delta = subject_profiles.get(subject_kind, (0.0, 0.0))
    seed = sum(
        ord(char) * (index + 1)
        for index, char in enumerate(f"{str(child_tag or '').upper()}:{str(subject_kind or '').lower()}")
    )

    hue, lightness, saturation = colorsys.rgb_to_hls(red, green, blue)
    hue_jitter = ((seed % 13) - 6) / 360.0
    lightness_jitter = (((seed // 7) % 7) - 3) * 0.018
    saturation_jitter = (((seed // 11) % 7) - 3) * 0.018

    adjusted_hue = (hue + hue_jitter) % 1.0
    adjusted_lightness = _clamp(lightness + base_lightness_delta + lightness_jitter, 0.22, 0.82)
    adjusted_saturation = _clamp(saturation + base_saturation_delta + saturation_jitter, 0.18, 0.90)
    derived_red, derived_green, derived_blue = colorsys.hls_to_rgb(
        adjusted_hue,
        adjusted_lightness,
        adjusted_saturation,
    )
    return "#{:02x}{:02x}{:02x}".format(
        round(_clamp(derived_red, 0.0, 1.0) * 255),
        round(_clamp(derived_green, 0.0, 1.0) * 255),
        round(_clamp(derived_blue, 0.0, 1.0) * 255),
    )


def _choose_primary_rule(rules: list[ScenarioRule]) -> ScenarioRule | None:
    if not rules:
        return None
    return sorted(rules, key=lambda rule: (rule.priority, rule.rule_id))[0]


def _dedupe_strings(values: list[str]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for value in values:
        candidate = str(value or "").strip()
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        deduped.append(candidate)
    return deduped


def build_iso2_to_mapped_tag(palette_map: dict) -> dict[str, str]:
    result: dict[str, str] = {}
    mapped = palette_map.get("mapped", {}) if isinstance(palette_map, dict) else {}
    for tag, entry in mapped.items():
        if not isinstance(entry, dict):
            continue
        iso2 = str(entry.get("iso2") or "").strip().upper()
        if iso2 and iso2 not in result:
            result[iso2] = str(tag).strip().upper()
    return result


def build_active_owner_tags(states_by_id: dict[int, object]) -> set[str]:
    return {
        str(record.owner_tag).strip().upper()
        for record in states_by_id.values()
        if getattr(record, "owner_tag", None)
    }


def build_active_controller_tags(states_by_id: dict[int, object]) -> set[str]:
    active_tags: set[str] = set()
    for record in states_by_id.values():
        controller_tag = str(getattr(record, "controller_tag", "") or "").strip().upper()
        owner_tag = str(getattr(record, "owner_tag", "") or "").strip().upper()
        if controller_tag:
            active_tags.add(controller_tag)
            continue
        if owner_tag:
            active_tags.add(owner_tag)
    return active_tags


def build_feature_indexes(
    runtime_features: list[RuntimeFeatureRecord],
    hierarchy_groups: dict[str, list[str]],
) -> tuple[dict[str, RuntimeFeatureRecord], dict[str, set[str]], dict[str, set[str]]]:
    feature_by_id = {feature.feature_id: feature for feature in runtime_features}
    ids_by_country: dict[str, set[str]] = defaultdict(set)
    for feature in runtime_features:
        if feature.country_code:
            ids_by_country[feature.country_code].add(feature.feature_id)
    ids_by_group: dict[str, set[str]] = {}
    for group_id, children in hierarchy_groups.items():
        ids_by_group[group_id] = {child for child in children if child in feature_by_id}
    return feature_by_id, ids_by_country, ids_by_group


def _select_rule_feature_ids(
    rule: ScenarioRule,
    ids_by_country: dict[str, set[str]],
    ids_by_group: dict[str, set[str]],
) -> set[str]:
    selected: set[str] = set()
    for code in rule.include_country_codes:
        selected.update(ids_by_country.get(code, set()))
    for group_id in rule.include_hierarchy_group_ids:
        selected.update(ids_by_group.get(group_id, set()))
    for feature_id in rule.include_feature_ids:
        if feature_id:
            selected.add(feature_id)

    excluded: set[str] = set()
    for code in rule.exclude_country_codes:
        excluded.update(ids_by_country.get(code, set()))
    for group_id in rule.exclude_hierarchy_group_ids:
        excluded.update(ids_by_group.get(group_id, set()))
    for feature_id in rule.exclude_feature_ids:
        if feature_id:
            excluded.add(feature_id)

    return selected - excluded


def assign_feature_owners(
    runtime_features: list[RuntimeFeatureRecord],
    hierarchy_groups: dict[str, list[str]],
    rules: list[ScenarioRule],
    iso2_to_tag: dict[str, str],
    active_owner_tags: set[str],
) -> tuple[dict[str, FeatureAssignment], dict[str, list[str]]]:
    feature_by_id, ids_by_country, ids_by_group = build_feature_indexes(runtime_features, hierarchy_groups)
    assignments: dict[str, FeatureAssignment] = {}
    diagnostics: dict[str, list[str]] = defaultdict(list)

    for feature in runtime_features:
        mapped_tag = iso2_to_tag.get(feature.country_code)
        if not mapped_tag or mapped_tag not in active_owner_tags:
            continue
        assignments[feature.feature_id] = FeatureAssignment(
            owner_tag=mapped_tag,
            quality="direct_country_copy",
            source="direct_active_owner",
            rule_id="direct_active_owner",
            critical=False,
            notes=f"Directly inherited from current country code {feature.country_code}.",
            base_iso2=feature.country_code,
            synthetic_owner=False,
        )

    for rule in rules:
        missing_groups = [
            group_id
            for group_id in rule.include_hierarchy_group_ids + rule.exclude_hierarchy_group_ids
            if group_id and group_id not in ids_by_group
        ]
        if missing_groups:
            diagnostics["missing_rule_groups"].extend(
                f"{rule.rule_id}:{group_id}" for group_id in sorted(set(missing_groups))
            )
        missing_feature_ids = [
            feature_id
            for feature_id in rule.include_feature_ids + rule.exclude_feature_ids
            if feature_id and feature_id not in feature_by_id
        ]
        if missing_feature_ids:
            diagnostics["missing_rule_feature_ids"].extend(
                f"{rule.rule_id}:{feature_id}" for feature_id in sorted(set(missing_feature_ids))
            )
        target_ids = {
            feature_id
            for feature_id in _select_rule_feature_ids(rule, ids_by_country, ids_by_group)
            if feature_id in feature_by_id
        }
        if not target_ids:
            diagnostics["empty_rules"].append(rule.rule_id)
            continue
        for feature_id in target_ids:
            assignments[feature_id] = FeatureAssignment(
                owner_tag=rule.owner_tag,
                quality=rule.quality,
                source="manual_rule",
                rule_id=rule.rule_id,
                critical=rule.critical,
                notes=rule.notes,
                base_iso2=rule.base_iso2 or feature_by_id.get(feature_id, RuntimeFeatureRecord("", "", "")).country_code,
                synthetic_owner=False,
            )

    for feature in runtime_features:
        if feature.feature_id in assignments:
            continue
        mapped_tag = iso2_to_tag.get(feature.country_code)
        if mapped_tag:
            assignments[feature.feature_id] = FeatureAssignment(
                owner_tag=mapped_tag,
                quality="approx_existing_geometry",
                source="fallback_mapped_tag",
                rule_id="fallback_mapped_tag",
                critical=False,
                notes=(
                    f"Fallback to mapped current-country tag {mapped_tag} for {feature.country_code}; "
                    "historical review pending."
                ),
                base_iso2=feature.country_code,
                synthetic_owner=mapped_tag not in active_owner_tags,
            )
            continue

        synthetic_tag = (feature.country_code or "")[:3].upper()
        if not synthetic_tag:
            synthetic_tag = "UNK"
        assignments[feature.feature_id] = FeatureAssignment(
            owner_tag=synthetic_tag,
            quality="approx_existing_geometry",
            source="fallback_current_code",
            rule_id="fallback_current_code",
            critical=False,
            notes=(
                f"No HOI4 palette crosswalk exists for current country code {feature.country_code or 'N/A'}; "
                "using synthetic fallback."
            ),
            base_iso2=feature.country_code,
            synthetic_owner=True,
        )
        diagnostics["synthetic_fallback_codes"].append(feature.country_code or synthetic_tag)

    return assignments, diagnostics


def _worst_quality(qualities: list[str]) -> str:
    if not qualities:
        return "approx_existing_geometry"
    return max(qualities, key=lambda value: QUALITY_RANK.get(value, 99))


def build_country_registry(
    assignments: dict[str, FeatureAssignment],
    runtime_features: list[RuntimeFeatureRecord],
    bookmark: object,
    palette_pack: dict,
    iso2_to_tag: dict[str, str],
    country_histories: dict[str, object],
    country_meta_by_iso2: dict[str, dict[str, str]],
    rule_lookup: dict[str, list[ScenarioRule]],
    runtime_country_names: dict[str, str],
    active_owner_tags: set[str],
) -> dict[str, ScenarioCountryRecord]:
    feature_by_id = {feature.feature_id: feature for feature in runtime_features}
    feature_count_by_tag: Counter[str] = Counter()
    quality_by_tag: defaultdict[str, list[str]] = defaultdict(list)
    source_by_tag: Counter[tuple[str, str]] = Counter()
    base_iso2_votes: defaultdict[str, Counter[str]] = defaultdict(Counter)
    synthetic_owner_by_tag: dict[str, bool] = {}

    for feature_id, assignment in assignments.items():
        feature = feature_by_id.get(feature_id)
        feature_count_by_tag[assignment.owner_tag] += 1
        quality_by_tag[assignment.owner_tag].append(assignment.quality)
        source_by_tag[(assignment.owner_tag, assignment.source)] += 1
        if assignment.base_iso2:
            base_iso2_votes[assignment.owner_tag][assignment.base_iso2] += 1
        synthetic_owner_by_tag[assignment.owner_tag] = synthetic_owner_by_tag.get(
            assignment.owner_tag, False
        ) or assignment.synthetic_owner

    palette_entries = palette_pack.get("entries", {}) if isinstance(palette_pack, dict) else {}
    country_registry: dict[str, ScenarioCountryRecord] = {}
    featured_tags = set(getattr(bookmark, "featured_tags", []) or [])

    for tag, feature_count in sorted(feature_count_by_tag.items()):
        palette_entry = palette_entries.get(tag, {}) if isinstance(palette_entries, dict) else {}
        file_label = str(palette_entry.get("country_file_label") or "").strip()
        localized_name = str(palette_entry.get("localized_name") or "").strip()
        display_name = localized_name or file_label or tag
        color_hex = _get_palette_color_hex(tag, palette_entries)
        base_iso2 = ""
        if base_iso2_votes.get(tag):
            base_iso2 = base_iso2_votes[tag].most_common(1)[0][0]
        if not base_iso2:
            for iso2, mapped_tag in iso2_to_tag.items():
                if mapped_tag == tag:
                    base_iso2 = iso2
                    break
        if not display_name or display_name == tag:
            if base_iso2 and runtime_country_names.get(base_iso2):
                display_name = runtime_country_names[base_iso2]
        owner_rules = sorted(rule_lookup.get(tag) or [], key=lambda rule: (rule.priority, rule.rule_id))
        primary_rule = _choose_primary_rule(owner_rules)
        if primary_rule and primary_rule.display_name_override:
            display_name = primary_rule.display_name_override
        history = country_histories.get(tag)
        primary_source = max(
            ((count, source) for (owner_tag, source), count in source_by_tag.items() if owner_tag == tag),
            default=(0, "manual_rule"),
        )[1]
        lookup_iso2 = ""
        if primary_rule and primary_rule.lookup_iso2:
            lookup_iso2 = primary_rule.lookup_iso2
        elif primary_rule and primary_rule.base_iso2:
            lookup_iso2 = primary_rule.base_iso2
        else:
            lookup_iso2 = base_iso2
        meta = country_meta_by_iso2.get(lookup_iso2, {}) if lookup_iso2 else {}
        source_type = (
            primary_rule.source_type
            if primary_rule and getattr(primary_rule, "source_type", "")
            else ("synthetic_fallback" if synthetic_owner_by_tag.get(tag, False) else "hoi4_owner")
        )
        if source_type == "hoi4_owner" and tag not in active_owner_tags:
            source_type = "scenario_extension"
        historical_fidelity = (
            primary_rule.historical_fidelity
            if primary_rule and getattr(primary_rule, "historical_fidelity", "")
            else ("extended" if source_type == "scenario_extension" else "vanilla")
        )
        scenario_only = (
            source_type != "hoi4_owner"
            or iso2_to_tag.get(base_iso2) != tag
            or synthetic_owner_by_tag.get(tag, False)
        )
        rule_sources = _dedupe_strings([rule.rule_id for rule in owner_rules])
        source_types = _dedupe_strings(
            [
                getattr(rule, "source_type", "") or ("synthetic_fallback" if synthetic_owner_by_tag.get(tag, False) else "hoi4_owner")
                for rule in owner_rules
            ]
        )
        if not source_types or (source_type != "hoi4_owner" and source_types == ["hoi4_owner"]):
            source_types = [source_type]
        historical_fidelity_summary = _dedupe_strings(
            [getattr(rule, "historical_fidelity", "") for rule in owner_rules]
        )
        if not historical_fidelity_summary:
            historical_fidelity_summary = [historical_fidelity]
        parent_owner_tags = _dedupe_strings(
            [getattr(rule, "parent_owner_tag", "") for rule in owner_rules]
            + [
                parent_tag
                for rule in owner_rules
                for parent_tag in (getattr(rule, "parent_owner_tags", []) or [])
            ]
        )
        primary_parent_owner_tag = (
            getattr(primary_rule, "parent_owner_tag", "")
            if primary_rule and getattr(primary_rule, "parent_owner_tag", "")
            else (parent_owner_tags[0] if parent_owner_tags else "")
        )
        if primary_parent_owner_tag and primary_parent_owner_tag not in parent_owner_tags:
            parent_owner_tags.insert(0, primary_parent_owner_tag)
        subject_kind = (
            str(getattr(primary_rule, "subject_kind", "") or "").strip().lower()
            if primary_rule
            else ""
        )
        entry_kind = (
            str(getattr(primary_rule, "entry_kind", "") or "").strip().lower()
            if primary_rule
            else ""
        )
        if not entry_kind and (primary_parent_owner_tag or parent_owner_tags or subject_kind):
            entry_kind = "scenario_subject"
        if entry_kind == "scenario_subject" and primary_parent_owner_tag:
            parent_color_hex = _get_palette_color_hex(primary_parent_owner_tag, palette_entries)
            color_hex = _derive_subject_color_hex(parent_color_hex, tag, subject_kind)
        if primary_rule and primary_rule.color_hex_override:
            color_hex = primary_rule.color_hex_override
        country_registry[tag] = ScenarioCountryRecord(
            tag=tag,
            display_name=display_name,
            color_hex=color_hex if color_hex.startswith("#") else "#808080",
            feature_count=feature_count,
            quality=_worst_quality(quality_by_tag[tag]),
            source=primary_source,
            base_iso2=base_iso2,
            lookup_iso2=lookup_iso2,
            provenance_iso2=base_iso2,
            scenario_only=scenario_only,
            featured=tag in featured_tags,
            capital_state_id=getattr(history, "capital_state_id", None),
            continent_id=str(meta.get("continent_id") or ""),
            continent_label=str(meta.get("continent_label") or ""),
            subregion_id=str(meta.get("subregion_id") or ""),
            subregion_label=str(meta.get("subregion_label") or ""),
            notes=(primary_rule.notes if primary_rule else ""),
            synthetic_owner=synthetic_owner_by_tag.get(tag, False),
            source_type=source_type,
            historical_fidelity=historical_fidelity,
            primary_rule_source=(primary_rule.rule_id if primary_rule else ""),
            rule_sources=rule_sources,
            source_types=source_types,
            historical_fidelity_summary=historical_fidelity_summary,
            parent_owner_tag=primary_parent_owner_tag,
            parent_owner_tags=parent_owner_tags,
            subject_kind=subject_kind,
            entry_kind=entry_kind,
        )

    return country_registry
