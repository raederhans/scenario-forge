#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import sys

import geopandas as gpd
import pandas as pd
from shapely.ops import unary_union

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scenario_builder.hoi4.parser import parse_country_histories, parse_states  # noqa: E402
from tools.patch_tno_1962_bundle import (  # noqa: E402
    SCENARIO_DIR,
    extract_state_geometry_raw,
    load_hgo_context,
    load_json,
    normalize_polygonal,
    safe_unary_union,
    topology_object_to_gdf,
)


DEFAULT_TNO_ROOTS = [
    Path(r"C:\Program Files (x86)\Steam\steamapps\workshop\content\394360\2438003901"),
    Path("/mnt/c/Program Files (x86)/Steam/steamapps/workshop/content/394360/2438003901"),
]
DEFAULT_RULES_PATH = PROJECT_ROOT / "data/scenario-rules/tno_1962.russia_ownership.manual.json"
DEFAULT_REPORT_JSON = PROJECT_ROOT / "reports/generated/scenarios/tno_1962_russia_audit.json"
DEFAULT_REPORT_MD = PROJECT_ROOT / "reports/generated/scenarios/tno_1962_russia_audit.md"
DEFAULT_AS_OF_DATE = "1962.1.1.1"
DIRECT_COVERAGE_THRESHOLD = 0.80
DIRECT_SPILL_THRESHOLD = 0.25
SALVAGE_COVERAGE_THRESHOLD = 0.65
SALVAGE_SPILL_THRESHOLD = 0.35
MIN_OVERLAP_SHARE = 0.01

FREEZE_OWNER_TAGS = {"RKM", "AMR", "BRY", "IRK", "CHT", "MAG", "YAK", "OMO", "KMC"}
AUDIT_ONLY_TAGS = {"AMR", "BRY", "IRK", "CHT", "MAG", "YAK", "OMO", "KMC", "KAZ", "TAN"}

REGION_BY_TAG = {
    "WRS": "west_russia",
    "ONG": "west_russia",
    "VOL": "west_russia",
    "GOR": "west_russia",
    "KOM": "west_russia",
    "VYT": "west_russia",
    "PRM": "west_russia",
    "SAM": "west_russia",
    "BKR": "south_urals_outer",
    "URL": "south_urals_outer",
    "ORE": "south_urals_outer",
    "ZLT": "south_urals_outer",
    "KAZ": "south_urals_outer",
    "OMS": "west_central_siberia",
    "SVR": "west_central_siberia",
    "ALT": "west_central_siberia",
    "KEM": "west_central_siberia",
    "KRS": "west_central_siberia",
    "NOV": "west_central_siberia",
    "TOM": "west_central_siberia",
    "SBA": "west_central_siberia",
    "TAN": "west_central_siberia",
    "AMR": "far_east",
    "BRY": "far_east",
    "IRK": "far_east",
    "CHT": "far_east",
    "MAG": "far_east",
    "YAK": "far_east",
    "OMO": "far_east",
    "KMC": "far_east",
}
SCOPE_TAGS = list(REGION_BY_TAG.keys())
RUSSIAN_REGION_IDS = {"west_russia", "south_urals_outer", "west_central_siberia", "far_east"}
RUSSIAN_REGION_META = {
    region_id: {
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
    }
    for region_id in RUSSIAN_REGION_IDS
}
RUSSIAN_REGION_META["south_urals_outer_kaz"] = {
    "continent_id": "continent_asia",
    "continent_label": "Asia",
    "subregion_id": "subregion_central_asia",
    "subregion_label": "Central Asia",
    "base_iso2": "KZ",
}
HGO_DONOR_HINTS = {
    "KAZ": "same_tag",
    "TAN": "same_tag",
    "OMS": "same_tag",
    "TOM": "same_tag",
    "NOV": "proxy:NVO",
    "KEM": "proxy:KRV",
    "KOM": "proxy:KMI",
    "AMR": "proxy:AMU",
    "CHT": "proxy:TRA",
    "YAK": "proxy:YKT",
    "BRY": "proxy:BML/ABM/UBM",
}


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate TNO 1962 Russia audit matrix and ownership rules.")
    parser.add_argument("--tno-root", default="")
    parser.add_argument("--as-of-date", default=DEFAULT_AS_OF_DATE)
    parser.add_argument("--rules-output", default=str(DEFAULT_RULES_PATH))
    parser.add_argument("--report-json", default=str(DEFAULT_REPORT_JSON))
    parser.add_argument("--report-md", default=str(DEFAULT_REPORT_MD))
    return parser.parse_args()


