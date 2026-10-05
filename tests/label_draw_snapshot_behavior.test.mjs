import assert from "node:assert/strict";
import test from "node:test";
import { createLabelDrawSnapshotOwner } from "../js/core/renderer/label_draw_snapshot.js";
import { createRuntimeResourceBudget } from "../js/core/runtime_resource_budget.js";

function contextFixture(width = 1000, height = 800) {
  const paints = [], calls = [], stack = [];
  const styles = { font: "10px sans-serif", fillStyle: "#111", strokeStyle: "#fff",
    textAlign: "center", textBaseline: "middle", direction: "ltr", lineWidth: 2,
    lineCap: "round", lineJoin: "round", miterLimit: 10, globalAlpha: 1,
    globalCompositeOperation: "source-over", filter: "none", imageSmoothingEnabled: true,
    imageSmoothingQuality: "high", shadowColor: "transparent", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0 };
  let matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, lineDash = [];
  const context = {}, canvas = { width, height };
  function brand(receiver) { assert.equal(receiver, context, "native receiver must be the original context"); }
  Object.defineProperty(context, "canvas", { get() { brand(this); return canvas; } });
  for (const key of Object.keys(styles)) Object.defineProperty(context, key, {
    get() { brand(this); return styles[key]; },
    set(value) { brand(this); styles[key] = value; }, enumerable: true,
  });
  const multiply = (next) => { matrix = {
    a: matrix.a * next.a + matrix.c * next.b, b: matrix.b * next.a + matrix.d * next.b,
    c: matrix.a * next.c + matrix.c * next.d, d: matrix.b * next.c + matrix.d * next.d,
    e: matrix.a * next.e + matrix.c * next.f + matrix.e,
    f: matrix.b * next.e + matrix.d * next.f + matrix.f,
  }; };
  context.getTransform = function () { brand(this); calls.push("getTransform"); return { ...matrix }; };
  context.setTransform = function (...args) {
    brand(this); calls.push("setTransform");
    matrix = args.length === 1 ? { ...args[0] } : Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((key, i) => [key, args[i]]));
  };
  context.translate = function (x, y) { brand(this); multiply({ a: 1, b: 0, c: 0, d: 1, e: x, f: y }); };
  context.rotate = function (angle) { brand(this); const c = Math.cos(angle), s = Math.sin(angle); multiply({ a: c, b: s, c: -s, d: c, e: 0, f: 0 }); };
  context.save = function () { brand(this); calls.push("save"); stack.push({ matrix: { ...matrix }, styles: { ...styles }, lineDash: [...lineDash] }); };
  context.restore = function () { brand(this); calls.push("restore"); const saved = stack.pop(); matrix = saved.matrix; Object.assign(styles, saved.styles); lineDash = saved.lineDash; };
  context.measureText = function (text) { brand(this); calls.push("measureText"); return { width: text.length * 6 }; };
  context.getLineDash = function () { brand(this); return [...lineDash]; };
  context.setLineDash = function (dash) { brand(this); lineDash = [...dash]; };
  for (const method of ["fillText", "strokeText", "drawImage", "fill", "stroke", "fillRect", "strokeRect", "clearRect", "putImageData", "clip"]) context[method] = function (...args) {
    brand(this); calls.push(method); paints.push({ method, args, matrix: { ...matrix }, style: { ...styles } });
  };
  return { context, paints, calls, styles, canvas };
}
function fixture() {
  const budget = createRuntimeResourceBudget();
  return { owner: createLabelDrawSnapshotOwner({ resourceBudget: budget }), budget };
}
const reference = { x: 0, y: 0, k: 4 };
const identity = () => "scene:labels";
function captureText(owner, source, passName = "labels", signature = "scene:labels") {
  return owner.capture(passName, source.context, { transform: reference, dpr: 2, signature }, (context) => context.fillText("Town", 20, 30));
}
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-9, actual + " != " + expected); }

