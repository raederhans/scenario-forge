from __future__ import annotations

import http.server
import json
import os
from pathlib import Path
import socketserver
import subprocess
import sys
from urllib.parse import parse_qs, urlparse
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.io.writers import write_json_atomic

# Define the range of ports to try
PORT_START = 8000
PORT_END = 8010
BIND_ADDRESS = "127.0.0.1"
RUNTIME_ACTIVE_SERVER_PATH = Path(".runtime") / "dev" / "active_server.json"
SCENARIO_INDEX_PATH = ROOT / "data" / "scenarios" / "index.json"
GEO_LOCALE_BUILDER_BY_SCENARIO = {
    "tno_1962": ROOT / "tools" / "build_tno_1962_geo_locale_patch.py",
}


class DevServerError(Exception):
    def __init__(self, code: str, message: str, *, status: int = 400, details: object | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details


def _read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _repo_relative(path: Path, *, root: Path = ROOT) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def _ensure_path_within_root(path: Path, *, root: Path = ROOT) -> Path:
    resolved = path.resolve()
    try:
        resolved.relative_to(root.resolve())
    except ValueError as exc:
        raise DevServerError(
            "path_outside_root",
            f"Refused to access a path outside the repository root: {path}",
            status=400,
        ) from exc
    return resolved


def _resolve_repo_path(raw_path: object, *, root: Path = ROOT) -> Path:
    text = str(raw_path or "").strip()
    if not text:
        raise DevServerError("missing_path", "Required scenario path is missing.", status=400)
    return _ensure_path_within_root(root / text, root=root)


def _load_scenario_index(*, root: Path = ROOT) -> dict[str, object]:
    index_path = _ensure_path_within_root(
        SCENARIO_INDEX_PATH if root == ROOT else root / "data" / "scenarios" / "index.json",
        root=root,
    )
    return _read_json(index_path)


def load_scenario_context(scenario_id: object, *, root: Path = ROOT) -> dict[str, object]:
    normalized_id = str(scenario_id or "").strip()
    if not normalized_id:
        raise DevServerError("missing_scenario_id", "Scenario id is required.", status=400)

    registry = _load_scenario_index(root=root)
    scenarios = registry.get("scenarios", []) if isinstance(registry, dict) else []
    scenario_entry = next(
        (entry for entry in scenarios if str(entry.get("scenario_id") or "").strip() == normalized_id),
        None,
    )
    if not scenario_entry:
        raise DevServerError(
            "unknown_scenario",
            f"Scenario \"{normalized_id}\" was not found in the scenario registry.",
            status=404,
        )

    manifest_path = _resolve_repo_path(scenario_entry.get("manifest_url"), root=root)
    if not manifest_path.exists():
        raise DevServerError(
            "missing_manifest",
            f"Manifest for scenario \"{normalized_id}\" does not exist: {manifest_path}",
            status=404,
        )
    manifest = _read_json(manifest_path)
    scenario_dir = manifest_path.parent

    owners_path = _resolve_repo_path(manifest.get("owners_url"), root=root)
    countries_path = _resolve_repo_path(manifest.get("countries_url"), root=root)
    controllers_url = str(manifest.get("controllers_url") or "").strip()
    geo_locale_patch_url = str(manifest.get("geo_locale_patch_url") or "").strip()
    controllers_path = _resolve_repo_path(controllers_url, root=root) if controllers_url else None
    geo_locale_patch_path = _resolve_repo_path(geo_locale_patch_url, root=root) if geo_locale_patch_url else None

    for candidate in (owners_path, countries_path, controllers_path, geo_locale_patch_path):
        if not candidate:
            continue
        try:
            candidate.relative_to(scenario_dir.resolve())
        except ValueError as exc:
            raise DevServerError(
                "path_not_allowed",
                f"Scenario file is outside the scenario directory: {candidate}",
                status=400,
            ) from exc

    context = {
        "scenarioId": normalized_id,
        "manifest": manifest,
        "manifestPath": manifest_path,
        "scenarioDir": scenario_dir,
        "ownersPath": owners_path,
        "countriesPath": countries_path,
        "controllersPath": controllers_path,
        "geoLocalePatchPath": geo_locale_patch_path,
        "manualGeoOverridesPath": _ensure_path_within_root(
            scenario_dir / "geo_name_overrides.manual.json",
            root=root,
        ),
    }
    return context


def _load_allowed_country_tags(context: dict[str, object]) -> set[str]:
    payload = _read_json(Path(context["countriesPath"]))
    countries = payload.get("countries", {}) if isinstance(payload, dict) else {}
    allowed_tags = {
        str(tag or "").strip().upper()
        for tag in countries.keys()
        if str(tag or "").strip()
    }
    if not allowed_tags:
        raise DevServerError(
            "missing_country_tags",
            "Scenario countries file did not expose any valid owner tags.",
            status=400,
        )
    return allowed_tags


def build_scenario_ownership_payload(
    context: dict[str, object],
    owners: object,
    *,
    baseline_hash: object = "",
) -> dict[str, object]:
    if not isinstance(owners, dict):
        raise DevServerError("invalid_owners", "Owners payload must be an object.", status=400)

    expected_baseline_hash = str(context["manifest"].get("baseline_hash") or "").strip()
    normalized_baseline_hash = str(baseline_hash or "").strip()
    if normalized_baseline_hash and expected_baseline_hash and normalized_baseline_hash != expected_baseline_hash:
        raise DevServerError(
            "baseline_hash_mismatch",
            "The provided baseline hash does not match the current scenario manifest.",
            status=409,
            details={
                "expected": expected_baseline_hash,
                "received": normalized_baseline_hash,
            },
        )

    allowed_tags = _load_allowed_country_tags(context)
    sanitized_owners: dict[str, str] = {}
    invalid_feature_ids: list[str] = []
    invalid_owner_codes: list[str] = []
    for raw_feature_id, raw_owner_code in owners.items():
        feature_id = str(raw_feature_id or "").strip()
        owner_code = str(raw_owner_code or "").strip().upper()
        if not feature_id:
            invalid_feature_ids.append(str(raw_feature_id or ""))
            continue
        if not owner_code or owner_code not in allowed_tags:
            invalid_owner_codes.append(f"{feature_id}:{owner_code}")
            continue
        sanitized_owners[feature_id] = owner_code

    if invalid_feature_ids:
        raise DevServerError(
            "invalid_feature_ids",
            "One or more ownership entries used an empty feature id.",
            status=400,
            details={"invalidFeatureIds": invalid_feature_ids[:20]},
        )
    if invalid_owner_codes:
        raise DevServerError(
            "invalid_owner_codes",
            "One or more ownership entries used a tag not declared by the scenario.",
            status=400,
            details={"invalidOwnerCodes": invalid_owner_codes[:20]},
        )
    if not sanitized_owners:
        raise DevServerError("empty_owners", "No ownership entries were provided.", status=400)

    return {
        "owners": sanitized_owners,
        "baseline_hash": expected_baseline_hash or normalized_baseline_hash,
    }


def save_scenario_ownership_payload(
    scenario_id: object,
    owners: object,
    *,
    baseline_hash: object = "",
    root: Path = ROOT,
) -> dict[str, object]:
    context = load_scenario_context(scenario_id, root=root)
    payload = build_scenario_ownership_payload(context, owners, baseline_hash=baseline_hash)
    owners_path = Path(context["ownersPath"])
    write_json_atomic(owners_path, payload, ensure_ascii=False, indent=2, trailing_newline=True)
    owner_codes = sorted(set(payload["owners"].values()))
    return {
        "ok": True,
        "scenarioId": context["scenarioId"],
        "filePath": _repo_relative(owners_path, root=root),
        "savedAt": __import__("datetime").datetime.now().astimezone().isoformat(),
        "stats": {
            "featureCount": len(payload["owners"]),
            "ownerCount": len(owner_codes),
            "ownerCodesSample": owner_codes[:12],
        },
    }


def _default_manual_geo_payload(scenario_id: str) -> dict[str, object]:
    return {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": "",
        "geo": {},
    }


def _normalize_locale_entry(en: object, zh: object) -> dict[str, str]:
    entry = {}
    en_text = str(en or "").strip()
    zh_text = str(zh or "").strip()
    if en_text:
        entry["en"] = en_text
    if zh_text:
        entry["zh"] = zh_text
    return entry


def _build_geo_locale_command(context: dict[str, object], *, root: Path = ROOT) -> list[str]:
    scenario_id = str(context["scenarioId"])
    builder_path = GEO_LOCALE_BUILDER_BY_SCENARIO.get(scenario_id)
    if not builder_path:
        raise DevServerError(
            "geo_locale_not_supported",
            f"Scenario \"{scenario_id}\" does not have a registered geo locale patch builder yet.",
            status=501,
        )
    return [
        sys.executable,
        str(builder_path),
        "--scenario-id",
        scenario_id,
        "--scenario-dir",
        str(context["scenarioDir"]),
        "--manual-overrides",
        str(context["manualGeoOverridesPath"]),
        "--output",
        str(context["geoLocalePatchPath"]),
    ]


def save_scenario_geo_locale_entry(
    scenario_id: object,
    *,
    feature_id: object,
    en: object = "",
    zh: object = "",
    mode: object = "manual_override",
    root: Path = ROOT,
) -> dict[str, object]:
    normalized_mode = str(mode or "manual_override").strip().lower() or "manual_override"
    if normalized_mode != "manual_override":
        raise DevServerError(
            "unsupported_geo_locale_mode",
            f"Unsupported geo locale save mode: {normalized_mode}",
            status=400,
        )

    context = load_scenario_context(scenario_id, root=root)
    if not context["geoLocalePatchPath"]:
        raise DevServerError(
            "missing_geo_locale_patch",
            "The active scenario does not declare a geo locale patch target.",
            status=400,
        )

    normalized_feature_id = str(feature_id or "").strip()
    if not normalized_feature_id:
        raise DevServerError("missing_feature_id", "Feature id is required for geo locale saves.", status=400)

    manual_path = Path(context["manualGeoOverridesPath"])
    if manual_path.exists():
        manual_payload = _read_json(manual_path)
        if not isinstance(manual_payload, dict):
            manual_payload = _default_manual_geo_payload(str(context["scenarioId"]))
    else:
        manual_payload = _default_manual_geo_payload(str(context["scenarioId"]))

    manual_payload["version"] = int(manual_payload.get("version") or 1)
    manual_payload["scenario_id"] = str(context["scenarioId"])
    manual_payload["generated_at"] = __import__("datetime").datetime.now().astimezone().isoformat()
    manual_payload["geo"] = manual_payload.get("geo", {}) if isinstance(manual_payload.get("geo"), dict) else {}

    locale_entry = _normalize_locale_entry(en, zh)
    if locale_entry:
        manual_payload["geo"][normalized_feature_id] = locale_entry
    else:
        manual_payload["geo"].pop(normalized_feature_id, None)

    write_json_atomic(manual_path, manual_payload, ensure_ascii=False, indent=2, trailing_newline=True)

    command = _build_geo_locale_command(context, root=root)
    result = subprocess.run(
        command,
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise DevServerError(
            "geo_locale_build_failed",
            "The geo locale patch builder failed after updating manual overrides.",
            status=500,
            details={
                "command": command,
                "stdout": result.stdout[-2000:],
                "stderr": result.stderr[-2000:],
            },
        )

    geo_locale_patch_payload = _read_json(Path(context["geoLocalePatchPath"]))
    current_entry = (
        geo_locale_patch_payload.get("geo", {}).get(normalized_feature_id)
        if isinstance(geo_locale_patch_payload, dict)
        else None
    )
    return {
        "ok": True,
        "scenarioId": context["scenarioId"],
        "featureId": normalized_feature_id,
        "filePath": _repo_relative(Path(context["manualGeoOverridesPath"]), root=root),
        "generatedPath": _repo_relative(Path(context["geoLocalePatchPath"]), root=root),
        "savedAt": __import__("datetime").datetime.now().astimezone().isoformat(),
        "entry": current_entry or None,
    }


def resolve_open_path():
    cli_path = sys.argv[1].strip() if len(sys.argv) > 1 and sys.argv[1] else ""
    env_path = os.environ.get("MAPCREATOR_OPEN_PATH", "").strip()
    raw_path = cli_path or env_path or "/"
    if not raw_path.startswith("/"):
        raw_path = f"/{raw_path}"
    return raw_path


def resolve_runtime_active_server_path():
    runtime_root = os.environ.get("MAPCREATOR_RUNTIME_ROOT", "").strip()
    if runtime_root:
        return Path(runtime_root) / "dev" / "active_server.json"
    return RUNTIME_ACTIVE_SERVER_PATH


def write_active_server_metadata(base_url, open_path, port):
    metadata_path = resolve_runtime_active_server_path()
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    parsed = urlparse(open_path or "/")
    query = parse_qs(parsed.query or "")
    payload = {
        "url": base_url,
        "port": port,
        "pid": os.getpid(),
        "started_at": __import__("datetime").datetime.now().astimezone().isoformat(),
        "open_path": open_path,
        "cwd": str(Path.cwd()),
        "command": " ".join(sys.argv),
        "topology_variant": (query.get("topology_variant") or [""])[0],
        "render_profile_default": (query.get("render_profile") or [""])[0],
    }
    metadata_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")
    return metadata_path


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        # Optional: Silence default logging to keep console clean, or keep it.
        pass

    def end_headers(self):
        # Keep the dev server aggressively uncached so edited JSON/JS/HTML
        # cannot leave an already-open tab in a stale UI state.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def _send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict[str, object]:
        raw_length = self.headers.get("Content-Length", "").strip()
        if not raw_length:
            raise DevServerError("missing_content_length", "Request body is required.", status=400)
        try:
            content_length = int(raw_length)
        except ValueError as exc:
            raise DevServerError("invalid_content_length", "Content-Length must be an integer.", status=400) from exc
        if content_length <= 0:
            raise DevServerError("empty_body", "Request body is required.", status=400)
        body = self.rfile.read(content_length)
        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise DevServerError("invalid_json", "Request body must be valid UTF-8 JSON.", status=400) from exc
        if not isinstance(payload, dict):
            raise DevServerError("invalid_payload", "Request body must be a JSON object.", status=400)
        return payload

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Allow", "GET, HEAD, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Origin", f"http://{BIND_ADDRESS}:{self.server.server_address[1]}")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        route = urlparse(self.path or "").path
        try:
            payload = self._read_json_body()
            if route == "/__dev/scenario/ownership/save":
                response = save_scenario_ownership_payload(
                    payload.get("scenarioId"),
                    payload.get("owners"),
                    baseline_hash=payload.get("baselineHash"),
                )
                self._send_json(200, response)
                return
            if route == "/__dev/scenario/geo-locale/save":
                response = save_scenario_geo_locale_entry(
                    payload.get("scenarioId"),
                    feature_id=payload.get("featureId"),
                    en=payload.get("en"),
                    zh=payload.get("zh"),
                    mode=payload.get("mode"),
                )
                self._send_json(200, response)
                return
            raise DevServerError("not_found", f"Unknown dev server route: {route}", status=404)
        except DevServerError as error:
            self._send_json(
                error.status,
                {
                    "ok": False,
                    "code": error.code,
                    "message": error.message,
                    "details": error.details,
                },
            )
        except Exception as error:  # pragma: no cover - safety net
            self._send_json(
                500,
                {
                    "ok": False,
                    "code": "internal_error",
                    "message": f"Unexpected dev server failure: {error}",
                },
            )


def start_server(open_path="/"):
    for port in range(PORT_START, PORT_END + 1):
        try:
            # Attempt to create the server
            # allow_reuse_address=False on Windows helps avoid some zombie socket issues,
            # but binding to a new port is the safest bet.
            httpd = socketserver.TCPServer((BIND_ADDRESS, port), Handler)

            base_url = f"http://{BIND_ADDRESS}:{port}"
            open_url = f"{base_url}{open_path}"
            metadata_path = write_active_server_metadata(base_url, open_path, port)
            print(f"[INFO] Success! Server started at {base_url}")
            print(f"[INFO] Opening browser at {open_url}")
            print(f"[INFO] Active server metadata written to {metadata_path}")
            print(f"[INFO] (If the browser doesn't open, please visit the URL manually)")

            # Open browser
            webbrowser.open(open_url)

            # Start serving
            httpd.serve_forever()
            return  # Exit function after server stops (though serve_forever usually blocks)

        except OSError as e:
            # WinError 10048 is "Address already in use"
            if e.errno == 10048 or "Address already in use" in str(e) or "閫氬父姣忎釜濂楁帴瀛楀湴鍧€" in str(e):
                print(f"[WARN] Port {port} is busy. Trying {port + 1}...")
                continue
            # Some other error occurred
            print(f"[ERROR] Unexpected error on port {port}: {e}")
            raise e

    print(f"[FATAL] Could not find any open port between {PORT_START} and {PORT_END}.")
    sys.exit(1)


if __name__ == "__main__":
    start_server(resolve_open_path())
