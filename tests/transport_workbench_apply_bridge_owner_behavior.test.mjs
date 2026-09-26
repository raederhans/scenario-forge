import assert from "node:assert/strict";
import test from "node:test";

import { createTransportWorkbenchApplyBridgeOwner } from "../js/ui/toolbar/transport_workbench_apply_bridge_owner.js";

test("apply button explains preview and local-only capabilities without changing their gates", () => {
  const owner = createTransportWorkbenchApplyBridgeOwner({ transportWorkbenchUi: { familyConfigs: {} } });

  const preview = owner.getApplyButtonState("mineral_resources");
  assert.equal(preview.compatibility, "preview_only");
  assert.equal(preview.enabled, false);
  assert.equal(preview.label, "Preview only");
  assert.equal(preview.reason, "This layer can't be added to the main map yet.");

  const localOrder = owner.getApplyButtonState("layers");
  assert.equal(localOrder.compatibility, "local_board");
  assert.equal(localOrder.enabled, false);
  assert.equal(localOrder.label, "Workbench only");
  assert.equal(localOrder.reason, "Layer order stays inside this workbench");

  const sourcePending = owner.getApplyButtonState("road");
  assert.equal(sourcePending.compatibility, "main_map_bridge");
  assert.equal(sourcePending.enabled, false);
  assert.equal(sourcePending.label, "Preview only");
  assert.equal(sourcePending.reason, "Checking pack source before apply");
});
