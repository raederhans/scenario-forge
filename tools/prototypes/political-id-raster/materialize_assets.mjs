import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { unpackPoliticalIdRasterAssetPilot, POLITICAL_ID_PILOT_MAX_BYTES } from './asset_pilot.js';
import { decodePoliticalIdRasterAsset } from '../../../js/core/renderer/political_id_raster_assets.js';

const runtimeRoot = fileURLToPath(new URL('../../../.runtime/', import.meta.url));
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
};
async function safeOutputDirectory(output) {
  const resolved = path.resolve(output);
  if (!inside(runtimeRoot, resolved)) throw new Error('Output must be a subdirectory of this repository .runtime directory.');
  // Refuse existing symlinks in the output chain before creating or writing it.
  const absoluteRoot = path.parse(resolved).root;
  let current = absoluteRoot;
  for (const component of resolved.slice(absoluteRoot.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      const entry = await fs.lstat(current);
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('Output path contains a symlink or non-directory component.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return resolved;
}
async function existingMatches(filename, bytes) {
  try {
    const entry = await fs.lstat(filename);
    if (entry.isSymbolicLink() || !entry.isFile() || entry.size !== bytes.byteLength) throw new Error(`Conflicting output file: ${path.basename(filename)}`);
    if (!(await fs.readFile(filename)).equals(bytes)) throw new Error(`Conflicting output file: ${path.basename(filename)}`);
    return true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; return false; }
}

export async function materializePoliticalIdRasterAssets({ input, output } = {}) {
  if (typeof input !== 'string' || !input || typeof output !== 'string' || !output) throw new TypeError('--input and --output are required.');
  const directory = await safeOutputDirectory(output);
  const inputFile = await fs.open(path.resolve(input), 'r');
  let bytes;
  try {
    const info = await inputFile.stat();
    if (!info.isFile() || info.size > POLITICAL_ID_PILOT_MAX_BYTES || info.size < 4) throw new Error('Invalid pilot input size.');
    bytes = await inputFile.readFile();
  } finally { await inputFile.close(); }
  const bundle = unpackPoliticalIdRasterAssetPilot(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const files = [], manifest = { schemaVersion: 1, tiles: [] };
  let totalBytes = 0;
  for (const tile of bundle.tiles) {
    // Synthetic codes verify the complete codec contract without a live palette.
    const dictionary = new Map();
    const decoded = decodePoliticalIdRasterAsset(tile.buffer, { identity: tile.identity, idToCode: (id) => {
      if (!dictionary.has(id)) dictionary.set(id, dictionary.size + 1);
      return dictionary.get(id);
    } });
    if (!decoded) throw new Error('Pilot tile identity does not match its asset payload.');
    const filename = `${createHash('sha256').update(tile.identity).digest('hex')}.pidr`;
    files.push({ filename, bytes: Buffer.from(tile.buffer) });
    manifest.tiles.push({ identity: tile.identity, url: `./${filename}`, byteLength: tile.buffer.byteLength });
    totalBytes += tile.buffer.byteLength;
  }
  const metadata = { schemaVersion: 1, format: 'political-id-pilot-length-prefixed-json-v1',
    scenarioId: bundle.scenarioId, tileCount: bundle.tiles.length, assetBytes: totalBytes, bundleBytes: bytes.byteLength };
  const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  files.push({ filename: 'manifest.json', bytes: json(manifest) }, { filename: 'pilot-metadata.json', bytes: json(metadata) });
  // Preflight every destination: a manifest conflict must not leave new tiles.
  for (const file of files) file.exists = await existingMatches(path.join(directory, file.filename), file.bytes);
  await fs.mkdir(directory, { recursive: true });
  for (const file of files) {
    if (file.exists) continue;
    try { await fs.writeFile(path.join(directory, file.filename), file.bytes, { flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await existingMatches(path.join(directory, file.filename), file.bytes);
    }
  }
  return { output: directory, ...metadata, manifest };
}

function argumentsFromCli(args) {
  const options = {};
  for (let at = 0; at < args.length; at += 2) {
    const flag = args[at];
    if (!['--input', '--output'].includes(flag) || options[flag.slice(2)] || !args[at + 1] || args[at + 1].startsWith('--')) throw new Error('Usage: node materialize_assets.mjs --input <pilot.bundle> --output <repo/.runtime/subdirectory>');
    options[flag.slice(2)] = args[at + 1];
  }
  return options;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await materializePoliticalIdRasterAssets(argumentsFromCli(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ output: result.output, tileCount: result.tileCount, assetBytes: result.assetBytes })}\n`);
  } catch (error) { process.stderr.write(`${error.name}: ${error.message}\n`); process.exitCode = 1; }
}
