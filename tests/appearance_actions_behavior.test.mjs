import test from "node:test";
import assert from "node:assert/strict";
import { applyAppearanceStylePathPatchState } from "../js/core/state/actions/appearance_actions.js";

test("appearance actions apply history style paths while preserving style-config identity", () => {
  const styleConfig = {
    ocean: { opacity: 0.5, color: "#123456" },
    cityPoints: { radius: 2 },
  };
  const target = { styleConfig };

  assert.equal(
    applyAppearanceStylePathPatchState(target, {
      "ocean.opacity": 0.8,
      "ocean.color": null,
      "rivers.width": 1.5,
    }),
    styleConfig,
  );
  assert.deepEqual(target.styleConfig, {
    ocean: { opacity: 0.8 },
    cityPoints: { radius: 2 },
    rivers: { width: 1.5 },
  });
});
