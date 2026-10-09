import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { packPoliticalIdRasterAssetPilot, unpackPoliticalIdRasterAssetPilot,
  downloadPoliticalIdRasterAssetPilot, PoliticalIdRasterPilotValidationError,
} from '../tools/prototypes/political-id-raster/asset_pilot.js';
import { materializePoliticalIdRasterAssets } from '../tools/prototypes/political-id-raster/materialize_assets.mjs';
import { encodePoliticalIdRasterAsset } from '../js/core/renderer/political_id_raster_assets.js';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
function asset(identity = 'scenario:tile:1') {
  const tile = { width: 1, height: 1, originX: 0, originY: 0,
    codes: new Uint32Array([7]), edgeIds: new Uint32Array(), edgeWeights: new Float32Array() };
  return { identity, buffer: encodePoliticalIdRasterAsset(tile, { identity, codeToId: { 7: 'feature-A' } }) };
}
function bundle(assets = [asset()]) { return packPoliticalIdRasterAssetPilot({ scenarioId: 'pilot', assets }); }
function malformed(metadata, binary = new Uint8Array(asset().buffer)) {
  const json = new TextEncoder().encode(JSON.stringify(metadata));
  const bytes = new Uint8Array(4 + json.length + binary.length);
  new DataView(bytes.buffer).setUint32(0, json.length, true);
  bytes.set(json, 4); bytes.set(binary, 4 + json.length);
  return bytes.buffer;
}
async function temporary() {
  const base = path.join(root, '.runtime', 'tmp');
  await fs.mkdir(base, { recursive: true });
  return fs.mkdtemp(path.join(base, 'political-id-pilot-test-'));
}

test('pilot bundle roundtrip deduplicates identical identities and preserves asset bytes', () => {
  const original = asset();
  const packed = bundle([original, original, asset('tile:2')]);
  const unpacked = unpackPoliticalIdRasterAssetPilot(packed);
  assert.equal(unpacked.scenarioId, 'pilot'); assert.equal(unpacked.schemaVersion, 1);
  assert.equal(unpacked.tiles.length, 2);
  assert.deepEqual(unpacked.tiles[0], original);
  const conflict = { identity: original.identity, buffer: original.buffer.slice(0) };
  new Uint8Array(conflict.buffer)[0] = 0;
  assert.throws(() => bundle([original, conflict]), /Conflicting duplicate/);
  assert.throws(() => bundle(Array.from({ length: 129 }, () => original)), /tile count/);
});

test('malformed pilot rejects unsafe offset arithmetic, gaps, overlap, duplicate identities and trailing bytes', () => {
  const item = asset();
  const entry = { identity: item.identity, offset: 0, byteLength: item.buffer.byteLength };
  const valid = { schemaVersion: 1, scenarioId: 'pilot', tiles: [entry] };
  for (const metadata of [
    { ...valid, schemaVersion: 2 },
    { ...valid, scenarioId: '' },
    { ...valid, tiles: [{ ...entry, offset: -1 }] },
    { ...valid, tiles: [{ ...entry, offset: 1 }] },
    { ...valid, tiles: [{ ...entry, offset: Number.MAX_SAFE_INTEGER + 1 }] },
    { ...valid, tiles: [{ ...entry, byteLength: Number.MAX_SAFE_INTEGER }] },
    { ...valid, tiles: [{ ...entry, byteLength: 0 }] },
    { ...valid, tiles: [{ ...entry, byteLength: 1.5 }] },
    { ...valid, tiles: [{ ...entry, byteLength: entry.byteLength - 1 }] },
    { ...valid, tiles: [entry, { ...entry, offset: entry.byteLength }] },
    { ...valid, tiles: [entry, { ...entry, identity: 'different', offset: 0 }] },
    { ...valid, tiles: [{ ...entry, path: '../../escape.pidr' }] },
  ]) assert.throws(() => unpackPoliticalIdRasterAssetPilot(malformed(metadata)), PoliticalIdRasterPilotValidationError);
  const overlong = bundle(); new DataView(overlong).setUint32(0, 0xffffffff, true);
  assert.throws(() => unpackPoliticalIdRasterAssetPilot(overlong), /metadata length/);
  const utf8 = bundle(); new Uint8Array(utf8)[4] = 255;
  assert.throws(() => unpackPoliticalIdRasterAssetPilot(utf8), /UTF-8/);
  assert.throws(() => unpackPoliticalIdRasterAssetPilot(bundle().slice(0, -1)), /offset|byte length/);
});