test("capture binds native methods and accessors and preserves real painting and original styles", () => {
  const { owner } = fixture(), source = contextFixture();
  const before = { ...source.styles };
  assert.equal(owner.capture("labels", source.context, { transform: reference, dpr: 2, signature: "scene:labels" }, (context) => {
    context.save();
    context.font = "600 12px sans-serif";
    context.fillStyle = "#123456";
    context.setTransform({ a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 });
    const measure = context.measureText;
    assert.equal(measure("Town").width, 24);
    context.strokeText("Town", 1, 2);
    context.fillText("Town", 1, 2);
    context.restore();
    return 17;
  }), 17);
  assert.deepEqual(source.paints.map((paint) => paint.method), ["strokeText", "fillText"]);
  assert.equal(source.paints[1].style.fillStyle, "#123456");
  assert.deepEqual(source.styles, before);
  assert.equal(source.calls.filter((name) => name === "measureText").length, 1);
  assert.equal(owner.canReplay(["labels"], contextFixture().context, reference, 2, identity), true);
});

test("replay preserves paint order, styles, rotation and CSS font and halo sizes across zoom and DPR", () => {
  const { owner } = fixture(), source = contextFixture(), prepared = { x: 100, y: 50, k: 4 };
  owner.capture("labels", source.context, { transform: prepared, dpr: 2, signature: "labels-id" }, (context) => {
    context.setTransform(8, 0, 0, 8, 200, 100);
    context.translate(10, 20);
    context.rotate(Math.PI / 4);
    context.font = "600 2.5px sans-serif";
    context.strokeStyle = "#ffe"; context.fillStyle = "#246"; context.lineWidth = 0.75;
    context.strokeText("Capital", 0, 0, 12); context.fillText("Capital", 0, 0, 12);
    context.fillStyle = "#357"; context.fillText("Town", 5, 0);
  });
  const target = contextFixture(900, 600), before = { ...target.styles };
  target.context.measureText = () => { throw Error("replay must not measure"); };
  let signatureTransform;
  assert.equal(owner.replay(["labels"], target.context, { x: 120, y: 50, k: 5 }, 3,
    (name, transform) => { assert.equal(name, "labels"); signatureTransform = transform; return "labels-id"; }), true);
  assert.deepEqual(signatureTransform, prepared);
  assert.deepEqual(target.paints.map((paint) => [paint.method, paint.args[0]]),
    [["strokeText", "Capital"], ["fillText", "Capital"], ["fillText", "Town"]]);
  const first = target.paints[0];
  close(first.matrix.a, 12 * Math.SQRT1_2); close(first.matrix.b, 12 * Math.SQRT1_2);
  close(first.matrix.c, -12 * Math.SQRT1_2); close(first.matrix.d, 12 * Math.SQRT1_2);
  close(first.matrix.e, 510); close(first.matrix.f, 450);
  close(Number(first.style.font.match(/([\d.]+)px/)[1]) * Math.hypot(first.matrix.a, first.matrix.b) / 3, 10);
  close(first.style.lineWidth * Math.hypot(first.matrix.a, first.matrix.b) / 3, 3);
  assert.equal(first.style.strokeStyle, "#ffe");
  assert.equal(target.paints[1].style.fillStyle, "#246"); assert.equal(target.paints[2].style.fillStyle, "#357");
  assert.deepEqual(target.styles, before);
});

test("city sprites retain their map center and CSS size for every drawImage overload", () => {
  for (const overload of [3, 5, 9]) {
    const { owner, budget } = fixture(), source = contextFixture(), image = { width: 16, height: 12 };
    owner.capture("textureLabels", source.context, { transform: reference, dpr: 2, signature: "sprites" }, (context) => {
      context.setTransform(8, 0, 0, 8, 0, 0);
      if (overload === 3) context.drawImage(image, 10, 20);
      if (overload === 5) context.drawImage(image, 10, 20, 4, 3);
      if (overload === 9) context.drawImage(image, 2, 3, 8, 6, 10, 20, 4, 3);
    });
    const target = contextFixture(900, 600);
    assert.equal(owner.replay(["textureLabels"], target.context, { x: -10, y: -20, k: 5 }, 3, () => "sprites"), true);
    const paint = target.paints[0], width = overload === 3 ? 16 : 4, height = overload === 3 ? 12 : 3;
    close(paint.matrix.e / 3, (10 + width / 2) * 5 - 10);
    close(paint.matrix.f / 3, (20 + height / 2) * 5 - 20);
    close(Math.hypot(paint.matrix.a, paint.matrix.b) / 3 * paint.args.at(-2), width * 4);
    close(Math.hypot(paint.matrix.c, paint.matrix.d) / 3 * paint.args.at(-1), height * 4);
    if (overload === 9) assert.deepEqual(paint.args.slice(1, 5), [2, 3, 8, 6]);
    assert.equal(budget.snapshot().categories.bitmaps, 16 * 12 * 4);
  }
});

