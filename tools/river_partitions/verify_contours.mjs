#!/usr/bin/env node
// Full-map acceptance uses the same graph builder as runtime. No overlap allowlist.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { buildPaintContourGraph } from '../../js/core/renderer/paint_contour_graph.js';
import { verifyRiverPartitionFingerprints } from '../../js/core/river_paint/partition_model.js';

export const LENGTH_TOLERANCE_DEGREES = 1e-9;
const idOf = feature => String(feature.properties?.id || feature.id || '').trim();
const ensure = (condition, message) => { if (!condition) throw new TypeError(message); };

export function composeContourFeatures(source, pack) {
  const parents = new Map(pack.parents.map(p => [p.parentId, p]));
  const support = new Map((pack.support || []).map(p => [p.parentId, p]));
  return source.flatMap(feature => parents.has(idOf(feature))
    ? parents.get(idOf(feature)).cells.map(cell => ({ type: 'Feature', id: cell.id, geometry: cell.geometry }))
    : [{ ...feature, id: idOf(feature), geometry: support.get(idOf(feature))?.geometry || feature.geometry }]);
}

export function contourLengths(graph, pack) {
  const cellOwners = new Map(pack.parents.flatMap(p => p.cells.map(cell => [cell.id, p.parentId])));
  const neighbors = new Map(), seams = new Map();
  for (let arc = 0; arc < graph.offsets.length - 1; arc++) {
    const ids = [0, 1].map(side => graph.featureIds[graph.owners[arc * 2 + side]])
      .map(id => cellOwners.get(id) || id);
    let length = 0;
    for (let point = graph.offsets[arc]; point < graph.offsets[arc + 1] - 1; point++) {
      length += Math.hypot(graph.coordinates[point * 2 + 2] - graph.coordinates[point * 2],
        graph.coordinates[point * 2 + 3] - graph.coordinates[point * 2 + 1]);
    }
    const table = ids[0] === ids[1] ? seams : neighbors;
    const key = ids[0] === ids[1] ? ids[0] : JSON.stringify(ids.sort());
    table.set(key, (table.get(key) || 0) + length);
  }
  return { neighbors, seams };
}

// The graph exposes aggregate ambiguity counts, but a constant count can hide
// an old conflict disappearing while a new one appears elsewhere. Inventory
// its exact identity segments, and cross-check the count against the real graph.
// This is diagnostic indexing only; graph construction remains runtime-owned.
function ambiguousSegmentInventory(features, pack, graph) {
  const owners = new Map(pack.parents.flatMap(p => p.cells.map(c => [c.id, p.parentId])));
  const edges = new Map();
  const snap = point => {
    let x = Math.round(point[0] * 1e7);
    x = ((x + 180e7) % 360e7 + 360e7) % 360e7 - 180e7;
    return [x, Math.round(point[1] * 1e7)];
  };
  for (const feature of features) {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const polygon of polygons) for (let ringIndex = 0; ringIndex < polygon.length; ringIndex++) {
      const ring = polygon[ringIndex];
      let area = 0;
      for (let i = 1; i < ring.length; i++) {
        let dx = ring[i][0] - ring[i - 1][0];
        if (dx > 180) dx -= 360;
        if (dx < -180) dx += 360;
        area -= dx * (ring[i][1] + ring[i - 1][1]);
      }
      const side = (area < 0 ? -1 : 1) * (ringIndex ? -1 : 1);
      for (let i = 1; i < ring.length; i++) {
        let a = snap(ring[i - 1]), b = snap(ring[i]);
        const order = a[0] - b[0] || a[1] - b[1];
        if (!order) continue;
        if (order > 0) [a, b] = [b, a];
        const key = `${a};${b}`;
        if (!edges.has(key)) edges.set(key, []);
        const group = edges.get(key), sign = side * (order < 0 ? 1 : -1);
        if (!group.some(member => member.id === feature.id && member.sign === sign)) group.push({ id: feature.id, sign });
      }
    }
  }
  const conflicts = new Map();
  for (const [key, group] of edges) {
    const left = new Set(group.filter(m => m.sign > 0).map(m => m.id));
    const right = new Set(group.filter(m => m.sign < 0).map(m => m.id));
    const unique = new Set(group.map(m => m.id));
    if (unique.size < 2 || (left.size === 1 && right.size === 1 && [...left][0] !== [...right][0])) continue;
    const parentIds = [...new Set([...unique].map(id => owners.get(id) || id))].sort();
    conflicts.set(`${key}|${JSON.stringify(parentIds)}`, { identitySegment: key, parentIds, featureIds: [...unique].sort() });
  }
  ensure(conflicts.size === graph.diagnostics.ambiguousSegments,
    `Ambiguity inventory differs from runtime graph (${conflicts.size} vs ${graph.diagnostics.ambiguousSegments}); inspect graph identity contract`);
  return conflicts;
}

