from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Iterator

from map_builder import config as cfg
from map_builder.io.writers import write_json_atomic, write_text_atomic
from map_builder.scenario_locks import scenario_build_lock
from map_builder.scenario_mutations import DEFAULT_SCENARIO_MUTATIONS_FILENAME
from map_builder.scenario_mutations import (
    default_scenario_mutations_payload,
    normalize_scenario_mutations_payload,
)


ROOT = Path(__file__).resolve().parents[1]
SCENARIO_INDEX_PATH = ROOT / "data" / "scenarios" / "index.json"
DEFAULT_SCENARIO_RELEASABLE_CATALOG_FILENAME = "releasable_catalog.manual.json"
DEFAULT_SCENARIO_DISTRICT_GROUPS_FILENAME = "district_groups.manual.json"
DEFAULT_SCENARIO_MANUAL_OVERRIDES_FILENAME = "scenario_manual_overrides.json"
DEFAULT_SCENARIO_CITY_OVERRIDES_FILENAME = "city_overrides.json"
DEFAULT_SCENARIO_CITY_ASSETS_PARTIAL_FILENAME = cfg.SCENARIO_CITY_ASSETS_PARTIAL_FILENAME
_REPO_PATH_LOCKS_GUARD = threading.Lock()
_REPO_PATH_LOCKS: dict[str, threading.RLock] = {}


