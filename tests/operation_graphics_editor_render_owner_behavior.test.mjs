import test from "node:test";
import assert from "node:assert/strict";
import { createOperationGraphicsEditorRenderOwner } from "../js/core/renderer/operation_graphics_editor_render_owner.js";

// A keyed SVG selection fixture: real node identity, event receiver, dataset,
// enter/update/exit, and sibling order persist across repeated render calls.
class SvgNode {
  constructor(tag = "g", parent = null) {
    Object.assign(this, { tag, parent, attrs: {}, styles: {}, dataset: {}, handlers: {}, children: [] });
  }
}
class Selection {
  constructor(nodes, parent = null) { this.nodes = nodes; this.parent = parent; }
  selectAll(selector) {
    const parent = this.nodes[0];
    const [tag, className] = selector.split(".");
    return new Selection(parent.children.filter((node) => selector === "*"
      || (node.tag === tag && node.attrs.class === className)), parent);
  }
  data(rows, key) {
    const existing = new Map(this.nodes.map((node) => [key(node.datum), node]));
    this.enterRows = []; this.updateNodes = [];
    rows.forEach((datum) => {
      const node = existing.get(key(datum));
      if (node) { node.datum = datum; this.updateNodes.push(node); existing.delete(key(datum)); }
      else { this.enterRows.push(datum); this.updateNodes.push(null); }
    });
    this.exitNodes = [...existing.values()];
    this.nodes = this.updateNodes.filter(Boolean);
    return this;
  }
  enter() {
    return { append: (tag) => {
      const nodes = this.enterRows.map((datum) => {
        const node = new SvgNode(tag, this.parent); node.datum = datum; this.parent.children.push(node); return node;
      });
      const selection = new Selection(nodes, this.parent);
      selection.joinUpdate = this;
      return selection;
    } };
  }
  merge(other) {
    let next = 0;
    return new Selection(other.updateNodes.map((node) => node || this.nodes[next++]), this.parent);
  }
  attr(name, value) {
    this.nodes.forEach((node, index) => { node.attrs[name] = typeof value === "function" ? value(node.datum, index) : value; });
    return this;
  }
  style(name, value) { this.nodes.forEach((node) => { node.styles[name] = value; }); return this; }
  on(type, callback) { this.nodes.forEach((node) => { node.handlers[type] = callback; }); return this; }
  call(callback) { callback(this); return this; }
  exit() { return new Selection(this.exitNodes, this.parent); }
  remove() { this.nodes.forEach((node) => { node.parent.children = node.parent.children.filter((entry) => entry !== node); }); return this; }
  raise() {
    this.nodes.forEach((node) => { node.parent.children = node.parent.children.filter((entry) => entry !== node); node.parent.children.push(node); });
    return this;
  }
  lower() { this.nodes.forEach((node) => { node.lowered = true; }); return this; }
}

function fixture(t) {
  const previous = globalThis.d3;
  const h = {
    group: new Selection([new SvgNode()]), interaction: new Selection([new SvgNode("rect")]),
    state: { operationGraphicsEditor: { active: false, mode: "edit", selectedId: "g", points: [[0, 0], [5, 5]], selectedVertexIndex: 1 } },
    graphic: { id: "g", kind: "open", points: [[0, 0], [5, 5]], stroke: "blue", width: 3, opacity: 0.7 },
    ensured: 0, dragsCreated: 0, calls: [], pathCalls: [], clicked: [],
  };
  globalThis.d3 = {
    select: (node) => new Selection([node]),
    drag: () => {
      h.dragsCreated++;
      const handlers = {};
      const behavior = (selection) => selection.nodes.forEach((node) => { node.drag = behavior; });
      behavior.on = (type, callback) => { handlers[type] = callback; return behavior; };
      behavior.handlers = handlers;
      return behavior;
    },
  };
  t.after(() => { globalThis.d3 = previous; });
  h.project = ([x, y]) => [x * 2, y * 3];
  h.runtime = {
    beginOperationGraphicVertexDrag: (index) => h.calls.push(["begin", index]),
    moveOperationGraphicVertexDrag: (index, coord) => h.calls.push(["move", index, coord]),
    finishOperationGraphicVertexDrag: (index) => h.calls.push(["finish", index]),
    insertOperationGraphicVertex: (index, coord) => h.calls.push(["insert", index, coord]),
  };
  h.owner = createOperationGraphicsEditorRenderOwner({
    runtimeState: h.state,
    rendererSurfaceHost: { getOperationGraphicsEditorGroup: () => h.group, getInteractionRect: () => h.interaction },
    ensureOperationGraphicsEditorState: () => { h.ensured++; },
    getOperationGraphicById: (id) => id === h.graphic?.id ? h.graphic : null,
    DEFAULT_OPERATION_GRAPHIC_KIND: "open",
    normalizeOperationGraphicStylePreset: (value, kind) => value || kind,
    normalizeOperationGraphicStroke: (value) => value || "red",
    normalizeOperationGraphicWidth: (value) => value || 2,
    normalizeOperationGraphicOpacity: (value) => value ?? 1,
    getOperationGraphicPreset: (kind) => ({ closed: kind === "closed", stroke: "black", width: 1, opacity: 0.5 }),
    createOperationGraphicPath: (points, options) => { h.pathCalls.push([points, options]); return points.length ? `M${points.length}` : ""; },
    getProjectedPoint: (coord) => h.project(coord),
    getStrategicOverlayRuntimeOwner: () => h.runtime,
    getMapLonLatFromEvent: (event) => event.coord,
    getOperationGraphicEditorMidpoints: (points, { closed }) => points.slice(0, closed ? points.length : -1)
      .map((point, index) => ({ id: `mid-${index}`, insertIndex: index + 1, coord: point })),
  });
  h.render = () => h.owner.renderOperationGraphicsEditorOverlay((event, datum, points) => {
    event.stopPropagation(); h.clicked.push([datum.index, points]);
  });
  h.nodes = (className) => h.group.selectAll(`circle.operation-graphics-editor-${className}`).nodes;
  return h;
}
const event = () => ({ stopped: 0, prevented: 0, stopPropagation() { this.stopped++; }, preventDefault() { this.prevented++; } });

