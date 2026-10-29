import assert from "node:assert/strict";
import test from "node:test";
import { createResponsiveSidebarCollapseController } from "../js/ui/sidebar.js";

function setup(width, initial = { left: false, right: false }) {
  const visible = {};
  const saved = { ...initial };
  const apply = (side) => (collapsed, { persist }) => {
    visible[side] = !collapsed;
    if (persist) saved[side] = collapsed;
  };
  const controller = createResponsiveSidebarCollapseController({
    ...initial,
    getWidth: () => width,
    applyLeft: apply("left"),
    applyRight: apply("right"),
  });
  controller.sync();
  return { controller, visible, saved, resize(nextWidth) { width = nextWidth; controller.sync(); } };
}

for (const width of [1024, 1152, 1279]) {
  test(`${width}px: opening either sidebar collapses the other without persisting`, () => {
    const { controller, visible, saved } = setup(width);
    assert.deepEqual(visible, { left: true, right: false });
    controller.set("right", false);
    assert.deepEqual(visible, { left: false, right: true });
    controller.set("left", false);
    assert.deepEqual(visible, { left: true, right: false });
    controller.set("left", true);
    assert.deepEqual(visible, { left: false, right: false });
    assert.deepEqual(saved, { left: false, right: false });
  });
}

for (const width of [1280, 1440, 1023]) {
  test(`${width}px: opening a sidebar does not collapse the other`, () => {
    const { controller, visible } = setup(width, { left: true, right: true });
    controller.set("left", false);
    controller.set("right", false);
    assert.deepEqual(visible, { left: true, right: true });
  });
}

test("returning to desktop restores both expanded preferences", () => {
  const { controller, visible, saved, resize } = setup(1440);
  resize(1279);
  controller.set("right", false);
  resize(1280);
  assert.deepEqual(visible, { left: true, right: true });
  assert.deepEqual(saved, { left: false, right: false });
});

test("desktop preference updates survive compact and drawer layouts", () => {
  const { controller, visible, saved, resize } = setup(1440);
  controller.set("left", true);
  resize(1024);
  controller.set("left", false);
  resize(767);
  resize(1440);
  assert.deepEqual(visible, { left: false, right: true });
  assert.deepEqual(saved, { left: true, right: false });
});
