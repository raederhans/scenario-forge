from __future__ import annotations

import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

LANDING_ENTRY_CANDIDATES = (
    "landing/index.html",
    "site/index.html",
    "marketing/index.html",
    "index.html",
)
EDITOR_ENTRY_CANDIDATES = (
    "app/index.html",
    "editor/index.html",
    "workspace/index.html",
    "index.html",
)

LANDING_ENTRY_ENV_NAMES = (
    "MAPCREATOR_LANDING_ENTRY",
    "MAPCREATOR_LANDING_SOURCE",
)
EDITOR_ENTRY_ENV_NAMES = (
    "MAPCREATOR_EDITOR_ENTRY",
    "MAPCREATOR_EDITOR_SOURCE",
)

ALLOWED_ENTRY_ROOT_NAMES = (
    "landing",
    "site",
    "marketing",
    "app",
    "editor",
    "workspace",
)


def _resolve_repo_path(path: Path, *, root: Path) -> Path:
    resolved = path.resolve()
    try:
        resolved.relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError(f"Entry path is outside the repository root: {resolved}") from exc
    return resolved


def _allowed_entry_roots(*, root: Path) -> tuple[Path, ...]:
    return (root, *(root / name for name in ALLOWED_ENTRY_ROOT_NAMES))


def ensure_allowed_entry_path(path: Path, *, root: Path = ROOT, label: str = "entry") -> Path:
    resolved = _resolve_repo_path(path, root=root)
    if resolved.name.lower() != "index.html":
        raise ValueError(f"{label} must point to an index.html entry file: {resolved}")
    for base in _allowed_entry_roots(root=root):
        try:
            resolved.relative_to(base.resolve())
            return resolved
        except ValueError:
            continue
    allowed_display = ", ".join(
        base.resolve().relative_to(root.resolve()).as_posix() if base.resolve() != root.resolve() else "."
        for base in _allowed_entry_roots(root=root)
    )
    raise ValueError(f"{label} must stay within one of: {allowed_display}")


def repo_display_path(path: Path, *, root: Path = ROOT) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(resolved)


def _resolve_override_path(env_names: tuple[str, ...], *, root: Path, label: str) -> Path | None:
    for env_name in env_names:
        raw_override = str(os.environ.get(env_name, "") or "").strip()
        if not raw_override:
            continue
        override_path = Path(raw_override)
        if not override_path.is_absolute():
            override_path = root / override_path
        resolved = ensure_allowed_entry_path(override_path, root=root, label=label)
        if not resolved.is_file():
            raise FileNotFoundError(
                f"Unable to find a source file for {label}. Tried explicit override: {repo_display_path(resolved, root=root)}"
            )
        return resolved
    return None


def resolve_entry_path(
    *,
    env_names: tuple[str, ...],
    candidate_paths: tuple[str, ...],
    root: Path = ROOT,
    label: str,
) -> Path:
    override_path = _resolve_override_path(env_names, root=root, label=label)
    if override_path is not None:
        return override_path
    candidates = [
        *(root / candidate for candidate in candidate_paths),
    ]
    checked_candidates: list[Path] = []
    for candidate in candidates:
        try:
            resolved_candidate = ensure_allowed_entry_path(candidate, root=root, label=label)
        except ValueError:
            checked_candidates.append(candidate.resolve())
            continue
        checked_candidates.append(resolved_candidate)
        if resolved_candidate.is_file():
            return resolved_candidate
    checked_display = ", ".join(repo_display_path(path, root=root) for path in checked_candidates)
    raise FileNotFoundError(f"Unable to find a source file for {label}. Tried: {checked_display}")


def resolve_landing_entry_path(*, root: Path = ROOT) -> Path:
    return resolve_entry_path(
        env_names=LANDING_ENTRY_ENV_NAMES,
        candidate_paths=LANDING_ENTRY_CANDIDATES,
        root=root,
        label="landing-entry",
    )


def resolve_editor_entry_path(*, root: Path = ROOT) -> Path:
    return resolve_entry_path(
        env_names=EDITOR_ENTRY_ENV_NAMES,
        candidate_paths=EDITOR_ENTRY_CANDIDATES,
        root=root,
        label="editor-entry",
    )
