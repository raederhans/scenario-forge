from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from map_builder.contracts import (
    SCENARIO_CHECKPOINT_GEO_LOCALE_FILENAME,
    SCENARIO_GEO_LOCALE_PATCH_FILENAMES_BY_LANGUAGE,
)

ROOT = Path(__file__).resolve().parents[1]

CHANGED_DOMAIN_POLITICAL = "political"
CHANGED_DOMAIN_WATER = "water"
CHANGED_DOMAIN_GEO_LOCALE = "geo-locale"
CHANGED_DOMAIN_STARTUP = "startup"
CHANGED_DOMAIN_CHUNK = "chunk"
CHANGED_DOMAIN_FULL = "full"

CHANGED_DOMAIN_CHOICES = (
    CHANGED_DOMAIN_POLITICAL,
    CHANGED_DOMAIN_WATER,
    CHANGED_DOMAIN_GEO_LOCALE,
    CHANGED_DOMAIN_STARTUP,
    CHANGED_DOMAIN_CHUNK,
    CHANGED_DOMAIN_FULL,
)

STAGE_COUNTRIES = "countries"
STAGE_WATER_STATE = "water_state"
STAGE_RUNTIME_TOPOLOGY = "runtime_topology"
STAGE_GEO_LOCALE = "geo_locale"
STAGE_STARTUP_SUPPORT_ASSETS = "startup_support_assets"
STAGE_STARTUP_BUNDLE_ASSETS = "startup_bundle_assets"
STAGE_STARTUP_ASSETS = "startup_assets"
STAGE_WRITE_BUNDLE = "write_bundle"
STAGE_CHUNK_ASSETS = "chunk_assets"


@dataclass(frozen=True)
class TnoRebuildPlan:
    changed_domain: str
    stage_sequence: tuple[str, ...]
    publish_scope: str | None = None
    publish_targets: tuple[str, ...] = ()


def resolve_tno_rebuild_plan(changed_domain: str) -> TnoRebuildPlan:
    normalized = str(changed_domain or "").strip().lower()
    if normalized not in CHANGED_DOMAIN_CHOICES:
        raise ValueError(f"Unsupported changed domain: {changed_domain}")
    mapping = {
        CHANGED_DOMAIN_POLITICAL: TnoRebuildPlan(
            changed_domain=normalized,
            stage_sequence=(
                STAGE_COUNTRIES,
                STAGE_WATER_STATE,
                STAGE_RUNTIME_TOPOLOGY,
                STAGE_STARTUP_SUPPORT_ASSETS,
                STAGE_STARTUP_BUNDLE_ASSETS,
                STAGE_WRITE_BUNDLE,
                STAGE_CHUNK_ASSETS,
            ),
            publish_scope="all",
        ),
        CHANGED_DOMAIN_WATER: TnoRebuildPlan(
            changed_domain=normalized,
            stage_sequence=(
                STAGE_WATER_STATE,
                STAGE_RUNTIME_TOPOLOGY,
                STAGE_STARTUP_SUPPORT_ASSETS,
                STAGE_STARTUP_BUNDLE_ASSETS,
                STAGE_WRITE_BUNDLE,
                STAGE_CHUNK_ASSETS,
            ),
            publish_scope="all",
        ),
        CHANGED_DOMAIN_GEO_LOCALE: TnoRebuildPlan(
            changed_domain=normalized,
            stage_sequence=(
                STAGE_GEO_LOCALE,
                STAGE_STARTUP_SUPPORT_ASSETS,
            ),
            publish_targets=("geo-locale", "startup-support-assets"),
        ),
        CHANGED_DOMAIN_STARTUP: TnoRebuildPlan(
            changed_domain=normalized,
            stage_sequence=(
                STAGE_STARTUP_SUPPORT_ASSETS,
                STAGE_STARTUP_BUNDLE_ASSETS,
            ),
            publish_targets=("startup-support-assets", "startup-bundle-assets"),
        ),
        CHANGED_DOMAIN_CHUNK: TnoRebuildPlan(
            changed_domain=normalized,
            stage_sequence=(STAGE_CHUNK_ASSETS,),
        ),
        CHANGED_DOMAIN_FULL: TnoRebuildPlan(
            changed_domain=normalized,
            stage_sequence=(
                STAGE_COUNTRIES,
                STAGE_WATER_STATE,
                STAGE_RUNTIME_TOPOLOGY,
                STAGE_GEO_LOCALE,
                STAGE_STARTUP_SUPPORT_ASSETS,
                STAGE_STARTUP_BUNDLE_ASSETS,
                STAGE_WRITE_BUNDLE,
                STAGE_CHUNK_ASSETS,
            ),
            publish_scope="all",
        ),
    }
    return mapping[normalized]


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _relative_label(path: Path, *, scenario_dir: Path) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(scenario_dir.resolve()).as_posix()
    except ValueError:
        try:
            return resolved.relative_to(ROOT).as_posix()
        except ValueError:
            return str(resolved)


