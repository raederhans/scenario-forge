import assert from "node:assert/strict";
import test from "node:test";
import { createOverviewFrameOwner } from "../js/core/renderer/overview_frame_owner.js";

function fixture(t) {
  const events = [];
  const owner = createOverviewFrameOwner({
    getIdentity: () => "scene",
    createCanvas: () => ({ getContext: () => ({ drawImage() {} }) }),
  });
  const context = { canvas: { width: 1000, height: 600 },
    save: () => events.push("save"), restore: () => events.push("restore"),
    setTransform: () => events.push("identity"), clearRect: () => events.push("clear"),
    translate: (...args) => events.push(["translate",...args]), scale: (...args) => events.push(["scale",...args]),
    drawImage: () => events.push("draw") };
  t.after(() => owner.clear());
  return { owner, events, context };
}

test("coverage failure never clears the visible target, and valid later coverage remains reusable", t => {
  const f=fixture(t); f.owner.capture(f.context.canvas,{x:0,y:0,k:1},1); f.events.length=0;
  assert.equal(f.owner.draw(f.context,{x:0,y:0,k:0.5},1),false);
  assert.equal(f.owner.draw(f.context,{x:50,y:0,k:1},1),false);
  assert.deepEqual(f.events,[]);
  assert.equal(f.owner.draw(f.context,{x:0,y:0,k:1},1),true);
});

test("DPR mismatch is rejected and full coverage accounts for physical pixels", t => {
  const f=fixture(t); f.owner.capture(f.context.canvas,{x:0,y:0,k:1},2); f.events.length=0;
  assert.equal(f.owner.draw(f.context,{x:0,y:0,k:1},1),false);
  assert.deepEqual(f.events,[]);
  assert.equal(f.owner.draw(f.context,{x:-50,y:-30,k:1.2},2),true);
});
