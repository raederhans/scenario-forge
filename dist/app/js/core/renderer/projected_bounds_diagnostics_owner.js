import { captureProjectedBoundsDiagnosticsState, setProjectedBoundsDiagnosticsState } from "../state/actions/renderer_diagnostics_actions.js";

// Own diagnostic counters independently of geometry calculation and its caches.
export function createProjectedBoundsDiagnosticsOwner({ runtimeState, recordRenderPerfMetric }) {
  function recordProjectedBoundsDiagnosticsState(feature, reason = "unknown") {
    const geometryType = String(feature?.geometry?.type || "").trim() || "Unknown";
    const currentDiagnostics = captureProjectedBoundsDiagnosticsState(runtimeState);
    const currentByGeometryType = currentDiagnostics.byGeometryType
      && typeof currentDiagnostics.byGeometryType === "object"
      ? currentDiagnostics.byGeometryType
      : {};
    const currentByReason = currentDiagnostics.byReason
      && typeof currentDiagnostics.byReason === "object"
      ? currentDiagnostics.byReason
      : {};
    const diagnostics = {
      total: Math.max(0, Number(currentDiagnostics.total || 0) + 1),
      byGeometryType: {
        ...currentByGeometryType,
        [geometryType]: Math.max(0, Number(currentByGeometryType[geometryType] || 0) + 1),
      },
      byReason: {
        ...currentByReason,
        [reason]: Math.max(0, Number(currentByReason[reason] || 0) + 1),
      },
    };
    setProjectedBoundsDiagnosticsState(runtimeState, diagnostics);
    recordRenderPerfMetric("projectedBoundsDiagnostics", 0, {
      total: diagnostics.total,
      byGeometryType: { ...diagnostics.byGeometryType },
      byReason: { ...diagnostics.byReason },
      lastGeometryType: geometryType,
      lastReason: reason,
    });
  }
  return Object.freeze({ recordProjectedBoundsDiagnosticsState });
}
