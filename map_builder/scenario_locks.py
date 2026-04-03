from __future__ import annotations

import json
import os
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

LOCKS_ROOT = Path(".runtime") / "locks" / "scenario"
LOCK_FILENAME_SUFFIX = ".lock.json"
_SCENARIO_LOCK_GUARD = threading.RLock()
_SCENARIO_LOCK_DEPTHS: dict[str, int] = {}


def _pid_is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def scenario_lock_path(*, root: Path, scenario_id: str) -> Path:
    normalized_id = str(scenario_id or "").strip()
    if not normalized_id:
        raise ValueError("scenario_id is required for scenario lock paths")
    return root / LOCKS_ROOT / f"{normalized_id}{LOCK_FILENAME_SUFFIX}"


@contextmanager
def scenario_build_lock(
    *,
    root: Path,
    scenario_id: str,
    scenario_dir: Path,
    holder: str,
):
    lock_path = scenario_lock_path(root=root, scenario_id=scenario_id).resolve()
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_key = str(lock_path).casefold()
    with _SCENARIO_LOCK_GUARD:
        depth = _SCENARIO_LOCK_DEPTHS.get(lock_key, 0)
        if depth > 0:
            _SCENARIO_LOCK_DEPTHS[lock_key] = depth + 1
            acquired_here = False
        else:
            payload = {
                "pid": os.getpid(),
                "scenario_id": str(scenario_id),
                "scenario_dir": str(Path(scenario_dir).resolve()),
                "holder": str(holder),
                "cwd": str(root.resolve()),
                "acquired_at": datetime.now(timezone.utc).isoformat(),
            }
            try:
                with lock_path.open("x", encoding="utf-8", newline="\n") as handle:
                    json.dump(payload, handle, ensure_ascii=False, indent=2)
                    handle.write("\n")
            except FileExistsError as exc:
                existing_payload: object | None = None
                existing_pid: int | None = None
                if lock_path.exists():
                    try:
                        existing_payload = json.loads(lock_path.read_text(encoding="utf-8"))
                    except Exception:
                        existing_payload = lock_path.read_text(encoding="utf-8", errors="ignore").strip() or None
                if isinstance(existing_payload, dict):
                    try:
                        existing_pid = int(existing_payload.get("pid"))
                    except (TypeError, ValueError):
                        existing_pid = None
                if existing_pid is not None and existing_pid > 0 and not _pid_is_alive(existing_pid):
                    lock_path.unlink(missing_ok=True)
                    with lock_path.open("x", encoding="utf-8", newline="\n") as handle:
                        json.dump(payload, handle, ensure_ascii=False, indent=2)
                        handle.write("\n")
                else:
                    raise RuntimeError(
                        f'another scenario writer is active for "{scenario_id}" '
                        f"(lock: {lock_path}, holder: {existing_payload!r})"
                    ) from exc
            _SCENARIO_LOCK_DEPTHS[lock_key] = 1
            acquired_here = True
    try:
        yield lock_path
    finally:
        with _SCENARIO_LOCK_GUARD:
            depth = _SCENARIO_LOCK_DEPTHS.get(lock_key, 0)
            if depth <= 1:
                _SCENARIO_LOCK_DEPTHS.pop(lock_key, None)
                if acquired_here:
                    lock_path.unlink(missing_ok=True)
            else:
                _SCENARIO_LOCK_DEPTHS[lock_key] = depth - 1
