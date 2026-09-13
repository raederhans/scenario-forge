"""Small, explicit dependency registry for build-stage cache identities."""
from __future__ import annotations

from pathlib import Path
from typing import Iterable


def _files(root: Path, pattern: str) -> list[Path]:
    return sorted(path for path in root.glob(pattern) if path.is_file())


def dependencies_for_stage(stage_name: str, *, project_root: Path) -> list[Path]:
    """Return code/data dependencies omitted by individual stage call sites."""
    root = Path(project_root)
    stage = str(stage_name).strip().lower()
    if stage in {"detail_topology", "ru_city_detail_topology"}:
        paths = _files(root / "map_builder" / "processors", "*.py")
        paths += _files(root / "map_builder" / "geo", "*.py")
        paths += [root / "map_builder" / "config.py"]
        paths += _files(root / "map_builder" / "io", "*.py")
        paths += [root / "data" / "france_arrondissements.geojson"]
        from map_builder import config
        for name in dir(config):
            if name.endswith("_FILENAME"):
                value = getattr(config, name)
                if isinstance(value, str):
                    paths.append(root / "data" / value)
        return paths
    if stage == "runtime_political_topology":
        return (
            _files(root / "map_builder" / "geo", "*.py")
            + _files(root / "map_builder" / "processors", "*.py")
            + [root / "map_builder" / "config.py"]
            + _files(root / "map_builder" / "io", "*.py")
        )
    return []


def merge_dependencies(inputs: Iterable[Path], *, stage_name: str, project_root: Path) -> list[Path]:
    seen: set[Path] = set()
    result: list[Path] = []
    for path in [*(Path(item) for item in inputs), *dependencies_for_stage(stage_name, project_root=project_root)]:
        resolved = path.resolve()
        if resolved not in seen:
            seen.add(resolved)
            result.append(resolved)
    return result