def _hash_inputs(paths: list[Path], *, scenario_dir: Path) -> dict[str, object]:
    entries: dict[str, object] = {}
    for path in paths:
        resolved = path.resolve()
        label = _relative_label(resolved, scenario_dir=scenario_dir)
        if not resolved.exists():
            entries[label] = {"exists": False}
            continue
        if resolved.is_dir():
            entries[label] = {
                "exists": True,
                "kind": "dir",
                "children": sorted(child.name for child in resolved.iterdir()),
            }
            continue
        entries[label] = {
            "exists": True,
            "kind": "file",
            "sha256": _sha256_path(resolved),
            "size": resolved.stat().st_size,
        }
    return entries


def compute_tno_stage_signature_payload(
    stage: str,
    *,
    scenario_dir: Path,
    checkpoint_dir: Path,
    refresh_named_water_snapshot: bool = False,
    tno_root: Path | None = None,
    hgo_root: Path | None = None,
) -> dict[str, object]:
    scenario_dir = Path(scenario_dir).resolve()
    checkpoint_dir = Path(checkpoint_dir).resolve()
    shared_inputs = {
        STAGE_COUNTRIES: [
            scenario_dir / "manifest.json",
            scenario_dir / "scenario_mutations.json",
            scenario_dir / "city_assets.partial.json",
            scenario_dir / "capital_defaults.partial.json",
            scenario_dir / "geo_locale_reviewed_exceptions.json",
            ROOT / "data" / "europe_topology.runtime_political_v1.json",
            ROOT / "data" / "releasables" / "tno_1962.internal.phase1.source.json",
            ROOT / "data" / "releasables" / "tno_1962.internal.phase1.catalog.json",
            ROOT / "tools" / "patch_tno_1962_bundle.py",
        ],
        STAGE_WATER_STATE: [
            checkpoint_dir / "scenario_political.geojson",
            checkpoint_dir / "stage_metadata.json",
            scenario_dir / "derived" / "marine_regions_named_waters.snapshot.geojson",
            scenario_dir / "derived" / "water_regions.provenance.json",
            ROOT / "data" / "water_regions.geojson",
            ROOT / "tools" / "patch_tno_1962_bundle.py",
            *(([
                Path(tno_root) / "map" / "provinces.bmp",
                Path(tno_root) / "map" / "definition.csv",
            ]) if tno_root else []),
            *(([
                Path(hgo_root) / "map" / "provinces.bmp",
                Path(hgo_root) / "map" / "definition.csv",
            ]) if hgo_root else []),
        ],
        STAGE_RUNTIME_TOPOLOGY: [
            checkpoint_dir / "countries.json",
            checkpoint_dir / "owners.by_feature.json",
            checkpoint_dir / "controllers.by_feature.json",
            checkpoint_dir / "cores.by_feature.json",
            checkpoint_dir / "scenario_political.geojson",
            checkpoint_dir / "scenario_water_seed.geojson",
            checkpoint_dir / "land_mask.geojson",
            checkpoint_dir / "context_land_mask.geojson",
            checkpoint_dir / "water_stage_metadata.json",
            ROOT / "tools" / "patch_tno_1962_bundle.py",
        ],
        STAGE_GEO_LOCALE: [
            checkpoint_dir / "runtime_topology.topo.json",
            scenario_dir / "geo_name_overrides.manual.json",
            scenario_dir / "geo_locale_reviewed_exceptions.json",
            ROOT / "data" / "locales.json",
            ROOT / "tools" / "build_tno_1962_geo_locale_patch.py",
        ],
        STAGE_STARTUP_SUPPORT_ASSETS: [
            checkpoint_dir / "manifest.json",
            checkpoint_dir / "runtime_topology.topo.json",
            checkpoint_dir / SCENARIO_CHECKPOINT_GEO_LOCALE_FILENAME,
            checkpoint_dir / SCENARIO_GEO_LOCALE_PATCH_FILENAMES_BY_LANGUAGE["en"],
            checkpoint_dir / SCENARIO_GEO_LOCALE_PATCH_FILENAMES_BY_LANGUAGE["zh"],
            scenario_dir / "derived" / "startup_support_whitelist.json",
            ROOT / "data" / "locales.json",
            ROOT / "data" / "geo_aliases.json",
            ROOT / "tools" / "build_startup_bootstrap_assets.py",
        ],
        STAGE_STARTUP_BUNDLE_ASSETS: [
            checkpoint_dir / "manifest.json",
            checkpoint_dir / "countries.json",
            checkpoint_dir / "owners.by_feature.json",
            checkpoint_dir / "controllers.by_feature.json",
            checkpoint_dir / "cores.by_feature.json",
            checkpoint_dir / "runtime_topology.topo.json",
            checkpoint_dir / "runtime_topology.bootstrap.topo.json",
            ROOT / "data" / "manifest.json",
            ROOT / "data" / "europe_topology.na_v2.json",
            ROOT / "tools" / "build_startup_bundle.py",
        ],
        STAGE_STARTUP_ASSETS: [
            checkpoint_dir / "manifest.json",
            checkpoint_dir / "countries.json",
            checkpoint_dir / "owners.by_feature.json",
            checkpoint_dir / "controllers.by_feature.json",
            checkpoint_dir / "cores.by_feature.json",
            checkpoint_dir / "runtime_topology.topo.json",
            checkpoint_dir / "runtime_topology.bootstrap.topo.json",
            checkpoint_dir / SCENARIO_CHECKPOINT_GEO_LOCALE_FILENAME,
            checkpoint_dir / SCENARIO_GEO_LOCALE_PATCH_FILENAMES_BY_LANGUAGE["en"],
            checkpoint_dir / SCENARIO_GEO_LOCALE_PATCH_FILENAMES_BY_LANGUAGE["zh"],
            ROOT / "data" / "manifest.json",
            ROOT / "data" / "locales.json",
            ROOT / "data" / "geo_aliases.json",
            ROOT / "data" / "europe_topology.na_v2.json",
            ROOT / "tools" / "build_startup_bootstrap_assets.py",
            ROOT / "tools" / "build_startup_bundle.py",
        ],
        STAGE_CHUNK_ASSETS: [
            scenario_dir / "manifest.json",
            scenario_dir / "runtime_topology.topo.json",
            scenario_dir / "runtime_topology.bootstrap.topo.json",
            scenario_dir / "water_regions.geojson",
            scenario_dir / "special_regions.geojson",
            scenario_dir / "relief_overlays.geojson",
            scenario_dir / "city_overrides.json",
            ROOT / "tools" / "build_scenario_chunk_assets.py",
            ROOT / "tools" / "scenario_chunk_assets.py",
        ],
    }
    normalized_stage = str(stage or "").strip().lower()
    if normalized_stage not in shared_inputs:
        raise ValueError(f"Unsupported stage signature: {stage}")
    return {
        "stage": normalized_stage,
        "refresh_named_water_snapshot": bool(refresh_named_water_snapshot),
        "tno_root": str(Path(tno_root).resolve()) if tno_root else "",
        "hgo_root": str(Path(hgo_root).resolve()) if hgo_root else "",
        "inputs": _hash_inputs(shared_inputs[normalized_stage], scenario_dir=scenario_dir),
    }
