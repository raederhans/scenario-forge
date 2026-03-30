"""Network fetch + cache helpers for map pipeline."""
from __future__ import annotations

import concurrent.futures
import hashlib
import json
import os
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import geopandas as gpd
import requests

from map_builder import config as cfg
from map_builder.io.writers import write_bytes_atomic, write_json_atomic


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def get_headers() -> dict:
    return {"User-Agent": "MapCreator/1.0"}


def _build_mirror_urls(url: str) -> list[str]:
    mirrors: list[str] = []
    if "raw.githubusercontent.com" in url:
        mirrors.append(f"https://mirror.ghproxy.com/{url}")
        raw_path = url.replace("https://raw.githubusercontent.com/", "")
        parts = raw_path.split("/", 3)
        if len(parts) == 4:
            user, repo, branch, path = parts
            mirrors.append(f"https://cdn.jsdelivr.net/gh/{user}/{repo}@{branch}/{path}")
    elif "github.com" in url and "/raw/" in url:
        mirrors.append(f"https://mirror.ghproxy.com/{url}")
        gh_path = url.replace("https://github.com/", "")
        parts = gh_path.split("/", 4)
        if len(parts) >= 5 and parts[2] == "raw":
            user, repo, _, branch, path = parts[0], parts[1], parts[2], parts[3], parts[4]
            mirrors.append(f"https://raw.githubusercontent.com/{user}/{repo}/{branch}/{path}")
            mirrors.append(f"https://cdn.jsdelivr.net/gh/{user}/{repo}@{branch}/{path}")
    return mirrors


def fetch_ne_zip(url: str, label: str) -> gpd.GeoDataFrame:
    print(f"Downloading Natural Earth {label}...")
    try:
        response = requests.get(url, timeout=(10, 120), headers=get_headers())
        response.raise_for_status()
    except requests.RequestException as exc:
        print(f"{label} download failed: {exc}")
        raise SystemExit(1) from exc

    with tempfile.TemporaryDirectory() as temp_dir:
        zip_path = Path(temp_dir) / f"{label}.zip"
        zip_path.write_bytes(response.content)
        try:
            with zipfile.ZipFile(zip_path) as zf:
                zf.extractall(temp_dir)
        except zipfile.BadZipFile as exc:
            print(f"Failed to read {label} ZIP archive.")
            raise SystemExit(1) from exc

        print(f"Reading {label} dataset...")
        gdf = gpd.read_file(temp_dir)

    if gdf.empty:
        print(f"{label} GeoDataFrame is empty. Check the download.")
        raise SystemExit(1)
    return gdf


def _cache_root() -> Path:
    override = str(os.environ.get("MAPCREATOR_DATA_CACHE_DIR") or "").strip()
    if override:
        cache_dir = Path(override).expanduser()
        if not cache_dir.is_absolute():
            cache_dir = PROJECT_ROOT / cache_dir
    else:
        cache_dir = PROJECT_ROOT / "data"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def _cache_path(filename: str) -> Path:
    return _cache_root() / filename


def _provenance_path(cache_path: Path) -> Path:
    suffix = cache_path.suffix
    stem = cache_path.name[:-len(suffix)] if suffix else cache_path.name
    return cache_path.with_name(f"{stem}.provenance.json")


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _validator_name(validator, fallback_name: str = "none") -> str:
    if isinstance(validator, str):
        return validator
    name = getattr(validator, "__name__", "")
    return str(name or fallback_name)


def _write_source_provenance(
    *,
    cache_path: Path,
    configured_source_url: str,
    fallback_candidates: list[str] | None,
    resolved_source_url: str | None,
    capture_mode: str,
    validator_name: str,
    status_code: int | None = None,
    content_type: str | None = None,
) -> None:
    payload = {
        "filename": cache_path.name,
        "configured_source_url": configured_source_url,
        "resolved_source_url": resolved_source_url,
        "fallback_candidates": list(fallback_candidates or []),
        "sha256": _sha256_path(cache_path),
        "content_length": int(cache_path.stat().st_size),
        "captured_at_utc": _utc_now(),
        "capture_mode": capture_mode,
        "validator_name": validator_name,
    }
    if status_code is not None:
        payload["status_code"] = int(status_code)
    if content_type:
        payload["content_type"] = str(content_type)
    write_json_atomic(_provenance_path(cache_path), payload, ensure_ascii=False, indent=2, trailing_newline=True)