def resolve_tno_root(explicit_root: str | Path | None = None) -> Path:
    candidates: list[Path] = []
    if explicit_root:
        candidates.append(Path(explicit_root))
    candidates.extend(DEFAULT_TNO_ROOTS)
    for candidate in candidates:
        if (
            candidate.exists()
            and (candidate / "map/provinces.bmp").exists()
            and (candidate / "map/definition.csv").exists()
            and (candidate / "history/states").exists()
            and (candidate / "history/countries").exists()
        ):
            return candidate
    raise FileNotFoundError(
        "Unable to locate the requested TNO root. Checked: "
        + ", ".join(str(candidate) for candidate in candidates)
    )


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def load_palette_entries() -> dict[str, dict]:
    payload = json.loads((PROJECT_ROOT / "data/palettes/tno.palette.json").read_text(encoding="utf-8"))
    entries = payload.get("entries", {}) if isinstance(payload, dict) else {}
    return {
        str(tag).strip().upper(): value
        for tag, value in entries.items()
        if str(tag).strip()
    }


def normalize_country_label(raw_label: str) -> str:
    parts = str(raw_label or "").split(" - ", 1)
    return parts[1].strip() if len(parts) == 2 else str(raw_label or "").strip()


def safe_intersection(geom, other):
    if geom is None or geom.is_empty or other is None or other.is_empty:
        return None
    try:
        return normalize_polygonal(geom.intersection(other))
    except Exception:
        repaired = normalize_polygonal(geom)
        repaired_other = normalize_polygonal(other)
        if repaired is None or repaired_other is None:
            return None
        try:
            return normalize_polygonal(repaired.intersection(repaired_other))
        except Exception:
            return None


def project_area(geom) -> float:
    candidate = normalize_polygonal(geom)
    if candidate is None:
        return 0.0
    return float(gpd.GeoSeries([candidate], crs="EPSG:4326").to_crs("EPSG:6933").area.iloc[0])


def select_features(runtime_gdf: gpd.GeoDataFrame, target_geom) -> gpd.GeoDataFrame:
    if target_geom is None or target_geom.is_empty:
        return runtime_gdf.iloc[0:0].copy()
    candidate_indexes = list(runtime_gdf.sindex.query(target_geom, predicate="intersects"))
    if not candidate_indexes:
        return runtime_gdf.iloc[0:0].copy()
    candidates = runtime_gdf.iloc[candidate_indexes].copy()
    intersection_geoms = [safe_intersection(geom, target_geom) for geom in candidates.geometry]
    candidates["intersection_area"] = (
        gpd.GeoSeries(intersection_geoms, crs="EPSG:4326").to_crs("EPSG:6933").area.fillna(0.0)
    )
    candidates["overlap_share"] = candidates["intersection_area"] / candidates["feature_area"].replace(0.0, 1.0)
    centroid_mask = pd.Series(
        [geom.representative_point().within(target_geom) for geom in candidates.geometry],
        index=candidates.index,
    )
    return candidates[(candidates["overlap_share"] >= MIN_OVERLAP_SHARE) | centroid_mask].copy()


