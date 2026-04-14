from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from map_builder.io.writers import write_json_atomic


SCENARIO_BUILD_ROOT_RELATIVE = Path(".runtime") / "build" / "scenario"
SCENARIO_BUILD_STATE_FILENAME = "scenario_build.lock.json"
SCENARIO_BUILD_METADATA_FILENAME = SCENARIO_BUILD_STATE_FILENAME

_CANONICAL_INPUT_FILENAMES = (
    "manifest.json",
    "scenario_mutations.json",
    "city_assets.partial.json",
    "capital_defaults.partial.json",
    "geo_locale_reviewed_exceptions.json",
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def collect_scenario_build_input_hashes(
    scenario_dir: Path,
    *,
    extra_paths: list[Path] | tuple[Path, ...] = (),
) -> dict[str, str]:
    scenario_dir = Path(scenario_dir).resolve()
    input_hashes: dict[str, str] = {}
    candidates = [scenario_dir / filename for filename in _CANONICAL_INPUT_FILENAMES]
    candidates.extend(Path(path).resolve() for path in extra_paths)
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate).casefold()
        if key in seen or not candidate.exists() or not candidate.is_file():
            continue
        seen.add(key)
        relative_name = (
            candidate.relative_to(scenario_dir).as_posix()
            if candidate.is_relative_to(scenario_dir)
            else candidate.name
        )
        input_hashes[relative_name] = _hash_file(candidate)
    return dict(sorted(input_hashes.items()))


def compute_scenario_snapshot_hash(input_hashes: dict[str, str]) -> str:
    encoded = json.dumps(input_hashes, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:16]


