import test from "node:test";
import assert from "node:assert/strict";
import { getVisibleViewportRect, installVisualViewportCssVars } from "../js/ui/visual_viewport_sync.js";

function fixture({ visual = true, raf = true } = {}) {
  const values = new Map();
  let writes = 0;
  const root = { clientWidth: 800, clientHeight: 600, style: {
    setProperty(name, value) { writes++; values.set(name, value); },
  } };
  const frames = [];
  const win = { document: { documentElement: root }, innerWidth: 820, innerHeight: 580 };
  if (visual) win.visualViewport = Object.assign(new EventTarget(), {
    offsetTop: 40, offsetLeft: 10, width: 360, height: 300,
  });
  if (raf) win.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  return { win, root, values, frames, writes: () => writes, flush() { frames.splice(0).forEach((callback) => callback()); } };
}

test("visible viewport rect uses layout coordinates and layout fallback maxima", () => {
  assert.deepEqual(getVisibleViewportRect(fixture().win), {
    top: 40, left: 10, width: 360, height: 300, bottom: 340, right: 370,
  });
  assert.deepEqual(getVisibleViewportRect(fixture({ visual: false }).win), {
    top: 0, left: 0, width: 820, height: 600, bottom: 600, right: 820,
  });
});

test("CSS variables initialize once without a visual viewport", () => {
  const f = fixture({ visual: false });
  const dispose = installVisualViewportCssVars({ win: f.win });
  assert.equal(f.values.get("--visual-viewport-top"), "0px");
  assert.equal(f.values.get("--visual-viewport-height"), "600px");
  f.win.innerHeight = 700;
  f.flush();
  assert.equal(f.writes(), 2);
  dispose();
  dispose();
});

test("CSS sync coalesces resize and scroll, is idempotent, and disposes pending updates", () => {
  const f = fixture();
  const vv = f.win.visualViewport;
  let bindings = 0;
  const add = vv.addEventListener.bind(vv);
  vv.addEventListener = (...args) => { bindings++; add(...args); };
  const dispose = installVisualViewportCssVars({ win: f.win });
  assert.equal(f.values.get("--visual-viewport-top"), "40px");
  assert.equal(f.values.get("--visual-viewport-height"), "300px");
  assert.equal(installVisualViewportCssVars({ win: f.win }), dispose);
  assert.equal(bindings, 2);
  vv.height = 200;
  vv.dispatchEvent(new Event("resize"));
  vv.offsetTop = 60;
  vv.dispatchEvent(new Event("scroll"));
  assert.equal(f.frames.length, 1);
  assert.equal(f.writes(), 2);
  f.flush();
  assert.equal(f.values.get("--visual-viewport-height"), "200px");
  assert.equal(f.values.get("--visual-viewport-top"), "60px");
  vv.dispatchEvent(new Event("resize"));
  dispose();
  dispose();
  vv.height = 100;
  f.flush();
  vv.dispatchEvent(new Event("resize"));
  vv.dispatchEvent(new Event("scroll"));
  assert.equal(f.frames.length, 0);
  assert.equal(f.writes(), 4);
  const nextDispose = installVisualViewportCssVars({ win: f.win });
  assert.equal(f.values.get("--visual-viewport-height"), "100px");
  nextDispose();
});

test("CSS sync updates synchronously without requestAnimationFrame", () => {
  const f = fixture({ raf: false });
  const dispose = installVisualViewportCssVars({ win: f.win });
  f.win.visualViewport.height = 150;
  f.win.visualViewport.dispatchEvent(new Event("resize"));
  assert.equal(f.values.get("--visual-viewport-height"), "150px");
  dispose();
  f.win.visualViewport.height = 100;
  f.win.visualViewport.dispatchEvent(new Event("resize"));
  assert.equal(f.values.get("--visual-viewport-height"), "150px");
});