def _ensure_cache_backfill_provenance(
    *,
    cache_path: Path,
    configured_source_url: str,
    fallback_candidates: list[str] | None,
    validator_name: str,
) -> None:
    provenance_path = _provenance_path(cache_path)
    if provenance_path.exists():
        return
    _write_source_provenance(
        cache_path=cache_path,
        configured_source_url=configured_source_url,
        fallback_candidates=fallback_candidates,
        resolved_source_url=None,
        capture_mode="cache_backfill",
        validator_name=validator_name,
    )


def _validate_cached_payload(cache_path: Path, validator, filename: str) -> None:
    try:
        content = cache_path.read_bytes()
    except OSError as exc:
        raise SystemExit(f"Failed to read cached {filename}: {exc}") from exc
    error = validator(content)
    if error:
        raise SystemExit(f"Cached {filename} failed validation: {error}")


def _build_download_sources(url: str, fallback_urls: list[str] | None = None) -> list[str]:
    sources = [url]
    if fallback_urls:
        sources.extend(fallback_urls)
    for source in list(sources):
        sources.extend(_build_mirror_urls(source))

    seen = set()
    unique_sources = []
    for source in sources:
        if source in seen:
            continue
        seen.add(source)
        unique_sources.append(source)
    return unique_sources


def _download_to_cache(
    *,
    url: str,
    filename: str,
    validator,
    fallback_urls: list[str] | None = None,
) -> Path:
    cache_path = _cache_path(filename)
    if cache_path.exists():
        print(f"   [Cache] Loading {filename} from local file...")
        _validate_cached_payload(cache_path, validator, filename)
        _ensure_cache_backfill_provenance(
            cache_path=cache_path,
            configured_source_url=url,
            fallback_candidates=fallback_urls,
            validator_name=_validator_name(validator),
        )
        return cache_path

    print(f"   [Download] Fetching {filename} from remote...")
    unique_sources = _build_download_sources(url, fallback_urls)

    def download_with_retries(source: str, attempts: int = 3) -> bool:
        for attempt in range(1, attempts + 1):
            try:
                response = requests.get(
                    source,
                    timeout=(10, 60),
                    headers=get_headers(),
                )
                response.raise_for_status()
                content = response.content
                error = validator(content)
                if error:
                    print(f"[ERROR] Downloaded {filename} is invalid: {error}")
                    continue
                write_bytes_atomic(cache_path, content)
                _write_source_provenance(
                    cache_path=cache_path,
                    configured_source_url=url,
                    fallback_candidates=fallback_urls,
                    resolved_source_url=source,
                    capture_mode="downloaded",
                    validator_name=_validator_name(validator),
                    status_code=response.status_code,
                    content_type=response.headers.get("Content-Type"),
                )
                return True
            except requests.RequestException as exc:
                print(f"   [Download] {source} attempt {attempt}/{attempts} failed: {exc}")
        return False

    downloaded = False
    for source in unique_sources:
        if download_with_retries(source):
            downloaded = True
            break

    if not downloaded:
        print(f"Failed to download {filename} from all sources.")
        raise SystemExit(1)

    return cache_path


def _validate_json_bytes(content: bytes) -> str | None:
    try:
        json.loads(content.decode("utf-8"))
    except Exception as exc:
        return str(exc)
    return None


def _select_archive_member(cache_path: Path, inner_glob: str | None = None) -> str | None:
    try:
        with zipfile.ZipFile(cache_path) as archive:
            members = [name for name in archive.namelist() if not name.endswith("/")]
    except zipfile.BadZipFile as exc:
        raise SystemExit(f"Failed to read cached archive {cache_path.name}: {exc}") from exc

    if inner_glob:
        matches = [
            name for name in members
            if Path(name).match(inner_glob) or Path(name).name == inner_glob
        ]
        if not matches:
            raise SystemExit(
                f"Archive {cache_path.name} missing requested member pattern: {inner_glob}"
            )
        return matches[0]

    shp_members = [name for name in members if name.lower().endswith(".shp")]
    if len(shp_members) == 1:
        return shp_members[0]
    if len(shp_members) > 1:
        raise SystemExit(
            f"Archive {cache_path.name} contains multiple .shp members; inner_glob is required."
        )

    gpkg_members = [name for name in members if name.lower().endswith(".gpkg")]
    if len(gpkg_members) == 1:
        return gpkg_members[0]
    if len(gpkg_members) > 1:
        raise SystemExit(
            f"Archive {cache_path.name} contains multiple .gpkg members; inner_glob is required."
        )
    return None


