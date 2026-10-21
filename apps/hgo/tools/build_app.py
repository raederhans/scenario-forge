#!/usr/bin/env python3
"""Package the independent HGO browser app and its verified dataset closure."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import html
import io
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time
from urllib.parse import unquote, urlsplit


MAX_ASSET = 160 * 1024 * 1024
MAX_OVERLAY_ASSET = 24 * 1024 * 1024
MAX_OVERLAY_CATALOG = 512 * 1024
RECEIPT = '.hgo-build.json'
DEFAULT_MAIN_URL = '../../../index.html'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def local_path(base, url):
    require(isinstance(url, str) and url, 'Missing asset URL')
    parsed = urlsplit(url)
    require(not parsed.scheme and not parsed.netloc and not parsed.query and not parsed.fragment,
            'Asset URL must be a plain relative path')
    decoded = unquote(parsed.path)
    require(not decoded.startswith(('/', '\\')) and '\\' not in decoded and ':' not in decoded,
            'Absolute asset path refused')
    path = (base / decoded).resolve()
    require(path.is_relative_to(base) and path.is_file(), f'Asset escapes dataset or is missing: {url}')
    return path


def dataset_files(folder):
    manifest_path = folder / 'manifest.json'
    manifest = json.loads(manifest_path.read_bytes())
    require(manifest.get('format') == 'hgo-native-dataset' and manifest.get('schemaVersion') == 1,
            'Unsupported native dataset')
    space = manifest.get('coordinateSpace', {})
    width, height = space.get('width'), space.get('height')
    require(type(width) is int and type(height) is int and width > 0 and height > 0 and width * height <= 50_000_000,
            'Invalid dataset dimensions')
    require(space.get('kind') == 'pixel' and space.get('origin') == 'top-left' and space.get('wrapX') is False,
            'Invalid coordinate space')
    assets = manifest.get('assets', {})
    require(set(assets) == {'ids', 'core', 'places'}, 'Unexpected dataset assets')
    files = {manifest_path: manifest_path.read_bytes()}
    for name, asset in assets.items():
        path = local_path(folder, asset.get('url'))
        require(path not in files, 'Duplicate dataset asset URL')
        length = asset.get('byteLength')
        require(type(length) is int and 0 < length <= MAX_ASSET and path.stat().st_size == length,
                f'{name}: transport length mismatch')
        payload = path.read_bytes()
        require(digest(payload) == asset.get('sha256'), f'{name}: SHA-256 mismatch')
        if name == 'ids':
            expected = width * height * 2
            require(asset.get('encoding') == 'gzip' and asset.get('decodedByteLength') == expected,
                    'Invalid native ID encoding')
            with gzip.GzipFile(fileobj=io.BytesIO(payload)) as stream:
                decoded = stream.read(expected + 1)
                require(len(decoded) == expected and not stream.read(1), 'ID decoded length mismatch')
        else:
            require(asset.get('encoding') == 'json', f'{name}: invalid encoding')
            require(json.loads(payload).get('schemaVersion') == 1, f'{name}: invalid schema')
        files[path] = payload
    source = manifest.get('source', {})
    provenance_path = local_path(folder, source.get('provenanceUrl'))
    require(provenance_path not in files and provenance_path.stat().st_size <= MAX_ASSET,
            'Invalid provenance path or size')
    provenance_bytes = provenance_path.read_bytes()
    provenance = json.loads(provenance_bytes)
    require(digest(encoded(provenance)) == source.get('fingerprint'), 'Provenance fingerprint mismatch')
    require(digest(encoded(dict(schemaVersion=1, assets=assets, source=provenance))) == manifest.get('revision'),
            'Dataset revision mismatch')
    files[provenance_path] = provenance_bytes
    return files


def overlay_files(folder):
    """Validate and return an optional runtime overlay catalog closure."""
    folder = Path(folder).resolve()
    overlay_candidate = folder / 'assets/overlays'
    require(not overlay_candidate.is_symlink(), 'Overlay root may not be a symbolic link')
    catalog_path = overlay_candidate / 'catalog.json'
    require(not catalog_path.is_symlink(), 'Overlay catalog may not be a symbolic link')
    if not catalog_path.exists():
        return {}
    catalog_bytes = catalog_path.read_bytes()
    require(0 < len(catalog_bytes) <= MAX_OVERLAY_CATALOG, 'Overlay catalog exceeds the 512 KiB limit')
    try:
        catalog = json.loads(catalog_bytes.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError('Invalid overlay catalog JSON') from error
    require(isinstance(catalog, dict) and catalog.get('format') == 'hgo-visualization-catalog'
            and type(catalog.get('schemaVersion')) is int and catalog.get('schemaVersion') == 1,
            'Unsupported overlay catalog')

    base_manifest_path = folder / 'assets/default/manifest.json'
    base = json.loads(base_manifest_path.read_bytes())
    base_identity = dict(id=base.get('id'), revision=base.get('revision'))
    require(catalog.get('baseDataset') == base_identity, 'Overlay catalog base dataset mismatch')
    expected_assets = {'localization', 'metrics', 'terrain', 'terrainBalanced',
                       'terrainPalette', 'terrainLabels', 'rivers', 'riversBalanced', 'nightLights',
                       'illumination'}
    assets = catalog.get('assets')
    require(isinstance(assets, dict) and set(assets) == expected_assets,
            'Overlay catalog asset set is invalid')
    overlays = (folder / 'assets/overlays').resolve()
    files = {catalog_path: catalog_bytes}
    seen_paths = set()

    def resolve_overlay(relative):
        require(isinstance(relative, str) and relative and not relative.startswith(('/', '\\'))
                and '\\' not in relative and ':' not in relative,
                'Overlay catalog path must be relative')
        parsed = Path(relative)
        require(not parsed.is_absolute() and parsed.as_posix() == relative
                and all(part not in ('', '.', '..') for part in parsed.parts),
                'Overlay catalog path escapes overlays')
        current = overlays
        for part in parsed.parts:
            current = current / part
            require(not current.is_symlink(), 'Symbolic-link overlay asset refused')
        resolved = current.resolve()
        require(resolved.is_relative_to(overlays) and resolved.is_file(),
                f'Overlay catalog asset is missing or escapes overlays: {relative}')
        return resolved

    def verified_file(descriptor, category):
        require(isinstance(descriptor, dict), f'Invalid {category} descriptor')
        relative = descriptor.get('path')
        path = resolve_overlay(relative)
        require(relative not in seen_paths, f'Duplicate overlay closure path: {relative}')
        seen_paths.add(relative)
        expected_length = descriptor.get('byteLength')
        expected_hash = descriptor.get('sha256')
        require(type(expected_length) is int and 0 < expected_length <= MAX_OVERLAY_ASSET
                and path.stat().st_size == expected_length,
                f'{category}: transport length mismatch')
        require(isinstance(expected_hash, str) and re.fullmatch(r'[a-f0-9]{64}', expected_hash),
                f'{category}: invalid SHA-256')
        payload = path.read_bytes()
        require(digest(payload) == expected_hash, f'{category}: SHA-256 mismatch')
        files[path] = payload
        return payload

    for name, asset in assets.items():
        require(isinstance(asset, dict), f'{name}: invalid overlay asset descriptor')
        if name == 'illumination':
            require(asset.get('vectorEncoding') == 'premultiplied-unit-rgb-edge-fade-v2',
                    'Unsupported illumination vector encoding')
        payload = verified_file(asset, name)
        encoding = asset.get('encoding')
        if encoding == 'json':
            require('dtype' not in asset and 'decodedByteLength' not in asset,
                    f'{name}: JSON asset has binary metadata')
            try:
                json.loads(payload.decode('utf-8'))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise ValueError(f'{name}: invalid JSON asset') from error
        elif encoding == 'gzip':
            width, height, channels = asset.get('width'), asset.get('height'), asset.get('channels')
            require(asset.get('dtype') == 'u8' and type(width) is int and type(height) is int
                    and width > 0 and height > 0 and type(channels) is int and channels in (1, 4),
                    f'{name}: unsupported gzip asset shape')
            decoded_length = width * height * channels
            require(decoded_length <= MAX_OVERLAY_ASSET and asset.get('decodedByteLength') == decoded_length,
                    f'{name}: declared decoded size mismatch')
            try:
                with gzip.GzipFile(fileobj=io.BytesIO(payload)) as stream:
                    decoded = stream.read(decoded_length + 1)
                    require(len(decoded) == decoded_length and not stream.read(1),
                            f'{name}: gzip decoded size mismatch')
            except OSError as error:
                raise ValueError(f'{name}: invalid gzip stream') from error
        else:
            raise ValueError(f'{name}: unsupported overlay encoding')

    provenance = catalog.get('provenance')
    require(isinstance(provenance, list) and len(provenance) <= 2048,
            'Invalid overlay provenance list')
    for item in provenance:
        require(isinstance(item, dict) and set(item) == {'path', 'byteLength', 'sha256'},
                'Invalid overlay provenance descriptor')
        verified_file(item, 'Overlay provenance')
    return files


def build_app(source_dir, output_dir, main_url=DEFAULT_MAIN_URL):
    source = Path(source_dir).resolve()
    requested_output = Path(output_dir)
    require(not requested_output.is_symlink(), 'Output may not be a symbolic link')
    output = requested_output.resolve()
    require(output != source and not source.is_relative_to(output) and not output.is_relative_to(source),
            'Output must be outside the application source and cannot contain it')
    parsed = urlsplit(main_url)
    require(isinstance(main_url, str) and main_url and not parsed.scheme and not parsed.netloc
            and not main_url.startswith(('/', '\\')) and '\\' not in main_url,
            'Main application link must be relative')
    planned = {}
    for name in ['index.html', 'styles.css']:
        path = (source / name).resolve()
        require(path.is_relative_to(source) and path.is_file(), f'Missing app entry: {name}')
        planned[Path(name)] = path.read_bytes()
    entry = planned[Path('index.html')].decode('utf-8')
    require(entry.count('href="../../index.html"') == 1, 'Expected one explicit main application link')
    planned[Path('index.html')] = entry.replace('href="../../index.html"', f'href="{html.escape(main_url, quote=True)}"').encode('utf-8')
    for path in sorted((source / 'src').rglob('*')):
        if not path.is_file():
            continue
        require(path.resolve().is_relative_to(source), 'Application source link escapes source')
        require(path.suffix in {'.js', '.json', '.css'}, f'Unexpected browser source file: {path.name}')
        planned[path.relative_to(source)] = path.read_bytes()
    require(Path('src/main.js') in planned, 'Missing application module entry')
    for path, payload in dataset_files((source / 'assets/default').resolve()).items():
        require(path.is_relative_to(source), 'Dataset escapes app source')
        planned[path.relative_to(source)] = payload
    for path, payload in overlay_files(source).items():
        require(path.is_relative_to(source), 'Overlay closure escapes app source')
        relative = path.relative_to(source)
        require(relative not in planned, 'Overlay closure collides with another packaged file')
        planned[relative] = payload
    if output.exists():
        require(output.is_dir(), 'Output is not a directory')
        existing = [path for path in output.rglob('*') if path.is_file() or path.is_symlink()]
        if existing:
            receipt = output / RECEIPT
            require(receipt.is_file(), 'Refusing to replace an output without an HGO build receipt')
            owned = json.loads(receipt.read_text(encoding='utf-8'))
            require(owned.get('format') == 'hgo-app-build' and isinstance(owned.get('files'), list),
                    'Invalid HGO build receipt')
            expected = set(owned['files']) | {RECEIPT}
            require(all(not path.is_symlink() and path.relative_to(output).as_posix() in expected for path in existing),
                    'Output contains unowned files or symbolic links')
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.hgo-build-', dir=output.parent))
    try:
        for relative, payload in planned.items():
            path = stage / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
        receipt = dict(format='hgo-app-build', files=sorted(path.as_posix() for path in planned))
        (stage / RECEIPT).write_bytes(encoded(receipt))
        if output.exists():
            shutil.rmtree(output)
        for attempt in range(4):
            require(not output.exists() and not output.is_symlink(),
                    'Output appeared during publication; refusing to replace it')
            try:
                # On Windows rename also refuses a destination created after the check.
                stage.rename(output)
                break
            except PermissionError as error:
                if sys.platform != 'win32' or getattr(error, 'winerror', None) not in {5, 32} or attempt == 3:
                    raise
                time.sleep(0.05 * (attempt + 1))
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return dict(output=str(output), fileCount=len(planned), byteLength=sum(map(len, planned.values())))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[3] / '.runtime/dist/hgo')
    parser.add_argument('--main-url', default=DEFAULT_MAIN_URL)
    args = parser.parse_args()
    print(json.dumps(build_app(Path(__file__).resolve().parents[1], args.output, args.main_url)))