function validateScope(source, pack, expectations, label) {
  const ids = source.map(idOf), sourceIds = new Set(ids);
  ensure(ids.length > 0 && !ids.includes('') && sourceIds.size === ids.length, 'Source IDs must be nonempty and unique');
  ensure(pack && Array.isArray(pack.parents) && pack.parents.length > 0, `${label}: missing parents`);
  ensure(expectations && typeof expectations === 'object' && !Array.isArray(expectations), `${label}: missing seam expectations`);
  const seen = new Set(), cells = new Set();
  for (const parent of [...pack.parents, ...(pack.support || [])]) {
    ensure(sourceIds.has(parent.parentId) && !seen.has(parent.parentId), `${label}: missing/duplicate source parent ${parent.parentId}`);
    seen.add(parent.parentId);
    const original = source[ids.indexOf(parent.parentId)];
    ensure(isDeepStrictEqual(original.geometry, parent.parentGeometry), `${label}: source parent geometry changed ${parent.parentId}`);
    if (!parent.cells) continue;
    ensure(Array.isArray(parent.cells) && parent.cells.length >= 2, `${label}: invalid cells ${parent.parentId}`);
    for (const cell of parent.cells) {
      ensure(typeof cell.id === 'string' && cell.id && !cells.has(cell.id) && !sourceIds.has(cell.id), `${label}: duplicate/colliding cell ID ${parent.parentId}/${cell.id}`);
      cells.add(cell.id);
    }
    ensure(Number.isFinite(expectations[parent.parentId]) && expectations[parent.parentId] >= 0,
      `${label}: invalid/missing seam expectation ${parent.parentId}`);
  }
  ensure(Object.keys(expectations).length === pack.parents.length, `${label}: unexpected seam expectation IDs`);
}