test("keyed handles reuse nodes, refresh coordinates and selection, remove exits, and stay above midpoints", (t) => {
  const h = fixture(t);
  h.render();
  const [first, second] = h.nodes("point");
  assert.equal(second.attrs.fill, "#0f172a");
  assert.equal(second.attrs.cx, 10);
  assert.equal(second.attrs.cy, 15);
  assert.equal(h.group.nodes[0].attrs["aria-hidden"], "false");
  assert.equal(h.interaction.nodes[0].styles["pointer-events"], "none");
  assert.equal(h.interaction.nodes[0].lowered, true);
  const drag = second.drag;
  h.project = () => [99, 42];
  h.graphic.points = [[1, 1], [2, 2], [3, 3]];
  h.graphic.kind = "closed";
  h.render();
  assert.equal(h.nodes("point")[0], first);
  assert.equal(h.nodes("point")[1], second);
  assert.equal(second.attrs.cx, 99);
  assert.equal(second.drag, drag);
  assert.equal(h.dragsCreated, 1);
  assert.deepEqual(h.pathCalls.at(-1)[1], { closed: true, curved: true });
  assert.equal(h.nodes("midpoint").length, 3);
  assert.deepEqual(h.group.nodes[0].children.slice(-3), h.nodes("point"));
  h.graphic.points = [[4, 4]];
  h.project = () => null;
  h.render();
  assert.equal(h.nodes("point").length, 1);
  assert.equal(h.nodes("point")[0], first);
  assert.equal(first.attrs.cx, -9999);
  assert.equal(h.nodes("midpoint").length, 0);
  assert.equal(h.nodes("midpoint-visual").length, 0);
});

test("drawing uses current editor settings; empty or missing graphics clears preview and restores pointer events", (t) => {
  const h = fixture(t);
  h.state.operationGraphicsEditor = { active: true, kind: "closed", points: [[1, 1], [2, 2], [3, 3]], stroke: "green" };
  h.render();
  assert.equal(h.nodes("point")[0].styles.cursor, "default");
  assert.equal(h.dragsCreated, 0);
  assert.equal(h.nodes("midpoint").length, 0);
  assert.equal(h.group.selectAll("path.operation-graphics-editor-path").nodes[0].attrs.stroke, "green");
  assert.equal(h.interaction.nodes[0].styles["pointer-events"], "all");
  h.state.operationGraphicsEditor = { active: false, selectedId: "missing" };
  h.render();
  assert.equal(h.group.nodes[0].children.length, 0);
  assert.equal(h.group.nodes[0].attrs["aria-hidden"], "true");
  h.group = null;
  const before = h.ensured;
  h.render();
  assert.equal(h.ensured, before);
});

test("drag uses current runtime and event coordinates; click delegates current points to host", (t) => {
  const h = fixture(t); h.render();
  const node = h.nodes("point")[1], source = event();
  const handlers = node.drag.handlers;
  handlers.start.call(node, { sourceEvent: source }, node.datum);
  assert.equal(source.stopped, 1);
  assert.equal(node.styles.cursor, "grabbing");
  h.runtime = { ...h.runtime, moveOperationGraphicVertexDrag: (...args) => h.calls.push(["replacement-move", ...args]) };
  handlers.drag.call(node, { sourceEvent: { coord: [7, 8] } }, node.datum);
  handlers.end.call(node, {}, node.datum);
  assert.deepEqual(h.calls, [["begin", 1], ["replacement-move", 1, [7, 8]], ["finish", 1]]);
  assert.equal(node.styles.cursor, "grab");
  h.graphic.points = [[8, 8], [9, 9]]; h.render();
  const click = event(); node.handlers.click.call(node, click, node.datum);
  assert.equal(click.stopped, 1);
  assert.deepEqual(h.clicked, [[1, h.graphic.points]]);
});

test("midpoint pointerdown inserts once and suppresses its following click while later clicks still insert", (t) => {
  const h = fixture(t); h.render();
  const node = h.nodes("midpoint")[0], down = event();
  node.handlers.pointerdown.call(node, down, node.datum);
  assert.equal(down.stopped, 1); assert.equal(down.prevented, 1);
  assert.deepEqual(h.calls, [["insert", 1, [0, 0]]]);
  h.render();
  assert.equal(h.nodes("midpoint")[0], node);
  const click = event(); node.handlers.click.call(node, click, node.datum);
  assert.equal(h.calls.length, 1);
  assert.equal(node.dataset.skipMidpointClick, "false");
  node.handlers.click.call(node, click, node.datum);
  assert.equal(h.calls.length, 2); assert.equal(click.stopped, 1);
});