test('download helper calls passed renderer once and revokes object URL even when click fails', async () => {
  const originalDocument = globalThis.document;
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  let captures = 0, revoked = 0, removed = 0, clicks = 0;
  const anchor = { click() { clicks += 1; }, remove() { removed += 1; } };
  globalThis.document = { createElement: () => anchor };
  URL.createObjectURL = (blob) => { assert.ok(blob instanceof Blob); return 'blob:pilot'; };
  URL.revokeObjectURL = (url) => { assert.equal(url, 'blob:pilot'); revoked += 1; };
  const renderer = { async capturePoliticalIdRasterAssets() { captures += 1; return [asset()]; } };
  try {
    const result = await downloadPoliticalIdRasterAssetPilot({ renderer, scenarioId: 'pilot' });
    assert.equal(result.tileCount, 1); assert.equal(anchor.download, 'political-id-pilot.bundle');
    assert.equal(captures, 1); assert.equal(clicks, 1); assert.equal(revoked, 1); assert.equal(removed, 1);
    anchor.click = () => { throw new Error('click blocked'); };
    await assert.rejects(downloadPoliticalIdRasterAssetPilot({ renderer, scenarioId: 'pilot' }), /click blocked/);
    assert.equal(revoked, 2);
    await assert.rejects(downloadPoliticalIdRasterAssetPilot({ renderer, scenarioId: 'pilot', filename: '../bad' }), /filename/);
    globalThis.document.createElement = () => { throw new Error('DOM unavailable'); };
    await assert.rejects(downloadPoliticalIdRasterAssetPilot({ renderer, scenarioId: 'pilot' }), /DOM unavailable/);
    assert.equal(revoked, 3);
  } finally { globalThis.document = originalDocument; URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
});

test('materializer hashes arbitrary identities into safe filenames, emits usable manifest and refuses conflicts', async () => {
  const directory = await temporary();
  try {
    const identity = '../../escaped\\name.pidr';
    const input = path.join(directory, 'pilot.bundle'), output = path.join(directory, 'assets');
    await fs.writeFile(input, Buffer.from(bundle([asset(identity)])));
    const result = await materializePoliticalIdRasterAssets({ input, output });
    const filename = `${createHash('sha256').update(identity).digest('hex')}.pidr`;
    assert.deepEqual((await fs.readdir(output)).sort(), [filename, 'manifest.json', 'pilot-metadata.json'].sort());
    const manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest, result.manifest);
    assert.equal(manifest.tiles[0].identity, identity);
    assert.equal(manifest.tiles[0].url, `./${filename}`);
    assert.deepEqual(await fs.readFile(path.join(output, filename)), Buffer.from(asset(identity).buffer));
    await materializePoliticalIdRasterAssets({ input, output });
    await fs.writeFile(path.join(output, 'manifest.json'), 'existing unrelated manifest');
    await fs.writeFile(input, Buffer.from(bundle([asset(identity), asset('new-tile')])));
    await assert.rejects(materializePoliticalIdRasterAssets({ input, output }), /Conflicting output file/);
    assert.equal((await fs.readdir(output)).length, 3, 'conflict preflight writes no additional tile');
    assert.equal(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'), 'existing unrelated manifest');
    await assert.rejects(materializePoliticalIdRasterAssets({ input, output: path.join(root, 'data', 'pilot-test') }), /\.runtime/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('materializer rejects invalid asset payload and identity mismatch before creating output', async () => {
  const directory = await temporary();
  try {
    const input = path.join(directory, 'bad.bundle'), output = path.join(directory, 'output');
    const bad = asset(); new Uint8Array(bad.buffer)[0] = 0;
    await fs.writeFile(input, Buffer.from(bundle([bad])));
    await assert.rejects(materializePoliticalIdRasterAssets({ input, output }), /asset magic/);
    await assert.rejects(fs.access(output), { code: 'ENOENT' });
    const mismatch = asset(); mismatch.identity = 'other-identity';
    await fs.writeFile(input, Buffer.from(bundle([mismatch])));
    await assert.rejects(materializePoliticalIdRasterAssets({ input, output }), /identity does not match/);
    await assert.rejects(fs.access(output), { code: 'ENOENT' });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('materializer refuses symlink output chains and preserves their destination', async () => {
  const directory = await temporary();
  try {
    const input = path.join(directory, 'valid.bundle'), target = path.join(directory, 'target'), link = path.join(directory, 'linked');
    await fs.writeFile(input, Buffer.from(bundle()));
    await fs.mkdir(target);
    await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(materializePoliticalIdRasterAssets({ input, output: path.join(link, 'assets') }), /symlink/);
    assert.deepEqual(await fs.readdir(target), []);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('materialize CLI requires explicit input/output and accepts local runtime output', async () => {
  const directory = await temporary();
  const cli = path.join(root, 'tools', 'prototypes', 'political-id-raster', 'materialize_assets.mjs');
  try {
    const input = path.join(directory, 'valid.bundle'), output = path.join(directory, 'output');
    await fs.writeFile(input, Buffer.from(bundle()));
    const result = await execute(process.execPath, [cli, '--input', input, '--output', output], { cwd: root });
    assert.equal(JSON.parse(result.stdout).tileCount, 1);
    await assert.rejects(execute(process.execPath, [cli], { cwd: root }), (error) => error.code === 1 && /required/.test(error.stderr));
    await assert.rejects(execute(process.execPath, [cli, '--other', input], { cwd: root }), (error) => error.code === 1 && /Usage/.test(error.stderr));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