export function verifyContours({ sourceFeatures, baseline, candidate, baselineSeams, candidateSeams, scope = {} }) {
  validateScope(sourceFeatures, baseline, baselineSeams, 'baseline');
  validateScope(sourceFeatures, candidate, candidateSeams, 'candidate');
  const beforeFeatures = composeContourFeatures(sourceFeatures, baseline);
  const afterFeatures = composeContourFeatures(sourceFeatures, candidate);
  const before = buildPaintContourGraph(beforeFeatures), after = buildPaintContourGraph(afterFeatures);
  if (before.diagnostics.invalidRings || after.diagnostics.invalidRings) {
    const invalid = features => features.filter(f => buildPaintContourGraph([f]).diagnostics.invalidRings)
      .map(f => f.id);
    throw new TypeError(`Invalid source/composed rings: baseline IDs=${JSON.stringify(invalid(beforeFeatures))}; candidate IDs=${JSON.stringify(invalid(afterFeatures))}`);
  }
  const priorAmbiguities = ambiguousSegmentInventory(beforeFeatures, baseline, before);
  const nextAmbiguities = ambiguousSegmentInventory(afterFeatures, candidate, after);
  const addedAmbiguousSegments = [...nextAmbiguities].filter(([key]) => !priorAmbiguities.has(key)).map(([, row]) => row);
  const left = contourLengths(before, baseline), right = contourLengths(after, candidate);
  // Union is essential: existing-pair-only comparison misses brand new edges.
  const pairKeys = new Set([...left.neighbors.keys(), ...right.neighbors.keys()]);
  const neighborDifferences = [...pairKeys].sort().map(key => ({ parentIds: JSON.parse(key),
    beforeLengthDegrees: left.neighbors.get(key) || 0, afterLengthDegrees: right.neighbors.get(key) || 0,
    deltaDegrees: (right.neighbors.get(key) || 0) - (left.neighbors.get(key) || 0),
  })).filter(row => Math.abs(row.deltaDegrees) > LENGTH_TOLERANCE_DEGREES);
  const seamChecks = (expected, actual) => Object.entries(expected).map(([parentId, length]) => ({ parentId,
    expectedLengthDegrees: length, actualLengthDegrees: actual.get(parentId) || 0,
    deltaDegrees: (actual.get(parentId) || 0) - length,
  })).filter(row => Math.abs(row.deltaDegrees) > LENGTH_TOLERANCE_DEGREES);
  const baselineSeamMismatches = seamChecks(baselineSeams, left.seams);
  const candidateSeamMismatches = seamChecks(candidateSeams, right.seams);
  const candidateParents = new Map(candidate.parents.map(parent => [parent.parentId, parent]));
  const originalParentChanges = baseline.parents.filter(parent => !isDeepStrictEqual(parent, candidateParents.get(parent.parentId)))
    .map(parent => ({ parentId: parent.parentId, reason: candidateParents.has(parent.parentId) ? 'parent record changed' : 'parent missing' }));
  const originalSeamChanges = baseline.parents.map(parent => ({ parentId: parent.parentId,
    deltaDegrees: (right.seams.get(parent.parentId) || 0) - (left.seams.get(parent.parentId) || 0),
  })).filter(row => Math.abs(row.deltaDegrees) > LENGTH_TOLERANCE_DEGREES);
  const diagnosticRegressions = ['invalidRings', 'ambiguousSegments', 'ambiguousQuantizedSegments']
    .filter(key => after.diagnostics[key] > before.diagnostics[key])
    .map(key => ({ metric: key, before: before.diagnostics[key], after: after.diagnostics[key] }));
  const passed = [neighborDifferences, baselineSeamMismatches, candidateSeamMismatches, originalParentChanges,
    originalSeamChanges, diagnosticRegressions, addedAmbiguousSegments].every(rows => rows.length === 0);
  return { schemaVersion: 1, passed, scope: { ...scope, interactiveSourceCount: sourceFeatures.length,
    baselineParentCount: baseline.parents.length, candidateParentCount: candidate.parents.length,
    baselineCellCount: baseline.parents.reduce((n, p) => n + p.cells.length, 0),
    candidateCellCount: candidate.parents.reduce((n, p) => n + p.cells.length, 0),
    beforeComposedCount: beforeFeatures.length, afterComposedCount: afterFeatures.length,
    comparedNeighborPairs: pairKeys.size, units: 'planar coordinate degrees', toleranceDegrees: LENGTH_TOLERANCE_DEGREES,
    baselineSeamCheckCount: Object.keys(baselineSeams).length, candidateSeamCheckCount: Object.keys(candidateSeams).length,
  }, beforeDiagnostics: before.diagnostics, afterDiagnostics: after.diagnostics,
  neighborDifferences, baselineSeamMismatches, candidateSeamMismatches, originalParentChanges,
  originalSeamChanges, diagnosticRegressions, addedAmbiguousSegments };
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const args = {};
    for (let i = 0; i < argv.length; i += 2) {
      ensure(['--input', '--baseline', '--candidate', '--output'].includes(argv[i]) && argv[i + 1] && !args[argv[i]], `Invalid argument ${argv[i]}`);
      args[argv[i]] = argv[i + 1];
    }
    ensure(args['--input'] && args['--baseline'] && args['--candidate'],
      'Usage: node tools/river_partitions/verify_contours.mjs --input prepared.json --baseline wave2.json --candidate pack.json [--output .runtime/report.json]');
    const input = JSON.parse(readFileSync(args['--input'], 'utf8'));
    ensure(input.schemaVersion === 1 && input.scope?.interactiveSourceCount === input.sourceFeatures?.length, 'Invalid prepared source scope');
    const readPack = async label => {
      const bytes = readFileSync(args[`--${label}`]);
      ensure(`sha256:${createHash('sha256').update(bytes).digest('hex')}` === input.digests?.[label], `${label}: pack bytes changed since input preparation`);
      return verifyRiverPartitionFingerprints(JSON.parse(bytes));
    };
    const baseline = await readPack('baseline'), candidate = await readPack('candidate');
    ensure(baseline.sceneId === candidate.sceneId && candidate.sceneId === input.scope.sceneId, 'Prepared/pack scene mismatch');
    const report = verifyContours({ ...input, baseline, candidate });
    if (args['--output']) {
      const output = resolve(args['--output']), rel = relative(resolve('.runtime'), output);
      ensure(rel && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel), 'Report must stay under this checkout .runtime/');
      ensure(!['--input', '--baseline', '--candidate'].some(key => resolve(args[key]) === output), 'Report must not overwrite input');
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify(report, null, 2));
    return report.passed ? 0 : 1;
  } catch (error) {
    console.error(`Contour acceptance input/error: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
