import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBathymetryCoverageMaskLayers,
  buildBathymetryCutlineEraseLayers,
  createBathymetryCoverageCompositor,
  sampleBathymetryClipEdges,
} from "../js/core/renderer/bathymetry_coverage_compositor.js";

function makeContext(canvas, name) {
  const calls = [];
  const context = {
    canvas, calls, name,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    clipActive: false,
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    getTransform() { return { ...this.transform }; },
    setTransform(a, b, c, d, e, f) {
      this.transform = { a, b, c, d, e, f };
      calls.push({ method: "setTransform", transform: this.getTransform() });
    },
    clearRect() { calls.push({ method: "clearRect" }); },
    fillRect() { calls.push({ method: "fillRect", composite: this.globalCompositeOperation }); },
    beginPath() { calls.push({ method: "beginPath" }); },
    fill() { calls.push({ method: "fill", alpha: this.globalAlpha, transform: this.getTransform() }); },
    stroke() {
      calls.push({ method: "stroke", alpha: this.globalAlpha, width: this.lineWidth,
        composite: this.globalCompositeOperation, cap: this.lineCap, join: this.lineJoin });
    },
    drawImage(source) {
      calls.push({ method: "drawImage", source, transform: this.getTransform(), clipActive: this.clipActive, composite: this.globalCompositeOperation });
    },
    save() {
      this.saved = { transform: this.getTransform(), globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation, clipActive: this.clipActive };
      calls.push({ method: "save" });
    },
    restore() {
      Object.assign(this, this.saved);
      calls.push({ method: "restore" });
    },
  };
  return context;
}

function makeCanvas(width, height, name) {
  const canvas = { width, height, name };
  canvas.context = makeContext(canvas, name);
  canvas.getContext = () => canvas.context;
  return canvas;
}

function makeHarness(width = 800, height = 400) {
  const target = makeCanvas(width, height, "target").context;
  target.setTransform(2, 0, 0, 2, 30, 40);
  target.clipActive = true;
  target.globalAlpha = 0.8;
  const created = [];
  const traced = [];
  let active = target;
  const compositor = createBathymetryCoverageCompositor({
    getContext: () => active,
    withRenderTarget(context, draw) {
      const previous = active;
      active = context;
      try { return draw(); } finally { active = previous; }
    },
    traceGeometry(geometry, context) { traced.push({ geometry, context }); },
    getFeatherWidth: () => 12,
    createCanvas() {
      const canvas = makeCanvas(0, 0, `scratch-${created.length}`);
      created.push(canvas);
      return canvas;
    },
  });
  return { compositor, target, created, traced, getActive: () => active };
}

test("mask layers sample clockwise rectangles and accumulate a smooth outer-to-inner alpha", () => {
  const bbox = [10, -10, 30, 10];
  const layers = buildBathymetryCoverageMaskLayers(bbox);
  assert.equal(layers.length, 20);
  assert.equal(layers[0].inset, 0);
  assert.equal(layers.at(-1).inset, 3);
  assert.ok(layers[0].targetAlpha < 0.01);
  assert.equal(layers.at(-1).targetAlpha, 1);
  let accumulated = 0;
  for (const layer of layers) {
    assert.ok(layer.alpha > 0 && layer.alpha <= 1);
    accumulated += (1 - accumulated) * layer.alpha;
    assert.ok(Math.abs(accumulated - layer.targetAlpha) < 1e-10);
    const ring = layer.geometry.coordinates[0];
    assert.deepEqual(ring[0], ring.at(-1));
    assert.ok(ring.every((point, index) => index === 0 || Math.max(Math.abs(point[0] - ring[index - 1][0]), Math.abs(point[1] - ring[index - 1][1])) <= 1));
    assert.ok(ring[1][1] > ring[0][1], "D3 small-ring direction runs north first");
  }
  assert.equal(buildBathymetryCoverageMaskLayers([0, 0, 4, 4]).at(-1).inset, 1);
  assert.deepEqual(buildBathymetryCoverageMaskLayers([-180, -90, 180, 90]), []);
});

