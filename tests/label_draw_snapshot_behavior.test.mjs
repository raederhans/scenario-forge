import assert from "node:assert/strict";
import test from "node:test";
import { createLabelDrawSnapshotOwner } from "../js/core/renderer/label_draw_snapshot.js";

function contextFixture(width = 1000, height = 800) {
  const paints = [], stack = [];
  const styles = { font: "10px sans-serif", fillStyle: "#111", strokeStyle: "#fff",
    textAlign: "center", textBaseline: "middle", direction: "ltr", lineWidth: 2,
    lineCap: "round", lineJoin: "round", miterLimit: 10, globalAlpha: 1,
    globalCompositeOperation: "source-over", filter: "none", imageSmoothingEnabled: true,
    imageSmoothingQuality: "high", shadowColor: "transparent", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0 };
  let matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, lineDash = [];
  const context = { ...styles, canvas: { width, height } };
  const multiply = (next) => { matrix = {
    a: matrix.a * next.a + matrix.c * next.b, b: matrix.b * next.a + matrix.d * next.b,
    c: matrix.a * next.c + matrix.c * next.d, d: matrix.b * next.c + matrix.d * next.d,
    e: matrix.a * next.e + matrix.c * next.f + matrix.e,
    f: matrix.b * next.e + matrix.d * next.f + matrix.f,
  }; };
  context.getTransform = () => ({ ...matrix });
  context.setTransform = function (...args) {
    matrix = args.length === 1 ? { ...args[0] } : Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((key, i) => [key, args[i]]));
  };
  context.translate = function (x, y) { multiply({ a: 1, b: 0, c: 0, d: 1, e: x, f: y }); };
  context.rotate = function (angle) { const c = Math.cos(angle), s = Math.sin(angle); multiply({ a: c, b: s, c: -s, d: c, e: 0, f: 0 }); };
  context.save = () => stack.push({ ...matrix });
  context.restore = () => { matrix = stack.pop(); };
  context.getLineDash = () => [...lineDash];
  context.setLineDash = dash => { lineDash = [...dash]; };
  for (const method of ["strokeText", "drawImage"]) context[method] = function (...args) {
    paints.push({ args, matrix: { ...matrix }, style: { font: this.font, lineWidth: this.lineWidth } });
  };
  return { context, paints };
}
const reference = { x: 0, y: 0, k: 4 };

function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-9, actual + " != " + expected); }

test("replay preserves text anchor, font and halo size across zoom and DPR", () => {
  const owner = createLabelDrawSnapshotOwner({}), source = contextFixture(), prepared = { x: 100, y: 50, k: 4 };
  owner.capture("labels", source.context, { transform: prepared, dpr: 2, signature: "labels-id" }, (context) => {
    context.setTransform(8, 0, 0, 8, 200, 100);
    context.translate(10, 20);
    context.rotate(Math.PI / 4);
    context.font = "600 2.5px sans-serif";
    context.lineWidth = 0.75;
    context.strokeText("Capital", 0, 0, 12);
  });
  const target = contextFixture(900, 600);
  assert.equal(owner.replay(["labels"], target.context, { x: 120, y: 50, k: 5 }, 3,
    () => "labels-id"), true);
  const first = target.paints[0];
  close(first.matrix.e, 510); close(first.matrix.f, 450);
  close(Number(first.style.font.match(/([\d.]+)px/)[1]) * Math.hypot(first.matrix.a, first.matrix.b) / 3, 10);
  close(first.style.lineWidth * Math.hypot(first.matrix.a, first.matrix.b) / 3, 3);
});

test("city sprites retain their map center and CSS size", () => {
  const owner = createLabelDrawSnapshotOwner({}), source = contextFixture(), image = { width: 16, height: 12 };
  owner.capture("textureLabels", source.context, { transform: reference, dpr: 2, signature: "sprites" }, (context) => {
    context.setTransform(8, 0, 0, 8, 0, 0);
    context.drawImage(image, 10, 20, 4, 3);
  });
  const target = contextFixture(900, 600);
  assert.equal(owner.replay(["textureLabels"], target.context, { x: -10, y: -20, k: 5 }, 3, () => "sprites"), true);
  const paint = target.paints[0], width = 4, height = 3;
  close(paint.matrix.e / 3, (10 + width / 2) * 5 - 10);
  close(paint.matrix.f / 3, (20 + height / 2) * 5 - 20);
  close(Math.hypot(paint.matrix.a, paint.matrix.b) / 3 * paint.args.at(-2), width * 4);
  close(Math.hypot(paint.matrix.c, paint.matrix.d) / 3 * paint.args.at(-1), height * 4);
});
