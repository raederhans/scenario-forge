from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIN_LOCK_PATH = ROOT / "requirements-ci-min.lock.txt"
HEAVY_GROUPS_PATH = ROOT / "tests" / "heavy_dependency_groups.json"
TESTS_ROOT = ROOT / "tests"

# deploy-minimal currently builds Pages dist and runs one unittest module using stdlib only.
ALLOWED_PACKAGES: set[str] = set()
HEAVY_IMPORT_TOKENS = (
    "import geopandas",
    "from geopandas",
    "import shapely",
    "from shapely",
    "import rasterio",
    "from rasterio",
    "import pyproj",
    "from pyproj",
    "import numpy",
    "from numpy",
)


def parse_requirement_name(raw_line: str) -> str:
    package_spec = raw_line.split(";", 1)[0].strip()
    for separator in ("==", ">=", "<=", "~=", "!=", "<", ">"):
        if separator in package_spec:
            return package_spec.split(separator, 1)[0].strip().lower()
    return package_spec.lower()


def iter_requirements(lock_path: Path) -> list[str]:
    requirements: list[str] = []
    for line in lock_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        requirements.append(stripped)
    return requirements


def discover_heavy_test_paths() -> set[str]:
    heavy_paths: set[str] = set()
    for path in TESTS_ROOT.rglob("test_*.py"):
        content = path.read_text(encoding="utf-8")
        if any(token in content for token in HEAVY_IMPORT_TOKENS):
            heavy_paths.add(path.relative_to(ROOT).as_posix())
    return heavy_paths


def declared_heavy_test_paths() -> set[str]:
    payload = json.loads(HEAVY_GROUPS_PATH.read_text(encoding="utf-8"))
    paths: set[str] = set()
    for group in payload.values():
        for item in group.get("patterns", []):
            paths.add(str(item))
    return paths


def main() -> None:
    if not MIN_LOCK_PATH.is_file():
        raise FileNotFoundError(f"Missing minimal lockfile: {MIN_LOCK_PATH}")
    if not HEAVY_GROUPS_PATH.is_file():
        raise FileNotFoundError(f"Missing heavy dependency test grouping file: {HEAVY_GROUPS_PATH}")

    violations: list[str] = []
    requirements = iter_requirements(MIN_LOCK_PATH)

    for requirement in requirements:
        package_name = parse_requirement_name(requirement)
        if package_name not in ALLOWED_PACKAGES:
            violations.append(
                f"Unexpected package in {MIN_LOCK_PATH.name}: {requirement} (package '{package_name}' is outside allowlist)."
            )

    detected_heavy = discover_heavy_test_paths()
    declared_heavy = declared_heavy_test_paths()
    undeclared_heavy = sorted(detected_heavy - declared_heavy)
    stale_declared = sorted(declared_heavy - detected_heavy)

    for path in undeclared_heavy:
        violations.append(f"Heavy dependency test missing from grouping manifest: {path}")
    for path in stale_declared:
        violations.append(f"Grouping manifest entry has no heavy dependency imports: {path}")

    if violations:
        violation_text = "\n".join(f"- {item}" for item in violations)
        raise SystemExit(f"Minimal CI dependency lockfile check failed:\n{violation_text}")

    print(
        f"[check_min_ci_requirements] ok: {MIN_LOCK_PATH.name} has {len(requirements)} package(s); "
        f"allowlist size={len(ALLOWED_PACKAGES)}; heavy-tests={len(detected_heavy)}"
    )


if __name__ == "__main__":
    main()