test("15% overscan label snapshots remove the layout offset from anchors and coverage", () => {
  const { owner } = fixture();
  const layout = { offsetX: 120, offsetY: 90 };
  const prepared = { x: 0, y: 0, k: 2 };
  const source = contextFixture(2080, 1560);
  source.context.setTransform(4, 0, 0, 4, 240, 180);
  const image = { width: 10, height: 10 };

  owner.capture("labels", source.context, {
    transform: prepared, dpr: 2, layout, signature: "overscan:labels",
  }, (context) => context.fillText("Town", 105, 60));
  owner.capture("textureLabels", source.context, {
    transform: prepared, dpr: 2, layout, signature: "overscan:textureLabels",
  }, (context) => context.drawImage(image, 100, 55, 10, 10));

  const target = contextFixture(1600, 1200);
  const signature = (name) => `overscan:${name}`;
  assert.equal(owner.canReplay(["labels", "textureLabels"], target.context, prepared, 2, signature), true);
  assert.equal(owner.replay(["labels", "textureLabels"], target.context, prepared, 2, signature), true);
  assert.deepEqual(target.paints.map(({ matrix }) => [matrix.e, matrix.f]), [[420, 240], [420, 240]]);

  const pannedTarget = contextFixture(2400, 1800);
  const current = { x: 30, y: -10, k: 2.2 };
  assert.equal(owner.replay(["labels", "textureLabels"], pannedTarget.context, current, 3, signature), true);
  assert.deepEqual(pannedTarget.paints.map(({ matrix }) => [matrix.e, matrix.f]), [[783, 366], [783, 366]]);
  assert.equal(pannedTarget.paints[0].matrix.a, 6);
  close(Number(pannedTarget.paints[0].style.font.match(/([\d.]+)px/)[1])
    * Math.hypot(pannedTarget.paints[0].matrix.a, pannedTarget.paints[0].matrix.b) / 3, 20);

  const beyondOverscan = contextFixture(1860, 1200);
  assert.equal(owner.canReplay(["labels"], beyondOverscan.context, prepared, 2, signature), false);
  assert.equal(owner.replay(["labels"], beyondOverscan.context, prepared, 2, signature), false);
  assert.deepEqual(beyondOverscan.calls, []);
});

test("identity, coverage and zoom rejection leave destination calls and styles untouched", () => {
  const { owner } = fixture(); captureText(owner, contextFixture());
  for (const [transform, dpr, getSignature] of [
    [reference, 2, () => "other-scene"], [{ x: 1, y: 0, k: 4 }, 2, identity],
    [{ x: -1, y: 0, k: 4 }, 2, identity], [{ x: 0, y: 0, k: 3.19 }, 2, identity],
    [{ x: 0, y: 0, k: 5.01 }, 2, identity], [{ x: NaN, y: 0, k: 4 }, 2, identity],
    [reference, Infinity, identity], [reference, 2, () => { throw Error("bad identity"); }],
  ]) {
    const target = contextFixture(), styles = { ...target.styles };
    assert.equal(owner.replay(["labels"], target.context, transform, dpr, getSignature), false);
    assert.deepEqual(target.calls, []); assert.deepEqual(target.styles, styles);
  }
  assert.equal(owner.replay(["labels", "textureLabels"], contextFixture().context, reference, 2, identity), false);
  const bigger = contextFixture(1001, 800);
  assert.equal(owner.replay(["labels"], bigger.context, reference, 2, identity), false); assert.deepEqual(bigger.calls, []);
  assert.equal(owner.canReplay(["labels"], contextFixture(800, 640).context, { x: 0, y: 0, k: 3.2 }, 2, identity), true);
  assert.equal(owner.canReplay(["labels"], contextFixture().context, { x: 0, y: 0, k: 5 }, 2, identity), true);
});

