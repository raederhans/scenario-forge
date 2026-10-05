#!/usr/bin/env node
// Geometry domains for ordered parent rendering. Visibility is separately
// checked against source-backed occlusion oracles and actual Canvas output.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPaintContourGraph } from '../../js/core/renderer/paint_contour_graph.js';
import { verifyRiverPartitionFingerprints } from '../../js/core/river_paint/partition_model.js';
import { composeContourFeatures, contourLengths, LENGTH_TOLERANCE_DEGREES, verifyContours } from './verify_contours.mjs';
import { createInheritedCollinearConflictClassifier } from './inherited_collinear_conflicts.mjs';

const identityPoint = point => {
  const x = Math.round(point[0] * 1e7);
  return [((x + 180e7) % 360e7 + 360e7) % 360e7 - 180e7, Math.round(point[1] * 1e7)];
};
function identitySegment(a, b) {
  const left = identityPoint(a), right = identityPoint(b);
  if (left[0] > right[0] || (left[0] === right[0] && left[1] > right[1])) return `${right};${left}`;
  return `${left};${right}`;
}

export function verifyLayeredContours(input) {
  const legacy = verifyContours(input);
  const buildParents = (pack, expected) => {
    const lengths = new Map(), segments = new Map(), failures = [];
    for (const parent of pack.parents) {
      const graph = buildPaintContourGraph(parent.cells.map(cell => ({ id: cell.id, geometry: cell.geometry })));
      const actual = contourLengths(graph, pack).seams.get(parent.parentId) || 0;
      lengths.set(parent.parentId, actual);
      const delta = actual - expected[parent.parentId];
      if (Math.abs(delta) > LENGTH_TOLERANCE_DEGREES || graph.diagnostics.invalidRings
        || graph.diagnostics.ambiguousSegments || graph.diagnostics.ambiguousQuantizedSegments) {
        failures.push({ parentId: parent.parentId, expectedLengthDegrees: expected[parent.parentId],
          actualLengthDegrees: actual, deltaDegrees: delta, diagnostics: graph.diagnostics });
      }
      const identities = new Set();
      for (let arc = 0; arc < graph.offsets.length - 1; arc++) {
        for (let p = graph.offsets[arc]; p < graph.offsets[arc + 1] - 1; p++) {
          identities.add(identitySegment([graph.coordinates[p * 2], graph.coordinates[p * 2 + 1]],
            [graph.coordinates[p * 2 + 2], graph.coordinates[p * 2 + 3]]));
        }
      }
      segments.set(parent.parentId, identities);
    }
    return { lengths, segments, failures };
  };
  const baseline = buildParents(input.baseline, input.baselineSeams);
  const candidate = buildParents(input.candidate, input.candidateSeams);
  const cellParents = new Map(input.candidate.parents.flatMap(parent => parent.cells.map(cell => [cell.id, parent.parentId])));
  const ambiguityAttributions = legacy.addedAmbiguousSegments.map(row => {
    const counts = new Map();
    for (const id of row.featureIds) {
      const parent = cellParents.get(id);
      if (parent) counts.set(parent, (counts.get(parent) || 0) + 1);
    }
    const internalParents = [...counts].filter(([parent, count]) => count >= 2
      && candidate.segments.get(parent)?.has(row.identitySegment)).map(([parent]) => parent);
    return { ...row, internalParents,
      classification: internalParents.length ? 'parent-local-internal-seam' : null };
  });
  const unresolved = ambiguityAttributions.filter(row => !row.internalParents.length);
  if (unresolved.length) {
    const classifyInherited = createInheritedCollinearConflictClassifier({
      baselineFeatures: composeContourFeatures(input.sourceFeatures, input.baseline),
      candidateFeatures: composeContourFeatures(input.sourceFeatures, input.candidate),
      baseline: input.baseline, candidate: input.candidate,
      identitySegments: unresolved.map(row => row.identitySegment),
    });
    for (const row of unresolved) {
      const attribution = classifyInherited(row);
      if (attribution) Object.assign(row, attribution);
    }
  }
  const unattributedAmbiguities = ambiguityAttributions.filter(row => !row.classification);
  const originalLocalSeamChanges = input.baseline.parents.map(parent => ({ parentId: parent.parentId,
    deltaDegrees: (candidate.lengths.get(parent.parentId) || 0) - (baseline.lengths.get(parent.parentId) || 0),
  })).filter(row => Math.abs(row.deltaDegrees) > LENGTH_TOLERANCE_DEGREES);
  const unrelatedDiagnosticRegressions = legacy.diagnosticRegressions.filter(row =>
    !['ambiguousSegments', 'ambiguousQuantizedSegments'].includes(row.metric));
  const geometryPassed = [legacy.neighborDifferences, legacy.originalParentChanges, baseline.failures,
    candidate.failures, originalLocalSeamChanges, unattributedAmbiguities,
    unrelatedDiagnosticRegressions].every(rows => rows.length === 0);
  return { schemaVersion: 1, contract: 'ordered-parent-internal-contours-v1', geometryPassed,
    visibilityVerified: false,
    visibilityRequirement: 'Independent visible-parent/seam oracles and runtime pixel, hit, repaint and export checks are required.',
    scope: legacy.scope, legacyGlobalReport: legacy,
    baselineLocalSeamMismatches: baseline.failures, candidateLocalSeamMismatches: candidate.failures,
    originalLocalSeamChanges, ambiguityAttributions, unattributedAmbiguities, unrelatedDiagnosticRegressions };
}

