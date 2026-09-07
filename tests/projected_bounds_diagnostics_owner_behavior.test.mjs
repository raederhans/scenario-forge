import assert from "node:assert/strict";
import test from "node:test";
import { createProjectedBoundsDiagnosticsOwner } from "../js/core/renderer/projected_bounds_diagnostics_owner.js";

test("projected diagnostics read live counters and isolate state and metric snapshots", () => {
  const runtimeState = {};
  const otherState = {};
  const metrics = [];
  const create = (runtimeState) => createProjectedBoundsDiagnosticsOwner({ runtimeState, recordRenderPerfMetric: (...args) => metrics.push(args) });
  const owner = create(runtimeState);
  const other = create(otherState);
  const feature = { geometry: { type: "Polygon" } };
  owner.recordProjectedBoundsDiagnosticsState(feature, "projected");
  const initial = runtimeState.projectedBoundsDiagnostics;
  assert.deepEqual(initial, { total: 1, byGeometryType: { Polygon: 1 }, byReason: { projected: 1 } });
  runtimeState.projectedBoundsDiagnostics = { total: 10, byGeometryType: { Polygon: 10 }, byReason: { projected: 10 } };
  owner.recordProjectedBoundsDiagnosticsState(feature, "projected");
  assert.equal(runtimeState.projectedBoundsDiagnostics.total, 11);
  assert.equal(initial.total, 1);
  assert.equal(metrics[0][2].byGeometryType.Polygon, 1);
  other.recordProjectedBoundsDiagnosticsState(null);
  assert.deepEqual(otherState.projectedBoundsDiagnostics, { total: 1, byGeometryType: { Unknown: 1 }, byReason: { unknown: 1 } });
  assert.equal(runtimeState.projectedBoundsDiagnostics.total, 11);
});