def _validate_vector_archive_bytes(content: bytes) -> str | None:
    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            archive_path = Path(temp_dir) / "vector.zip"
            archive_path.write_bytes(content)
            member = _select_archive_member(archive_path)
            archive_uri = f"zip://{archive_path}"
            if member:
                archive_uri += f"!{member}"
            gdf = gpd.read_file(archive_uri)
    except Exception as exc:
        return str(exc)
    if gdf.empty:
        return "archive contains zero features"
    return None


def _probe_binary_source(source: str) -> tuple[int, bool]:
    headers = get_headers()
    headers["Range"] = "bytes=0-0"
    with requests.get(source, timeout=(20, 60), headers=headers, stream=True) as response:
        response.raise_for_status()
        supports_range = response.status_code == 206
        total_size = 0
        if supports_range:
            content_range = str(response.headers.get("Content-Range", "")).strip()
            if "/" in content_range:
                tail = content_range.rsplit("/", 1)[-1]
                total_size = int(tail) if tail.isdigit() else 0
        if total_size <= 0:
            length_header = str(response.headers.get("Content-Length", "")).strip()
            total_size = int(length_header) if length_header.isdigit() else 0
        for _ in response.iter_content(chunk_size=16):
            break
    return total_size, supports_range


def _download_binary_ranges(
    *,
    source: str,
    cache_path: Path,
    total_size: int,
    parallelism: int = 8,
    segment_size_bytes: int = 64 * 1024 * 1024,
) -> Path:
    parts_dir = cache_path.with_name(f"{cache_path.name}.parts")
    parts_dir.mkdir(parents=True, exist_ok=True)
    partial_path = cache_path.with_name(f"{cache_path.name}.part")

    ranges: list[tuple[int, int, Path]] = []
    start = 0
    part_index = 0
    while start < total_size:
        end = min(start + segment_size_bytes - 1, total_size - 1)
        ranges.append((start, end, parts_dir / f"part-{part_index:03d}.bin"))
        start = end + 1
        part_index += 1

    def _fetch_range(start_byte: int, end_byte: int, part_path: Path) -> Path:
        headers = get_headers()
        headers["Range"] = f"bytes={start_byte}-{end_byte}"
        with requests.get(source, timeout=(20, 300), headers=headers, stream=True) as response:
            response.raise_for_status()
            if response.status_code != 206:
                raise requests.RequestException(
                    f"Expected 206 Partial Content for range {start_byte}-{end_byte}, got {response.status_code}"
                )
            with open(part_path, "wb") as handle:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    handle.write(chunk)
        expected_size = end_byte - start_byte + 1
        actual_size = part_path.stat().st_size
        if actual_size != expected_size:
            raise OSError(
                f"Range download size mismatch for {part_path.name}: expected {expected_size}, got {actual_size}"
            )
        return part_path

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(parallelism, len(ranges))) as executor:
            futures = [executor.submit(_fetch_range, start_byte, end_byte, part_path) for start_byte, end_byte, part_path in ranges]
            completed = 0
            for future in concurrent.futures.as_completed(futures):
                future.result()
                completed += 1
                if completed == len(ranges) or completed % 4 == 0:
                    print(f"   [Download] {cache_path.name}: {completed}/{len(ranges)} range segments received...")

        with open(partial_path, "wb") as output_handle:
            for _, _, part_path in ranges:
                with open(part_path, "rb") as input_handle:
                    shutil.copyfileobj(input_handle, output_handle, length=1024 * 1024)

        if partial_path.stat().st_size != total_size:
            raise OSError(
                f"Combined payload size mismatch for {cache_path.name}: expected {total_size}, got {partial_path.stat().st_size}"
            )

        partial_path.replace(cache_path)
        return cache_path
    finally:
        shutil.rmtree(parts_dir, ignore_errors=True)