test("clip and unsupported paints or effects reject entire packets but capture still paints", () => {
  for (const method of ["fill", "stroke", "fillRect", "strokeRect", "clearRect", "putImageData", "clip"]) {
    const { owner, budget } = fixture(), source = contextFixture();
    owner.capture("labels", source.context, { transform: reference, dpr: 2, signature: "scene:labels" }, (context) => {
      context.fillText("Before", 0, 0); context[method](0, 0, 1, 1); context.fillText("After", 1, 1);
    });
    assert.deepEqual(source.paints.map((paint) => paint.method), ["fillText", method, "fillText"]);
    assert.equal(owner.canReplay(["labels"], contextFixture().context, reference, 2, identity), false);
    assert.equal(budget.snapshot().estimatedBytes, 0);
  }
  for (const change of [
    context => { context.filter = "blur(1px)"; }, context => { context.globalCompositeOperation = "multiply"; },
    context => { context.fillStyle = {}; }, context => { context.setLineDash([1, 2]); },
  ]) {
    const { owner } = fixture(), source = contextFixture();
    owner.capture("labels", source.context, { transform: reference, dpr: 2, signature: "scene:labels" }, (context) => { change(context); context.fillText("Town", 0, 0); });
    assert.equal(source.paints.length, 1);
    assert.equal(owner.canReplay(["labels"], contextFixture().context, reference, 2, identity), false);
  }
});

test("layoutOnly has no paint records and ordinary and capital labels merge in one pass", () => {
  const { owner, budget } = fixture(), source = contextFixture();
  owner.capture("labels", source.context, { transform: reference, dpr: 2, signature: "scene:labels" }, (context) => context.measureText("Layout candidate"));
  assert.equal(budget.snapshot().estimatedBytes, 0);
  const target = contextFixture();
  assert.equal(owner.replay(["labels"], target.context, reference, 2, identity), true); assert.deepEqual(target.paints, []);
  owner.capture("labels", source.context, { transform: reference, dpr: 2, signature: "scene:labels" }, (context) => {
    context.fillText("Town", 1, 1); context.strokeText("Capital", 2, 2); context.fillText("Capital", 2, 2);
  });
  const combined = contextFixture();
  assert.equal(owner.replay(["labels"], combined.context, reference, 2, identity), true);
  assert.deepEqual(combined.paints.map((paint) => paint.args[0]), ["Town", "Capital", "Capital"]);
});

test("temporary text and style string limits reject only the current packet", () => {
  const { owner, budget } = fixture(), source = contextFixture();
  captureText(owner, source); const labelBytes = budget.snapshot().estimatedBytes;
  owner.capture("textureLabels", source.context, { transform: reference, dpr: 2, signature: "scene:labels" }, (context) => {
    context.fillText("x".repeat(5 * 1024 * 1024), 0, 0);
    assert.ok(budget.snapshot().estimatedBytes <= 8 * 1024 * 1024); context.fillText("Still painted", 0, 0);
  });
  assert.equal(source.paints.at(-1).args[0], "Still painted");
  assert.equal(owner.canReplay(["labels"], contextFixture().context, reference, 2, identity), true);
  assert.equal(owner.canReplay(["textureLabels"], contextFixture().context, reference, 2, identity), false);
  assert.equal(budget.snapshot().estimatedBytes, labelBytes);
  owner.capture("textureLabels", source.context, { transform: reference, dpr: 2, signature: "scene:labels" }, (context) => {
    context.font = "x".repeat(5 * 1024 * 1024); context.fillText("Town", 0, 0);
  });
  assert.equal(owner.canReplay(["textureLabels"], contextFixture().context, reference, 2, identity), false);
  assert.equal(budget.snapshot().estimatedBytes, labelBytes);
});

test("8192 records is a shared limit and sprite images are counted once across passes", () => {
  const { owner, budget } = fixture(), source = contextFixture();
  owner.capture("labels", source.context, { transform: reference, dpr: 2, signature: "scene:labels" }, (context) => {
    for (let i = 0; i < 8192; i++) context.fillText("L", i, 0);
  });
  assert.ok(budget.snapshot().estimatedBytes <= 8 * 1024 * 1024);
  owner.capture("textureLabels", source.context, { transform: reference, dpr: 2, signature: "scene:labels" }, (context) => context.fillText("one too many", 0, 0));
  assert.equal(owner.canReplay(["labels"], contextFixture().context, reference, 2, identity), true);
  assert.equal(owner.canReplay(["textureLabels"], contextFixture().context, reference, 2, identity), false);
  owner.clear();
  const image = { width: 16, height: 16 };
  for (const passName of ["labels", "textureLabels"]) owner.capture(passName, source.context,
    { transform: reference, dpr: 2, signature: "scene:labels" }, (context) => { context.drawImage(image, 0, 0); context.drawImage(image, 1, 1); });
  assert.equal(budget.snapshot().categories.bitmaps, 16 * 16 * 4);
  image.width = 2048;
  assert.equal(owner.canReplay(["labels"], contextFixture().context, reference, 2, identity), false);
  assert.equal(budget.snapshot().estimatedBytes, 0);
});

