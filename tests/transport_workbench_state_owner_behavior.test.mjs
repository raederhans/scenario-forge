import test from "node:test";
import assert from "node:assert/strict";
import { createTransportWorkbenchStateOwner } from "../js/ui/transport_workbench/transport_workbench_state_owner.js";

test("transport workbench state owner moves layer order without duplicating families", () => {
  const owner = createTransportWorkbenchStateOwner({
    transportWorkbenchUi: { layerOrder: ["road", "rail", "airport", "port"] },
  });
  owner.ensureUiState();

  assert.equal(owner.moveLayerOrder("port", "road"), true);

  const order = owner.ensureUiState().layerOrder;
  assert.equal(order[0], "port");
  assert.equal(new Set(order).size, order.length);
});