def compute_metrics(feature_rows: gpd.GeoDataFrame, target_geom) -> tuple[float, float]:
    if feature_rows.empty or target_geom is None or target_geom.is_empty:
        return 0.0, 0.0
    selected_union = safe_unary_union(feature_rows.geometry.tolist())
    if selected_union is None or selected_union.is_empty:
        return 0.0, 0.0
    target_area = project_area(target_geom)
    selected_area = project_area(selected_union)
    intersection_area = project_area(safe_intersection(selected_union, target_geom))
    spill_area = selected_area - intersection_area
    coverage_ratio = (intersection_area / target_area) if target_area > 0 else 0.0
    spill_ratio = (spill_area / selected_area) if selected_area > 0 else 0.0
    return coverage_ratio, spill_ratio


def classify_row(
    *,
    tag: str,
    bundle_present: bool,
    state_count: int,
    final_rows: gpd.GeoDataFrame,
    coverage_ratio: float,
    spill_ratio: float,
    frozen_conflict_count: int,
) -> tuple[str, str]:
    if tag in AUDIT_ONLY_TAGS:
        return "frozen_or_done", "Frozen audit only"
    if bundle_present:
        return "frozen_or_done", "Keep existing bundle entry"
    if state_count == 0:
        return "defer", "Absent in latest TNO start"
    if final_rows.empty:
        return "defer", "Needs new mask or manual remap"
    if (
        frozen_conflict_count == 0
        and coverage_ratio >= DIRECT_COVERAGE_THRESHOLD
        and spill_ratio <= DIRECT_SPILL_THRESHOLD
    ):
        return "direct", "Generate first-batch feature rule"
    if coverage_ratio >= SALVAGE_COVERAGE_THRESHOLD and spill_ratio <= SALVAGE_SPILL_THRESHOLD:
        if frozen_conflict_count > 0:
            return "salvage", "Generate first-batch rule after pruning frozen overlap"
        return "salvage", "Generate first-batch feature rule"
    if frozen_conflict_count > 0:
        return "frozen_or_done", "Blocked by frozen Moskowien or Far East boundary"
    return "defer", "Hold for phase two"


def build_follow_up_note(
    *,
    tag: str,
    category: str,
    state_count: int,
    bundle_present: bool,
    frozen_conflict_tags: list[str],
    frozen_conflict_count: int,
) -> str:
    if tag in AUDIT_ONLY_TAGS:
        if tag == "KAZ":
            return "Already present in the current bundle. Leave the Kazakhstan implementation unchanged."
        if tag == "TAN":
            return "Current bundle already carries Tannu Tuva while latest TNO start no longer assigns it Russian warlord states."
        return (
            "Frozen: current Far East implementation stays untouched. If revisited later, rebuild the mask "
            "from exact TNO state unions plus HGO donor provinces."
        )
    if bundle_present:
        return "Already present in the current bundle. Preserve the existing ownership layer."
    if state_count == 0:
        return "Latest TNO 1962 bookmark does not assign any start-state ownership to this tag."
    if category == "salvage" and frozen_conflict_count > 0:
        return (
            "Pruned frozen overlap owned by "
            + ", ".join(frozen_conflict_tags)
            + ". If revisited, re-audit against the Moskowien freeze gate before adding any excluded features."
        )
    if category == "frozen_or_done" and frozen_conflict_count > 0:
        return (
            "Touches frozen ownership held by "
            + ", ".join(frozen_conflict_tags)
            + ". Enabling this tag safely requires a dedicated boundary review."
        )
    if category == "defer":
        return "Current feature set is not close enough for safe first-batch inclusion. Revisit with finer donor masks."
    return "Current feature set is sufficient for a first-batch scenario rule."


def resolve_region_meta(tag: str) -> dict[str, str]:
    if tag == "KAZ":
        return dict(RUSSIAN_REGION_META["south_urals_outer_kaz"])
    return dict(RUSSIAN_REGION_META[REGION_BY_TAG[tag]])


def build_rule_note(tag: str, coverage_ratio: float, spill_ratio: float, frozen_pruned_count: int) -> str:
    parts = [
        "Generated from exact TNO 1962 state-owner geometry crosswalk against the current runtime feature set.",
        f"coverage={coverage_ratio:.3f}",
        f"spill={spill_ratio:.3f}",
    ]
    if frozen_pruned_count:
        parts.append(f"pruned_frozen_features={frozen_pruned_count}")
    return " ".join(parts)