def stable_stage_signature(payload: dict[str, object]) -> str:
    encoded = json.dumps(payload, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def scenario_build_root(root: Path, scenario_id: str) -> Path:
    return Path(root).resolve() / SCENARIO_BUILD_ROOT_RELATIVE / str(scenario_id or "").strip()


def resolve_scenario_build_session(
    *,
    root: Path,
    scenario_id: str,
    scenario_dir: Path,
    checkpoint_dir: Path | None = None,
    extra_input_paths: list[Path] | tuple[Path, ...] = (),
) -> dict[str, object]:
    resolved_root = Path(root).resolve()
    resolved_scenario_dir = Path(scenario_dir).resolve()
    input_hashes = collect_scenario_build_input_hashes(
        resolved_scenario_dir,
        extra_paths=extra_input_paths,
    )
    snapshot_hash = compute_scenario_snapshot_hash(input_hashes)
    build_dir = Path(checkpoint_dir).resolve() if checkpoint_dir is not None else scenario_build_root(
        resolved_root,
        scenario_id,
    ) / snapshot_hash
    build_dir.mkdir(parents=True, exist_ok=True)
    state_path = build_dir / SCENARIO_BUILD_STATE_FILENAME
    state_payload = load_scenario_build_state(build_dir)
    state_payload.update(
        {
            "scenario_id": str(scenario_id or "").strip(),
            "scenario_dir": str(resolved_scenario_dir),
            "build_dir": str(build_dir),
            "snapshot_hash": snapshot_hash,
            "input_hashes": input_hashes,
            "generated_at": str(state_payload.get("generated_at") or _now_iso()),
            "stage_outputs": dict(state_payload.get("stage_outputs") or {}),
            "stage_signatures": dict(state_payload.get("stage_signatures") or {}),
            "published_targets": list(state_payload.get("published_targets") or []),
        }
    )
    write_json_atomic(state_path, state_payload, ensure_ascii=False, indent=2, trailing_newline=True)
    return {
        "scenarioId": str(scenario_id or "").strip(),
        "scenarioDir": resolved_scenario_dir,
        "buildDir": build_dir,
        "statePath": state_path,
        "snapshotHash": snapshot_hash,
        "inputHashes": input_hashes,
        "state": state_payload,
    }


def ensure_scenario_build_session(
    *,
    scenario_id: str,
    scenario_dir: Path,
    root: Path,
    build_dir: Path | None = None,
    extra_input_paths: list[Path] | tuple[Path, ...] = (),
) -> dict[str, object]:
    return resolve_scenario_build_session(
        root=root,
        scenario_id=scenario_id,
        scenario_dir=scenario_dir,
        checkpoint_dir=build_dir,
        extra_input_paths=extra_input_paths,
    )


def load_scenario_build_state(build_dir: Path) -> dict[str, object]:
    state_path = Path(build_dir).resolve() / SCENARIO_BUILD_STATE_FILENAME
    if not state_path.exists():
        return {}
    payload = json.loads(state_path.read_text(encoding="utf-8"))
    return dict(payload) if isinstance(payload, dict) else {}


def update_scenario_build_state(
    build_dir: Path,
    *,
    stage_name: str | None = None,
    stage_outputs: list[str] | tuple[str, ...] | None = None,
    stage_signature: dict[str, object] | None = None,
    published_target: str | None = None,
    published_files: list[str] | tuple[str, ...] | None = None,
) -> dict[str, object]:
    resolved_build_dir = Path(build_dir).resolve()
    state_path = resolved_build_dir / SCENARIO_BUILD_STATE_FILENAME
    state_payload = load_scenario_build_state(resolved_build_dir)
    state_payload.setdefault("build_dir", str(resolved_build_dir))
    state_payload.setdefault("generated_at", _now_iso())
    current_stage_outputs = dict(state_payload.get("stage_outputs") or {})
    if stage_name:
        current_stage_outputs[str(stage_name)] = list(stage_outputs or [])
    state_payload["stage_outputs"] = current_stage_outputs
    current_stage_signatures = dict(state_payload.get("stage_signatures") or {})
    if stage_name and isinstance(stage_signature, dict):
        current_stage_signatures[str(stage_name)] = dict(stage_signature)
    state_payload["stage_signatures"] = current_stage_signatures
    current_published_targets = list(state_payload.get("published_targets") or [])
    if published_target:
        entry = {
            "target": str(published_target),
            "files": list(published_files or []),
            "published_at": _now_iso(),
        }
        current_published_targets = [
            existing
            for existing in current_published_targets
            if not (isinstance(existing, dict) and str(existing.get("target") or "") == str(published_target))
        ]
        current_published_targets.append(entry)
    state_payload["published_targets"] = current_published_targets
    write_json_atomic(state_path, state_payload, ensure_ascii=False, indent=2, trailing_newline=True)
    return state_payload


def record_stage_outputs(
    *,
    build_dir: Path,
    stage: str,
    output_paths: list[Path] | tuple[Path, ...],
    root: Path,
    stage_signature: dict[str, object] | None = None,
) -> dict[str, object]:
    resolved_root = Path(root).resolve()
    relative_paths: list[str] = []
    for output_path in output_paths:
        resolved_path = Path(output_path).resolve()
        try:
            relative_paths.append(resolved_path.relative_to(resolved_root).as_posix())
        except ValueError:
            relative_paths.append(str(resolved_path))
    return update_scenario_build_state(
        build_dir,
        stage_name=stage,
        stage_outputs=relative_paths,
        stage_signature=stage_signature,
    )


def load_stage_signature(build_dir: Path, stage: str) -> dict[str, object] | None:
    state_payload = load_scenario_build_state(build_dir)
    signatures = state_payload.get("stage_signatures")
    if not isinstance(signatures, dict):
        return None
    entry = signatures.get(str(stage))
    return dict(entry) if isinstance(entry, dict) else None


def stage_signature_matches(build_dir: Path, stage: str, signature: str) -> bool:
    entry = load_stage_signature(build_dir, stage)
    return isinstance(entry, dict) and str(entry.get("signature") or "") == str(signature or "").strip()


def record_published_target(
    *,
    build_dir: Path,
    target: str,
    published_files: list[Path] | tuple[Path, ...] | None = None,
    published_paths: list[Path] | tuple[Path, ...] | None = None,
    root: Path,
) -> dict[str, object]:
    resolved_root = Path(root).resolve()
    relative_paths: list[str] = []
    for published_file in list(published_files or published_paths or []):
        resolved_path = Path(published_file).resolve()
        try:
            relative_paths.append(resolved_path.relative_to(resolved_root).as_posix())
        except ValueError:
            relative_paths.append(str(resolved_path))
    return update_scenario_build_state(
        build_dir,
        published_target=target,
        published_files=relative_paths,
    )