test("exceptions, clear and missing transform preserve actual draws and release recordings", () => {
  const { owner, budget } = fixture(), source = contextFixture(); captureText(owner, source);
  assert.throws(() => owner.capture("labels", source.context, { transform: reference, dpr: 2, signature: "scene:labels" }, (context) => {
    context.fillText("Before failure", 0, 0); throw Error("draw failed");
  }), /draw failed/);
  assert.equal(source.paints.at(-1).args[0], "Before failure"); assert.equal(budget.snapshot().estimatedBytes, 0);
  captureText(owner, source);
  const fallback = contextFixture(); delete fallback.context.getTransform;
  assert.equal(owner.capture("labels", fallback.context, { transform: reference, dpr: 2, signature: "scene:labels" }, (context) => {
    assert.equal(context, fallback.context); context.fillText("Fallback", 0, 0); return 23;
  }), 23);
  assert.equal(fallback.paints.length, 1); assert.equal(budget.snapshot().estimatedBytes, 0);
  owner.capture("labels", source.context, { transform: reference, dpr: 2, signature: "scene:labels" }, (context) => {
    context.fillText("Before clear", 0, 0); owner.clear(); context.fillText("After clear", 0, 0);
  });
  assert.equal(owner.canReplay(["labels"], contextFixture().context, reference, 2, identity), false);
  assert.equal(budget.snapshot().estimatedBytes, 0);
  const transformFailure = contextFixture(); transformFailure.context.getTransform = () => { throw Error("transform unavailable"); };
  owner.capture("labels", transformFailure.context, { transform: reference, dpr: 2, signature: "scene:labels" }, (context) => context.fillText("Real fallback", 0, 0));
  assert.equal(transformFailure.paints.length, 1);
  assert.equal(owner.canReplay(["labels"], contextFixture().context, reference, 2, identity), false);
});


test("invalid source metadata, oversized images, resized targets and unsupported passes do not publish", () => {
  const { owner, budget } = fixture();
  for (const [transform, dpr] of [[{ x: NaN, y: 0, k: 4 }, 2], [reference, Infinity]]) {
    const source = contextFixture();
    assert.equal(owner.capture("labels", source.context, { transform, dpr, signature: "scene:labels" }, (context) => {
      assert.equal(context, source.context);
      context.fillText("Real", 0, 0);
      return 31;
    }), 31);
    assert.equal(source.paints.length, 1);
    assert.equal(owner.canReplay(["labels"], contextFixture().context, reference, 2, identity), false);
  }
  const source = contextFixture();
  for (const image of [{ width: 2048, height: 1024 }, { width: Infinity, height: 1 }, { width: 0, height: 1 }]) {
    owner.capture("labels", source.context, { transform: reference, dpr: 2, signature: "scene:labels" }, (context) => context.drawImage(image, 0, 0));
    assert.equal(owner.canReplay(["labels"], contextFixture().context, reference, 2, identity), false);
    assert.equal(budget.snapshot().estimatedBytes, 0);
  }
  owner.capture("labels", source.context, { transform: reference, dpr: 2, signature: "scene:labels" }, (context) => {
    context.fillText("Before resize", 0, 0);
    context.canvas.width++;
  });
  assert.equal(owner.canReplay(["labels"], contextFixture().context, reference, 2, identity), false);
  captureText(owner, source, "political");
  assert.equal(owner.canReplay(["political"], contextFixture().context, reference, 2, identity), false);
  const zero = contextFixture(0, 0);
  assert.equal(owner.replay(["labels"], zero.context, reference, 2, identity), false);
  assert.deepEqual(zero.calls, []);
});

test("signature inspection cannot mutate packet transform or clear it before replay paints", () => {
  const { owner } = fixture(), source = contextFixture();
  captureText(owner, source);
  const target = contextFixture();
  assert.equal(owner.canReplay(["labels"], target.context, reference, 2, (_name, transform) => {
    transform.x = Infinity;
    return "scene:labels";
  }), true);
  assert.equal(owner.canReplay(["labels"], target.context, reference, 2, identity), true);
  assert.equal(owner.replay(["labels"], target.context, reference, 2, () => {
    owner.clear();
    return "scene:labels";
  }), false);
  assert.deepEqual(target.calls, []);
});