def is_generated_russia_entry(entry: object) -> bool:
    if not isinstance(entry, dict):
        return False
    primary_rule_source = str(entry.get("primary_rule_source") or "").strip().lower()
    if primary_rule_source.startswith("tno_1962_russia_"):
        return True
    for value in entry.get("rule_sources") or []:
        if str(value or "").strip().lower().startswith("tno_1962_russia_"):
            return True
    return False


def render_markdown(report_payload: dict) -> str:
    lines = [
        "# TNO 1962 Russia Audit",
        "",
        f"- Generated at: `{report_payload['generated_at']}`",
        f"- Scenario id: `{report_payload['scenario_id']}`",
        f"- TNO root: `{report_payload['tno_root']}`",
        "",
        "## Summary",
        "",
        f"- Audited tags: `{report_payload['summary']['audited_tag_count']}`",
        f"- Generated rules: `{report_payload['summary']['generated_rule_count']}`",
        f"- Direct candidates: `{report_payload['summary']['category_counts'].get('direct', 0)}`",
        f"- Salvage candidates: `{report_payload['summary']['category_counts'].get('salvage', 0)}`",
        f"- Frozen or done: `{report_payload['summary']['category_counts'].get('frozen_or_done', 0)}`",
        f"- Deferred: `{report_payload['summary']['category_counts'].get('defer', 0)}`",
        "",
        "## Matrix",
        "",
        "| region | tag | tno_state_count | bundle_present | touches_frozen | hgo_donor | whole_apply | recommendation | follow_up | coverage_ratio | spill_ratio | frozen_conflict_count |",
        "| --- | --- | ---: | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |",
    ]
    for row in report_payload["rows"]:
        lines.append(
            f"| `{row['region']}` | `{row['tag']}` | {row['tno_state_count']} | "
            f"`{row['bundle_present']}` | `{row['touches_frozen']}` | `{row['hgo_donor_status']}` | "
            f"`{row['whole_apply']}` | `{row['recommendation']}` | {row['follow_up']} | "
            f"{row['coverage_ratio']:.3f} | {row['spill_ratio']:.3f} | {row['frozen_conflict_count']} |"
        )

    lines.extend(["", "## Generated Rules", ""])
    generated_tags = report_payload["generated_rule_tags"]
    lines.append(", ".join(f"`{tag}`" for tag in generated_tags) if generated_tags else "None")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    tno_root = resolve_tno_root(args.tno_root or None)
    scenario_countries_payload = json.loads((SCENARIO_DIR / "countries.json").read_text(encoding="utf-8"))
    scenario_owners_payload = json.loads((SCENARIO_DIR / "owners.by_feature.json").read_text(encoding="utf-8"))
    scenario_countries = scenario_countries_payload.get("countries", {})
    scenario_owners = {
        str(feature_id).strip(): str(owner_tag).strip().upper()
        for feature_id, owner_tag in scenario_owners_payload.get("owners", {}).items()
        if str(feature_id).strip()
    }
    tno_country_histories = parse_country_histories(tno_root / "history/countries")
    tno_states = parse_states(tno_root / "history/states", as_of_date=args.as_of_date)
    tno_context = load_hgo_context(tno_root)
    palette_entries = load_palette_entries()

    runtime_gdf = topology_object_to_gdf(load_json(SCENARIO_DIR / "runtime_topology.topo.json"), "political")
    runtime_gdf = runtime_gdf.loc[runtime_gdf["id"].astype(str).isin(set(scenario_owners.keys()))].copy()
    runtime_gdf["feature_id"] = runtime_gdf["id"].astype(str)
    runtime_gdf["owner_tag"] = runtime_gdf["feature_id"].map(scenario_owners)
    runtime_gdf["geometry"] = runtime_gdf.geometry.apply(normalize_polygonal)
    runtime_gdf = runtime_gdf.loc[~runtime_gdf.geometry.isna()].copy()
    runtime_gdf["feature_area"] = runtime_gdf.to_crs("EPSG:6933").area

    rows: list[dict[str, object]] = []
    country_rules: list[dict[str, object]] = []

    for tag in SCOPE_TAGS:
        state_ids = [state_id for state_id, record in tno_states.items() if record.owner_tag == tag]
        existing_country = scenario_countries.get(tag, {})
        bundle_present = bool(existing_country) and not is_generated_russia_entry(existing_country)
        history_entry = tno_country_histories.get(tag)
        palette_entry = palette_entries.get(tag, {})
        country_file_label = str(getattr(history_entry, "file_label", "") or "").strip()
        country_file_path = f"history/countries/{country_file_label}.txt" if country_file_label else ""
        display_name = (
            normalize_country_label(country_file_label)
            or str(palette_entry.get("localized_name") or "").strip()
            or tag
        )
        selected_rows = runtime_gdf.iloc[0:0].copy()
        final_rows = runtime_gdf.iloc[0:0].copy()
        coverage_ratio = 0.0
        spill_ratio = 0.0
        frozen_conflict_feature_ids: list[str] = []
        frozen_conflict_tags: list[str] = []

        if state_ids:
            state_union = normalize_polygonal(
                unary_union([extract_state_geometry_raw(tno_context, state_id) for state_id in state_ids])
            )
            selected_rows = select_features(runtime_gdf, state_union)
            frozen_conflict_rows = selected_rows.loc[selected_rows["owner_tag"].isin(FREEZE_OWNER_TAGS)].copy()
            frozen_conflict_feature_ids = sorted(frozen_conflict_rows["feature_id"].astype(str).tolist())
            frozen_conflict_tags = sorted(
                {
                    str(owner_tag).strip().upper()
                    for owner_tag in frozen_conflict_rows["owner_tag"].tolist()
                    if str(owner_tag).strip()
                }
            )
            final_rows = selected_rows.copy()
            if tag not in AUDIT_ONLY_TAGS and not final_rows.empty:
                final_rows = final_rows.loc[~final_rows["owner_tag"].isin(FREEZE_OWNER_TAGS)].copy()
            coverage_ratio, spill_ratio = compute_metrics(final_rows, state_union)

        category, recommendation = classify_row(
            tag=tag,
            bundle_present=bundle_present,
            state_count=len(state_ids),
            final_rows=final_rows,
            coverage_ratio=coverage_ratio,
            spill_ratio=spill_ratio,
            frozen_conflict_count=len(frozen_conflict_feature_ids),
        )

        row = {
            "region": REGION_BY_TAG[tag],
            "tag": tag,
            "tno_state_count": len(state_ids),
            "tno_state_ids": state_ids,
            "bundle_present": bundle_present,
            "touches_frozen": bool(tag in AUDIT_ONLY_TAGS or frozen_conflict_feature_ids),
            "hgo_donor_status": HGO_DONOR_HINTS.get(tag, "none"),
            "whole_apply": bool(category == "direct" and len(frozen_conflict_feature_ids) == 0),
            "recommendation": recommendation,
            "category": category,
            "follow_up": build_follow_up_note(
                tag=tag,
                category=category,
                state_count=len(state_ids),
                bundle_present=bundle_present,
                frozen_conflict_tags=frozen_conflict_tags,
                frozen_conflict_count=len(frozen_conflict_feature_ids),
            ),
            "coverage_ratio": round(coverage_ratio, 6),
            "spill_ratio": round(spill_ratio, 6),
            "frozen_conflict_count": len(frozen_conflict_feature_ids),
            "frozen_conflict_tags": frozen_conflict_tags,
            "tno_country_file": country_file_path,
            "tno_country_file_label": country_file_label,
            "color_hex": str(palette_entry.get("map_hex") or "").strip(),
            "display_name": display_name,
            "capital_state_id": getattr(history_entry, "capital_state_id", None),
            "selected_feature_count": int(len(final_rows)),
            "selected_feature_ids": sorted(final_rows["feature_id"].astype(str).tolist()),
            "owner_breakdown_before_rewrite": dict(Counter(final_rows["owner_tag"].astype(str).tolist()).most_common(8)),
            "bundle_feature_count": int(scenario_countries.get(tag, {}).get("feature_count", 0) or 0),
        }
        rows.append(row)

        if category not in {"direct", "salvage"} or bundle_present or final_rows.empty:
            continue

        region_meta = resolve_region_meta(tag)
        quality = "manual_reviewed" if category == "direct" else "approx_existing_geometry"
        country_rules.append(
            {
                "rule_id": f"tno_1962_russia_{tag.lower()}",
                "tag": tag,
                "display_name": display_name,
                "color_hex": str(palette_entry.get("map_hex") or "").strip() or "",
                "base_iso2": region_meta["base_iso2"],
                "lookup_iso2": region_meta["base_iso2"],
                "provenance_iso2": region_meta["base_iso2"],
                "continent_id": region_meta["continent_id"],
                "continent_label": region_meta["continent_label"],
                "subregion_id": region_meta["subregion_id"],
                "subregion_label": region_meta["subregion_label"],
                "quality": quality,
                "source": "manual_rule",
                "source_type": "scenario_extension",
                "historical_fidelity": "tno_baseline",
                "featured": False,
                "scenario_only": True,
                "entry_kind": "scenario_country",
                "capital_state_id": getattr(history_entry, "capital_state_id", None),
                "include_feature_ids": row["selected_feature_ids"],
                "notes": build_rule_note(
                    tag,
                    coverage_ratio=coverage_ratio,
                    spill_ratio=spill_ratio,
                    frozen_pruned_count=len(frozen_conflict_feature_ids),
                ),
            }
        )

    rules_payload = {
        "version": 1,
        "scenario_id": "tno_1962",
        "notes": (
            "Generated ownership layer for first-batch Russian warlord and outer-ring audits. "
            "Uses exact TNO 1962 state ownership from the user-pinned workshop root and projects it "
            "onto the current feature set."
        ),
        "apply_to_controllers": True,
        "apply_to_cores": True,
        "retired_tags": [],
        "country_rules": country_rules,
    }

    summary = {
        "audited_tag_count": len(rows),
        "generated_rule_count": len(country_rules),
        "generated_rule_tags": [rule["tag"] for rule in country_rules],
        "category_counts": dict(Counter(row["category"] for row in rows)),
    }
    report_payload = {
        "version": 1,
        "scenario_id": "tno_1962",
        "generated_at": utc_timestamp(),
        "tno_root": str(tno_root),
        "as_of_date": args.as_of_date,
        "selection_policy": {
            "min_overlap_share": MIN_OVERLAP_SHARE,
            "direct_coverage_threshold": DIRECT_COVERAGE_THRESHOLD,
            "direct_spill_threshold": DIRECT_SPILL_THRESHOLD,
            "salvage_coverage_threshold": SALVAGE_COVERAGE_THRESHOLD,
            "salvage_spill_threshold": SALVAGE_SPILL_THRESHOLD,
            "frozen_owner_tags": sorted(FREEZE_OWNER_TAGS),
            "audit_only_tags": sorted(AUDIT_ONLY_TAGS),
        },
        "summary": summary,
        "generated_rule_tags": [rule["tag"] for rule in country_rules],
        "rows": rows,
    }

    rules_output = Path(args.rules_output)
    report_json = Path(args.report_json)
    report_md = Path(args.report_md)
    write_json(rules_output, rules_payload)
    write_json(report_json, report_payload)
    write_text(report_md, render_markdown(report_payload))

    print(f"Wrote rules: {rules_output}")
    print(f"Wrote report: {report_json}")
    print(f"Wrote report: {report_md}")
    print("Generated rule tags:", ", ".join(summary["generated_rule_tags"]) or "none")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
