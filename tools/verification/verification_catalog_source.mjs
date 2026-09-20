import { deepFreeze, normalizeVerificationMetadataSource, verificationMetadataSourceDigest, gatePolicyAuthorityDigest } from "./catalog/normalization.mjs";
import { projectGatePolicySignals } from "./catalog/gate_policy_signals.mjs";
import { PACKAGE_SCRIPTS } from "./catalog/package_scripts.mjs";
import { CATALOG_POLICIES } from "./catalog/policies.mjs";
import { RENDERER_LAYERS_RECORDS } from "./catalog/records/renderer_layers.mjs";
import { SCENARIO_RECORDS } from "./catalog/records/scenario.mjs";
import { UI_WORKBENCH_RECORDS } from "./catalog/records/ui_workbench.mjs";
import { STARTUP_RECORDS } from "./catalog/records/startup.mjs";
import { DELIVERY_RUNTIME_RECORDS } from "./catalog/records/delivery_runtime.mjs";
import { CITY_RECORDS } from "./catalog/records/city.mjs";
import { DATA_CONTRACTS_RECORDS } from "./catalog/records/data_contracts.mjs";
import { TEST_ROUTING_RECORDS } from "./catalog/records/test_routing.mjs";
import { RENDERER_UI_BOOTSTRAP_RECORDS } from "./catalog/records/renderer_ui_bootstrap.mjs";
import { RENDERER_FRAME_ORCHESTRATION_RECORDS } from "./catalog/records/renderer_frame_orchestration.mjs";
import { RENDERER_SURFACE_STATE_RECORDS } from "./catalog/records/renderer_surface_state.mjs";
import { RENDERER_INTERACTION_RECORDS } from "./catalog/records/renderer_interaction.mjs";
import { RENDERER_CACHE_PIPELINE_RECORDS } from "./catalog/records/renderer_cache_pipeline.mjs";
import { STATE_OWNERSHIP_RECORDS } from "./catalog/records/state_ownership.mjs";
import { RENDERER_PROJECTION_VIEWPORT_RECORDS } from "./catalog/records/renderer_projection_viewport.mjs";
import { createLocalFeedbackRecords } from "./catalog/records/local_feedback.mjs";
import { createPrecisionScalingRecords } from "./catalog/records/precision_scaling.mjs";

export { normalizeVerificationMetadataSource, verificationMetadataSourceDigest, verificationGatePolicySignalsDigest } from "./catalog/normalization.mjs";

// This aggregation is the only public verification metadata authority.
// Authored definitions live in catalog/; historical receipts use a frozen snapshot.
const baseRecords = [
  ...RENDERER_LAYERS_RECORDS,
  ...SCENARIO_RECORDS,
  ...UI_WORKBENCH_RECORDS,
  ...STARTUP_RECORDS,
  ...DELIVERY_RUNTIME_RECORDS,
  ...CITY_RECORDS,
  ...DATA_CONTRACTS_RECORDS,
  ...TEST_ROUTING_RECORDS,
  ...RENDERER_UI_BOOTSTRAP_RECORDS,
  ...RENDERER_FRAME_ORCHESTRATION_RECORDS,
  ...RENDERER_SURFACE_STATE_RECORDS,
  ...RENDERER_INTERACTION_RECORDS,
  ...RENDERER_CACHE_PIPELINE_RECORDS,
  ...STATE_OWNERSHIP_RECORDS,
  ...RENDERER_PROJECTION_VIEWPORT_RECORDS,
];
const existingRecords = [...baseRecords, ...createLocalFeedbackRecords(baseRecords)];
const AUTHORED_VERIFICATION_METADATA = {
  ...CATALOG_POLICIES,
  packageScripts: PACKAGE_SCRIPTS,
  records: [...existingRecords, ...createPrecisionScalingRecords(existingRecords)],
};

export const VERIFICATION_METADATA_SOURCE = deepFreeze(
  normalizeVerificationMetadataSource(AUTHORED_VERIFICATION_METADATA),
);
export const VERIFICATION_GATE_POLICY_AUTHORITY = deepFreeze(
  structuredClone(VERIFICATION_METADATA_SOURCE.gatePolicy),
);
export const VERIFICATION_GATE_POLICY_AUTHORITY_IDENTITY = deepFreeze({
  schemaVersion: 1,
  kind: "verification-gate-policy-authority-identity",
  algorithm: "sha256",
  digest: gatePolicyAuthorityDigest(VERIFICATION_GATE_POLICY_AUTHORITY),
});
export const VERIFICATION_METADATA_SOURCE_IDENTITY = deepFreeze({
  schemaVersion: 1,
  kind: "verification-metadata-source-identity",
  algorithm: "sha256",
  digest: verificationMetadataSourceDigest(VERIFICATION_METADATA_SOURCE),
});

export function projectVerificationGatePolicySignals(options = {}) {
  return projectGatePolicySignals(
    VERIFICATION_GATE_POLICY_AUTHORITY, VERIFICATION_GATE_POLICY_AUTHORITY_IDENTITY, options,
  );
}
