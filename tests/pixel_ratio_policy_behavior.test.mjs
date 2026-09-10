import assert from "node:assert/strict";
import test from "node:test";
import { createPixelRatioPolicy } from "../js/core/renderer/pixel_ratio_policy.js";

test("pixel ratio policy reads live display inputs and commits only stage transitions", () => {
  const runtimeState = { dprStage: "idle", dprInteractiveScale: 0.72 };
  let deviceDpr = 2;
  let clock = 40;
  const policy = createPixelRatioPolicy({ runtimeState, nowMs: () => ++clock, getDevicePixelRatio: () => deviceDpr });
  assert.equal(policy.getMaxDprForProfile("full"), 2);
  assert.equal(policy.getMaxDprForProfile("balanced"), 1.5);
  assert.equal(policy.getMaxDprForProfile("auto"), 1.25);
  assert.equal(policy.updateDprStage("idle"), false);
  assert.equal(clock, 40);
  assert.equal(policy.updateDprStage("interactive"), true);
  assert.equal(runtimeState.dprLastStageSwitchAt, 41);
  assert.equal(policy.getMaxDprForProfile("full"), 2);
  deviceDpr = 3;
  runtimeState.dprInteractiveScale = 0.5;
  assert.equal(policy.getMaxDprForProfile("full"), 3);
  assert.equal(policy.getMaxDprForProfile("balanced"), 1.5);
  assert.equal(policy.updateDprStage("interactive", { force: true }), true);
  assert.equal(runtimeState.dprLastStageSwitchAt, 42);
  assert.equal(policy.updateDprStage("unknown"), true);
  assert.equal(runtimeState.dprStage, "idle");
});

test("pixel ratio owners isolate state and detach inherited stage fields", () => {
  const prototype = { dprStage: "idle", dprLastStageSwitchAt: 1 };
  const first = Object.create(prototype);
  const second = Object.create(prototype);
  const create = (runtimeState) => createPixelRatioPolicy({ runtimeState, nowMs: () => 10, getDevicePixelRatio: () => 2 });
  create(first).updateDprStage("interactive");
  assert.equal(first.dprStage, "interactive");
  assert.equal(first.dprLastStageSwitchAt, 10);
  assert.equal(create(second).getMaxDprForProfile("full"), 2);
  assert.equal(second.dprStage, "idle");
  assert.equal(prototype.dprLastStageSwitchAt, 1);
});