test("paint draws once on scratch with target transform, then composites inside target clip", () => {
  const { compositor, target, created, traced, getActive } = makeHarness();
  const resultToken = { painted: true };
  let drawCount = 0;
  const draw = () => {
    drawCount += 1;
    assert.equal(getActive(), created[0].context);
    assert.deepEqual(getActive().getTransform(), { a: 2, b: 0, c: 0, d: 2, e: 30, f: 40 });
    return resultToken;
  };
  assert.equal(compositor.paint([10, -10, 30, 10], draw), resultToken);
  assert.equal(drawCount, 1);
  assert.equal(created.length, 2);
  assert.equal(traced.length, 20);
  assert.ok(traced.every(({ context }) => context === created[1].context));
  assert.ok(created[0].context.calls.some(call => call.method === "drawImage" && call.composite === "destination-in"));
  const composite = target.calls.find(call => call.method === "drawImage");
  assert.equal(composite.source, created[0]);
  assert.equal(composite.clipActive, true);
  assert.deepEqual(composite.transform, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  assert.deepEqual(target.getTransform(), { a: 2, b: 0, c: 0, d: 2, e: 30, f: 40 });
  assert.equal(target.globalAlpha, 0.8);
  assert.equal(target.clipActive, true);
  compositor.paint([11, -9, 29, 9], draw);
  assert.equal(created.length, 2, "reuse canvases across local paints");
});

test("invalid and global bounds call draw directly; failure never composites a partial scratch", () => {
  const { compositor, target, created, getActive } = makeHarness();
  for (const bbox of [null, [0, 0, 0, 2], [-180, -90, 180, 90]]) {
    assert.equal(compositor.paint(bbox, () => {
      assert.equal(getActive(), target);
      return "direct";
    }), "direct");
  }
  assert.equal(created.length, 0);
  assert.throws(() => compositor.paint([1, 1, 10, 10], () => { throw new Error("draw failed"); }), /draw failed/);
  assert.equal(target.calls.filter(call => call.method === "drawImage").length, 0);
  assert.deepEqual(target.getTransform(), { a: 2, b: 0, c: 0, d: 2, e: 30, f: 40 });
  assert.equal(getActive(), target);
});

test("large export canvases are released after painting", () => {
  const { compositor, created } = makeHarness(3000, 2000);
  compositor.paint([1, 1, 10, 10], () => true);
  assert.ok(created.every(canvas => canvas.width === 1 && canvas.height === 1));
});

test("cutline erasure narrows inward and fully clears the line center", () => {
  const layers = buildBathymetryCutlineEraseLayers(12);
  assert.equal(layers.length, 20);
  assert.equal(layers[0].width, 12);
  assert.ok(Math.abs(layers.at(-1).width - 0.6) < 1e-10);
  assert.ok(layers.every((layer, index) => index === 0 || layer.width < layers[index - 1].width));
  let erased = 0;
  for (const layer of layers) {
    erased += (1 - erased) * layer.alpha;
    assert.ok(Math.abs(erased - layer.targetAlpha) < 1e-10);
  }
  assert.equal(erased, 1);
  assert.equal(layers.at(-1).alpha, 1);
});

test("clip edges use destination-out strokes after bbox fill and preserve no-edge behavior", () => {
  const { compositor, created, traced } = makeHarness();
  const edges = { type: "MultiLineString", coordinates: [[[10, -10], [14, -8]]] };
  compositor.paint([10, -10, 30, 10], () => true, edges);
  const maskCalls = created[1].context.calls;
  const fills = maskCalls.filter(call => call.method === "fill");
  const strokes = maskCalls.filter(call => call.method === "stroke");
  assert.equal(fills.length, 20);
  assert.equal(strokes.length, 20);
  assert.ok(maskCalls.indexOf(fills.at(-1)) < maskCalls.indexOf(strokes[0]));
  assert.ok(strokes.every(call => call.composite === "destination-out" && call.cap === "round" && call.join === "round"));
  assert.ok(strokes.every((call, index) => index === 0 || call.width < strokes[index - 1].width));
  assert.equal(strokes.at(-1).alpha, 1);
  const sampled = traced.at(-1).geometry.coordinates[0];
  assert.ok(sampled.every((point, index) => index === 0 || Math.max(Math.abs(point[0] - sampled[index - 1][0]), Math.abs(point[1] - sampled[index - 1][1])) <= 1));
  assert.deepEqual(edges.coordinates[0], [[10, -10], [14, -8]], "input geometry remains untouched");
  compositor.paint([10, -10, 30, 10], () => true);
  assert.equal(maskCalls.filter(call => call.method === "stroke").length, 20, "no extra strokes without clip edges");
});

test("world bbox uses a full mask only when cutlines are supplied", () => {
  const { compositor, created } = makeHarness();
  const edges = { type: "LineString", coordinates: [[-24, 34], [-20, 34]] };
  compositor.paint([-180, -90, 180, 90], () => true, edges);
  const maskCalls = created[1].context.calls;
  assert.equal(maskCalls.filter(call => call.method === "fillRect").length, 1);
  assert.equal(maskCalls.filter(call => call.method === "fill").length, 0);
  assert.equal(maskCalls.filter(call => call.method === "stroke").length, 20);
  assert.equal(sampleBathymetryClipEdges(edges).coordinates.length, 5);
});

test("Atlantic/Pacific longitude envelope never creates an artificial dateline mask", () => {
  const { compositor, created } = makeHarness();
  const bbox = [-180, -70, 180, 75];
  assert.deepEqual(buildBathymetryCoverageMaskLayers(bbox), []);
  assert.equal(compositor.paint(bbox, () => "direct", { type: "MultiLineString", coordinates: [] }), "direct");
  assert.equal(created.length, 0);
  compositor.paint(bbox, () => true, { type: "LineString", coordinates: [[-30, 75], [30, 75]] });
  const maskCalls = created[1].context.calls;
  assert.equal(maskCalls.filter(call => call.method === "fill").length, 0);
  assert.equal(maskCalls.filter(call => call.method === "fillRect").length, 1);
  assert.equal(maskCalls.filter(call => call.method === "stroke").length, 20);
});
