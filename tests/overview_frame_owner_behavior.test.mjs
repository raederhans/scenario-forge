import assert from "node:assert/strict";
import test from "node:test";
import { createOverviewFrameOwner } from "../js/core/renderer/overview_frame_owner.js";
import { createRuntimeResourceBudget } from "../js/core/runtime_resource_budget.js";

function fixture() {
  const canvases = [], events = [], metrics = [];
  let identity = "scene-1:color-1:projection-1";
  const budget = createRuntimeResourceBudget({ softLimitBytes: 64 * 1024 * 1024 });
  const createCanvas = () => {
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: () => events.push("capture") }) };
    canvases.push(canvas); return canvas;
  };
  const owner = createOverviewFrameOwner({ getIdentity: () => identity, createCanvas, resourceBudget: budget,
    recordMetric: (name, ms, details) => metrics.push({ name, ms, details }) });
  const context = { canvas: { width: 1000, height: 600 },
    save: () => events.push("save"), restore: () => events.push("restore"),
    setTransform: () => events.push("identity"), clearRect: () => events.push("clear"),
    translate: (...args) => events.push(["translate",...args]), scale: (...args) => events.push(["scale",...args]),
    drawImage: () => events.push("draw") };
  return {owner,budget,events,metrics,canvases,context,setIdentity: value => { identity=value; }};
}

test("retains one wider accepted overview instead of recapturing detailed views", () => {
  const f=fixture();
  assert.equal(f.owner.capture(f.context.canvas,{x:0,y:0,k:1},1),true);
  assert.equal(f.owner.capture(f.context.canvas,{x:-500,y:-300,k:2},1),false);
  assert.equal(f.canvases.length,1);
  f.events.length=0;
  assert.equal(f.owner.draw(f.context,{x:-250,y:-150,k:1.5},1),true);
  assert.deepEqual(f.events,["save","identity","clear",["translate",-250,-150],["scale",1.5,1.5],"draw","restore"]);
  assert.equal(f.budget.snapshot().categories.bitmaps,2400000);
});

test("coverage failure never clears the visible target, and valid later coverage remains reusable", () => {
  const f=fixture(); f.owner.capture(f.context.canvas,{x:0,y:0,k:1},1); f.events.length=0;
  assert.equal(f.owner.draw(f.context,{x:0,y:0,k:0.5},1),false);
  assert.equal(f.owner.draw(f.context,{x:50,y:0,k:1},1),false);
  assert.deepEqual(f.events,[]);
  assert.equal(f.owner.draw(f.context,{x:0,y:0,k:1},1),true);
});

test("identity changes release old pixels before reuse or capture", () => {
  const f=fixture(); f.owner.capture(f.context.canvas,{x:0,y:0,k:1},1); f.events.length=0;
  f.setIdentity("scene-2:color-2:projection-2");
  assert.equal(f.owner.draw(f.context,{x:0,y:0,k:1},1),false);
  assert.deepEqual(f.events,[]);
  assert.equal(f.canvases[0].width,0);
  assert.equal(f.budget.snapshot().ownerCount,0);
  assert.equal(f.owner.capture(f.context.canvas,{x:0,y:0,k:2},1),true);
});

test("DPR mismatch is rejected and full coverage accounts for physical pixels", () => {
  const f=fixture(); f.owner.capture(f.context.canvas,{x:0,y:0,k:1},2); f.events.length=0;
  assert.equal(f.owner.draw(f.context,{x:0,y:0,k:1},1),false);
  assert.deepEqual(f.events,[]);
  assert.equal(f.owner.draw(f.context,{x:-125,y:-75,k:1.5},2),true);
});

test("fine quality replaces a coarse overview at the same zoom when the quality identity changes", () => {
  const f = fixture();
  f.setIdentity("scene-1:coarse:not-ready");
  assert.equal(f.owner.capture(f.context.canvas, { x: 0, y: 0, k: 1 }, 1), true);
  const coarseCanvas = f.canvases[0];
  f.setIdentity("scene-1:fine:ready");
  assert.equal(f.owner.capture(f.context.canvas, { x: 0, y: 0, k: 1 }, 1), true);
  assert.equal(coarseCanvas.width, 0);
  assert.equal(f.canvases.length, 2);
  assert.equal(f.owner.draw(f.context, { x: 0, y: 0, k: 1 }, 1), true);
  assert.equal(f.budget.snapshot().categories.bitmaps, 2400000);
});

test("bounds retained surface memory and releases it on clear or shared pressure", () => {
  const f=fixture();
  assert.equal(f.owner.capture({width:10000,height:10000},{x:0,y:0,k:1},1),false);
  assert.equal(f.canvases.length,0);
  f.owner.capture(f.context.canvas,{x:0,y:0,k:1},1);
  f.budget.update(Symbol("other"),{workerGeometry:64*1024*1024}); f.events.length=0;
  assert.equal(f.owner.draw(f.context,{x:0,y:0,k:1},1),false);
  assert.deepEqual(f.events,[]);
  assert.equal(f.canvases[0].width,0);
  f.owner.clear();
  assert.equal(f.budget.snapshot().categories.bitmaps,undefined);
});