export async function main(argv = process.argv.slice(2)) {
  const ensure = (condition, message) => { if (!condition) throw new TypeError(message); };
  try {
    const args = {};
    for (let i = 0; i < argv.length; i += 2) {
      ensure(['--input', '--baseline', '--candidate', '--output'].includes(argv[i])
        && argv[i + 1] && !args[argv[i]], `Invalid argument ${argv[i]}`);
      args[argv[i]] = argv[i + 1];
    }
    ensure(args['--input'] && args['--baseline'] && args['--candidate'],
      'Usage: node tools/river_partitions/verify_layered_contours.mjs --input prepared.json --baseline wave2.json --candidate pack.json [--output .runtime/report.json]');
    const input = JSON.parse(readFileSync(args['--input'], 'utf8'));
    ensure(input.schemaVersion === 1 && Array.isArray(input.sourceFeatures)
      && input.scope?.interactiveSourceCount === input.sourceFeatures.length, 'Invalid prepared source scope');
    // Match the legacy CLI identity gate: the prepared byte digest and the
    // independent geometry fingerprints are both required before evaluation.
    const readPack = async label => {
      const bytes = readFileSync(args[`--${label}`]);
      ensure(`sha256:${createHash('sha256').update(bytes).digest('hex')}` === input.digests?.[label],
        `${label}: pack bytes changed since input preparation`);
      return verifyRiverPartitionFingerprints(JSON.parse(bytes));
    };
    const baseline = await readPack('baseline'), candidate = await readPack('candidate');
    ensure(baseline.sceneId === candidate.sceneId && candidate.sceneId === input.scope.sceneId,
      'Prepared/pack scene mismatch');
    const report = verifyLayeredContours({ ...input, baseline, candidate });
    if (args['--output']) {
      const output = resolve(args['--output']), rel = relative(resolve('.runtime'), output);
      ensure(rel && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
        && !isAbsolute(rel), 'Report must stay under this checkout .runtime/');
      ensure(!['--input', '--baseline', '--candidate'].some(key => resolve(args[key]) === output),
        'Report must not overwrite input');
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify(report, null, 2));
    return report.geometryPassed ? 0 : 1;
  } catch (error) {
    console.error(`Layered contour acceptance input/error: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