def fetch_or_cache_binary(
    url: str,
    filename: str,
    *,
    fallback_urls: list[str] | None = None,
    min_size_bytes: int = 1024,
) -> Path:
    cache_path = _cache_path(filename)
    if cache_path.exists() and cache_path.stat().st_size >= min_size_bytes:
        _ensure_cache_backfill_provenance(
            cache_path=cache_path,
            configured_source_url=url,
            fallback_candidates=fallback_urls,
            validator_name=f"binary_min_size:{min_size_bytes}",
        )
        return cache_path
    partial_path = cache_path.with_name(f"{cache_path.name}.part")

    print(f"   [Download] Fetching binary asset {filename}...")
    unique_sources = _build_download_sources(url, fallback_urls)

    for source in unique_sources:
        try:
            resume_size = partial_path.stat().st_size if partial_path.exists() else 0
            if resume_size <= 0:
                total_size, supports_range = _probe_binary_source(source)
                if supports_range and total_size >= max(min_size_bytes, 256 * 1024 * 1024):
                    print(
                        f"   [Download] {filename}: server supports range requests; using parallel download "
                        f"for {total_size / (1024 * 1024):.0f} MiB payload."
                    )
                    range_path = _download_binary_ranges(
                        source=source,
                        cache_path=cache_path,
                        total_size=total_size,
                    )
                    _write_source_provenance(
                        cache_path=range_path,
                        configured_source_url=url,
                        fallback_candidates=fallback_urls,
                        resolved_source_url=source,
                        capture_mode="downloaded",
                        validator_name=f"binary_min_size:{min_size_bytes}",
                    )
                    return range_path
            request_headers = get_headers()
            if resume_size > 0:
                request_headers["Range"] = f"bytes={resume_size}-"
            with requests.get(
                source,
                timeout=(20, 300),
                headers=request_headers,
                stream=True,
            ) as response:
                if resume_size > 0 and response.status_code == 416:
                    partial_path.replace(cache_path)
                    if cache_path.stat().st_size >= min_size_bytes:
                        _ensure_cache_backfill_provenance(
                            cache_path=cache_path,
                            configured_source_url=url,
                            fallback_candidates=fallback_urls,
                            validator_name=f"binary_min_size:{min_size_bytes}",
                        )
                        return cache_path
                    cache_path.unlink(missing_ok=True)
                    resume_size = 0
                response.raise_for_status()
                append_mode = resume_size > 0 and response.status_code == 206
                if resume_size > 0 and not append_mode:
                    print(
                        f"   [Download] {source} did not honor resume for {filename}; restarting from byte 0."
                    )
                    partial_path.unlink(missing_ok=True)
                    resume_size = 0
                temp_path = partial_path
                with open(temp_path, "ab" if append_mode else "wb") as tmp_handle:
                    bytes_written = resume_size
                    next_progress_marker = ((bytes_written // (256 * 1024 * 1024)) + 1) * (256 * 1024 * 1024)
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if not chunk:
                            continue
                        tmp_handle.write(chunk)
                        bytes_written += len(chunk)
                        if bytes_written >= next_progress_marker:
                            print(
                                f"   [Download] {filename}: {bytes_written / (1024 * 1024):.0f} MiB received..."
                            )
                            next_progress_marker += 256 * 1024 * 1024
            size_bytes = temp_path.stat().st_size
            if size_bytes < min_size_bytes:
                print(
                    f"   [Download] {source} produced undersized payload for {filename} "
                    f"({size_bytes} bytes)."
                )
                continue
            temp_path.replace(cache_path)
            _write_source_provenance(
                cache_path=cache_path,
                configured_source_url=url,
                fallback_candidates=fallback_urls,
                resolved_source_url=source,
                capture_mode="downloaded",
                validator_name=f"binary_min_size:{min_size_bytes}",
                status_code=response.status_code,
                content_type=response.headers.get("Content-Type"),
            )
            return cache_path
        except requests.RequestException as exc:
            print(f"   [Download] {source} failed for {filename}: {exc}")
        except OSError as exc:
            print(f"   [Download] Unable to store {filename} from {source}: {exc}")

    print(f"Failed to download binary asset {filename} from all sources.")
    raise SystemExit(1)


def fetch_or_load_geojson(url: str, filename: str, fallback_urls: list[str] | None = None) -> gpd.GeoDataFrame:
    cache_path = _download_to_cache(
        url=url,
        filename=filename,
        validator=_validate_json_bytes,
        fallback_urls=fallback_urls,
    )
    try:
        return gpd.read_file(cache_path)
    except Exception as exc:
        print(f"Failed to read downloaded {filename}: {exc}")
        raise SystemExit(1) from exc


def fetch_or_load_vector_archive(
    url: str,
    filename: str,
    *,
    fallback_urls: list[str] | None = None,
    inner_glob: str | None = None,
) -> gpd.GeoDataFrame:
    cache_path = _download_to_cache(
        url=url,
        filename=filename,
        validator=_validate_vector_archive_bytes,
        fallback_urls=fallback_urls,
    )
    print(f"   [Cache] Loading {filename} from local archive...")
    try:
        member = _select_archive_member(cache_path, inner_glob=inner_glob)
        archive_uri = f"zip://{cache_path}"
        if member:
            archive_uri += f"!{member}"
        return gpd.read_file(archive_uri)
    except Exception as exc:
        print(f"Failed to read cached archive {filename}: {exc}")
        raise SystemExit(1) from exc