class ScenarioContextError(Exception):
    def __init__(self, code: str, message: str, *, status: int = 400, details: object | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details


def _read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def read_json_or_none(path: Path | None) -> object | None:
    if not path or not path.exists():
        return None
    return _read_json(path)


def _get_repo_path_lock(path: Path) -> threading.RLock:
    lock_key = str(Path(path).resolve()).casefold()
    with _REPO_PATH_LOCKS_GUARD:
        lock = _REPO_PATH_LOCKS.get(lock_key)
        if lock is None:
            lock = threading.RLock()
            _REPO_PATH_LOCKS[lock_key] = lock
        return lock


def normalize_locked_paths(paths: list[Path | None]) -> list[Path]:
    normalized: list[Path] = []
    seen: set[str] = set()
    for raw_path in paths:
        if raw_path is None:
            continue
        resolved = Path(raw_path).resolve()
        key = str(resolved).casefold()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(resolved)
    normalized.sort(key=lambda value: str(value).casefold())
    return normalized


@contextmanager
def locked_repo_paths(paths: list[Path | None]) -> Iterator[None]:
    normalized_paths = normalize_locked_paths(paths)
    locks = [_get_repo_path_lock(path) for path in normalized_paths]
    for lock in locks:
        lock.acquire()
    try:
        yield
    finally:
        for lock in reversed(locks):
            lock.release()


def repo_relative(path: Path, *, root: Path = ROOT) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def now_iso() -> str:
    return datetime.now().astimezone().isoformat()


def capture_text_snapshot(path: Path) -> tuple[Path, bool, str]:
    if path.exists():
        return path, True, path.read_text(encoding="utf-8")
    return path, False, ""


def restore_text_snapshot(path: Path, *, existed: bool, original_text: str) -> None:
    if existed:
        write_text_atomic(path, original_text, encoding="utf-8")
    else:
        path.unlink(missing_ok=True)


def write_json_transaction(file_payloads: list[tuple[Path, object]]) -> None:
    with locked_repo_paths([path for path, _payload in file_payloads]):
        snapshots: list[tuple[Path, bool, str]] = []
        for path, _payload in file_payloads:
            path.parent.mkdir(parents=True, exist_ok=True)
            snapshots.append(capture_text_snapshot(path))
        try:
            for path, payload in file_payloads:
                write_json_atomic(path, payload, ensure_ascii=False, indent=2, trailing_newline=True)
        except Exception as exc:
            rollback_errors: list[str] = []
            for path, existed, original_text in reversed(snapshots):
                try:
                    restore_text_snapshot(path, existed=existed, original_text=original_text)
                except Exception as rollback_exc:
                    rollback_errors.append(f"{path}: {rollback_exc}")
            for error in rollback_errors:
                exc.add_note(f"Rollback failed: {error}")
            raise


def ensure_path_within_root(path: Path, *, root: Path = ROOT, error_cls: type[Exception] = ScenarioContextError) -> Path:
    resolved = path.resolve()
    try:
        resolved.relative_to(root.resolve())
    except ValueError as exc:
        raise error_cls(
            "path_outside_root",
            f"Refused to access a path outside the repository root: {path}",
            status=400,
        ) from exc
    return resolved


def resolve_repo_path(raw_path: object, *, root: Path = ROOT, error_cls: type[Exception] = ScenarioContextError) -> Path:
    text = str(raw_path or "").strip()
    if not text:
        raise error_cls("missing_path", "Required scenario path is missing.", status=400)
    return ensure_path_within_root(root / text, root=root, error_cls=error_cls)


def ensure_path_within_allowed_bases(
    path: Path,
    *,
    allowed_bases: tuple[Path, ...],
    label: str,
    root: Path = ROOT,
    error_cls: type[Exception] = ScenarioContextError,
) -> Path:
    resolved = ensure_path_within_root(path, root=root, error_cls=error_cls)
    normalized_bases = tuple(ensure_path_within_root(base, root=root, error_cls=error_cls) for base in allowed_bases if base)
    for base in normalized_bases:
        try:
            resolved.relative_to(base)
            return resolved
        except ValueError:
            continue
    allowed_display = ", ".join(repo_relative(base, root=root) for base in normalized_bases)
    raise error_cls(
        "path_not_allowed",
        f"{label} must stay within one of: {allowed_display}",
        status=400,
    )


def _load_scenario_index(*, root: Path = ROOT, error_cls: type[Exception] = ScenarioContextError) -> dict[str, object]:
    index_path = ensure_path_within_root(
        SCENARIO_INDEX_PATH if root == ROOT else root / "data" / "scenarios" / "index.json",
        root=root,
        error_cls=error_cls,
    )
    payload = _read_json(index_path)
    return payload if isinstance(payload, dict) else {}


def load_scenario_context(
    scenario_id: object,
    *,
    root: Path = ROOT,
    error_cls: type[Exception] = ScenarioContextError,
) -> dict[str, object]:
    normalized_id = str(scenario_id or "").strip()
    if not normalized_id:
        raise error_cls("missing_scenario_id", "Scenario id is required.", status=400)

    registry = _load_scenario_index(root=root, error_cls=error_cls)
    scenarios = registry.get("scenarios", []) if isinstance(registry, dict) else []
    scenario_entry = next(
        (entry for entry in scenarios if str(entry.get("scenario_id") or "").strip() == normalized_id),
        None,
    )
    if not scenario_entry:
        raise error_cls(
            "unknown_scenario",
            f'Scenario "{normalized_id}" was not found in the scenario registry.',
            status=404,
        )

    manifest_path = resolve_repo_path(scenario_entry.get("manifest_url"), root=root, error_cls=error_cls)
    if not manifest_path.exists():
        raise error_cls(
            "missing_manifest",
            f'Manifest for scenario "{normalized_id}" does not exist: {manifest_path}',
            status=404,
        )
    manifest = _read_json(manifest_path)
    scenario_dir = ensure_path_within_root(manifest_path.parent, root=root, error_cls=error_cls)
    shared_data_dir = ensure_path_within_root(root / "data", root=root, error_cls=error_cls)
    tools_dir = ensure_path_within_root(root / "tools", root=root, error_cls=error_cls)

    owners_path = resolve_repo_path(manifest.get("owners_url"), root=root, error_cls=error_cls)
    countries_path = resolve_repo_path(manifest.get("countries_url"), root=root, error_cls=error_cls)
    controllers_url = str(manifest.get("controllers_url") or "").strip()
    cores_url = str(manifest.get("cores_url") or "").strip()
    releasable_catalog_url = str(manifest.get("releasable_catalog_url") or "").strip()
    district_groups_url = str(manifest.get("district_groups_url") or "").strip()
    city_overrides_url = str(manifest.get("city_overrides_url") or "").strip()
    capital_hints_url = str(manifest.get("capital_hints_url") or "").strip()
    geo_locale_patch_url = str(
        manifest.get("geo_locale_patch_url")
        or manifest.get("geo_locale_patch_url_en")
        or manifest.get("geo_locale_patch_url_zh")
        or ""
    ).strip()
    geo_locale_builder_url = str(manifest.get("geo_locale_builder_url") or "").strip()
    controllers_path = resolve_repo_path(controllers_url, root=root, error_cls=error_cls) if controllers_url else None
    cores_path = resolve_repo_path(cores_url, root=root, error_cls=error_cls) if cores_url else None
    releasable_catalog_path = (
        resolve_repo_path(releasable_catalog_url, root=root, error_cls=error_cls)
        if releasable_catalog_url
        else None
    )
    district_groups_path = (
        resolve_repo_path(district_groups_url, root=root, error_cls=error_cls)
        if district_groups_url
        else scenario_dir / DEFAULT_SCENARIO_DISTRICT_GROUPS_FILENAME
    )
    city_overrides_path = (
        resolve_repo_path(city_overrides_url, root=root, error_cls=error_cls)
        if city_overrides_url
        else scenario_dir / DEFAULT_SCENARIO_CITY_OVERRIDES_FILENAME
    )
    city_assets_partial_path = ensure_path_within_root(
        scenario_dir / DEFAULT_SCENARIO_CITY_ASSETS_PARTIAL_FILENAME,
        root=root,
        error_cls=error_cls,
    )
    capital_hints_path = (
        resolve_repo_path(capital_hints_url, root=root, error_cls=error_cls)
        if capital_hints_url
        else scenario_dir / "capital_hints.json"
    )
    capital_defaults_partial_path = ensure_path_within_root(
        scenario_dir / cfg.SCENARIO_CAPITAL_DEFAULTS_PARTIAL_FILENAME,
        root=root,
        error_cls=error_cls,
    )
    geo_locale_patch_path = (
        resolve_repo_path(geo_locale_patch_url, root=root, error_cls=error_cls)
        if geo_locale_patch_url
        else None
    )
    geo_locale_builder_path = (
        resolve_repo_path(geo_locale_builder_url, root=root, error_cls=error_cls)
        if geo_locale_builder_url
        else None
    )

    for candidate in (
        manifest_path,
        owners_path,
        countries_path,
        controllers_path,
        cores_path,
        city_overrides_path,
        city_assets_partial_path,
        capital_hints_path,
        capital_defaults_partial_path,
        geo_locale_patch_path,
        district_groups_path,
    ):
        if candidate:
            ensure_path_within_allowed_bases(
                candidate,
                allowed_bases=(scenario_dir,),
                label="Scenario file",
                root=root,
                error_cls=error_cls,
            )
    if releasable_catalog_path:
        releasable_catalog_path = ensure_path_within_allowed_bases(
            releasable_catalog_path,
            allowed_bases=(scenario_dir, shared_data_dir),
            label="Releasable catalog path",
            root=root,
            error_cls=error_cls,
        )
    if geo_locale_builder_path:
        geo_locale_builder_path = ensure_path_within_allowed_bases(
            geo_locale_builder_path,
            allowed_bases=(scenario_dir, tools_dir),
            label="Geo locale builder path",
            root=root,
            error_cls=error_cls,
        )

    return {
        "scenarioId": normalized_id,
        "manifest": manifest,
        "manifestPath": manifest_path,
        "scenarioDir": scenario_dir,
        "ownersPath": owners_path,
        "countriesPath": countries_path,
        "controllersPath": controllers_path,
        "coresPath": cores_path,
        "releasableCatalogUrl": releasable_catalog_url,
        "releasableCatalogPath": releasable_catalog_path,
        "releasableCatalogLocalPath": ensure_path_within_root(
            scenario_dir / DEFAULT_SCENARIO_RELEASABLE_CATALOG_FILENAME,
            root=root,
            error_cls=error_cls,
        ),
        "districtGroupsUrl": district_groups_url,
        "districtGroupsPath": district_groups_path,
        "cityOverridesUrl": city_overrides_url,
        "cityOverridesPath": city_overrides_path,
        "cityAssetsPartialPath": city_assets_partial_path,
        "capitalHintsUrl": capital_hints_url,
        "capitalHintsPath": capital_hints_path,
        "capitalDefaultsPartialPath": capital_defaults_partial_path,
        "geoLocalePatchPath": geo_locale_patch_path,
        "geoLocaleBuilderPath": geo_locale_builder_path,
        "manualGeoOverridesPath": ensure_path_within_root(
            scenario_dir / "geo_name_overrides.manual.json",
            root=root,
            error_cls=error_cls,
        ),
        "manualOverridesPath": ensure_path_within_root(
            scenario_dir / DEFAULT_SCENARIO_MANUAL_OVERRIDES_FILENAME,
            root=root,
            error_cls=error_cls,
        ),
        "mutationsPath": ensure_path_within_root(
            scenario_dir / DEFAULT_SCENARIO_MUTATIONS_FILENAME,
            root=root,
            error_cls=error_cls,
        ),
    }


def scenario_transaction_paths(context: dict[str, object]) -> list[Path]:
    paths: list[Path | None] = [
        Path(context["manifestPath"]),
        Path(context["countriesPath"]),
        Path(context["ownersPath"]),
        context.get("controllersPath"),
        context.get("coresPath"),
        Path(context["releasableCatalogLocalPath"]),
        Path(context["districtGroupsPath"]),
        Path(context["cityOverridesPath"]),
        Path(context["cityAssetsPartialPath"]),
        Path(context["capitalHintsPath"]),
        Path(context["capitalDefaultsPartialPath"]),
        Path(context["manualOverridesPath"]),
        Path(context["mutationsPath"]),
        context.get("geoLocalePatchPath"),
        Path(context["manualGeoOverridesPath"]),
    ]
    return normalize_locked_paths(paths)


def load_scenario_mutations_payload(context: dict[str, object]) -> dict[str, object]:
    mutations_path = Path(context["mutationsPath"])
    scenario_id = str(context["scenarioId"])
    payload = read_json_or_none(mutations_path)
    if payload is None:
        payload = default_scenario_mutations_payload(scenario_id)
    return normalize_scenario_mutations_payload(payload, scenario_id=scenario_id)


@contextmanager
def load_locked_scenario_context(
    scenario_id: object,
    *,
    root: Path = ROOT,
    extra_paths: list[Path | None] | None = None,
    holder: str = "scenario_context",
    transaction_id: str | None = None,
    error_cls: type[Exception] = ScenarioContextError,
) -> Iterator[dict[str, object]]:
    initial_context = load_scenario_context(scenario_id, root=root, error_cls=error_cls)
    lock_paths: list[Path | None] = list(scenario_transaction_paths(initial_context))
    if extra_paths:
        lock_paths.extend(extra_paths)
    with scenario_build_lock(
        root=root,
        scenario_id=str(initial_context["scenarioId"]),
        scenario_dir=Path(initial_context["scenarioDir"]),
        holder=holder,
        transaction_id=transaction_id,
    ):
        with locked_repo_paths(lock_paths):
            yield load_scenario_context(scenario_id, root=root, error_cls=error_cls)
